#!/usr/bin/env python3
"""Audit Phase A-C extraction against the repository's read-only corpus."""
from __future__ import annotations

import argparse
import json
import statistics
from collections import Counter, defaultdict
from pathlib import Path

from skill_estimation import PHASES, PROVISIONAL_WEIGHTS, calibration_row, extract_game


AUDITED_25_EXCLUDED_FROM_CURRENT_MAIN = {"20260912_shuty005"}


def _average(values):
    values = [value for value in values if value is not None]
    return round(statistics.fmean(values), 4) if values else None


def audit(root: Path, exclude_ids: set[str] | None = None) -> dict:
    exclude_ids = exclude_ids or set()
    catalog = json.loads((root / "games" / "index.json").read_text(encoding="utf-8"))
    items = [item for item in catalog["games"] if item["id"] not in exclude_ids]
    failures, games, rows = [], [], []
    for item in items:
        try:
            derived = extract_game(
                root / item["analysisData"], root / item["gameData"],
                root / item["kif"] if item.get("kif") else None,
            )
            games.append(derived)
            rows.extend(calibration_row(derived, player_game) for player_game in derived["player_games"])
        except Exception as exc:  # audit must identify the exact failed game
            failures.append({"game_id": item["id"], "error": f"{type(exc).__name__}: {exc}"})

    schema_games = Counter(game["metadata"]["analysis_schema_version"] for game in games)
    phase_eligible = {phase: sum(pg["scores"][phase]["eligible_moves"] for game in games for pg in game["player_games"]) for phase in PHASES}
    raw_calculable = {group: sum(pg["scores"][group]["raw_score"] is not None for game in games for pg in game["player_games"]) for group in ("overall", *PHASES)}
    coverage = {group: _average(pg["scores"][group]["coverage"] for game in games for pg in game["player_games"]) for group in ("overall", *PHASES)}
    confidence = {
        group: dict(Counter(pg["scores"][group]["confidence"]["level"] for game in games for pg in game["player_games"]))
        for group in ("overall", *PHASES)
    }
    official = []
    for game in games:
        for player, pg in zip(game["metadata"]["players"], game["player_games"]):
            if player["official_rank_normalized"]:
                official.append({"rank": player["official_rank_raw"], "side": player["side"],
                                 "result": player["result"], "raw_score": pg["scores"]["overall"]["raw_score"]})
    rank_scores = defaultdict(list)
    for row in official:
        if row["raw_score"] is not None:
            rank_scores[row["rank"]].append(row["raw_score"])
    all_player_games = [pg for game in games for pg in game["player_games"]]
    side_scores = {side: [pg["scores"]["overall"]["raw_score"] for pg in all_player_games if pg["side"] == side] for side in ("sente", "gote")}
    result_scores = {result: [pg["scores"]["overall"]["raw_score"] for pg in all_player_games if pg["result"] == result] for result in ("win", "loss")}
    return {
        "requested_games": len(items), "processed_games": len(games), "failures": failures,
        "schema_games": {"v1": schema_games[1], "v2": schema_games[2]},
        "player_games": len(all_player_games), "both_players_per_game": all(len(game["player_games"]) == 2 for game in games),
        "phase_eligible_moves": phase_eligible, "raw_score_calculable": raw_calculable,
        "feature_coverage_average": coverage, "confidence": confidence,
        "official_rank_player_games": len(official),
        "official_rank_counts": dict(Counter(row["rank"] for row in official)),
        "official_rank_raw_score": {rank: {"count": len(values), "mean": _average(values),
                                           "min": min(values), "max": max(values)} for rank, values in sorted(rank_scores.items())},
        "side_bias": {"sente_mean": _average(side_scores["sente"]), "gote_mean": _average(side_scores["gote"]),
                      "sente_minus_gote": round((_average(side_scores["sente"]) or 0) - (_average(side_scores["gote"]) or 0), 4)},
        "winner_leakage_audit": {"winner_mean": _average(result_scores["win"]), "loser_mean": _average(result_scores["loss"]),
                                 "winner_minus_loser_observed": round((_average(result_scores["win"]) or 0) - (_average(result_scores["loss"]) or 0), 4),
                                 "direct_result_feature": False},
        "provisional_weights": PROVISIONAL_WEIGHTS,
        "calibration_status": "pending", "rank_conversion": "not-implemented",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    result = {
        "audited_25": audit(root, AUDITED_25_EXCLUDED_FROM_CURRENT_MAIN),
        "current_main": audit(root),
    }
    rendered = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(rendered, encoding="utf-8")
    print(rendered, end="")


if __name__ == "__main__":
    main()
