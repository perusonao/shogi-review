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
  const promotion = reason.replayBranch("4k4/9/9/4P4/9/9/9/9/4K4 b - 1", ["5d5c+"]);
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
  assert.match(ui, /target\(actual, actualColor, actualPiece\)/);
  assert.match(ui, /target\(recommended, recommendedColor, recommendedPiece\)/);
  assert.doesNotMatch(ui, /choicePieceSvg/);
  assert.match(ui, /赤＝実戦手の駒/);
  assert.match(ui, /青＝推奨手の駒/);
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.match(html, /fill-opacity="\.9"/);
  assert.doesNotMatch(html, /a\.drop\?`<text/);
  assert.match(ui, /nextIssueCompact/);
  assert.match(summary, /let summaryExpanded = false/);
  assert.match(summary, /let learningExpanded = false/);
});

test("Branch Differenceはactual/recommended branchを適用してevent単位で整列する", () => {
  const input = {
    sfen: "4k4/9/9/9/4p4/4P4/9/4R4/4K4 b N 1",
    actualMove: "5f5e", bestMove: "N*4c",
    actualPV: ["5f5e", "5a4a"], recommendedPV: ["N*4c", "5a4a"],
  };
  const snapshot = JSON.stringify(input);
  const result = reason.analyzeBranchDifference(input);
  assert.equal(JSON.stringify(input), snapshot);
  assert.equal(result.branches.actual.complete, true);
  assert.equal(result.branches.recommended.complete, true);
  assert.ok(result.actualOnly.some((event) => event.type === "capture" && event.piece === "P"));
  assert.ok(result.recommendedOnly.some((event) => event.type === "drop" && event.piece === "N"));
});

test("major piece loss・confidence・同一駒capture timingを検出する", () => {
  const result = reason.analyzeBranchDifference({
    sfen: "4k4/9/9/9/5r3/5R3/9/9/4K4 b - 1",
    actualMove: "4f4g", bestMove: "4f4e",
    actualPV: ["4f4g", "4e4g"], recommendedPV: ["4f4e", "5a6a"],
  });
  const loss = result.actualOnly.find((event) => event.type === "major-piece-loss");
  assert.equal(loss.piece, "R");
  assert.equal(loss.confidence, "HIGH");
  assert.equal(result.captureTimingByPiece[loss.capturedPieceId].actual, 2);
  assert.equal(result.captureTimingByPiece[loss.capturedPieceId].recommended, null);
  assert.match(result.candidate.blocks[0].text, /2手目に飛を取られます/);
});

test("mate differenceを最優先HIGH evidenceとしてcandidate化する", () => {
  const result = reason.analyzeBranchDifference(issueInput("20260911_ryunenbb", 80));
  assert.equal(result.prioritized[0].type, "mate");
  assert.equal(result.prioritized[0].branch, "actual");
  assert.equal(result.prioritized[0].confidence, "HIGH");
  assert.match(result.candidate.blocks[0].text, /△5二金の読み筋では詰み評価/);
  assert.match(result.candidate.blocks[1].text, /△7五桂打の読み筋では、同じ詰み評価にはなっていません/);
  assert.equal(result.candidate.unresolved, true);
  assert.equal(result.candidate.next, null);
});

test("check/captureはMEDIUM以下、promotion/drop単独はLOW", () => {
  const result = reason.analyzeBranchDifference({
    sfen: "4k4/9/9/4B4/4p4/4P4/9/9/4K4 b N 1",
    actualMove: "5f5e", bestMove: "5d4c+",
    actualPV: ["5f5e"], recommendedPV: ["5d4c+"],
  });
  assert.equal(result.actualOnly.find((event) => event.type === "capture").confidence, "MEDIUM");
  assert.equal(result.recommendedOnly.find((event) => event.type === "promotion").confidence, "LOW");
  const dropOnly = reason.analyzeBranchDifference({ sfen: "4k4/9/9/9/9/9/9/9/4K4 b N 1", actualMove: "N*4e", bestMove: "N*6e" });
  assert.ok(dropOnly.actualOnly.every((event) => event.confidence === "LOW"));
  assert.equal(dropOnly.candidate.blocks.length, 0);
});

test("shared eventはply位置ではなく意味で揃える", () => {
  const aligned = reason.alignEvents(
    [{ type: "check", actor: "mover", pvPly: 1, confidence: "MEDIUM" }],
    [{ type: "drop", actor: "mover", piece: "P", pvPly: 1, confidence: "LOW" }, { type: "check", actor: "mover", pvPly: 2, confidence: "MEDIUM" }],
  );
  assert.equal(aligned.shared.length, 1);
  assert.equal(aligned.shared[0].actual.pvPly, 1);
  assert.equal(aligned.shared[0].recommended.pvPly, 2);
  assert.equal(aligned.recommendedOnly[0].type, "drop");
});

test("material differenceとlegal continuation、短いPV、PVなしを扱う", () => {
  const material = reason.analyzeBranchDifference({
    sfen: "4k4/9/9/9/4s4/4P4/9/9/4K4 b - 1",
    actualMove: "5i4i", bestMove: "5f5e",
    actualPV: ["5i4i"], recommendedPV: ["5f5e"],
  });
  assert.ok(material.actualOnly.some((event) => event.type === "material-swing"));
  const illegal = reason.analyzeBranchDifference({ sfen: "4k4/9/9/9/9/9/9/9/4K4 b - 1", actualMove: "P*5e", bestMove: "5i4i" });
  assert.equal(illegal.branches.actual.legalContinuation, false);
  assert.equal(illegal.actualOnly[0].type, "illegal-continuation");
  const empty = reason.analyzeBranchDifference({ sfen: "4k4/9/9/9/9/9/9/9/4K4 b - 1" });
  assert.deepEqual([empty.actualOnly.length, empty.shared.length, empty.recommendedOnly.length], [0, 0, 0]);
});

test("しゅえい77/79/159 fixturesは三分類を出力する", () => {
  for (const ply of [77, 79, 159]) {
    const result = reason.analyzeBranchDifference(issueInput("20260912_しゅえい", ply));
    assert.ok(Array.isArray(result.actualOnly));
    assert.ok(Array.isArray(result.shared));
    assert.ok(Array.isArray(result.recommendedOnly));
    assert.equal(result.branches.actual.events[0].moveUsi, issueInput("20260912_しゅえい", ply).actualMove);
    assert.equal(result.branches.recommended.events[0].moveUsi, issueInput("20260912_しゅえい", ply).bestMove);
  }
  const seventyNine = reason.analyzeBranchDifference(issueInput("20260912_しゅえい", 79));
  assert.ok(seventyNine.actualOnly.some((event) => event.type === "drop"));
  assert.ok(seventyNine.recommendedOnly.some((event) => event.type === "capture" && event.piece === "B"));
});

test("手数表示は指す直前を廃止し、局面の手数だけを示す", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.doesNotMatch(html, /指す直前：/);
  assert.match(html, /last\.textContent=issue\?`\$\{issue\.ply\}手目`/);
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
