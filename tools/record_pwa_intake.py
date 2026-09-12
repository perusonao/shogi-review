#!/usr/bin/env python3
"""Record one already-successful analysis in the idempotent PWA intake registry."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from pwa_intake import intake_player_games


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--game-id", required=True)
    parser.add_argument("--payload", required=True)
    args = parser.parse_args()
    payload = json.loads(args.payload)
    path = intake_player_games(args.root.resolve(), args.game_id, payload["fingerprint"], payload["metadata"])
    print(path)


if __name__ == "__main__":
    main()
