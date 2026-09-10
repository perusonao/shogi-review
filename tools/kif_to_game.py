#!/usr/bin/env python3
"""Convert a standard-position Japanese KIF into shogi-review game JSON.

Requires: pip install python-shogi
Usage:
  python tools/kif_to_game.py games/20260910_taatoru_cat.kif \
    --id 20260910_taatoru_cat --user sonao81 \
    --out games/20260910_taatoru_cat.json

The converter does not invent engine evaluations or issue judgements.
"""
from __future__ import annotations
import argparse, json, re
from pathlib import Path

try:
    import shogi
except ImportError as exc:
    raise SystemExit("python-shogi is required: pip install python-shogi") from exc

FW = "１２３４５６７８９"
RK = "一二三四五六七八九"
PIECE = {"歩":"P","香":"L","桂":"N","銀":"S","金":"G","角":"B","飛":"R","玉":"K","王":"K"}


def digit(ch: str) -> int:
    return FW.index(ch) + 1 if ch in FW else int(ch)


def rank(ch: str) -> int:
    return RK.index(ch) + 1 if ch in RK else int(ch)


def parse_move(text: str, board: "shogi.Board") -> str:
    body = text.strip()
    m = re.match(r"([1-9１-９])([一二三四五六七八九1-9])(.+)$", body)
    if not m:
        raise ValueError(f"unsupported move: {text}")
    tf, tr = digit(m.group(1)), rank(m.group(2))
    rest = m.group(3)
    src = re.search(r"\(([1-9])([1-9])\)", rest)
    drop = "打" in rest and not src
    promote = "成" in rest and not rest.startswith(("成銀","成桂","成香"))
    if drop:
        name = rest.split("打", 1)[0]
        key = next((PIECE[k] for k in PIECE if name.startswith(k)), None)
        if not key:
            raise ValueError(f"unknown drop piece: {text}")
        return f"{key}*{tf}{chr(96+tr)}"
    if not src:
        raise ValueError(f"source square missing: {text}")
    sf, sr = int(src.group(1)), int(src.group(2))
    return f"{sf}{chr(96+sr)}{tf}{chr(96+tr)}" + ("+" if promote else "")


def parse(path: Path, game_id: str, user: str) -> dict:
    lines = path.read_text(encoding="utf-8-sig").splitlines()
    meta = {}
    for line in lines:
        for key in ("開始日時","終了日時","場所","持ち時間","先手","後手","先手段級","後手段級"):
            if line.startswith(key + "："):
                meta[key] = line.split("：",1)[1].strip()
    board = shogi.Board()
    positions = [{"ply":0,"sfen":board.sfen(),"last":"開始局面"}]
    last_ply = 0
    resignation_side = None
    for line in lines:
        mm = re.match(r"\s*(\d+)\s+(.+?)(?:\s+\(|$)", line)
        if not mm:
            continue
        n, move_text = int(mm.group(1)), mm.group(2).strip()
        if move_text == "投了":
            resignation_side = "先手" if n % 2 == 1 else "後手"
            break
        usi = parse_move(move_text, board)
        move = shogi.Move.from_usi(usi)
        if move not in board.legal_moves:
            raise ValueError(f"illegal move at {n}: {move_text} -> {usi}")
        board.push(move)
        last_ply = n
        positions.append({"ply":n,"sfen":board.sfen(),"last":move_text,"usi":usi})
    sente, gote = meta.get("先手","先手"), meta.get("後手","後手")
    user_side = "先手" if sente == user else "後手" if gote == user else "不明"
    if resignation_side:
        winner = "後手" if resignation_side == "先手" else "先手"
        result = f"{winner}・{sente if winner=='先手' else gote} 勝利"
    else:
        result = "結果不明"
    return {
        "schemaVersion":1,
        "game":{"id":game_id,"date":meta.get("開始日時","").split(" ")[0].replace("-","/"),"title":f"{sente} vs {gote}","sente":sente,"gote":gote,"side":user_side,"result":result,"moves":last_ply,"timeControl":meta.get("持ち時間","")},
        "positions":positions,
        "issues":[]
    }


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("kif",type=Path); ap.add_argument("--id",required=True); ap.add_argument("--user",default="sonao81"); ap.add_argument("--out",type=Path,required=True)
    a=ap.parse_args(); data=parse(a.kif,a.id,a.user); a.out.parent.mkdir(parents=True,exist_ok=True); a.out.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(f"wrote {a.out}: {len(data['positions'])-1} moves")
if __name__=="__main__": main()
