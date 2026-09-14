const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const layer = require(path.join(ROOT, "reason-evidence-layer.js"));

function fixture(gameId, ply) {
  const game = JSON.parse(fs.readFileSync(path.join(ROOT, "games", `${gameId}.json`), "utf8"));
  const analysis = JSON.parse(fs.readFileSync(path.join(ROOT, "analysis", `${gameId}.json`), "utf8"));
  const issue = analysis.verifiedIssues.find((item) => Number(item.ply) === Number(ply));
  assert.ok(issue, `${gameId}/${ply}`);
  return {
    sfen: game.positions[ply - 1].sfen,
    actualMove: issue.played,
    bestMove: issue.best,
    actualPV: issue.actualPv || [],
    recommendedPV: issue.pv || [],
  };
}

function production(gameId, ply) {
  return layer.extractEvidence(fixture(gameId, ply)).production_reason;
}

test("Human Review済みrecommended 4件だけをQ2 productionへ採用する", () => {
  const ariake58 = production("20260910_ariake", 58);
  assert.equal(ariake58.status, "PRODUCTION_READY");
  assert.deepEqual(ariake58.accepted_types, [layer.PRODUCTION_ALLOWLIST.Q2_RECOMMENDED_CHECK_SEQUENCE_WITH_CAPTURE]);
  assert.match(ariake58.blocks[0].text, /1・3・5ply目に王手が続き.*金を取ります/);

  for (const [gameId, ply, expectedPly] of [
    ["20260910_ariake", 86, 3],
    ["20260910_ariake", 94, 5],
    ["20260910_taatoru_cat", 105, 1],
  ]) {
    const result = production(gameId, ply);
    assert.equal(result.status, "PRODUCTION_READY", `${gameId}/${ply}`);
    assert.deepEqual(result.accepted_types, [layer.PRODUCTION_ALLOWLIST.Q2_RECOMMENDED_MATE_ENDPOINT]);
    assert.match(result.blocks[0].text, new RegExp(`${expectedPly}ply目.*王手で、合法な応手がありません`));
  }
});

test("重点2件はactual mateのQ1だけを採用し反対側をEvidenceで埋めない", () => {
  for (const [gameId, ply, expectedPly] of [
    ["20260912_しゅえい", 159, 8],
    ["20260911_ryunenbb", 80, 6],
  ]) {
    const result = production(gameId, ply);
    assert.equal(result.status, "PRODUCTION_READY", `${gameId}/${ply}`);
    assert.equal(result.q1, "○");
    assert.equal(result.q2, "×");
    assert.deepEqual(result.blocks.map((block) => block.key), ["problem", "scope"]);
    assert.match(result.blocks[0].text, new RegExp(`${expectedPly}ply目.*合法な応手がありません`));
    const fallback = [
      { key: "why", text: "old problem" },
      { key: "recommended", text: "old recommended" },
    ];
    const merged = layer.mergeProductionBlocks(fallback, result);
    assert.notEqual(merged[0].text, "old problem");
    assert.match(merged[1].text, /これ以上の理由は断定できません/);
  }
});

test("Supporting/単なる王手/Q1 unresolved/UNSAFE回帰はproductionへ昇格しない", () => {
  for (const [gameId, ply] of [
    ["20260911_おまつ", 98],
    ["20260910_ひぐれ", 42],
    ["20260910_yogra", 56],
    ["20260912_しゅえい", 77],
    ["20260912_しゅえい", 79],
  ]) {
    const result = production(gameId, ply);
    assert.equal(result.status, "FALLBACK", `${gameId}/${ply}`);
    assert.equal(result.reason, "SUPPORTING_ONLY", `${gameId}/${ply}`);
    assert.deepEqual(result.blocks.map((block) => block.key), ["scope"]);
    assert.match(result.blocks[0].text, /これ以上の理由は断定できません/);
  }
});

test("validator failureとINVALIDは非表示でfallbackを変更しない", () => {
  const input = fixture("20260910_ariake", 86);
  const bundle = layer.extractEvidence(input);
  bundle.evidence.find((item) => item.type === "MATE_ENDPOINT").validation = { valid: false, errors: ["MATE_ENDPOINT"] };
  const failed = layer.productionReason(bundle);
  assert.deepEqual([failed.status, failed.safe, failed.reason, failed.blocks.length], ["FALLBACK", false, "VALIDATOR_FAILURE", 1]);
  const invalid = layer.extractEvidence({
    sfen: "4k4/9/9/9/9/9/9/9/4K4 b - 1",
    actualMove: "7g7f", bestMove: "5i6i", actualPV: ["7g7f"], recommendedPV: ["5i6i"],
  }).production_reason;
  assert.deepEqual([invalid.status, invalid.safe, invalid.reason], ["FALLBACK", false, "INVALID"]);
  const fallback = [{ key: "problem", text: "fallback" }];
  assert.deepEqual(layer.mergeProductionBlocks(fallback, failed), failed.blocks);
});

