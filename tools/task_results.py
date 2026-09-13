"""Evaluate active current tasks against the next analyzed game."""
from __future__ import annotations

import hashlib
from typing import Any

import shogi


LABELS = {"pass": "○", "fail": "×", "no_opportunity": "－"}
REASONS = {
    "opportunity_satisfied": "観測機会があり、実戦手でも課題の特徴を確認できました。",
    "verified_repeated_issue": "観測機会があり、同じテーマの見落としが課題局面として確認されました。",
    "no_opportunity": "この対局には課題を確認できる観測機会がありませんでした。",
    "insufficient_evidence": "観測機会はありましたが、達成・失敗を断定できる証拠が不足しています。",
}


def _result_id(task_id: str, game_id: str) -> str:
    digest = hashlib.sha256(f"task-result-v1\0{task_id}\0{game_id}".encode()).hexdigest()[:16]
    return f"tr1-{digest}"


def _is_user_ply(ply: int, user_side: str) -> bool:
    return (ply % 2 == 1 and user_side == "sente") or (ply % 2 == 0 and user_side == "gote")


def _verified_feature(sfen: str | None, move_usi: str | None, theme: str) -> bool | None:
    """Return a feature fact only after verifying that the USI move is legal."""
    if not isinstance(sfen, str) or not isinstance(move_usi, str):
        return None
    try:
        board = shogi.Board(sfen)
        move = shogi.Move.from_usi(move_usi)
    except (ValueError, TypeError):
        return None
    if move not in board.legal_moves:
        return None
    if theme == "drop":
        return move.drop_piece_type is not None
    if theme == "promotion":
        return bool(move.promotion)
    if theme == "capture":
        return move.drop_piece_type is None and board.piece_at(move.to_square) is not None
    if theme == "check":
        board.push(move)
        return board.is_check()
    return None


def _evidence(theme: str, best_move: str, actual_move: str, best_feature: bool,
              actual_feature: bool, issue: dict[str, Any] | None = None) -> dict[str, Any]:
    evidence: dict[str, Any] = {
        "schema": "task-result-evidence-v1",
        "verification": "legal-move-feature",
        "theme": theme,
        "opportunity": {
            "source": "moveAnalyses.bestMove",
            "move": best_move,
            "featureVerified": best_feature,
        },
        "played": {
            "source": "moveAnalyses.actualMove",
            "move": actual_move,
            "featureVerified": actual_feature,
        },
    }
    if issue is not None:
        evidence["verifiedIssue"] = {
            "source": "verifiedIssues",
            "ply": issue.get("ply"),
            "played": issue.get("played"),
            "best": issue.get("best"),
        }
    return evidence


