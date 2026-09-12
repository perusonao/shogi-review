const fs = require("node:fs");
const path = require("node:path");
const layer = require(path.resolve(__dirname, "..", "reason-evidence-layer.js"));
const currentReason = require(path.resolve(__dirname, "..", "reason-evidence.js"));

const root = path.resolve(__dirname, "..");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "games", "index.json"), "utf8"));
const phase2Audit = fs.readFileSync(path.join(root, "docs", "reports", "SHOGI_REASON-EXPLANATION_Phase2_HUMAN-AUDIT.md"), "utf8");
const additionalPath = path.join(root, "reason-additional-search.tmp");
const additional = fs.existsSync(additionalPath) ? JSON.parse(fs.readFileSync(additionalPath, "utf8")) : { results: [] };
const normalize = (value) => String(value).replace(/\s/g, "").toLowerCase();
const audited = new Map();
for (const line of phase2Audit.split(/\r?\n/)) {
  const cells = line.split("|").map((cell) => cell.trim());
  if (!/^\d+$/.test(cells[1] || "")) continue;
  const match = (cells[2] || "").match(/^(.*)\s\/\s(\d+)$/);
  if (match && /^[A-E]$/.test(cells[6] || "")) audited.set(`${normalize(match[1])}/${match[2]}`, cells[6]);
}

function gameAndIssue(gameId, ply) {
  const game = JSON.parse(fs.readFileSync(path.join(root, "games", `${gameId}.json`), "utf8"));
  const analysis = JSON.parse(fs.readFileSync(path.join(root, "analysis", `${gameId}.json`), "utf8"));
  const issue = analysis.verifiedIssues.find((item) => Number(item.ply) === Number(ply));
  if (!issue) throw new Error(`${gameId}/${ply}: issue not found`);
  return { game, issue };
}

function inputFor(game, issue, useAdditional = false) {
  const input = {
    sfen: game.positions[issue.ply - 1].sfen,
    actualMove: issue.played,
    bestMove: issue.best,
    actualPV: issue.actualPv || [],
    recommendedPV: issue.pv || [],
  };
  if (!useAdditional) return input;
  const result = additional.results.find((item) => item.gameId === game.game.id && Number(item.ply) === Number(issue.ply));
  if (!result) return input;
  for (const branch of ["actual", "recommended"]) {
    const key = branch === "actual" ? "actualPV" : "recommendedPV";
    const candidates = Object.values(result.searches || {}).map((profile) => profile[branch]?.pv).filter(Array.isArray);
    candidates.push(input[key]);
    input[key] = candidates.sort((left, right) => right.length - left.length)[0];
  }
  return input;
}

function compactEvidence(item) {
  return {
    type: item.type, branch: item.branch, side: item.side, piece: item.piece,
    from: item.from, to: item.to, target_piece: item.target_piece, target_square: item.target_square,
    ply_distance: item.ply_distance, proof_confidence: item.proof_confidence,
    reason_usability: item.reason_usability, proof_valid: item.validation.valid,
    count: item.count, check_plies: item.check_plies,
  };
}

const phase2Entries = catalog.games.filter((game) => game.analyzed)
  .filter((game) => !["20260912_クロロ", "20260912_ひこな", "20260912_しゅえい"].includes(game.id));
const dc = [];
for (const entry of phase2Entries) {
  const game = JSON.parse(fs.readFileSync(path.join(root, entry.gameData), "utf8"));
  const analysis = JSON.parse(fs.readFileSync(path.join(root, entry.analysisData), "utf8"));
  for (const issue of analysis.verifiedIssues || []) {
    const grade = audited.get(`${normalize(game.game.title)}/${issue.ply}`);
    if (grade !== "D" || (issue.actualPv || []).length >= 2 && (issue.pv || []).length >= 2) continue;
    const bundle = layer.extractEvidence(inputFor(game, issue));
    dc.push({ gameId: entry.id, title: game.game.title, ply: issue.ply, actual: issue.playedJa, recommended: issue.bestJa, bundle });
  }
}

const counts = {
  total: dc.length, VALID: 0, PARTIAL: 0, INVALID: 0,
  primary: 0, supporting_only: 0, not_usable_only: 0, unresolved: 0, q1: 0, q2: 0, validator_failures: 0,
};
for (const row of dc) {
  counts[row.bundle.status] += 1;
  const valid = row.bundle.evidence.filter((item) => item.validation.valid);
  counts.validator_failures += row.bundle.evidence.length - valid.length;
  const hasPrimary = valid.some((item) => item.reason_usability === "PRIMARY" && ["HIGH", "MEDIUM"].includes(item.proof_confidence));
  const hasSupporting = valid.some((item) => item.reason_usability === "SUPPORTING");
  if (hasPrimary) counts.primary += 1;
  else if (hasSupporting) counts.supporting_only += 1;
  else if (row.bundle.status !== "INVALID") counts.not_usable_only += 1;
  if (row.bundle.reason_candidate.status === "UNRESOLVED") counts.unresolved += 1;
  if (row.bundle.reason_candidate.problem_reason !== "UNRESOLVED") counts.q1 += 1;
  if (row.bundle.reason_candidate.recommended_reason !== "UNRESOLVED") counts.q2 += 1;
}

