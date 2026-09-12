#!/usr/bin/env python3
"""Run isolated, fixed-move Reason searches without touching production JSON."""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path

import shogi

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from analyze_with_suisho5 import UsiEngine, move_display_ja, pv_display_ja, score_json  # noqa: E402
from import_new_games import DEFAULT_ENGINE, DEFAULT_EVAL_DIR  # noqa: E402

TOP10 = [
    ("20260911_ryunenbb", 80), ("20260911_ak69boy", 131),
    ("20260911_夢への旅路", 42), ("20260911_nagata2532", 28),
    ("20260911_しゅん", 79), ("20260911_夢への旅路", 50),
    ("20260911_夢への旅路", 84), ("20260910_taatoru_cat", 67),
    ("20260911_おまつ", 80), ("20260911_じゅんや", 44),
]
REQUIRED = [
    ("20260911_ryunenbb", 80), ("20260912_しゅえい", 77),
    ("20260912_しゅえい", 79), ("20260912_しゅえい", 159),
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_fixture(root: Path, game_id: str, ply: int) -> dict:
    game = json.loads((root / "games" / f"{game_id}.json").read_text(encoding="utf-8"))
    analysis = json.loads((root / "analysis" / f"{game_id}.json").read_text(encoding="utf-8"))
    issue = next((row for row in analysis.get("verifiedIssues", []) if int(row.get("ply", 0)) == ply), None)
    if issue is None:
        raise ValueError(f"missing verified issue: {game_id} ply {ply}")
    sfen = game["positions"][ply - 1]["sfen"]
    board = shogi.Board(sfen)
    moves = {"actual": issue.get("played"), "recommended": issue.get("best")}
    for label, usi in moves.items():
        try:
            move = shogi.Move.from_usi(usi or "")
        except ValueError as exc:
            raise ValueError(f"invalid {label} move: {game_id} {ply} {usi}") from exc
        if move not in board.legal_moves:
            raise ValueError(f"illegal {label} move: {game_id} {ply} {usi}")
    mover = "sente" if board.turn == shogi.BLACK else "gote"
    return {
        "requestId": f"{game_id}-{ply}", "gameId": game_id, "title": game["game"]["title"],
        "ply": ply, "position": {"sfen": sfen},
        "userSide": "sente" if game["game"].get("side") == "先手" else "gote",
        "actualMove": moves["actual"],
        "actualMoveJa": issue.get("playedJa") or move_display_ja(moves["actual"], board, mover),
        "bestMove": moves["recommended"],
        "bestMoveJa": issue.get("bestJa") or move_display_ja(moves["recommended"], board, mover),
    }


def branch_search(engine: UsiEngine, fixture: dict, label: str, nodes: int) -> dict:
    move = fixture["actualMove"] if label == "actual" else fixture["bestMove"]
    board = shogi.Board(fixture["position"]["sfen"])
    board.push(shogi.Move.from_usi(move))
    result = engine.analyze(board.sfen(), nodes)
    pv = [move, *result.get("pv", [])]
    child_score = result.get("score")
    root_score = None if child_score is None else (child_score[0], -child_score[1])
    return {
        "fixedMove": move, "score": score_json(root_score),
        "pv": pv, "pvJa": pv_display_ja(fixture["position"]["sfen"], pv),
        "bestReply": result.get("bestmove"),
        "branchFeatures": None, "searchNodes": nodes,
        "nodesReported": result.get("nodes", 0), "engineTimeMs": result.get("timeMs", 0),
        "wallTimeMs": result.get("wallTimeMs", 0), "nps": result.get("nps", 0),
    }


def reply_multipv(engine: UsiEngine, fixture: dict, label: str, nodes: int) -> dict:
    move = fixture["actualMove"] if label == "actual" else fixture["bestMove"]
    board = shogi.Board(fixture["position"]["sfen"])
    board.push(shogi.Move.from_usi(move))
    result = engine.analyze_multipv(board.sfen(), nodes, 2)
    lines = []
    for line in result["lines"]:
        full_pv = [move, *line["pv"]]
        lines.append({
            "rank": line["rank"], "replyScore": score_json(line["score"]),
            "replyPv": line["pv"], "fullPv": full_pv,
            "fullPvJa": pv_display_ja(fixture["position"]["sfen"], full_pv),
        })
    return {
        "afterFixedMove": move, "searchNodes": nodes, "lines": lines,
        "nodesReported": result.get("nodes", 0), "engineTimeMs": result.get("timeMs", 0),
        "wallTimeMs": result.get("wallTimeMs", 0), "nps": result.get("nps", 0),
    }


def run_experiment(root: Path, engine_path: Path, eval_dir: Path, output: Path,
                   include_120k: bool = True, include_multipv2: bool = True) -> dict:
    if not engine_path.is_file():
        raise FileNotFoundError(engine_path)
    eval_file = eval_dir / "nn.bin"
    if not eval_file.is_file():
        raise FileNotFoundError(eval_file)
    ordered = list(dict.fromkeys([*TOP10, *REQUIRED]))
    fixtures = [load_fixture(root, game_id, ply) for game_id, ply in ordered]
    critical = {f"{game_id}-{ply}" for game_id, ply in REQUIRED}
    payload = {
        "schema": "reason-branch-v1", "schemaVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "scope": {"top10": len(TOP10), "mandatoryFixtures": len(REQUIRED), "uniquePositions": len(fixtures)},
        "engine": {
            "name": "YaneuraOu + Suisho5", "executable": engine_path.name,
            "executableSha256": sha256(engine_path), "evalFile": eval_file.name,
            "evalSha256": sha256(eval_file), "threads": 1, "hashMb": 1024,
            "platform": platform.platform(),
        },
        "profiles": {"fixed": [30000, 60000], "conditional": [120000] if include_120k else [],
                     "multiPv2": {"nodes": 60000, "scope": "opponent replies after fixed move"} if include_multipv2 else None},
        "results": [],
    }
    engine = UsiEngine(str(engine_path), str(eval_dir), {}, 1, 1024)
    try:
        for fixture in fixtures:
            result = {**fixture, "searches": {}}
            for nodes in (30000, 60000):
                result["searches"][str(nodes)] = {
                    label: branch_search(engine, fixture, label, nodes)
                    for label in ("actual", "recommended")
                }
            if include_120k and fixture["requestId"] in critical:
                result["searches"]["120000"] = {
                    label: branch_search(engine, fixture, label, 120000)
                    for label in ("actual", "recommended")
                }
            if include_multipv2 and fixture["requestId"] in critical:
                result["multiPv2"] = {
                    label: reply_multipv(engine, fixture, label, 60000)
                    for label in ("actual", "recommended")
                }
            payload["results"].append(result)
    finally:
        engine.quit()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", type=Path, default=DEFAULT_ENGINE)
    parser.add_argument("--eval-dir", type=Path, default=DEFAULT_EVAL_DIR)
    parser.add_argument("--output", type=Path, default=ROOT / "reason-additional-search.raw.tmp")
    parser.add_argument("--no-120k", action="store_true")
    parser.add_argument("--no-multipv2", action="store_true")
    args = parser.parse_args()
    payload = run_experiment(ROOT, args.engine, args.eval_dir, args.output,
                             not args.no_120k, not args.no_multipv2)
    print(json.dumps({"output": str(args.output), "positions": len(payload["results"])}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
