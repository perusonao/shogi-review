#!/usr/bin/env python3
"""Import inbox KIF files, analyze them with Suisho5, and update the PWA catalog."""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from kif_to_game import parse as parse_kif  # noqa: E402
from queue_common import canonical_fingerprint  # noqa: E402
from pwa_intake import intake_player_games  # noqa: E402

if os.name == "nt":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

DEFAULT_ENGINE = Path(
    r"C:\shogi-engine\yaneuraou\NNUE_halfkp_256x2_32_32"
    r"\YaneuraOu_NNUE_halfkp_256x2_32_32-V900Git_AVX2.exe"
)
DEFAULT_EVAL_DIR = Path(r"C:\shogi-engine\suisho5")
PROHIBITED_SUFFIXES = {".exe", ".bin", ".7z", ".zip"}


class ImportFailure(RuntimeError):
    pass


@dataclass
class Candidate:
    inbox_path: Path
    game_id: str
    parsed: dict
    fingerprint: str
    existing_kif: Path | None = None


def run(command: list[str], cwd: Path, *, capture: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command, cwd=cwd, text=True, encoding="utf-8", errors="replace",
        capture_output=capture, check=False,
        env={**os.environ, "PYTHONUTF8": "1"},
    )


def slug(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).strip().lower()
    value = re.sub(r'[<>:"/\\|?*\s]+', "_", value)
    value = re.sub(r"[^\w.-]+", "_", value, flags=re.UNICODE).strip("_.-")
    return value or "opponent"


def game_id_for(parsed: dict, user: str, used_ids: set[str], fingerprint: str) -> str:
    game = parsed["game"]
    date = re.sub(r"\D", "", game.get("date", ""))[:8] or "undated"
    if game.get("sente") == user:
        opponent = game.get("gote", "opponent")
    elif game.get("gote") == user:
        opponent = game.get("sente", "opponent")
    else:
        raise ImportFailure(f"対局者に {user} がありません: {game.get('title', '')}")
    base = f"{date}_{slug(opponent)}"
    if base not in used_ids:
        return base
    candidate = f"{base}_{fingerprint[:8]}"
    if candidate not in used_ids:
        return candidate
    raise ImportFailure(f"ゲームIDを一意にできません: {base}")


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ImportFailure(f"JSONを読み込めません: {path}: {exc}") from exc


def validate_environment(root: Path, engine: Path, eval_dir: Path) -> None:
    if not (root / "games" / "index.json").is_file():
        raise ImportFailure(f"repository rootではありません: {root}")
    if not (ROOT / "tools" / "analyze_with_suisho5.py").is_file():
        raise ImportFailure("tools/analyze_with_suisho5.py がありません")
    if not engine.is_file():
        raise ImportFailure(f"YaneuraOuがありません: {engine}")
    if not (eval_dir / "nn.bin").is_file():
        raise ImportFailure(f"水匠5 nn.binがありません: {eval_dir / 'nn.bin'}")
    try:
        import shogi  # noqa: F401
    except ImportError as exc:
        raise ImportFailure("python-shogiがありません: pip install -r requirements.txt") from exc


def ensure_catalog_clean(root: Path) -> None:
    if root.resolve() != ROOT.resolve():
        return
    status = run(
        ["git", "status", "--porcelain", "--untracked-files=no", "--", "games/index.json"],
        root, capture=True,
    )
    if status.returncode != 0 or status.stdout.strip():
        raise ImportFailure("games/index.jsonに未保存の変更があります。先に確認してください")


def publish_preflight(root: Path) -> None:
    if root.resolve() != ROOT.resolve():
        raise ImportFailure("テスト用rootではpublishできません")
    branch = run(["git", "branch", "--show-current"], root, capture=True).stdout.strip()
    if branch != "main":
        raise ImportFailure(f"publishはmainブランチでのみ実行できます（現在: {branch}）")
    if run(["git", "fetch", "origin", "main"], root).returncode != 0:
        raise ImportFailure("git fetchに失敗しました。ネットワークを確認してください")
    head = run(["git", "rev-parse", "HEAD"], root, capture=True).stdout.strip()
    origin = run(["git", "rev-parse", "origin/main"], root, capture=True).stdout.strip()
    if head != origin:
        raise ImportFailure("HEADとorigin/mainが一致しません。先にGit状態を確認してください")


def existing_games(root: Path, user: str) -> tuple[dict[str, tuple[str, Path]], set[str]]:
    found: dict[str, tuple[str, Path]] = {}
    ids: set[str] = set()
    for path in sorted((root / "games").glob("*.kif")):
        try:
            parsed = parse_kif(path, path.stem, user)
            fingerprint = canonical_fingerprint(parsed)
        except Exception as exc:
            raise ImportFailure(f"既存KIFを検証できません: {path}: {exc}") from exc
        found[fingerprint] = (path.stem, path)
        ids.add(path.stem)
    return found, ids


