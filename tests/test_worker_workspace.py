from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from prepare_worker_workspace import prepare  # noqa: E402


def run(cwd: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args], cwd=cwd, check=True, capture_output=True,
        text=True, encoding="utf-8", errors="replace",
    )


class WorkerWorkspaceTests(unittest.TestCase):
    def test_worker_uses_clean_detached_origin_main_when_source_is_dirty_feature_branch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            origin = base / "origin.git"
            source = base / "source"
            workspace = base / "worker"
            origin.mkdir()
            source.mkdir()
            run(origin, "init", "--bare")
            run(source, "init", "-b", "main")
            run(source, "config", "user.name", "Worker Test")
            run(source, "config", "user.email", "worker-test@example.invalid")
            (source / "marker.txt").write_text("main\n", encoding="utf-8")
            run(source, "add", "marker.txt")
            run(source, "commit", "-m", "initial")
            run(source, "remote", "add", "origin", str(origin))
            run(source, "push", "-u", "origin", "main")
            expected = run(source, "rev-parse", "origin/main").stdout.strip()

            run(source, "switch", "-c", "feature")
            (source / "marker.txt").write_text("dirty feature\n", encoding="utf-8")

            self.assertEqual(prepare(source, workspace), expected)
            self.assertEqual(run(workspace, "branch", "--show-current").stdout.strip(), "")
            self.assertEqual(run(workspace, "status", "--porcelain").stdout.strip(), "")
            self.assertEqual((workspace / "marker.txt").read_text(encoding="utf-8"), "main\n")
            self.assertEqual(run(source, "branch", "--show-current").stdout.strip(), "feature")
            self.assertNotEqual(run(source, "status", "--porcelain").stdout.strip(), "")


if __name__ == "__main__":
    unittest.main()
