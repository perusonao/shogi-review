const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const reason = require(path.join(ROOT, "reason-evidence.js"));

function issueInput(gameId, ply) {
  const game = JSON.parse(fs.readFileSync(path.join(ROOT, "games", `${gameId}.json`), "utf8"));
  const analysis = JSON.parse(fs.readFileSync(path.join(ROOT, "analysis", `${gameId}.json`), "utf8"));
  const item = analysis.verifiedIssues.find((candidate) => candidate.ply === ply);
  return {
    sfen: game.positions[ply - 1].sfen,
    actualMove: item.played,
    bestMove: item.best,
    actualScore: item.scoreAfterActual,
    recommendedScore: item.bestScore || item.scoreBefore,
    actualPV: item.actualPv,
    recommendedPV: item.pv,
    actualPVJa: item.actualPvJa,
    recommendedPVJa: item.pvJa,
    actualMoveJa: item.playedJa,
    bestMoveJa: item.bestJa,
  };
}

test("純粋関数は入力を書き換えず同じReason evidenceを返す", () => {
  const input = issueInput("20260911_ryunenbb", 80);
  const snapshot = JSON.stringify(input);
  assert.deepEqual(reason.generateReasonEvidence(input), reason.generateReasonEvidence(input));
  assert.equal(JSON.stringify(input), snapshot);
});

test("ryunenbb 80手目は王手2・4・6手目、mate差、桂打ちを検証する", () => {
  const result = reason.generateReasonEvidence(issueInput("20260911_ryunenbb", 80));
  assert.equal(result.level, 1);
  assert.ok(result.types.includes("mate"));
  assert.ok(result.types.includes("check"));
  assert.ok(result.types.includes("capture"));
  assert.ok(result.types.includes("drop"));
  assert.deepEqual(result.branches.actual.events.filter((event) => event.side === "b" && event.check).map((event) => event.pvPly), [2, 4, 6]);
  assert.equal(result.branches.recommended.events[0].check, false);
  assert.match(result.blocks[0].text, /△5二金.*相手の王手が続き.*▲8二龍まで詰み評価/);
  assert.match(result.blocks[1].text, /△7五桂打.*実戦枝と同じ詰み評価にはなっていません/);
  for (const forbidden of ["王手を続け", "金を動かしたから", "唯一", "玉が薄い"]) {
    assert.equal(result.blocks.some((block) => block.text.includes(forbidden)), false);
  }
});

test("capture・promotion・drop・checkを盤面適用後の事実として抽出する", () => {
  const capture = reason.replayBranch("4k4/9/9/9/4p4/4P4/9/9/4K4 b - 1", ["5f5e"]);
  assert.equal(capture.events[0].capture, "P");
  const promotion = reason.replayBranch("4k4/9/9/9/9/9/4P4/9/4K4 b - 1", ["5g5f+"]);
  assert.equal(promotion.events[0].promotion, true);
  const drop = reason.replayBranch("4k4/9/9/9/9/9/9/9/4K4 b P 1", ["P*5b"]);
  assert.equal(drop.events[0].drop, true);
  assert.equal(drop.events[0].check, true);
});

test("駒カードは通常・打ち・成る・成らずを構造化する", () => {
  const normal = reason.moveCard({ sfen: "4k4/9/9/9/9/4G4/9/9/4K4 b - 1", move: "5f5e", notation: "▲5五金" });
  assert.deepEqual([normal.pieceJa, normal.action], ["金", "5五へ"]);
  const drop = reason.moveCard({ sfen: "4k4/9/9/9/9/9/9/9/4K4 b N 1", move: "N*7e", notation: "▲7五桂打" });
  assert.deepEqual([drop.pieceJa, drop.action, drop.isDrop], ["桂", "7五へ打つ", true]);
  const promote = reason.moveCard({ sfen: "4k4/9/9/9/9/9/4B4/9/4K4 b - 1", move: "5g4b+", notation: "▲4二角成" });
  assert.equal(promote.action, "4二へ・成る");
  const decline = reason.moveCard({ sfen: "4k4/9/9/9/9/9/4B4/9/4K4 b - 1", move: "5g4b", notation: "▲4二角不成" });
  assert.equal(decline.action, "4二へ・成らず");
});

test("fallback Level 1/2/3を根拠量で分ける", () => {
  const level1 = reason.generateReasonEvidence(issueInput("20260911_ryunenbb", 80));
  assert.equal(level1.level, 1);
  const level2 = reason.generateReasonEvidence({ sfen: "4k4/9/9/9/9/9/9/9/4K4 b N 1", actualMove: "K*5h", bestMove: "N*7e", recommendedPV: ["N*7e"] });
  assert.equal(level2.level, 2);
  const level3 = reason.generateReasonEvidence({ sfen: "4k4/9/9/9/9/9/9/4G4/4K4 b - 1", actualMove: "5h6h", bestMove: "5h4h" });
  assert.equal(level3.level, 3);
  assert.match(level3.blocks[0].text, /原因を一つに特定できません/);
});

test("semantic color、文字識別、初期折りたたみ、次課題統合を保持する", () => {
  const ui = fs.readFileSync(path.join(ROOT, "review-enhanced.js"), "utf8");
  const summary = fs.readFileSync(path.join(ROOT, "game-summary.js"), "utf8");
  assert.match(ui, /--actual-board:#A11222/);
  assert.match(ui, /--recommended-board:#0047AB/);
  assert.match(ui, /--actual-card:#FF6B5A/);
  assert.match(ui, /--recommended-card:#5DA9FF/);
  assert.match(ui, /target\(actual, actualColor, "実"\)/);
  assert.match(ui, /target\(recommended, recommendedColor, "推"\)/);
  assert.match(ui, /nextIssueCompact/);
  assert.match(summary, /let summaryExpanded = false/);
  assert.match(summary, /let learningExpanded = false/);
});

test("旧JSON・先手ユーザー・後手ユーザーでもReasonを生成する", () => {
  for (const gameId of ["20260910_ひぐれ", "20260910_ariake", "20260911_ryunenbb"]) {
    const game = JSON.parse(fs.readFileSync(path.join(ROOT, "games", `${gameId}.json`), "utf8"));
    const analysis = JSON.parse(fs.readFileSync(path.join(ROOT, "analysis", `${gameId}.json`), "utf8"));
    const item = analysis.verifiedIssues[0];
    const result = reason.generateReasonEvidence({
      sfen: game.positions[item.ply - 1].sfen, actualMove: item.played, bestMove: item.best,
      actualScore: item.scoreAfterActual, recommendedScore: item.bestScore || item.scoreBefore,
      actualPV: item.actualPv, recommendedPV: item.pv, actualPVJa: item.actualPvJa, recommendedPVJa: item.pvJa,
      actualMoveJa: item.playedJa, bestMoveJa: item.bestJa,
    });
    assert.ok([1, 2, 3].includes(result.level));
    assert.ok(result.blocks.length >= 1);
    assert.ok(["先手", "後手"].some((side) => String(game.game.side).includes(side)));
  }
});
