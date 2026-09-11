from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

import shogi

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from analyze_with_suisho5 import (  # noqa: E402
    grounded_points,
    make_comment,
    move_display_ja,
    pv_display_ja,
    score_json,
    score_json_to_cp,
)


class ReviewPvTests(unittest.TestCase):
    def test_pv_japanese_applies_moves_in_sequence(self) -> None:
        pv = ["7g7f", "3c3d", "8h2b+", "3a2b"]
        self.assertEqual(
            pv_display_ja(shogi.Board().sfen(), pv),
            ["▲7六歩", "△3四歩", "▲2二角成", "△同銀"],
        )

    def test_drop_and_side_mark(self) -> None:
        board = shogi.Board("4k4/9/9/9/9/9/9/9/4K4 b P 1")
        self.assertEqual(move_display_ja("P*5e", board, "sente"), "▲5五歩打")

    def test_direction_qualifier(self) -> None:
        board = shogi.Board("4k4/9/9/9/9/3G1G3/9/9/4K4 b - 1")
        self.assertEqual(move_display_ja("6f5e", board, "sente"), "▲5五金左")

    def test_declined_promotion(self) -> None:
        board = shogi.Board("4k4/9/9/4P4/9/9/9/9/4K4 b - 1")
        self.assertEqual(move_display_ja("5d5c", board, "sente"), "▲5三歩不成")

    def test_normal_and_mate_scores_remain_distinct(self) -> None:
        self.assertEqual(score_json(("cp", 706)), {"type": "cp", "value": 706})
        self.assertEqual(score_json(("mate", 7), -1), {"type": "mate", "value": -7})
        self.assertGreater(score_json_to_cp({"type": "mate", "value": 7}), 25000)

    def test_grounded_comment_does_not_invent_strategy(self) -> None:
        sfen = shogi.Board().sfen()
        self.assertEqual(grounded_points(sfen, ["7g7f"], {"type": "cp", "value": 20}), [])
        comment = make_comment("▲7六歩")
        self.assertIn("水匠5", comment)
        for unsupported in ("駒得", "受け", "相手玉が危険", "玉が薄い"):
            self.assertNotIn(unsupported, comment)

    def test_old_analysis_json_is_supported_by_ui_fallback(self) -> None:
        ui = (ROOT / "review-enhanced.js").read_text(encoding="utf-8")
        self.assertIn("analysis?.beforeCp", ui)
        self.assertIn("legacyMate", ui)
        self.assertIn("詰みを逃した", ui)
        self.assertIn("相手の詰み筋に入った", ui)
        old = json.loads((ROOT / "analysis" / "20260910_ひぐれ.json").read_text(encoding="utf-8"))
        self.assertEqual(old.get("schemaVersion"), 1)

    def test_nagata_move_28_fixture(self) -> None:
        analysis = json.loads((ROOT / "analysis" / "20260911_nagata2532.json").read_text(encoding="utf-8"))
        issue = next(item for item in analysis["verifiedIssues"] if item["ply"] == 28)
        self.assertEqual(issue["played"], "5c4d")
        self.assertEqual(issue["best"], "1c6h+")
        self.assertEqual(issue["lossCp"], 465)
        self.assertEqual(issue["scoreBefore"], {"type": "cp", "value": 706})
        self.assertEqual(issue["scoreAfterActual"], {"type": "cp", "value": 241})
        self.assertEqual(issue["pvJa"], ["△6八角成", "▲同銀"])
        self.assertEqual(issue["actualPv"][0], issue["played"])
        self.assertGreaterEqual(len(issue["actualPvJa"]), 5)
        self.assertEqual(issue["points"], ["推奨手は角を成る手です。", "推奨手は金を取る手です。"])
        game = json.loads((ROOT / "games" / "20260911_nagata2532.json").read_text(encoding="utf-8"))
        comment = next(item["comment"] for item in game["issues"] if item["ply"] == 28)
        self.assertNotIn("受け", comment)

    def test_nagata_schema_has_every_position_and_move(self) -> None:
        analysis = json.loads((ROOT / "analysis" / "20260911_nagata2532.json").read_text(encoding="utf-8"))
        self.assertEqual(analysis["schemaVersion"], 2)
        self.assertEqual(len(analysis["evaluations"]), 63)
        self.assertEqual(len(analysis["moveAnalyses"]), 62)
        self.assertTrue(all("score" in item for item in analysis["evaluations"]))
        required = {"scoreBefore", "actualMove", "scoreAfterActual", "bestMove", "bestScore", "pv"}
        self.assertTrue(all(required <= item.keys() for item in analysis["moveAnalyses"]))

    def test_every_catalog_game_remains_compatible(self) -> None:
        catalog = json.loads((ROOT / "games" / "index.json").read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(catalog["games"]), 1)
        for entry in catalog["games"]:
            with self.subTest(game=entry["id"]):
                game = json.loads((ROOT / entry["gameData"]).read_text(encoding="utf-8"))
                analysis = json.loads((ROOT / entry["analysisData"]).read_text(encoding="utf-8"))
                move_count = game["game"]["moves"]
                self.assertEqual(len(game["positions"]), move_count + 1)
                self.assertIn(analysis.get("schemaVersion", 1), (1, 2))
                if analysis.get("schemaVersion") == 2:
                    self.assertEqual(len(analysis["evaluations"]), move_count + 1)
                    self.assertEqual(len(analysis["moveAnalyses"]), move_count)
                else:
                    plies = [item["ply"] for item in analysis["evaluations"]]
                    self.assertEqual(plies, sorted(plies))
                    self.assertTrue(plies and 0 <= plies[-1] <= move_count)


if __name__ == "__main__":
    unittest.main()
