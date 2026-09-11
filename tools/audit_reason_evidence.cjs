const fs = require("node:fs");
const path = require("node:path");
const reason = require(path.resolve(__dirname, "..", "reason-evidence.js"));

const root = path.resolve(__dirname, "..");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "games", "index.json"), "utf8"));
const levels = { 1: 0, 2: 0, 3: 0 };
const types = { mate: 0, check: 0, capture: 0, promotion: 0, drop: 0, material: 0, "immediate threat": 0 };
const forbidden = ["守りが薄い", "玉形が悪い", "攻めが遅い", "攻めが速い", "大局観", "金を動かしたから", "唯一の受け", "王手を続けられる"];
let problems = 0;

for (const entry of catalog.games.filter((game) => game.analyzed)) {
  const game = JSON.parse(fs.readFileSync(path.join(root, entry.gameData), "utf8"));
  const analysis = JSON.parse(fs.readFileSync(path.join(root, entry.analysisData), "utf8"));
  for (const problem of game.issues || []) {
    const item = (analysis.verifiedIssues || []).find((candidate) => Number(candidate.ply) === Number(problem.ply));
    if (!item) throw new Error(`${entry.id} ply ${problem.ply}: analysis issue not found`);
    const generated = reason.generateReasonEvidence({
      sfen: game.positions[item.ply - 1].sfen,
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
    });
    problems += 1;
    levels[generated.level] += 1;
    for (const type of generated.types) types[type] += 1;
    const prose = generated.blocks.map((block) => block.text).join("\n");
    for (const phrase of forbidden) {
      if (prose.includes(phrase)) throw new Error(`${entry.id} ply ${item.ply}: forbidden prose ${phrase}`);
    }
  }
}

const result = { games: catalog.games.filter((game) => game.analyzed).length, problems, levels, types };
console.log(JSON.stringify(result, null, 2));
if (result.games !== 20 || problems !== 110) process.exitCode = 1;
if (levels[1] < 22 || levels[3] > 7) process.exitCode = 1;
