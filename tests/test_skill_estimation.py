from __future__ import annotations

import copy
import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from export_skill_calibration import collect, write_csv
from skill_estimation import (
    CALIBRATION_STATUS, PROVISIONAL_WEIGHTS, calibration_row, confidence_for_sample, extract_game,
    extract_moves, normalize_official_rank, normalize_time_control,
    phase_for_ply, score_players, stable_player_id,
)


def metadata():
    return {
        "game_id": "fixture", "players": [
            {"player_id": "p-s", "side": "sente", "result": "loss"},
            {"player_id": "p-g", "side": "gote", "result": "win"},
        ]
    }


def game(moves=4):
    positions = [{"ply": 0, "sfen": "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1"}]
    usis = ["7g7f", "3c3d", "2g2f", "8c8d"]
    try:
        import shogi
        board = shogi.Board()
        for ply, usi in enumerate(usis[:moves], 1):
            board.push_usi(usi)
            positions.append({"ply": ply, "sfen": board.sfen(), "usi": usi})
    except ImportError:
        positions = []
    return {"game": {"id": "fixture", "moves": moves}, "positions": positions}


class PhaseTests(unittest.TestCase):
    def test_boundaries(self):
        self.assertEqual(phase_for_ply(34, 100), "opening")
        self.assertEqual(phase_for_ply(35, 100), "middlegame")
        self.assertEqual(phase_for_ply(74, 100), "middlegame")
        self.assertEqual(phase_for_ply(75, 100), "endgame")

    def test_short_game(self):
        self.assertEqual(phase_for_ply(1, 2), "middlegame")
        self.assertEqual(phase_for_ply(2, 2), "endgame")
        self.assertEqual(phase_for_ply(0, 0), "opening")


class NormalizationTests(unittest.TestCase):
    def test_stable_player_id(self):
        first, status = stable_player_id("将棋ウォーズ", " ＳonaO81 ")
        second, _ = stable_player_id("shogi-wars", "sonao81")
        other, _ = stable_player_id("other", "sonao81")
        self.assertEqual(first, second)
        self.assertNotEqual(first, other)
        self.assertEqual(status, "stable")

    def test_official_rank(self):
        self.assertEqual(normalize_official_rank("2級"), {"rank_type": "kyu", "rank_number": 2, "rank_order": 8})
        self.assertEqual(normalize_official_rank("初段"), {"rank_type": "dan", "rank_number": 1, "rank_order": 10})
        self.assertIsNone(normalize_official_rank(None))

    def test_time_control(self):
        self.assertEqual(normalize_time_control("10分切れ負け")["id"], "10m-sudden-death")
        self.assertEqual(normalize_time_control("3分切れ負け")["main_time_seconds"], 180)
        self.assertEqual(normalize_time_control("10秒")["per_move_seconds"], 10)
        self.assertEqual(normalize_time_control("10分+30秒")["id"], "10m-30s-byoyomi")
        self.assertIsNone(normalize_time_control(None))


