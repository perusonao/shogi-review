#!/usr/bin/env python3
"""Poll the private queue and run the existing local Suisho5 import pipeline."""
from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from kif_to_game import parse as parse_kif  # noqa: E402
from queue_common import canonical_fingerprint, validate_kif_text, validate_submission_metadata  # noqa: E402

SAFE_FAILURE = "解析処理に失敗しました。Windows workerのログを確認してください。"


class WorkerError(RuntimeError):
    pass


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
        except (urllib.error.URLError, json.JSONDecodeError) as exc:
            raise WorkerError("queue request failed") from exc

    def claim(self) -> dict | None:
        return self.request("POST", "/api/worker/claim", {}).get("request")

    def complete(self, request_id: str, claim_token: str, game_id: str) -> None:
        self.request("POST", f"/api/requests/{request_id}/complete", {
            "claimToken": claim_token,
            "gameId": game_id,
        })

    def fail(self, request_id: str, claim_token: str) -> None:
        self.request("POST", f"/api/requests/{request_id}/fail", {
            "claimToken": claim_token,
            "error": SAFE_FAILURE,
        })


def choose_user(parsed: dict, user_names: tuple[str, ...]) -> str:
    players = {parsed["game"].get("sente"), parsed["game"].get("gote")}
    for name in user_names:
        if name in players:
            return name
    raise WorkerError("configured user is not a player")


def validate_claim(claim: dict, user_names: tuple[str, ...]) -> tuple[dict, str, str, dict]:
    try:
        uuid.UUID(str(claim.get("requestId", "")))
    except ValueError as exc:
        raise WorkerError("invalid request id") from exc
    kif = claim.get("kif")
    parsed, fingerprint = validate_kif_text(kif, user_names[0])
    if fingerprint != claim.get("fingerprint"):
        raise WorkerError("fingerprint mismatch")
    metadata = validate_submission_metadata(kif, parsed, (claim.get("metadata") or {}).get("calibration"))
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


def ensure_published(root: Path) -> None:
    if run_checked(["git", "fetch", "origin", "main"], root).returncode != 0:
        raise WorkerError("git fetch failed")
    head = run_checked(["git", "rev-parse", "HEAD"], root, capture=True).stdout.strip()
    origin = run_checked(["git", "rev-parse", "origin/main"], root, capture=True).stdout.strip()
    if head == origin:
        return
    if run_checked(["git", "merge-base", "--is-ancestor", "origin/main", "HEAD"], root).returncode != 0:
        raise WorkerError("local branch diverged from origin/main")
    if run_checked(["git", "push", "origin", "HEAD:main"], root).returncode != 0:
        raise WorkerError("git push failed")


def intake_existing(root: Path, game_id: str, fingerprint: str, metadata: dict) -> None:
    payload = json.dumps({"fingerprint": fingerprint, "metadata": metadata}, ensure_ascii=False)
    completed = run_checked([sys.executable, str(root / "tools" / "record_pwa_intake.py"),
                             "--root", str(root), "--game-id", game_id, "--payload", payload], root)
    if completed.returncode != 0:
        raise WorkerError("D2 intake failed")
    registry = "data/calibration/pwa-intake-v1.json"
    if run_checked(["git", "add", "--", registry], root).returncode != 0:
        raise WorkerError("D2 intake staging failed")
    staged = run_checked(["git", "diff", "--cached", "--quiet", "--", registry], root)
    if staged.returncode == 0:
        return
    if run_checked(["git", "commit", "-m", f"data: intake labeled game {game_id}", "--", registry], root).returncode != 0:
        raise WorkerError("D2 intake commit failed")
    if run_checked(["git", "push", "origin", "HEAD:main"], root).returncode != 0:
        raise WorkerError("D2 intake push failed")


def process_claim(client: QueueClient, claim: dict, root: Path, user_names: tuple[str, ...]) -> str:
    request_id = str(claim.get("requestId", ""))
    claim_token = str(claim.get("claimToken", ""))
    inbox_path: Path | None = None
    try:
        _, fingerprint, user, calibration_metadata = validate_claim(claim, user_names)
        existing = find_existing_game_id(root, fingerprint, user)
        if existing:
            intake_existing(root, existing, fingerprint, calibration_metadata)
            ensure_published(root)
            client.complete(request_id, claim_token, existing)
            return existing
        inbox_path = root / "games" / "inbox" / f"queue-{request_id}.kif"
        inbox_path.parent.mkdir(parents=True, exist_ok=True)
        with inbox_path.open("x", encoding="utf-8", newline="\n") as handle:
            handle.write(claim["kif"])
        completed = run_checked([
            sys.executable,
            str(root / "tools" / "import_new_games.py"),
            "--user", user,
            "--nodes", "30000",
            "--publish",
            "--calibration-metadata", json.dumps({"fingerprint": fingerprint, "metadata": calibration_metadata}, ensure_ascii=False),
        ], root, capture=True)
        if completed.returncode != 0:
            logging.error("import pipeline failed (exit %s)", completed.returncode)
            if completed.stdout and completed.stdout.strip():
                logging.error("import stdout:\n%s", completed.stdout.rstrip())
            if completed.stderr and completed.stderr.strip():
                logging.error("import stderr:\n%s", completed.stderr.rstrip())
            raise WorkerError("analysis pipeline failed")
        game_id = find_existing_game_id(root, fingerprint, user)
        if not game_id:
            raise WorkerError("published game not found")
        ensure_published(root)
        client.complete(request_id, claim_token, game_id)
        return game_id
    except Exception:
        if inbox_path and inbox_path.exists():
            inbox_path.unlink()
        try:
            client.fail(request_id, claim_token)
        except Exception:
            logging.exception("failed to update queue status")
        raise


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--url", default=os.environ.get("SHOGI_QUEUE_URL", ""))
    parser.add_argument("--secret", default=os.environ.get("SHOGI_WORKER_SECRET", ""))
    parser.add_argument("--users", default=os.environ.get("SHOGI_USER_NAMES", "ぺるそなお,sonao81"))
    parser.add_argument("--poll-seconds", type=int, default=int(os.environ.get("SHOGI_POLL_SECONDS", "45")))
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if not args.url.startswith("https://") or not args.secret:
        logging.error("SHOGI_QUEUE_URL(HTTPS) and SHOGI_WORKER_SECRET are required")
        return 2
    if not 30 <= args.poll_seconds <= 60:
        logging.error("poll interval must be 30-60 seconds")
        return 2
    users = tuple(name.strip() for name in args.users.split(",") if name.strip())
    if not users:
        logging.error("SHOGI_USER_NAMES is empty")
        return 2
    client = QueueClient(args.url, args.secret)
    logging.info("analysis worker started (poll=%ss)", args.poll_seconds)
    while True:
        try:
            claim = client.claim()
            if claim:
                game_id = process_claim(client, claim, args.root.resolve(), users)
                logging.info("completed request %s as %s", claim.get("requestId"), game_id)
            elif args.once:
                logging.info("queue is empty")
        except KeyboardInterrupt:
            return 0
        except Exception:
            logging.exception("worker cycle failed")
            if args.once:
                return 1
        if args.once:
            return 0
        time.sleep(args.poll_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
