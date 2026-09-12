const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const layer = require(path.join(ROOT, "reason-evidence-layer.js"));

function productionInput(gameId, ply) {
  const game = JSON.parse(fs.readFileSync(path.join(ROOT, "games", `${gameId}.json`), "utf8"));
  const analysis = JSON.parse(fs.readFileSync(path.join(ROOT, "analysis", `${gameId}.json`), "utf8"));
  const issue = analysis.verifiedIssues.find((item) => Number(item.ply) === Number(ply));
  return {
    sfen: game.positions[ply - 1].sfen,
    actualMove: issue.played,
    bestMove: issue.best,
    actualPV: issue.actualPv || [],
    recommendedPV: issue.pv || [],
  };
}

const FIXTURE_PVS = {
  "20260911_ryunenbb/80": {
    actualPV: "6b5b 5e6f N*7e 6f7e 9c9b G*8b".split(" "),
    recommendedPV: "N*7e 7a8b 9c8d 7f7e 1i8i 7h8i N*7g 5e7g L*8h 8i8h 8a9c N*7f 8d7e G*8f 7e7d R*7e".split(" "),
  },
  "20260912_しゅえい/77": {
    actualPV: "P*5i 6h7g 7e6f 7g6f 6g6f B*5e B*3g 5e3g+ 2i3g B*5e S*7c 6b7c P*8c".split(" "),
    recommendedPV: "P*8c 8b8c P*8e 8c9b 8e8d P*8b 7g8e 2e2f 2g2f P*2g 2h2g L*2c 8d8c+ 9b8c S*8d 8c7b 7d7c+ 8a7c 8e7c+ 6b7c 8d7c 7b7c N*8e 7c6b".split(" "),
  },
  "20260912_しゅえい/79": {
    actualPV: "6e5f N*4d P*8c 8b8c R*3a 9i9f 3a3c+ 9f5f S*6f 4d3f 3c3f 5f3f 6f7g P*3g 2i3g".split(" "),
    recommendedPV: "7e6f 7g6f 6g6f".split(" "),
  },
  "20260912_しゅえい/159": {
    actualPV: "3d4c N*2c 3e3d R*3e 3d2c L*2a G*2b G*1c".split(" "),
    recommendedPV: "G*7b 8b7b B*6a 7b6a P*6b 6a7b 2g2f 4c3d 3e3f B*1h 1i1h L*3e 3f2g 2e2f 2g2f".split(" "),
  },
};

function longestExistingInput(gameId, ply) {
  const input = productionInput(gameId, ply);
  return { ...input, ...(FIXTURE_PVS[`${gameId}/${ply}`] || {}) };
}

test("legal SFEN と illegal SFEN を区別する", () => {
  assert.equal(layer.parseSfen("4k4/9/9/9/9/9/9/9/4K4 b - 1").valid, true);
  assert.equal(layer.parseSfen("9/9/9/9/9/9/9/9/4K4 b - 1").valid, false);
  assert.equal(layer.parseSfen("4k4/9/9/9/9/9/9/9/10K b - 1").valid, false);
});

test("legal PV と broken PV を VALID / PARTIAL に分ける", () => {
  const sfen = "4k4/9/9/9/9/9/9/9/4K4 b - 1";
  const valid = layer.extractEvidence({ sfen, actualMove: "5i4i", bestMove: "5i6i", actualPV: ["5i4i"], recommendedPV: ["5i6i"] });
  assert.equal(valid.status, "VALID");
  const broken = layer.extractEvidence({ sfen, actualMove: "5i4i", bestMove: "5i6i", actualPV: ["5i4i", "5a5b", "4i4h", "5a5b"], recommendedPV: ["5i6i"] });
  assert.equal(broken.status, "PARTIAL");
  assert.match(broken.issues.join(" "), /ACTUAL_PV/);
});

test("capture と immediate recapture を合法再生だけから抽出する", () => {
  const bundle = layer.extractEvidence({
    sfen: "4k4/9/9/4r4/4p4/4P4/9/9/4K4 b - 1",
    actualMove: "5f5e", bestMove: "5f5e",
    actualPV: ["5f5e", "5d5e"], recommendedPV: ["5f5e", "5d5e"],
  });
  assert.equal(bundle.status, "VALID");
  assert.ok(bundle.evidence.some((item) => item.type === "LEGAL_CAPTURE" && item.target_piece === "P"));
  assert.ok(bundle.evidence.some((item) => item.type === "IMMEDIATE_RECAPTURE" && item.branch === "shared"));
});