class ExtractorTests(unittest.TestCase):
    def test_material_event_major_loss_and_shadow_signals(self):
        import shogi
        board = shogi.Board()
        positions = [{"ply": 0, "sfen": board.sfen()}]
        for ply, usi in enumerate(("7g7f", "3c3d", "8h2b+"), 1):
            board.push_usi(usi)
            positions.append({"ply": ply, "sfen": board.sfen(), "usi": usi})
        fixture_game = {"game": {"id": "fixture", "moves": 3}, "positions": positions}
        analysis = {"schemaVersion": 1, "moves": 3, "evaluations": [
            {"ply": 0, "cp": 0}, {"ply": 1, "cp": 0}, {"ply": 2, "cp": 0}, {"ply": 3, "cp": 0}
        ]}
        row = extract_moves(analysis, fixture_game, metadata())[2]
        self.assertEqual(row["material_event"]["captured_piece"], "bishop")
        self.assertTrue(row["major_piece_loss"])
        self.assertEqual(row["material_event"]["captured_player_side"], "gote")
        self.assertTrue(row["phase_signals"]["first_capture"])
        self.assertTrue(row["phase_signals"]["promotion"])

    def test_schema_v1_sente_and_gote_score_normalization(self):
        analysis = {"schemaVersion": 1, "moves": 2, "evaluations": [
            {"ply": 0, "cp": 100}, {"ply": 1, "cp": -50}, {"ply": 2, "cp": 200}
        ]}
        rows = extract_moves(analysis, game(2), metadata())
        self.assertEqual(rows[0]["side"], "sente")
        self.assertEqual(rows[0]["score_before"]["value"], 100)
        self.assertEqual(rows[0]["score_after"]["value"], -50)
        self.assertEqual(rows[0]["cpl"], 150)
        self.assertEqual(rows[1]["side"], "gote")
        self.assertEqual(rows[1]["score_before"]["value"], 50)
        self.assertEqual(rows[1]["score_after"]["value"], -200)
        self.assertEqual(rows[1]["cpl"], 250)
        self.assertIsNone(rows[0]["best_move_match"])
        self.assertEqual(rows[0]["mate_feature_status"], "unavailable")

    def test_schema_v1_extreme_is_unavailable_not_mate(self):
        analysis = {"schemaVersion": 1, "moves": 1, "evaluations": [
            {"ply": 0, "cp": 0}, {"ply": 1, "cp": 29999}
        ]}
        row = extract_moves(analysis, game(1), metadata())[0]
        self.assertEqual(row["score_after"]["type"], "unavailable")
        self.assertIsNone(row["mate_event"])
        self.assertIsNone(row["cpl"])

    def test_schema_v2_best_move_and_typed_mate(self):
        analysis = {"schemaVersion": 2, "moves": 2, "moveAnalyses": [
            {"ply": 1, "scoreBefore": {"type": "mate", "value": 3},
             "scoreAfterActual": {"type": "cp", "value": 20}, "actualMove": "7g7f", "bestMove": "2g2f"},
            {"ply": 2, "scoreBefore": {"type": "cp", "value": 10},
             "scoreAfterActual": {"type": "mate", "value": -2}, "actualMove": "3c3d"},
        ]}
        rows = extract_moves(analysis, game(2), metadata())
        self.assertEqual(rows[0]["mate_event"], "missed")
        self.assertIsNone(rows[0]["cpl"])
        self.assertFalse(rows[0]["best_move_match"])
        self.assertEqual(rows[1]["mate_event"], "allowed")
        self.assertIsNone(rows[1]["best_move_match"])

    def test_missing_mate_and_best_move_are_not_zero(self):
        analysis = {"schemaVersion": 2, "moves": 1, "moveAnalyses": [
            {"ply": 1, "scoreBefore": {"type": "cp", "value": 10},
             "scoreAfterActual": {"type": "cp", "value": 5}, "actualMove": "7g7f"}
        ]}
        derived = score_players(extract_moves(analysis, game(1), metadata()), metadata())[0]["scores"]["overall"]
        self.assertIsNone(derived["components"]["best_move_match"])
        self.assertGreater(derived["components"]["mate_safety"], 0)
        self.assertLess(derived["coverage"], 1)

    def test_same_logic_both_sides(self):
        analysis = {"schemaVersion": 1, "moves": 4, "evaluations": [
            {"ply": 0, "cp": 0}, {"ply": 1, "cp": -100}, {"ply": 2, "cp": 0},
            {"ply": 3, "cp": -100}, {"ply": 4, "cp": 0},
        ]}
        scores = score_players(extract_moves(analysis, game(4), metadata()), metadata())
        self.assertEqual(scores[0]["scores"]["overall"]["raw_score"], scores[1]["scores"]["overall"]["raw_score"])

    def test_winner_does_not_enter_score(self):
        analysis = {"schemaVersion": 1, "moves": 2, "evaluations": [
            {"ply": 0, "cp": 0}, {"ply": 1, "cp": -50}, {"ply": 2, "cp": 0}
        ]}
        before = score_players(extract_moves(analysis, game(2), metadata()), metadata())
        swapped = copy.deepcopy(metadata())
        swapped["players"][0]["result"], swapped["players"][1]["result"] = "win", "loss"
        after = score_players(extract_moves(analysis, game(2), swapped), swapped)
        self.assertEqual([x["scores"] for x in before], [x["scores"] for x in after])

    def test_coverage_and_confidence(self):
        analysis = {"schemaVersion": 1, "moves": 2, "evaluations": [
            {"ply": 0, "cp": 0}, {"ply": 1, "cp": 0}, {"ply": 2, "cp": 0}
        ]}
        score = score_players(extract_moves(analysis, game(2), metadata()), metadata())[0]["scores"]["overall"]
        self.assertGreater(score["coverage"], 0)
        self.assertLess(score["coverage"], 1)
        self.assertEqual(score["confidence"]["level"], "low")
        self.assertNotEqual(score["confidence"]["level"], "high")
        self.assertEqual(confidence_for_sample(300, 0.95, 100, game_count=20)["level"], "high")
        self.assertEqual(confidence_for_sample(300, 0.95, 100, game_count=1)["level"], "medium")


class RepositoryIntegrationTests(unittest.TestCase):
    def test_current_catalog_and_calibration_export(self):
        rows, games = collect(ROOT)
        catalog = json.loads((ROOT / "games" / "index.json").read_text(encoding="utf-8"))
        self.assertEqual(len(games), len(catalog["games"]))
        self.assertEqual(len(rows), len(games) * 2)
        self.assertTrue(all(row["calibration_status"] == CALIBRATION_STATUS for row in rows))
        self.assertTrue(all("display_name" not in row for row in rows))
        self.assertTrue(all("overall_raw_score" in row and "endgame_coverage" in row for row in rows))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "calibration.csv"
            write_csv(path, rows)
            with path.open(encoding="utf-8", newline="") as stream:
                exported = list(csv.DictReader(stream))
            self.assertEqual(len(exported), len(rows))

    def test_real_schema_v1_and_v2_both_players(self):
        catalog = json.loads((ROOT / "games" / "index.json").read_text(encoding="utf-8"))
        seen = set()
        for item in catalog["games"]:
            analysis = json.loads((ROOT / item["analysisData"]).read_text(encoding="utf-8"))
            version = analysis.get("schemaVersion", 1)
            if version in seen:
                continue
            derived = extract_game(ROOT / item["analysisData"], ROOT / item["gameData"], ROOT / item["kif"] if item.get("kif") else None)
            self.assertEqual({row["side"] for row in derived["player_games"]}, {"sente", "gote"})
            seen.add(version)
        self.assertEqual(seen, {1, 2})

    def test_provisional_weights_are_versioned_and_sum_to_one(self):
        self.assertAlmostEqual(sum(PROVISIONAL_WEIGHTS.values()), 1.0)


if __name__ == "__main__":
    unittest.main()
