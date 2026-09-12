#!/usr/bin/env python3
"""Read-only Phase A-C skill feature extraction for shogi-review.

Analysis and game JSON are inputs only.  The returned dictionaries are a
regenerable derived layer; no calibrated rank is produced here.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import statistics
import unicodedata
from pathlib import Path
from typing import Any, Iterable

try:
    import shogi
except ImportError:  # metadata-only consumers can still import this module
    shogi = None


DERIVED_SCHEMA_VERSION = "skill-derived-v1"
FEATURE_VERSION = "player-game-features-v1"
SEGMENTER_VERSION = "fixed-ratio-v1"
SCORE_VERSION = "raw-skill-provisional-v1"
CONFIDENCE_VERSION = "skill-confidence-provisional-v1"
CALIBRATION_STATUS = "pending"

# These weights are deliberately provisional and have no dan/kyu meaning.
PROVISIONAL_WEIGHTS = {
    "cpl_quality": 0.35,
    "critical_loss_avoidance": 0.20,
    "best_move_match": 0.10,
    "mate_safety": 0.10,
    "advantage_preservation": 0.10,
    "reversal_avoidance": 0.10,
    "major_piece_loss_avoidance": 0.05,
}
CRITICAL_LOSS_CP = 300
ADVANTAGE_CP = 600
LEGACY_EXTREME_CP = 25_000

PHASES = ("opening", "middlegame", "endgame")
MAJOR_PIECES = {6, 7, 13, 14}  # bishop, rook, horse, dragon in python-shogi
PIECE_NAMES = {
    1: "pawn", 2: "lance", 3: "knight", 4: "silver", 5: "gold",
    6: "bishop", 7: "rook", 8: "king", 9: "promoted_pawn",
    10: "promoted_lance", 11: "promoted_knight", 12: "promoted_silver",
    13: "horse", 14: "dragon",
}


def phase_for_ply(ply: int, final_ply: int) -> str:
    """Return the production phase using the existing 35/75% definition."""
    if final_ply <= 0:
        return "opening"
    progress = ply / final_ply
    if progress < 0.35:
        return "opening"
    if progress < 0.75:
        return "middlegame"
    return "endgame"


def normalize_provider(value: str | None) -> str | None:
    if not value:
        return None
    folded = unicodedata.normalize("NFKC", value).strip().casefold()
    aliases = {
        "将棋ウォーズ": "shogi-wars", "shogi wars": "shogi-wars",
        "shogiwars": "shogi-wars", "shogi-wars": "shogi-wars",
    }
    return aliases.get(folded, re.sub(r"[^a-z0-9]+", "-", folded).strip("-") or None)


def normalize_username(value: str) -> str:
    return "".join(unicodedata.normalize("NFKC", value).casefold().split())


def stable_player_id(provider: str | None, username: str) -> tuple[str, str]:
    """Return an opaque provider-scoped stable ID and its reliability status."""
    provider_key = normalize_provider(provider) or "unknown-provider"
    normalized = normalize_username(username)
    digest = hashlib.sha256(f"{provider_key}\0{normalized}".encode("utf-8")).hexdigest()[:24]
    status = "stable" if provider else "provisional-provider-missing"
    return f"{provider_key}:user:{digest}", status


_KANJI_NUMBERS = {"初": 1, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
                  "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}


def normalize_official_rank(raw: str | None) -> dict[str, Any] | None:
    """Normalize an official ordinal label without mapping it to Skill Score."""
    if not raw or not raw.strip():
        return None
    text = unicodedata.normalize("NFKC", raw).strip()
    match = re.fullmatch(r"(\d+|[初一二三四五六七八九十])(級|段)", text)
    if not match:
        return None
    token, suffix = match.groups()
    number = int(token) if token.isdigit() else _KANJI_NUMBERS[token]
    if suffix == "級" and not 1 <= number <= 10:
        return None
    if suffix == "段" and number < 1:
        return None
    rank_type = "kyu" if suffix == "級" else "dan"
    # Pure ordinal label for calibration: 10-kyu=0, 1-kyu=9, 1-dan=10.
    rank_order = 10 - number if rank_type == "kyu" else 9 + number
    return {"rank_type": rank_type, "rank_number": number, "rank_order": rank_order}


def normalize_time_control(raw: str | None) -> dict[str, Any] | None:
    if not raw or not raw.strip():
        return None
    text = unicodedata.normalize("NFKC", raw).strip()
    sudden = re.fullmatch(r"(\d+)分切れ負け", text)
    if sudden:
        minutes = int(sudden.group(1))
        return {"id": f"{minutes}m-sudden-death", "kind": "sudden_death",
                "main_time_seconds": minutes * 60, "byoyomi_seconds": 0,
                "per_move_seconds": None, "raw": raw, "status": "available"}
    byoyomi = re.fullmatch(r"(\d+)分\+(\d+)秒", text)
    if byoyomi:
        minutes, seconds = map(int, byoyomi.groups())
        return {"id": f"{minutes}m-{seconds}s-byoyomi", "kind": "byoyomi",
                "main_time_seconds": minutes * 60, "byoyomi_seconds": seconds,
                "per_move_seconds": None, "raw": raw, "status": "available"}
    per_move = re.fullmatch(r"(\d+)秒", text)
    if per_move:
        seconds = int(per_move.group(1))
        return {"id": f"{seconds}s-per-move", "kind": "per_move",
                "main_time_seconds": 0, "byoyomi_seconds": None,
                "per_move_seconds": seconds, "raw": raw, "status": "available"}
    return {"id": "other", "kind": "other", "main_time_seconds": None,
            "byoyomi_seconds": None, "per_move_seconds": None, "raw": raw,
            "status": "unavailable-normalization"}


def _read_text(path: Path) -> str:
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "cp932"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError(f"unsupported text encoding: {path}")


def read_kif_metadata(path: Path | None) -> tuple[dict[str, str], str]:
    if path is None or not path.exists():
        return {}, "unavailable"
    metadata: dict[str, str] = {}
    for line in _read_text(path).splitlines():
        if "：" not in line:
            continue
        key, value = line.split("：", 1)
        if key in {"開始日時", "終了日時", "場所", "持ち時間", "先手", "後手", "先手段級", "後手段級"}:
            metadata[key] = value.strip()
    return metadata, "available"


def _result_for_side(result: str | None, side: str) -> str:
    text = result or ""
    if any(word in text for word in ("千日手", "持将棋", "中断")):
        return "draw"
    mentioned = "sente" if "先手" in text else "gote" if "後手" in text else None
    if mentioned and "勝利" in text:
        winner = mentioned
    elif mentioned and "敗戦" in text:
        winner = "gote" if mentioned == "sente" else "sente"
    else:
        return "unknown"
    return "win" if side == winner else "loss"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_game_metadata(analysis: dict[str, Any], game: dict[str, Any],
                        analysis_path: Path, game_path: Path,
                        kif_path: Path | None = None) -> dict[str, Any]:
    headers, kif_status = read_kif_metadata(kif_path)
    game_info = game.get("game", {})
    sente = analysis.get("sente") or headers.get("先手")
    gote = analysis.get("gote") or headers.get("後手")
    if not sente or not gote:
        title = game_info.get("title", "")
        parts = title.split(" vs ", 1)
        if len(parts) == 2:
            sente, gote = sente or parts[0], gote or parts[1]
    provider_raw = headers.get("場所")
    provider = normalize_provider(provider_raw)
    time_raw = headers.get("持ち時間") or game_info.get("timeControl")
    time_control = normalize_time_control(time_raw)
    source_status = "available" if kif_status == "available" else "unavailable"
    result_text = analysis.get("result") or game_info.get("result")
    players = []
    for side, name, rank_key in (("sente", sente, "先手段級"), ("gote", gote, "後手段級")):
        display_name = name or side
        player_id, id_status = stable_player_id(provider, display_name)
        rank_raw = headers.get(rank_key)
        rank_normalized = normalize_official_rank(rank_raw)
        rank_status = "available" if rank_normalized else ("missing" if kif_status == "available" else "unavailable")
        players.append({
            "player_id": player_id,
            "player_id_status": id_status,
            "display_name": display_name,
            "official_rank_raw": rank_raw,
            "official_rank_normalized": rank_normalized,
            "official_rank_status": rank_status,
            "side": side,
            "result": _result_for_side(result_text, side),
        })
    return {
        "schema_version": DERIVED_SCHEMA_VERSION,
        "game_id": analysis.get("gameId") or game_info.get("id"),
        "source": {"kind": "kif" if kif_status == "available" else "game-json",
                   "status": source_status},
        "provider": provider,
        "provider_raw": provider_raw,
        "provider_status": "available" if provider else ("missing" if kif_status == "available" else "unavailable"),
        "time_control": time_control,
        "time_control_status": time_control.get("status") if time_control else ("missing" if kif_status == "available" else "unavailable"),
        "analysis_schema_version": int(analysis.get("schemaVersion", 1)),
        "players": players,
        "source_hashes": {"analysis_sha256": _sha256(analysis_path), "game_sha256": _sha256(game_path)},
    }


def _typed_score(value: Any, *, allow_typed: bool) -> dict[str, Any]:
    if allow_typed and isinstance(value, dict) and value.get("type") in {"cp", "mate"}:
        number = value.get("value")
        if isinstance(number, (int, float)):
            return {"type": value["type"], "value": number, "status": "available"}
    if isinstance(value, (int, float)) and abs(value) < LEGACY_EXTREME_CP:
        return {"type": "cp", "value": value, "status": "available"}
    return {"type": "unavailable", "value": None, "status": "unavailable"}


def _actor_scores(analysis: dict[str, Any], ply: int,
                  move_by_ply: dict[int, dict[str, Any]],
                  eval_by_ply: dict[int, dict[str, Any]]) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any] | None]:
    schema_v2 = int(analysis.get("schemaVersion", 1)) >= 2
    move_row = move_by_ply.get(ply)
    if schema_v2 and move_row:
        return (_typed_score(move_row.get("scoreBefore"), allow_typed=True),
                _typed_score(move_row.get("scoreAfterActual"), allow_typed=True), move_row)
    before_eval, after_eval = eval_by_ply.get(ply - 1), eval_by_ply.get(ply)
    if not before_eval or not after_eval:
        unavailable = {"type": "unavailable", "value": None, "status": "unavailable"}
        return unavailable.copy(), unavailable.copy(), None
    sign = 1 if ply % 2 == 1 else -1
    before_cp, after_cp = before_eval.get("cp"), after_eval.get("cp")
    before = sign * before_cp if isinstance(before_cp, (int, float)) else None
    after = sign * after_cp if isinstance(after_cp, (int, float)) else None
    return (_typed_score(before, allow_typed=False), _typed_score(after, allow_typed=False), None)


def _material_event(game: dict[str, Any], ply: int, actor: str) -> dict[str, Any] | None:
    if shogi is None:
        return None
    positions = game.get("positions") or []
    if ply >= len(positions) or ply - 1 >= len(positions):
        return None
    before_sfen, usi = positions[ply - 1].get("sfen"), positions[ply].get("usi")
    if not before_sfen or not usi:
        return None
    try:
        board = shogi.Board(before_sfen)
        move = shogi.Move.from_usi(usi)
        captured = board.piece_at(move.to_square)
        moving = board.piece_at(move.from_square) if move.from_square is not None else None
    except (ValueError, IndexError):
        return None
    if not captured:
        return None
    victim = "gote" if actor == "sente" else "sente"
    return {
        "type": "capture",
        "captured_piece": PIECE_NAMES.get(captured.piece_type, str(captured.piece_type)),
        "captured_piece_type": captured.piece_type,
        "captured_player_side": victim,
        "major_piece_loss": captured.piece_type in MAJOR_PIECES,
        "major_exchange_candidate": bool(moving and moving.piece_type in MAJOR_PIECES and captured.piece_type in MAJOR_PIECES),
    }


def _is_check_after(game: dict[str, Any], ply: int) -> bool | None:
    if shogi is None:
        return None


def _board_event_status(game: dict[str, Any], ply: int) -> str:
    positions = game.get("positions") or []
    return "available" if ply < len(positions) and positions[ply - 1].get("sfen") and positions[ply].get("usi") else "unavailable"
    positions = game.get("positions") or []
    if ply >= len(positions) or not positions[ply].get("sfen"):
        return None
    try:
        return bool(shogi.Board(positions[ply]["sfen"]).is_check())
    except ValueError:
        return None


def extract_moves(analysis: dict[str, Any], game: dict[str, Any],
                  metadata: dict[str, Any]) -> list[dict[str, Any]]:
    """Pure extraction of both players' per-ply derived observations."""
    final_ply = int(analysis.get("moves") or game.get("game", {}).get("moves") or 0)
    eval_by_ply = {int(row["ply"]): row for row in analysis.get("evaluations", []) if "ply" in row}
    move_by_ply = {int(row["ply"]): row for row in analysis.get("moveAnalyses", []) if "ply" in row}
    issue_refs = {
        int(row["ply"]): f"analysis:{metadata['game_id']}:verifiedIssues:{index}"
        for index, row in enumerate(analysis.get("verifiedIssues", [])) if "ply" in row
    }
    players = {row["side"]: row for row in metadata["players"]}
    rows: list[dict[str, Any]] = []
    seen_capture = seen_check = seen_major_exchange = seen_promotion = seen_mate = False
    positions = game.get("positions") or []
    for ply in range(1, final_ply + 1):
        actor = "sente" if ply % 2 == 1 else "gote"
        before, after, move_analysis = _actor_scores(analysis, ply, move_by_ply, eval_by_ply)
        actual_move = (move_analysis or {}).get("actualMove")
        if not actual_move and ply < len(positions):
            actual_move = positions[ply].get("usi")
        best_move = (move_analysis or {}).get("bestMove")
        best_match = (actual_move == best_move) if actual_move and best_move else None
        cpl = None
        if before["type"] == after["type"] == "cp":
            cpl = 0.0 if best_match is True else max(0.0, float(before["value"] - after["value"]))
        reversal = None
        advantage = None
        if before["type"] == after["type"] == "cp":
            reversal = "lost" if before["value"] > 0 > after["value"] else (
                "gained" if before["value"] < 0 < after["value"] else "none")
            if before["value"] >= ADVANTAGE_CP:
                advantage = "preserved" if after["value"] >= ADVANTAGE_CP else "lost"
        mate_event = None
        if before["type"] != "unavailable" and after["type"] != "unavailable" and int(analysis.get("schemaVersion", 1)) >= 2:
            before_winning_mate = before["type"] == "mate" and before["value"] > 0
            after_winning_mate = after["type"] == "mate" and after["value"] > 0
            before_losing_mate = before["type"] == "mate" and before["value"] < 0
            after_losing_mate = after["type"] == "mate" and after["value"] < 0
            if before_winning_mate:
                mate_event = "preserved" if after_winning_mate else "missed"
            elif not before_losing_mate and after_losing_mate:
                mate_event = "allowed"
            elif before["type"] == "mate" or after["type"] == "mate":
                mate_event = "typed-transition"
        material = _material_event(game, ply, actor)
        check = _is_check_after(game, ply)
        promotion = bool(actual_move and actual_move.endswith("+"))
        mate_region = before["type"] == "mate" or after["type"] == "mate"
        signals = {
            "first_capture": bool(material and not seen_capture),
            "major_exchange": bool(material and material["major_exchange_candidate"]),
            "first_major_exchange": bool(material and material["major_exchange_candidate"] and not seen_major_exchange),
            "first_check": bool(check and not seen_check),
            "promotion": promotion,
            "first_promotion": bool(promotion and not seen_promotion),
            "mate_region": mate_region,
            "first_mate_region": bool(mate_region and not seen_mate),
        }
        seen_capture = seen_capture or bool(material)
        seen_major_exchange = seen_major_exchange or signals["major_exchange"]
        seen_check = seen_check or bool(check)
        seen_promotion = seen_promotion or promotion
        seen_mate = seen_mate or mate_region
        rows.append({
            "game_id": metadata["game_id"], "player_id": players[actor]["player_id"],
            "evidence_id": f"{metadata['game_id']}:{actor}:{ply}:{FEATURE_VERSION}",
            "side": actor, "ply": ply, "phase": phase_for_ply(ply, final_ply),
            "progress": ply / final_ply if final_ply else 0.0,
            "score_before": before, "score_after": after, "cpl": cpl,
            "best_move_match": best_match, "mate_event": mate_event,
            "mate_feature_status": "available" if int(analysis.get("schemaVersion", 1)) >= 2 and before["type"] != "unavailable" and after["type"] != "unavailable" else "unavailable",
            "evaluation_reversal": reversal, "advantage_event": advantage,
            "critical_loss": (cpl >= CRITICAL_LOSS_CP) if cpl is not None else None,
            "material_event": material,
            "board_event_status": _board_event_status(game, ply),
            "major_piece_loss": bool(material and material["major_piece_loss"]),
            "major_piece_loss_player_id": players[material["captured_player_side"]]["player_id"] if material and material["major_piece_loss"] else None,
            "reason_evidence_ref": issue_refs.get(ply),
            "phase_signals": signals,
        })
    return rows