const top10Spec = [
  ["20260911_ryunenbb", 80], ["20260911_ak69boy", 131], ["20260911_夢への旅路", 42],
  ["20260911_nagata2532", 28], ["20260911_しゅん", 79], ["20260911_夢への旅路", 50],
  ["20260911_夢への旅路", 84], ["20260910_taatoru_cat", 67], ["20260911_おまつ", 80],
  ["20260911_じゅんや", 44],
];
const top10 = top10Spec.map(([gameId, ply]) => {
  const { game, issue } = gameAndIssue(gameId, ply);
  const input = inputFor(game, issue, true);
  const bundle = layer.extractEvidence(input);
  const current = currentReason.generateReasonEvidence({
    ...input, actualScore: issue.scoreAfterActual, recommendedScore: issue.bestScore || issue.scoreBefore,
    actualPVJa: issue.actualPvJa, recommendedPVJa: issue.pvJa, actualMoveJa: issue.playedJa, bestMoveJa: issue.bestJa,
  });
  return {
    gameId, title: game.game.title, ply, board: input.sfen.split(" ")[0], sfen: input.sfen,
    actual: issue.playedJa, recommended: issue.bestJa, status: bundle.status, issues: bundle.issues,
    evidence: bundle.evidence.map(compactEvidence),
    current_reason: current.blocks.map((block) => block.text), reason_candidate: bundle.reason_candidate,
  };
});
const caseArg = process.argv.find((value) => value.startsWith("--case="));
const selectedTop10 = caseArg ? top10.filter((row) => `${row.gameId}/${row.ply}` === caseArg.slice(7)) : top10;

const required = [
  ["20260912_しゅえい", 77], ["20260912_しゅえい", 79], ["20260912_しゅえい", 159], ["20260911_ryunenbb", 80],
].map(([gameId, ply]) => {
  const { game, issue } = gameAndIssue(gameId, ply);
  const bundle = layer.extractEvidence(inputFor(game, issue, true));
  return { gameId, ply, status: bundle.status, issues: bundle.issues, reason_candidate: bundle.reason_candidate, evidence: bundle.evidence.map(compactEvidence) };
});

const output = { schema: "reason-evidence-layer-audit-v1", counts, invalid: dc.filter((row) => row.bundle.status === "INVALID").map((row) => ({ gameId: row.gameId, title: row.title, ply: row.ply, issues: row.bundle.issues })), top10, required };
if (process.argv.includes("--summary")) process.stdout.write(`${JSON.stringify({ schema: output.schema, counts: output.counts, invalid: output.invalid, required: output.required.map((item) => ({ gameId: item.gameId, ply: item.ply, status: item.status, reason_candidate: item.reason_candidate })) }, null, 2)}\n`);
else if (process.argv.includes("--top10-compact")) process.stdout.write(`${JSON.stringify(selectedTop10.map((row) => ({ gameId: row.gameId, title: row.title, ply: row.ply, sfen: row.sfen, actual: row.actual, recommended: row.recommended, status: row.status, current_reason: row.current_reason, reason_candidate: row.reason_candidate, primary: row.evidence.filter((item) => item.reason_usability === "PRIMARY") })), null, 2)}\n`);
else if (process.argv.includes("--top10-summary")) process.stdout.write(`${JSON.stringify(selectedTop10.map((row) => ({ gameId: row.gameId, title: row.title, ply: row.ply, actual: row.actual, recommended: row.recommended, status: row.status, issues: row.issues, evidence: row.evidence, current_reason: row.current_reason, reason_candidate: row.reason_candidate })), null, 2)}\n`);
else if (process.argv.includes("--top10-digest")) process.stdout.write(`${JSON.stringify(selectedTop10.map((row) => {
  const typeCounts = {};
  for (const item of row.evidence) {
    const key = `${item.branch}/${item.type}/${item.proof_confidence}/${item.reason_usability}`;
    typeCounts[key] = (typeCounts[key] || 0) + 1;
  }
  return {
    gameId: row.gameId, title: row.title, ply: row.ply, sfen: row.sfen, actual: row.actual, recommended: row.recommended,
    status: row.status, current_reason: row.current_reason, reason_candidate: row.reason_candidate, type_counts: typeCounts,
    primary: row.evidence.filter((item) => item.reason_usability === "PRIMARY"),
    supporting: row.evidence.filter((item) => item.reason_usability === "SUPPORTING" && ["MATE_ENDPOINT", "CHECK_SEQUENCE", "IMMEDIATE_RECAPTURE", "CHECK_AND_CAPTURE", "CHECK", "LEGAL_CAPTURE", "ATTACK_MAP"].includes(item.type)).slice(0, 12),
  };
}), null, 2)}\n`);
else process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (counts.total !== 59 || counts.INVALID !== 2 || counts.validator_failures !== 0) process.exitCode = 1;
