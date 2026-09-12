#!/usr/bin/env python3
"""Run the D1 pilot experiment against Phase C exported rows."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from export_skill_calibration import collect
from skill_calibration import experiment


PILOT_EXCLUDED_GAME_IDS = {"20260912_shuty005"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--all-current", action="store_true", help="include post-audit games")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    rows, _ = collect(args.root.resolve())
    if not args.all_current:
        rows = [row for row in rows if row["game_id"] not in PILOT_EXCLUDED_GAME_IDS]
    result = experiment(rows)
    rendered = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(rendered, encoding="utf-8")
    print(rendered, end="")


if __name__ == "__main__":
    main()