def _mean(values: Iterable[float]) -> float | None:
    materialized = list(values)
    return statistics.fmean(materialized) if materialized else None


def _quantile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = (len(ordered) - 1) * q
    lower, upper = math.floor(index), math.ceil(index)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] * (upper - index) + ordered[upper] * (index - lower)


def confidence_for_sample(eligible: int, coverage: float, phase_moves: int,
                          game_count: int = 1) -> dict[str, Any]:
    """Provisional low/medium/high framework; one game can never be high."""
    reasons = []
    if eligible < 10:
        reasons.append("fewer than 10 eligible moves")
    if coverage < 0.60:
        reasons.append("feature coverage below 60%")
    if phase_moves < 10:
        reasons.append("fewer than 10 player moves in segment")
    if game_count >= 20 and eligible >= 200 and coverage >= 0.80 and phase_moves >= 50:
        level = "high"
    elif eligible >= 10 and coverage >= 0.60 and phase_moves >= 10:
        level = "medium"
    else:
        level = "low"
    if game_count == 1:
        if level == "high":
            level = "medium"
        reasons.append("single-game confidence is capped below high")
    if not reasons:
        reasons.append("eligible moves, coverage, phase moves, and game count satisfy the provisional gate")
    return {"level": level, "version": CONFIDENCE_VERSION, "reasons": reasons}