def discover(root: Path, user: str, catalog_ids: set[str]) -> tuple[list[Candidate], list[Path]]:
    inbox = root / "games" / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)
    unsupported = sorted(p for p in inbox.iterdir() if p.is_file() and p.suffix.lower() == ".csa")
    if unsupported:
        raise ImportFailure("CSAは未対応です。KIF形式で保存してください: " + ", ".join(p.name for p in unsupported))
    files = sorted(p for p in inbox.glob("*") if p.is_file() and p.suffix.lower() == ".kif")
    known, file_ids = existing_games(root, user)
    used_ids = set(catalog_ids) | file_ids
    candidates: list[Candidate] = []
    duplicates: list[Path] = []
    batch_fingerprints: set[str] = set()
    for path in files:
        try:
            parsed = parse_kif(path, "pending", user)
        except Exception as exc:
            raise ImportFailure(f"不正なKIFです（inboxに残しました）: {path.name}: {exc}") from exc
        if not parsed["game"].get("moves"):
            raise ImportFailure(f"指し手がないKIFです（inboxに残しました）: {path.name}")
        fingerprint = canonical_fingerprint(parsed)
        if fingerprint in batch_fingerprints:
            duplicates.append(path)
            continue
        batch_fingerprints.add(fingerprint)
        if fingerprint in known:
            known_id, known_path = known[fingerprint]
            if known_id in catalog_ids and (root / "games" / f"{known_id}.json").is_file() and (root / "analysis" / f"{known_id}.json").is_file():
                duplicates.append(path)
                continue
            game_id = known_id
            existing_kif = known_path
        else:
            game_id = game_id_for(parsed, user, used_ids, fingerprint)
            existing_kif = None
            used_ids.add(game_id)
        parsed["game"]["id"] = game_id
        candidates.append(Candidate(path, game_id, parsed, fingerprint, existing_kif))
    return candidates, duplicates


def analyze(root: Path, candidates: list[Candidate], engine: Path, eval_dir: Path,
            user: str, nodes: int, work: Path) -> Path:
    staged_games = work / "input-games"
    staged_games.mkdir(parents=True)
    for candidate in candidates:
        shutil.copy2(candidate.existing_kif or candidate.inbox_path, staged_games / f"{candidate.game_id}.kif")
    output = work / "output"
    command = [
        sys.executable, str(ROOT / "tools" / "analyze_with_suisho5.py"),
        "--engine", str(engine), "--eval-dir", str(eval_dir),
        "--games", *[c.game_id for c in candidates], "--user", user,
        "--nodes", str(nodes), "--games-dir", str(staged_games),
        "--dry-run-out", str(output),
    ]
    print(f"[7/12] 水匠5解析を開始します（{nodes:,} nodes / 局面）")
    completed = run(command, ROOT)
    if completed.returncode != 0:
        raise ImportFailure(f"水匠5解析に失敗しました（終了コード {completed.returncode}）")
    return output


