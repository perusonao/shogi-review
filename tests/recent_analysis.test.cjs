const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const recent = require("../recent-analysis.js");

function result(gameId, theme, status, index = 0, ply = 20) {
  const opportunity = status !== "no_opportunity";
  return {
    id: `tr-${gameId}-${theme}-${index}`,
    taskId: `task-${theme}`,
    gameId, theme, status,
    label: { pass: "○", fail: "×", no_opportunity: "－" }[status],
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

function game(day, suffix, results = [], overrides = {}) {
  const id = `202609${String(day).padStart(2, "0")}_${suffix}`;
  return { id, date: `2026/09/${String(day).padStart(2, "0")}`, analyzed: true, moves: 100,
    analysis: { gameId: id, moves: 100, taskResults: results }, ...overrides };
}

test("10局未満は全件、10局ちょうどは10件を決定論的に選ぶ", () => {
  const nine = Array.from({ length: 9 }, (_, index) => game(index + 1, `g${index}`));
  assert.equal(recent.aggregateWindow(nine, 10).sampleGames, 9);
  const ten = [...nine, game(10, "g9")];
  assert.equal(recent.aggregateWindow(ten, 10).sampleGames, 10);
  assert.equal(recent.aggregateWindow(ten, 10).gameIds[0], "20260910_g9");
});

test("30局以上から最新30件を抽出し同日idで安定順序にする", () => {
  const records = Array.from({ length: 32 }, (_, index) => game((index % 28) + 1, `g${String(index).padStart(2, "0")}`));
  const first = recent.aggregateWindow(records, 30).gameIds;
  const second = recent.aggregateWindow(records.slice().reverse(), 30).gameIds;
  assert.equal(first.length, 30);
  assert.deepEqual(first, second);
});

test("－だけのthemeは○率とtrendを断定しない", () => {
  const one = game(1, "a");
  one.analysis.taskResults = [result(one.id, "check", "no_opportunity")];
  const theme = recent.aggregateWindow([one], 10).themes[0];
  assert.equal(theme.opportunities, 0);
  assert.equal(theme.noOpportunity, 1);
  assert.equal(theme.passRate, null);
  assert.equal(theme.trend, "insufficient_data");
});

test("○×混在を集計し－を○率の分母に入れない", () => {
  const a = game(1, "a");
  const b = game(2, "b");
  const c = game(3, "c");
  a.analysis.taskResults = [result(a.id, "capture", "pass")];
  b.analysis.taskResults = [result(b.id, "capture", "fail")];
  c.analysis.taskResults = [result(c.id, "capture", "no_opportunity")];
  const theme = recent.aggregateWindow([c, a, b], 10).themes.find((item) => item.theme === "capture");
  assert.deepEqual({ opportunities: theme.opportunities, pass: theme.pass, fail: theme.fail, noOpportunity: theme.noOpportunity },
    { opportunities: 2, pass: 1, fail: 1, noOpportunity: 1 });
  assert.equal(theme.passRate, 0.5);
});

test("trendは比較可能4件以上を前後半比較し25ポイント差で判定する", () => {
  const statuses = ["fail", "fail", "pass", "pass"];
  const improving = statuses.map((status, index) => {
    const row = game(index + 1, `i${index}`);
    row.analysis.taskResults = [result(row.id, "promotion", status)];
    return row;
  });
  assert.equal(recent.aggregateWindow(improving, 10).themes.find((item) => item.theme === "promotion").trend, "improving");
  assert.equal(recent.trendFor(improving.slice(0, 3).map((record) => ({ record, result: record.analysis.taskResults[0] }))), "insufficient_data");
  const stableRows = ["pass", "fail", "pass", "fail"].map((status, index) => ({ result: { status } }));
  const worseningRows = ["pass", "pass", "fail", "fail"].map((status) => ({ result: { status } }));
  assert.equal(recent.trendFor(stableRows), "stable");
  assert.equal(recent.trendFor(worseningRows), "worsening");
});

test("反復×・改善・継続成功だけをinsightにする", () => {
  const statuses = ["fail", "fail", "pass", "pass"];
  const records = statuses.map((status, index) => {
    const row = game(index + 1, `x${index}`);
    row.analysis.taskResults = [result(row.id, "check", status), result(row.id, "drop", "pass", 1)];
    return row;
  });
  const summary = recent.aggregateWindow(records, 10);
  assert.deepEqual(summary.recurringChallenges.map((item) => item.theme), ["check"]);
  assert.deepEqual(summary.improvements.map((item) => item.theme), ["check"]);
  assert.deepEqual(summary.strengths.map((item) => item.theme), ["drop"]);
});

test("1局成功はstrengthにせず根拠game/plyを保持する", () => {
  const row = game(1, "one");
  row.analysis.taskResults = [result(row.id, "check", "pass", 0, 44)];
  const summary = recent.aggregateWindow([row], 10);
  assert.equal(summary.strengths.length, 0);
  assert.deepEqual(summary.themes[0].evidenceRefs[0], { gameId: row.id, ply: 44, taskResultId: `tr-${row.id}-check-0`, status: "pass" });
});

test("legacy・不正結果をskipしduplicate/retryを二重集計しない", () => {
  const legacy = game(1, "legacy", [], { analysis: { gameId: "legacy" } });
  const row = game(2, "valid");
  const pass = result(row.id, "check", "pass");
  row.analysis.taskResults = [pass, { ...pass }, { ...pass, id: "bad", gameId: "other" }];
  const summary = recent.aggregateWindow([legacy, row, { ...row }], 10);
  assert.equal(summary.sampleGames, 2);
  assert.equal(summary.themes[0].pass, 1);
  assert.deepEqual(summary, recent.aggregateWindow([legacy, row, { ...row }], 10));
});

test("phaseは既存35/75%区分を根拠plyがある機会だけに適用する", () => {
  assert.equal(recent.phaseFor(34, 100), "opening");
  assert.equal(recent.phaseFor(35, 100), "middlegame");
  assert.equal(recent.phaseFor(75, 100), "endgame");
  assert.equal(recent.phaseFor(null, 100), null);
});

test("PWAは390px、10/30切替、4主要表示、根拠導線を持つ", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const ui = fs.readFileSync(path.join(root, "recent-analysis.js"), "utf8");
  assert.match(html, /recent-analysis\.js\?v=2/);
  assert.match(ui, /container\.id = "recentAnalysis"/);
  assert.match(ui, /直近\$\{windowSize\}局/);
  for (const label of ["対象", "繰り返す課題", "改善傾向", "強み"]) assert.ok(ui.includes(label));
  assert.match(ui, /max-width:390px/);
  assert.match(ui, /window\.loadGame\(ref\.gameId, true\)/);
  assert.match(ui, /jumpToSummaryPosition\(ref\.ply\)/);
  assert.deepEqual(recent.TREND_LABELS, {
    improving: "改善傾向", stable: "横ばい・継続", worsening: "要注意", insufficient_data: "データ不足",
  });
});
