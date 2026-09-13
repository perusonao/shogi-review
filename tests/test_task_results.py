from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from task_results import apply_task_cycle, evaluate_task_results, update_current_tasks  # noqa: E402
from import_new_games import Candidate, apply_task_cycles  # noqa: E402


DROP_SFEN = "4k4/9/9/9/9/9/9/9/4K4 b P 1"
PROMOTION_SFEN = "4k4/9/9/4P4/9/9/9/9/4K4 b - 1"
CAPTURE_SFEN = "4k4/9/4p4/9/4R4/9/9/9/4K4 b - 1"


def task(task_id: str, theme: str) -> dict:
    return {
        "id": task_id,
        "title": f"{theme} task",
        "nextCheck": {"schema": "current-task-check-v1", "theme": theme},
        "sourceGame": "game-a",
        "sourcePly": 7,
    }


def analysis(move_analyses: list[dict], issues: list[dict] | None = None) -> dict:
    return {
        "gameId": "game-b",
        "userSide": "sente",
        "moves": max((row["ply"] for row in move_analyses), default=0),
        "moveAnalyses": move_analyses,
        "verifiedIssues": issues or [],
        "currentTasks": [],
    }


class TaskResultTests(unittest.TestCase):
    def test_mixed_pass_fail_and_no_opportunity(self) -> None:
        previous = [task("drop", "drop"), task("promotion", "promotion"), task("capture", "capture")]
        moves = [
            {"ply": 1, "bestMove": "P*5e", "actualMove": "P*5e"},
            {"ply": 3, "bestMove": "5d5c+", "actualMove": "5d5c"},
        ]
        positions = [{"sfen": DROP_SFEN}, {}, {"sfen": PROMOTION_SFEN}]
        issues = [{"ply": 3, "best": "5d5c+", "played": "5d5c"}]
        results = evaluate_task_results(previous, analysis(moves, issues), positions)

        self.assertEqual([result["status"] for result in results], ["pass", "fail", "no_opportunity"])
        self.assertEqual([result["label"] for result in results], ["○", "×", "－"])
        self.assertEqual(results[0]["ply"], 1)
        self.assertEqual(results[1]["ply"], 3)
        self.assertIsNone(results[2]["ply"])
        for result in results[:2]:
            self.assertEqual(result["evidence"]["verification"], "legal-move-feature")
            self.assertNotIn("cp", str(result["evidence"]).lower())
        self.assertEqual(results[2]["reason"]["code"], "no_opportunity")

    def test_opportunity_without_verified_failure_is_insufficient(self) -> None:
        moves = [{"ply": 1, "bestMove": "5e5c", "actualMove": "5e4e"}]
        results = evaluate_task_results(
            [task("capture", "capture")], analysis(moves), [{"sfen": CAPTURE_SFEN}],
        )
        self.assertEqual(results[0]["status"], "no_opportunity")
        self.assertEqual(results[0]["label"], "－")
        self.assertEqual(results[0]["reason"]["code"], "insufficient_evidence")
        self.assertEqual(results[0]["ply"], 1)

    def test_retry_is_idempotent_and_duplicate_input_task_is_ignored(self) -> None:
        previous = [task("drop", "drop"), task("drop", "drop")]
        payload = analysis([{"ply": 1, "bestMove": "P*5e", "actualMove": "P*5e"}])
        positions = [{"sfen": DROP_SFEN}]
        first = evaluate_task_results(previous, payload, positions)
        second = evaluate_task_results(previous, payload, positions)
        self.assertEqual(first, second)
        self.assertEqual(len(first), 1)
        self.assertEqual(len({result["id"] for result in first}), 1)

    def test_update_prefers_failed_and_fresh_tasks_with_max_three_and_theme_dedupe(self) -> None:
        previous = [task("old-drop", "drop"), task("old-capture", "capture"), task("old-check", "check")]
        results = [
            {"taskId": "old-drop", "status": "fail"},
            {"taskId": "old-capture", "status": "pass"},
            {"taskId": "old-check", "status": "no_opportunity"},
        ]
        fresh = [task("new-capture", "capture"), task("new-promotion", "promotion"), task("new-drop", "drop")]
        updated = update_current_tasks(previous, results, fresh)
        self.assertEqual([item["id"] for item in updated], ["old-drop", "new-capture", "new-promotion"])
        self.assertEqual(len(updated), 3)
        self.assertEqual(len({item["nextCheck"]["theme"] for item in updated}), 3)

    def test_apply_cycle_is_safe_for_legacy_game_and_does_not_mutate_previous_tasks(self) -> None:
        previous = [task("old", "drop")]
        snapshot = copy.deepcopy(previous)
        legacy = {"gameId": "legacy", "currentTasks": []}
        game = {"positions": []}
        self.assertIs(apply_task_cycle(legacy, game, previous), legacy)
        self.assertEqual(previous, snapshot)
        self.assertEqual(legacy["taskResults"][0]["label"], "－")
        self.assertEqual(legacy["taskResults"][0]["reason"]["code"], "insufficient_evidence")
        self.assertLessEqual(len(legacy["currentTasks"]), 3)

    def test_import_pipeline_carries_latest_active_tasks_and_reprocessing_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "output"
            (root / "analysis").mkdir(parents=True)
            (output / "analysis").mkdir(parents=True)
            (output / "games").mkdir(parents=True)
            previous = [task("drop", "drop")]
            (root / "analysis" / "game-a.json").write_text(
                json.dumps({"currentTasks": previous}), encoding="utf-8")
            payload = analysis([{"ply": 1, "bestMove": "P*5e", "actualMove": "P*5e"}])
            payload["currentTasks"] = [task("fresh", "capture")]
            analysis_path = output / "analysis" / "game-b.json"
            analysis_path.write_text(json.dumps(payload), encoding="utf-8")
            (output / "games" / "game-b.json").write_text(
                json.dumps({"positions": [{"sfen": DROP_SFEN}]}), encoding="utf-8")
            candidate = Candidate(root / "game-b.kif", "game-b", {}, "fingerprint")
            catalog = {"games": [{"analyzed": True, "analysisData": "analysis/game-a.json"}]}

            apply_task_cycles(root, output, [candidate], catalog)
            first = analysis_path.read_text(encoding="utf-8")
            apply_task_cycles(root, output, [candidate], catalog)
            second = analysis_path.read_text(encoding="utf-8")

            self.assertEqual(first, second)
            saved = json.loads(second)
            self.assertEqual(saved["taskResults"][0]["label"], "○")
            self.assertEqual(saved["taskResults"][0]["gameId"], "game-b")
            self.assertEqual(len(saved["currentTasks"]), 2)


if __name__ == "__main__":
    unittest.main()