def _score_group(actor_rows: list[dict[str, Any]], all_rows: list[dict[str, Any]], side: str) -> dict[str, Any]:
    cpls = [float(row["cpl"]) for row in actor_rows if row["cpl"] is not None]
    best = [row["best_move_match"] for row in actor_rows if row["best_move_match"] is not None]
    typed = [row for row in actor_rows if row["mate_feature_status"] == "available"]
    advantage = [row["advantage_event"] for row in actor_rows if row["advantage_event"] is not None]
    reversals = [row["evaluation_reversal"] for row in actor_rows if row["evaluation_reversal"] is not None]
    losses = [row for row in all_rows if row["material_event"] and
              row["material_event"]["captured_player_side"] == side and row["material_event"]["major_piece_loss"]]
    components: dict[str, float | None] = {
        "cpl_quality": _mean(100.0 * math.exp(-value / 300.0) for value in cpls),
        "critical_loss_avoidance": (100.0 * (1 - sum(value >= CRITICAL_LOSS_CP for value in cpls) / len(cpls))) if cpls else None,
        "best_move_match": (100.0 * sum(bool(value) for value in best) / len(best)) if best else None,
        "mate_safety": (100.0 * (1 - sum(row["mate_event"] in {"missed", "allowed"} for row in typed) / len(typed))) if typed else None,
        "advantage_preservation": (100.0 * sum(value == "preserved" for value in advantage) / len(advantage)) if advantage else None,
        "reversal_avoidance": (100.0 * (1 - sum(value == "lost" for value in reversals) / len(reversals))) if reversals else None,
        "major_piece_loss_avoidance": (100.0 * (1 - min(1.0, len(losses) / max(1, len(actor_rows))))) if actor_rows and any(row["board_event_status"] == "available" for row in all_rows) else None,
    }
    available_weight = sum(PROVISIONAL_WEIGHTS[key] for key, value in components.items() if value is not None)
    raw_score = (sum(PROVISIONAL_WEIGHTS[key] * float(value) for key, value in components.items() if value is not None) /
                 available_weight) if available_weight else None
    observed = {
        "cpl_quality": bool(cpls), "critical_loss_avoidance": bool(cpls),
        "best_move_match": bool(best), "mate_safety": bool(typed),
        "advantage_preservation": any(row["score_before"]["type"] == row["score_after"]["type"] == "cp" for row in actor_rows),
        "reversal_avoidance": bool(reversals),
        "major_piece_loss_avoidance": bool(actor_rows) and any(row["board_event_status"] == "available" for row in all_rows),
    }
    coverage = sum(PROVISIONAL_WEIGHTS[key] for key, value in observed.items() if value) / sum(PROVISIONAL_WEIGHTS.values())
    features = {
        "move_count": len(actor_rows), "cpl_count": len(cpls),
        "cpl_mean": _mean(cpls), "cpl_median": statistics.median(cpls) if cpls else None,
        "cpl_p75": _quantile(cpls, 0.75), "cpl_p90": _quantile(cpls, 0.90),
        "critical_loss_count": sum(value >= CRITICAL_LOSS_CP for value in cpls),
        "critical_loss_frequency": (sum(value >= CRITICAL_LOSS_CP for value in cpls) / len(cpls)) if cpls else None,
        "best_move_observations": len(best), "best_move_match_rate": (sum(bool(value) for value in best) / len(best)) if best else None,
        "mate_typed_observations": len(typed), "mate_missed": sum(row["mate_event"] == "missed" for row in actor_rows),
        "mate_allowed": sum(row["mate_event"] == "allowed" for row in actor_rows),
        "advantage_opportunities": len(advantage), "advantage_lost": sum(value == "lost" for value in advantage),
        "detrimental_reversals": sum(value == "lost" for value in reversals),
        "major_piece_losses": len(losses),
        "reason_evidence_count": sum(row["reason_evidence_ref"] is not None for row in actor_rows),
    }
    return {
        "raw_score": round(raw_score, 4) if raw_score is not None else None,
        "coverage": round(coverage, 4), "eligible_moves": len(cpls),
        "phase_moves": len(actor_rows), "components": {k: round(v, 4) if v is not None else None for k, v in components.items()},
        "features": features, "confidence": confidence_for_sample(len(cpls), coverage, len(actor_rows)),
    }


