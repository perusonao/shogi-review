const fs = require("node:fs");
const path = require("node:path");
const summary = require(path.resolve(__dirname, "..", "game-summary.js"));

const root = path.resolve(__dirname, "..");
const audited16Ids = [
  "20260911_ak69boy", "20260911_nagata2532", "20260911_おまつ", "20260911_じゅんや",
  "20260911_ダルマ", "20260911_しゅん", "20260911_ぴろ", "20260911_大山_貴一郎",
  "20260910_ぽっぷ", "20260910_ぱいなぽー", "20260910_ひぐれ", "20260910_ariake",
  "20260910_taatoru_cat", "20260910_yogra", "20260910_aochikenmin", "akane_20260910",
];
const catalog = JSON.parse(fs.readFileSync(path.join(root, "games", "index.json"), "utf8"));
const currentCatalogIds = catalog.games.filter((game) => game.analyzed).map((game) => game.id);

function audit(gameIds) {
  const totals = {
    games: gameIds.length, important: 0, learning: 0, comparable: 0,
    maxLossCaptured: 0, mateGames: 0, mateCaptured: 0,
    nearbyPairs2: 0, nearbyPairs4: 0, sameBestMovePairs: 0,
  };
  const games = [];
  for (const gameId of gameIds) {
    const analysis = JSON.parse(fs.readFileSync(path.join(root, "analysis", `${gameId}.json`), "utf8"));
    const important = summary.selectImportantPositions(analysis);
    const learning = summary.extractLearningItems(analysis, important);
    const issues = analysis.verifiedIssues || [];
    const maxIssue = issues.reduce((best, candidate) => Number(candidate.lossCp || candidate.loss || 0) > Number(best?.lossCp || best?.loss || -1) ? candidate : best, null);
    const maxLossCaptured = Boolean(maxIssue && important.some((item) => item.ply === Number(maxIssue.ply)));
    const mateIssuePlies = issues.filter((candidate) => {
      const values = [candidate.beforeCp, candidate.afterCp, candidate.scoreBefore?.value, candidate.scoreAfterActual?.value];
      return candidate.scoreBefore?.type === "mate" || candidate.scoreAfterActual?.type === "mate" || values.some((value) => Number.isFinite(Number(value)) && Math.abs(Number(value)) >= 25000);
    }).map((candidate) => Number(candidate.ply));
    const mateCaptured = !mateIssuePlies.length || important.some((item) => mateIssuePlies.includes(item.ply));

    totals.important += important.length;
    totals.learning += learning.length;
    totals.comparable += learning.filter((item) => item.actualMove && item.bestMove).length;
    totals.maxLossCaptured += Number(maxLossCaptured);
    if (mateIssuePlies.length) {
      totals.mateGames += 1;
      totals.mateCaptured += Number(mateCaptured);
    }
    for (let left = 0; left < important.length; left += 1) {
      for (let right = left + 1; right < important.length; right += 1) {
        const distance = Math.abs(important[left].ply - important[right].ply);
        if (distance <= 2) totals.nearbyPairs2 += 1;
        if (distance <= 4) totals.nearbyPairs4 += 1;
        if (important[left].issue?.best && important[left].issue.best === important[right].issue?.best) totals.sameBestMovePairs += 1;
      }
    }
    games.push({
      gameId,
      important: important.map((item) => ({ ply: item.ply, auxiliary: item.auxiliaryEvents.map((event) => event.ply) })),
      learning: learning.map((item) => item.ply),
      maxLossCaptured,
      mateCaptured,
    });
  }
  totals.averageImportant = Number((totals.important / totals.games).toFixed(2));
  totals.averageLearning = Number((totals.learning / totals.games).toFixed(2));
  totals.comparableRate = totals.learning ? Number((100 * totals.comparable / totals.learning).toFixed(1)) : 0;
  return { totals, games };
}

process.stdout.write(`${JSON.stringify({ audited16: audit(audited16Ids), currentCatalog: audit(currentCatalogIds) }, null, 2)}\n`);
