#!/usr/bin/env python3
"""Phase D1 user-disjoint ordinal calibration experiment.

This module is deliberately not connected to the production UI.  It validates
Phase C calibration rows and provides a small, dependency-free feasibility
experiment; it does not publish rank thresholds.
"""
from __future__ import annotations

import math
import statistics
from collections import Counter, defaultdict
from typing import Any, Iterable, Sequence


CALIBRATION_SCHEMA_VERSION = "skill-calibration-d1-v1"
MODEL_VERSION = "ordinal-ridge-pilot-v1"
ALLOWED_PILOT_RANKS = (8, 9, 10)  # 2-kyu, 1-kyu, 1-dan
RANK_LABELS = {8: "2級", 9: "1級", 10: "初段"}
GROUPS = ("overall", "opening", "middlegame", "endgame")

MODEL_FEATURES = {
    "raw_score_only": ("overall_raw_score",),
    "phase_scores": ("opening_raw_score", "middlegame_raw_score", "endgame_raw_score"),
    "raw_score_basic": (
        "overall_raw_score", "overall_coverage", "overall_eligible_moves",
        "overall_cpl_mean", "overall_cpl_p75", "overall_critical_loss_frequency",
        "overall_best_move_match_rate", "overall_major_piece_losses",
    ),
}

# Result and side are audit strata, never predictors.  Official rank is a target.
FORBIDDEN_PREDICTORS = {
    "player_id", "game_id", "official_rank", "official_rank_type",
    "official_rank_number", "official_rank_order", "result", "side",
}

MINIMUMS = {
    "overall": {"eligible_moves": 12, "coverage": 0.65},
    "opening": {"eligible_moves": 6, "coverage": 0.65},
    "middlegame": {"eligible_moves": 6, "coverage": 0.65},
    "endgame": {"eligible_moves": 6, "coverage": 0.65},
}

REQUIRED_CONTEXT = {
    "game_id", "player_id", "provider", "time_control", "official_rank",
    "official_rank_order", "side", "result", "feature_version", "score_version",
}


class DatasetValidationError(ValueError):
    """Raised when calibration rows cannot safely enter an experiment."""


def _number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def validate_rows(rows: Sequence[dict[str, Any]], *, pilot_only: bool = True) -> dict[str, Any]:
    """Validate schema, labels and one-row-per-player-game identity."""
    errors: list[str] = []
    seen: set[tuple[str, str]] = set()
    versions: set[tuple[str, str]] = set()
    labeled = 0
    for index, row in enumerate(rows):
        missing = sorted(REQUIRED_CONTEXT - row.keys())
        if missing:
            errors.append(f"row {index}: missing fields {', '.join(missing)}")
            continue
        identity = (str(row["game_id"]), str(row["player_id"]))
        if identity in seen:
            errors.append(f"row {index}: duplicate player-game {identity[0]}/{identity[1]}")
        seen.add(identity)
        versions.add((str(row["feature_version"]), str(row["score_version"])))
        if not row["player_id"]:
            errors.append(f"row {index}: empty player_id")
        if row["side"] not in {"sente", "gote"}:
            errors.append(f"row {index}: unknown side {row['side']!r}")
        if row["result"] not in {"win", "loss", "draw", "unknown"}:
            errors.append(f"row {index}: unknown result {row['result']!r}")
        rank = _number(row["official_rank_order"])
        if row["official_rank"] in (None, ""):
            if rank is not None:
                errors.append(f"row {index}: rank order exists without official rank")
        elif rank is None or not rank.is_integer():
            errors.append(f"row {index}: invalid official rank order")
        else:
            labeled += 1
            if pilot_only and int(rank) not in ALLOWED_PILOT_RANKS:
                errors.append(f"row {index}: rank outside D1 pilot cohort")
        for group in GROUPS:
            for suffix in ("raw_score", "coverage", "eligible_moves"):
                key = f"{group}_{suffix}"
                if key not in row:
                    errors.append(f"row {index}: missing field {key}")
            coverage = _number(row.get(f"{group}_coverage"))
            if coverage is not None and not 0 <= coverage <= 1:
                errors.append(f"row {index}: invalid {group} coverage")
            score = _number(row.get(f"{group}_raw_score"))
            if score is not None and not 0 <= score <= 100:
                errors.append(f"row {index}: invalid {group} raw score")
    if len(versions) > 1:
        errors.append("mixed feature/score versions require separate cohorts")
    if errors:
        raise DatasetValidationError("; ".join(errors))
    return {
        "schema_version": CALIBRATION_SCHEMA_VERSION,
        "rows": len(rows), "labeled_rows": labeled,
        "unique_users": len({row["player_id"] for row in rows}),
        "versions": [list(item) for item in sorted(versions)],
    }


