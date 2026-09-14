const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const recent = require("../recent-analysis.js");
const dashboard = require("../growth-dashboard.js");

function result(gameId, theme, status, index = 0, ply = 20) {
  const opportunity = status !== "no_opportunity";
  return {
    id: `tr-${gameId}-${theme}-${index}`,
    gameId, theme, status,
    label: dashboard.STATUS_LABELS[status],
    title: `${theme} task`,
    ply: opportunity ? ply : null,
    reason: { code: opportunity ? (status === "pass" ? "opportunity_satisfied" : "verified_repeated_issue") : "no_opportunity" },
    evidence: opportunity ? {
      verification: "legal-move-feature",
      opportunity: { featureVerified: true },
      played: { featureVerified: status === "pass" },
      ...(status === "fail" ? { verifiedIssue: { source: "verifiedIssues" } } : {}),
    } : { verification: "none" },
  };
}

function game(day, suffix, results = [], tasks = []) {
  const id = `202609${String(day).padStart(2, "0")}_${suffix}`;
  return { id, date: `2026/09/${String(day).padStart(2, "0")}`, analyzed: true, side: "先手",
    result: day % 2 ? "先手・user 勝利" : "後手・opponent 勝利", moves: 100,
    analysis: { gameId: id, moves: 100, taskResults: results, currentTasks: tasks } };
}

function model(records, windowSize = 10) {
  const summary = recent.aggregateWindow(records, windowSize);
  return dashboard.buildModel(records, summary);
}

test("0局とlegacy dataはデータ不足として安全に扱う", () => {
  const empty = model([]);
  assert.equal(empty.latestGameId, null);
  assert.equal(empty.achievement.rate, null);
  assert.deepEqual(empty.currentTasks, []);
  assert.deepEqual(empty.latestResults, []);
  assert.equal(empty.score, null);
  const legacy = model([game(1, "legacy")]);
  assert.equal(legacy.sampleGames, 1);
  assert.equal(legacy.achievement.rate, null);
});

test("－のみとdenominator zeroで0%または100%を断定しない", () => {
  const row = game(1, "excluded");
  row.analysis.taskResults = [result(row.id, "check", "no_opportunity")];
  const value = model([row]).achievement;
  assert.deepEqual(value, { pass: 0, fail: 0, noOpportunity: 1, denominator: 0, rate: null });
});

test("○のみ、×のみ、○/×/－混在は○/(○+×)で算出する", () => {
  const pass = game(1, "pass");
  pass.analysis.taskResults = [result(pass.id, "check", "pass")];
  assert.equal(model([pass]).achievement.rate, 1);
  const fail = game(2, "fail");
  fail.analysis.taskResults = [result(fail.id, "check", "fail")];
  assert.equal(model([fail]).achievement.rate, 0);
  const excluded = game(3, "excluded");
  excluded.analysis.taskResults = [result(excluded.id, "check", "no_opportunity")];
  const mixed = model([pass, fail, excluded]).achievement;
  assert.deepEqual(mixed, { pass: 1, fail: 1, noOpportunity: 1, denominator: 2, rate: 0.5 });
});

test("最新対局のCurrent Tasks 0/1/3と○/×/－履歴を最大3件表示する", () => {
  assert.equal(model([game(1, "zero")]).currentTasks.length, 0);
  const one = game(2, "one", [], [{ id: "a", title: "A" }]);
  assert.equal(model([one]).currentTasks.length, 1);
  const tasks = Array.from({ length: 4 }, (_, index) => ({ id: String(index), title: String(index) }));
  const latest = game(3, "latest", [], tasks);
  latest.analysis.taskResults = ["pass", "fail", "no_opportunity"].map((status, index) => result(latest.id, "check", status, index));
  assert.equal(model([one, latest]).currentTasks.length, 3);
  assert.deepEqual(model([one, latest]).latestResults.map((item) => item.label), ["○", "×", "－"]);
});

test("共通selectorからCoaching Focusと次局ルーティンを構築する", () => {
  const tasks = [
    { id: "capture", title: "取れる駒を確認する", nextCheck: { theme: "capture" } },
    { id: "drop", title: "駒打ちの候補を確認する", nextCheck: { theme: "drop" } },
  ];
  const row = game(3, "focus", [], tasks);
  const recentSummary = {
    window: 10, sampleGames: 3, gameIds: [row.id],
    themes: [
      { theme: "capture", pass: 2, fail: 0, noOpportunity: 0, evidenceRefs: [] },
      { theme: "drop", pass: 0, fail: 3, noOpportunity: 1, evidenceRefs: [
        { status: "fail" }, { status: "no_opportunity" }, { status: "fail" }, { status: "fail" },
      ] },
    ],
    recurringChallenges: [{ theme: "drop", kind: "recurring_challenge", evidenceRefs: [] }],
  };
  const built = dashboard.buildModel([row], recentSummary);
  assert.equal(built.coachingFocus.task.id, "drop");
  assert.equal(built.nextGameRoutine, "指す前に確認: 取れる駒 → 駒打ち");
});

test("recent summaryのtrendとinsight/evidenceを再計算せず保持する", () => {
  const summary = {
    window: 10, sampleGames: 1, gameIds: ["g"],
    themes: [{ theme: "check", pass: 1, fail: 0, noOpportunity: 0, trend: "worsening", evidenceRefs: [] }],
    improvements: [{ theme: "promotion", kind: "improvement", evidenceRefs: [{ gameId: "g", ply: 42 }] }],
    recurringChallenges: [{ theme: "check", kind: "recurring_challenge", evidenceRefs: [] }],
    strengths: [{ theme: "drop", kind: "strength", evidenceRefs: [] }],
  };
  const built = dashboard.buildModel([], summary);
  assert.equal(built.themes, summary.themes);
  assert.equal(built.improvements, summary.improvements);
  assert.equal(built.recurringChallenges, summary.recurringChallenges);
  assert.equal(built.strengths, summary.strengths);
  assert.equal(built.themes[0].trend, "worsening");
});

test("1/10未満/10以上30未満/30以上でも既存window summaryを使う", () => {
  for (const count of [1, 9, 10, 29, 31]) {
    const records = Array.from({ length: count }, (_, index) => game((index % 28) + 1, `g${index}`));
    assert.equal(model(records, 10).sampleGames, Math.min(count, 10));
    assert.equal(model(records, 30).sampleGames, Math.min(count, 30));
  }
});

test("安全に判定できる直近勝敗だけを表示する", () => {
  const records = [game(1, "win"), game(2, "loss"), { ...game(3, "unknown"), result: "引き分け" }];
  assert.deepEqual(model(records).score, { wins: 1, losses: 1, games: 2 });
});

test("390px UI、折りたたみ、10/30、evidence navigationを備える", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const ui = fs.readFileSync(path.join(root, "growth-dashboard.js"), "utf8");
  assert.match(html, /id="growthDashboard"/);
  assert.match(html, /growth-dashboard\.js\?v=30/);
  assert.match(ui, /max-width:390px/);
  assert.match(ui, /document\.createElement\("details"\)/);
  assert.match(ui, /for \(const windowSize of \[10, 30\]\)/);
  assert.match(ui, /jumpToEvidence\(ref\.gameId, ref\.ply\)/);
  assert.match(ui, /window\.shogiRecentSummaries/);
  assert.doesNotMatch(ui, /\?growth=1/);
});