def score_players(rows: list[dict[str, Any]], metadata: dict[str, Any]) -> list[dict[str, Any]]:
    output = []
    for player in metadata["players"]:
        side = player["side"]
        actor_rows = [row for row in rows if row["side"] == side]
        groups = {"overall": _score_group(actor_rows, rows, side)}
        for phase in PHASES:
            phase_actor = [row for row in actor_rows if row["phase"] == phase]
            phase_all = [row for row in rows if row["phase"] == phase]
            groups[phase] = _score_group(phase_actor, phase_all, side)
        output.append({
            "schema_version": DERIVED_SCHEMA_VERSION, "feature_version": FEATURE_VERSION,
            "phase_segmenter_version": SEGMENTER_VERSION, "score_version": SCORE_VERSION,
            "calibration_status": CALIBRATION_STATUS,
            "game_id": metadata["game_id"], "player_id": player["player_id"],
            "side": side, "result": player["result"], "scores": groups,
        })
    return output


def extract_game(analysis_path: Path, game_path: Path,
                 kif_path: Path | None = None) -> dict[str, Any]:
    analysis = json.loads(analysis_path.read_text(encoding="utf-8"))
    game = json.loads(game_path.read_text(encoding="utf-8"))
    metadata = build_game_metadata(analysis, game, analysis_path, game_path, kif_path)
    moves = extract_moves(analysis, game, metadata)
    return {"metadata": metadata, "moves": moves, "player_games": score_players(moves, metadata)}


