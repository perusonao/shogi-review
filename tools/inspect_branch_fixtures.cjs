const fs = require("node:fs");
const path = require("node:path");
const reason = require(path.resolve(__dirname, "..", "reason-evidence.js"));
const root = path.resolve(__dirname, "..");

function fixture(id, ply) {
  const game = JSON.parse(fs.readFileSync(path.join(root, "games", `${id}.json`), "utf8"));
  const analysis = JSON.parse(fs.readFileSync(path.join(root, "analysis", `${id}.json`), "utf8"));
  const item = analysis.verifiedIssues.find((candidate) => Number(candidate.ply) === ply);
  if (!item) throw new Error(`${id} ${ply}: missing fixture`);
  const input = {
    sfen: game.positions[ply - 1].sfen, actualMove: item.played, bestMove: item.best,
    actualScore: item.scoreAfterActual, recommendedScore: item.bestScore || item.scoreBefore,
    actualPV: item.actualPv || [], recommendedPV: item.pv || [],
    actualPVJa: item.actualPvJa || [], recommendedPVJa: item.pvJa || [],
    actualMoveJa: item.playedJa, bestMoveJa: item.bestJa,
  };
  const result = reason.analyzeBranchDifference(input);
  const event = (value) => ({ type: value.type, ply: value.pvPly || null, actor: value.actor || null, piece: value.piece || null, confidence: value.confidence || null });
  return {
    id, title: game.game.title, ply, actual: item.playedJa, recommended: item.bestJa,
    actualScore: input.actualScore, recommendedScore: input.recommendedScore,
    actualPvLength: input.actualPV.length, recommendedPvLength: input.recommendedPV.length,
    actualOnly: result.actualOnly.map(event), shared: result.shared.map((value) => ({ key: value.key, actualPly: value.actual.pvPly || null, recommendedPly: value.recommended.pvPly || null })),
    recommendedOnly: result.recommendedOnly.map(event), candidate: result.candidate,
  };
}

const top10 = [
  ["20260911_ryunenbb", 80], ["20260911_ak69boy", 131], ["20260911_夢への旅路", 42],
  ["20260911_nagata2532", 28], ["20260911_しゅん", 79], ["20260911_夢への旅路", 50],
  ["20260911_夢への旅路", 84], ["20260910_taatoru_cat", 67], ["20260911_おまつ", 80],
  ["20260911_じゅんや", 44],
].map(([id, ply]) => fixture(id, ply));
const required = [["20260911_ryunenbb", 80], ["20260912_しゅえい", 77], ["20260912_しゅえい", 79], ["20260912_しゅえい", 159]].map(([id, ply]) => fixture(id, ply));
process.stdout.write(`${JSON.stringify({ top10, required }, null, 2)}\n`);