test("両枝のHuman Review済みEvidenceを優先して短いbranch contrastを作る", () => {
  const source = fixture("20260911_ryunenbb", 80);
  source.actualPV = "6b5b 5e6f N*7e 6f7e 9c9b G*8b".split(" ");
  source.recommendedPV = "N*7e 7a8b 9c8d 7f7e 1i8i 7h8i N*7g 5e7g L*8h 8i8h 8a9c N*7f 8d7e G*8f 7e7d R*7e".split(" ");
  const result = layer.extractEvidence(source).production_reason;
  assert.equal(result.status, "PRODUCTION_READY");
  assert.deepEqual(result.blocks.map((block) => block.key), ["problem", "recommended", "conclusion"]);
  assert.match(result.blocks[2].text, /実戦枝は6ply目、推奨枝は16ply目/);
});

test("capture/promotion/drop/同一事実はPRIMARY gateを越えず安全にfallbackする", () => {
  const capture = layer.extractEvidence({
    sfen: "4k4/4g4/9/9/9/4R4/9/9/4K4 b - 1",
    actualMove: "5f5b", bestMove: "5f5b", actualPV: ["5f5b"], recommendedPV: ["5f5b"],
  });
  assert.equal(capture.production_reason.reason, "SUPPORTING_ONLY");
  assert.ok(capture.evidence.every((item) => item.branch === "shared"));

  const promotion = layer.extractEvidence({
    sfen: "4k4/9/9/4P4/9/9/9/9/4K4 b - 1",
    actualMove: "5d5c+", bestMove: "5d5c", actualPV: ["5d5c+"], recommendedPV: ["5d5c"],
  });
  assert.equal(promotion.production_reason.reason, "SUPPORTING_ONLY");
  const promoted = promotion.evidence.find((item) => item.type === "PROMOTION");
  assert.equal(layer.jaMove(promoted), "▲5三歩成");

  const drop = layer.extractEvidence({
    sfen: "4k4/9/9/9/9/9/9/9/4K4 b G 1",
    actualMove: "G*4b", bestMove: "G*6b", actualPV: ["G*4b"], recommendedPV: ["G*6b"],
  });
  assert.equal(drop.production_reason.reason, "SUPPORTING_ONLY");
  assert.equal(layer.jaMove(drop.evidence.find((item) => item.type === "DROP" && item.branch === "recommended")), "▲6二金打");
});

test("日本語表記は手番・同・成・打を検証済みeventから組み立てる", () => {
  const bundle = layer.extractEvidence({
    sfen: "4k4/4g4/9/9/9/4R4/9/9/4K4 b - 1",
    actualMove: "5f5b", bestMove: "5f5b", actualPV: ["5f5b", "5a5b"], recommendedPV: ["5f5b", "5a5b"],
  });
  const recapture = bundle.evidence.find((item) => item.type === "IMMEDIATE_RECAPTURE");
  assert.equal(layer.jaMove(recapture), "△同玉");
});

test("Issue #29 Human Replay 3ケースは根拠不足を明示して推測しない", () => {
  for (const [gameId, ply] of [
    ["20260914_aleph009", 29],
    ["20260914_issue24-e2e", 46],
    ["20260914_aiaipapa", 35],
  ]) {
    const result = production(gameId, ply);
    assert.deepEqual([result.status, result.safe, result.reason], ["FALLBACK", true, "SUPPORTING_ONLY"]);
    assert.match(result.blocks[0].text, /これ以上の理由は断定できません/);
  }
});

test("production gateはpure/deterministicで禁止解釈を生成しない", () => {
  const source = fixture("20260910_ariake", 86);
  const before = JSON.stringify(source);
  const first = layer.extractEvidence(source).production_reason;
  const second = layer.extractEvidence(source).production_reason;
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(source), before);
  const all = [
    production("20260910_ariake", 58), production("20260910_ariake", 86),
    production("20260910_ariake", 94), production("20260910_taatoru_cat", 105),
    production("20260912_しゅえい", 159), production("20260911_ryunenbb", 80),
  ].flatMap((result) => result.blocks).map((block) => block.text).join(" ");
  assert.doesNotMatch(all, /唯一|強制|駒得|粘|攻め|受け|玉.{0,3}安全|詰み.{0,3}回避|優れて|有利/);
});
