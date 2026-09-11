#!/usr/bin/env python3
"""Prompt for a secret and print only its SHA-256 hash for Worker configuration."""
from __future__ import annotations

import getpass
import hashlib


def main() -> None:
    first = getpass.getpass("Secret: ")
    second = getpass.getpass("Secret again: ")
    if first != second or len(first) < 16:
        raise SystemExit("Secrets must match and contain at least 16 characters.")
    print(hashlib.sha256(first.encode("utf-8")).hexdigest())


if __name__ == "__main__":
    main()
