#!/usr/bin/env python3
"""Prepare a clean, detached origin/main worktree for the Windows queue worker."""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


class WorkspaceError(RuntimeError):
    pass


def git(args: list[str], cwd: Path, *, capture: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args], cwd=cwd, shell=False, check=False, text=True,
        encoding="utf-8", errors="replace", capture_output=capture,
    )


def output(args: list[str], cwd: Path) -> str:
    completed = git(args, cwd, capture=True)
    if completed.returncode != 0:
        raise WorkspaceError(f"git {' '.join(args)} failed: {completed.stderr.strip()}")
    return completed.stdout.strip()


def registered_worktrees(source: Path) -> set[Path]:
    paths: set[Path] = set()
    for line in output(["worktree", "list", "--porcelain"], source).splitlines():
        if line.startswith("worktree "):
            paths.add(Path(line.removeprefix("worktree ")).resolve())
    return paths


def prepare(source: Path, workspace: Path) -> str:
    source = source.resolve()
    workspace = workspace.resolve()
    repository_root = Path(output(["rev-parse", "--show-toplevel"], source)).resolve()
    if repository_root != source:
        raise WorkspaceError(f"source is not the repository root: {source}")
    if workspace == source or source in workspace.parents:
        raise WorkspaceError("worker workspace must be outside the source repository")
    if git(["fetch", "origin", "main"], source).returncode != 0:
        raise WorkspaceError("git fetch origin main failed")

    registered = registered_worktrees(source)
    if workspace not in registered:
        if workspace.exists():
            raise WorkspaceError(f"workspace exists but is not a registered worktree: {workspace}")
        workspace.parent.mkdir(parents=True, exist_ok=True)
        if git(["worktree", "add", "--detach", str(workspace), "origin/main"], source).returncode != 0:
            raise WorkspaceError("failed to create worker worktree")

    if output(["status", "--porcelain"], workspace):
        raise WorkspaceError(f"worker workspace is dirty: {workspace}")
    head = output(["rev-parse", "HEAD"], workspace)
    origin = output(["rev-parse", "origin/main"], workspace)
    if head != origin:
        if git(["merge-base", "--is-ancestor", "HEAD", "origin/main"], workspace).returncode != 0:
            raise WorkspaceError("worker workspace diverged from origin/main")
        if git(["merge", "--ff-only", "origin/main"], workspace).returncode != 0:
            raise WorkspaceError("failed to fast-forward worker workspace")
        head = output(["rev-parse", "HEAD"], workspace)
    return head


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    args = parser.parse_args()
    try:
        sha = prepare(args.source, args.workspace)
        print(f"worker workspace ready: {args.workspace.resolve()} @ {sha}")
        return 0
    except WorkspaceError as exc:
        print(f"worker workspace error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
