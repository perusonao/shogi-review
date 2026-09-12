"""Shared queue validation helpers for the local importer and polling worker."""
from __future__ import annotations

import hashlib
import json
import tempfile
import re
import unicodedata
from datetime import datetime
from pathlib import Path

from kif_to_game import parse as parse_kif

MAX_KIF_BYTES = 128 * 1024


def normalize_provider(value: str | None) -> str | None:
    text = unicodedata.normalize("NFKC", value or "").strip().casefold()
    aliases = {"将棋ウォーズ": "shogi-wars", "shogi wars": "shogi-wars",
               "shogiwars": "shogi-wars", "shogi-wars": "shogi-wars"}
    return aliases.get(text, re.sub(r"[^a-z0-9]+", "-", text).strip("-") or None)


def normalize_rank(value: str | None) -> dict | None:
    text = unicodedata.normalize("NFKC", value or "").strip()
    match = re.fullmatch(r"(\d+|[初一二三四五六七八九十])(級|段)", text)
    if not match:
        return None
    numbers = {"初": 1, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
               "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}
    number = int(match[1]) if match[1].isdigit() else numbers[match[1]]
    if (match[2] == "級" and not 1 <= number <= 10) or number < 1:
        return None
    return {"rankType": "kyu" if match[2] == "級" else "dan", "rankNumber": number,
            "rankOrder": 10 - number if match[2] == "級" else 9 + number,
            "label": f"{number}級" if match[2] == "級" else ("初段" if number == 1 else f"{number}段")}


def normalize_time_control(value: str | None) -> dict | None:
    raw = unicodedata.normalize("NFKC", value or "").strip()
    if re.fullmatch(r"\d+m-sudden-death|\d+m-\d+s-byoyomi|\d+s-per-move", raw):
        return {"id": raw, "raw": raw, "status": "available"}
    for pattern, formatter in ((r"(\d+)分切れ負け", lambda m: f"{int(m[1])}m-sudden-death"),
                               (r"(\d+)分\+(\d+)秒", lambda m: f"{int(m[1])}m-{int(m[2])}s-byoyomi"),
                               (r"(\d+)秒", lambda m: f"{int(m[1])}s-per-move")):
        match = re.fullmatch(pattern, raw)
        if match:
            return {"id": formatter(match), "raw": raw, "status": "available"}
    return {"id": "other", "raw": raw, "status": "unavailable-normalization"} if raw else None


def submission_metadata(kif: str, parsed: dict) -> dict:
    headers = {}
    for line in kif.replace("\r\n", "\n").replace("\r", "\n").splitlines():
        if "：" in line:
            key, value = line.split("：", 1)
            headers.setdefault(key.strip(), value.strip())
    game = parsed["game"]
    result = game.get("result", "")
    winner = "sente" if result.startswith("先手") else "gote" if result.startswith("後手") else None
    started = headers.get("開始日時", "")
    try:
        observed_at = datetime.strptime(started, "%Y/%m/%d %H:%M:%S").isoformat()
    except ValueError:
        observed_at = datetime.strptime(started[:16], "%Y/%m/%d %H:%M").isoformat()
    players = []
    for side, name_key, rank_key in (("sente", "先手", "先手段級"), ("gote", "後手", "後手段級")):
        raw_rank = headers.get(rank_key)
        players.append({"username": headers.get(name_key), "side": side, "officialRankSource": "kif" if raw_rank else "unknown",
                        "result": "draw" if winner is None else ("win" if winner == side else "loss"),
                        "officialRankRaw": raw_rank, "officialRank": normalize_rank(raw_rank)})
    return {"schemaVersion": "pwa-kif-metadata-v1", "provider": normalize_provider(headers.get("場所")),
            "providerRaw": headers.get("場所"), "timeControl": (normalize_time_control(headers.get("持ち時間")) or {}).get("id"),
            "timeControlRaw": headers.get("持ち時間"), "gameStartedAt": observed_at, "players": players}


def validate_submission_metadata(kif: str, parsed: dict, supplied: dict) -> dict:
    """Reparse immutable KIF fields and validate queue-confirmed UNKNOWN values."""
    expected = submission_metadata(kif, parsed)
    if not isinstance(supplied, dict) or supplied.get("schemaVersion") != "pwa-kif-metadata-v1":
        raise ValueError("calibration metadata is missing")
    for key in ("gameStartedAt",):
        if supplied.get(key) != expected.get(key):
            raise ValueError(f"calibration {key} mismatch")
    if expected["provider"] and supplied.get("provider") != expected["provider"]:
        raise ValueError("calibration provider mismatch")
    if expected["timeControl"] and supplied.get("timeControl") != expected["timeControl"]:
        raise ValueError("calibration time control mismatch")
    supplied_players = {item.get("side"): item for item in supplied.get("players", []) if isinstance(item, dict)}
    for player in expected["players"]:
        actual = supplied_players.get(player["side"])
        if not actual or any(actual.get(key) != player.get(key) for key in ("username", "side", "result")):
            raise ValueError("calibration player mismatch")
        if player["officialRank"] and actual.get("officialRank") != player["officialRank"]:
            raise ValueError("calibration rank mismatch")
        if actual.get("officialRank") is not None and normalize_rank(actual.get("officialRankRaw")) != actual.get("officialRank"):
            raise ValueError("calibration rank normalization mismatch")
    return supplied


def canonical_fingerprint(parsed: dict) -> str:
    game = parsed["game"]
    moves = [position.get("usi", "") for position in parsed["positions"][1:]]
    payload = json.dumps(
        [game.get("date"), game.get("sente"), game.get("gote"), moves],
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def validate_kif_text(kif: str, user: str = "ぺるそなお") -> tuple[dict, str]:
    if not isinstance(kif, str) or not kif.strip():
        raise ValueError("KIF本文がありません")
    if "\x00" in kif:
        raise ValueError("KIFに使用できない文字があります")
    if len(kif.encode("utf-8")) > MAX_KIF_BYTES:
        raise ValueError("KIFが128KBを超えています")
    with tempfile.TemporaryDirectory(prefix="shogi-queue-validate-") as temporary:
        path = Path(temporary) / "request.kif"
        path.write_text(kif, encoding="utf-8")
        parsed = parse_kif(path, "pending", user)
    game = parsed.get("game", {})
    if not game.get("moves") or game.get("result") == "結果不明":
        raise ValueError("終局済みのKIFが必要です")
    return parsed, canonical_fingerprint(parsed)
