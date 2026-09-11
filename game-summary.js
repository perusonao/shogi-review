(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ShogiGameSummary = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const CLEAR_EDGE = 300;
  const DECISIVE_EDGE = 2000;
  const STAYS_DECISIVE_EDGE = 800;
  const LARGE_LOSS = 300;
  const MATE_CP = 30000;

  function userSign(userSide) {
    return userSide === "gote" || userSide === "w" || String(userSide).includes("後手") ? -1 : 1;
  }

  function numericScore(score) {
    if (!score) return null;
    const value = Number(score.value || 0);
    if (score.type === "mate") return Math.sign(value) * (MATE_CP + Math.max(0, 100 - Math.abs(value)));
    return Number.isFinite(value) ? value : null;
  }

  function normalizeSenteScore(score, side) {
    if (!score) return null;
    return { type: score.type === "mate" ? "mate" : "cp", value: Number(score.value || 0) * userSign(side) };
  }

  function evaluationFromUser(evaluation, side) {
    if (!evaluation) return null;
    if (evaluation.score) return normalizeSenteScore(evaluation.score, side);
    if (Number.isFinite(Number(evaluation.cp))) {
      return { type: "cp", value: Number(evaluation.cp) * userSign(side) };
    }
    return null;
  }

  function issueScoresFromUser(issue, side) {
    if (!issue) return [null, null];
    if (issue.scoreBefore && issue.scoreAfterActual) {
      if (issue.scorePerspective === "sente") {
        return [normalizeSenteScore(issue.scoreBefore, side), normalizeSenteScore(issue.scoreAfterActual, side)];
      }
      return [issue.scoreBefore, issue.scoreAfterActual];
    }
    const sign = userSign(side);
    const before = Number(issue.beforeCp);
    const after = Number(issue.afterCp);
    return [
      Number.isFinite(before) ? { type: "cp", value: before * sign } : null,
      Number.isFinite(after) ? { type: "cp", value: after * sign } : null,
    ];
  }

  function scoreText(score) {
    if (!score) return "評価値なし";
    const value = Number(score.value || 0);
    if (score.type === "mate") {
      if (value > 0) return `自分に詰みあり（${Math.abs(value)}手）`;
      if (value < 0) return `相手に詰みあり（${Math.abs(value)}手）`;
      return "詰み評価";
    }
    return `${value >= 0 ? "+" : ""}${Math.round(value)}`;
  }

  function evaluationLabel(score) {
    const value = numericScore(score);
    if (value === null) return "評価値なし";
    const magnitude = Math.abs(value);
    if (magnitude < 300) return "互角";
    if (magnitude < 800) return value > 0 ? "自分やや有利" : "相手やや有利";
    if (magnitude < 2000) return value > 0 ? "自分有利" : "相手有利";
    return value > 0 ? "自分優勢" : "相手優勢";
  }

  function lossForIssue(issue, side) {
    if (Number.isFinite(Number(issue.lossCp))) return Math.max(0, Number(issue.lossCp));
    if (Number.isFinite(Number(issue.loss))) return Math.max(0, Number(issue.loss));
    const [before, after] = issueScoresFromUser(issue, side);
    const beforeValue = numericScore(before);
    const afterValue = numericScore(after);
    return beforeValue === null || afterValue === null ? 0 : Math.max(0, beforeValue - afterValue);
  }

  function selectImportantPositions(analysis, options = {}) {
    const side = analysis?.userSide || options.userSide || "sente";
    const moves = Number(analysis?.moves || options.moves || 0);
    const issues = Array.isArray(analysis?.verifiedIssues) ? analysis.verifiedIssues.slice() : [];
    const evaluations = (Array.isArray(analysis?.evaluations) ? analysis.evaluations : [])
      .map((entry) => ({ ply: Number(entry.ply), score: evaluationFromUser(entry, side) }))
      .filter((entry) => Number.isFinite(entry.ply) && entry.score)
      .sort((a, b) => a.ply - b.ply);
    issues.sort((a, b) => Number(a.ply) - Number(b.ply));

    const selected = new Map();
    function add(ply, label, priority, issue = null, before = null, after = null) {
      if (!Number.isFinite(Number(ply)) || Number(ply) < 1) return;
      const key = Number(ply);
      const current = selected.get(key) || {
        ply: key, label, labels: [], priority, issue, scoreBefore: before, scoreAfter: after,
      };
      if (!current.labels.includes(label)) current.labels.push(label);
      if (priority > current.priority) {
        current.label = label;
        current.priority = priority;
      }
      if (!current.issue && issue) current.issue = issue;
      if (!current.scoreBefore && before) current.scoreBefore = before;
      if (!current.scoreAfter && after) current.scoreAfter = after;
      selected.set(key, current);
    }

    const substantialIssues = issues.filter((issue) => lossForIssue(issue, side) >= LARGE_LOSS);
    if (substantialIssues.length) {
      const first = substantialIssues[0];
      const scores = issueScoresFromUser(first, side);
      add(Number(first.ply), "最初の分岐", 2, first, scores[0], scores[1]);
    }

    if (issues.length) {
      const largest = issues.reduce((best, issue) => lossForIssue(issue, side) > lossForIssue(best, side) ? issue : best);
      const scores = issueScoresFromUser(largest, side);
      add(Number(largest.ply), "最大の課題", 4, largest, scores[0], scores[1]);

      const openingLimit = Math.min(30, Math.max(12, Math.ceil(moves * 0.33)));
      const openingIssues = issues.filter((issue) => Number(issue.ply) <= openingLimit);
      if (openingIssues.length) {
        const opening = openingIssues.reduce((best, issue) => lossForIssue(issue, side) > lossForIssue(best, side) ? issue : best);
        const scores = issueScoresFromUser(opening, side);
        add(Number(opening.ply), "序盤の重要判断", 1, opening, scores[0], scores[1]);
      }
    }

    let previousStrong = null;
    for (const entry of evaluations) {
      const value = numericScore(entry.score);
      if (value === null || Math.abs(value) < CLEAR_EDGE) continue;
      const direction = Math.sign(value);
      if (previousStrong && direction !== previousStrong.direction) {
        add(entry.ply, "逆転局面", 3, null, previousStrong.score, entry.score);
        break;
      }
      previousStrong = { direction, score: entry.score, ply: entry.ply };
    }

    const finalEntry = evaluations[evaluations.length - 1];
    const finalValue = finalEntry ? numericScore(finalEntry.score) : null;
    const finalDirection = finalValue === null ? 0 : Math.sign(finalValue);
    if (finalDirection) {
      for (let index = 0; index < evaluations.length; index += 1) {
        const entry = evaluations[index];
        const value = numericScore(entry.score);
        const entersDecisive = entry.score.type === "mate" || (value !== null && value * finalDirection >= DECISIVE_EDGE);
        if (!entersDecisive) continue;
        const remains = evaluations.slice(index).every((later) => {
          const laterValue = numericScore(later.score);
          return laterValue !== null && laterValue * finalDirection >= STAYS_DECISIVE_EDGE;
        });
        if (remains) {
          const previous = evaluations[Math.max(0, index - 1)];
          add(entry.ply, "勝負を決めた局面", 5, null, previous?.score || null, entry.score);
          break;
        }
      }
    }

    if (!selected.size && evaluations.length > 1) {
      let largestChange = null;
      for (let index = 1; index < evaluations.length; index += 1) {
        const before = evaluations[index - 1];
        const after = evaluations[index];
        const delta = Math.abs(numericScore(after.score) - numericScore(before.score));
        if (!largestChange || delta > largestChange.delta) largestChange = { before, after, delta };
      }
      if (largestChange) add(largestChange.after.ply, "形勢が動いた局面", 1, null, largestChange.before.score, largestChange.after.score);
    }

    return Array.from(selected.values())
      .sort((a, b) => b.priority - a.priority || a.ply - b.ply)
      .slice(0, 5)
      .sort((a, b) => a.ply - b.ply)
      .map((item) => ({
        ...item,
        loss: item.issue ? lossForIssue(item.issue, side) : null,
        played: item.issue?.playedJa || item.issue?.played || null,
        best: item.issue?.bestJa || item.issue?.best || null,
        scoreText: `${scoreText(item.scoreBefore)} → ${scoreText(item.scoreAfter)}`,
        stateBefore: evaluationLabel(item.scoreBefore),
        stateAfter: evaluationLabel(item.scoreAfter),
      }));
  }

  function buildOverallComment(items) {
    if (!items.length) return "保存済み評価値から重要局面を特定できませんでした。";
    const plies = items.slice(0, 2).map((item) => `${item.ply}手目`).join("と");
    const moved = items.find((item) => item.label === "逆転局面" || item.label === "勝負を決めた局面") || items[0];
    return `解析値から重要局面を${items.length}件抽出しました。${moved.ply}手目で形勢区分または評価値が大きく動いています。${plies}を重点的に確認できます。`;
  }

  return {
    CLEAR_EDGE,
    DECISIVE_EDGE,
    LARGE_LOSS,
    buildOverallComment,
    evaluationFromUser,
    evaluationLabel,
    issueScoresFromUser,
    numericScore,
    scoreText,
    selectImportantPositions,
    userSign,
  };
});

