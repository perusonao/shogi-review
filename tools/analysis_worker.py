#!/usr/bin/env python3
"""Poll the private queue and run the existing local Suisho5 import pipeline."""
from __future__ import annotations

import argparse
import contextlib
import ctypes
import hashlib
import json
import logging
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from kif_to_game import parse as parse_kif  # noqa: E402
from queue_common import canonical_fingerprint, validate_kif_text, validate_submission_metadata  # noqa: E402

SAFE_FAILURE = "解析処理に失敗しました。Windows workerのログを確認してください。"
HEARTBEAT_INTERVAL_SECONDS = 60
LEASE_DURATION_SECONDS = 5 * 60


class WorkerError(RuntimeError):
    pass


class FatalWorkerError(WorkerError):
    """A local state problem that requires human inspection before another claim."""


class ClaimOwnershipLost(FatalWorkerError):
    """The current claim token can no longer be trusted."""


class WorkerAlreadyRunning(FatalWorkerError):
    """A second worker attempted to use the same checkout."""


DEFAULT_USER_NAMES = ("ぺるそなお", "sonao81")
USER_NAMES_SCHEMA = "worker-aliases-v1"


def normalize_user_name(value: str) -> str:
    """Normalize only compatibility forms and outer whitespace for exact matching."""
    return unicodedata.normalize("NFKC", value).strip()


def load_user_names(root: Path, users: str | None = None,
                    users_file: Path | None = None) -> tuple[str, ...]:
    """Load non-secret aliases from UTF-8 JSON, with legacy env/CLI fallback."""
    if users is not None:
        raw_names = users.split(",")
    else:
        path = users_file or root / "config" / "worker-aliases.json"
        if not path.is_absolute():
            path = root / path
        if path.is_file():
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise WorkerError(f"worker alias config is not valid UTF-8 JSON: {path}") from exc
            if (not isinstance(payload, dict) or payload.get("schemaVersion") != USER_NAMES_SCHEMA
                    or not isinstance(payload.get("userNames"), list)):
                raise WorkerError("worker alias config schema is invalid")
            raw_names = payload["userNames"]
        else:
            legacy = os.environ.get("SHOGI_USER_NAMES")
            raw_names = legacy.split(",") if legacy is not None else list(DEFAULT_USER_NAMES)
    if not all(isinstance(name, str) for name in raw_names):
        raise WorkerError("worker aliases must be strings")
    names = tuple(name.strip() for name in raw_names if name.strip())
    if not names:
        raise WorkerError("worker alias list is empty")
    normalized = [normalize_user_name(name) for name in names]
    if any(not name for name in normalized) or len(normalized) != len(set(normalized)):
        raise WorkerError("worker aliases are empty or duplicate after normalization")
    return names


def safe_output_summary(value: str | None, limit: int = 2000) -> str:
    """Bound subprocess diagnostics and redact credential-shaped text."""
    if not value:
        return ""
    summary = value.strip()[-limit:]
    summary = re.sub(r"(?i)(authorization:\s*bearer\s+)[^\s]+", r"\1[REDACTED]", summary)
    summary = re.sub(r"(?i)((?:secret|token)\s*[=:]\s*)[^\s]+", r"\1[REDACTED]", summary)
    return summary


