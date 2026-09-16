const test = require("node:test");
const assert = require("node:assert/strict");
const coaching = require("../coaching-focus.js");

function task(id, theme, title) {
  return { id, title: title || `${theme} task`, nextCheck: { theme }, sourceGame: "g", sourcePly: 10 };
}

function summary(rows, recurring = []) {
  return {
    themes: Object.entries(rows).map(([theme, statuses]) => ({
      theme,
      pass: statuses.filter((value) => value === "pass").length,
      fail: statuses.filter((value) => value === "fail").length,
      noOpportunity: statuses.filter((value) => value === "no_opportunity").length,
      evidenceRefs: statuses.map((status, index) => ({ gameId: `g${index}`, ply: index + 1, status })),
    })),
    recurringChallenges: recurring.map((theme) => ({ theme, kind: "recurring_challenge" })),
  };
}

test("tasks 0/1/2/3とlegacy recentSummaryを安全かつ決定論的に扱う", () => {
  assert.equal(coaching.selectCoachingFocus([], summary({})), null);
  const tasks = [task("a", "check"), task("b", "capture"), task("c", "drop")];
  assert.equal(coaching.selectCoachingFocus(tasks.slice(0, 1), null).task.id, "a");
  assert.equal(coaching.selectCoachingFocus(tasks.slice(0, 2), {}).task.id, "a");
  assert.equal(coaching.selectCoachingFocus(tasks, { themes: null }).task.id, "a");
  assert.equal(coaching.selectCoachingFocus(tasks, summary({})).task.id, "a");
});

test("recurring challengeを第一優先にしHuman Replayの駒打ち0/3を選ぶ", () => {
  const tasks = [task("capture", "capture"), task("check", "check"), task("drop", "drop", "駒打ちの候補を確認する")];
  const recent = summary({ capture: ["pass", "pass"], check: ["pass", "fail"], drop: ["fail", "fail", "fail"] }, ["drop"]);
  const focus = coaching.selectCoachingFocus(tasks, recent);
  assert.equal(focus.task.id, "drop");
  assert.equal(focus.basis, "recurring_challenge");
  assert.equal(focus.detail, "直近 0/3 — ×3回を複数局で確認");
});

test("－を成功/失敗件数に入れずmixedとonly－を扱う", () => {
  const recent = summary({ check: ["no_opportunity", "fail", "no_opportunity", "pass"], drop: ["no_opportunity"] });
  const checkStats = coaching.themeStats(recent, "check");
  assert.deepEqual({ pass: checkStats.pass, fail: checkStats.fail, comparable: checkStats.comparable },
    { pass: 1, fail: 1, comparable: 2 });
  const focus = coaching.selectCoachingFocus([task("drop", "drop")], recent);
  assert.equal(focus.stats.comparable, 0);
  assert.match(focus.detail, /比較できる○\/×はまだありません/);
});

test("recurringなしでは×連続/多数、latest ×、既存順の順で選ぶ", () => {
  const tasks = [task("pass", "check"), task("latest", "capture"), task("many", "drop")];
  assert.equal(coaching.selectCoachingFocus(tasks, summary({
    check: ["pass", "pass"], capture: ["pass", "fail"], drop: ["fail", "pass", "fail", "fail"],
  })).task.id, "many");
  assert.equal(coaching.selectCoachingFocus(tasks, summary({
    check: ["pass"], capture: ["fail"], drop: ["fail", "fail", "pass"],
  })).task.id, "many");
  assert.equal(coaching.selectCoachingFocus(tasks.slice(0, 2), summary({
    check: ["pass"], capture: ["pass", "fail"],
  })).task.id, "latest");
  assert.equal(coaching.selectCoachingFocus(tasks, summary({
    check: ["pass"], capture: ["pass"], drop: ["pass"],
  })).task.id, "pass");
});

test("tieはCurrent Tasks順で固定し同じ入力は同じ結果になる", () => {
  const tasks = [task("first", "check"), task("second", "capture")];
  const recent = summary({ check: ["fail"], capture: ["fail"] });
  assert.equal(coaching.selectCoachingFocus(tasks, recent).task.id, "first");
  assert.equal(coaching.selectCoachingFocus(tasks, recent).task.id, "first");
});

test("evidenceRefsあり/なしで壊れず、参照がある場合だけlatest ×を使う", () => {
  const tasks = [task("check", "check"), task("capture", "capture")];
  const recent = {
    themes: [
      { theme: "check", pass: 0, fail: 1 },
      { theme: "capture", pass: 1, fail: 1, evidenceRefs: [{ status: "pass" }, { status: "fail" }] },
    ],
    recurringChallenges: [],
  };
  assert.equal(coaching.selectCoachingFocus(tasks, recent).task.id, "capture");
});