def evaluate_task_results(tasks: list[dict[str, Any]] | None, analysis: dict[str, Any],
                          positions: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Return one deterministic result per unique task id for the next game."""
    game_id = analysis.get("gameId")
    user_side = analysis.get("userSide")
    move_analyses = analysis.get("moveAnalyses") if isinstance(analysis.get("moveAnalyses"), list) else []
    verified_issues = analysis.get("verifiedIssues") if isinstance(analysis.get("verifiedIssues"), list) else []
    position_rows = positions if isinstance(positions, list) else []
    total_moves = analysis.get("moves")
    observed_user_plies = {
        row.get("ply") for row in move_analyses
        if isinstance(row, dict) and isinstance(row.get("ply"), int)
        and user_side in {"sente", "gote"} and _is_user_ply(row["ply"], user_side)
    }
    expected_user_plies = (
        {ply for ply in range(1, total_moves + 1) if _is_user_ply(ply, user_side)}
        if isinstance(total_moves, int) and total_moves > 0 and user_side in {"sente", "gote"}
        else set()
    )
    analysis_complete = bool(
        expected_user_plies and expected_user_plies <= observed_user_plies
        and len(position_rows) >= total_moves
    )
    issue_by_ply = {
        issue.get("ply"): issue for issue in verified_issues
        if isinstance(issue, dict) and isinstance(issue.get("ply"), int)
    }
    results: list[dict[str, Any]] = []
    seen: set[str] = set()

    for task in tasks or []:
        if not isinstance(task, dict) or not isinstance(task.get("id"), str) or task["id"] in seen:
            continue
        seen.add(task["id"])
        task_id = task["id"]
        next_check = task.get("nextCheck") if isinstance(task.get("nextCheck"), dict) else {}
        theme = next_check.get("theme")
        opportunities: list[dict[str, Any]] = []

        if (next_check.get("schema") == "current-task-check-v1" and
                theme in {"check", "capture", "promotion", "drop"} and
                user_side in {"sente", "gote"}):
            for move_analysis in move_analyses:
                if not isinstance(move_analysis, dict):
                    continue
                ply = move_analysis.get("ply")
                if not isinstance(ply, int) or ply < 1 or not _is_user_ply(ply, user_side):
                    continue
                sfen = position_rows[ply - 1].get("sfen") if ply <= len(position_rows) else None
                best_move = move_analysis.get("bestMove")
                actual_move = move_analysis.get("actualMove")
                best_feature = _verified_feature(sfen, best_move, theme)
                if best_feature is not True:
                    continue
                actual_feature = _verified_feature(sfen, actual_move, theme)
                issue = issue_by_ply.get(ply)
                verified_miss = (
                    actual_feature is False and isinstance(issue, dict) and
                    issue.get("best") == best_move and issue.get("played") == actual_move and
                    _verified_feature(sfen, issue.get("best"), theme) is True and
                    _verified_feature(sfen, issue.get("played"), theme) is False
                )
                opportunities.append({
                    "ply": ply,
                    "bestMove": best_move,
                    "actualMove": actual_move,
                    "bestFeature": True,
                    "actualFeature": actual_feature,
                    "issue": issue if verified_miss else None,
                    "verifiedMiss": verified_miss,
                })

        failures = [item for item in opportunities if item["verifiedMiss"]]
        passes = [item for item in opportunities if item["actualFeature"] is True]
        if failures:
            chosen = failures[0]
            status, reason_code = "fail", "verified_repeated_issue"
        elif passes:
            chosen = passes[0]
            status, reason_code = "pass", "opportunity_satisfied"
        elif opportunities:
            chosen = opportunities[0]
            status, reason_code = "no_opportunity", "insufficient_evidence"
        else:
            chosen = None
            status = "no_opportunity"
            reason_code = ("no_opportunity" if analysis_complete
                           and theme in {"check", "capture", "promotion", "drop"}
                           and next_check.get("schema") == "current-task-check-v1"
                           else "insufficient_evidence")

        evidence = ({
            "schema": "task-result-evidence-v1",
            "verification": "none",
            "theme": theme,
        } if chosen is None else _evidence(
            theme, chosen["bestMove"], chosen["actualMove"], chosen["bestFeature"],
            chosen["actualFeature"], chosen["issue"],
        ))
        results.append({
            "id": _result_id(task_id, game_id),
            "taskId": task_id,
            "status": status,
            "label": LABELS[status],
            "evidence": evidence,
            "gameId": game_id,
            "ply": chosen["ply"] if chosen is not None else None,
            "reason": {"code": reason_code, "text": REASONS[reason_code]},
            "title": task.get("title"),
            "theme": theme,
            "taskSource": {"gameId": task.get("sourceGame"), "ply": task.get("sourcePly")},
        })
    return results


def update_current_tasks(previous_tasks: list[dict[str, Any]] | None,
                         task_results: list[dict[str, Any]] | None,
                         new_tasks: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Keep active tasks at three, preferring failures and fresh verified themes."""
    results = {result.get("taskId"): result for result in task_results or [] if isinstance(result, dict)}
    previous = [task for task in previous_tasks or [] if isinstance(task, dict)]
    failures = [task for task in previous if results.get(task.get("id"), {}).get("status") == "fail"]
    no_opportunities = [task for task in previous if results.get(task.get("id"), {}).get("status") == "no_opportunity"]
    passes = [task for task in previous if results.get(task.get("id"), {}).get("status") == "pass"]

    selected: list[dict[str, Any]] = []
    seen_themes: set[str] = set()
    seen_ids: set[str] = set()
    for task in [*failures, *(new_tasks or []), *no_opportunities, *passes]:
        if not isinstance(task, dict) or not isinstance(task.get("id"), str):
            continue
        theme = task.get("nextCheck", {}).get("theme") if isinstance(task.get("nextCheck"), dict) else None
        if task["id"] in seen_ids or not isinstance(theme, str) or theme in seen_themes:
            continue
        selected.append(task)
        seen_ids.add(task["id"])
        seen_themes.add(theme)
        if len(selected) == 3:
            break
    return selected


def apply_task_cycle(analysis: dict[str, Any], game: dict[str, Any],
                     previous_tasks: list[dict[str, Any]] | None) -> dict[str, Any]:
    """Mutate one newly generated analysis with results and the next active set."""
    generated = analysis.get("currentTasks") if isinstance(analysis.get("currentTasks"), list) else []
    positions = game.get("positions") if isinstance(game, dict) else []
    results = evaluate_task_results(previous_tasks, analysis, positions)
    analysis["taskResults"] = results
    analysis["currentTasks"] = update_current_tasks(previous_tasks, results, generated)
    return analysis