if (typeof document !== "undefined" && typeof render === "function") {
  const renderBeforeGameSummary = render;
  let summaryGameId = null;
  let summaryExpanded = true;

  function summaryContainer() {
    let container = document.getElementById("gameSummary");
    if (!container) {
      container = document.createElement("div");
      container.id = "gameSummary";
      container.className = "gameSummary";
      container.setAttribute("aria-live", "polite");
      review.parentNode.insertBefore(container, review);
    }
    return container;
  }

  function summaryJapaneseMove(item, kind) {
    const verified = item.issue;
    const direct = kind === "actual" ? verified?.playedJa : verified?.bestJa;
    if (direct && /^[▲△]/.test(direct)) return direct;
    const gameIssue = D?.issues?.find((candidate) => candidate.ply === item.ply);
    if (!gameIssue) return null;
    const position = parseSFEN(D.positions[Math.max(0, item.ply - 1)].sfen);
    const mover = item.ply % 2 ? "b" : "w";
    const previous = previousDestination(item.ply);
    const usi = kind === "actual" ? actualMove(gameIssue) : bestMove(gameIssue);
    return usi ? formatMove(usi, position, mover, previous) : null;
  }

  function jumpToSummaryPosition(targetPly) {
    ply = Math.max(0, Math.min(D.positions.length - 1, Number(targetPly)));
    summaryExpanded = false;
    render();
    requestAnimationFrame(() => review.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }

  function renderGameSummary() {
    const container = summaryContainer();
    if (!D || !window.ShogiGameSummary) {
      container.replaceChildren();
      return;
    }
    const gameId = D.game?.id || currentGameId;
    if (gameId !== summaryGameId) {
      summaryGameId = gameId;
      summaryExpanded = true;
    }
    const analysis = {
      userSide: userSide() === "b" ? "sente" : "gote",
      moves: D.game.moves,
      evaluations: evalSente.map(([evaluationPly, cp]) => ({ ply: evaluationPly, cp })),
      verifiedIssues: analysisIssues,
    };
    const items = window.ShogiGameSummary.selectImportantPositions(analysis);
    const details = document.createElement("details");
    details.open = summaryExpanded;
    details.addEventListener("toggle", () => { summaryExpanded = details.open; });
    appendText(details, "summary", `この一局のポイント（${items.length}局面）`);
    appendText(details, "div", window.ShogiGameSummary.buildOverallComment(items), "summaryOverall");
    const list = document.createElement("div");
    list.className = "summaryItems";
    items.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "summaryItem";
      button.title = item.labels.join(" / ");
      appendText(button, "b", `${"①②③④⑤"[index]} ${item.ply}手目`);
      appendText(button, "span", item.label);
      const actual = summaryJapaneseMove(item, "actual");
      const best = summaryJapaneseMove(item, "best");
      if (actual && best) appendText(button, "small", `${actual} → 推奨 ${best}`);
      appendText(button, "small", item.scoreText);
      button.addEventListener("click", () => jumpToSummaryPosition(item.ply));
      list.appendChild(button);
    });
    details.appendChild(list);
    container.replaceChildren(details);
  }

  render = function renderWithGameSummary() {
    renderBeforeGameSummary();
    renderGameSummary();
  };
  window.jumpToSummaryPosition = jumpToSummaryPosition;
}
