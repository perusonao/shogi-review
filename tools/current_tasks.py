"""Build deterministic, evidence-backed tasks for the player's next game."""
from __future__ import annotations

import hashlib
import re
from typing import Any


THEMES = {
    "check": {
        "title": "王手候補を確認する",
        "description": "次の解析で王手候補がある局面を観測し、候補確認の有無を○/×/－判定する。",
        "priority": 4,
    },
    "capture": {
        "title": "取れる駒を確認する",
        "description": "次の解析で駒を取る候補がある局面を観測し、候補確認の有無を○/×/－判定する。",
        "priority": 3,
    },
    "promotion": {
        "title": "成る手を候補に入れる",
        "description": "次の解析で成れる局面を観測し、成る候補を比較したか○/×/－判定する。",
        "priority": 2,
    },
    "drop": {
        "title": "駒打ちの候補を確認する",
        "description": "次の解析で持ち駒を打てる局面を観測し、駒打ち候補の確認を○/×/－判定する。",
        "priority": 1,
    },
}


def _direct_themes(issue: dict[str, Any]) -> list[tuple[str, str]]:
    """Return only facts about the recommended first move, never later PV guesses."""
    points = [point for point in issue.get("points", []) if isinstance(point, str)]
    direct = [point for point in points if point.startswith("推奨手は")]
    found: list[tuple[str, str]] = []
    for theme, pattern in (
        ("check", r"王手"),
        ("capture", r"を取る手"),
        ("promotion", r"を成る手"),
    ):
        matched = next((point for point in direct if re.search(pattern, point)), None)
        if matched:
            found.append((theme, matched))

    best = issue.get("best")
    best_ja = issue.get("bestJa")
    if isinstance(best, str) and "*" in best and isinstance(best_ja, str) and best_ja.endswith("打"):
        found.append(("drop", f"推奨手は{best_ja}（{best}）です。"))
    return found


def _task_id(game_id: str, theme: str) -> str:
    digest = hashlib.sha256(f"current-task-v1\0{game_id}\0{theme}".encode()).hexdigest()[:16]
    return f"ct1-{digest}"


def build_current_tasks(game_id: str, verified_issues: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Merge matching verified issues by theme and return at most three tasks."""
    candidates: list[dict[str, Any]] = []
    for issue in verified_issues or []:
        ply = issue.get("ply")
        if not isinstance(ply, int) or ply < 1:
            continue
        played = issue.get("played")
        best = issue.get("best")
        if not isinstance(played, str) or not isinstance(best, str) or played == best:
            continue
        loss = issue.get("lossCp", issue.get("loss", 0))
        loss = int(loss) if isinstance(loss, (int, float)) else 0
        for theme, fact in _direct_themes(issue):
            candidates.append({"theme": theme, "fact": fact, "issue": issue, "loss": max(0, loss)})

    selected: list[dict[str, Any]] = []
    for theme in THEMES:
        matches = [candidate for candidate in candidates if candidate["theme"] == theme]
        if not matches:
            continue
        representative = sorted(matches, key=lambda item: (-item["loss"], item["issue"]["ply"]))[0]
        issue = representative["issue"]
        config = THEMES[theme]
        selected.append({
            "id": _task_id(game_id, theme),
            "title": config["title"],
            "nextCheck": {
                "schema": "current-task-check-v1",
                "theme": theme,
                "description": config["description"],
                "observation": {
                    "scope": "nextAnalyzedGame",
                    "opportunitySource": "moveAnalyses.bestMove",
                    "playedSource": "moveAnalyses.actualMove",
                    "failureSource": "verifiedIssues",
                    "feature": theme,
                },
                "passWhen": "opportunity-and-played-feature",
                "failWhen": "opportunity-and-verified-miss",
                "resultValues": ["○", "×", "－"],
                "noOpportunityResult": "－",
            },
            "evidence": {
                "kind": "verifiedIssue",
                "fact": representative["fact"],
                "played": issue["played"],
                "best": issue["best"],
                "playedJa": issue.get("playedJa"),
                "bestJa": issue.get("bestJa"),
                "lossCp": representative["loss"],
                "points": [representative["fact"]],
            },
            "sourceGame": game_id,
            "sourcePly": issue["ply"],
            "occurrences": len(matches),
            "priority": config["priority"],
            "ranking": {
                "importanceLossCp": representative["loss"],
                "reproducibilityOccurrences": len(matches),
                "evidenceStrength": "HIGH" if theme != "drop" else "MEDIUM",
            },
        })

    return sorted(
        selected,
        key=lambda task: (
            -task["ranking"]["importanceLossCp"],
            -task["ranking"]["reproducibilityOccurrences"],
            -int(task["ranking"]["evidenceStrength"] == "HIGH"),
            -task["priority"],
            task["sourcePly"],
            task["id"],
        ),
    )[:3]
