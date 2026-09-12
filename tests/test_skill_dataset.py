from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from export_skill_calibration import collect
from run_skill_calibration import PILOT_EXCLUDED_GAME_IDS
from skill_calibration import DatasetValidationError, nested_group_validation
from skill_dataset import (
    DATASET_SCHEMA_VERSION, build_dataset, checkpoint_audit, dataset_dashboard,
    pilot_rows, validate_dataset, validate_labeled_rows,
)
from skill_estimation import stable_player_id


def row(player_name="p1", game="g1", rank="1級", score=70.0,
        provider="shogi-wars", time_control="10m-sudden-death", side="sente", result="win"):
    player_id, _ = stable_player_id(provider, player_name)
    output = {
        "game_id": game, "player_id": player_id, "provider": provider,
        "time_control": time_control, "official_rank": rank,
        "official_rank_order": {"2級": 8, "1級": 9, "初段": 10}.get(rank),
        "side": side, "result": result, "analysis_schema_version": 2,
        "feature_version": "player-game-features-v1", "score_version": "raw-skill-provisional-v1",
        "collection_route": "user-provided-kif",
    }
    for group in ("overall", "opening", "middlegame", "endgame"):
        output.update({
            f"{group}_raw_score": score, f"{group}_coverage": .9,
            f"{group}_eligible_moves": 20, f"{group}_cpl_mean": 50,
            f"{group}_cpl_p75": 70, f"{group}_critical_loss_frequency": .1,
            f"{group}_best_move_match_rate": .3, f"{group}_major_piece_losses": 0,
        })
    return output


class DatasetIdentityTests(unittest.TestCase):
    def test_duplicate_game_registry_entry_is_rejected(self):
        dataset = build_dataset([row()])
        dataset["games"].append(copy.deepcopy(dataset["games"][0]))
        with self.assertRaisesRegex(DatasetValidationError, "duplicate game"):
            validate_dataset(dataset)

    def test_duplicate_player_game_is_rejected(self):
        with self.assertRaisesRegex(DatasetValidationError, "duplicate player-game"):
            build_dataset([row(), copy.deepcopy(row())])

    def test_two_sides_share_one_game_but_are_distinct_player_games(self):
        dataset = build_dataset([
            row("p1", side="sente", result="win"),
            row("p2", rank="初段", side="gote", result="loss"),
        ])
        self.assertEqual(len(dataset["games"]), 1)
        self.assertEqual(len(dataset["player_games"]), 2)

    def test_stable_player_id_is_provider_scoped(self):
        first, first_status = stable_player_id("将棋ウォーズ", " Player 1 ")
        same, _ = stable_player_id("shogi-wars", "player1")
        other, _ = stable_player_id("other", "player1")
        self.assertEqual(first_status, "stable")
        self.assertEqual(first, same)
        self.assertNotEqual(first, other)
        bad = row()
        bad["player_id"] = "display-name"
        with self.assertRaisesRegex(DatasetValidationError, "stable opaque"):
            build_dataset([bad])

    def test_display_name_is_validated_then_not_persisted(self):
        supplied = row(player_name="Player 1")
        supplied["display_name"] = " Player 1 "
        dataset = build_dataset([supplied])
        self.assertNotIn("display_name", dataset["player_games"][0])
        broken = copy.deepcopy(supplied)
        broken["display_name"] = "different-player"
        with self.assertRaisesRegex(DatasetValidationError, "normalized display_name"):
            build_dataset([broken])


