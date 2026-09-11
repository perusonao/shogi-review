#!/usr/bin/env python3
"""Batch-analyze shogi-review KIF games with a local YaneuraOu + Suisho5 (水匠5) build.

This script only TALKS to an engine binary that already exists on this machine
(USI protocol over stdin/stdout). It never downloads an engine or nn.bin, and it
never fabricates evaluation numbers: if the engine is unreachable the run fails
loudly instead of writing placeholder data.

Requires: pip install python-shogi   (same dependency as tools/kif_to_game.py)

Usage (run on the machine that already has YaneuraOu + Suisho5 built):
  python tools/analyze_with_suisho5.py \
      --engine /path/to/YaneuraOu-by-gcc \
      --eval-dir /path/to/eval-suisho5 \
      --games 20260910_taatoru_cat 20260910_yogra 20260910_aochikenmin \
      --user sonao81 --nodes 30000

For each --games <id> it expects games/<id>.kif to exist, and it writes/overwrites:
  analysis/<id>.json   full per-ply evaluations (sente perspective) + verifiedIssues
  games/<id>.json      PWA game JSON (game/positions/issues) matching data.json's schema

It does NOT modify games/index.json, so the caller can review the generated data
before manually flipping analyzed:true and filling in gameData.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    import shogi
except ImportError as exc:  # pragma: no cover
    raise SystemExit("python-shogi is required: pip install python-shogi") from exc

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from kif_to_game import parse as parse_kif  # noqa: E402  (reuse the existing KIF reader)

JP = shogi.PIECE_JAPANESE_SYMBOLS  # index by shogi piece-type constant, matches index.html's `jp`
LETTER_TO_TYPE = {
    "P": shogi.PAWN, "L": shogi.LANCE, "N": shogi.KNIGHT, "S": shogi.SILVER,
    "G": shogi.GOLD, "B": shogi.BISHOP, "R": shogi.ROOK,
}
PROMOTE = {
    shogi.PAWN: shogi.PROM_PAWN, shogi.LANCE: shogi.PROM_LANCE,
    shogi.KNIGHT: shogi.PROM_KNIGHT, shogi.SILVER: shogi.PROM_SILVER,
    shogi.BISHOP: shogi.PROM_BISHOP, shogi.ROOK: shogi.PROM_ROOK,
}

MATE_CP = 30000  # cp used to represent a forced mate on the eval graph


# ---------------------------------------------------------------------------
# USI engine wrapper
# ---------------------------------------------------------------------------

class UsiEngine:
    def __init__(self, engine_path: str, eval_dir: str | None, extra_options: dict[str, str],
                 threads: int, hash_mb: int):
        self.proc = subprocess.Popen(
            [engine_path], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True, bufsize=1,
        )
        self._send("usi")
        self._wait_for("usiok")
        options = {"USI_OwnBook": "false", "Threads": str(threads), "USI_Hash": str(hash_mb)}
        if eval_dir:
            options["EvalDir"] = eval_dir
        options.update(extra_options)
        for name, value in options.items():
            self._send(f"setoption name {name} value {value}")
        self._send("isready")
        self._wait_for("readyok")
        self._send("usinewgame")

    def _send(self, cmd: str) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(cmd + "\n")
        self.proc.stdin.flush()

    def _readline(self) -> str:
        assert self.proc.stdout is not None
        line = self.proc.stdout.readline()
        if line == "":
            raise RuntimeError("engine process exited unexpectedly")
        return line.strip()

    def _wait_for(self, token: str) -> None:
        while True:
            line = self._readline()
            if line == token:
                return

    def analyze(self, sfen: str, nodes: int, searchmoves: list[str] | None = None) -> dict:
        self._send(f"position sfen {sfen}")
        command = f"go nodes {nodes}"
        if searchmoves:
            command += " searchmoves " + " ".join(searchmoves)
        self._send(command)
        last_score = None
        last_pv: list[str] = []
        bestmove = None
        while True:
            line = self._readline()
            if line.startswith("info "):
                tokens = line.split()
                line_score = None
                line_pv: list[str] = []
                i = 0
                while i < len(tokens):
                    if tokens[i] == "score" and i + 2 < len(tokens):
                        kind, val = tokens[i + 1], int(tokens[i + 2])
                        line_score = (kind, val)
                        i += 3
                        continue
                    if tokens[i] == "pv":
                        line_pv = tokens[i + 1:]
                        break
                    i += 1
                if line_score is not None:
                    last_score = line_score
                # Some engines emit a short final info line. Preserve the
                # longest principal variation actually reported by the engine.
                if line_pv and len(line_pv) >= len(last_pv):
                    last_pv = line_pv
            elif line.startswith("bestmove"):
                parts = line.split()
                bestmove = parts[1] if len(parts) > 1 else None
                break
        return {"score": last_score, "pv": last_pv, "bestmove": bestmove}

    def quit(self) -> None:
        try:
            self._send("quit")
            self.proc.wait(timeout=5)
        except Exception:
            self.proc.kill()


def score_to_cp(score: tuple[str, int] | None) -> int:
    if score is None:
        return 0
    kind, val = score
    if kind == "cp":
        return val
    # mate: sign*(large - distance) so it still sorts sensibly on the graph
    sign = 1 if val > 0 else -1
    return sign * (MATE_CP - min(abs(val), MATE_CP - 1))


def score_json(score: tuple[str, int] | None, sign: int = 1) -> dict:
    """Keep the engine score kind; sign converts side-to-move to a named perspective."""
    if score is None:
        return {"type": "cp", "value": 0}
    kind, value = score
    return {"type": "mate" if kind == "mate" else "cp", "value": sign * value}


def score_json_to_cp(score: dict) -> int:
    return score_to_cp((score.get("type", "cp"), int(score.get("value", 0))))


def is_short_problem_pv(pv: list[str] | None, minimum_plies: int = 4) -> bool:
    """Only problem PVs below the configured target receive one extra search."""
    return len(pv or []) < minimum_plies


def choose_longer_forced_pv(base_pv: list[str], result: dict, forced_move: str) -> list[str]:
    """Accept only a longer, engine-measured line rooted at the requested move."""
    candidate = list(result.get("pv") or [])
    if result.get("bestmove") != forced_move or not candidate or candidate[0] != forced_move:
        return base_pv
    return candidate if len(candidate) > len(base_pv) else base_pv


def average_length(lengths: list[int]) -> float | None:
    return round(sum(lengths) / len(lengths), 3) if lengths else None


def build_analysis_metrics(game_id: str, positions: int, problem_positions: int,
                           base_seconds: float, refinement: dict,
                           analyzed_at: str | None = None) -> dict:
    """Build a path- and secret-free quality record for one new analysis."""
    extra_seconds = float(refinement.get("elapsedSeconds", 0.0))
    return {
        "schemaVersion": 1,
        "gameId": game_id,
        "analyzedAt": analyzed_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "positions": positions,
        "problemPositions": problem_positions,
        "baseAnalysisSeconds": round(base_seconds, 3),
        "extraPvSearchSeconds": round(extra_seconds, 3),
        "totalAnalysisSeconds": round(base_seconds + extra_seconds, 3),
        "shortPvCandidates": int(refinement.get("shortPvCandidates", 0)),
        "extraSearchExecuted": int(refinement.get("extraSearchExecuted", 0)),
        "pvLengthBeforeAverage": refinement.get("pvLengthBeforeAverage"),
        "pvLengthAfterAverage": refinement.get("pvLengthAfterAverage"),
        "pvLengthsBefore": list(refinement.get("pvLengthsBefore", [])),
        "pvLengthsAfter": list(refinement.get("pvLengthsAfter", [])),
        "improvedPvCount": int(refinement.get("improvedPvCount", 0)),
        "unchangedPvCount": int(refinement.get("unchangedPvCount", 0)),
    }


# ---------------------------------------------------------------------------
# Move display (matches the "△23歩" / "▲34歩打" style already used in data.json)
# ---------------------------------------------------------------------------

def square_index(file_: int, rank_: int) -> int:
    return (rank_ - 1) * 9 + (9 - file_)


RANK_JA = "一二三四五六七八九"


def square_coords(square: int) -> tuple[int, int]:
    return 9 - square % 9, square // 9 + 1


def move_qualifier(move: "shogi.Move", board: "shogi.Board", piece_type: int, mover: str) -> str:
    if move.from_square is None:
        return ""
    candidates = {
        candidate.from_square
        for candidate in board.legal_moves
        if candidate.from_square is not None
        and candidate.to_square == move.to_square
        and board.piece_type_at(candidate.from_square) == piece_type
    }
    if len(candidates) < 2:
        return ""
    to_file, to_rank = square_coords(move.to_square)
    source_file, source_rank = square_coords(move.from_square)

    def horizontal(square: int) -> str:
        file_, _ = square_coords(square)
        if file_ == to_file:
            return "直"
        if mover == "sente":
            return "右" if file_ < to_file else "左"
        return "右" if file_ > to_file else "左"

    def vertical(square: int) -> str:
        _, rank_ = square_coords(square)
        if rank_ == to_rank:
            return "寄"
        if mover == "sente":
            return "上" if rank_ > to_rank else "引"
        return "上" if rank_ < to_rank else "引"

    h = horizontal(move.from_square)
    v = vertical(move.from_square)
    if sum(horizontal(square) == h for square in candidates) == 1:
        return h
    if sum(vertical(square) == v for square in candidates) == 1:
        return v
    return h + v


def can_decline_promotion(piece_type: int, move: "shogi.Move", mover: str) -> bool:
    if move.from_square is None or move.promotion or piece_type not in PROMOTE:
        return False
    _, from_rank = square_coords(move.from_square)
    _, to_rank = square_coords(move.to_square)
    in_zone = (lambda rank_: rank_ <= 3) if mover == "sente" else (lambda rank_: rank_ >= 7)
    if piece_type in (shogi.PAWN, shogi.LANCE) and to_rank == (1 if mover == "sente" else 9):
        return False
    if piece_type == shogi.KNIGHT and (to_rank <= 2 if mover == "sente" else to_rank >= 8):
        return False
    return in_zone(from_rank) or in_zone(to_rank)


def move_display_ja(usi: str, board_before: "shogi.Board", mover: str,
                    previous_to: int | None = None) -> str:
    side_mark = "▲" if mover == "sente" else "△"
    move = shogi.Move.from_usi(usi)
    to_file, to_rank = square_coords(move.to_square)
    destination = "同" if previous_to == move.to_square else f"{to_file}{RANK_JA[to_rank - 1]}"
    if "*" in usi:
        letter, _ = usi.split("*")
        name = JP[LETTER_TO_TYPE[letter]]
        return f"{side_mark}{destination}{name}打"
    assert move.from_square is not None
    piece_type = board_before.piece_type_at(move.from_square)
    if piece_type is None:
        raise ValueError(f"no piece at source square for move {usi}")
    qualifier = move_qualifier(move, board_before, piece_type, mover)
    ending = "成" if move.promotion else "不成" if can_decline_promotion(piece_type, move, mover) else ""
    return f"{side_mark}{destination}{JP[piece_type]}{qualifier}{ending}"


def pv_display_ja(sfen: str, pv: list[str], previous_to: int | None = None,
                  limit: int | None = None) -> list[str]:
    """Format only legal, engine-returned PV moves while applying each in sequence."""
    board = shogi.Board(sfen)
    formatted: list[str] = []
    for usi in pv[:limit]:
        try:
            move = shogi.Move.from_usi(usi)
        except ValueError:
            break
        if move not in board.legal_moves:
            break
        mover = "sente" if board.turn == shogi.BLACK else "gote"
        formatted.append(move_display_ja(usi, board, mover, previous_to))
        board.push(move)
        previous_to = move.to_square
    return formatted


def grounded_points(sfen: str, pv: list[str], score: dict) -> list[str]:
    """Describe at most two facts that are mechanically verifiable on board/PV."""
    if not pv:
        return []
    board = shogi.Board(sfen)
    points: list[str] = []
    for index, usi in enumerate(pv):
        try:
            move = shogi.Move.from_usi(usi)
        except ValueError:
            break
        if move not in board.legal_moves:
            break
        captured = board.piece_at(move.to_square)
        mover = "sente" if board.turn == shogi.BLACK else "gote"
        if index == 0 and move.promotion and move.from_square is not None:
            piece_type = board.piece_type_at(move.from_square)
            if piece_type is not None:
                points.append(f"推奨手は{JP[piece_type]}を成る手です。")
        if captured is not None and len(points) < 2:
            prefix = "推奨手は" if index == 0 else f"読み筋の{index + 1}手目は"
            points.append(f"{prefix}{JP[captured.piece_type]}を取る手です。")
        board.push(move)
        if index == 0 and board.is_check() and len(points) < 2:
            points.append("推奨手は王手です。")
        if len(points) >= 2:
            break
    if score.get("type") == "mate" and int(score.get("value", 0)) > 0 and len(points) < 2:
        points.append("水匠5はこの局面を詰みありと評価しています。")
    return points[:2]


def phase_of(ply: int, moves: int) -> str:
    if moves <= 0:
        return "中盤"
    r = ply / moves
    if r < 0.35:
        return "序盤"
    if r < 0.75:
        return "中盤"
    return "終盤"


def make_comment(best_ja: str) -> str:
    return f"水匠5は実戦手より{best_ja}を高く評価しています。まず読み筋を比較してみましょう。"


def category_of(ply: int, moves: int) -> str:
    return phase_of(ply, moves)


def refine_problem_lines(engine: UsiEngine, positions: list[dict], flagged: list[dict],
                         move_analyses: list[dict], nodes: int,
                         minimum_plies: int) -> dict:
    """Run at most one forced-move search for each short problem PV branch."""
    summary = {
        "enabled": True,
        "nodesPerSearch": nodes,
        "triggerBelowPlies": minimum_plies,
        "issuesConsidered": len(flagged),
        "bestSearches": 0,
        "actualSearches": 0,
        "shortPvCandidates": 0,
        "extraSearchExecuted": 0,
        "pvLengthBeforeAverage": None,
        "pvLengthAfterAverage": None,
        "pvLengthsBefore": [],
        "pvLengthsAfter": [],
        "improvedPvCount": 0,
        "unchangedPvCount": 0,
        "elapsedSeconds": 0.0,
    }
    lengths_before: list[int] = []
    lengths_after: list[int] = []
    started = time.perf_counter()
    for candidate in flagged:
        position_index = candidate["ply"] - 1
        sfen = positions[position_index]["sfen"]
        detail = {
            "bestAttempted": False,
            "bestImproved": False,
            "actualAttempted": False,
            "actualImproved": False,
        }
        best_length_before = len(candidate["pv_ja"])
        actual_length_before = len(candidate["actual_pv_ja"])
        if is_short_problem_pv(candidate["pv_ja"], minimum_plies):
            detail["bestAttempted"] = True
            summary["bestSearches"] += 1
            lengths_before.append(best_length_before)
            result = engine.analyze(sfen, nodes, searchmoves=[candidate["best_usi"]])
            candidate["pv"] = choose_longer_forced_pv(
                candidate["pv"], result, candidate["best_usi"])
        if is_short_problem_pv(candidate["actual_pv_ja"], minimum_plies):
            detail["actualAttempted"] = True
            summary["actualSearches"] += 1
            lengths_before.append(actual_length_before)
            result = engine.analyze(sfen, nodes, searchmoves=[candidate["played_usi"]])
            candidate["actual_pv"] = choose_longer_forced_pv(
                candidate["actual_pv"], result, candidate["played_usi"])

        candidate["pv_ja"] = pv_display_ja(sfen, candidate["pv"], candidate["previous_to"])
        candidate["actual_pv_ja"] = pv_display_ja(
            sfen, candidate["actual_pv"], candidate["previous_to"])
        if detail["bestAttempted"]:
            best_length_after = len(candidate["pv_ja"])
            lengths_after.append(best_length_after)
            detail["bestImproved"] = best_length_after > best_length_before
        if detail["actualAttempted"]:
            actual_length_after = len(candidate["actual_pv_ja"])
            lengths_after.append(actual_length_after)
            detail["actualImproved"] = actual_length_after > actual_length_before
        candidate["pv_refinement"] = detail
        move_analysis = move_analyses[position_index]
        move_analysis.update({
            "pv": candidate["pv"],
            "pvJa": candidate["pv_ja"],
            "actualPv": candidate["actual_pv"],
            "actualPvJa": candidate["actual_pv_ja"],
            "pvRefinement": detail,
        })
    summary["shortPvCandidates"] = len(lengths_before)
    summary["extraSearchExecuted"] = summary["bestSearches"] + summary["actualSearches"]
    summary["pvLengthBeforeAverage"] = average_length(lengths_before)
    summary["pvLengthAfterAverage"] = average_length(lengths_after)
    summary["pvLengthsBefore"] = lengths_before
    summary["pvLengthsAfter"] = lengths_after
    summary["improvedPvCount"] = sum(
        int(candidate["pv_refinement"][key])
        for candidate in flagged for key in ("bestImproved", "actualImproved")
    )
    summary["unchangedPvCount"] = summary["extraSearchExecuted"] - summary["improvedPvCount"]
    summary["elapsedSeconds"] = round(time.perf_counter() - started, 3)
    return summary


# ---------------------------------------------------------------------------
# Per-game analysis
# ---------------------------------------------------------------------------

def analyze_game(engine: UsiEngine, kif_path: Path, game_id: str, user: str,
                  nodes: int, loss_threshold: int, max_issues: int,
                  problem_pv_nodes: int = 60000, minimum_problem_pv_plies: int = 4,
                  refine_short_problem_pvs: bool = True) -> tuple[dict, dict, dict]:
    parsed = parse_kif(kif_path, game_id, user)
    positions = parsed["positions"]
    game = parsed["game"]
    moves = game["moves"]
    user_side = "sente" if game["side"] == "先手" else "gote" if game["side"] == "後手" else None
    if user_side is None:
        raise ValueError(f"{game_id}: could not determine {user}'s side from KIF headers")

    evaluations: list[dict] = []
    per_ply: dict[int, dict] = {}  # ply -> raw/normalized score, bestmove, PV
    base_started = time.perf_counter()
    for ply in range(0, moves + 1):
        sfen = positions[ply]["sfen"]
        side_to_move = "sente" if ply % 2 == 0 else "gote"
        result = engine.analyze(sfen, nodes)
        sente_sign = 1 if side_to_move == "sente" else -1
        normalized = score_json(result["score"], sente_sign)
        cp_sente = score_json_to_cp(normalized)
        evaluations.append({"ply": ply, "cp": cp_sente, "score": normalized})
        per_ply[ply] = {
            "raw_score": result["score"], "score_sente": normalized,
            "cp_sente": cp_sente, "bestmove": result["bestmove"], "pv": result["pv"],
        }
    base_analysis_seconds = time.perf_counter() - base_started

    move_analyses: list[dict] = []
    for ply in range(0, moves):
        played_usi = positions[ply + 1].get("usi")
        if not played_usi:
            continue
        board_before = shogi.Board(positions[ply]["sfen"])
        previous_usi = positions[ply].get("usi")
        previous_to = shogi.Move.from_usi(previous_usi).to_square if previous_usi else None
        best_usi = per_ply[ply]["bestmove"]
        best_pv = list(per_ply[ply]["pv"])
        if best_usi and best_usi not in ("resign", "win") and (not best_pv or best_pv[0] != best_usi):
            best_pv.insert(0, best_usi)
        actual_pv = [played_usi, *per_ply[ply + 1]["pv"]]
        score_before = score_json(per_ply[ply]["raw_score"], 1)
        score_after = score_json(per_ply[ply + 1]["raw_score"], -1)
        move_analyses.append({
            "ply": ply + 1,
            "scorePerspective": "mover",
            "scoreBefore": score_before,
            "actualMove": played_usi,
            "scoreAfterActual": score_after,
            "bestMove": best_usi,
            "bestScore": score_before,
            "pv": best_pv,
            "pvJa": pv_display_ja(positions[ply]["sfen"], best_pv, previous_to),
            "actualPv": actual_pv,
            "actualPvJa": pv_display_ja(positions[ply]["sfen"], actual_pv, previous_to),
        })

    candidates = []
    for ply in range(0, moves):
        mover = "sente" if ply % 2 == 0 else "gote"
        if mover != user_side:
            continue
        played_usi = positions[ply + 1].get("usi")
        if not played_usi:
            continue
        move_analysis = move_analyses[ply]
        before_mover = score_json_to_cp(move_analysis["scoreBefore"])
        after_mover = score_json_to_cp(move_analysis["scoreAfterActual"])
        best_usi = per_ply[ply]["bestmove"]
        if not best_usi or best_usi == "resign" or best_usi == "win":
            continue
        # Scores from two independent fixed-node searches can fluctuate slightly.
        # A move the engine itself selected must never be reported as a mistake.
        loss = 0 if played_usi == best_usi else max(0, before_mover - after_mover)
        board_before = shogi.Board(positions[ply]["sfen"])
        legal_ushi = {m.usi() for m in board_before.legal_moves}
        if best_usi not in legal_ushi:
            raise ValueError(f"{game_id} ply {ply}: engine bestmove {best_usi} is not legal")
        candidates.append({
            # PWA issue.ply denotes the move number (the resulting position),
            # while `ply` here denotes the position immediately before the move.
            "ply": ply + 1,
            "played_usi": played_usi,
            "best_usi": best_usi,
            "before_cp": per_ply[ply]["cp_sente"],
            "after_cp": per_ply[ply + 1]["cp_sente"],
            "loss": loss,
            "score_before": move_analysis["scoreBefore"],
            "score_after": move_analysis["scoreAfterActual"],
            "best_score": move_analysis["bestScore"],
            "pv": move_analysis["pv"],
            "pv_ja": move_analysis["pvJa"],
            "actual_pv": move_analysis["actualPv"],
            "actual_pv_ja": move_analysis["actualPvJa"],
            "board_before": board_before,
            "previous_to": shogi.Move.from_usi(positions[ply].get("usi")).to_square if positions[ply].get("usi") else None,
        })

    flagged = [c for c in candidates if c["loss"] >= loss_threshold]
    if not flagged and candidates:
        flagged = [max(candidates, key=lambda c: c["loss"])]
    flagged.sort(key=lambda c: -c["loss"])
    flagged = flagged[:max_issues]
    flagged.sort(key=lambda c: c["ply"])

    if refine_short_problem_pvs:
        refinement_summary = refine_problem_lines(
            engine, positions, flagged, move_analyses,
            problem_pv_nodes, minimum_problem_pv_plies,
        )
    else:
        short_lengths = [
            length
            for candidate in flagged
            for length in (len(candidate["pv_ja"]), len(candidate["actual_pv_ja"]))
            if length < minimum_problem_pv_plies
        ]
        refinement_summary = {
            "enabled": False,
            "nodesPerSearch": problem_pv_nodes,
            "triggerBelowPlies": minimum_problem_pv_plies,
            "issuesConsidered": len(flagged),
            "bestSearches": 0,
            "actualSearches": 0,
            "shortPvCandidates": len(short_lengths),
            "extraSearchExecuted": 0,
            "pvLengthBeforeAverage": average_length(short_lengths),
            "pvLengthAfterAverage": average_length(short_lengths),
            "pvLengthsBefore": short_lengths,
            "pvLengthsAfter": short_lengths,
            "improvedPvCount": 0,
            "unchangedPvCount": 0,
            "elapsedSeconds": 0.0,
        }

    verified_issues = []
    game_issues = []
    for c in flagged:
        mover = user_side
        played_ja = move_display_ja(c["played_usi"], c["board_before"], mover, c["previous_to"])
        best_ja = move_display_ja(c["best_usi"], c["board_before"], mover, c["previous_to"])
        points = grounded_points(positions[c["ply"] - 1]["sfen"], c["pv"], c["best_score"])
        verified_issues.append({
            "ply": c["ply"],
            "played": c["played_usi"],
            "best": c["best_usi"],
            "beforeCp": c["before_cp"],
            "afterCp": c["after_cp"],
            "lossCp": c["loss"],
            "scorePerspective": "mover",
            "scoreBefore": c["score_before"],
            "scoreAfterActual": c["score_after"],
            "bestScore": c["best_score"],
            "playedJa": played_ja,
            "bestJa": best_ja,
            "pv": c["pv"],
            "pvJa": c["pv_ja"],
            "actualPv": c["actual_pv"],
            "actualPvJa": c["actual_pv_ja"],
            "pvRefinement": c.get("pv_refinement", {
                "bestAttempted": False, "bestImproved": False,
                "actualAttempted": False, "actualImproved": False,
            }),
            "points": points,
        })
        game_issues.append({
            "ply": c["ply"],
            "move": played_ja,
            "best": c["best_usi"],
            "loss": c["loss"],
            "category": category_of(c["ply"], moves),
            "comment": make_comment(best_ja),
        })

    sente_name, gote_name = game["sente"], game["gote"]
    analysis_json = {
        "schemaVersion": 2,
        "gameId": game_id,
        "date": game["date"].replace("/", "-"),
        "sente": sente_name,
        "gote": gote_name,
        "userSide": user_side,
        "result": game["result"],
        "moves": moves,
        "engine": {
            "name": "YaneuraOu + Suisho5",
            "status": "analyzed",
            "nodesPerPosition": nodes,
            "scorePerspective": "sente",
            "problemPvRefinement": refinement_summary,
        },
        "evaluations": evaluations,
        "moveAnalyses": move_analyses,
        "verifiedIssues": verified_issues,
    }
    game_json = {
        "schemaVersion": 1,
        "game": {
            "id": game_id,
            "title": game["title"],
            "result": game["result"],
            "moves": moves,
            "date": game["date"],
            "side": game["side"],
        },
        "positions": positions,
        "issues": game_issues,
    }
    metrics_json = build_analysis_metrics(
        game_id, len(evaluations), len(verified_issues),
        base_analysis_seconds, refinement_summary,
    )
    return analysis_json, game_json, metrics_json


def refresh_existing_problem_pvs(engine: UsiEngine, kif_path: Path, game_id: str,
                                 user: str, analysis_json: dict, nodes: int,
                                 minimum_plies: int) -> dict:
    """Refresh only short PVs in an existing schema-v2 analysis; never rerun all positions."""
    if analysis_json.get("schemaVersion") != 2:
        raise ValueError(f"{game_id}: --refresh-problem-pv requires schemaVersion 2")
    parsed = parse_kif(kif_path, game_id, user)
    positions = parsed["positions"]
    move_analyses = analysis_json.get("moveAnalyses", [])
    if len(move_analyses) != parsed["game"]["moves"]:
        raise ValueError(f"{game_id}: moveAnalyses count mismatch")

    candidates = []
    issue_by_ply = {issue["ply"]: issue for issue in analysis_json.get("verifiedIssues", [])}
    for ply, issue in sorted(issue_by_ply.items()):
        move_analysis = move_analyses[ply - 1]
        previous_usi = positions[ply - 1].get("usi")
        candidates.append({
            "ply": ply,
            "played_usi": issue["played"],
            "best_usi": issue["best"],
            "best_score": issue.get("bestScore", move_analysis.get("bestScore", {"type": "cp", "value": 0})),
            "pv": list(issue.get("pv") or []),
            "pv_ja": list(issue.get("pvJa") or []),
            "actual_pv": list(issue.get("actualPv") or []),
            "actual_pv_ja": list(issue.get("actualPvJa") or []),
            "previous_to": shogi.Move.from_usi(previous_usi).to_square if previous_usi else None,
        })
    summary = refine_problem_lines(
        engine, positions, candidates, move_analyses, nodes, minimum_plies)
    for candidate in candidates:
        issue = issue_by_ply[candidate["ply"]]
        issue.update({
            "pv": candidate["pv"],
            "pvJa": candidate["pv_ja"],
            "actualPv": candidate["actual_pv"],
            "actualPvJa": candidate["actual_pv_ja"],
            "pvRefinement": candidate["pv_refinement"],
            "points": grounded_points(
                positions[candidate["ply"] - 1]["sfen"],
                candidate["pv"], candidate["best_score"],
            ),
        })
    analysis_json.setdefault("engine", {})["problemPvRefinement"] = summary
    return analysis_json


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--engine", required=True, help="path to a local YaneuraOu executable (never downloaded by this script)")
    ap.add_argument("--eval-dir", default=None, help="directory containing Suisho5's nn.bin (never downloaded by this script)")
    ap.add_argument("--games", nargs="+", required=True, help="game ids, e.g. 20260910_taatoru_cat (expects games/<id>.kif)")
    ap.add_argument("--user", default="sonao81")
    ap.add_argument("--nodes", type=int, default=30000, help="nodes per position (default matches docs/ADDING_GAMES.md)")
    ap.add_argument("--problem-pv-nodes", type=int, default=60000,
                    help="one extra forced-move search for short problem PVs")
    ap.add_argument("--min-problem-pv-plies", type=int, default=4,
                    help="refine problem PV branches shorter than this many plies")
    ap.add_argument("--no-problem-pv-refinement", action="store_true",
                    help="disable the short-PV refinement pass (benchmarking)")
    ap.add_argument("--refresh-problem-pv", action="store_true",
                    help="refresh only short PVs in existing schema-v2 analysis JSON")
    ap.add_argument("--loss-threshold", type=int, default=300, help="cp loss to flag as a 課題局面 candidate")
    ap.add_argument("--max-issues", type=int, default=6, help="cap on flagged issues per game")
    ap.add_argument("--threads", type=int, default=1)
    ap.add_argument("--hash-mb", type=int, default=1024)
    ap.add_argument("--option", action="append", default=[], metavar="NAME=VALUE",
                     help="extra setoption, e.g. --option FV_SCALE=24 (repeatable)")
    ap.add_argument("--games-dir", type=Path, default=ROOT / "games")
    ap.add_argument("--analysis-dir", type=Path, default=ROOT / "analysis")
    ap.add_argument("--dry-run-out", type=Path, default=None,
                     help="write output under this directory instead of games/ and analysis/ (for testing)")
    args = ap.parse_args()
    if args.problem_pv_nodes <= 0 or args.min_problem_pv_plies <= 0:
        raise SystemExit("problem PV nodes and minimum plies must be positive")
    if args.refresh_problem_pv and args.no_problem_pv_refinement:
        raise SystemExit("--refresh-problem-pv cannot be combined with --no-problem-pv-refinement")

    extra_options = {}
    for item in args.option:
        if "=" not in item:
            raise SystemExit(f"--option must be NAME=VALUE, got: {item}")
        k, v = item.split("=", 1)
        extra_options[k] = v

    engine = UsiEngine(args.engine, args.eval_dir, extra_options, args.threads, args.hash_mb)
    games_out = args.dry_run_out / "games" if args.dry_run_out else args.games_dir
    analysis_out = args.dry_run_out / "analysis" if args.dry_run_out else args.analysis_dir
    metrics_out = analysis_out / "metrics"
    games_out.mkdir(parents=True, exist_ok=True)
    analysis_out.mkdir(parents=True, exist_ok=True)
    metrics_out.mkdir(parents=True, exist_ok=True)

    summary = []
    try:
        for game_id in args.games:
            kif_path = args.games_dir / f"{game_id}.kif"
            if not kif_path.exists():
                raise SystemExit(f"missing KIF: {kif_path}")
            print(f"== analyzing {game_id} ({kif_path}) ==", file=sys.stderr)
            if args.refresh_problem_pv:
                analysis_path = args.analysis_dir / f"{game_id}.json"
                game_path = args.games_dir / f"{game_id}.json"
                if not analysis_path.exists() or not game_path.exists():
                    raise SystemExit(f"missing existing JSON for PV refresh: {game_id}")
                analysis_json = refresh_existing_problem_pvs(
                    engine, kif_path, game_id, args.user,
                    json.loads(analysis_path.read_text(encoding="utf-8")),
                    args.problem_pv_nodes, args.min_problem_pv_plies,
                )
                game_json = json.loads(game_path.read_text(encoding="utf-8"))
                metrics_json = None
            else:
                analysis_json, game_json, metrics_json = analyze_game(
                    engine, kif_path, game_id, args.user,
                    args.nodes, args.loss_threshold, args.max_issues,
                    args.problem_pv_nodes, args.min_problem_pv_plies,
                    not args.no_problem_pv_refinement,
                )
            (analysis_out / f"{game_id}.json").write_text(
                json.dumps(analysis_json, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            (games_out / f"{game_id}.json").write_text(
                json.dumps(game_json, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            if metrics_json is not None:
                (metrics_out / f"{game_id}.json").write_text(
                    json.dumps(metrics_json, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            summary.append({
                "gameId": game_id,
                "moves": analysis_json["moves"],
                "positionsAnalyzed": len(analysis_json["evaluations"]),
                "issuesFound": len(analysis_json["verifiedIssues"]),
                "maxLossCp": max((i["lossCp"] for i in analysis_json["verifiedIssues"]), default=0),
                "problemPvRefinement": analysis_json.get("engine", {}).get("problemPvRefinement"),
                "metricsRecorded": metrics_json is not None,
            })
            print(f"   done: {summary[-1]}", file=sys.stderr)
    finally:
        engine.quit()

    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
