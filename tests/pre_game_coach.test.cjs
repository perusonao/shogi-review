const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const coach = require("../pre-game-coach.js");

function task(id, theme, title = `${theme}を確認する`) {
  return { id, title, nextCheck: { theme }, sourceGame: "g", sourcePly: 20 };
}

function summary(recurringTheme = null) {
  return {
    themes: [
      { theme: "check", pass: 2, fail: 0, evidenceRefs: [{ status: "pass" }, { status: "pass" }] },
      { theme: "drop", pass: 0, fail: 2, evidenceRefs: [{ status: "fail" }, { status: "fail" }] },
    ],
    recurringChallenges: recurringTheme ? [{ theme: recurringTheme, kind: "recurring_challenge" }] : [],
  };
}

test("tasks 0/1/2/3件で既存focus/routineをそのまま再利用する", () => {
  assert.deepEqual(coach.buildModel([], null), {
    tasks: [], focus: null, focusView: null, routine: null, routineActions: [], empty: true,
  });
  const tasks = [task("check", "check"), task("capture", "capture"), task("drop", "drop")];
  assert.equal(coach.buildModel(tasks.slice(0, 1), summary()).routine, "指す前に確認: 王手");
  assert.equal(coach.buildModel(tasks.slice(0, 2), summary()).routine, "指す前に確認: 王手 → 取れる駒");
  const three = coach.buildModel(tasks, summary("drop"));
  assert.equal(three.focus.task, tasks[2]);
  assert.equal(three.focus.basis, "recurring_challenge");
  assert.equal(three.routine, "指す前に確認: 王手 → 取れる駒 → 駒打ち");
  assert.equal(three.focusView.headline, "持ち駒を使う手を見落とさない");
  assert.equal(three.focusView.reason, "直近2回の対象機会で○0 / ×2です。 複数局で×を確認しています。");
  assert.equal(three.focusView.action, "指す前に、持ち駒から使える手がないか1回確認する");
  assert.equal(three.routineActions.length, 3);
  assert.equal(three.empty, false);
});

test("recurringなし・long Japanese title・legacy/missing task dataでも安全", () => {
  const longTitle = "相手の王手候補と自分の玉の逃げ道を指す直前に必ず一度確認してから着手する";
  const original = task("long", "check", longTitle);
  const withoutRecurring = coach.buildModel([original], summary());
  assert.equal(withoutRecurring.focus.task.title, longTitle);
  assert.equal(withoutRecurring.routine, "指す前に確認: 王手");

  const legacy = { id: "legacy", title: "終盤の確認" };
  const legacyModel = coach.buildModel([null, legacy, "bad"], null);
  assert.deepEqual(legacyModel.tasks, [legacy]);
  assert.equal(legacyModel.focus.task, legacy);
  assert.equal(legacyModel.routine, "指す前に確認: 終盤の確認");
});

test("4件目を表示契約へ混ぜず入力やtaskResultsを変更しない", () => {
  const tasks = [task("a", "check"), task("b", "capture"), task("c", "drop"), task("d", "promotion")];
  const taskResults = [{ id: "result", status: "fail" }];
  const beforeTasks = structuredClone(tasks);
  const beforeResults = structuredClone(taskResults);
  assert.equal(coach.buildModel(tasks, summary()).tasks.length, 3);
  assert.deepEqual(tasks, beforeTasks);
  assert.deepEqual(taskResults, beforeResults);
});

test("ホーム上部のカード、2行routine、横overflow防止、主要CTA順、畳んだProgressを維持する", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const ui = fs.readFileSync(path.join(root, "pre-game-coach.js"), "utf8");
  const dashboard = fs.readFileSync(path.join(root, "growth-dashboard.js"), "utf8");
  const coachIndex = html.indexOf('id="preGameCoach"');
  const ctaIndex = html.indexOf('onclick="showView(\'submitView\')"');
  const dashboardIndex = html.indexOf('id="growthDashboard"');
  assert.ok(coachIndex >= 0 && coachIndex < ctaIndex && ctaIndex < dashboardIndex);
  assert.match(html, /coaching-focus\.js\?v=2/);
  assert.match(html, /pre-game-coach\.js\?v=3/);
  assert.match(html, /growth-dashboard\.js\?v=38/);
  assert.match(ui, /max-width:390px/);
  assert.match(ui, /overflow-wrap:anywhere/);
  assert.match(ui, /いま一番直したいこと/);
  assert.match(ui, /なぜこの課題？/);
  assert.match(ui, /次局でやること/);
  assert.match(ui, /次の解析で対局前の課題を作ります/);
  assert.doesNotMatch(ui, /taskResults|achievement|localStorage/);
  assert.match(dashboard, /details\.className = "growthProgress"/);
  assert.match(dashboard, /taskDetails\.className = "growthTaskDetails"/);
  assert.match(dashboard, /詳細な現在の課題/);
  assert.doesNotMatch(dashboard, /details\.open\s*=/);
  assert.doesNotMatch(dashboard, /taskDetails\.open\s*=/);
});
