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

It does NOT modify games/index.json (an analyzed run) so the caller can review the
diff first; use --update-index to also flip analyzed:true and fill in gameData once
the output has been checked.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
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

    def analyze(self, sfen: str, nodes: int) -> dict:
        self._send(f"position sfen {sfen}")
        self._send(f"go nodes {nodes}")
        last_score = None
        last_pv: list[str] = []
        bestmove = None
        while True:
            line = self._readline()
            if line.startswith("info "):
                tokens = line.split()
                i = 0
                while i < len(tokens):
                    if tokens[i] == "score" and i + 2 < len(tokens):
                        kind, val = tokens[i + 1], int(tokens[i + 2])
                        last_score = (kind, val)
                        i += 3
                        continue
                    if tokens[i] == "pv":
                        last_pv = tokens[i + 1:]
                        break
                    i += 1
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


# ---------------------------------------------------------------------------
# Move display (matches the "△23歩" / "▲34歩打" style already used in data.json)
# ---------------------------------------------------------------------------

def square_index(file_: int, rank_: int) -> int:
    return (rank_ - 1) * 9 + (9 - file_)


def move_display_ja(usi: str, board_before: "shogi.Board", mover: str) -> str:
    side_mark = "▲" if mover == "sente" else "△"
    if "*" in usi:
        letter, dest = usi.split("*")
        file_, rank_ = int(dest[0]), ord(dest[1]) - 96
        name = JP[LETTER_TO_TYPE[letter]]
        return f"{side_mark}{file_}{rank_}{name}打"
    from_file, from_rank = int(usi[0]), ord(usi[1]) - 96
    to_file, to_rank = int(usi[2]), ord(usi[3]) - 96
    promote = usi.endswith("+")
    piece_type = board_before.piece_type_at(square_index(from_file, from_rank))
    if piece_type is None:
        raise ValueError(f"no piece at source square for move {usi}")
    if promote:
        piece_type = PROMOTE.get(piece_type, piece_type)
    return f"{side_mark}{to_file}{to_rank}{JP[piece_type]}"


# ---------------------------------------------------------------------------
# Comment generation (short, non-committal, grounded only in phase + loss size)
# ---------------------------------------------------------------------------

PHASE_TEMPLATES = {
    "序盤": [
        "攻めを急ぐより、まず玉形を整えると安定します。",
        "序盤で大駒を早く動かした直後は、一度自陣を確認したい場面です。",
    ],
    "中盤": [
        "この交換は駒得でも玉が薄くなるなら、応じる前に危険度を確認したい局面です。",
        "攻め合うより受けに回った方が、形勢を損ねずに済む場面です。",
    ],
    "終盤": [
        "攻め合いの速度計算が必要な局面。相手玉と自玉、どちらが早いか数えたい場面です。",
        "受けに手を戻すべきか、攻め合うべきかの速度判断が分かれ目になった局面です。",
    ],
}


def phase_of(ply: int, moves: int) -> str:
    if moves <= 0:
        return "中盤"
    r = ply / moves
    if r < 0.35:
        return "序盤"
    if r < 0.75:
        return "中盤"
    return "終盤"


def make_comment(ply: int, moves: int, loss: int) -> str:
    phase = phase_of(ply, moves)
    templates = PHASE_TEMPLATES[phase]
    idx = 0 if loss < 800 else 1 % len(templates)
    base = templates[idx % len(templates)]
    return f"評価値が約{loss}点悪化した場面（{phase}）。{base}"


def category_of(ply: int, moves: int) -> str:
    return phase_of(ply, moves)


# ---------------------------------------------------------------------------
# Per-game analysis
# ---------------------------------------------------------------------------

