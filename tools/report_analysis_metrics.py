#!/usr/bin/env python3
"""Aggregate secret-free per-game analysis quality metrics."""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def percent(numerator: float, denominator: float) -> float | None:
    return round(numerator / denominator * 100, 1) if denominator else None


def mean(values: list[float]) -> float | None:
    return round(statistics.mean(values), 3) if values else None


def median(values: list[float]) -> float | None:
    return round(statistics.median(values), 3) if values else None


def time_increase_judgment(value: float | None) -> str:
    if value is None:
        return "データなし"
    if value <= 25:
        return "良好"
    if value < 50:
        return "要観察"
    return "条件再検討"


def pv_improvement_judgment(value: float | None) -> str:
    if value is None:
        return "データなし"
    if value >= 70:
        return "良好"
    if value >= 40:
        return "要観察"
    return "追加探索方式再検討"


def load_metrics(metrics_dir: Path) -> list[dict]:
    records = []
    for path in sorted(metrics_dir.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("schemaVersion") != 1 or not data.get("gameId"):
            raise ValueError(f"unsupported metrics JSON: {path.name}")
        records.append(data)
    return records


def aggregate_metrics(records: list[dict]) -> dict:
    base = [float(item["baseAnalysisSeconds"]) for item in records]
    extra = [float(item["extraPvSearchSeconds"]) for item in records]
    total = [float(item["totalAnalysisSeconds"]) for item in records]
    increases = [rate for item in records if (rate := percent(
        float(item["extraPvSearchSeconds"]), float(item["baseAnalysisSeconds"]))) is not None]
    problems = sum(int(item["problemPositions"]) for item in records)
    short = sum(int(item["shortPvCandidates"]) for item in records)
    executed = sum(int(item["extraSearchExecuted"]) for item in records)
    improved = sum(int(item["improvedPvCount"]) for item in records)
    before_lengths = [int(value) for item in records for value in item.get("pvLengthsBefore", [])]
    after_lengths = [int(value) for item in records for value in item.get("pvLengthsAfter", [])]
    average_increase = mean(increases)
    improvement_rate = percent(improved, executed)
    return {
        "analyzedGames": len(records),
        "analysisSecondsAverage": mean(total),
        "analysisSecondsMedian": median(total),
        "extraPvSearchSecondsAverage": mean(extra),
        "extraPvSearchSecondsMedian": median(extra),
        "increaseRateAverage": average_increase,
        "increaseRateMedian": median(increases),
        "problemPositions": problems,
        "shortPvRate": percent(short, problems * 2),
        "extraSearchExecutionRate": percent(executed, short),
        "pvImprovementRate": improvement_rate,
        "pvLengthBeforeAverage": mean(before_lengths),
        "pvLengthBeforeMedian": median(before_lengths),
        "pvLengthAfterAverage": mean(after_lengths),
        "pvLengthAfterMedian": median(after_lengths),
        "timeIncreaseJudgment": time_increase_judgment(average_increase),
        "pvImprovementJudgment": pv_improvement_judgment(improvement_rate),
        "enoughForReevaluation": len(records) >= 10,
        "gamesNeededForReevaluation": max(0, 10 - len(records)),
    }


def display(value: object, suffix: str = "") -> str:
    return "データなし" if value is None else f"{value}{suffix}"


def print_report(report: dict) -> None:
    print(f"解析対局数: {report['analyzedGames']}")
    print(f"平均解析時間: {display(report['analysisSecondsAverage'], '秒')}")
    print(f"解析時間中央値: {display(report['analysisSecondsMedian'], '秒')}")
    print(f"追加探索平均時間: {display(report['extraPvSearchSecondsAverage'], '秒')}")
    print(f"追加探索中央値: {display(report['extraPvSearchSecondsMedian'], '秒')}")
    print(f"平均増加率: {display(report['increaseRateAverage'], '%')} ({report['timeIncreaseJudgment']})")
    print(f"課題局面数: {report['problemPositions']}")
    print(f"short PV率: {display(report['shortPvRate'], '%')}")
    print(f"追加探索実行率: {display(report['extraSearchExecutionRate'], '%')}")
    print(f"PV改善率: {display(report['pvImprovementRate'], '%')} ({report['pvImprovementJudgment']})")
    print(
        "PV長 Before: "
        f"平均 {display(report['pvLengthBeforeAverage'], '手')} / "
        f"中央値 {display(report['pvLengthBeforeMedian'], '手')}"
    )
    print(
        "PV長 After: "
        f"平均 {display(report['pvLengthAfterAverage'], '手')} / "
        f"中央値 {display(report['pvLengthAfterMedian'], '手')}"
    )
    if report["enoughForReevaluation"]:
        print("再評価データ: 10局以上（条件見直しを検討可能）")
    else:
        print(f"再評価データ: 蓄積中（あと{report['gamesNeededForReevaluation']}局）")
    print("注意: この判定は参考情報であり、解析条件を自動変更しません。")


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metrics-dir", type=Path, default=ROOT / "analysis" / "metrics")
    parser.add_argument("--json", action="store_true", help="集計結果をJSONで出力")
    args = parser.parse_args()
    report = aggregate_metrics(load_metrics(args.metrics_dir))
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print_report(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
