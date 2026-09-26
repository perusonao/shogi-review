(function (root, factory) {
  const commonJs = typeof module === "object" && module.exports;
  const api = factory(commonJs ? require("./coaching-focus.js") : root?.ShogiCoachingFocus);
  if (commonJs) module.exports = api;
  if (root) root.ShogiPreGameCoach = api;
})(typeof window !== "undefined" ? window : null, function (coachingApi) {
  "use strict";

  function buildModel(currentTasks, recentSummary) {
    const tasks = (Array.isArray(currentTasks) ? currentTasks : []).slice(0, 3)
      .filter((task) => task && typeof task === "object");
    const focus = coachingApi?.selectCoachingFocus(tasks, recentSummary) || null;
    return {
      tasks,
      focus,
      focusView: focus ? coachingApi?.buildHumanTaskView(focus.task, recentSummary) || null : null,
      routine: coachingApi?.buildNextGameRoutine(tasks) || null,
      routineActions: coachingApi?.buildRoutineActions(tasks) || [],
      empty: tasks.length === 0,
    };
  }

  return { buildModel };
});

if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = ".preGameCoach{margin:5px 0;padding:8px;border:1px solid #d0a15e;border-radius:8px;background:linear-gradient(135deg,#49331f,#2d2419);font-size:13px;overflow:hidden}.preGameCoach h2{margin:0 0 5px;color:#ffd590;font-size:10px;letter-spacing:.04em}.preGameLabel{display:block;color:#c8b99e;font-size:8px}.preGamePriority{display:block;margin-top:2px;color:#fff3df;font-size:20px;line-height:1.4;overflow-wrap:anywhere}.preGameReason,.preGameAction{margin:6px 0 0;padding-top:5px;border-top:1px solid #6d5437}.preGameReason p,.preGameAction p{margin:2px 0 0;line-height:1.4;overflow-wrap:anywhere}.preGameReason p{color:#d7c8b2}.preGameAction p{color:#c7ebc9;font-weight:700}.preGameRoutine{margin:6px 0 0;color:#f5d49c;font-size:9px;line-height:1.35;overflow-wrap:anywhere}.preGameEmpty{margin:2px 0;color:#d7c8b2;line-height:1.4}@media(max-width:390px){.preGameCoach{max-width:100%;padding:7px}.preGamePriority{font-size:19px}.preGameReason p{font-size:11px}.preGameAction p{font-size:15px}}";
  document.head.appendChild(style);

  function appendText(parent, tag, value, className) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value;
    parent.appendChild(element);
    return element;
  }

  window.renderPreGameCoach = function renderPreGameCoach(currentTasks, recentSummary, latestGameId) {
    const container = document.getElementById("preGameCoach");
    if (!container || !window.ShogiPreGameCoach) return;
    const model = window.ShogiPreGameCoach.buildModel(currentTasks, recentSummary);
    container.replaceChildren();
    appendText(container, "h2", "今日の課題");
    if (model.empty || !model.focus) {
      appendText(container, "p", "次の解析で対局前の課題を作ります", "preGameEmpty");
      return;
    }
    appendText(container, "span", "いま一番直したいこと", "preGameLabel");
    appendText(container, "strong", model.focusView?.headline || model.focus.task.title || "現在の課題", "preGamePriority");
    const action = document.createElement("div");
    action.className = "preGameAction";
    appendText(action, "span", "次局でやること", "preGameLabel");
    appendText(action, "p", model.focusView?.action || "指す前に、現在の課題を1回確認する");
    container.appendChild(action);
    if (model.routine) appendText(container, "p", `確認ルーティン　${model.routine.replace(/^指す前に確認:\s*/, "")}`, "preGameRoutine");
    const reason = document.createElement("div");
    reason.className = "preGameReason";
    appendText(reason, "span", "なぜこの課題？", "preGameLabel");
    appendText(reason, "p", model.focusView?.reason || "まだ十分な対局データがありません。");
    container.appendChild(reason);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "primary";
    const gameId = model.focus.task.sourceGame || latestGameId;
    const sourcePly = model.focus.task.sourcePly;
    button.textContent = "盤面を開く";
    button.disabled = !gameId;
    button.addEventListener("click", async () => {
      await window.loadGame?.(gameId, true);
      if (Number.isInteger(sourcePly)) window.jumpToSummaryPosition?.(sourcePly);
    });
    container.appendChild(button);
  };
}