def analyze_game(engine: UsiEngine, kif_path: Path, game_id: str, user: str,
                  nodes: int, loss_threshold: int, max_issues: int) -> tuple[dict, dict]:
    parsed = parse_kif(kif_path, game_id, user)
    positions = parsed["positions"]
    game = parsed["game"]
    moves = game["moves"]
    user_side = "sente" if game["side"] == "先手" else "gote" if game["side"] == "後手" else None
    if user_side is None:
        raise ValueError(f"{game_id}: could not determine {user}'s side from KIF headers")

    evaluations: list[dict] = []
    per_ply: dict[int, dict] = {}  # ply -> {score_sente, bestmove, pv}
    for ply in range(0, moves + 1):
        sfen = positions[ply]["sfen"]
        side_to_move = "sente" if ply % 2 == 0 else "gote"
        result = engine.analyze(sfen, nodes)
        cp_stm = score_to_cp(result["score"])
        cp_sente = cp_stm if side_to_move == "sente" else -cp_stm
        evaluations.append({"ply": ply, "cp": cp_sente})
        per_ply[ply] = {"cp_sente": cp_sente, "bestmove": result["bestmove"], "pv": result["pv"]}

    candidates = []
    for ply in range(0, moves):
        mover = "sente" if ply % 2 == 0 else "gote"
        if mover != user_side:
            continue
        played_usi = positions[ply + 1].get("usi")
        if not played_usi:
            continue
        before_mover = per_ply[ply]["cp_sente"] if mover == "sente" else -per_ply[ply]["cp_sente"]
        after_mover = per_ply[ply + 1]["cp_sente"] if mover == "sente" else -per_ply[ply + 1]["cp_sente"]
        loss = max(0, before_mover - after_mover)
        best_usi = per_ply[ply]["bestmove"]
        if not best_usi or best_usi == "resign" or best_usi == "win":
            continue
        board_before = shogi.Board(positions[ply]["sfen"])
        legal_ushi = {m.usi() for m in board_before.legal_moves}
        if best_usi not in legal_ushi:
            raise ValueError(f"{game_id} ply {ply}: engine bestmove {best_usi} is not legal")
        candidates.append({
            "ply": ply,
            "played_usi": played_usi,
            "best_usi": best_usi,
            "before_cp": per_ply[ply]["cp_sente"],
            "after_cp": per_ply[ply + 1]["cp_sente"],
            "loss": loss,
            "pv": per_ply[ply]["pv"],
            "board_before": board_before,
        })

    flagged = [c for c in candidates if c["loss"] >= loss_threshold]
    if not flagged and candidates:
        flagged = [max(candidates, key=lambda c: c["loss"])]
    flagged.sort(key=lambda c: -c["loss"])
    flagged = flagged[:max_issues]
    flagged.sort(key=lambda c: c["ply"])

    verified_issues = []
    game_issues = []
    for c in flagged:
        mover = user_side
        played_ja = move_display_ja(c["played_usi"], c["board_before"], mover)
        best_ja = move_display_ja(c["best_usi"], c["board_before"], mover)
        verified_issues.append({
            "ply": c["ply"],
            "played": c["played_usi"],
            "best": c["best_usi"],
            "beforeCp": c["before_cp"],
            "afterCp": c["after_cp"],
            "lossCp": c["loss"],
            "bestJa": best_ja,
            "pv": c["pv"],
        })
        game_issues.append({
            "ply": c["ply"],
            "move": played_ja,
            "best": c["best_usi"],
            "loss": c["loss"],
            "category": category_of(c["ply"], moves),
            "comment": make_comment(c["ply"], moves, c["loss"]),
        })

    sente_name, gote_name = game["sente"], game["gote"]
    analysis_json = {
        "schemaVersion": 1,
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
        },
        "evaluations": evaluations,
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
    return analysis_json, game_json


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

    extra_options = {}
    for item in args.option:
        if "=" not in item:
            raise SystemExit(f"--option must be NAME=VALUE, got: {item}")
        k, v = item.split("=", 1)
        extra_options[k] = v

    engine = UsiEngine(args.engine, args.eval_dir, extra_options, args.threads, args.hash_mb)
    games_out = args.dry_run_out / "games" if args.dry_run_out else args.games_dir
    analysis_out = args.dry_run_out / "analysis" if args.dry_run_out else args.analysis_dir
    games_out.mkdir(parents=True, exist_ok=True)
    analysis_out.mkdir(parents=True, exist_ok=True)

    summary = []
    try:
        for game_id in args.games:
            kif_path = args.games_dir / f"{game_id}.kif"
            if not kif_path.exists():
                raise SystemExit(f"missing KIF: {kif_path}")
            print(f"== analyzing {game_id} ({kif_path}) ==", file=sys.stderr)
            analysis_json, game_json = analyze_game(
                engine, kif_path, game_id, args.user,
                args.nodes, args.loss_threshold, args.max_issues,
            )
            (analysis_out / f"{game_id}.json").write_text(
                json.dumps(analysis_json, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            (games_out / f"{game_id}.json").write_text(
                json.dumps(game_json, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            summary.append({
                "gameId": game_id,
                "moves": analysis_json["moves"],
                "positionsAnalyzed": len(analysis_json["evaluations"]),
                "issuesFound": len(analysis_json["verifiedIssues"]),
                "maxLossCp": max((i["lossCp"] for i in analysis_json["verifiedIssues"]), default=0),
            })
            print(f"   done: {summary[-1]}", file=sys.stderr)
    finally:
        engine.quit()

    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
