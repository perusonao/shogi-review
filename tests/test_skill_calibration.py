from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from export_skill_calibration import collect
from skill_calibration import (
    DatasetValidationError, MODEL_FEATURES, OrdinalRidge, aggregate_rows,
    calibration_confidence, estimability, evaluation_metrics, experiment,
    labeled_pilot_rows, leave_one_user_out, validate_rows,
)


def row(player="p1", game="g1", rank="1級", order=9, score=70.0):
    result = {
        "game_id": game, "player_id": player, "provider": "shogi-wars",
        "time_control": "10m-sudden-death", "official_rank": rank,
        "official_rank_order": order, "side": "sente", "result": "win",
        "feature_version": "player-game-features-v1", "score_version": "raw-skill-provisional-v1",
    }
    for group in ("overall", "opening", "middlegame", "endgame"):
        result.update({f"{group}_raw_score": score, f"{group}_coverage": 0.9,
                       f"{group}_eligible_moves": 20, f"{group}_cpl_mean": 50,
                       f"{group}_cpl_p75": 70, f"{group}_critical_loss_frequency": 0.1,
                       f"{group}_best_move_match_rate": 0.3, f"{group}_major_piece_losses": 0})
    return result


class DatasetTests(unittest.TestCase):
    def test_user_disjoint_and_same_player_leakage_forbidden(self):
        rows = [row("p1", "g1"), row("p1", "g2"), row("p2", "g3"), row("p3", "g4")]
        folds = leave_one_user_out(rows)
        self.assertEqual(len(folds), 3)
        for train, test in folds:
            self.assertFalse({rows[i]["player_id"] for i in train} & {rows[i]["player_id"] for i in test})

    def test_missing_and_unknown_rank(self):
        missing = row()
        missing["official_rank"] = None
        missing["official_rank_order"] = None
        validate_rows([missing])
        unknown = row(rank="unknown", order=None)
        with self.assertRaises(DatasetValidationError):
            validate_rows([unknown])

    def test_schema_compatibility_and_dataset_validation(self):
        rows = [row("p1", "g1"), row("p2", "g2")]
        self.assertEqual(validate_rows(rows)["rows"], 2)
        mixed = copy.deepcopy(rows)
        mixed[1]["score_version"] = "other"
        with self.assertRaises(DatasetValidationError):
            validate_rows(mixed)
        duplicate = [rows[0], copy.deepcopy(rows[0])]
        with self.assertRaises(DatasetValidationError):
            validate_rows(duplicate)

    def test_ordinal_rank_normalization_metrics(self):
        metrics = evaluation_metrics([8, 9, 10], [8, 10, 9])
        self.assertEqual(metrics["exact_accuracy"], 0.3333)
        self.assertEqual(metrics["within_one_accuracy"], 1.0)
        self.assertEqual(metrics["rank_mae"], 0.6667)


class GateAndRollingTests(unittest.TestCase):
    def test_phase_insufficient_data_and_coverage_gate(self):
        self.assertEqual(estimability("opening", 5, 0.9)["status"], "INSUFFICIENT_DATA")
        self.assertEqual(estimability("endgame", 20, 0.4)["status"], "INSUFFICIENT_DATA")
        self.assertEqual(estimability("middlegame", 20, 0.9, game_count=10)["status"], "ESTIMABLE")

    def test_single_game_confidence_never_high(self):
        confidence = calibration_confidence(training_users=500, training_rows=2000,
                                            eligible_moves=100, coverage=1.0,
                                            interval_width=0.1, ood=False, game_count=1)
        self.assertEqual(confidence["level"], "LOW")
        self.assertIn("single_game_high_forbidden", confidence["reasons"])
        rolling = calibration_confidence(training_users=9, training_rows=16,
                                         eligible_moves=500, coverage=1.0,
                                         interval_width=0.1, ood=False, game_count=30)
        self.assertEqual(rolling["level"], "LOW")

    def test_rolling_10_and_30_feature_first(self):
        history = [row("p1", f"g{i}", score=float(i)) for i in range(30)]
        ten = aggregate_rows(history, 10)
        thirty = aggregate_rows(history, 30)
        self.assertEqual(ten["estimate_kind"], "rolling_10")
        self.assertEqual(ten["game_count"], 10)
        self.assertAlmostEqual(ten["overall_raw_score"], 24.5)
        self.assertEqual(thirty["estimate_kind"], "rolling_30")
        self.assertEqual(thirty["overall_eligible_moves"], 600)


class ModelTests(unittest.TestCase):
    def test_winner_and_side_are_not_direct_features(self):
        for features in MODEL_FEATURES.values():
            self.assertNotIn("result", features)
            self.assertNotIn("side", features)
        with self.assertRaises(DatasetValidationError):
            OrdinalRidge(("overall_raw_score", "result"))

    def test_simple_ordinal_model(self):
        rows = [row(f"p{i}", f"g{i}", rank=rank, order=order, score=score)
                for i, (rank, order, score) in enumerate([
                    ("2級", 8, 50), ("2級", 8, 55), ("1級", 9, 65),
                    ("1級", 9, 70), ("初段", 10, 80), ("初段", 10, 85)])]
        result = experiment(rows)
        self.assertTrue(result["models"]["raw_score_only"]["user_disjoint"])
        self.assertEqual(result["cohort"]["unique_users"], 6)

    def test_repository_calibration_dataset(self):
        rows, _ = collect(ROOT)
        pilot = labeled_pilot_rows([r for r in rows if r["game_id"] != "20260912_shuty005"])
        validation = validate_rows(pilot)
        self.assertEqual(validation["rows"], 16)
        self.assertEqual(validation["unique_users"], 9)
        result = experiment(pilot)
        self.assertEqual(result["models"]["raw_score_only"]["folds"], 9)
        self.assertEqual(set(result["phase_models"]), {"overall", "opening", "middlegame", "endgame"})


if __name__ == "__main__":
    unittest.main()