def validate_outputs(output: Path, candidates: list[Candidate]) -> None:
    for candidate in candidates:
        game_path = output / "games" / f"{candidate.game_id}.json"
        analysis_path = output / "analysis" / f"{candidate.game_id}.json"
        metrics_path = output / "analysis" / "metrics" / f"{candidate.game_id}.json"
        game = load_json(game_path)
        analysis = load_json(analysis_path)
        metrics = load_json(metrics_path)
        moves = game.get("game", {}).get("moves")
        if game.get("game", {}).get("id") != candidate.game_id:
            raise ImportFailure(f"game ID不整合: {candidate.game_id}")
        if not isinstance(moves, int) or moves <= 0 or len(game.get("positions", [])) != moves + 1:
            raise ImportFailure(f"game JSON局面数不整合: {candidate.game_id}")
        if len(analysis.get("evaluations", [])) != moves + 1:
            raise ImportFailure(f"analysis JSON局面数不整合: {candidate.game_id}")
        if analysis.get("schemaVersion", 1) >= 2 and len(analysis.get("moveAnalyses", [])) != moves:
            raise ImportFailure(f"analysis JSON指し手解析数不整合: {candidate.game_id}")
        if analysis.get("engine", {}).get("nodesPerPosition") != 30000:
            raise ImportFailure(f"解析nodes不整合: {candidate.game_id}")
        refinement = analysis.get("engine", {}).get("problemPvRefinement", {})
        if not refinement.get("enabled") or refinement.get("nodesPerSearch") != 60000:
            raise ImportFailure(f"課題PV追加探索条件不整合: {candidate.game_id}")
        if refinement.get("triggerBelowPlies") != 4:
            raise ImportFailure(f"課題PV追加探索閾値不整合: {candidate.game_id}")
        if len(game.get("issues", [])) != len(analysis.get("verifiedIssues", [])):
            raise ImportFailure(f"課題局面数不整合: {candidate.game_id}")
        if metrics.get("gameId") != candidate.game_id or metrics.get("positions") != moves + 1:
            raise ImportFailure(f"解析metrics基本情報不整合: {candidate.game_id}")
        if metrics.get("problemPositions") != len(analysis.get("verifiedIssues", [])):
            raise ImportFailure(f"解析metrics課題局面数不整合: {candidate.game_id}")
        executed = metrics.get("extraSearchExecuted")
        improved = metrics.get("improvedPvCount")
        unchanged = metrics.get("unchangedPvCount")
        if not all(isinstance(value, int) and value >= 0 for value in (executed, improved, unchanged)):
            raise ImportFailure(f"解析metrics追加探索値不整合: {candidate.game_id}")
        if improved + unchanged != executed:
            raise ImportFailure(f"解析metrics改善件数不整合: {candidate.game_id}")
        if metrics.get("shortPvCandidates") != executed:
            raise ImportFailure(f"解析metrics短PV件数不整合: {candidate.game_id}")
        before_lengths = metrics.get("pvLengthsBefore")
        after_lengths = metrics.get("pvLengthsAfter")
        if not isinstance(before_lengths, list) or not isinstance(after_lengths, list):
            raise ImportFailure(f"解析metrics PV長不整合: {candidate.game_id}")
        if len(before_lengths) != executed or len(after_lengths) != executed:
            raise ImportFailure(f"解析metrics PV長件数不整合: {candidate.game_id}")
        base_seconds = metrics.get("baseAnalysisSeconds")
        extra_seconds = metrics.get("extraPvSearchSeconds")
        total_seconds = metrics.get("totalAnalysisSeconds")
        if not all(isinstance(value, (int, float)) and value >= 0
                   for value in (base_seconds, extra_seconds, total_seconds)):
            raise ImportFailure(f"解析metrics時間不整合: {candidate.game_id}")
        if abs(total_seconds - base_seconds - extra_seconds) > 0.002:
            raise ImportFailure(f"解析metrics合計時間不整合: {candidate.game_id}")
        if any(key in metrics for key in ("workerUrl", "secret", "enginePath", "evalDir", "localPath")):
            raise ImportFailure(f"解析metricsに禁止情報があります: {candidate.game_id}")


def make_entry(game: dict, game_id: str) -> dict:
    info = game["game"]
    return {
        "id": game_id, "date": info["date"], "title": info["title"],
        "side": info["side"], "result": info["result"], "moves": info["moves"],
        "kif": f"games/{game_id}.kif", "gameData": f"games/{game_id}.json",
        "analysisData": f"analysis/{game_id}.json", "analyzed": True,
        "status": "YaneuraOu V9.00 + 水匠5解析済み",
    }


def atomic_copy(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".partial")
    shutil.copy2(source, temporary)
    os.replace(temporary, destination)


def install_results(root: Path, output: Path, candidates: list[Candidate], catalog: dict) -> list[Path]:
    entries = {g["id"]: g for g in catalog.get("games", [])}
    changed: list[Path] = []
    for candidate in candidates:
        kif_target = root / "games" / f"{candidate.game_id}.kif"
        game_target = root / "games" / f"{candidate.game_id}.json"
        analysis_target = root / "analysis" / f"{candidate.game_id}.json"
        metrics_target = root / "analysis" / "metrics" / f"{candidate.game_id}.json"
        if not kif_target.exists():
            atomic_copy(candidate.inbox_path, kif_target)
            changed.append(kif_target)
        atomic_copy(output / "games" / game_target.name, game_target)
        atomic_copy(output / "analysis" / analysis_target.name, analysis_target)
        atomic_copy(output / "analysis" / "metrics" / metrics_target.name, metrics_target)
        changed.extend([game_target, analysis_target, metrics_target])
        entries[candidate.game_id] = make_entry(load_json(game_target), candidate.game_id)
    original_order = [g["id"] for g in catalog.get("games", [])]
    new_ids = [c.game_id for c in candidates if c.game_id not in original_order]
    catalog["games"] = [entries[i] for i in new_ids + original_order]
    index_path = root / "games" / "index.json"
    temporary = index_path.with_suffix(".json.partial")
    temporary.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, index_path)
    changed.append(index_path)
    return changed


