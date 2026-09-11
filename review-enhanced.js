/* Grounded PV review card. Relies on the existing board/USI formatter in index.html. */
const renderBoardAndLegacyCard = render;

function scoreLabel(score) {
  if (!score) return "";
  const value = Number(score.value || 0);
  if (score.type === "mate") {
    const label = value > 0 ? "詰みあり" : value < 0 ? "相手側に詰みあり" : "詰み評価";
    return label + (value ? `（${Math.abs(value)}手）` : "");
  }
  return `${value >= 0 ? "+" : ""}${value}`;
}

function issueScores(analysis) {
  if (analysis?.scoreBefore && analysis?.scoreAfterActual) {
    return [analysis.scoreBefore, analysis.scoreAfterActual];
  }
  const sign = userSide() === "b" ? 1 : -1;
  return [
    { type: "cp", value: Number(analysis?.beforeCp || 0) * sign },
    { type: "cp", value: Number(analysis?.afterCp || 0) * sign },
  ];
}

function mateChangeText(before, after) {
  if (before.type === "mate" && before.value > 0 && !(after.type === "mate" && after.value > 0)) {
    return "詰みあり → 詰みなし（詰みを逃した）";
  }
  if (before.type !== "mate" && after.type === "mate" && after.value < 0) {
    return "相手の詰み筋に入った";
  }
  return "詰み評価が変化した局面";
}

function appendText(parent, tag, text, className = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function renderVerifiedIssue(issue) {
  const analysis = issueAnalysis(issue);
  const positionIndex = Math.max(0, issue.ply - 1);
  const position = parseSFEN(D.positions[positionIndex].sfen);
  const mover = issue.ply % 2 ? "b" : "w";
  const previous = previousDestination(issue.ply);
  const actual = analysis?.playedJa || formatMove(actualMove(issue), position, mover, previous);
  const best = analysis?.bestJa || formatMove(bestMove(issue), position, mover, previous);
  const card = document.createElement("div");
  card.className = "card warn";
  appendText(card, "h2", "⚠ 課題局面");

  const legend = document.createElement("div");
  legend.className = "legend";
  appendText(legend, "span", "● 赤＝実戦", "red");
  legend.appendChild(document.createTextNode("　"));
  appendText(legend, "span", "● 緑＝推奨", "green");
  card.appendChild(legend);

  const compare = document.createElement("div");
  compare.className = "compare";
  for (const [label, value, kind] of [["あなたの手", actual, "bad"], ["水匠5 推奨", best, "good"]]) {
    const choice = document.createElement("div");
    choice.className = `choice ${kind}`;
    appendText(choice, "small", label);
    appendText(choice, "strong", value);
    compare.appendChild(choice);
  }
  card.appendChild(compare);

  const [before, after] = issueScores(analysis);
  const legacyMate = !analysis?.scoreBefore && (
    Math.abs(analysis?.beforeCp || 0) >= 25000 ||
    Math.abs(analysis?.afterCp || 0) >= 25000 ||
    issue.loss >= 25000
  );
  const hasMate = legacyMate || before.type === "mate" || after.type === "mate";
  const evaluation = hasMate
    ? mateChangeText(before, after)
    : `評価値 ${scoreLabel(before)} → ${scoreLabel(after)}　損失 約${analysis?.lossCp ?? issue.loss}点`;
  appendText(card, "div", evaluation, "loss");

  const points = (analysis?.points || []).slice(0, 2);
  if (points.length) {
    const box = appendText(card, "div", "【ポイント】", "comment");
    for (const point of points) appendText(box, "div", `・${point}`);
  } else {
    appendText(card, "div", `水匠5は実戦手より${best}を高く評価しています。まず読み筋を比較してみましょう。`, "comment");
  }

  const bestPv = (analysis?.pvJa || []).slice(0, 7);
  const actualPv = (analysis?.actualPvJa || []).slice(0, 7);
  if (bestPv.length || actualPv.length) {
    const details = document.createElement("details");
    appendText(details, "summary", "読み筋を見る");
    if (bestPv.length) {
      appendText(details, "b", "水匠5推奨なら");
      appendText(details, "div", bestPv.join(" → "), "comment");
    }
    if (actualPv.length) {
      appendText(details, "b", "実戦手なら");
      appendText(details, "div", actualPv.join(" → "), "comment");
    }
    card.appendChild(details);
  }
  review.replaceChildren(card);
}

function renderEnhanced() {
  renderBoardAndLegacyCard();
  const issue = D?.issues.find((item) => item.ply === ply);
  if (issue) renderVerifiedIssue(issue);
}

render = renderEnhanced;
