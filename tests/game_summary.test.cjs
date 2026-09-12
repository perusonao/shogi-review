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

test("NAGATA2532は34手目を代表にして28/36手目を補助として保持する", () => {
  const analysis = JSON.parse(fs.readFileSync(path.join(ROOT, "analysis", "20260911_nagata2532.json"), "utf8"));
  const result = summary.selectImportantPositions(analysis);
  const representative = result.find((item) => item.ply === 34);
  assert.ok(representative);
  assert.deepEqual(representative.auxiliaryEvents.map((item) => item.ply), [28, 36]);
  const move28 = representative.auxiliaryEvents.find((item) => item.ply === 28);
  assert.deepEqual(move28.category, ["最初の分岐"]);
  assert.deepEqual(move28.scoreBefore, { type: "cp", value: 706 });
  assert.deepEqual(move28.scoreAfter, { type: "cp", value: 241 });
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
  const material = { issue: { played: "7g7f", best: "2g2f", pv: ["2g2f"] } };
  const source = [
    important(10, "その他", material),
    important(10, "逆転局面", material),
    important(20, "最初の分岐", material),
    important(30, "最大の課題", { ...material, loss: 900 }),
    important(40, "勝負を決めた局面", material),
  ];
  const result = summary.extractLearningItems({ gameId: "sample" }, source);
  assert.equal(result.length, 3);
  assert.equal(new Set(result.map((item) => item.ply)).size, 3);
});

test("mate、最大損失、最初の悪化の順で学びを優先する", () => {
  const material = { issue: { played: "7g7f", best: "2g2f", pv: ["2g2f"] } };
  const source = [
    important(12, "最初の分岐", { ...material, loss: 400 }),
    important(30, "最大の課題", { ...material, loss: 1200 }),
    important(50, "勝負を決めた局面", { ...material, scoreAfter: { type: "mate", value: -5 } }),
    important(40, "逆転局面", material),
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

test("NAGATA2532の学びは代表34だけで57手目を選ばない", () => {
  const analysis = JSON.parse(fs.readFileSync(path.join(ROOT, "analysis", "20260911_nagata2532.json"), "utf8"));
  const points = summary.selectImportantPositions(analysis);
  const learning = summary.extractLearningItems(analysis, points);
  assert.deepEqual(learning.map((item) => item.ply), [34]);
  assert.equal(learning.some((item) => item.ply === 57), false);
  assert.equal(learning[0].actualMoveJa, "△5四飛成");
  assert.equal(learning[0].bestMoveJa, "△6八角成");
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
  assert.match(ui, /jumpToSummaryPosition\(event\.ply\)/);
  assert.match(ui, /auxiliaryJump/);
  for (const unsupported of ["苦手", "棋風", "心理", "大局観", "手厚い", "玉形"]) assert.equal(ui.includes(unsupported), false);
});

function loadAnalysis(gameId) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "analysis", `${gameId}.json`), "utf8"));
}

function selected(gameId) {
  const analysis = loadAnalysis(gameId);
  const importantPositions = summary.selectImportantPositions(analysis);
  return { analysis, importantPositions, learning: summary.extractLearningItems(analysis, importantPositions) };
}

test("Human Review優先5局fixtureを固定する", () => {
  const nagata = selected("20260911_nagata2532");
  assert.deepEqual(nagata.importantPositions.find((item) => item.ply === 34).auxiliaryEvents.map((item) => item.ply), [28, 36]);
  assert.deepEqual(nagata.learning.map((item) => item.ply), [34]);

  const ariake = selected("20260910_ariake");
  assert.ok(ariake.importantPositions.some((item) => item.ply === 86));
  assert.ok(ariake.importantPositions.some((item) => item.ply === 94));
  assert.ok(ariake.learning.some((item) => item.ply === 86));
  assert.ok(ariake.learning.some((item) => item.ply === 94));
  assert.equal(ariake.learning.some((item) => item.ply === 71), false);

  const shun = selected("20260911_しゅん");
  assert.deepEqual(shun.importantPositions.find((item) => item.ply === 71).auxiliaryEvents.map((item) => item.ply), [68, 70]);

  const junya = selected("20260911_じゅんや");
  assert.deepEqual(junya.importantPositions.find((item) => item.ply === 44).auxiliaryEvents.map((item) => item.ply), [43]);

  const omatsu = selected("20260911_おまつ");
  assert.ok(omatsu.importantPositions.some((item) => item.ply === 126));
  assert.ok(omatsu.importantPositions.some((item) => item.ply === 135));
  assert.ok(omatsu.learning.some((item) => item.ply === 126));
  assert.equal(omatsu.learning.some((item) => item.ply === 135), false);
});

test("same bestMoveとPV prefixが一致する近接候補をcluster化する", () => {
  const candidates = [
    important(10, "最初の分岐", { loss: 400, issue: { played: "7g7f", best: "2g2f", pv: ["2g2f", "8c8d"] } }),
    important(16, "最大の課題", { loss: 900, issue: { played: "6g6f", best: "2g2f", pv: ["2g2f", "8c8d", "2f2e"] } }),
  ];
  const clustered = summary.clusterImportantPositions(candidates);
  assert.equal(clustered.length, 1);
  assert.equal(clustered[0].ply, 16);
  assert.deepEqual(clustered[0].auxiliaryEvents.map((item) => item.ply), [10]);
});

