const test = require("node:test");
const assert = require("node:assert/strict");
const post = require("../tools/postprocess_reason_search.cjs");

test("30k/60k stability uses semantic event intersection", () => {
  const stats = post.setStats(new Set(["actual:mate", "recommended:check"]), new Set(["actual:mate", "actual:capture"]));
  assert.deepEqual(stats.shared, ["actual:mate"]);
  assert.equal(stats.union.length, 3);
  assert.equal(stats.rate, 1 / 3);
});

test("ratings stay conservative when a candidate is unresolved", () => {
  const difference = {
    candidate: { blocks: [{ key: "problem", confidence: "HIGH" }], unresolved: true },
    actualOnly: [{ confidence: "HIGH" }], recommendedOnly: [],
  };
  assert.equal(post.rating(difference, "q1"), "△");
  assert.equal(post.rating(difference, "q2"), "×");
});

test("event keys align facts rather than PV ply", () => {
  assert.equal(
    post.eventKey({ type: "capture", actor: "opponent", capturedPieceId: "b:7,7:P", pvPly: 2 }),
    post.eventKey({ type: "capture", actor: "opponent", capturedPieceId: "b:7,7:P", pvPly: 7 }),
  );
});