test("check / check sequence / check+capture / mate endpoint を区別する", () => {
  const checkCapture = layer.extractEvidence({
    sfen: "4k4/4g4/9/9/9/4R4/9/9/4K4 b - 1",
    actualMove: "5f5b", bestMove: "5f5b", actualPV: ["5f5b"], recommendedPV: ["5f5b"],
  });
  assert.ok(checkCapture.evidence.some((item) => item.type === "CHECK_AND_CAPTURE"));

  const shuei159 = layer.extractEvidence(longestExistingInput("20260912_しゅえい", 159));
  assert.ok(shuei159.evidence.some((item) => item.type === "MATE_ENDPOINT" && item.branch === "actual" && item.ply_distance === 8));
  const sequence = shuei159.evidence.find((item) => item.type === "CHECK_SEQUENCE" && item.branch === "recommended");
  assert.deepEqual(sequence.check_plies.slice(0, 3), [1, 3, 5]);
});

test("promotion と drop を検証する", () => {
  const promotion = layer.extractEvidence({
    sfen: "4k4/9/9/4P4/9/9/9/9/4K4 b - 1",
    actualMove: "5d5c+", bestMove: "5d5c", actualPV: ["5d5c+"], recommendedPV: ["5d5c"],
  });
  assert.ok(promotion.evidence.some((item) => item.type === "PROMOTION"));
  const drop = layer.extractEvidence({
    sfen: "4k4/9/9/9/9/9/9/9/4K4 b G 1",
    actualMove: "G*4b", bestMove: "G*6b", actualPV: ["G*4b"], recommendedPV: ["G*6b"],
  });
  assert.ok(drop.evidence.some((item) => item.type === "DROP"));
});

test("全 POSITION_FACT を shadow evidence とし PRIMARY にしない", () => {
  const bundle = layer.extractEvidence(longestExistingInput("20260912_しゅえい", 79));
  for (const type of ["LEGAL_REPLY_COUNT", "LEGAL_CAPTURE_COUNT", "ATTACK_MAP", "DEFENDER_COUNT", "KING_ESCAPE_COUNT", "MOVED_PIECE_ATTACKERS"]) {
    assert.ok(bundle.evidence.some((item) => item.type === type), type);
    assert.equal(bundle.evidence.some((item) => item.type === type && item.reason_usability === "PRIMARY"), false, type);
  }
  assert.ok(bundle.evidence.some((item) => item.type === "ATTACK_MAP" && item.branch === "recommended" && item.to === "6f" && item.target_square === "7g" && item.target_piece === "+B"));
});

test("validator は piece / square / capture / check / mate / promotion / drop の改変を拒否する", () => {
  const input = longestExistingInput("20260912_しゅえい", 159);
  const bundle = layer.extractEvidence(input);
  assert.equal(layer.validateBundle(input, bundle).valid, true);
  const mate = bundle.evidence.find((item) => item.type === "MATE_ENDPOINT");
  assert.equal(layer.validateEvidence(input, { ...mate, to: "9i" }).valid, false);
  assert.equal(layer.validateEvidence(input, { ...mate, piece: "P" }).valid, false);
  const captureInput = { sfen: "4k4/4g4/9/9/9/4R4/9/9/4K4 b - 1", actualMove: "5f5b", bestMove: "5f5b", actualPV: ["5f5b"], recommendedPV: ["5f5b"] };
  const capture = layer.extractEvidence(captureInput).evidence.find((item) => item.type === "CHECK_AND_CAPTURE");
  assert.equal(layer.validateEvidence(captureInput, { ...capture, target_piece: null }).valid, false);
  const promotionInput = { sfen: "4k4/9/9/4P4/9/9/9/9/4K4 b - 1", actualMove: "5d5c+", bestMove: "5d5c", actualPV: ["5d5c+"], recommendedPV: ["5d5c"] };
  const promotion = layer.extractEvidence(promotionInput).evidence.find((item) => item.type === "PROMOTION");
  assert.equal(layer.validateEvidence(promotionInput, { ...promotion, type: "DROP" }).valid, false);
  const dropInput = { sfen: "4k4/9/9/9/9/9/9/9/4K4 b G 1", actualMove: "G*4b", bestMove: "G*6b", actualPV: ["G*4b"], recommendedPV: ["G*6b"] };
  const drop = layer.extractEvidence(dropInput).evidence.find((item) => item.type === "DROP");
  assert.equal(layer.validateEvidence(dropInput, { ...drop, from: "5i" }).valid, false);
  assert.equal(layer.validateEvidence(input, { ...mate, source_pv: ["bad"] }).valid, false);
});

