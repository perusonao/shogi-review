from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from analysis_worker import (  # noqa: E402
    ClaimLease,
    ClaimOwnershipLost,
    FatalWorkerError,
    QueueClient,
    WorkerAlreadyRunning,
    WorkerInstanceLock,
    assert_checkout_recoverable,
    ensure_published,
    positive_job_count,
    process_claim,
    publish_artifacts,
    run_loop,
    run_guarded,
)
from kif_to_game import parse as parse_kif  # noqa: E402
from queue_common import canonical_fingerprint  # noqa: E402


class FakeClient:
    def __init__(self, claims=None):
        self.claims = list(claims or [])
        self.failed = []
        self.completed = []

    def claim(self):
        return self.claims.pop(0) if self.claims else None

    def heartbeat(self, _request_id, _claim_token):
        return "2099-01-01T00:00:00.000Z"

    def fail(self, request_id, token, stage):
        self.failed.append((request_id, token, stage))

    def complete(self, request_id, token, game_id):
        self.completed.append((request_id, token, game_id))


class WorkerResilienceTests(unittest.TestCase):
    def test_positive_job_count_rejects_invalid_values(self):
        self.assertEqual(positive_job_count("3"), 3)
        for value in ("0", "-1", "not-a-number"):
            with self.assertRaises(argparse.ArgumentTypeError):
                positive_job_count(value)

    def test_once_and_max_jobs_are_mutually_exclusive(self):
        result = subprocess.run([
            sys.executable, str(ROOT / "tools" / "analysis_worker.py"),
            "--once", "--max-jobs", "3",
        ], cwd=ROOT, text=True, capture_output=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn("not allowed with argument", result.stderr)

    def test_max_jobs_counts_success_and_failure_then_stops(self):
        claims = [{"requestId": str(index)} for index in range(3)]
        client = FakeClient(claims)
        args = argparse.Namespace(root=ROOT, once=False, max_jobs=3, poll_seconds=30)
        outcomes = ["game-1", RuntimeError("engine failed"), "game-3"]

        def process(*_args):
            outcome = outcomes.pop(0)
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        with (patch("analysis_worker.refresh_worker_checkout", return_value=("a" * 40, False)),
              patch("analysis_worker.process_claim", side_effect=process) as called,
              patch("analysis_worker.time.sleep")):
            self.assertEqual(run_loop(args, client, ("sonao81",)), 1)
        self.assertEqual(called.call_count, 3)
        self.assertEqual(client.claims, [])

    def test_worker_lock_rejects_second_instance_and_releases(self):
        with tempfile.TemporaryDirectory() as directory:
            lock_path = Path(directory) / "worker.lock"
            with WorkerInstanceLock(ROOT, lock_path):
                with self.assertRaises(WorkerAlreadyRunning):
                    with WorkerInstanceLock(ROOT, lock_path):
                        self.fail("second lock unexpectedly acquired")
            with WorkerInstanceLock(ROOT, lock_path):
                pass

    def test_worker_lock_is_released_after_process_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            lock_path = Path(directory) / "worker.lock"
            code = (
                "import os,sys; from pathlib import Path; "
                f"sys.path.insert(0, {str(ROOT / 'tools')!r}); "
                "from analysis_worker import WorkerInstanceLock; "
                f"lock=WorkerInstanceLock(Path({str(ROOT)!r}), Path({str(lock_path)!r})); "
                "lock.__enter__(); os._exit(0)"
            )
            subprocess.run([sys.executable, "-c", code], check=True)
            with WorkerInstanceLock(ROOT, lock_path):
                pass

    def test_worker_lock_is_shared_across_different_checkout_roots(self):
        with tempfile.TemporaryDirectory() as directory:
            lock_path = Path(directory) / "user.lock"
            with WorkerInstanceLock(Path(directory) / "checkout-a", lock_path):
                with self.assertRaises(WorkerAlreadyRunning):
                    with WorkerInstanceLock(Path(directory) / "checkout-b", lock_path):
                        self.fail("different checkout bypassed the per-user lock")

    @unittest.skipUnless(os.name == "nt", "Windows machine-wide mutex")
    def test_windows_mutex_blocks_second_checkout_before_claim(self):
        with WorkerInstanceLock(ROOT):
            code = (
                "import sys; from pathlib import Path; "
                f"sys.path.insert(0, {str(ROOT / 'tools')!r}); "
                "from analysis_worker import WorkerInstanceLock, WorkerAlreadyRunning; "
                f"lock=WorkerInstanceLock(Path({str(ROOT.parent / 'another-checkout')!r})); "
                "\ntry:\n lock.__enter__()\nexcept WorkerAlreadyRunning:\n raise SystemExit(3)\n"
                "raise SystemExit(0)"
            )
            second = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
            self.assertEqual(second.returncode, 3, second.stderr)

    def test_heartbeat_failure_revokes_local_ownership(self):
        class Client:
            calls = 0
            def heartbeat(self, _request_id, _claim_token):
                self.calls += 1
                if self.calls > 1:
                    raise RuntimeError("network uncertain")
                return "2099-01-01T00:00:00.000Z"

        lease = ClaimLease(Client(), "request", "token", interval_seconds=0.01)
        lease.start()
        deadline = time.time() + 1
        while time.time() < deadline:
            try:
                lease.ensure_owned()
            except ClaimOwnershipLost:
                break
            time.sleep(0.01)
        else:
            self.fail("heartbeat failure was not observed")
        with self.assertRaises(ClaimOwnershipLost):
            lease.ensure_owned()
        lease._stop.set()
        lease._thread.join()

    def test_initial_heartbeat_failure_prevents_work(self):
        class Client:
            def heartbeat(self, _request_id, _claim_token):
                raise RuntimeError("ownership unknown")

        lease = ClaimLease(Client(), "request", "token")
        with self.assertRaises(ClaimOwnershipLost):
            lease.start()
        self.assertTrue(lease.ownership_lost)

    def test_queue_409_is_treated_as_lost_claim_ownership(self):
        client = QueueClient("https://queue.example", "test-secret")
        error = __import__("urllib.error", fromlist=["HTTPError"]).HTTPError(
            "https://queue.example/api/requests/id/complete", 409, "conflict", {}, None)
        with patch("analysis_worker.urllib.request.urlopen", side_effect=error):
            with self.assertRaises(ClaimOwnershipLost):
                client.complete("id", "stale-token", "game")

    def test_heartbeat_error_does_not_stop_worker_before_engine_child_is_reaped(self):
        class Client:
            calls = 0
            def heartbeat(self, _request_id, _claim_token):
                self.calls += 1
                if self.calls > 1:
                    raise RuntimeError("network uncertain")
                return "2099-01-01T00:00:00.000Z"

        lease = ClaimLease(Client(), "request", "token", interval_seconds=0.01)
        lease.start()
        deadline = time.time() + 1
        while time.time() < deadline and not lease.ownership_lost:
            time.sleep(0.01)
        self.assertTrue(lease.ownership_lost)
        lease._stop.set()
        lease._thread.join()

    def test_ownership_loss_suppresses_complete_fail_and_publish(self):
        kif = (ROOT / "games" / "20260910_ひぐれ.kif").read_text(encoding="utf-8")
        parsed = parse_kif(ROOT / "games" / "20260910_ひぐれ.kif", "test", "ぺるそなお")
        claim = {"requestId": str(uuid.uuid4()), "claimToken": "token",
                 "fingerprint": canonical_fingerprint(parsed), "kif": kif, "metadata": {}}
        client = FakeClient()

        class LostLease:
            def __init__(self, *_args, **_kwargs): pass
            ownership_lost = True
            def start(self): pass
            def ensure_owned(self): raise ClaimOwnershipLost("lost")
            def stop_background(self): pass
            def stop(self): raise ClaimOwnershipLost("lost")

        with tempfile.TemporaryDirectory() as directory:
            with (patch("analysis_worker.ClaimLease", LostLease),
                  patch("analysis_worker.find_existing_game_id", return_value="existing"),
                  patch("analysis_worker.ensure_published") as publish):
                with self.assertRaises(ClaimOwnershipLost):
                    process_claim(client, claim, Path(directory), ("ぺるそなお", "sonao81"))
        publish.assert_not_called()
        self.assertEqual(client.completed, [])
        self.assertEqual(client.failed, [])

    def test_keyboard_interrupt_terminates_and_reaps_analysis_subprocess(self):
        class InterruptLease:
            stopped = False
            def ensure_owned(self):
                raise KeyboardInterrupt()
            def stop_background(self):
                self.stopped = True

        lease = InterruptLease()
        with self.assertRaises(KeyboardInterrupt):
            run_guarded([sys.executable, "-c", "import time; time.sleep(60)"], ROOT, lease)
        self.assertTrue(lease.stopped)

    def test_heartbeat_loss_terminates_and_reaps_analysis_subprocess(self):
        class LostLease:
            checks = 0
            stopped = False
            def ensure_owned(self):
                self.checks += 1
                if self.checks >= 2:
                    raise ClaimOwnershipLost("heartbeat failed")
            def stop_background(self):
                self.stopped = True

        lease = LostLease()
        with self.assertRaises(ClaimOwnershipLost):
            run_guarded([sys.executable, "-c", "import time; time.sleep(60)"], ROOT, lease)
        self.assertTrue(lease.stopped)

    def test_lost_ownership_preserves_inbox_for_recovery(self):
        kif = (ROOT / "games" / "20260910_ひぐれ.kif").read_text(encoding="utf-8")
        parsed = parse_kif(ROOT / "games" / "20260910_ひぐれ.kif", "test", "ぺるそなお")
        claim = {"requestId": str(uuid.uuid4()), "claimToken": "token",
                 "fingerprint": canonical_fingerprint(parsed), "kif": kif, "metadata": {}}
        client = FakeClient()

        class LostLease:
            def __init__(self, *_args, **_kwargs): pass
            ownership_lost = True
            def start(self): pass
            def ensure_owned(self): raise ClaimOwnershipLost("lost")
            def stop_background(self): pass
            def stop(self): raise ClaimOwnershipLost("lost")

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with (patch("analysis_worker.ClaimLease", LostLease),
                  patch("analysis_worker.find_existing_game_id", return_value=None),
                  patch("analysis_worker.ensure_published"),
                  self.assertLogs(level="ERROR")):
                with self.assertRaises(ClaimOwnershipLost):
                    process_claim(client, claim, root, ("ぺるそなお", "sonao81"))
            inbox = root / "games" / "inbox" / f"queue-{claim['requestId']}.kif"
            self.assertTrue(inbox.is_file())
        self.assertEqual(client.completed, [])
        self.assertEqual(client.failed, [])

    def test_dirty_or_ahead_checkout_requires_human_recovery(self):
        dirty = subprocess.CompletedProcess([], 0, " M games/index.json\n", "")
        head = subprocess.CompletedProcess([], 0, "a" * 40 + "\n", "")
        origin = subprocess.CompletedProcess([], 0, "b" * 40 + "\n", "")
        with patch("analysis_worker.run_checked", side_effect=[dirty, head, origin]):
            with self.assertRaisesRegex(FatalWorkerError, "requiring inspection"):
                assert_checkout_recoverable(ROOT)

    def test_push_rejection_preserves_local_commit_and_stops_without_rebase(self):
        head = "a" * 40
        old_origin = "b" * 40
        new_origin = "c" * 40
        commands = []

        def run(command, _root, capture=False):
            commands.append(command)
            if command[:3] == ["git", "fetch", "origin"]:
                return subprocess.CompletedProcess(command, 0, "", "")
            if command == ["git", "rev-parse", "HEAD"]:
                return subprocess.CompletedProcess(command, 0, f"{head}\n", "")
            if command == ["git", "rev-parse", "origin/main"]:
                value = new_origin if len([c for c in commands if c[:3] == ["git", "fetch", "origin"]]) > 1 else old_origin
                return subprocess.CompletedProcess(command, 0, f"{value}\n", "")
            if command == ["git", "merge-base", "--is-ancestor", "origin/main", "HEAD"]:
                return subprocess.CompletedProcess(command, 0, "", "")
            if command == ["git", "merge-base", "--is-ancestor", "HEAD", "origin/main"]:
                return subprocess.CompletedProcess(command, 1, "", "")
            if command[:3] == ["git", "push", "origin"]:
                return subprocess.CompletedProcess(command, 1, "", "non-fast-forward")
            self.fail(f"unexpected git command: {command}")

        with patch("analysis_worker.run_checked", side_effect=run):
            with self.assertRaisesRegex(FatalWorkerError, "local commit preserved"):
                ensure_published(ROOT)
        self.assertTrue(any(command[:3] == ["git", "push", "origin"] for command in commands))
        self.assertFalse(any(command[:2] in (["git", "reset"], ["git", "rebase"]) or
                             "--force" in command for command in commands))

    def test_push_ack_loss_is_idempotently_recognized_when_origin_contains_commit(self):
        head = "a" * 40
        commands = []
        origins = iter(["b" * 40, head])
        def run_with_origins(command, _root, capture=False):
            if command[:3] == ["git", "fetch", "origin"]:
                commands.append(command)
                return subprocess.CompletedProcess(command, 0, "", "")
            if command == ["git", "rev-parse", "HEAD"]:
                commands.append(command)
                return subprocess.CompletedProcess(command, 0, f"{head}\n", "")
            if command == ["git", "rev-parse", "origin/main"]:
                commands.append(command)
                return subprocess.CompletedProcess(command, 0, f"{next(origins)}\n", "")
            if command in (["git", "merge-base", "--is-ancestor", "origin/main", "HEAD"],
                           ["git", "merge-base", "--is-ancestor", "HEAD", "origin/main"]):
                commands.append(command)
                return subprocess.CompletedProcess(command, 0, "", "")
            if command[:3] == ["git", "push", "origin"]:
                commands.append(command)
                return subprocess.CompletedProcess(command, 1, "", "ack lost")
            self.fail(f"unexpected git command: {command}")

        with patch("analysis_worker.run_checked", side_effect=run_with_origins):
            ensure_published(ROOT)

    def test_publish_commits_only_current_artifacts_and_pushes_without_force(self):
        class Lease:
            def __init__(self): self.checks = 0
            def ensure_owned(self): self.checks += 1

        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            origin = base / "origin.git"
            root = base / "checkout"
            subprocess.run(["git", "init", "--bare", str(origin)], check=True, capture_output=True)
            root.mkdir()
            subprocess.run(["git", "init", "-b", "main"], cwd=root, check=True, capture_output=True)
            subprocess.run(["git", "config", "user.name", "Resilience Test"], cwd=root, check=True)
            subprocess.run(["git", "config", "user.email", "worker@example.invalid"], cwd=root, check=True)
            (root / "baseline.txt").write_text("baseline\n", encoding="utf-8")
            subprocess.run(["git", "add", "baseline.txt"], cwd=root, check=True)
            subprocess.run(["git", "commit", "-m", "baseline"], cwd=root, check=True, capture_output=True)
            subprocess.run(["git", "remote", "add", "origin", str(origin)], cwd=root, check=True)
            subprocess.run(["git", "push", "-u", "origin", "main"], cwd=root, check=True, capture_output=True)
            game_id = "20260928_日本語相手"
            outputs = {
                f"games/{game_id}.kif": "kif\n",
                f"games/{game_id}.json": "{}\n",
                "games/index.json": '{"games":[]}\n',
                f"analysis/{game_id}.json": "{}\n",
                f"analysis/metrics/{game_id}.json": "{}\n",
            }
            for relative, contents in outputs.items():
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(contents, encoding="utf-8")

            lease = Lease()
            publish_artifacts(root, "request-id", game_id, lease)
            head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, check=True,
                                  capture_output=True, text=True).stdout.strip()
            remote_head = subprocess.run(["git", "--git-dir", str(origin), "rev-parse", "refs/heads/main"],
                                         check=True, capture_output=True, text=True).stdout.strip()
            committed = subprocess.run(["git", "show", "--pretty=format:", "--name-only", "HEAD"],
                                       cwd=root, check=True, capture_output=True, text=True).stdout.splitlines()
        self.assertEqual(head, remote_head)
        self.assertEqual(set(committed), set(outputs))
        self.assertGreaterEqual(lease.checks, 3)

    def test_origin_advance_during_analysis_stops_before_commit(self):
        class Lease:
            def ensure_owned(self): pass

        head = "a" * 40
        origin = "b" * 40
        commands = []

        def run(command, _root, capture=False):
            commands.append(command)
            if (command[:3] == ["git", "-c", "core.quotePath=false"] and
                    "status" in command and "--porcelain" in command and "-z" in command):
                return subprocess.CompletedProcess(command, 0, "?? games/game.kif\0", "")
            if command[:3] == ["git", "fetch", "origin"]:
                return subprocess.CompletedProcess(command, 0, "", "")
            if command == ["git", "rev-parse", "HEAD"]:
                return subprocess.CompletedProcess(command, 0, f"{head}\n", "")
            if command == ["git", "rev-parse", "origin/main"]:
                return subprocess.CompletedProcess(command, 0, f"{origin}\n", "")
            self.fail(f"unexpected git command: {command}")

        with patch("analysis_worker.run_checked", side_effect=run):
            with self.assertRaisesRegex(FatalWorkerError, "origin/main changed"):
                publish_artifacts(ROOT, "request", "game", Lease())
        self.assertFalse(any(command[:2] == ["git", "add"] for command in commands))
        self.assertFalse(any(command[:2] == ["git", "commit"] for command in commands))

    def test_launcher_and_task_use_bounded_args_and_double_start_defense(self):
        launcher = (ROOT / "start-analysis-worker.bat").read_text(encoding="utf-8")
        registration = (ROOT / "register-worker-task.ps1").read_text(encoding="utf-8")
        self.assertIn(" %*", launcher)
        self.assertIn("-MultipleInstances IgnoreNew", registration)
        self.assertIn("-RestartCount 3", registration)
        self.assertIn("-LogonType Interactive", registration)
        self.assertIn("-RunLevel Limited", registration)
        self.assertIn("CodexSandboxOffline", registration)
        self.assertIn("normal interactive Windows account", registration)

    def test_migration_is_additive_and_preserves_existing_queue_fields(self):
        migration = (ROOT / "backend" / "cloudflare" / "migrations" /
                     "0002_worker_resilience.sql").read_text(encoding="utf-8")
        self.assertIn("ADD COLUMN attempt_count", migration)
        self.assertIn("ADD COLUMN failure_stage", migration)
        self.assertIn("ADD COLUMN last_error_at", migration)
        self.assertNotIn("DROP ", migration.upper())
        self.assertNotIn("UPDATE ", migration.upper())


if __name__ == "__main__":
    unittest.main()
