const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const summary = require(path.join(ROOT, "game-summary.js"));

function cp(ply, value) {
  return { ply, cp: value, score: { type: "cp", value } };
}

function issue(ply, before, after, loss = before - after) {
  return {
    ply,
    lossCp: loss,
    scorePerspective: "mover",
    scoreBefore: { type: "cp", value: before },
    scoreAfterActual: { type: "cp", value: after },
    playedJa: ply % 2 ? "▲7六歩" : "△3四歩",
    bestJa: ply % 2 ? "▲2六歩" : "△8四歩",
  };
}

test("先手・後手ユーザーのscoreを自分視点へ正規化する", () => {
  assert.equal(summary.evaluationFromUser(cp(1, 706), "sente").value, 706);
  assert.equal(summary.evaluationFromUser(cp(1, -706), "gote").value, 706);
  assert.equal(summary.evaluationLabel({ type: "cp", value: 900 }), "自分有利");
  assert.equal(summary.evaluationLabel({ type: "cp", value: -900 }), "相手有利");
});

test("最初の悪化と最大悪化を選ぶ", () => {
  const result = summary.selectImportantPositions({
    userSide: "sente", moves: 80,
    evaluations: [cp(0, 0), cp(80, -100)],
    verifiedIssues: [issue(20, 500, 100, 400), issue(44, 600, -500, 1100)],
  });
  assert.equal(result.find((item) => item.labels.includes("最初の分岐")).ply, 20);
  assert.equal(result.find((item) => item.labels.includes("最大の課題")).ply, 44);
});

test("明確な有利不利の入れ替わりだけを逆転として選ぶ", () => {
  const reversed = summary.selectImportantPositions({
    userSide: "sente", moves: 4,
    evaluations: [cp(0, 400), cp(1, 100), cp(2, -450), cp(3, -500)],
    verifiedIssues: [],
  });
  assert.equal(reversed.find((item) => item.label === "逆転局面").ply, 2);
  const steady = summary.selectImportantPositions({
    userSide: "sente", moves: 3,
    evaluations: [cp(0, 500), cp(1, 200), cp(2, 350)],
    verifiedIssues: [],
  });
  assert.equal(steady.some((item) => item.label === "逆転局面"), false);
});

test("mate領域へ入り戻らない局面を勝負を決めた局面にする", () => {
  const result = summary.selectImportantPositions({
    userSide: "gote", moves: 4,
    evaluations: [cp(0, 0), cp(1, 400), cp(2, -2200), { ply: 3, cp: -30000, score: { type: "mate", value: -5 } }],
    verifiedIssues: [],
  });
  const decisive = result.find((item) => item.label === "勝負を決めた局面");
  assert.equal(decisive.ply, 2);
  assert.equal(decisive.stateAfter, "自分優勢");
});

test("同一局面のカテゴリを統合し、全体を最大5局面に制限する", () => {
  const result = summary.selectImportantPositions({
    userSide: "sente", moves: 90,
    evaluations: [cp(0, 400), cp(10, -500), cp(60, 2200), cp(90, 2400)],
    verifiedIssues: [issue(10, 600, -500, 1100), issue(20, 200, -200, 400), issue(40, 900, -900, 1800)],
  });
  const ten = result.find((item) => item.ply === 10);
  assert.ok(ten.labels.includes("最初の分岐"));
  assert.ok(ten.labels.includes("序盤の重要判断"));
  assert.ok(result.length <= 5);
  assert.ok(result.length >= 1);
});

test("NAGATA2532 28手目を後手視点で保持する", () => {
  const analysis = JSON.parse(fs.readFileSync(path.join(ROOT, "analysis", "20260911_nagata2532.json"), "utf8"));
  const result = summary.selectImportantPositions(analysis);
  const move28 = result.find((item) => item.ply === 28);
  assert.ok(move28);
  assert.equal(move28.played, "△4四銀");
  assert.equal(move28.best, "△6八角成");
  assert.equal(move28.scoreText, "+706 → +241");
  const source = analysis.verifiedIssues.find((item) => item.ply === 28);
  assert.deepEqual(source.pvJa.slice(0, 6), ["△6八角成", "▲同銀", "△7八金打", "▲7九角", "△4四銀", "▲5三歩打"]);
  assert.deepEqual(source.actualPvJa.slice(0, 6), ["△4四銀", "▲5二飛成", "△同金右", "▲6九金", "△3四歩", "▲2三飛打"]);
});

test("旧analysis JSONも保存済みcpだけで処理する", () => {
  const old = JSON.parse(fs.readFileSync(path.join(ROOT, "analysis", "20260910_ひぐれ.json"), "utf8"));
  assert.equal(old.schemaVersion, 1);
  const result = summary.selectImportantPositions(old);
  assert.ok(result.length >= 1);
  assert.ok(result.length <= 5);
  assert.ok(result.every((item) => Number.isFinite(item.ply)));
});

