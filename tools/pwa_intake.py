"""Idempotent Phase D2 intake for successfully analyzed PWA submissions."""
from __future__ import annotations

import json
from pathlib import Path

from skill_estimation import calibration_row, extract_game, stable_player_id

REGISTRY = Path("data/calibration/pwa-intake-v1.json")


def intake_player_games(root: Path, game_id: str, fingerprint: str, metadata: dict) -> Path:
    analysis_path = root / "analysis" / f"{game_id}.json"
    game_path = root / "games" / f"{game_id}.json"
    kif_path = root / "games" / f"{game_id}.kif"
    if not (analysis_path.is_file() and game_path.is_file() and kif_path.is_file()):
        raise ValueError("analysis must succeed before D2 intake")
    derived = extract_game(analysis_path, game_path, kif_path)
    scored = {row["side"]: calibration_row(derived, row) for row in derived["player_games"]}
    rows = []
    for observation in metadata["players"]:
        side = observation["side"]
        row = dict(scored[side])
        player_id, id_status = stable_player_id(metadata.get("provider"), observation["username"])
        rank = observation.get("officialRank")
        row.update({
            "provider": metadata.get("provider"), "player_id": player_id,
            "player_id_status": id_status, "time_control": metadata.get("timeControl"),
            "official_rank": rank.get("label") if rank else None,
            "official_rank_type": rank.get("rankType") if rank else None,
            "official_rank_number": rank.get("rankNumber") if rank else None,
            "official_rank_order": rank.get("rankOrder") if rank else None,
            "official_rank_observed_at": metadata["gameStartedAt"],
            "official_rank_observation_source": observation.get("officialRankSource", "unknown"),
            "collection_route": "pwa-kif-submit", "queue_fingerprint": fingerprint,
        })
        rows.append(row)
    registry_path = root / REGISTRY
    existing = json.loads(registry_path.read_text(encoding="utf-8")) if registry_path.exists() else []
    keys = {(row.get("queue_fingerprint"), row.get("side")) for row in existing}
    existing.extend(row for row in rows if (row["queue_fingerprint"], row["side"]) not in keys)
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = registry_path.with_suffix(".json.partial")
    temporary.write_text(json.dumps(existing, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(registry_path)
    return registry_path