test("actual / recommended / shared と proof confidence / usability enum を保持する", () => {
  const distinct = layer.extractEvidence(productionInput("20260912_しゅえい", 77));
  assert.ok(distinct.evidence.some((item) => item.branch === "actual"));
  assert.ok(distinct.evidence.some((item) => item.branch === "recommended"));
  const shared = layer.extractEvidence({ sfen: "4k4/9/9/9/9/9/9/9/4K4 b - 1", actualMove: "5i4i", bestMove: "5i4i", actualPV: ["5i4i"], recommendedPV: ["5i4i"] });
  assert.ok(shared.evidence.length > 0 && shared.evidence.every((item) => item.branch === "shared"));
  for (const item of [...distinct.evidence, ...shared.evidence]) {
    assert.ok(["HIGH", "MEDIUM", "LOW"].includes(item.proof_confidence));
    assert.ok(["PRIMARY", "SUPPORTING", "NOT_USABLE"].includes(item.reason_usability));
  }
  const sample = distinct.evidence[0];
  assert.equal(layer.validateEvidence(productionInput("20260912_しゅえい", 77), { ...sample, proof_confidence: "MEDIUM" }).valid, true);
  assert.equal(layer.validateEvidence(productionInput("20260912_しゅえい", 77), { ...sample, proof_confidence: "LOW" }).valid, true);
});

test("VALID / PARTIAL / INVALID と UNRESOLVED を正常系として返す", () => {
  const sfen = "4k4/9/9/9/9/9/9/9/4K4 b - 1";
  assert.equal(layer.extractEvidence({ sfen, actualMove: "5i4i", bestMove: "5i6i", actualPV: ["5i4i"], recommendedPV: ["5i6i"] }).status, "VALID");
  assert.equal(layer.extractEvidence({ sfen, actualMove: "5i4i", bestMove: "5i6i", actualPV: ["5i4i", "9i9h"], recommendedPV: ["5i6i"] }).status, "PARTIAL");
  const invalid = layer.extractEvidence({ sfen, actualMove: "7g7f", bestMove: "5i6i", actualPV: ["7g7f"], recommendedPV: ["5i6i"] });
  assert.equal(invalid.status, "INVALID");
  assert.equal(invalid.reason_candidate.status, "UNRESOLVED");
  const unresolved = layer.extractEvidence({ sfen, actualMove: "5i4i", bestMove: "5i6i", actualPV: ["5i4i"], recommendedPV: ["5i6i"] });
  assert.deepEqual([unresolved.reason_candidate.status, unresolved.reason_candidate.problem_reason, unresolved.reason_candidate.recommended_reason], ["UNRESOLVED", "UNRESOLVED", "UNRESOLVED"]);
});

test("必須4 fixture の期待を因果追加なしで満たす", () => {
  const shuei77 = layer.extractEvidence(longestExistingInput("20260912_しゅえい", 77));
  assert.ok(shuei77.evidence.some((item) => item.type === "LEGAL_CAPTURE" && item.branch === "actual" && item.ply_distance === 2 && item.piece === "+B" && item.target_piece === "N" && item.to === "7g"));
  assert.ok(shuei77.evidence.some((item) => item.type === "CHECK" && item.branch === "recommended" && item.ply_distance === 1));
  assert.deepEqual([shuei77.reason_candidate.q1_candidate, shuei77.reason_candidate.q2_candidate], ["△", "○"]);

  const shuei79 = layer.extractEvidence(longestExistingInput("20260912_しゅえい", 79));
  assert.equal(shuei79.reason_candidate.problem_reason, "UNRESOLVED");
  assert.match(shuei79.reason_candidate.recommended_reason, /7七の馬に当たり.*盤上から消えます/);
  assert.doesNotMatch(shuei79.reason_candidate.recommended_reason, /優れて|良い|有利|強制|唯一/);

  const shuei159 = layer.extractEvidence(longestExistingInput("20260912_しゅえい", 159));
  assert.deepEqual([shuei159.reason_candidate.q1_candidate, shuei159.reason_candidate.q2_candidate], ["○", "△"]);
  assert.doesNotMatch(JSON.stringify(shuei159.reason_candidate), /詰みを回避/);

  const ryunen = layer.extractEvidence(longestExistingInput("20260911_ryunenbb", 80));
  assert.ok(ryunen.evidence.some((item) => item.type === "MATE_ENDPOINT" && item.branch === "actual" && item.ply_distance === 6));
  assert.ok(ryunen.evidence.some((item) => item.type === "MATE_ENDPOINT" && item.branch === "recommended" && item.ply_distance === 16));
  assert.match(ryunen.reason_candidate.problem_reason, /6ply/);
  assert.match(ryunen.reason_candidate.recommended_reason, /16ply/);
  assert.doesNotMatch(JSON.stringify(ryunen.reason_candidate), /粘れる|良い|回避/);
});
