const fs = require("node:fs");
const path = require("node:path");
const reason = require(path.resolve(__dirname, "..", "reason-evidence.js"));

const root = path.resolve(__dirname, "..");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "games", "index.json"), "utf8"));
const phase2Entries = catalog.games.filter((game) => game.analyzed)
  .filter((game) => !["20260912_クロロ", "20260912_ひこな", "20260912_しゅえい"].includes(game.id));
const phase2Audit = fs.readFileSync(path.join(root, "docs", "reports", "SHOGI_REASON-EXPLANATION_Phase2_HUMAN-AUDIT.md"), "utf8");
const normalize = (value) => String(value).replace(/\s/g, "").toLowerCase();
const auditedKeys = new Map();
for (const line of phase2Audit.split(/\r?\n/)) {
  const cells = line.split("|").map((cell) => cell.trim());
  if (!/^\d+$/.test(cells[1] || "")) continue;
  const match = (cells[2] || "").match(/^(.*)\s\/\s(\d+)$/);
  if (match && /^[A-E]$/.test(cells[6] || "")) auditedKeys.set(`${normalize(match[1])}/${match[2]}`, cells[6]);
}

function inputFor(game, item) {
  return {
    sfen: game.positions[item.ply - 1].sfen,
    actualMove: item.played, bestMove: item.best,
    actualScore: item.scoreAfterActual, recommendedScore: item.bestScore || item.scoreBefore,
    actualPV: item.actualPv || [], recommendedPV: item.pv || [],
    actualPVJa: item.actualPvJa || [], recommendedPVJa: item.pvJa || [],
    actualMoveJa: item.playedJa, bestMoveJa: item.bestJa,
  };
}

function phase2WasD(result) {
  const decisive = [...result.actualOnly, ...result.recommendedOnly].some((event) =>
    event.type === "mate" || event.type === "material-swing" ||
    (["check", "capture"].includes(event.type) && Number(event.pvPly) <= 2));
  return !decisive;
}

function reclassify(result, input) {
  if ((input.actualPV || []).length < 2 || (input.recommendedPV || []).length < 2) return "C";
  if (result.candidate.blocks.length >= 2 && !result.candidate.unresolved) return "A";
  if (result.candidate.blocks.length || result.prioritized.some((event) => ["HIGH", "MEDIUM"].includes(event.confidence))) return "B";
  return "C";
}

const rows = [];
for (const entry of phase2Entries) {
  const id = entry.id;
  const game = JSON.parse(fs.readFileSync(path.join(root, entry.gameData), "utf8"));
  const analysis = JSON.parse(fs.readFileSync(path.join(root, entry.analysisData), "utf8"));
  for (const item of analysis.verifiedIssues || []) {
    const input = inputFor(game, item);
    const difference = reason.analyzeBranchDifference(input);
    const auditKey = `${normalize(game.game.title)}/${item.ply}`;
    if (!auditedKeys.has(auditKey)) continue;
    rows.push({
      id, title: game.game.title, ply: item.ply, actual: item.playedJa, recommended: item.bestJa,
      actualPvLength: (item.actualPv || []).length, recommendedPvLength: (item.pv || []).length,
      phase2D: auditedKeys.get(auditKey) === "D", phase2Candidate: auditedKeys.get(auditKey), classification: reclassify(difference, input),
      actualOnly: difference.actualOnly.map((event) => `${event.type}:${event.confidence}`),
      shared: difference.shared.map((event) => event.key),
      recommendedOnly: difference.recommendedOnly.map((event) => `${event.type}:${event.confidence}`),
      candidate: difference.candidate,
    });
  }
}

const d64 = rows.filter((row) => row.phase2D);
const counts = d64.reduce((out, row) => ({ ...out, [row.classification]: (out[row.classification] || 0) + 1 }), { A: 0, B: 0, C: 0 });
const confidence = rows.flatMap((row) => [...row.actualOnly, ...row.recommendedOnly]).reduce((out, label) => {
  const level = label.split(":").at(-1);
  out[level] = (out[level] || 0) + 1;
  return out;
}, { HIGH: 0, MEDIUM: 0, LOW: 0 });
const result = { phase2Games: phase2Entries.length, problems: rows.length, phase2D: d64.length, d64: counts, confidence };
if (!process.argv.includes("--summary")) result.rows = rows;
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
