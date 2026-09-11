"""Shared queue validation helpers for the local importer and polling worker."""
from __future__ import annotations

import hashlib
import json
import tempfile
from pathlib import Path

from kif_to_game import parse as parse_kif

MAX_KIF_BYTES = 128 * 1024


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
