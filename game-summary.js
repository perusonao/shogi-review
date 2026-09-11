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

  function hasMateChange(item) {
    const before = item?.scoreBefore;
    const after = item?.scoreAfter;
    if (before?.type === "mate" || after?.type === "mate") return true;
    return [before, after].some((score) => score?.type === "cp" && Math.abs(Number(score.value || 0)) >= 25000);
  }

  function learningTheme(item) {
    const issue = item?.issue || {};
    const points = Array.isArray(issue.points) ? issue.points.join(" ") : "";
    const pv = Array.isArray(issue.pv) ? issue.pv : [];
    if (hasMateChange(item) || /詰み/.test(points)) return { type: "mate", text: "詰み筋を確認" };
    if (/王手/.test(points)) return { type: "check", text: "王手を含む読み筋を確認" };
    if (/取る手/.test(points)) return { type: "capture", text: "駒を取る手を含む読み筋を確認" };
    if (/成る手/.test(points) || pv.some((move) => typeof move === "string" && move.endsWith("+"))) {
      return { type: "promotion", text: "成る手を含む変化を確認" };
    }
    if (pv.some((move) => typeof move === "string" && move.includes("*"))) {
      return { type: "drop", text: "持ち駒を使う候補を確認" };
    }
    return { type: "comparison", text: "実戦手と推奨手を比較" };
  }

  function learningPriority(item) {
    if (hasMateChange(item)) return 1;
    if (item.labels?.includes("最大の課題")) return 2;
    if (item.labels?.includes("最初の分岐")) return 3;
    if (item.labels?.includes("逆転局面")) return 4;
    return 5;
  }

  function extractLearningItems(analysis, importantPositions = null) {
    const selected = importantPositions || selectImportantPositions(analysis);
    const gameId = String(analysis?.gameId || "");
    const seen = new Set();
    return selected
      .slice()
      .sort((a, b) => learningPriority(a) - learningPriority(b) || b.loss - a.loss || a.ply - b.ply)
      .filter((item) => {
        if (seen.has(item.ply)) return false;
        seen.add(item.ply);
        return true;
      })
      .slice(0, 3)
      .map((item) => {
        const theme = learningTheme(item);
        return {
          gameId,
          ply: item.ply,
          type: theme.type,
          theme: theme.text,
          actualMove: item.issue?.played || null,
          bestMove: item.issue?.best || null,
          actualMoveJa: item.issue?.playedJa || null,
          bestMoveJa: item.issue?.bestJa || null,
          loss: item.loss,
          mate: hasMateChange(item) ? { before: item.scoreBefore, after: item.scoreAfter } : null,
          category: item.labels.slice(),
          scoreChange: { before: item.scoreBefore, after: item.scoreAfter, text: item.scoreText },
          source: item,
        };
      });
  }

  function buildSummaryAudit(gameId, importantPositions, recordedAt = new Date().toISOString()) {
    return {
      schemaVersion: 1,
      gameId,
      recordedAt,
      selected: importantPositions.map((item) => ({
        gameId,
        ply: item.ply,
        category: item.labels.slice(),
        scoreChange: { before: item.scoreBefore, after: item.scoreAfter },
      })),
    };
  }

  return {
    CLEAR_EDGE,
    DECISIVE_EDGE,
    LARGE_LOSS,
    buildOverallComment,
    buildSummaryAudit,
    evaluationFromUser,
    evaluationLabel,
    extractLearningItems,
    hasMateChange,
    issueScoresFromUser,
    learningTheme,
    numericScore,
    scoreText,
    selectImportantPositions,
    userSign,
  };
});

if (typeof document !== "undefined" && typeof render === "function") {
  const learningStyle = document.createElement("style");
  learningStyle.textContent = ".nextGameLearning{margin:2px 0}.nextGameLearning details{background:#211a13;border:1px solid #527056;border-radius:7px;padding:4px}.nextGameLearning summary{cursor:pointer;color:#9fe0a9;font-size:10px;font-weight:700}.learningIntro{font-size:8px;color:#c8b99e;margin:4px 0}.learningItem{display:grid;grid-template-columns:64px 1fr;align-items:center;width:100%;text-align:left;border:0;border-top:1px solid #4c4438;background:transparent;color:#fff3df;padding:5px 2px;font:inherit}.learningItem b{font-size:9px;color:#c7ebc9}.learningItem span{font-size:9px}.learningItem small{grid-column:2;font-size:8px;color:#c8b99e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}";
  document.head.appendChild(learningStyle);
  const renderBeforeGameSummary = render;
  let summaryGameId = null;
  let summaryExpanded = true;
  let learningExpanded = true;
  let auditedGameId = null;

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

  function learningContainer() {
    let container = document.getElementById("nextGameLearning");
    if (!container) {
      container = document.createElement("div");
      container.id = "nextGameLearning";
      container.className = "nextGameLearning";
      review.parentNode.insertBefore(container, review.nextSibling);
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
    learningExpanded = false;
    render();
    requestAnimationFrame(() => review.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }

  function recordSummaryAudit(gameId, items) {
    if (!gameId || auditedGameId === gameId) return;
    auditedGameId = gameId;
    try {
      const key = "shogi-review-summary-audit-v1";
      const current = JSON.parse(localStorage.getItem(key) || "[]");
      const records = Array.isArray(current) ? current.filter((record) => record?.gameId !== gameId) : [];
      records.unshift(window.ShogiGameSummary.buildSummaryAudit(gameId, items));
      localStorage.setItem(key, JSON.stringify(records.slice(0, 10)));
    } catch (_error) {
      // Private browsing or storage restrictions must not block the review UI.
    }
  }

  function renderNextGameLearning(analysis, items) {
    const container = learningContainer();
    const learning = window.ShogiGameSummary.extractLearningItems(analysis, items);
    const details = document.createElement("details");
    details.open = learningExpanded;
    details.addEventListener("toggle", () => { learningExpanded = details.open; });
    appendText(details, "summary", `次局への学び（${learning.length}件）`);
    appendText(details, "div", "この対局で再確認する局面です。", "learningIntro");
    learning.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "learningItem";
      appendText(button, "b", `□ ${item.ply}手目`);
      appendText(button, "span", item.theme);
      const actual = summaryJapaneseMove(item.source, "actual");
      const best = summaryJapaneseMove(item.source, "best");
      if (actual && best) appendText(button, "small", `${actual} → ${best}`);
      button.addEventListener("click", () => jumpToSummaryPosition(item.ply));
      details.appendChild(button);
    });
    container.replaceChildren(details);
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
      learningExpanded = true;
    }
    const analysis = {
      gameId,
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
    renderNextGameLearning(analysis, items);
    recordSummaryAudit(gameId, items);
  }

  render = function renderWithGameSummary() {
    renderBeforeGameSummary();
    renderGameSummary();
  };
  window.jumpToSummaryPosition = jumpToSummaryPosition;
}
