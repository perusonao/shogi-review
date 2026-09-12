/* Evidence-grounded issue card. B-strict selection and analysis data stay untouched. */
const reviewPhase1Style = document.createElement("style");
reviewPhase1Style.textContent = `
:root{--actual-board:#A11222;--recommended-board:#0047AB;--actual-card:#FF6B5A;--recommended-card:#5DA9FF}
.app{padding:2px 5px}.top{height:23px}.boardShell{width:min(100%,42dvh);margin-top:0}.hand{height:31px;padding-top:2px;padding-bottom:2px}
.controls{grid-template-columns:36px 1fr 36px 70px;gap:3px;margin:1px 0}.controls button{height:27px}.controls .nextIssueCompact{font-size:9px;background:#765123}.move{height:27px}.move b{font-size:10px}.move small{font-size:8px}
.evalWrap{height:49px;margin:1px 0;padding:1px 5px}.evalHead{height:11px}.evalSvg{height:34px}
.warn{border-left-color:var(--actual-card)}.warn h2{margin-bottom:2px}.legend{font-size:8px;margin-bottom:2px}.actualSemantic,.red{color:var(--actual-card)}.recommendedSemantic,.green{color:var(--recommended-card)}
.compare{display:grid;grid-template-columns:1fr!important;gap:1px!important}.choice{padding:1px 4px;font-size:10px;display:flex;align-items:center;gap:7px;min-height:20px}.choice .moveRole{font-weight:700;min-width:30px}.choiceNotation{font-size:11px;color:#fff3df;font-weight:700}.bad{border-color:var(--actual-card)}.good{border:1px dashed var(--recommended-card)}.bad .moveRole{color:var(--actual-card)}.good .moveRole{color:var(--recommended-card)}
.loss{font-size:8px;margin-top:2px}.reasonBlocks{margin-top:2px}.reasonBlock{font-size:9px;line-height:1.25;margin-top:2px;color:#fff3df}.reasonBlock b{color:#f5d49c;margin-right:3px}.reasonLevel{float:right;color:#a99d8c;font-size:8px}.pvDetails{margin-top:3px;font-size:8px}.pvDetails summary{cursor:pointer;color:#d8c19a;font-weight:700}.pvBranch{margin-top:2px}.pvBranch.actual{border-left:2px solid var(--actual-card);padding-left:4px}.pvBranch.recommended{border-left:2px dashed var(--recommended-card);padding-left:4px}.jump{display:none!important}
`;
document.head.appendChild(reviewPhase1Style);

function semanticColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

drawArrows = function drawSemanticArrows(issue) {
  const svg = document.getElementById("arrows");
  if (!issue) { svg.innerHTML = ""; return; }
  const actualColor = semanticColor("--actual-board");
  const recommendedColor = semanticColor("--recommended-board");
  const actualUsi = actualMove(issue), recommendedUsi = bestMove(issue);
  const actual = usiCoords(actualUsi), recommended = usiCoords(recommendedUsi);
  const sfen = D.positions[Math.max(0, issue.ply - 1)].sfen;
  const actualPiece = window.ShogiReasonEvidence.moveCard({ sfen, move: actualUsi }).pieceJa;
  const recommendedPiece = window.ShogiReasonEvidence.moveCard({ sfen, move: recommendedUsi }).pieceJa;
  svg.innerHTML = `<defs><marker id="actualHead" markerUnits="userSpaceOnUse" markerWidth="45" markerHeight="45" refX="38" refY="22" orient="auto"><path d="M0,0 L0,44 L42,22 z" fill="${actualColor}"/></marker><marker id="recommendedHead" markerUnits="userSpaceOnUse" markerWidth="45" markerHeight="45" refX="38" refY="22" orient="auto"><path d="M0,0 L0,44 L42,22 z" fill="${recommendedColor}"/></marker></defs>${arrowLine(actual, actualColor, "actualHead")}${target(actual, actualColor, actualPiece)}${arrowLine(recommended, recommendedColor, "recommendedHead")}${target(recommended, recommendedColor, recommendedPiece)}`;
};

const legacyRender = render;
const reviewControls = document.querySelector(".controls");
if (reviewControls && !reviewControls.querySelector(".nextIssueCompact")) {
  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.className = "nextIssueCompact";
  nextButton.textContent = "⚠ 次課題";
  nextButton.setAttribute("aria-label", "次の課題局面へ");
  nextButton.addEventListener("click", nextIssue);
  reviewControls.appendChild(nextButton);
}

function scoreLabel(score) {
  if (!score) return "評価値なし";
  const value = Number(score.value || 0);
  if (score.type === "mate") return `${value < 0 ? "相手に" : "自分に"}${Math.abs(value)}手の詰み`;
  return `${value >= 0 ? "+" : ""}${value}`;
}

