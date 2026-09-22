(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ShogiRecentAnalysis = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const WINDOWS = [10, 30];
  const THEMES = ["check", "capture", "promotion", "drop"];
  const THEME_LABELS = { check: "王手候補", capture: "駒取り", promotion: "成り", drop: "駒打ち" };
  const TREND_LABELS = { improving: "改善傾向", stable: "横ばい・継続", worsening: "要注意", insufficient_data: "データ不足" };
  const TREND_MIN_RESULTS = 4;
  const TREND_MIN_HALF = 2;
  const TREND_THRESHOLD = 0.25;

  function dateValue(value) {
    if (typeof value !== "string") return null;
    const match = value.match(/^(\d{4})[\/-](\d{2})[\/-](\d{2})$/);
    if (!match) return null;
    return Number(`${match[1]}${match[2]}${match[3]}`);
  }

  function compareGamesNewest(a, b) {
    const dateDifference = (dateValue(b.date) || 0) - (dateValue(a.date) || 0);
    if (dateDifference) return dateDifference;
    const aId = String(a.id);
    const bId = String(b.id);
    return aId === bId ? 0 : (aId < bId ? 1 : -1);
  }

  function selectRecentGames(records, windowSize) {
    const byId = new Map();
    for (const record of Array.isArray(records) ? records : []) {
      if (!record || typeof record.id !== "string" || !record.id || !dateValue(record.date)) continue;
      if (record.analyzed === false || !record.analysis || typeof record.analysis !== "object") continue;
      if (!byId.has(record.id)) byId.set(record.id, record);
    }
    return Array.from(byId.values()).sort(compareGamesNewest).slice(0, windowSize);
  }

  function validResult(result, gameId) {
    if (!result || typeof result !== "object" || result.gameId !== gameId) return false;
    if (!THEMES.includes(result.theme) || !["pass", "fail", "no_opportunity"].includes(result.status)) return false;
    if (result.status === "pass") {
      return result.evidence?.verification === "legal-move-feature" &&
        result.evidence?.opportunity?.featureVerified === true && result.evidence?.played?.featureVerified === true;
    }
    if (result.status === "fail") {
      return result.evidence?.verification === "legal-move-feature" &&
        result.evidence?.opportunity?.featureVerified === true &&
        result.evidence?.played?.featureVerified === false && result.evidence?.verifiedIssue?.source === "verifiedIssues";
    }
    return result.reason?.code === "no_opportunity" || result.reason?.code === "insufficient_evidence";
  }

  function hasOpportunity(result) {
    return result.evidence?.verification === "legal-move-feature" &&
      result.evidence?.opportunity?.featureVerified === true;
  }

  function evidenceRef(record, result) {
    return {
      gameId: record.id,
      ply: Number.isInteger(result.ply) ? result.ply : null,
      taskResultId: typeof result.id === "string" ? result.id : null,
      status: result.status,
    };
  }

  function trendFor(comparable) {
    if (comparable.length < TREND_MIN_RESULTS) return "insufficient_data";
    const split = Math.floor(comparable.length / 2);
    const older = comparable.slice(0, split);
    const newer = comparable.slice(split);
    if (older.length < TREND_MIN_HALF || newer.length < TREND_MIN_HALF) return "insufficient_data";
    const rate = (rows) => rows.filter((row) => row.result.status === "pass").length / rows.length;
    const delta = rate(newer) - rate(older);
    if (delta >= TREND_THRESHOLD) return "improving";
    if (delta <= -TREND_THRESHOLD) return "worsening";
    return "stable";
  }

  function phaseFor(ply, moves) {
    if (!Number.isInteger(ply) || ply < 1 || !Number.isInteger(moves) || moves < 1) return null;
    const progress = ply / moves;
    if (progress < 0.35) return "opening";
    if (progress < 0.75) return "middlegame";
    return "endgame";
  }

  function emptyTheme(theme) {
    return {
      theme,
      opportunities: 0,
      pass: 0,
      fail: 0,
      noOpportunity: 0,
      passRate: null,
      trend: "insufficient_data",
      evidenceRefs: [],
    };
  }

  function insight(theme, kind, evidenceRefs) {
    return { theme: theme.theme, kind, evidenceRefs: evidenceRefs.slice(0, 5) };
  }

  function aggregateWindow(records, windowSize) {
    const selected = selectRecentGames(records, windowSize);
    const chronological = selected.slice().sort((a, b) => -compareGamesNewest(a, b));
    const rowsByTheme = new Map(THEMES.map((theme) => [theme, []]));
    const phaseRows = { opening: [], middlegame: [], endgame: [] };

    for (const record of chronological) {
      const results = Array.isArray(record.analysis.taskResults) ? record.analysis.taskResults : [];
      const seen = new Set();
      for (const result of results) {
        const identity = typeof result?.id === "string" ? result.id : `${result?.taskId || ""}\0${record.id}`;
        if (seen.has(identity) || !validResult(result, record.id)) continue;
        seen.add(identity);
        const row = { record, result };
        rowsByTheme.get(result.theme).push(row);
        const phase = hasOpportunity(result) ? phaseFor(result.ply, Number(record.analysis.moves || record.moves)) : null;
        if (phase) phaseRows[phase].push(row);
      }
    }

    const themes = THEMES.map((themeName) => {
      const rows = rowsByTheme.get(themeName);
      const theme = emptyTheme(themeName);
      for (const row of rows) {
        theme[row.result.status === "no_opportunity" ? "noOpportunity" : row.result.status] += 1;
        if (hasOpportunity(row.result)) theme.opportunities += 1;
        theme.evidenceRefs.push(evidenceRef(row.record, row.result));
      }
      const comparable = rows.filter((row) => row.result.status === "pass" || row.result.status === "fail");
      theme.passRate = comparable.length ? theme.pass / comparable.length : null;
      theme.trend = trendFor(comparable);
      return theme;
    });

    const byImportance = (a, b) => b.fail - a.fail || b.opportunities - a.opportunities ||
      THEMES.indexOf(a.theme) - THEMES.indexOf(b.theme);
    const recurringChallenges = themes.filter((theme) => theme.fail >= 2 &&
      new Set(theme.evidenceRefs.filter((ref) => ref.status === "fail").map((ref) => ref.gameId)).size >= 2)
      .sort(byImportance).slice(0, 3)
      .map((theme) => insight(theme, "recurring_challenge", theme.evidenceRefs.filter((ref) => ref.status === "fail")));
    const improvements = themes.filter((theme) => theme.trend === "improving")
      .sort((a, b) => b.passRate - a.passRate || byImportance(a, b)).slice(0, 3)
      .map((theme) => insight(theme, "improvement", theme.evidenceRefs));
    const strengths = themes.filter((theme) => {
      const comparableRefs = theme.evidenceRefs.filter((ref) => ref.status === "pass" || ref.status === "fail");
      return comparableRefs.length >= 3 && theme.pass >= 3 && theme.passRate >= 0.75 &&
        comparableRefs.slice(-2).every((ref) => ref.status === "pass");
    }).sort((a, b) => b.passRate - a.passRate || b.pass - a.pass || byImportance(a, b)).slice(0, 3)
      .map((theme) => insight(theme, "strength", theme.evidenceRefs.filter((ref) => ref.status === "pass")));

    const phaseSummary = {};
    for (const phase of Object.keys(phaseRows)) {
      const rows = phaseRows[phase];
      const pass = rows.filter((row) => row.result.status === "pass").length;
      const fail = rows.filter((row) => row.result.status === "fail").length;
      phaseSummary[phase] = {
        opportunities: rows.length,
        pass,
        fail,
        passRate: pass + fail ? pass / (pass + fail) : null,
      };
    }

    return {
      schema: "recent-summary-v1",
      window: windowSize,
      sampleGames: selected.length,
      gameIds: selected.map((record) => record.id),
      themes,
      recurringChallenges,
      improvements,
      strengths,
      phaseSummary,
    };
  }

  function buildRecentSummaries(records) {
    return Object.fromEntries(WINDOWS.map((windowSize) => [windowSize, aggregateWindow(records, windowSize)]));
  }

  return {
    THEME_LABELS,
    THEMES,
    TREND_LABELS,
    TREND_MIN_RESULTS,
    TREND_THRESHOLD,
    aggregateWindow,
    buildRecentSummaries,
    compareGamesNewest,
    phaseFor,
    selectRecentGames,
    trendFor,
    validResult,
  };
});