class QueueClient:
    def __init__(self, base_url: str, secret: str, timeout: int = 30):
        self.base_url = base_url.rstrip("/")
        self.secret = secret
        self.timeout = timeout

    def request(self, method: str, path: str, payload: dict | None = None) -> dict:
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            self.base_url + path,
            data=body,
            method=method,
            headers={
                "Authorization": f"Bearer {self.secret}",
                "Content-Type": "application/json",
                "User-Agent": "shogi-review-analysis-worker/1",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code == 409:
                raise ClaimOwnershipLost("queue rejected the current claim token") from exc
            raise WorkerError("queue request failed") from exc
        except (urllib.error.URLError, json.JSONDecodeError) as exc:
            raise WorkerError("queue request failed") from exc

    def claim(self) -> dict | None:
        return self.request("POST", "/api/worker/claim", {}).get("request")

    def complete(self, request_id: str, claim_token: str, game_id: str) -> None:
        self.request("POST", f"/api/requests/{request_id}/complete", {
            "claimToken": claim_token,
            "gameId": game_id,
        })

    def fail(self, request_id: str, claim_token: str, stage: str) -> None:
        self.request("POST", f"/api/requests/{request_id}/fail", {
            "claimToken": claim_token,
            "error": SAFE_FAILURE,
            "stage": stage,
        })

    def heartbeat(self, request_id: str, claim_token: str) -> str:
        result = self.request("POST", f"/api/requests/{request_id}/heartbeat", {
            "claimToken": claim_token,
        })
        lease_until = result.get("leaseUntil")
        if not isinstance(lease_until, str) or not lease_until:
            raise WorkerError("heartbeat response is invalid")
        return lease_until


class WorkerInstanceLock:
    """Machine-wide Windows mutex or cross-platform advisory file lock."""

    def __init__(self, root: Path, lock_path: Path | None = None):
        self.use_windows_mutex = os.name == "nt" and lock_path is None
        if lock_path is None:
            if os.name == "nt":
                lock_path = None
            else:
                base = Path(os.environ.get("XDG_RUNTIME_DIR") or tempfile.gettempdir()) / "shogi-review-worker"
                digest = hashlib.sha256(str(root.resolve()).casefold().encode("utf-8")).hexdigest()[:16]
                lock_path = base / f"worker-{digest}.lock"
        self.path = lock_path
        self.handle = None
        self.mutex_handle = None

    def __enter__(self) -> "WorkerInstanceLock":
        if self.use_windows_mutex:
            self._acquire_windows_mutex()
            return self
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = self.path.open("a+b")
        self.handle.seek(0, os.SEEK_END)
        if self.handle.tell() == 0:
            self.handle.write(b"0")
            self.handle.flush()
        self.handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (OSError, BlockingIOError) as exc:
            self.handle.close()
            self.handle = None
            raise WorkerAlreadyRunning("another analysis worker already owns this checkout") from exc
        return self

    def _acquire_windows_mutex(self) -> None:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_wchar_p]
        kernel32.CreateMutexW.restype = ctypes.c_void_p
        kernel32.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint]
        kernel32.WaitForSingleObject.restype = ctypes.c_uint
        kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
        kernel32.CloseHandle.restype = ctypes.c_int
        handle = kernel32.CreateMutexW(None, 1, r"Global\ShogiReviewAnalysisWorker")
        if not handle:
            raise FatalWorkerError(f"worker mutex creation failed winerror={ctypes.get_last_error()}")
        self.mutex_handle = handle
        if ctypes.get_last_error() == 183:  # ERROR_ALREADY_EXISTS
            result = kernel32.WaitForSingleObject(handle, 0)
            if result == 0x102:  # WAIT_TIMEOUT
                kernel32.CloseHandle(handle)
                self.mutex_handle = None
                raise WorkerAlreadyRunning("another analysis worker already owns this PC")
            if result not in (0, 0x80):  # WAIT_OBJECT_0 / WAIT_ABANDONED
                error = ctypes.get_last_error()
                kernel32.CloseHandle(handle)
                self.mutex_handle = None
                raise FatalWorkerError(f"worker mutex acquisition failed winerror={error}")

    def __exit__(self, _type, _value, _traceback) -> None:
        if self.mutex_handle is not None:
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel32.ReleaseMutex(self.mutex_handle)
            kernel32.CloseHandle(self.mutex_handle)
            self.mutex_handle = None
            return
        if self.handle is None:
            return
        with contextlib.suppress(OSError):
            self.handle.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
        self.handle.close()
        self.handle = None


