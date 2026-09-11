from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from analyze_with_suisho5 import build_analysis_metrics  # noqa: E402
from report_analysis_metrics import (  # noqa: E402
    aggregate_metrics,
    load_metrics,
    pv_improvement_judgment,
    time_increase_judgment,
)


def refinement(*, elapsed: float = 0.0, short: int = 0, executed: int = 0,
               before: list[int] | None = None, after: list[int] | None = None,
               improved: int = 0, unchanged: int = 0) -> dict:
    before = before or []
    after = after or []
    return {
        "elapsedSeconds": elapsed,
        "shortPvCandidates": short,
        "extraSearchExecuted": executed,
        "pvLengthBeforeAverage": sum(before) / len(before) if before else None,
        "pvLengthAfterAverage": sum(after) / len(after) if after else None,
        "pvLengthsBefore": before,
        "pvLengthsAfter": after,
        "improvedPvCount": improved,
        "unchangedPvCount": unchanged,
    }


class AnalysisMetricsTests(unittest.TestCase):
    def test_metrics_generation_without_extra_search(self) -> None:
        metrics = build_analysis_metrics(
            "game-a", 59, 0, 6.25, refinement(), "2026-09-11T00:00:00Z")
        self.assertEqual(metrics["gameId"], "game-a")
        self.assertEqual(metrics["positions"], 59)
        self.assertEqual(metrics["extraPvSearchSeconds"], 0.0)
        self.assertEqual(metrics["totalAnalysisSeconds"], 6.25)
        self.assertEqual(metrics["extraSearchExecuted"], 0)
        serialized = json.dumps(metrics)
        for forbidden in ("workerUrl", "secret", "enginePath", "evalDir", "localPath"):
            self.assertNotIn(forbidden, serialized)

    def test_metrics_generation_with_improved_and_unchanged_pvs(self) -> None:
        metrics = build_analysis_metrics(
            "game-b", 63, 6, 6.305,
            refinement(elapsed=0.925, short=2, executed=2,
                       before=[2, 1], after=[11, 1], improved=1, unchanged=1),
            "2026-09-11T00:00:00Z",
        )
        self.assertEqual(metrics["totalAnalysisSeconds"], 7.23)
        self.assertEqual(metrics["pvLengthBeforeAverage"], 1.5)
        self.assertEqual(metrics["pvLengthAfterAverage"], 6.0)
        self.assertEqual(metrics["improvedPvCount"], 1)
        self.assertEqual(metrics["unchangedPvCount"], 1)

    def test_metrics_files_and_aggregate(self) -> None:
        records = [
            build_analysis_metrics("a", 50, 2, 10, refinement(), "2026-09-11T00:00:00Z"),
            build_analysis_metrics(
                "b", 70, 3, 20,
                refinement(elapsed=5, short=2, executed=2,
                           before=[1, 2], after=[4, 2], improved=1, unchanged=1),
                "2026-09-11T00:00:01Z",
            ),
        ]
        with tempfile.TemporaryDirectory() as directory:
            metrics_dir = Path(directory)
            for record in records:
                (metrics_dir / f"{record['gameId']}.json").write_text(
                    json.dumps(record), encoding="utf-8")
            loaded = load_metrics(metrics_dir)
        report = aggregate_metrics(loaded)
        self.assertEqual(report["analyzedGames"], 2)
        self.assertEqual(report["analysisSecondsAverage"], 17.5)
        self.assertEqual(report["extraPvSearchSecondsAverage"], 2.5)
        self.assertEqual(report["increaseRateAverage"], 12.5)
        self.assertEqual(report["shortPvRate"], 20.0)
        self.assertEqual(report["extraSearchExecutionRate"], 100.0)
        self.assertEqual(report["pvImprovementRate"], 50.0)
        self.assertEqual(report["pvLengthBeforeMedian"], 1.5)
        self.assertEqual(report["pvLengthAfterMedian"], 3.0)
        self.assertFalse(report["enoughForReevaluation"])
        self.assertEqual(report["gamesNeededForReevaluation"], 8)

    def test_reference_judgment_boundaries(self) -> None:
        self.assertEqual(time_increase_judgment(25), "良好")
        self.assertEqual(time_increase_judgment(25.1), "要観察")
        self.assertEqual(time_increase_judgment(50), "条件再検討")
        self.assertEqual(pv_improvement_judgment(70), "良好")
        self.assertEqual(pv_improvement_judgment(40), "要観察")
        self.assertEqual(pv_improvement_judgment(39.9), "追加探索方式再検討")

    def test_schema_one_without_optional_length_arrays_remains_readable(self) -> None:
        old = build_analysis_metrics("old", 10, 0, 1, refinement(), "2026-09-11T00:00:00Z")
        old.pop("pvLengthsBefore")
        old.pop("pvLengthsAfter")
        report = aggregate_metrics([old])
        self.assertIsNone(report["pvLengthBeforeAverage"])
        self.assertEqual(report["analyzedGames"], 1)


if __name__ == "__main__":
    unittest.main()