def publish(root: Path, changed: list[Path], game_ids: list[str]) -> str:
    if root.resolve() != ROOT.resolve():
        raise ImportFailure("テスト用rootではpublishできません")
    relative = [p.relative_to(root).as_posix() for p in changed]
    if any(Path(p).suffix.lower() in PROHIBITED_SUFFIXES for p in relative):
        raise ImportFailure("禁止バイナリがcommit対象に含まれています")
    completed = run(["git", "add", "--", *relative], root)
    if completed.returncode != 0:
        raise ImportFailure("git addに失敗しました")
    if run(["git", "diff", "--cached", "--check"], root).returncode != 0:
        raise ImportFailure("git diff --cached --checkに失敗しました")
    message = "data: import and analyze " + ", ".join(game_ids)
    if run(["git", "commit", "-m", message, "--", *relative], root).returncode != 0:
        raise ImportFailure("git commitに失敗しました")
    sha = run(["git", "rev-parse", "HEAD"], root, capture=True).stdout.strip()
    if run(["git", "push", "origin", "main"], root).returncode != 0:
        raise ImportFailure(f"commit {sha} は作成済みですがgit pushに失敗しました")
    return sha


def check_index(root: Path, catalog: dict) -> None:
    ids: set[str] = set()
    for entry in catalog.get("games", []):
        if entry["id"] in ids:
            raise ImportFailure(f"games/index.jsonに重複IDがあります: {entry['id']}")
        ids.add(entry["id"])
        for key in ("gameData", "analysisData"):
            if not (root / entry[key]).is_file():
                raise ImportFailure(f"games/index.json参照先がありません: {entry[key]}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=ROOT, help="test用workspace root")
    parser.add_argument("--engine", type=Path, default=DEFAULT_ENGINE)
    parser.add_argument("--eval-dir", type=Path, default=DEFAULT_EVAL_DIR)
    parser.add_argument("--user", default="sonao81")
    parser.add_argument("--nodes", type=int, default=30000)
    parser.add_argument("--publish", action="store_true", help="生成物だけをcommitしてorigin/mainへpush")
    parser.add_argument("--ask-publish", action="store_true", help="処理前にGitHub公開を対話確認")
    parser.add_argument("--calibration-metadata", help="worker-generated JSON; accepted only after successful analysis")
    args = parser.parse_args()
    if args.ask_publish and not args.publish:
        answer = input("解析後にGitHubへcommit / pushしますか？ [y/N]: ").strip().lower()
        args.publish = answer == "y"
    root = args.root.resolve()
    try:
        print("[1/12] repository root確認")
        print("[2/12] Python / python-shogi確認")
        print("[3/12] YaneuraOu確認")
        print("[4/12] 水匠5 nn.bin確認")
        validate_environment(root, args.engine, args.eval_dir)
        ensure_catalog_clean(root)
        if args.publish:
            publish_preflight(root)
        if args.nodes != 30000:
            raise ImportFailure("本番解析は30,000 nodes固定です")
        catalog = load_json(root / "games" / "index.json")
        check_index(root, catalog)
        print("[5/12] games/inboxを確認")
        candidates, duplicates = discover(root, args.user, {g["id"] for g in catalog.get("games", [])})
        if not candidates:
            for path in duplicates:
                path.unlink()
            print(f"新規棋譜はありません（重複{len(duplicates)}件を処理済み）")
            return 0
        print("[6/12] 新規棋譜: " + ", ".join(c.game_id for c in candidates))
        with tempfile.TemporaryDirectory(prefix="shogi-review-import-") as temp:
            output = analyze(root, candidates, args.engine, args.eval_dir, args.user, args.nodes, Path(temp))
            print("[8/12] game / analysis JSON検証")
            validate_outputs(output, candidates)
            print("[9/12] 課題局面を検証")
            print("[10/12] games/index.json更新")
            changed = install_results(root, output, candidates, catalog)
        if args.calibration_metadata:
            payload = json.loads(args.calibration_metadata)
            if len(candidates) != 1 or payload.get("fingerprint") != candidates[0].fingerprint:
                raise ImportFailure("calibration metadataと解析対象が一致しません")
            changed.append(intake_player_games(root, candidates[0].game_id,
                                               candidates[0].fingerprint, payload["metadata"]))
        for path in [c.inbox_path for c in candidates] + duplicates:
            if path.exists():
                path.unlink()
        check_index(root, load_json(root / "games" / "index.json"))
        print("[11/12] 生成物・index整合性 OK")
        diff_check = run(["git", "diff", "--check"], root) if root.resolve() == ROOT.resolve() else None
        if diff_check is not None and diff_check.returncode != 0:
            raise ImportFailure("git diff --checkに失敗しました")
        if args.publish:
            print("[12/12] GitHubへ反映")
            sha = publish(root, changed, [c.game_id for c in candidates])
            print(f"push成功: {sha}")
            print("GitHub Pagesの反映待ちです。数分後にiPhone PWAを開き直してください。")
        else:
            print("[12/12] GitHub反映は未実行（安全のため既定値）")
            print("内容確認後、--publish付きで実行するか生成物を手動commit/pushしてください。")
        print("完了: " + ", ".join(c.game_id for c in candidates))
        return 0
    except ImportFailure as exc:
        print(f"停止: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"停止: 予期しないエラー: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