test("routineは0/1/2/3 tasks、既存順、同義theme重複を安全に扱う", () => {
  assert.equal(coaching.buildNextGameRoutine([]), null);
  assert.equal(coaching.buildNextGameRoutine([task("a", "capture")]), "指す前に確認: 取れる駒");
  assert.equal(coaching.buildNextGameRoutine([task("a", "capture"), task("b", "check")]),
    "指す前に確認: 取れる駒 → 王手");
  assert.equal(coaching.buildNextGameRoutine([
    task("a", "capture"), task("b", "check"), task("c", "drop"), task("ignored", "promotion"),
  ]), "指す前に確認: 取れる駒 → 王手 → 駒打ち");
  assert.equal(coaching.buildNextGameRoutine([
    task("a", "drop", "駒打ち候補"), task("b", "drop", "持ち駒を打つ候補"), task("c", "check"),
  ]), "指す前に確認: 駒打ち → 王手");
});

test("theme欠落時は既存titleだけを使い新しい推測を追加しない", () => {
  const legacy = { id: "legacy", title: "終盤の確認", sourceGame: "g", sourcePly: 1 };
  assert.equal(coaching.buildNextGameRoutine([legacy]), "指す前に確認: 終盤の確認");
  assert.equal(coaching.selectCoachingFocus([legacy], null).task, legacy);
  assert.doesNotMatch(coaching.selectCoachingFocus([legacy], null).detail, /苦手|最弱/);
});

test("4 themeを固定の人間向け課題と次局行動へ変換する", () => {
  const expected = {
    check: ["王手になる手を見落とさない", "指す前に、王手になる手がないか確認する"],
    capture: ["取れる駒を見落とさない", "指す前に、取れる駒がないか確認する"],
    promotion: ["成れる場面で、成る手も比べる", "敵陣へ入る手では、成る手も候補に入れる"],
    drop: ["持ち駒を使う手を見落とさない", "指す前に、持ち駒から使える手がないか1回確認する"],
  };
  for (const [theme, [headline, action]] of Object.entries(expected)) {
    const current = task(theme, theme, `${theme} internal check`);
    assert.equal(coaching.humanTaskLabel(current), headline);
    assert.equal(coaching.nextGameAction(current), action);
    assert.deepEqual(coaching.buildHumanTaskView(current, null), {
      theme,
      headline,
      reason: "まだ十分な対局データがありません。現在の課題順を表示しています。",
      action,
      stats: coaching.themeStats(null, theme),
    });
  }
});

test("なぜこの課題は○のみ・×のみ・mixedを既存集計だけで説明し、－のみは安全fallback", () => {
  const cases = [
    [["pass", "pass"], "直近2回の対象機会で○2 / ×0です。"],
    [["fail", "fail"], "直近2回の対象機会で○0 / ×2です。"],
    [["pass", "no_opportunity", "fail"], "直近2回の対象機会で○1 / ×1です。"],
    [["no_opportunity"], "まだ十分な対局データがありません。現在の課題順を表示しています。"],
  ];
  for (const [statuses, expected] of cases) {
    assert.equal(coaching.buildHumanTaskView(task("drop", "drop"), summary({ drop: statuses })).reason, expected);
  }
  assert.equal(coaching.buildHumanTaskView(task("drop", "drop"), summary({ drop: ["fail", "fail"] }, ["drop"])).reason,
    "直近2回の対象機会で○0 / ×2です。 複数局で×を確認しています。");
});

test("Human Replayの駒打ちfocusと3件routineを行動へ変換し入力を変更しない", () => {
  const tasks = [task("drop", "drop"), task("check", "check"), task("capture", "capture")];
  const before = structuredClone(tasks);
  const recent = summary({ drop: ["fail", "fail", "fail"], check: ["fail"], capture: ["pass"] }, ["drop"]);
  const focus = coaching.selectCoachingFocus(tasks, recent);
  const view = coaching.buildHumanTaskView(focus.task, recent);
  assert.equal(view.headline, "持ち駒を使う手を見落とさない");
  assert.equal(view.reason, "直近3回の対象機会で○0 / ×3です。 複数局で×を確認しています。");
  assert.equal(view.action, "指す前に、持ち駒から使える手がないか1回確認する");
  assert.deepEqual(coaching.buildRoutineActions(tasks), [
    "指す前に、持ち駒から使える手がないか1回確認する",
    "指す前に、王手になる手がないか確認する",
    "指す前に、取れる駒がないか確認する",
  ]);
  assert.deepEqual(tasks, before);
});

test("legacy/missing fieldsとlong Japanese textを安全に表示する", () => {
  const title = "終盤で候補手を比較してから着手するという非常に長い既存課題名";
  const legacy = { id: "legacy", title };
  const view = coaching.buildHumanTaskView(legacy, null);
  assert.equal(view.headline, title);
  assert.equal(view.action, `指す前に「${title}」を1回確認する`);
  assert.match(view.reason, /十分な対局データ/);
  assert.equal(coaching.buildHumanTaskView({}, null).headline, "現在の課題");
});
