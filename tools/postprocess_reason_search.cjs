const fs = require("node:fs");
const path = require("node:path");
const reason = require(path.resolve(__dirname, "..", "reason-evidence.js"));

function eventKey(event) {
  if (["capture", "major-piece-loss"].includes(event.type)) return `${event.type}:${event.actor}:${event.capturedPieceId || event.piece}`;
  if (["promotion", "drop"].includes(event.type)) return `${event.type}:${event.actor}:${event.piece}`;
  if (event.type === "mate") return `mate:${event.state}`;
  if (event.type === "material-swing") return `material-swing:${Math.sign(event.delta)}`;
  return `${event.type}:${event.actor || "branch"}`;
}

function inputFor(fixture, pair) {
  return {
    sfen: fixture.position.sfen,
    actualMove: fixture.actualMove, bestMove: fixture.bestMove,
    actualMoveJa: fixture.actualMoveJa, bestMoveJa: fixture.bestMoveJa,
    actualScore: pair.actual.score, recommendedScore: pair.recommended.score,
    actualPV: pair.actual.pv, recommendedPV: pair.recommended.pv,
    actualPVJa: pair.actual.pvJa, recommendedPVJa: pair.recommended.pvJa,
  };
}

function compactEvent(event) {
  return {
    type: event.type, branch: event.branch || null, ply: event.pvPly || null,
    actor: event.actor || null, piece: event.piece || null,
    state: event.state || null, confidence: event.confidence || null,
    move: event.moveJa || event.moveUsi || null,
  };
}

function rating(difference, kind) {
  const key = kind === "q1" ? "problem" : "recommended";
  const hasBlock = difference.candidate.blocks.some((block) => block.key === key && ["HIGH", "MEDIUM"].includes(block.confidence));
  if (hasBlock && difference.candidate.blocks.length >= 2 && !difference.candidate.unresolved) return "○";
  if (hasBlock) return "△";
  const events = kind === "q1" ? difference.actualOnly : difference.recommendedOnly;
  return events.some((event) => ["HIGH", "MEDIUM"].includes(event.confidence)) ? "△" : "×";
}

function semanticSet(difference) {
  return new Set([
    ...difference.actualOnly.map((event) => `actual:${eventKey(event)}`),
    ...difference.recommendedOnly.map((event) => `recommended:${eventKey(event)}`),
  ]);
}

function setStats(left, right) {
  const shared = [...left].filter((key) => right.has(key));
  const union = new Set([...left, ...right]);
  return { shared, union: [...union], rate: union.size ? shared.length / union.size : 1 };
}

function tacticalReplyFacts(fixture, item) {
  if (!item?.multiPv2) return null;
  const summarize = (branch) => {
    const lineSets = branch.lines.map((line) => {
      const replay = reason.replayBranch(fixture.position.sfen, line.fullPv, line.fullPvJa);
      return new Set(replay.events.flatMap((event) => {
        const actor = event.side === (fixture.userSide === "sente" ? "b" : "w") ? "mover" : "opponent";
        const values = [];
        if (event.capture) values.push(`capture:${actor}:${event.capture}`);
        if (event.check) values.push(`check:${actor}`);
        if (event.promotion) values.push(`promotion:${actor}:${event.piece}`);
        return values;
      }));
    });
    const common = lineSets.length >= 2 ? [...lineSets[0]].filter((key) => lineSets.slice(1).every((set) => set.has(key))) : [];
    return {
      alternatives: branch.lines.length, commonTacticalEvents: common,
      commonScope: "returned-multipv-lines-only", forced: false,
    };
  };
  return { actual: summarize(item.multiPv2.actual), recommended: summarize(item.multiPv2.recommended) };
}

function enrich(payload) {
  for (const fixture of payload.results) {
    const differences = {};
    for (const [nodes, pair] of Object.entries(fixture.searches)) {
      const full = reason.analyzeBranchDifference(inputFor(fixture, pair));
      pair.actual.branchFeatures = full.branches.actual;
      pair.recommended.branchFeatures = full.branches.recommended;
      differences[nodes] = {
        actualOnly: full.actualOnly.map(compactEvent),
        shared: full.shared.map((event) => ({ key: event.key, actualPly: event.actual.pvPly || null, recommendedPly: event.recommended.pvPly || null })),
        recommendedOnly: full.recommendedOnly.map(compactEvent),
        firstDifferencePly: Math.min(...[...full.actualOnly, ...full.recommendedOnly].map((event) => event.pvPly).filter(Number.isFinite), Infinity),
        materialDelta: full.branches.recommended.finalMaterialBalance - full.branches.actual.finalMaterialBalance,
        candidateReason: full.candidate,
        q1: rating(full, "q1"), q2: rating(full, "q2"), q3: "×",
        semanticKeys: [...semanticSet(full)],
      };
      if (!Number.isFinite(differences[nodes].firstDifferencePly)) differences[nodes].firstDifferencePly = null;
    }
    fixture.differences = differences;
    fixture.stability30k60k = setStats(new Set(differences["30000"].semanticKeys), new Set(differences["60000"].semanticKeys));
    fixture.multiPv2Evidence = tacticalReplyFacts(fixture, fixture);
  }
  const stability = payload.results.map((item) => item.stability30k60k);
  payload.summary = {
    stableDifferenceCount: stability.reduce((sum, item) => sum + item.shared.length, 0),
    differenceUnionCount: stability.reduce((sum, item) => sum + item.union.length, 0),
  };
  payload.summary.stableDifferenceRate = payload.summary.differenceUnionCount
    ? payload.summary.stableDifferenceCount / payload.summary.differenceUnionCount : 1;
  return payload;
}

function main(argv) {
  if (argv.length !== 2) throw new Error("usage: node tools/postprocess_reason_search.cjs INPUT OUTPUT");
  const payload = JSON.parse(fs.readFileSync(argv[0], "utf8"));
  if (payload.schema !== "reason-branch-v1" || payload.schemaVersion !== 1) throw new Error("unsupported schema");
  const enriched = enrich(payload);
  fs.writeFileSync(argv[1], `${JSON.stringify(enriched, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ output: argv[1], summary: enriched.summary })}\n`);
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { eventKey, rating, semanticSet, setStats, enrich };
