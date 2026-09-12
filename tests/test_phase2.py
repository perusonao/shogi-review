from __future__ import annotations

import json
import subprocess
import shutil
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from analysis_worker import find_existing_game_id, process_claim, validate_claim  # noqa: E402
from kif_to_game import parse as parse_kif  # noqa: E402
from queue_common import MAX_KIF_BYTES, canonical_fingerprint, normalize_rank, submission_metadata, validate_kif_text  # noqa: E402
from pwa_intake import intake_player_games  # noqa: E402


class Phase2Tests(unittest.TestCase):
    class FakeQueueClient:
        def __init__(self) -> None:
            self.completed: tuple[str, str, str] | None = None
            self.failed = False

        def complete(self, request_id: str, claim_token: str, game_id: str) -> None:
            self.completed = (request_id, claim_token, game_id)

        def fail(self, _request_id: str, _claim_token: str) -> None:
            self.failed = True

    @classmethod
    def setUpClass(cls) -> None:
        cls.higure_text = (ROOT / "games" / "20260910_ひぐれ.kif").read_text(encoding="utf-8")
        cls.higure = parse_kif(ROOT / "games" / "20260910_ひぐれ.kif", "test", "ぺるそなお")
        cls.fingerprint = canonical_fingerprint(cls.higure)

    def test_higure_parser_58_moves(self) -> None:
        self.assertEqual(self.higure["game"]["moves"], 58)
        self.assertEqual(len(self.higure["positions"]), 59)
        self.assertEqual(self.higure["game"]["result"], "後手・ぺるそなお 勝利")

    def test_fingerprint_is_stable_and_duplicate_is_found(self) -> None:
        parsed, fingerprint = validate_kif_text(self.higure_text + "\n* comment\n", "ぺるそなお")
        self.assertEqual(parsed["game"]["moves"], 58)
        self.assertEqual(fingerprint, self.fingerprint)
        self.assertEqual(find_existing_game_id(ROOT, fingerprint, "ぺるそなお"), "20260910_ひぐれ")

    def test_invalid_kif_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            validate_kif_text("開始日時：2026/09/10 20:09:10\n先手：a\n後手：b\n1 ５六歩(57)")

    def test_oversized_kif_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "128KB"):
            validate_kif_text("x" * (MAX_KIF_BYTES + 1))

    def test_worker_claim_validation(self) -> None:
        metadata = submission_metadata(self.higure_text, self.higure)
        metadata["provider"] = "shogi-wars"
        claim = {
            "requestId": str(uuid.uuid4()),
            "fingerprint": self.fingerprint,
            "kif": self.higure_text,
            "metadata": {"calibration": metadata},
        }
        parsed, fingerprint, user, validated_metadata = validate_claim(claim, ("ぺるそなお", "sonao81"))
        self.assertEqual(parsed["game"]["moves"], 58)
        self.assertEqual(fingerprint, self.fingerprint)
        self.assertEqual(user, "ぺるそなお")
        self.assertEqual(validated_metadata["provider"], "shogi-wars")
        claim["fingerprint"] = "0" * 64
        with self.assertRaisesRegex(RuntimeError, "fingerprint mismatch"):
            validate_claim(claim, ("ぺるそなお", "sonao81"))

    def test_xss_content_is_not_inserted_as_html(self) -> None:
        dangerous = self.higure_text.replace("先手：ひぐれ", "先手：<svg onload=alert(1)>")
        parsed, _ = validate_kif_text(dangerous, "ぺるそなお")
        self.assertEqual(parsed["game"]["sente"], "<svg onload=alert(1)>")
        ui = (ROOT / "kif-submit-ui.mjs").read_text(encoding="utf-8")
        self.assertIn("textContent", ui)
        self.assertNotIn("innerHTML", ui)

    def test_catalog_references_remain_valid(self) -> None:
        catalog = json.loads((ROOT / "games" / "index.json").read_text(encoding="utf-8"))
        ids = [entry["id"] for entry in catalog["games"]]
        self.assertEqual(len(ids), len(set(ids)))
        for entry in catalog["games"]:
            self.assertTrue((ROOT / entry["gameData"]).is_file())
            self.assertTrue((ROOT / entry["analysisData"]).is_file())

    def test_d2_intake_is_timestamped_and_idempotent(self) -> None:
        game_id = "20260910_ひぐれ"
        metadata = submission_metadata(self.higure_text, self.higure)
        metadata["provider"] = "shogi-wars"
        metadata["players"][0].update({"officialRankRaw": "2級", "officialRank": normalize_rank("2級"),
                                       "officialRankSource": "user-confirmed"})
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "games").mkdir(); (root / "analysis").mkdir()
            for relative in (f"games/{game_id}.kif", f"games/{game_id}.json", f"analysis/{game_id}.json"):
                target = root / relative; target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / relative, target)
            path = intake_player_games(root, game_id, self.fingerprint, metadata)
            intake_player_games(root, game_id, self.fingerprint, metadata)
            rows = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["official_rank_observed_at"], "2026-09-10T20:09:10")
        self.assertEqual(rows[0]["collection_route"], "pwa-kif-submit")

    def test_worker_never_enables_shell(self) -> None:
        source = (ROOT / "tools" / "analysis_worker.py").read_text(encoding="utf-8")
        self.assertNotIn("shell=True", source)
        self.assertIn("shell=False", source)

    def test_worker_e2e_invokes_automatic_import_pipeline(self) -> None:
        metadata = submission_metadata(self.higure_text, self.higure)
        metadata["provider"] = "shogi-wars"
        request_id = str(uuid.uuid4())
        claim = {
            "requestId": request_id,
            "claimToken": "opaque-claim-token",
            "fingerprint": self.fingerprint,
            "kif": self.higure_text,
            "metadata": {"calibration": metadata},
        }
        client = self.FakeQueueClient()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with (
                patch("analysis_worker.find_existing_game_id", side_effect=[None, "generated-game"]),
                patch("analysis_worker.ensure_published"),
                patch("analysis_worker.run_checked", return_value=subprocess.CompletedProcess([], 0)) as run_import,
            ):
                game_id = process_claim(client, claim, root, ("ぺるそなお", "sonao81"))
        self.assertEqual(game_id, "generated-game")
        self.assertFalse(client.failed)
        self.assertEqual(client.completed, (request_id, "opaque-claim-token", "generated-game"))
        command = run_import.call_args.args[0]
        self.assertIn("import_new_games.py", " ".join(command))
        self.assertEqual(command[command.index("--nodes") + 1], "30000")
        self.assertIn("--calibration-metadata", command)

    def test_failed_analysis_has_no_intake_and_is_marked_failed(self) -> None:
        metadata = submission_metadata(self.higure_text, self.higure)
        metadata["provider"] = "shogi-wars"
        claim = {"requestId": str(uuid.uuid4()), "claimToken": "token",
                 "fingerprint": self.fingerprint, "kif": self.higure_text,
                 "metadata": {"calibration": metadata}}
        client = self.FakeQueueClient()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with (patch("analysis_worker.find_existing_game_id", return_value=None),
                  patch("analysis_worker.run_checked", return_value=subprocess.CompletedProcess([], 1))):
                with self.assertRaisesRegex(RuntimeError, "analysis pipeline failed"):
                    process_claim(client, claim, root, ("ぺるそなお",))
            self.assertFalse((root / "data/calibration/pwa-intake-v1.json").exists())
        self.assertTrue(client.failed)
        self.assertIsNone(client.completed)


if __name__ == "__main__":
    unittest.main()
