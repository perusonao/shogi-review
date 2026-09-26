(function (root, factory) {
  const commonJs = typeof module === "object" && module.exports;
  const api = factory(commonJs ? require("./recent-analysis.js") : root?.ShogiRecentAnalysis,
    commonJs ? require("./coaching-focus.js") : root?.ShogiCoachingFocus);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ShogiGrowthDashboard = api;
})(typeof window !== "undefined" ? window : null, function (recentApi, coachingApi) {
  "use strict";

  const STATUS_LABELS = { pass: "○", fail: "×", no_opportunity: "－" };
  const TREND_LABELS = {
    improving: "改善傾向",
    stable: "横ばい・継続",
    worsening: "要注意",
    insufficient_data: "データ不足",
  };

  function achievementFromSummary(summary) {
    const totals = { pass: 0, fail: 0, noOpportunity: 0 };
    for (const theme of Array.isArray(summary?.themes) ? summary.themes : []) {
      totals.pass += Number.isInteger(theme?.pass) ? theme.pass : 0;
      totals.fail += Number.isInteger(theme?.fail) ? theme.fail : 0;
      totals.noOpportunity += Number.isInteger(theme?.noOpportunity) ? theme.noOpportunity : 0;
    }
    const denominator = totals.pass + totals.fail;
    return { ...totals, denominator, rate: denominator ? totals.pass / denominator : null };
  }

  function winnerSide(result) {
    if (typeof result !== "string") return null;
    if (/^先手(?:・|\s).*勝利/.test(result)) return "先手";
    if (/^後手(?:・|\s).*勝利/.test(result)) return "後手";
    return null;
  }

  function recentRecord(records) {
    if (!recentApi) return null;
    return recentApi.selectRecentGames(records, 1)[0] || null;
  }

  function recordFromId(records, gameId) {
    return (Array.isArray(records) ? records : []).find((record) => record?.id === gameId) || null;
  }

  function scoreFromSummary(records, summary) {
    let wins = 0;
    let losses = 0;
    for (const gameId of Array.isArray(summary?.gameIds) ? summary.gameIds : []) {
      const record = recordFromId(records, gameId);
      const winner = winnerSide(record?.result);
      const user = typeof record?.side === "string" && record.side.includes("先手") ? "先手" :
        typeof record?.side === "string" && record.side.includes("後手") ? "後手" : null;
      if (!winner || !user) continue;
      if (winner === user) wins += 1;
      else losses += 1;
    }
    return wins + losses ? { wins, losses, games: wins + losses } : null;
  }

  function summaryTheme(summary, themeName) {
    return (Array.isArray(summary?.themes) ? summary.themes : []).find((theme) => theme?.theme === themeName) || null;
  }

  function comparableCount(theme) {
    return (Number.isInteger(theme?.pass) ? theme.pass : 0) + (Number.isInteger(theme?.fail) ? theme.fail : 0);
  }

  function comparisonTrend(recent10, recent30) {
    const minimum = recentApi?.TREND_MIN_RESULTS || 4;
    if (comparableCount(recent10) < minimum || comparableCount(recent30) < minimum ||
        recent10?.passRate === null || recent30?.passRate === null) return "insufficient_data";
    const delta = recent10.passRate - recent30.passRate;
    const threshold = recentApi?.TREND_THRESHOLD || 0.25;
    if (delta >= threshold) return "improving";
    if (delta <= -threshold) return "worsening";
    return "stable";
  }

  function buildThemeProgress(currentTasks, summaries) {
    const recent10 = summaries?.[10] || null;
    const recent30 = summaries?.[30] || null;
    const canonicalThemes = Array.isArray(recentApi?.THEMES) ? recentApi.THEMES : [];
    const orderedThemes = [];
    const seen = new Set();
    const include = (themeName) => {
      if (!canonicalThemes.includes(themeName) || seen.has(themeName)) return;
      seen.add(themeName);
      orderedThemes.push(themeName);
    };
    for (const task of Array.isArray(currentTasks) ? currentTasks : []) include(task?.nextCheck?.theme);
    for (const theme of Array.isArray(recent30?.themes) ? recent30.themes : []) {
      if ((theme?.evidenceRefs?.length || 0) > 0) include(theme.theme);
    }
    for (const theme of Array.isArray(recent10?.themes) ? recent10.themes : []) {
      if ((theme?.evidenceRefs?.length || 0) > 0) include(theme.theme);
    }

    return orderedThemes.map((themeName) => {
      const ten = summaryTheme(recent10, themeName);
      const thirty = summaryTheme(recent30, themeName);
      const source = thirty || ten;
      const history = (Array.isArray(source?.evidenceRefs) ? source.evidenceRefs : [])
        .filter((ref) => ref && Object.prototype.hasOwnProperty.call(STATUS_LABELS, ref.status))
        .slice(-5);
      const latestEvidence = history.slice().reverse().find((ref) =>
        (ref.status === "pass" || ref.status === "fail") && ref.gameId && Number.isInteger(ref.ply)) || null;
      const trend = comparisonTrend(ten, thirty);
      const comparison = trend !== "insufficient_data" ? {
        recent10Rate: ten.passRate,
        recent30Rate: thirty.passRate,
        trend,
      } : null;
      return {
        theme: themeName,
        history,
        passRate: source?.passRate ?? null,
        comparison,
        latestEvidence,
      };
    });
  }

  function buildModel(records, summary, allSummaries = null) {
    const latest = recentRecord(records);
    const analysis = latest?.analysis && typeof latest.analysis === "object" ? latest.analysis : {};
    const currentTasks = Array.isArray(analysis.currentTasks) ? analysis.currentTasks.slice(0, 3) : [];
    return {
      schema: "growth-dashboard-v1",
      window: summary?.window || 10,
      sampleGames: summary?.sampleGames || 0,
      latestGameId: latest?.id || null,
      latestDate: latest?.date || null,
      currentTasks,
      coachingFocus: coachingApi?.selectCoachingFocus(currentTasks, summary) || null,
      nextGameRoutine: coachingApi?.buildNextGameRoutine(currentTasks) || null,
      latestResults: Array.isArray(analysis.taskResults) ? analysis.taskResults.filter((item) =>
        item && Object.prototype.hasOwnProperty.call(STATUS_LABELS, item.status)).slice(0, 3) : [],
      achievement: achievementFromSummary(summary),
      score: scoreFromSummary(records, summary),
      themes: Array.isArray(summary?.themes) ? summary.themes : [],
      improvements: Array.isArray(summary?.improvements) ? summary.improvements : [],
      recurringChallenges: Array.isArray(summary?.recurringChallenges) ? summary.recurringChallenges : [],
      strengths: Array.isArray(summary?.strengths) ? summary.strengths : [],
      themeProgress: buildThemeProgress(currentTasks, allSummaries || { [summary?.window || 10]: summary }),
    };
  }

  return { STATUS_LABELS, TREND_LABELS, achievementFromSummary, buildModel, buildThemeProgress, comparisonTrend, scoreFromSummary, winnerSide };
});

