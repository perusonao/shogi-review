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
    return {
      tasks,
      focus: coachingApi?.selectCoachingFocus(tasks, recentSummary) || null,
      routine: coachingApi?.buildNextGameRoutine(tasks) || null,
      empty: tasks.length === 0,
    };
  }

  return { buildModel };
});

if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = ".preGameCoach{margin:5px 0;padding:8px;border:1px solid #d0a15e;border-radius:8px;background:linear-gradient(135deg,#49331f,#2d2419);font-size:10px;overflow:hidden}.preGameCoach h2{margin:0 0 5px;color:#ffd590;font-size:10px;letter-spacing:.04em}.preGameLabel{display:block;color:#c8b99e;font-size:8px}.preGamePriority{display:block;margin-top:2px;color:#fff3df;font-size:13px;line-height:1.35;overflow-wrap:anywhere}.preGameRoutine{margin:6px 0 0;padding-top:5px;border-top:1px solid #6d5437;color:#c7ebc9;font-size:10px;line-height:1.35;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}.preGameEmpty{margin:2px 0;color:#d7c8b2;line-height:1.4}@media(max-width:390px){.preGameCoach{max-width:100%;padding:7px}.preGamePriority{font-size:12px}}";
  document.head.appendChild(style);

  function appendText(parent, tag, value, className) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value;
    parent.appendChild(element);
    return element;
  }

  window.renderPreGameCoach = function renderPreGameCoach(currentTasks, recentSummary) {
    const container = document.getElementById("preGameCoach");
    if (!container || !window.ShogiPreGameCoach) return;
    const model = window.ShogiPreGameCoach.buildModel(currentTasks, recentSummary);
    container.replaceChildren();
    appendText(container, "h2", "対局前コーチ");
    if (model.empty || !model.focus) {
      appendText(container, "p", "次の解析で対局前の課題を作ります", "preGameEmpty");
      return;
    }
    appendText(container, "span", "今日の最優先", "preGameLabel");
    appendText(container, "strong", model.focus.task.title || "現在の課題", "preGamePriority");
    if (model.routine) appendText(container, "p", model.routine, "preGameRoutine");
  };
}