function appendText(parent, tag, text, className = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function appendChoice(parent, role, model, kind) {
  const choice = document.createElement("div");
  choice.className = `choice ${kind}`;
  choice.setAttribute("aria-label", `${role}、${model.notation}`);
  appendText(choice, "span", role, "moveRole");
  appendText(choice, "span", model.notation, "choiceNotation");
  parent.appendChild(choice);
}

function reasonInput(issue, analysis, actual, best) {
  return {
    sfen: D.positions[Math.max(0, issue.ply - 1)].sfen,
    actualMove: actualMove(issue), bestMove: bestMove(issue),
    actualScore: analysis?.scoreAfterActual || null,
    recommendedScore: analysis?.bestScore || analysis?.scoreBefore || null,
    actualPV: analysis?.actualPv || [], recommendedPV: analysis?.pv || [],
    actualPVJa: analysis?.actualPvJa || [], recommendedPVJa: analysis?.pvJa || [],
    actualMoveJa: actual, bestMoveJa: best,
  };
}

function renderVerifiedIssue(issue) {
  const analysis = issueAnalysis(issue);
  const positionIndex = Math.max(0, issue.ply - 1);
  const position = parseSFEN(D.positions[positionIndex].sfen);
  const mover = issue.ply % 2 ? "b" : "w";
  const previous = previousDestination(issue.ply);
  const actual = analysis?.playedJa || formatMove(actualMove(issue), position, mover, previous);
  const best = analysis?.bestJa || formatMove(bestMove(issue), position, mover, previous);
  const evidence = window.ShogiReasonEvidence.generateReasonEvidence(reasonInput(issue, analysis, actual, best));
  const card = document.createElement("div");
  card.className = "card warn";
  appendText(card, "span", `Level ${evidence.level}`, "reasonLevel");
  appendText(card, "h2", "⚠ 現在の課題");

  const legend = document.createElement("div");
  legend.className = "legend";
  appendText(legend, "span", "赤＝実戦手の駒", "actualSemantic");
  legend.appendChild(document.createTextNode("　"));
  appendText(legend, "span", "青＝推奨手の駒", "recommendedSemantic");
  card.appendChild(legend);

  const compare = document.createElement("div");
  compare.className = "compare";
  appendChoice(compare, "実戦", evidence.actualCard, "bad");
  appendChoice(compare, "推奨", evidence.recommendedCard, "good");
  card.appendChild(compare);

  const before = analysis?.bestScore || analysis?.scoreBefore;
  const after = analysis?.scoreAfterActual;
  const evaluation = before && after ? `保存評価 ${scoreLabel(after)} / 推奨枝 ${scoreLabel(before)}` : `評価値損失 約${analysis?.lossCp ?? issue.loss}点`;
  appendText(card, "div", evaluation, "loss");

  const reasonBlocks = document.createElement("div");
  reasonBlocks.className = "reasonBlocks";
  evidence.blocks.forEach((block) => {
    const line = document.createElement("div");
    line.className = "reasonBlock";
    appendText(line, "b", `【${block.title}】`);
    line.appendChild(document.createTextNode(block.text));
    reasonBlocks.appendChild(line);
  });
  card.appendChild(reasonBlocks);

  const bestPv = (analysis?.pvJa || []).slice(0, 6);
  const actualPv = (analysis?.actualPvJa || []).slice(0, 6);
  if (bestPv.length || actualPv.length) {
    const details = document.createElement("details");
    details.className = "pvDetails";
    appendText(details, "summary", "読み筋を見る");
    if (actualPv.length) appendText(details, "div", `実戦手なら　${actualPv.join(" → ")}`, "pvBranch actual");
    if (bestPv.length) appendText(details, "div", `推奨手なら　${bestPv.join(" → ")}`, "pvBranch recommended");
    card.appendChild(details);
  }
  review.replaceChildren(card);
}

function renderEvidenceReview() {
  legacyRender();
  const issue = D?.issues.find((item) => item.ply === ply);
  if (issue && window.ShogiReasonEvidence) renderVerifiedIssue(issue);
}

render = renderEvidenceReview;

window.addEventListener("load", async () => {
  const params = new URLSearchParams(location.search);
  const fixtureGame = params.get("game");
  const fixturePly = Number(params.get("ply"));
  if (!fixtureGame || !Number.isFinite(fixturePly)) return;
  await refreshCatalog();
  await loadGame(fixtureGame, true);
  ply = Math.max(0, Math.min(D.positions.length - 1, fixturePly));
  render();
});