test("same bestMoveでもPV prefixが異なる候補は独立させる", () => {
  const candidates = [
    important(10, "最初の分岐", { loss: 400, issue: { played: "7g7f", best: "2g2f", pv: ["2g2f", "8c8d"] } }),
    important(16, "最大の課題", { loss: 900, issue: { played: "6g6f", best: "2g2f", pv: ["2g2f", "3c3d"] } }),
  ];
  assert.equal(summary.clusterImportantPositions(candidates).length, 2);
});

test("different PVと異なるbestMoveのmateイベントは独立issueにする", () => {
  const candidates = [
    important(86, "最初のmate変化", { scoreBefore: { type: "cp", value: 29999 }, scoreAfter: { type: "cp", value: 4000 }, loss: 25000, issue: { played: "B*3a", best: "B*2b", pv: ["B*2b", "1c2c"] } }),
    important(87, "最大の課題", { scoreBefore: { type: "cp", value: 4000 }, scoreAfter: { type: "cp", value: 29999 }, loss: 25500, issue: { played: "P*1b", best: "2b2c", pv: ["2b2c", "L*2b"] } }),
  ];
  assert.equal(summary.clusterImportantPositions(candidates).length, 2);
});

test("比較材料のない評価境界局面はlearningから外す", () => {
  const boundaryOnly = important(135, "勝負を決めた局面", {
    scoreBefore: { type: "cp", value: -720 }, scoreAfter: { type: "cp", value: 29995 }, issue: null,
  });
  assert.equal(summary.hasLearningMaterial(boundaryOnly), false);
  assert.deepEqual(summary.extractLearningItems({ gameId: "sample" }, [boundaryOnly]), []);
});

test("全16局で最大loss 16/16とmate保有局 9/9を保護する", () => {
  const auditedGameIds = [
    "20260911_ak69boy", "20260911_nagata2532", "20260911_おまつ", "20260911_じゅんや",
    "20260911_ダルマ", "20260911_しゅん", "20260911_ぴろ", "20260911_大山_貴一郎",
    "20260910_ぽっぷ", "20260910_ぱいなぽー", "20260910_ひぐれ", "20260910_ariake",
    "20260910_taatoru_cat", "20260910_yogra", "20260910_aochikenmin", "akane_20260910",
  ];
  const files = auditedGameIds.map((gameId) => `${gameId}.json`);
  let maxLossCaptured = 0;
  let mateGames = 0;
  let mateCaptured = 0;
  for (const file of files) {
    const analysis = JSON.parse(fs.readFileSync(path.join(ROOT, "analysis", file), "utf8"));
    const items = summary.selectImportantPositions(analysis);
    const issues = analysis.verifiedIssues || [];
    const maxIssue = issues.reduce((best, candidate) => Number(candidate.lossCp || candidate.loss || 0) > Number(best?.lossCp || best?.loss || -1) ? candidate : best, null);
    if (maxIssue && items.some((item) => item.ply === Number(maxIssue.ply))) maxLossCaptured += 1;
    const mateIssuePlies = issues.filter((candidate) => {
      const values = [candidate.beforeCp, candidate.afterCp, candidate.scoreBefore?.value, candidate.scoreAfterActual?.value];
      return candidate.scoreBefore?.type === "mate" || candidate.scoreAfterActual?.type === "mate" || values.some((value) => Number.isFinite(Number(value)) && Math.abs(Number(value)) >= 25000);
    }).map((candidate) => Number(candidate.ply));
    if (mateIssuePlies.length) {
      mateGames += 1;
      if (items.some((item) => mateIssuePlies.includes(item.ply))) mateCaptured += 1;
    }
  }
  assert.equal(files.length, 16);
  assert.equal(maxLossCaptured, 16);
  assert.equal(mateGames, 9);
  assert.equal(mateCaptured, 9);
});

test("最新mainの現行24局でも最大lossとmateを全件保護する", () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "games", "index.json"), "utf8"));
  const gameIds = catalog.games.filter((game) => game.analyzed).map((game) => game.id);
  let maxLossCaptured = 0;
  let mateGames = 0;
  let mateCaptured = 0;
  for (const gameId of gameIds) {
    const analysis = loadAnalysis(gameId);
    const items = summary.selectImportantPositions(analysis);
    const issues = analysis.verifiedIssues || [];
    const maxIssue = issues.reduce((best, candidate) => Number(candidate.lossCp || candidate.loss || 0) > Number(best?.lossCp || best?.loss || -1) ? candidate : best, null);
    if (maxIssue && items.some((item) => item.ply === Number(maxIssue.ply))) maxLossCaptured += 1;
    const mateIssuePlies = issues.filter((candidate) => {
      const values = [candidate.beforeCp, candidate.afterCp, candidate.scoreBefore?.value, candidate.scoreAfterActual?.value];
      return candidate.scoreBefore?.type === "mate" || candidate.scoreAfterActual?.type === "mate" || values.some((value) => Number.isFinite(Number(value)) && Math.abs(Number(value)) >= 25000);
    }).map((candidate) => Number(candidate.ply));
    if (mateIssuePlies.length) {
      mateGames += 1;
      if (items.some((item) => mateIssuePlies.includes(item.ply))) mateCaptured += 1;
    }
  }
  assert.equal(gameIds.length, 24);
  assert.equal(maxLossCaptured, 24);
  assert.equal(mateGames, 16);
  assert.equal(mateCaptured, 16);
});