if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = ".recentAnalysis{font-size:10px}.recentTabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin:5px 0}.recentTab{min-height:32px;border:1px solid #6d5437;border-radius:7px;background:#211a13;color:#d7c8b2;font:700 10px inherit}.recentTab:focus{outline:2px solid #f1c679;outline-offset:-3px}.recentTab.active{border-color:#d0a15e;background:#765123;color:#fff3df}.recentSample{margin:5px 0;color:#c8b99e}.recentSection{margin:5px 0;padding:7px;background:#292117;border:1px solid #5c4933;border-radius:8px}.recentSection h2{margin:0 0 4px;color:#ffd590;font-size:11px}.recentEmpty{margin:0;color:#b9aa96;line-height:1.4}.recentInsight{display:flex;align-items:center;justify-content:space-between;gap:5px;width:100%;min-height:30px;border:0;border-top:1px solid #4c4438;background:transparent;color:#fff3df;text-align:left;font:inherit}.recentInsight span{color:#e9c98f;font-size:9px}.recentThemes{width:100%;border-collapse:collapse}.recentThemes th,.recentThemes td{padding:4px 2px;border-top:1px solid #4c4438;text-align:right}.recentThemes th:first-child,.recentThemes td:first-child{text-align:left}.recentThemes th{color:#c8b99e;font-size:8px}.recentLoading{padding:10px;color:#c8b99e}@media(max-width:390px){.recentSection{padding:6px}.recentInsight{min-height:34px}.recentThemes th,.recentThemes td{padding:5px 1px;font-size:9px}}";
  document.head.appendChild(style);

  const analysisView = document.getElementById("analysis");
  if (analysisView) {
    const heading = analysisView.querySelector("h1");
    if (heading) heading.textContent = "最近の傾向";
    const legacy = analysisView.querySelector(".lesson");
    if (legacy) legacy.remove();
    const container = document.createElement("div");
    container.id = "recentAnalysis";
    container.className = "recentAnalysis";
    container.setAttribute("aria-live", "polite");
    analysisView.appendChild(container);
  }

  let summaries = null;
  let activeWindow = 10;

  function appendText(parent, tag, value, className) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value;
    parent.appendChild(element);
    return element;
  }

  function insightSection(container, title, items, emptyText) {
    const section = document.createElement("section");
    section.className = "recentSection";
    appendText(section, "h2", title);
    if (!items.length) appendText(section, "p", emptyText, "recentEmpty");
    for (const item of items) {
      const ref = item.evidenceRefs[0];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "recentInsight";
      appendText(button, "b", window.ShogiRecentAnalysis.THEME_LABELS[item.theme] || item.theme);
      appendText(button, "span", ref && Number.isInteger(ref.ply) ? `${ref.ply}手目を見る ›` : "根拠局を見る ›");
      button.addEventListener("click", async () => {
        if (!ref) return;
        await window.loadGame(ref.gameId, true);
        if (Number.isInteger(ref.ply) && typeof window.jumpToSummaryPosition === "function") window.jumpToSummaryPosition(ref.ply);
      });
      section.appendChild(button);
    }
    container.appendChild(section);
  }

  function renderActiveSummary() {
    const container = document.getElementById("recentAnalysis");
    if (!container || !summaries) return;
    const summary = summaries[activeWindow];
    const tabs = document.createElement("div");
    tabs.className = "recentTabs";
    for (const windowSize of [10, 30]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `recentTab ${windowSize === activeWindow ? "active" : ""}`;
      button.textContent = `直近${windowSize}局`;
      button.setAttribute("aria-pressed", String(windowSize === activeWindow));
      button.addEventListener("click", () => { activeWindow = windowSize; renderActiveSummary(); });
      tabs.appendChild(button);
    }
    container.replaceChildren(tabs);
    appendText(container, "p", `対象 ${summary.sampleGames}局（最大${summary.window}局）`, "recentSample");
    insightSection(container, "繰り返す課題", summary.recurringChallenges, "機械検証済みの×が複数局で確認されていません。");
    insightSection(container, "改善傾向", summary.improvements, "比較できる○/×が不足しています。");
    insightSection(container, "強み", summary.strengths, "複数機会で継続した○がまだ確認されていません。");

    const section = document.createElement("section");
    section.className = "recentSection";
    appendText(section, "h2", "テーマ別");
    const table = document.createElement("table");
    table.className = "recentThemes";
    table.innerHTML = "<thead><tr><th>テーマ</th><th>機会</th><th>○</th><th>×</th><th>－</th><th>○率</th><th>傾向</th></tr></thead>";
    const body = document.createElement("tbody");
    for (const theme of summary.themes) {
      const row = document.createElement("tr");
      const values = [window.ShogiRecentAnalysis.THEME_LABELS[theme.theme], theme.opportunities, theme.pass, theme.fail,
        theme.noOpportunity, theme.passRate === null ? "－" : `${Math.round(theme.passRate * 100)}%`, window.ShogiRecentAnalysis.TREND_LABELS[theme.trend]];
      for (const value of values) appendText(row, "td", value);
      body.appendChild(row);
    }
    table.appendChild(body);
    section.appendChild(table);
    container.appendChild(section);
  }

  window.renderRecentAnalysis = async function renderRecentAnalysis(catalog) {
    const container = document.getElementById("recentAnalysis");
    if (!container) return;
    appendText(container.replaceChildren() || container, "p", "最近の対局を集計しています…", "recentLoading");
    const candidates = (Array.isArray(catalog) ? catalog : []).filter((game) => game?.analyzed && game.analysisData);
    const loaded = await Promise.all(candidates.map(async (game) => {
      try {
        const response = await fetch(`${game.analysisData}?recent=1`);
        if (!response.ok) return null;
        return { ...game, analysis: await response.json() };
      } catch (_error) {
        return null;
      }
    }));
    const records = loaded.filter(Boolean);
    summaries = window.ShogiRecentAnalysis.buildRecentSummaries(records);
    window.shogiRecentRecords = records;
    window.shogiRecentSummaries = summaries;
    if (typeof window.refreshReviewCoachingFocus === "function") window.refreshReviewCoachingFocus();
    renderActiveSummary();
    if (typeof window.renderGrowthDashboard === "function") window.renderGrowthDashboard(records, summaries);
  };
  if (Array.isArray(window.shogiGameCatalog)) window.renderRecentAnalysis(window.shogiGameCatalog);
}
