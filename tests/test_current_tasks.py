from __future__ import annotations

import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from current_tasks import build_current_tasks  # noqa: E402


def issue(ply: int, loss: int, *, best: str, best_ja: str, points: list[str]) -> dict:
    return {
        "ply": ply,
        "played": "7g7f",
        "best": best,
        "playedJa": "▲7六歩",
        "bestJa": best_ja,
        "lossCp": loss,
        "points": points,
    }


class CurrentTasksTests(unittest.TestCase):
    def test_generates_required_schema_deterministically(self) -> None:
        source = [
            issue(31, 420, best="5e5d", best_ja="▲5四金", points=["推奨手は歩を取る手です。"]),
            issue(45, 800, best="2g2f+", best_ja="▲2六飛成", points=["推奨手は飛を成る手です。", "推奨手は王手です。"]),
            issue(53, 600, best="N*7e", best_ja="▲7五桂打", points=[]),
        ]
        snapshot = copy.deepcopy(source)
        first = build_current_tasks("game-a", source)
        self.assertEqual(first, build_current_tasks("game-a", source))
        self.assertEqual(source, snapshot)
        self.assertEqual(len(first), 3)
        self.assertEqual([task["nextCheck"]["theme"] for task in first], ["check", "promotion", "drop"])
        for task in first:
            self.assertTrue({"id", "title", "nextCheck", "evidence", "sourceGame", "sourcePly"} <= task.keys())
            self.assertEqual(task["sourceGame"], "game-a")
            self.assertEqual(task["nextCheck"]["resultValues"], ["○", "×", "－"])
            self.assertEqual(task["nextCheck"]["observation"]["feature"], task["nextCheck"]["theme"])
            self.assertEqual(task["nextCheck"]["passWhen"], "opportunity-and-played-feature")
            self.assertEqual(task["nextCheck"]["failWhen"], "opportunity-and-verified-miss")
            self.assertIn(task["ranking"]["evidenceStrength"], {"HIGH", "MEDIUM"})

    def test_merges_same_theme_and_uses_strongest_evidence(self) -> None:
        tasks = build_current_tasks("game-a", [
            issue(20, 300, best="5e5d", best_ja="▲5四金", points=["推奨手は歩を取る手です。"]),
            issue(40, 900, best="4e4d", best_ja="▲4四銀", points=["推奨手は角を取る手です。"]),
        ])
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0]["sourcePly"], 40)
        self.assertEqual(tasks[0]["occurrences"], 2)

    def test_insufficient_or_indirect_evidence_yields_zero(self) -> None:
        self.assertEqual(build_current_tasks("game-a", []), [])
        tasks = build_current_tasks("game-a", [
            issue(20, 500, best="5e5d", best_ja="▲5四金", points=["読み筋の2手目は歩を取る手です。"]),
        ])
        self.assertEqual(tasks, [])

    def test_never_exceeds_three_and_ids_are_game_scoped(self) -> None:
        all_themes = [
            issue(10, 700, best="5e5d", best_ja="▲5四金", points=["推奨手は歩を取る手です。"]),
            issue(20, 600, best="2g2f+", best_ja="▲2六飛成", points=["推奨手は飛を成る手です。"]),
            issue(30, 500, best="N*7e", best_ja="▲7五桂打", points=[]),
            issue(40, 400, best="5e5d", best_ja="▲5四金", points=["推奨手は王手です。"]),
        ]
        first = build_current_tasks("game-a", all_themes)
        second = build_current_tasks("game-b", all_themes)
        self.assertEqual(len(first), 3)
        self.assertEqual(len({task["nextCheck"]["theme"] for task in first}), 3)
        self.assertTrue(set(task["id"] for task in first).isdisjoint(task["id"] for task in second))

    def test_current_catalog_is_safe_without_rewriting_existing_json(self) -> None:
        catalog = json.loads((ROOT / "games" / "index.json").read_text(encoding="utf-8"))
        for entry in catalog["games"]:
            if not entry.get("analyzed"):
                continue
            analysis_path = ROOT / entry["analysisData"]
            before = analysis_path.read_bytes()
            analysis = json.loads(before.decode("utf-8"))
            tasks = build_current_tasks(analysis["gameId"], analysis.get("verifiedIssues"))
            self.assertLessEqual(len(tasks), 3, entry["id"])
            self.assertEqual(len({task["nextCheck"]["theme"] for task in tasks}), len(tasks), entry["id"])
            for task in tasks:
                self.assertTrue({"id", "title", "nextCheck", "evidence", "sourceGame", "sourcePly"} <= task.keys())
            self.assertEqual(analysis_path.read_bytes(), before, entry["id"])


if __name__ == "__main__":
    unittest.main()