class ClaimLease:
    """Keep a claim alive and turn any heartbeat uncertainty into a hard stop."""

    def __init__(self, client: QueueClient, request_id: str, claim_token: str,
                 interval_seconds: int = HEARTBEAT_INTERVAL_SECONDS):
        if interval_seconds <= 0 or interval_seconds >= LEASE_DURATION_SECONDS:
            raise ValueError("heartbeat interval must be positive and shorter than the lease")
        self.client = client
        self.request_id = request_id
        self.claim_token = claim_token
        self.interval_seconds = interval_seconds
        self._stop = threading.Event()
        self._ownership_lost = threading.Event()
        self._error: BaseException | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        try:
            lease_until = self.client.heartbeat(self.request_id, self.claim_token)
        except Exception as exc:
            self._error = exc
            self._ownership_lost.set()
            raise ClaimOwnershipLost("initial heartbeat failed; refusing to process claim") from exc
        logging.info("claim heartbeat active request=%s lease_until=%s", self.request_id, lease_until)
        self._thread = threading.Thread(target=self._run, name="claim-heartbeat", daemon=True)
        self._thread.start()

    def _run(self) -> None:
        while not self._stop.wait(self.interval_seconds):
            try:
                self.client.heartbeat(self.request_id, self.claim_token)
            except BaseException as exc:  # ownership is uncertain even for transient transport failures
                self._error = exc
                self._ownership_lost.set()
                logging.error("claim heartbeat failed request=%s; ownership is no longer trusted", self.request_id)
                return

    def ensure_owned(self) -> None:
        if self._error is not None:
            raise ClaimOwnershipLost("claim heartbeat failed; refusing further mutation") from self._error

    @property
    def ownership_lost(self) -> bool:
        return self._ownership_lost.is_set()

    def stop(self) -> None:
        self.stop_background()
        self.ensure_owned()

    def stop_background(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join()


def run_guarded(command: list[str], root: Path, lease: ClaimLease) -> subprocess.CompletedProcess[str]:
    creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    process = subprocess.Popen(
        command,
        cwd=root,
        shell=False,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env={**os.environ, "PYTHONUTF8": "1"},
        creationflags=creationflags,
    )
    try:
        while process.poll() is None:
            lease.ensure_owned()
            time.sleep(0.25)
        stdout, stderr = process.communicate()
        lease.ensure_owned()
        return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)
    except BaseException:
        lease.stop_background()
        terminate_process_tree(process)
        raise