if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = "#home.active{height:100%;overflow-y:auto;overscroll-behavior:contain;padding-bottom:8px}.growthDashboard{font-size:10px}.growthPanel{margin:5px 0;padding:7px;background:#292117;border:1px solid #5c4933;border-radius:8px}.growthPanel h2{margin:0 0 4px;color:#ffd590;font-size:11px}.growthLead{margin:0 0 5px;color:#c8b99e;font-size:9px}.growthTaskDetails>summary{cursor:pointer;color:#ffd590;font-weight:700}.growthTask,.growthEvidence{display:grid;grid-template-columns:22px minmax(0,1fr);gap:1px 4px;width:100%;min-height:38px;padding:5px 2px;border:0;border-top:1px solid #4c4438;background:transparent;color:#fff3df;text-align:left;font:inherit}.growthTask strong,.growthEvidence strong{grid-row:1/3;display:flex;align-items:center;justify-content:center;color:#f1c679}.growthTask b,.growthEvidence b{font-size:10px}.growthTask span,.growthEvidence span{font-size:8px;color:#c7ebc9;overflow-wrap:anywhere}.growthEmpty{margin:5px 0;color:#b9aa96;line-height:1.4}.growthAchievement{display:grid;grid-template-columns:88px 1fr;gap:7px;align-items:center}.growthRate{font-size:22px;font-weight:800;color:#a8efb3}.growthRate small{display:block;font-size:8px;color:#c8b99e}.growthCounts{line-height:1.65;color:#d7c8b2}.growthLatest{display:flex;gap:4px;flex-wrap:wrap;margin-top:5px}.growthResult{border:1px solid #6d5437;border-radius:99px;background:#211a13;color:#fff3df;padding:4px 7px;font:inherit}.growthResult.pass{border-color:#62d17d}.growthResult.fail{border-color:#e85a49}.growthResult.no_opportunity{border-color:#867a6b}.growthDetails summary{cursor:pointer;color:#ffd590;font-weight:700}.growthInsightGroup{margin-top:6px}.growthInsightGroup h3{margin:0;font-size:9px;color:#c8b99e}.growthInsight{display:flex;justify-content:space-between;width:100%;min-height:30px;border:0;border-top:1px solid #4c4438;background:transparent;color:#fff3df;padding:4px 2px;font:inherit;text-align:left}.growthInsight span{color:#e9c98f}.growthFooter{display:grid;grid-template-columns:1fr 1fr;gap:5px}.growthFooter button{min-height:34px;border:1px solid #6d5437;border-radius:7px;background:#423426;color:#ffe0a5;font:700 9px inherit}.growthTask:focus-visible,.growthEvidence:focus-visible,.growthResult:focus-visible,.growthInsight:focus-visible,.growthFooter button:focus-visible{outline:2px solid #f1c679;outline-offset:-2px}@media(max-width:390px){.growthPanel{padding:6px}.growthTask,.growthEvidence{min-height:40px}.growthAchievement{grid-template-columns:82px minmax(0,1fr)}}";
  style.textContent += ".growthProgress{margin-top:7px;border-top:1px solid #5c4933;padding-top:6px}.growthProgress summary{cursor:pointer;color:#ffd590;font-weight:700}.growthProgressRow{display:grid;grid-template-columns:minmax(60px,.8fr) minmax(0,1.4fr) auto;gap:3px 6px;align-items:center;width:100%;min-height:38px;padding:5px 2px;border:0;border-top:1px solid #4c4438;background:transparent;color:#fff3df;text-align:left;font:inherit}.growthProgressRow:disabled{opacity:1}.growthProgressRow b,.growthProgressHistory,.growthProgressRate{white-space:nowrap}.growthProgressHistory{letter-spacing:1px;color:#f5d49c}.growthProgressRate{color:#a8efb3;font-weight:700}.growthProgressCompare{grid-column:1/-1;color:#c8b99e;font-size:8px;overflow-wrap:anywhere}.growthProgressRow:not(:disabled) .growthProgressCompare::after{content:'  根拠を見る ›';color:#e9c98f}.growthProgressRow:focus-visible{outline:2px solid #f1c679;outline-offset:-2px}@media(max-width:390px){.growthProgressRow{grid-template-columns:minmax(56px,.75fr) minmax(0,1.25fr) auto;gap:3px 4px}.growthProgressHistory{letter-spacing:0}}";
  document.head.appendChild(style);

  let records = [];
  let summaries = null;
  let activeWindow = 10;

  function appendText(parent, tag, value, className) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value;
    parent.appendChild(element);
    return element;
  }

  async function jumpToEvidence(gameId, targetPly) {
    if (!gameId || typeof window.loadGame !== "function") return;
    await window.loadGame(gameId, true);
    if (Number.isInteger(targetPly) && typeof window.jumpToSummaryPosition === "function") {
      window.jumpToSummaryPosition(targetPly);
    }
  }

  function evidenceButton(parent, item, gameId, index) {
    const taskView = window.ShogiCoachingFocus?.buildHumanTaskView(item, null);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "growthTask";
    appendText(button, "strong", String(index + 1));
    appendText(button, "b", taskView?.headline || item.title || "現在の課題");
    appendText(button, "span", taskView?.action || "指す前に、現在の課題を1回確認する");
    button.addEventListener("click", () => jumpToEvidence(item.sourceGame || gameId, item.sourcePly));
    parent.appendChild(button);
  }

  function insightGroup(parent, title, items, emptyText) {
    const group = document.createElement("div");
    group.className = "growthInsightGroup";
    appendText(group, "h3", title);
    if (!items.length) appendText(group, "p", emptyText, "growthEmpty");
    for (const item of items) {
      const ref = item.evidenceRefs?.[0];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "growthInsight";
      appendText(button, "b", window.ShogiRecentAnalysis.THEME_LABELS[item.theme] || item.theme);
      appendText(button, "span", ref ? "根拠を見る ›" : "根拠なし");
      button.disabled = !ref;
      if (ref) button.addEventListener("click", () => jumpToEvidence(ref.gameId, ref.ply));
      group.appendChild(button);
    }
    parent.appendChild(group);
  }

  function renderThemeProgress(parent, progress) {
    const details = document.createElement("details");
    details.className = "growthProgress";
    appendText(details, "summary", "課題の推移");
    if (!progress.length) appendText(details, "p", "表示できる課題判定はまだありません。", "growthEmpty");
    for (const item of progress) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "growthProgressRow";
      button.disabled = !item.latestEvidence;
      appendText(button, "b", window.ShogiRecentAnalysis.THEME_LABELS[item.theme] || item.theme);
      appendText(button, "span", item.history.length ? item.history.map((ref) =>
        window.ShogiGrowthDashboard.STATUS_LABELS[ref.status]).join(" ") : "履歴なし", "growthProgressHistory");
      appendText(button, "span", item.passRate === null ? "－" : `${Math.round(item.passRate * 100)}%`, "growthProgressRate");
      const comparisonText = item.comparison ?
        `直近10局 ${Math.round(item.comparison.recent10Rate * 100)}% / 直近30局 ${Math.round(item.comparison.recent30Rate * 100)}% → ${window.ShogiGrowthDashboard.TREND_LABELS[item.comparison.trend]}` :
        "10/30比較: データ不足";
      appendText(button, "span", comparisonText, "growthProgressCompare");
      if (item.latestEvidence) button.addEventListener("click", () =>
        jumpToEvidence(item.latestEvidence.gameId, item.latestEvidence.ply));
      details.appendChild(button);
    }
    parent.appendChild(details);
  }

  function renderDashboard() {
    const container = document.getElementById("growthDashboard");
    if (!container || !summaries) return;
    const model = window.ShogiGrowthDashboard.buildModel(records, summaries[activeWindow], summaries);
    if (typeof window.renderPreGameCoach === "function") {
      window.renderPreGameCoach(model.currentTasks, summaries[10], model.latestGameId);
    }
    container.replaceChildren();

    const tasks = document.createElement("section");
    tasks.className = "growthPanel";
    const taskDetails = document.createElement("details");
    taskDetails.className = "growthTaskDetails";
    appendText(taskDetails, "summary", `詳細な現在の課題（${model.currentTasks.length}/3）`);
    appendText(taskDetails, "p", model.latestDate ? `${model.latestDate} の解析から、次局で意識すること` : "解析済み対局はまだありません。", "growthLead");
    if (!model.currentTasks.length) appendText(taskDetails, "p", "根拠のある現在の課題はありません。", "growthEmpty");
    model.currentTasks.forEach((task, index) => evidenceButton(taskDetails, task, model.latestGameId, index));
    renderThemeProgress(taskDetails, model.themeProgress);
    tasks.appendChild(taskDetails);
    container.appendChild(tasks);

    const achievement = document.createElement("section");
    achievement.className = "growthPanel";
    appendText(achievement, "h2", `最近の達成状況（直近${model.window}局）`);
    const summary = document.createElement("div");
    summary.className = "growthAchievement";
    const rate = document.createElement("div");
    rate.className = "growthRate";
    rate.textContent = model.achievement.rate === null ? "データ不足" : `${Math.round(model.achievement.rate * 100)}%`;
    appendText(rate, "small", model.achievement.rate === null ? "比較できる○/×なし" : "課題達成率");
    summary.appendChild(rate);
    const counts = document.createElement("div");
    counts.className = "growthCounts";
    counts.textContent = `○ ${model.achievement.pass}　× ${model.achievement.fail}　－ ${model.achievement.noOpportunity}`;
    if (model.score) appendText(counts, "div", `直近成績 ${model.score.wins}勝${model.score.losses}敗（判定可能${model.score.games}局）`);
    appendText(counts, "div", `対象 ${model.sampleGames}局 / －は率の分母外`);
    summary.appendChild(counts);
    achievement.appendChild(summary);
    appendText(achievement, "p", "最新の課題判定", "growthLead");
    const latest = document.createElement("div");
    latest.className = "growthLatest";
    if (!model.latestResults.length) appendText(latest, "span", "判定履歴はまだありません。", "growthEmpty");
    for (const result of model.latestResults) {
      const resultView = window.ShogiCoachingFocus?.buildHumanTaskView(result, null);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `growthResult ${result.status}`;
      button.textContent = `${window.ShogiGrowthDashboard.STATUS_LABELS[result.status]} ${resultView?.headline || result.title || "課題"}`;
      button.addEventListener("click", () => jumpToEvidence(model.latestGameId, result.ply));
      latest.appendChild(button);
    }
    achievement.appendChild(latest);
    container.appendChild(achievement);

    const insights = document.createElement("section");
    insights.className = "growthPanel";
    const details = document.createElement("details");
    details.className = "growthDetails";
    appendText(details, "summary", "改善・繰り返す課題・強み（根拠つき）");
    insightGroup(details, "改善傾向", model.improvements, "比較可能な○/×が不足しています。");
    insightGroup(details, "繰り返す課題", model.recurringChallenges, "複数局の×は確認されていません。");
    insightGroup(details, "強み", model.strengths, "継続した○はまだ確認されていません。");
    insights.appendChild(details);
    container.appendChild(insights);

    const footer = document.createElement("div");
    footer.className = "growthFooter";
    for (const windowSize of [10, 30]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = windowSize === activeWindow ? `直近${windowSize}局を表示中` : `直近${windowSize}局に切替`;
      button.setAttribute("aria-pressed", String(windowSize === activeWindow));
      button.addEventListener("click", () => { activeWindow = windowSize; renderDashboard(); });
      footer.appendChild(button);
    }
    const detailsButton = document.createElement("button");
    detailsButton.type = "button";
    detailsButton.textContent = "10/30詳細を見る";
    detailsButton.addEventListener("click", () => {
      const target = document.getElementById("recentAnalysis");
      if (!target) return;
      target.scrollIntoView({ block: "start", behavior: "instant" });
      target.querySelector('.recentTab[aria-pressed="true"]')?.focus({ preventScroll: true });
    });
    footer.appendChild(detailsButton);
    container.appendChild(footer);
  }

  window.renderGrowthDashboard = function renderGrowthDashboard(recentRecords, recentSummaries) {
    const container = document.getElementById("growthDashboard");
    if (!container || !window.ShogiRecentAnalysis) return;
    records = Array.isArray(recentRecords) ? recentRecords : [];
    summaries = recentSummaries || window.ShogiRecentAnalysis.buildRecentSummaries([]);
    renderDashboard();
  };

  if (window.shogiRecentSummaries) {
    window.renderGrowthDashboard(window.shogiRecentRecords, window.shogiRecentSummaries);
  } else {
    const container = document.getElementById("growthDashboard");
    if (container) appendText(container, "p", "成長データを読み込んでいます…", "growthPanel");
  }
}
