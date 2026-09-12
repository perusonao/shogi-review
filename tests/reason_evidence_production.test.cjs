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
    assert.deepEqual(result.blocks.map((block) => block.key), ["problem"]);
    assert.match(result.blocks[0].text, new RegExp(`${expectedPly}ply目.*合法な応手がありません`));
    const fallback = [
      { key: "why", text: "old problem" },
      { key: "recommended", text: "old recommended" },
    ];
    const merged = layer.mergeProductionBlocks(fallback, result);
    assert.notEqual(merged[0].text, "old problem");
    assert.equal(merged[1].text, "old recommended");
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
    assert.deepEqual(result.blocks, []);
  }
});

test("validator failureとINVALIDは非表示でfallbackを変更しない", () => {
  const input = fixture("20260910_ariake", 86);
  const bundle = layer.extractEvidence(input);
  bundle.evidence.find((item) => item.type === "MATE_ENDPOINT").validation = { valid: false, errors: ["MATE_ENDPOINT"] };
  const failed = layer.productionReason(bundle);
  assert.deepEqual([failed.status, failed.safe, failed.reason, failed.blocks.length], ["FALLBACK", false, "VALIDATOR_FAILURE", 0]);
  const invalid = layer.extractEvidence({
    sfen: "4k4/9/9/9/9/9/9/9/4K4 b - 1",
    actualMove: "7g7f", bestMove: "5i6i", actualPV: ["7g7f"], recommendedPV: ["5i6i"],
  }).production_reason;
  assert.deepEqual([invalid.status, invalid.safe, invalid.reason], ["FALLBACK", false, "INVALID"]);
  const fallback = [{ key: "problem", text: "fallback" }];
  assert.deepEqual(layer.mergeProductionBlocks(fallback, failed), fallback);
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