def terminate_process_tree(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        process.communicate()
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                       check=False, capture_output=True, text=True)
    else:
        process.terminate()
    try:
        process.communicate(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.communicate(timeout=10)


def choose_user(parsed: dict, user_names: tuple[str, ...]) -> str:
    players = tuple(parsed["game"].get(side) for side in ("sente", "gote"))
    aliases = {normalize_user_name(name) for name in user_names}
    for player in players:
        if isinstance(player, str) and normalize_user_name(player) in aliases:
            return player
    logging.error(
        "configured user is not a player parsed_players=%r configured_alias_count=%d normalized_match=false",
        players,
        len(user_names),
    )
    raise WorkerError("configured user is not a player")


def validate_claim(claim: dict, user_names: tuple[str, ...]) -> tuple[dict, str, str, dict | None]:
    try:
        uuid.UUID(str(claim.get("requestId", "")))
    except ValueError as exc:
        raise WorkerError("invalid request id") from exc
    kif = claim.get("kif")
    parsed, fingerprint = validate_kif_text(kif, user_names[0])
    if fingerprint != claim.get("fingerprint"):
        raise WorkerError("fingerprint mismatch")
    supplied_metadata = (claim.get("metadata") or {}).get("calibration")
    metadata = None if supplied_metadata is None else validate_submission_metadata(kif, parsed, supplied_metadata)
    return parsed, fingerprint, choose_user(parsed, user_names), metadata


def find_existing_game_id(root: Path, fingerprint: str, user: str) -> str | None:
    catalog_path = root / "games" / "index.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    catalog_ids = {entry["id"] for entry in catalog.get("games", [])}
    for path in sorted((root / "games").glob("*.kif")):
        try:
            parsed = parse_kif(path, path.stem, user)
        except Exception:
            continue
        if canonical_fingerprint(parsed) != fingerprint:
            continue
        if path.stem in catalog_ids and (root / "games" / f"{path.stem}.json").is_file() and (root / "analysis" / f"{path.stem}.json").is_file():
            return path.stem
    return None


def run_checked(command: list[str], root: Path, *, capture: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=root,
        shell=False,
        check=False,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=capture,
        env={**os.environ, "PYTHONUTF8": "1"},
    )


def refresh_worker_checkout(root: Path) -> tuple[str, bool]:
    """Fast-forward the clean detached worker before it claims durable work."""
    status = run_checked(["git", "status", "--porcelain", "--untracked-files=all"], root, capture=True)
    if status.returncode != 0:
        raise FatalWorkerError("checkout status failed")
    if status.stdout.strip():
        raise FatalWorkerError("worker checkout is dirty; inspect generated artifacts before recovery")
    branch = run_checked(["git", "branch", "--show-current"], root, capture=True)
    if branch.returncode != 0:
        raise FatalWorkerError("checkout branch failed")
    if branch.stdout.strip():
        raise FatalWorkerError("worker checkout must use detached HEAD")
    if run_checked(["git", "fetch", "origin", "main"], root, capture=True).returncode != 0:
        raise FatalWorkerError("checkout fetch failed")
    head = run_checked(["git", "rev-parse", "HEAD"], root, capture=True).stdout.strip()
    origin = run_checked(["git", "rev-parse", "origin/main"], root, capture=True).stdout.strip()
    if not head or not origin:
        raise FatalWorkerError("checkout revision lookup failed")
    ahead = run_checked(["git", "rev-list", "--count", "origin/main..HEAD"], root, capture=True)
    if ahead.returncode != 0:
        raise FatalWorkerError("worker checkout ahead/behind check failed")
    if ahead.stdout.strip() != "0" and head != origin:
        raise FatalWorkerError(
            f"worker checkout is ahead or diverged; head={head[:12]} origin_main={origin[:12]}")
    if head == origin:
        return head, False
    if run_checked(["git", "merge-base", "--is-ancestor", "HEAD", "origin/main"], root).returncode != 0:
        raise FatalWorkerError(
            f"worker checkout is ahead or diverged; head={head[:12]} origin_main={origin[:12]}")
    if run_checked(["git", "merge", "--ff-only", "origin/main"], root, capture=True).returncode != 0:
        raise FatalWorkerError("worker checkout fast-forward failed")
    updated = run_checked(["git", "rev-parse", "HEAD"], root, capture=True).stdout.strip()
    if updated != origin:
        raise FatalWorkerError("worker checkout update verification failed")
    return updated, True


def ensure_published(root: Path, lease: ClaimLease | None = None) -> None:
    if run_checked(["git", "fetch", "origin", "main"], root).returncode != 0:
        raise FatalWorkerError("git fetch failed during publish verification")
    head = run_checked(["git", "rev-parse", "HEAD"], root, capture=True).stdout.strip()
    origin = run_checked(["git", "rev-parse", "origin/main"], root, capture=True).stdout.strip()
    if head == origin:
        return
    if run_checked(["git", "merge-base", "--is-ancestor", "origin/main", "HEAD"], root).returncode != 0:
        raise FatalWorkerError(
            f"local publish commit diverged from origin/main; head={head[:12]} origin_main={origin[:12]}")
    if lease is not None:
        lease.ensure_owned()
    push = run_checked(["git", "push", "origin", "HEAD:main"], root)
    if lease is not None:
        lease.ensure_owned()
    if push.returncode != 0:
        fetch = run_checked(["git", "fetch", "origin", "main"], root, capture=True)
        new_origin = run_checked(["git", "rev-parse", "origin/main"], root, capture=True).stdout.strip()
        if (fetch.returncode == 0 and new_origin and
                run_checked(["git", "merge-base", "--is-ancestor", "HEAD", "origin/main"], root).returncode == 0):
            # The push likely succeeded but its acknowledgement was lost.
            return
        raise FatalWorkerError(
            f"git push failed; local commit preserved head={head[:12]} "
            f"origin_main={new_origin[:12] or origin[:12]}")


def assert_checkout_recoverable(root: Path) -> None:
    """Stop after a failed importer if it left artifacts or a local commit behind."""
    status = run_checked(["git", "status", "--porcelain"], root, capture=True)
    head = run_checked(["git", "rev-parse", "HEAD"], root, capture=True).stdout.strip()
    origin = run_checked(["git", "rev-parse", "origin/main"], root, capture=True).stdout.strip()
    if status.returncode != 0 or status.stdout.strip() or not head or not origin or head != origin:
        raise FatalWorkerError(
            f"import failure left checkout requiring inspection; head={head[:12] or 'unknown'} "
            f"origin_main={origin[:12] or 'unknown'} dirty={bool(status.stdout.strip())}")


def publish_artifacts(root: Path, request_id: str, game_id: str, lease: ClaimLease) -> None:
    lease.ensure_owned()
    status = run_checked(
        ["git", "-c", "core.quotePath=false", "status", "--porcelain", "-z", "--untracked-files=all"],
        root, capture=True,
    )
    if status.returncode != 0:
        raise FatalWorkerError("generated artifacts checkout status could not be checked")
    relative = {
        f"games/{game_id}.kif",
        f"games/{game_id}.json",
        "games/index.json",
        f"analysis/{game_id}.json",
        f"analysis/metrics/{game_id}.json",
        "data/calibration/pwa-intake-v1.json",
    }
    records = [record for record in status.stdout.split("\0") if record]
    changed = {record[3:] for record in records if len(record) >= 4}
    if not changed.issubset(relative):
        raise FatalWorkerError("unexpected files changed during analysis; inspect checkout before publishing")
    if run_checked(["git", "fetch", "origin", "main"], root, capture=True).returncode != 0:
        raise FatalWorkerError("origin/main fetch failed before artifact commit")
    head = run_checked(["git", "rev-parse", "HEAD"], root, capture=True).stdout.strip()
    origin = run_checked(["git", "rev-parse", "origin/main"], root, capture=True).stdout.strip()
    if not head or head != origin:
        raise FatalWorkerError(
            f"origin/main changed before artifact publish; head={head[:12]} origin_main={origin[:12]}")
    paths = [
        f"games/{game_id}.kif",
        f"games/{game_id}.json",
        f"games/index.json",
        f"analysis/{game_id}.json",
        f"analysis/metrics/{game_id}.json",
    ]
    intake = "data/calibration/pwa-intake-v1.json"
    if (root / intake).is_file():
        paths.append(intake)
    lease.ensure_owned()
    staged = run_checked(["git", "add", "--", *paths], root, capture=True)
    if staged.returncode != 0:
        raise FatalWorkerError("git add failed; artifacts preserved for inspection")
    check = run_checked(["git", "diff", "--cached", "--check"], root, capture=True)
    if check.returncode != 0:
        raise FatalWorkerError("staged artifact diff check failed; artifacts preserved")
    staged_diff = run_checked(["git", "diff", "--cached", "--quiet"], root)
    if staged_diff.returncode == 0:
        return
    if staged_diff.returncode != 1:
        raise FatalWorkerError("staged artifact state could not be checked")
    lease.ensure_owned()
    commit = run_checked(["git", "commit", "-m", f"data: import and analyze {game_id}", "--", *paths],
                         root, capture=True)
    if commit.returncode != 0:
        raise FatalWorkerError("artifact commit failed; staged state preserved for inspection")
    commit_sha = run_checked(["git", "rev-parse", "HEAD"], root, capture=True).stdout.strip()
    lease.ensure_owned()
    ensure_published(root, lease)
    logging.info("published request=%s game=%s commit=%s", request_id, game_id, commit_sha[:12])


def intake_existing(root: Path, game_id: str, fingerprint: str, metadata: dict) -> None:
    payload = json.dumps({"fingerprint": fingerprint, "metadata": metadata}, ensure_ascii=False)
    completed = run_checked([sys.executable, str(root / "tools" / "record_pwa_intake.py"),
                             "--root", str(root), "--game-id", game_id, "--payload", payload], root)
    if completed.returncode != 0:
        raise WorkerError("D2 intake failed")


def process_claim(client: QueueClient, claim: dict, root: Path, user_names: tuple[str, ...]) -> str:
    request_id = str(claim.get("requestId", ""))
    claim_token = str(claim.get("claimToken", ""))
    fingerprint_id = str(claim.get("fingerprint", ""))[:12] or "unknown"
    stage = "claim_validation"
    inbox_path: Path | None = None
    lease: ClaimLease | None = None
    try:
        _, fingerprint, user, calibration_metadata = validate_claim(claim, user_names)
        fingerprint_id = fingerprint[:12]
        lease = ClaimLease(client, request_id, claim_token)
        lease.start()
        logging.info("processing request=%s fingerprint=%s", request_id, fingerprint_id)
        if calibration_metadata is None:
            logging.warning("request %s predates calibration metadata; D2 intake will be skipped", request_id)
        stage = "existing_artifact_lookup"
        existing = find_existing_game_id(root, fingerprint, user)
        if existing:
            if calibration_metadata is not None:
                stage = "calibration_intake"
                intake_existing(root, existing, fingerprint, calibration_metadata)
            stage = "publish_verification"
            publish_artifacts(root, request_id, existing, lease)
            lease.ensure_owned()
            ensure_published(root, lease)
            stage = "queue_complete"
            lease.stop()
            client.complete(request_id, claim_token, existing)
            return existing
        stage = "durable_kif_materialization"
        inbox_path = root / "games" / "inbox" / f"queue-{request_id}.kif"
        inbox_path.parent.mkdir(parents=True, exist_ok=True)
        unexpected_inbox = [path.name for path in inbox_path.parent.glob("*.kif")]
        if unexpected_inbox:
            raise FatalWorkerError(
                f"worker inbox is not empty before request materialization; files={unexpected_inbox[:5]}")
        with inbox_path.open("x", encoding="utf-8", newline="\n") as handle:
            handle.write(claim["kif"])
        command = [
            sys.executable,
            str(root / "tools" / "import_new_games.py"),
            "--user", user,
            "--nodes", "30000",
            "--root", str(root),
        ]
        if calibration_metadata is not None:
            command.extend(["--calibration-metadata", json.dumps(
                {"fingerprint": fingerprint, "metadata": calibration_metadata}, ensure_ascii=False)])
        stage = "analysis_publish_subprocess"
        completed = run_guarded(command, root, lease)
        if completed.returncode != 0:
            logging.error("import pipeline failed request=%s fingerprint=%s stage=%s exit %s",
                          request_id, fingerprint_id, stage, completed.returncode)
            stdout = safe_output_summary(completed.stdout)
            stderr = safe_output_summary(completed.stderr)
            if stdout:
                logging.error("import stdout summary:\n%s", stdout)
            if stderr:
                logging.error("import stderr summary:\n%s", stderr)
            assert_checkout_recoverable(root)
            raise WorkerError("analysis pipeline failed")
        stage = "artifact_verification"
        lease.ensure_owned()
        game_id = find_existing_game_id(root, fingerprint, user)
        if not game_id:
            raise WorkerError("published game not found")
        lease.ensure_owned()
        stage = "publish_verification"
        publish_artifacts(root, request_id, game_id, lease)
        ensure_published(root, lease)
        stage = "queue_complete"
        lease.stop()
        client.complete(request_id, claim_token, game_id)
        return game_id
    except Exception as exc:
        head_result = run_checked(["git", "rev-parse", "HEAD"], root, capture=True)
        branch_result = run_checked(["git", "branch", "--show-current"], root, capture=True)
        head = (head_result.stdout or "").strip() or "unknown"
        branch = (branch_result.stdout or "").strip() or "detached"
        logging.error("request=%s fingerprint=%s failed stage=%s error=%s head=%s branch=%s",
                      request_id, fingerprint_id, stage, type(exc).__name__, head[:12], branch)
        ownership_lost = isinstance(exc, ClaimOwnershipLost) or (lease is not None and lease.ownership_lost)
        preserve_state = ownership_lost or isinstance(exc, FatalWorkerError)
        if inbox_path and inbox_path.exists() and not preserve_state:
            inbox_path.unlink()
        safe_to_fail = not isinstance(exc, FatalWorkerError)
        if lease is None and not ownership_lost and safe_to_fail:
            try:
                client.fail(request_id, claim_token, stage)
            except Exception:
                logging.exception("failed to update queue status")
        elif lease is not None and not ownership_lost and safe_to_fail:
            try:
                lease.stop()
                client.fail(request_id, claim_token, stage)
            except ClaimOwnershipLost:
                ownership_lost = True
                logging.error("claim ownership lost; fail transition suppressed request=%s", request_id)
            except Exception:
                logging.exception("failed to update queue status")
        if ownership_lost:
            if lease is not None:
                lease.stop_background()
            raise ClaimOwnershipLost(
                "claim ownership lost; preserve worker checkout for human inspection") from exc
        if not safe_to_fail and lease is not None:
            lease.stop_background()
        raise


def positive_job_count(value: str) -> int:
    try:
        count = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("max jobs must be an integer") from exc
    if count <= 0:
        raise argparse.ArgumentTypeError("max jobs must be greater than zero")
    return count


def run_loop(args: argparse.Namespace, client: QueueClient, users: tuple[str, ...]) -> int:
    limit = 1 if args.once else args.max_jobs
    processed = 0
    had_failure = False
    while True:
        claim = None
        try:
            head, updated = refresh_worker_checkout(args.root.resolve())
            logging.info("worker checkout ready head=%s branch=detached", head[:12])
            if updated:
                logging.info("worker checkout advanced; restarting with latest code")
                os.execv(sys.executable, [sys.executable, *sys.argv])
            claim = client.claim()
            if claim:
                try:
                    game_id = process_claim(client, claim, args.root.resolve(), users)
                    logging.info("completed request %s as %s", claim.get("requestId"), game_id)
                finally:
                    processed += 1
            elif args.once:
                logging.info("queue is empty")
                return 0
        except KeyboardInterrupt:
            return 130
        except (ClaimOwnershipLost, FatalWorkerError):
            logging.exception("worker stopped for human-safe recovery")
            return 1
        except Exception:
            had_failure = True
            logging.exception("worker cycle failed")
            if args.once:
                return 1
        if limit is not None and processed >= limit:
            logging.info("job limit reached processed=%d failures=%s", processed, had_failure)
            return 1 if had_failure else 0
        time.sleep(args.poll_seconds)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--url", default=os.environ.get("SHOGI_QUEUE_URL", ""))
    parser.add_argument("--secret", default=os.environ.get("SHOGI_WORKER_SECRET", ""))
    parser.add_argument("--users", help="legacy comma-separated aliases; overrides the UTF-8 alias file")
    parser.add_argument("--users-file", type=Path,
                        default=Path(os.environ["SHOGI_USER_NAMES_FILE"])
                        if os.environ.get("SHOGI_USER_NAMES_FILE") else None)
    parser.add_argument("--poll-seconds", type=int, default=int(os.environ.get("SHOGI_POLL_SECONDS", "45")))
    jobs = parser.add_mutually_exclusive_group()
    jobs.add_argument("--once", action="store_true", help="claim at most one job (legacy contract)")
    jobs.add_argument("--max-jobs", type=positive_job_count,
                      help="stop after N claimed jobs, whether each succeeds or fails")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if not args.url.startswith("https://") or not args.secret:
        logging.error("SHOGI_QUEUE_URL(HTTPS) and SHOGI_WORKER_SECRET are required")
        return 2
    if not 30 <= args.poll_seconds <= 60:
        logging.error("poll interval must be 30-60 seconds")
        return 2
    try:
        users = load_user_names(args.root.resolve(), args.users, args.users_file)
    except WorkerError as exc:
        logging.error("%s", exc)
        return 2
    client = QueueClient(args.url, args.secret)
    logging.info("analysis worker started (poll=%ss aliases=%d)", args.poll_seconds, len(users))
    try:
        with WorkerInstanceLock(args.root.resolve()):
            return run_loop(args, client, users)
    except WorkerAlreadyRunning as exc:
        logging.error("%s", exc)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
