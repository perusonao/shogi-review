#!/usr/bin/env python3
"""Phase D2 legal calibration dataset registry, validation and reporting.

The registry contains only derived player-game features and required metadata.
It never fetches games and is intentionally disconnected from production rank UI.
"""
from __future__ import annotations

import copy
import csv
import json
import math
import re
import statistics
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable, Sequence

from skill_calibration import (
    ALLOWED_PILOT_RANKS, GROUPS, RANK_LABELS, DatasetValidationError,
    bias_audit, nested_group_validation, run_loou,
)
from skill_estimation import (
    normalize_official_rank, normalize_provider, normalize_time_control, stable_player_id,
)


DATASET_SCHEMA_VERSION = "skill-calibration-dataset-v2"
LEGACY_ROW_SCHEMA_VERSION = "skill-calibration-d1-v1"
PILOT_PROVIDER = "shogi-wars"
PILOT_TIME_CONTROL = "10m-sudden-death"
STAGES = (30, 100, 300)
LEGAL_COLLECTION_ROUTES = {
    "existing-kif", "user-provided-kif", "existing-metadata", "pwa-kif-submit",
}
BASELINE = {
    "name": "Raw Score only",
    "source": "Phase D1 LOOU (16 labeled player-games)",
    "exact_accuracy": 0.3125,
    "within_one_accuracy": 0.8125,
    "rank_mae": 0.875,
    "production_candidate": False,
    "policy": "a new model must clearly outperform this baseline",
}

REQUIRED_METADATA = {
    "provider", "player_id", "official_rank", "time_control", "side", "result", "game_id",
}
STABLE_PLAYER_ID = re.compile(r"^(?P<provider>[a-z0-9-]+):user:[0-9a-f]{24,64}$")


def _finite(value: Any) -> float | None:
    if value in (None, "") or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _canonical_time_control(value: Any) -> str | None:
    if value in (None, ""):
        return None
    text = str(value).strip()
    if re.fullmatch(r"\d+m-sudden-death", text):
        return text
    normalized = normalize_time_control(text)
    return normalized["id"] if normalized else None


def _canonical_rank(value: Any) -> tuple[str | None, int | None]:
    if value in (None, ""):
        return None, None
    normalized = normalize_official_rank(str(value))
    if not normalized:
        return str(value).strip(), None
    number = normalized["rank_number"]
    label = f"{number}級" if normalized["rank_type"] == "kyu" else ("初段" if number == 1 else f"{number}段")
    return label, normalized["rank_order"]


def canonicalize_row(row: dict[str, Any], *, default_route: str = "existing-metadata") -> dict[str, Any]:
    """Return a normalized copy; raw source dictionaries are never mutated."""
    output = copy.deepcopy(row)
    display_name = output.get("display_name")
    if display_name:
        expected_id, _ = stable_player_id(output.get("provider"), str(display_name))
        if expected_id != output.get("player_id"):
            raise DatasetValidationError("player_id does not match provider + normalized display_name")
    # Calibration artifacts never retain public display names or raw KIF text.
    output.pop("display_name", None)
    output.pop("kif", None)
    output["provider"] = normalize_provider(output.get("provider"))
    output["time_control"] = _canonical_time_control(output.get("time_control"))
    raw_rank = output.get("official_rank_raw", output.get("official_rank"))
    rank, order = _canonical_rank(raw_rank)
    normalized_rank = normalize_official_rank(str(raw_rank)) if raw_rank not in (None, "") else None
    supplied_normalized = output.get("official_rank_normalized")
    if supplied_normalized not in (None, normalized_rank):
        raise DatasetValidationError("official_rank_normalized does not match official_rank_raw")
    output["official_rank_raw"] = raw_rank
    output["official_rank_normalized"] = normalized_rank
    output["official_rank"] = rank
    supplied_order = _finite(output.get("official_rank_order"))
    output["official_rank_order"] = int(supplied_order) if supplied_order is not None and supplied_order.is_integer() else order
    output["side"] = {"先手": "sente", "後手": "gote"}.get(output.get("side"), output.get("side"))
    output["result"] = {"勝": "win", "勝ち": "win", "敗": "loss", "負け": "loss",
                        "引分": "draw", "引き分け": "draw"}.get(output.get("result"), output.get("result"))
    output["dataset_schema_version"] = output.get("dataset_schema_version") or LEGACY_ROW_SCHEMA_VERSION
    output["collection_route"] = output.get("collection_route") or default_route
    return output


