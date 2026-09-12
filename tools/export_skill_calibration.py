#!/usr/bin/env python3
"""Export one privacy-conscious calibration row per player-game."""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

from skill_estimation import calibration_row, extract_game


def collect(root: Path) -> tuple[list[dict], list[dict]]:
    catalog = json.loads((root / "games" / "index.json").read_text(encoding="utf-8"))
    rows, derived_games = [], []
    for item in catalog["games"]:
        analysis_path = root / item["analysisData"]
        game_path = root / item["gameData"]
        kif_path = root / item["kif"] if item.get("kif") else None
        derived = extract_game(analysis_path, game_path, kif_path)
        derived_games.append(derived)
        rows.extend(calibration_row(derived, player_game) for player_game in derived["player_games"])
    return rows, derived_games


def write_csv(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = list(rows[0]) if rows else []
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--derived-json", type=Path)
    args = parser.parse_args()
    rows, games = collect(args.root.resolve())
    write_csv(args.out, rows)
    if args.derived_json:
        args.derived_json.parent.mkdir(parents=True, exist_ok=True)
        args.derived_json.write_text(json.dumps(games, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"playerGames": len(rows), "games": len(games), "output": str(args.out)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