def calibration_row(derived: dict[str, Any], player_game: dict[str, Any]) -> dict[str, Any]:
    metadata = derived["metadata"]
    player = next(row for row in metadata["players"] if row["player_id"] == player_game["player_id"])
    row: dict[str, Any] = {
        "game_id": metadata["game_id"], "provider": metadata["provider"],
        "time_control": metadata["time_control"]["id"] if metadata["time_control"] else None,
        "player_id": player["player_id"], "official_rank": player["official_rank_raw"],
        "official_rank_type": (player["official_rank_normalized"] or {}).get("rank_type"),
        "official_rank_number": (player["official_rank_normalized"] or {}).get("rank_number"),
        "official_rank_order": (player["official_rank_normalized"] or {}).get("rank_order"),
        "side": player["side"], "result": player["result"],
        "analysis_schema_version": metadata["analysis_schema_version"],
        "feature_version": player_game["feature_version"], "score_version": player_game["score_version"],
        "calibration_status": CALIBRATION_STATUS,
    }
    for group_name, score in player_game["scores"].items():
        prefix = f"{group_name}_"
        row[prefix + "raw_score"] = score["raw_score"]
        row[prefix + "coverage"] = score["coverage"]
        row[prefix + "eligible_moves"] = score["eligible_moves"]
        for key, value in score["features"].items():
            row[prefix + key] = value
    return row