def _validate_row(row: dict[str, Any], index: int, *, require_training_metadata: bool) -> list[str]:
    errors: list[str] = []
    structurally_required = {"player_id", "side", "result", "game_id"}
    required = REQUIRED_METADATA if require_training_metadata else structurally_required
    missing = sorted(key for key in required if row.get(key) in (None, ""))
    if missing:
        errors.append(f"player_game {index}: missing metadata {', '.join(missing)}")
    provider = row.get("provider")
    match = STABLE_PLAYER_ID.fullmatch(str(row.get("player_id") or ""))
    if not match:
        errors.append(f"player_game {index}: player_id is not a stable opaque provider-scoped ID")
    elif provider and match.group("provider") != provider:
        errors.append(f"player_game {index}: player_id provider does not match provider")
    rank, order = _canonical_rank(row.get("official_rank"))
    if row.get("official_rank") not in (None, ""):
        if (rank is None or order is None) and require_training_metadata:
            errors.append(f"player_game {index}: official_rank is not normalizable")
        elif order is not None and row.get("official_rank_order") != order:
            errors.append(f"player_game {index}: official_rank_order does not match official_rank")
    elif require_training_metadata:
        errors.append(f"player_game {index}: official_rank is not normalizable")
    if row.get("side") not in {"sente", "gote"}:
        errors.append(f"player_game {index}: invalid side")
    if row.get("result") not in {"win", "loss", "draw", "unknown"}:
        errors.append(f"player_game {index}: invalid result")
    if row.get("collection_route") not in LEGAL_COLLECTION_ROUTES:
        errors.append(f"player_game {index}: unsupported collection_route (automated scraping is not accepted)")
    for group in GROUPS:
        for suffix in ("raw_score", "coverage", "eligible_moves"):
            key = f"{group}_{suffix}"
            value = _finite(row.get(key))
            if value is None and require_training_metadata:
                errors.append(f"player_game {index}: missing {key}")
            elif value is not None and suffix == "raw_score" and not 0 <= value <= 100:
                errors.append(f"player_game {index}: invalid {key}")
            elif value is not None and suffix == "coverage" and not 0 <= value <= 1:
                errors.append(f"player_game {index}: invalid {key}")
            elif value is not None and suffix == "eligible_moves" and (value < 0 or not value.is_integer()):
                errors.append(f"player_game {index}: invalid {key}")
    return errors


def build_dataset(rows: Sequence[dict[str, Any]], *, default_route: str = "existing-metadata") -> dict[str, Any]:
    """Build the v2 game registry from flat v1/v2 player-game rows."""
    normalized = [canonicalize_row(row, default_route=default_route) for row in rows]
    games: dict[tuple[str, str], dict[str, Any]] = {}
    player_games = []
    for row in normalized:
        key = (str(row.get("provider") or ""), str(row.get("game_id") or ""))
        game = {
            "provider": row.get("provider"), "game_id": row.get("game_id"),
            "time_control": row.get("time_control"), "collection_route": row.get("collection_route"),
        }
        if key in games and games[key] != game:
            raise DatasetValidationError(f"conflicting duplicate game {key[0]}/{key[1]}")
        games[key] = game
        player_games.append(row)
    dataset = {
        "dataset_schema_version": DATASET_SCHEMA_VERSION,
        "production_rank_display": False,
        "games": [games[key] for key in sorted(games)],
        "player_games": player_games,
    }
    validate_dataset(dataset)
    return dataset