class CohortAndDashboardTests(unittest.TestCase):
    def test_rank_and_time_control_normalization_and_pilot_filter(self):
        normalized = row(rank="１級", time_control="10分切れ負け")
        excluded_time = row("p2", "g2", time_control="3分切れ負け")
        excluded_rank = row("p3", "g3", rank="3級")
        excluded_rank["official_rank_order"] = 7
        dataset = build_dataset([normalized, excluded_time, excluded_rank])
        pilot = pilot_rows(dataset["player_games"])
        self.assertEqual(len(pilot), 1)
        self.assertEqual(pilot[0]["official_rank"], "1級")
        self.assertEqual(pilot[0]["time_control"], "10m-sudden-death")

    def test_missing_metadata_is_kept_out_of_training_and_reported(self):
        incomplete = row()
        incomplete["official_rank"] = None
        incomplete["official_rank_order"] = None
        dataset = build_dataset([incomplete])
        self.assertEqual(pilot_rows(dataset["player_games"]), [])
        with self.assertRaisesRegex(DatasetValidationError, "missing metadata official_rank"):
            validate_labeled_rows(dataset["player_games"])

    def test_unknown_rank_is_preserved_but_never_enters_pilot(self):
        unknown = row(rank="unknown")
        unknown["official_rank_order"] = None
        dataset = build_dataset([unknown])
        stored = dataset["player_games"][0]
        self.assertEqual(stored["official_rank_raw"], "unknown")
        self.assertIsNone(stored["official_rank_normalized"])
        self.assertEqual(pilot_rows(dataset["player_games"]), [])

    def test_schema_side_result_and_coverage_aggregation(self):
        first = row("p1", "g1", "2級", 60, side="sente", result="loss")
        first["analysis_schema_version"] = 1
        second = row("p2", "g2", "2級", 65, side="gote", result="win")
        second["overall_coverage"] = .5
        report = dataset_dashboard(build_dataset([first, second]))["pilot_cohort"]["by_rank"]["2級"]
        self.assertEqual(report["schema"], {"v1": 1, "v2": 1})
        self.assertEqual(report["side"], {"gote": 1, "sente": 1})
        self.assertEqual(report["result"], {"loss": 1, "win": 1})
        self.assertEqual(report["coverage"]["overall"]["mean"], .7)

    def test_repository_snapshot_has_50_rows_and_16_pilot_labels(self):
        rows, _ = collect(ROOT)
        rows = [item for item in rows if item["game_id"] not in PILOT_EXCLUDED_GAME_IDS]
        report = dataset_dashboard(build_dataset(rows, default_route="existing-kif"))
        self.assertEqual(report["all_data"]["player_games"], 50)
        self.assertEqual(report["pilot_cohort"]["player_games"], 16)
        self.assertEqual(report["pilot_cohort"]["unique_users"], 9)
        self.assertEqual(report["pilot_cohort"]["stages"]["stage_1"]["total_shortage"], 74)

    def test_latest_main_counts_are_default_growth_baseline(self):
        rows, _ = collect(ROOT)
        report = dataset_dashboard(build_dataset(rows, default_route="existing-kif"))
        self.assertEqual(report["all_data"]["player_games"], 52)
        self.assertEqual(report["pilot_cohort"]["player_games"], 18)
        self.assertEqual(report["pilot_cohort"]["unique_users"], 10)
        self.assertEqual(report["pilot_cohort"]["by_rank"]["2級"]["player_games"], 2)
        self.assertEqual(report["pilot_cohort"]["by_rank"]["1級"]["player_games"], 5)
        self.assertEqual(report["pilot_cohort"]["by_rank"]["初段"]["player_games"], 11)
        self.assertEqual(report["pilot_cohort"]["stages"]["stage_1"]["total_shortage"], 72)
        self.assertEqual(report["all_data"]["non_pilot_player_games_preserved"], 34)
        self.assertIn("missing", report["all_data"]["summary"])


class NestedCheckpointTests(unittest.TestCase):
    def _stage_one_rows(self):
        rows = []
        for rank_index, (rank, base) in enumerate((("2級", 55), ("1級", 70), ("初段", 85))):
            for user_index in range(2):
                for game_index in range(15):
                    rows.append(row(
                        f"r{rank_index}u{user_index}", f"r{rank_index}u{user_index}g{game_index}",
                        rank, base + user_index + game_index / 100,
                        side="sente" if game_index % 2 == 0 else "gote",
                        result="win" if game_index % 2 == 0 else "loss",
                    ))
        return rows

    def test_nested_groups_never_expose_outer_test_user_to_inner_selection(self):
        rows = self._stage_one_rows()
        result = nested_group_validation(rows)
        self.assertTrue(result["outer_user_disjoint"])
        self.assertFalse(result["test_user_used_for_selection"])
        for fold in result["fold_audit"]:
            test = set(fold["outer_test_users"])
            for inner in fold["inner_folds"]:
                self.assertFalse(test & (set(inner["train_users"]) | set(inner["validation_users"])))

    def test_stage_one_count_triggers_audit_but_not_production(self):
        dataset = build_dataset(self._stage_one_rows())
        dashboard = dataset_dashboard(dataset)
        self.assertTrue(dashboard["pilot_cohort"]["stages"]["stage_1"]["complete"])
        self.assertFalse(dashboard["pilot_cohort"]["stages"]["stage_2"]["complete"])
        audit = checkpoint_audit(dataset)
        self.assertTrue(audit["generated"])
        self.assertFalse(audit["production_unlocked"])
        self.assertIn("side_mae", audit["bias_audit"])
        self.assertIn("coverage_mae", audit["bias_audit"])
        self.assertIn("within_player_winner_minus_loser", audit["bias_audit"])
        self.assertEqual(set(audit["phase_audit"]), {"overall", "opening", "middlegame", "endgame"})


if __name__ == "__main__":
    unittest.main()