def labeled_pilot_rows(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return [row for row in rows if int(_number(row.get("official_rank_order")) or -1) in ALLOWED_PILOT_RANKS]


def leave_one_user_out(rows: Sequence[dict[str, Any]]) -> list[tuple[list[int], list[int]]]:
    """Return deterministic LOOU indices and assert no player leakage."""
    groups: dict[str, list[int]] = defaultdict(list)
    for index, row in enumerate(rows):
        player_id = str(row.get("player_id") or "")
        if not player_id:
            raise DatasetValidationError(f"row {index}: player_id required for grouped split")
        groups[player_id].append(index)
    if len(groups) < 2:
        raise DatasetValidationError("at least two unique users are required")
    folds = []
    all_indices = set(range(len(rows)))
    for player_id in sorted(groups):
        test = groups[player_id]
        train = sorted(all_indices - set(test))
        if {rows[i]["player_id"] for i in train} & {rows[i]["player_id"] for i in test}:
            raise AssertionError("same player leaked across train/test")
        folds.append((train, test))
    return folds


def _solve(matrix: list[list[float]], vector: list[float]) -> list[float]:
    """Gauss-Jordan solve for the small ridge systems used here."""
    size = len(vector)
    augmented = [matrix[i][:] + [vector[i]] for i in range(size)]
    for column in range(size):
        pivot = max(range(column, size), key=lambda row: abs(augmented[row][column]))
        if abs(augmented[pivot][column]) < 1e-12:
            raise DatasetValidationError("singular calibration design")
        augmented[column], augmented[pivot] = augmented[pivot], augmented[column]
        scale = augmented[column][column]
        augmented[column] = [value / scale for value in augmented[column]]
        for row in range(size):
            if row == column:
                continue
            factor = augmented[row][column]
            augmented[row] = [a - factor * b for a, b in zip(augmented[row], augmented[column])]
    return [augmented[row][-1] for row in range(size)]


class OrdinalRidge:
    """Tiny ordered-label baseline: ridge latent score + ordered cut points."""

    def __init__(self, feature_names: Sequence[str], alpha: float = 1.0):
        forbidden = set(feature_names) & FORBIDDEN_PREDICTORS
        if forbidden:
            raise DatasetValidationError(f"forbidden predictor(s): {', '.join(sorted(forbidden))}")
        self.feature_names = tuple(feature_names)
        self.alpha = alpha

    def fit(self, rows: Sequence[dict[str, Any]]) -> "OrdinalRidge":
        if not rows:
            raise DatasetValidationError("empty training fold")
        self.labels = sorted({int(float(row["official_rank_order"])) for row in rows})
        if len(self.labels) < 2:
            raise DatasetValidationError("training fold needs at least two ordered ranks")
        columns = [[_number(row.get(name)) for row in rows] for name in self.feature_names]
        self.medians = [statistics.median([v for v in column if v is not None]) if any(v is not None for v in column) else 0.0 for column in columns]
        filled = [[(_number(row.get(name)) if _number(row.get(name)) is not None else self.medians[j]) for j, name in enumerate(self.feature_names)] for row in rows]
        self.means = [statistics.fmean(row[j] for row in filled) for j in range(len(self.feature_names))]
        self.scales = []
        for j in range(len(self.feature_names)):
            variance = statistics.fmean((row[j] - self.means[j]) ** 2 for row in filled)
            self.scales.append(math.sqrt(variance) or 1.0)
        design = [[1.0] + [(row[j] - self.means[j]) / self.scales[j] for j in range(len(self.feature_names))] for row in filled]
        target = [float(row["official_rank_order"]) for row in rows]
        width = len(design[0])
        gram = [[sum(row[i] * row[j] for row in design) for j in range(width)] for i in range(width)]
        rhs = [sum(row[i] * y for row, y in zip(design, target)) for i in range(width)]
        for j in range(1, width):  # do not penalize intercept
            gram[j][j] += self.alpha
        self.weights = _solve(gram, rhs)
        self.training_latent = [self._latent(row) for row in rows]
        by_rank = {label: statistics.fmean(value for value, row in zip(self.training_latent, rows) if int(float(row["official_rank_order"])) == label) for label in self.labels}
        # Enforce nondecreasing class centers (pool-adjacent-violators).
        blocks = [[label, label, by_rank[label], 1] for label in self.labels]
        cursor = 0
        while cursor < len(blocks) - 1:
            if blocks[cursor][2] <= blocks[cursor + 1][2]:
                cursor += 1
                continue
            left, right = blocks[cursor], blocks[cursor + 1]
            count = left[3] + right[3]
            merged = [left[0], right[1], (left[2] * left[3] + right[2] * right[3]) / count, count]
            blocks[cursor:cursor + 2] = [merged]
            cursor = max(0, cursor - 1)
        centers = {}
        for first, last, value, _ in blocks:
            for label in self.labels:
                if first <= label <= last:
                    centers[label] = value
        self.cut_points = [(centers[a] + centers[b]) / 2 for a, b in zip(self.labels, self.labels[1:])]
        residuals = [float(row["official_rank_order"]) - value for row, value in zip(rows, self.training_latent)]
        self.residual_scale = math.sqrt(statistics.fmean(value * value for value in residuals))
        return self

    def _latent(self, row: dict[str, Any]) -> float:
        values = []
        for j, name in enumerate(self.feature_names):
            value = _number(row.get(name))
            values.append((self.medians[j] if value is None else value - 0.0))
        return self.weights[0] + sum(self.weights[j + 1] * ((value - self.means[j]) / self.scales[j]) for j, value in enumerate(values))

    def predict_one(self, row: dict[str, Any]) -> tuple[int, float]:
        latent = self._latent(row)
        index = sum(latent >= point for point in self.cut_points)
        return self.labels[index], latent


def evaluation_metrics(actual: Sequence[int], predicted: Sequence[int]) -> dict[str, Any]:
    if len(actual) != len(predicted) or not actual:
        raise DatasetValidationError("non-empty aligned predictions required")
    labels = sorted(set(actual) | set(predicted))
    matrix = {RANK_LABELS.get(a, str(a)): {RANK_LABELS.get(p, str(p)): 0 for p in labels} for a in labels}
    errors = []
    for truth, guess in zip(actual, predicted):
        matrix[RANK_LABELS.get(truth, str(truth))][RANK_LABELS.get(guess, str(guess))] += 1
        errors.append(abs(truth - guess))
    return {
        "n": len(actual),
        "exact_accuracy": round(sum(e == 0 for e in errors) / len(errors), 4),
        "within_one_accuracy": round(sum(e <= 1 for e in errors) / len(errors), 4),
        "rank_mae": round(statistics.fmean(errors), 4),
        "confusion_matrix": matrix,
    }


def _stratified_errors(predictions: Sequence[dict[str, Any]], field: str) -> dict[str, Any]:
    grouped: dict[str, list[float]] = defaultdict(list)
    for item in predictions:
        grouped[str(item[field])].append(abs(item["actual"] - item["predicted"]))
    return {key: {"n": len(values), "mae": round(statistics.fmean(values), 4)} for key, values in sorted(grouped.items())}


def run_loou(rows: Sequence[dict[str, Any]], feature_names: Sequence[str]) -> dict[str, Any]:
    predictions = []
    folds = leave_one_user_out(rows)
    for fold, (train_indices, test_indices) in enumerate(folds):
        train = [rows[i] for i in train_indices]
        model = OrdinalRidge(feature_names).fit(train)
        for index in test_indices:
            predicted, latent = model.predict_one(rows[index])
            predictions.append({
                "row_index": index, "fold": fold, "player_id": rows[index]["player_id"],
                "actual": int(float(rows[index]["official_rank_order"])), "predicted": predicted,
                "latent": round(latent, 4), "side": rows[index]["side"], "result": rows[index]["result"],
            })
    predictions.sort(key=lambda item: item["row_index"])
    metrics = evaluation_metrics([item["actual"] for item in predictions], [item["predicted"] for item in predictions])
    return {
        "model_version": MODEL_VERSION, "features": list(feature_names),
        "validation": "leave-one-user-out", "folds": len(folds),
        "user_disjoint": True, "metrics": metrics,
        "side_error": _stratified_errors(predictions, "side"),
        "result_error": _stratified_errors(predictions, "result"),
        "predictions": predictions,
    }


def estimability(group: str, eligible_moves: int, coverage: float, *, game_count: int = 1) -> dict[str, Any]:
    if group not in MINIMUMS:
        raise ValueError(f"unknown group: {group}")
    minimum = MINIMUMS[group]
    reasons = []
    if eligible_moves < minimum["eligible_moves"]:
        reasons.append("eligible_moves_below_minimum")
    if coverage < minimum["coverage"]:
        reasons.append("coverage_below_minimum")
    if reasons:
        status = "INSUFFICIENT_DATA"
    elif game_count < 10 or eligible_moves < 2 * minimum["eligible_moves"] or coverage < 0.8:
        status = "LOW_CONFIDENCE"
    else:
        status = "ESTIMABLE"
    return {"status": status, "reasons": reasons, "minimum": minimum}


def calibration_confidence(*, training_users: int, training_rows: int, eligible_moves: int,
                           coverage: float, interval_width: float | None, ood: bool,
                           game_count: int) -> dict[str, Any]:
    reasons = []
    if training_users < 30 or training_rows < 100:
        reasons.append("small_training_cohort")
    if eligible_moves < 12:
        reasons.append("few_eligible_moves")
    if coverage < 0.8:
        reasons.append("low_coverage")
    if interval_width is None or interval_width > 1.0:
        reasons.append("wide_or_unavailable_interval")
    if ood:
        reasons.append("out_of_distribution")
    if game_count < 10:
        reasons.append("short_history")
    if game_count == 1:
        reasons.append("single_game_high_forbidden")
    if "small_training_cohort" in reasons:
        level = "LOW"
    elif not reasons and game_count >= 30 and training_users >= 100:
        level = "HIGH"
    elif not ood and game_count >= 10 and coverage >= 0.8 and eligible_moves >= 60:
        level = "MEDIUM"
    else:
        level = "LOW"
    return {"level": level, "reasons": reasons, "single_game_high_forbidden": True}


def aggregate_rows(rows: Sequence[dict[str, Any]], window: int) -> dict[str, Any]:
    """Feature-first rolling aggregation; recent rows must be ordered oldest-first."""
    if window not in {1, 10, 30}:
        raise ValueError("supported windows are 1, 10 and 30")
    selected = list(rows[-window:])
    if not selected:
        raise DatasetValidationError("cannot aggregate an empty history")
    player_ids = {row["player_id"] for row in selected}
    if len(player_ids) != 1:
        raise DatasetValidationError("rolling history must contain exactly one player")
    output = {key: selected[-1].get(key) for key in REQUIRED_CONTEXT}
    output["estimate_kind"] = {1: "single_game", 10: "rolling_10", 30: "rolling_30"}[window]
    output["game_count"] = len(selected)
    for group in GROUPS:
        count_key = f"{group}_eligible_moves"
        counts = [int(_number(row.get(count_key)) or 0) for row in selected]
        total = sum(counts)
        output[count_key] = total
        for key in set().union(*(row.keys() for row in selected)):
            if not key.startswith(f"{group}_") or key == count_key:
                continue
            values = [(_number(row.get(key)), count) for row, count in zip(selected, counts)]
            observed = [(value, max(1, count)) for value, count in values if value is not None]
            output[key] = (sum(value * weight for value, weight in observed) / sum(weight for _, weight in observed)) if observed else None
    return output


def bias_audit(rows: Sequence[dict[str, Any]]) -> dict[str, Any]:
    usable = [row for row in rows if _number(row.get("overall_raw_score")) is not None]
    by_rank_result: dict[int, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    by_side: dict[str, list[float]] = defaultdict(list)
    by_player_result: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for row in usable:
        score = float(row["overall_raw_score"])
        rank = int(float(row["official_rank_order"]))
        by_rank_result[rank][row["result"]].append(score)
        by_side[row["side"]].append(score)
        by_player_result[row["player_id"]][row["result"]].append(score)
    within_rank = {}
    for rank, results in sorted(by_rank_result.items()):
        win, loss = results.get("win", []), results.get("loss", [])
        within_rank[RANK_LABELS.get(rank, str(rank))] = {
            "winner_n": len(win), "loser_n": len(loss),
            "winner_mean": round(statistics.fmean(win), 4) if win else None,
            "loser_mean": round(statistics.fmean(loss), 4) if loss else None,
            "winner_minus_loser": round(statistics.fmean(win) - statistics.fmean(loss), 4) if win and loss else None,
        }
    player_differences = []
    for player, results in by_player_result.items():
        if results.get("win") and results.get("loss"):
            player_differences.append(statistics.fmean(results["win"]) - statistics.fmean(results["loss"]))
    sente, gote = by_side.get("sente", []), by_side.get("gote", [])
    return {
        "winner_direct_feature": False,
        "within_official_rank": within_rank,
        "within_player": {"comparable_users": len(player_differences), "mean_winner_minus_loser": round(statistics.fmean(player_differences), 4) if player_differences else None},
        "side": {"sente_n": len(sente), "gote_n": len(gote),
                 "sente_minus_gote": round(statistics.fmean(sente) - statistics.fmean(gote), 4) if sente and gote else None},
    }


def experiment(rows: Sequence[dict[str, Any]]) -> dict[str, Any]:
    validate_rows(rows, pilot_only=False)
    pilot = labeled_pilot_rows(rows)
    validate_rows(pilot)
    return {
        "schema_version": CALIBRATION_SCHEMA_VERSION,
        "purpose": "pipeline-feasibility-only",
        "production_rank_display": False,
        "cohort": {"rows": len(pilot), "unique_users": len({row["player_id"] for row in pilot}),
                   "ranks": {RANK_LABELS[rank]: sum(int(float(row["official_rank_order"])) == rank for row in pilot) for rank in ALLOWED_PILOT_RANKS}},
        "models": {name: run_loou(pilot, features) for name, features in MODEL_FEATURES.items()},
        "phase_models": {group: run_loou(pilot, (f"{group}_raw_score",)) for group in GROUPS},
        "bias_audit": bias_audit(pilot),
    }