def validate_dataset(dataset: dict[str, Any]) -> dict[str, Any]:
    """Validate game uniqueness, player-game identity, metadata and referential integrity."""
    errors: list[str] = []
    if dataset.get("dataset_schema_version") != DATASET_SCHEMA_VERSION:
        errors.append(f"dataset_schema_version must be {DATASET_SCHEMA_VERSION}")
    games = dataset.get("games")
    rows = dataset.get("player_games")
    if not isinstance(games, list) or not isinstance(rows, list):
        raise DatasetValidationError("games and player_games must be arrays")
    game_keys: set[tuple[str, str]] = set()
    game_records: dict[tuple[str, str], dict[str, Any]] = {}
    for index, game in enumerate(games):
        if not isinstance(game, dict):
            errors.append(f"game {index}: object required")
            continue
        key = (str(game.get("provider") or ""), str(game.get("game_id") or ""))
        if not key[1]:
            errors.append(f"game {index}: game_id required")
        if key in game_keys:
            errors.append(f"game {index}: duplicate game {key[0]}/{key[1]}")
        game_keys.add(key)
        game_records[key] = game
        if game.get("collection_route") not in LEGAL_COLLECTION_ROUTES:
            errors.append(f"game {index}: unsupported collection_route")
    identities: set[tuple[str, str, str]] = set()
    sides: set[tuple[str, str, str]] = set()
    for index, raw in enumerate(rows):
        if not isinstance(raw, dict):
            errors.append(f"player_game {index}: object required")
            continue
        row = canonicalize_row(raw)
        errors.extend(_validate_row(row, index, require_training_metadata=False))
        game_key = (str(row.get("provider") or ""), str(row.get("game_id") or ""))
        identity = (*game_key, str(row.get("player_id") or ""))
        side_key = (*game_key, str(row.get("side") or ""))
        if identity in identities:
            errors.append(f"player_game {index}: duplicate player-game {'/'.join(identity)}")
        if side_key in sides:
            errors.append(f"player_game {index}: duplicate game side {'/'.join(side_key)}")
        identities.add(identity)
        sides.add(side_key)
        if game_key not in game_keys:
            errors.append(f"player_game {index}: game reference not found")
        else:
            game = game_records[game_key]
            if row.get("time_control") != game.get("time_control"):
                errors.append(f"player_game {index}: time_control conflicts with game")
            if row.get("collection_route") != game.get("collection_route"):
                errors.append(f"player_game {index}: collection_route conflicts with game")
    if errors:
        raise DatasetValidationError("; ".join(errors))
    return {
        "valid": True, "games": len(games), "player_games": len(rows),
        "unique_users": len({row["player_id"] for row in rows}),
    }


def validate_labeled_rows(rows: Sequence[dict[str, Any]]) -> dict[str, Any]:
    """Strictly validate rows before they are allowed into model training."""
    errors = []
    normalized = [canonicalize_row(row) for row in rows]
    for index, row in enumerate(normalized):
        errors.extend(_validate_row(row, index, require_training_metadata=True))
    identities = [(row.get("provider"), row.get("game_id"), row.get("player_id")) for row in normalized]
    if len(identities) != len(set(identities)):
        errors.append("duplicate player-game in labeled rows")
    if errors:
        raise DatasetValidationError("; ".join(errors))
    return {"valid": True, "labeled_rows": len(rows),
            "unique_users": len({row["player_id"] for row in normalized})}


