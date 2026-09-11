from __future__ import annotations

import json
import sys
import unittest
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from analysis_worker import find_existing_game_id, validate_claim  # noqa: E402
from kif_to_game import parse as parse_kif  # noqa: E402
from queue_common import MAX_KIF_BYTES, canonical_fingerprint, validate_kif_text  # noqa: E402


class Phase2Tests(unittest.TestCase):
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
        claim = {
            "requestId": str(uuid.uuid4()),
            "fingerprint": self.fingerprint,
            "kif": self.higure_text,
        }
        parsed, fingerprint, user = validate_claim(claim, ("ぺるそなお", "sonao81"))
        self.assertEqual(parsed["game"]["moves"], 58)
        self.assertEqual(fingerprint, self.fingerprint)
        self.assertEqual(user, "ぺるそなお")
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

    def test_worker_never_enables_shell(self) -> None:
        source = (ROOT / "tools" / "analysis_worker.py").read_text(encoding="utf-8")
        self.assertNotIn("shell=True", source)
        self.assertIn("shell=False", source)


if __name__ == "__main__":
    unittest.main()
