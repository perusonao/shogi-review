#!/usr/bin/env python3
"""Build, validate and report the Phase D2 calibration dataset."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from export_skill_calibration import collect
from run_skill_calibration import PILOT_EXCLUDED_GAME_IDS
from skill_dataset import (
    build_dataset, checkpoint_audit, dataset_dashboard, load_rows, write_json_atomic,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Phase D2 legal dataset registry (no scraping)")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--additional", type=Path, action="append", default=[],
                        help="flat JSON/JSONL or a validated v2 dataset")
    parser.add_argument("--d1-fixed", action="store_true",
                        help="use the historical D1 50-row/16-label snapshot instead of latest main")
    parser.add_argument("--dataset-out", type=Path)
    parser.add_argument("--report-out", type=Path)
    parser.add_argument("--checkpoint-audit-out", type=Path)
    args = parser.parse_args()

    rows, _ = collect(args.root.resolve())
    if args.d1_fixed:
        rows = [row for row in rows if row["game_id"] not in PILOT_EXCLUDED_GAME_IDS]
    for path in args.additional:
        rows.extend(load_rows(path.resolve()))
    dataset = build_dataset(rows, default_route="existing-kif")
    report = dataset_dashboard(dataset)
    audit = checkpoint_audit(dataset)
    output = {"validation": {"valid": True}, "dashboard": report, "checkpoint_audit": audit}
    if args.dataset_out:
        write_json_atomic(args.dataset_out.resolve(), dataset)
    if args.report_out:
        write_json_atomic(args.report_out.resolve(), report)
    if args.checkpoint_audit_out and audit["generated"]:
        write_json_atomic(args.checkpoint_audit_out.resolve(), audit)
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