def pilot_rows(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Select only the preregistered Shogi Wars 10-minute pilot cohort."""
    selected = []
    for raw in rows:
        row = canonicalize_row(raw)
        if (row.get("provider") == PILOT_PROVIDER and row.get("time_control") == PILOT_TIME_CONTROL
                and row.get("official_rank_order") in ALLOWED_PILOT_RANKS):
            selected.append(row)
    validate_labeled_rows(selected)
    return selected


def _missing_counts(rows: Sequence[dict[str, Any]]) -> dict[str, int]:
    keys = sorted(REQUIRED_METADATA | {
        f"{group}_{suffix}" for group in GROUPS for suffix in ("raw_score", "coverage", "eligible_moves")
    })
    return {key: sum(row.get(key) in (None, "") for row in rows) for key in keys}


def _coverage_summary(rows: Sequence[dict[str, Any]]) -> dict[str, Any]:
    output = {}
    for group in GROUPS:
        values = [_finite(row.get(f"{group}_coverage")) for row in rows]
        observed = [value for value in values if value is not None]
        eligible = [_finite(row.get(f"{group}_eligible_moves")) for row in rows]
        output[group] = {
            "observed": len(observed),
            "mean": round(statistics.fmean(observed), 4) if observed else None,
            "complete": sum(value == 1 for value in observed),
            "eligible_moves": int(sum(value for value in eligible if value is not None)),
        }
    return output


def _rank_dashboard(rows: Sequence[dict[str, Any]]) -> dict[str, Any]:
    return {
        "unique_users": len({row["player_id"] for row in rows}),
        "player_games": len(rows),
        "schema": dict(sorted(Counter(f"v{row.get('analysis_schema_version')}" if row.get("analysis_schema_version") in {1, 2, "1", "2"}
                                           else str(row.get("analysis_schema_version") or "missing") for row in rows).items())),
        "coverage": _coverage_summary(rows),
        "side": dict(sorted(Counter(str(row.get("side") or "missing") for row in rows).items())),
        "result": dict(sorted(Counter(str(row.get("result") or "missing") for row in rows).items())),
        "missing": _missing_counts(rows),
    }


def _stage_progress(rows: Sequence[dict[str, Any]]) -> dict[str, Any]:
    counts = {rank: sum(row["official_rank_order"] == rank for row in rows) for rank in ALLOWED_PILOT_RANKS}
    progress = {}
    for stage, target in enumerate(STAGES, 1):
        progress[f"stage_{stage}"] = {
            "target_per_rank": target,
            "target_total": target * len(ALLOWED_PILOT_RANKS),
            "complete": all(counts[rank] >= target for rank in ALLOWED_PILOT_RANKS),
            "shortage": {RANK_LABELS[rank]: max(0, target - counts[rank]) for rank in ALLOWED_PILOT_RANKS},
            "total_shortage": sum(max(0, target - counts[rank]) for rank in ALLOWED_PILOT_RANKS),
        }
    return progress


def _phase_data(rows: Sequence[dict[str, Any]]) -> dict[str, Any]:
    return {group: {
        "eligible_player_games": sum((_finite(row.get(f"{group}_eligible_moves")) or 0) > 0 for row in rows),
        "eligible_moves": int(sum(_finite(row.get(f"{group}_eligible_moves")) or 0 for row in rows)),
        "coverage": _coverage_summary(rows)[group],
        "production_prediction": False,
        "confidence": "LOW",
    } for group in GROUPS}


def dataset_dashboard(dataset: dict[str, Any]) -> dict[str, Any]:
    validate_dataset(dataset)
    all_rows = [canonicalize_row(row) for row in dataset["player_games"]]
    pilot = pilot_rows(all_rows)
    by_rank = {RANK_LABELS[rank]: _rank_dashboard([row for row in pilot if row["official_rank_order"] == rank])
               for rank in ALLOWED_PILOT_RANKS}
    return {
        "dataset_schema_version": DATASET_SCHEMA_VERSION,
        "production_rank_display": False,
        "all_data": {"games": len(dataset["games"]), "player_games": len(all_rows),
                     "unique_users": len({row["player_id"] for row in all_rows}),
                     "summary": _rank_dashboard(all_rows),
                     "non_pilot_player_games_preserved": len(all_rows) - len(pilot)},
        "pilot_cohort": {
            "provider": PILOT_PROVIDER, "time_control": PILOT_TIME_CONTROL,
            "ranks": list(RANK_LABELS[rank] for rank in ALLOWED_PILOT_RANKS),
            "player_games": len(pilot), "unique_users": len({row["player_id"] for row in pilot}),
            "final_target": {"player_games": 900, "unique_users": 90,
                             "per_rank_player_games": 300, "per_rank_unique_users": 30},
            "by_rank": by_rank, "stages": _stage_progress(pilot), "phase_data": _phase_data(pilot),
        },
        "baseline": BASELINE,
    }


def _error_strata(predictions: Sequence[dict[str, Any]], field: str) -> dict[str, Any]:
    grouped: dict[str, list[float]] = defaultdict(list)
    for prediction in predictions:
        grouped[str(prediction.get(field, "missing"))].append(abs(prediction["actual"] - prediction["predicted"]))
    return {key: {"n": len(values), "mae": round(statistics.fmean(values), 4)}
            for key, values in sorted(grouped.items())}


def checkpoint_bias_audit(rows: Sequence[dict[str, Any]], predictions: Sequence[dict[str, Any]]) -> dict[str, Any]:
    """Required checkpoint error slices; side/result are audits, never predictors."""
    ranges = []
    by_player: dict[str, list[float]] = defaultdict(list)
    for row in rows:
        score = _finite(row.get("overall_raw_score"))
        if score is not None:
            by_player[row["player_id"]].append(score)
    for values in by_player.values():
        if len(values) > 1:
            ranges.append(max(values) - min(values))
    coverage_predictions = []
    for prediction in predictions:
        value = _finite(prediction.get("coverage"))
        item = dict(prediction)
        item["coverage_band"] = "missing" if value is None else ("<0.8" if value < .8 else ("<1.0" if value < 1 else "1.0"))
        coverage_predictions.append(item)
    return {
        "corrections_preintroduced": False,
        "side_mae": _error_strata(predictions, "side"),
        "result_mae": _error_strata(predictions, "result"),
        "rank_mae": _error_strata(predictions, "official_rank"),
        "within_player_score_range": {
            "comparable_users": len(ranges),
            "mean_range": round(statistics.fmean(ranges), 4) if ranges else None,
            "median_range": round(statistics.median(ranges), 4) if ranges else None,
        },
        "within_player_winner_minus_loser": bias_audit(rows)["within_player"],
        "coverage_mae": _error_strata(coverage_predictions, "coverage_band"),
    }


def checkpoint_audit(dataset: dict[str, Any]) -> dict[str, Any]:
    """Generate an audit automatically once a balanced Stage checkpoint is reached."""
    dashboard = dataset_dashboard(dataset)
    rows = pilot_rows(dataset["player_games"])
    reached = [stage for stage, value in dashboard["pilot_cohort"]["stages"].items() if value["complete"]]
    if not reached:
        return {"generated": False, "reason": "stage_1_not_reached", "production_unlocked": False}
    nested = nested_group_validation(rows)
    baseline = run_loou(rows, ("overall_raw_score",))
    predictions = baseline["predictions"]
    rank_means = {RANK_LABELS[rank]: round(statistics.fmean(float(row["overall_raw_score"])
                  for row in rows if row["official_rank_order"] == rank), 4) for rank in ALLOWED_PILOT_RANKS}
    ordered = [rank_means[RANK_LABELS[rank]] for rank in ALLOWED_PILOT_RANKS]
    return {
        "generated": True, "checkpoint": reached[-1], "production_unlocked": False,
        "requires_human_review_before_next_stage": True,
        "metrics": baseline["metrics"],
        "rank_ordering": {"raw_score_mean": rank_means, "monotonic": ordered == sorted(ordered)},
        "bias_audit": checkpoint_bias_audit(rows, predictions),
        "coverage": _coverage_summary(rows),
        "phase_audit": {group: run_loou(rows, (f"{group}_raw_score",))
                        for group in GROUPS},
        "confidence": {"level": "LOW", "production_eligible": False,
                       "reason": "checkpoint is a reevaluation gate, not production approval"},
        "nested_group_validation": nested,
        "baseline": BASELINE,
    }


def load_rows(path: Path) -> list[dict[str, Any]]:
    """Load flat CSV/JSON/JSONL; a v2 dataset contributes its player-game rows."""
    suffix = path.suffix.lower()
    if suffix == ".csv":
        with path.open(encoding="utf-8-sig", newline="") as stream:
            rows = list(csv.DictReader(stream))
        numeric_suffixes = ("_raw_score", "_coverage", "_eligible_moves")
        for row in rows:
            if row.get("official_rank_order") not in (None, ""):
                row["official_rank_order"] = int(float(row["official_rank_order"]))
            if row.get("analysis_schema_version") not in (None, ""):
                row["analysis_schema_version"] = int(float(row["analysis_schema_version"]))
            for key, value in list(row.items()):
                if key.endswith(numeric_suffixes) and value not in (None, ""):
                    row[key] = float(value)
        return rows
    if suffix == ".jsonl":
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict) and isinstance(payload.get("player_games"), list):
        validate_dataset(payload)
        return payload["player_games"]
    raise DatasetValidationError(f"unsupported dataset input: {path}")


def write_json_atomic(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)