test("総評は確認不能な棋理を創作せず、iPhone向けUIは横スクロールと局面ジャンプを持つ", () => {
  const text = summary.buildOverallComment([{ ply: 28, label: "最初の分岐" }]);
  for (const unsupported of ["作戦負け", "玉が薄い", "攻めが切れた", "棋風", "心理"]) assert.equal(text.includes(unsupported), false);
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const ui = fs.readFileSync(path.join(ROOT, "game-summary.js"), "utf8");
  assert.match(html, /summaryItems\{display:flex;gap:4px;overflow-x:auto/);
  assert.match(html, /#reviewView\.active\{[^}]*overflow-y:auto/);
  assert.match(ui, /jumpToSummaryPosition/);
  assert.match(ui, /scrollIntoView/);
});

function important(ply, label, overrides = {}) {
  return {
    ply,
    label,
    labels: [label],
    loss: null,
    scoreBefore: { type: "cp", value: 100 },
    scoreAfter: { type: "cp", value: 0 },
    scoreText: "+100 → +0",
    issue: null,
    ...overrides,
  };
}

test("学びは重複を除いて最大3件にする", () => {
  const source = [
    important(10, "その他"),
    important(10, "逆転局面"),
    important(20, "最初の分岐"),
    important(30, "最大の課題", { loss: 900 }),
    important(40, "勝負を決めた局面"),
  ];
  const result = summary.extractLearningItems({ gameId: "sample" }, source);
  assert.equal(result.length, 3);
  assert.equal(new Set(result.map((item) => item.ply)).size, 3);
});

test("mate、最大損失、最初の悪化の順で学びを優先する", () => {
  const source = [
    important(12, "最初の分岐", { loss: 400 }),
    important(30, "最大の課題", { loss: 1200 }),
    important(50, "勝負を決めた局面", { scoreAfter: { type: "mate", value: -5 } }),
    important(40, "逆転局面"),
  ];
  assert.deepEqual(summary.extractLearningItems({ gameId: "sample" }, source).map((item) => item.ply), [50, 30, 12]);
});

test("王手・駒取り・成り・打を保存済みPV事実だけから分類する", () => {
  const themed = (points, pv) => important(10, "最大の課題", { issue: { points, pv } });
  assert.equal(summary.learningTheme(themed(["推奨手は王手です。"], ["7g7f"])).type, "check");
  assert.equal(summary.learningTheme(themed(["読み筋の2手目は金を取る手です。"], ["7g7f"])).type, "capture");
  assert.equal(summary.learningTheme(themed([], ["8h2b+"])).type, "promotion");
  assert.equal(summary.learningTheme(themed([], ["P*5e"])).type, "drop");
});

test("根拠となる特徴がない学びは実戦手と推奨手の比較へfallbackする", () => {
  const item = important(10, "最大の課題", { issue: { points: [], pv: ["7g7f"] } });
  assert.deepEqual(summary.learningTheme(item), { type: "comparison", text: "実戦手と推奨手を比較" });
});

test("learning itemは将来集計用の最小構造を持つ", () => {
  const item = important(28, "最初の分岐", {
    loss: 465,
    issue: { played: "5c4d", best: "1c6h+", playedJa: "△4四銀", bestJa: "△6八角成", points: [], pv: [] },
  });
  const result = summary.extractLearningItems({ gameId: "20260911_nagata2532" }, [item])[0];
  assert.equal(result.gameId, "20260911_nagata2532");
  assert.equal(result.ply, 28);
  assert.equal(result.actualMove, "5c4d");
  assert.equal(result.bestMove, "1c6h+");
  assert.equal(result.loss, 465);
  assert.ok(Object.hasOwn(result, "mate"));
});

test("NAGATA2532の学びは重要局面の優先度上位3件から選び28手目を含む", () => {
  const analysis = JSON.parse(fs.readFileSync(path.join(ROOT, "analysis", "20260911_nagata2532.json"), "utf8"));
  const points = summary.selectImportantPositions(analysis);
  const learning = summary.extractLearningItems(analysis, points);
  assert.equal(learning.length, 3);
  assert.ok(learning.some((item) => item.ply === 28));
  const move28 = learning.find((item) => item.ply === 28);
  assert.equal(move28.actualMoveJa, "△4四銀");
  assert.equal(move28.bestMoveJa, "△6八角成");
  assert.equal(move28.scoreChange.text, "+706 → +241");
});

test("summary監査JSONは選択局面とscore changeだけを最大10局蓄積できる形にする", () => {
  const audit = summary.buildSummaryAudit("game-a", [important(28, "最初の分岐")], "2026-09-11T00:00:00Z");
  assert.equal(audit.schemaVersion, 1);
  assert.equal(audit.gameId, "game-a");
  assert.deepEqual(audit.selected[0].category, ["最初の分岐"]);
  assert.deepEqual(audit.selected[0].scoreChange.before, { type: "cp", value: 100 });
  const ui = fs.readFileSync(path.join(ROOT, "game-summary.js"), "utf8");
  assert.match(ui, /records\.slice\(0, 10\)/);
  assert.match(ui, /shogi-review-summary-audit-v1/);
});

test("次局への学びUIは局面ジャンプを再利用し棋風・心理を表示しない", () => {
  const ui = fs.readFileSync(path.join(ROOT, "game-summary.js"), "utf8");
  assert.match(ui, /次局への学び/);
  assert.match(ui, /jumpToSummaryPosition\(item\.ply\)/);
  for (const unsupported of ["苦手", "棋風", "心理", "大局観", "手厚い", "玉形"]) assert.equal(ui.includes(unsupported), false);
});
