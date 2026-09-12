const fs = require("node:fs");
const path = require("node:path");
const layer = require(path.resolve(__dirname, "..", "reason-evidence-layer.js"));

const root = path.resolve(__dirname, "..");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "games", "index.json"), "utf8"));
const rows = [];
for (const entry of catalog.games.filter((game) => game.analyzed)) {
  const game = JSON.parse(fs.readFileSync(path.join(root, entry.gameData), "utf8"));
  const analysis = JSON.parse(fs.readFileSync(path.join(root, entry.analysisData), "utf8"));
  for (const issue of analysis.verifiedIssues || []) {
    const input = {
      sfen: game.positions[Number(issue.ply) - 1].sfen,
      actualMove: issue.played,
      bestMove: issue.best,
      actualPV: issue.actualPv || [],
      recommendedPV: issue.pv || [],
    };
    const bundle = layer.extractEvidence(input);
    rows.push({
      gameId: entry.id,
      ply: Number(issue.ply),
      evidenceStatus: bundle.status,
      productionStatus: bundle.production_reason.status,
      reason: bundle.production_reason.reason,
      q1: bundle.production_reason.q1,
      q2: bundle.production_reason.q2,
      q3: bundle.production_reason.q3,
      acceptedTypes: bundle.production_reason.accepted_types,
      blocks: bundle.production_reason.blocks.map((block) => ({ key: block.key, text: block.text })),
    });
  }
}

const adopted = rows.filter((row) => row.productionStatus === "PRODUCTION_READY");
const summary = {
  schema: "reason-evidence-production-audit-v1",
  total: rows.length,
  adoptedFixtures: adopted.length,
  adoptedBlocks: adopted.reduce((count, row) => count + row.blocks.length, 0),
  q1Blocks: adopted.filter((row) => row.q1 === "○").length,
  q2Blocks: adopted.filter((row) => row.q2 === "○").length,
  supportingOrUnresolved: rows.filter((row) => row.productionStatus === "FALLBACK" && row.reason === "SUPPORTING_ONLY").length,
  invalid: rows.filter((row) => row.reason === "INVALID").length,
  validatorFailures: rows.filter((row) => row.reason === "VALIDATOR_FAILURE").length,
};
process.stdout.write(`${JSON.stringify({ summary, adopted }, null, 2)}\n`);
if (summary.validatorFailures !== 0) process.exitCode = 1;
