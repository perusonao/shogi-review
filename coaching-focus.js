(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ShogiCoachingFocus = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const THEMES = ["check", "capture", "promotion", "drop"];
  const ROUTINE_LABELS = { check: "王手", capture: "取れる駒", promotion: "成る手", drop: "駒打ち" };

  function inferredTheme(title) {
    if (typeof title !== "string") return null;
    if (title.includes("王手")) return "check";
    if (/取れる駒|駒取り|駒を取/.test(title)) return "capture";
    if (/成る手|成り/.test(title)) return "promotion";
    if (/駒打ち|持ち駒.*打/.test(title)) return "drop";
    return null;
  }

  function taskTheme(task) {
    const theme = task?.nextCheck?.theme;
    if (THEMES.includes(theme)) return theme;
    if (THEMES.includes(task?.theme)) return task.theme;
    return inferredTheme(task?.title);
  }

  function validCount(value) {
    return Number.isInteger(value) && value >= 0 ? value : 0;
  }

  function themeStats(summary, theme) {
    const row = (Array.isArray(summary?.themes) ? summary.themes : []).find((item) => item?.theme === theme);
    const pass = validCount(row?.pass);
    const fail = validCount(row?.fail);
    const refs = Array.isArray(row?.evidenceRefs) ? row.evidenceRefs : [];
    const comparable = refs.filter((ref) => ref?.status === "pass" || ref?.status === "fail");
    let failStreak = 0;
    for (let index = comparable.length - 1; index >= 0 && comparable[index].status === "fail"; index -= 1) {
      failStreak += 1;
    }
    const recurring = (Array.isArray(summary?.recurringChallenges) ? summary.recurringChallenges : [])
      .some((item) => item?.theme === theme && item?.kind === "recurring_challenge");
    return {
      pass,
      fail,
      comparable: pass + fail,
      failStreak,
      latestFail: comparable.at(-1)?.status === "fail",
      recurring,
    };
  }

  function reasonText(stats) {
    if (stats.recurring) return `直近 ${stats.pass}/${stats.comparable} — ×${stats.fail}回を複数局で確認`;
    if (stats.failStreak >= 2) return `直近 ${stats.pass}/${stats.comparable} — ×が${stats.failStreak}回連続`;
    if (stats.fail >= 2) return `直近 ${stats.pass}/${stats.comparable} — ×${stats.fail}回を確認`;
    if (stats.latestFail) return `直近 ${stats.pass}/${stats.comparable} — 最新判定は×`;
    if (stats.comparable) return `直近 ${stats.pass}/${stats.comparable} — ○/×の記録から選択`;
    return "比較できる○/×はまだありません — 現在の課題順から選択";
  }

  function selectCoachingFocus(currentTasks, recentSummary) {
    const candidates = (Array.isArray(currentTasks) ? currentTasks : []).slice(0, 3)
      .filter((task) => task && typeof task === "object")
      .map((task, index) => ({ task, theme: taskTheme(task), index, stats: themeStats(recentSummary, taskTheme(task)) }));
    if (!candidates.length) return null;
    candidates.sort((a, b) =>
      Number(b.stats.recurring) - Number(a.stats.recurring) ||
      Number(b.stats.failStreak >= 2 || b.stats.fail >= 2) -
        Number(a.stats.failStreak >= 2 || a.stats.fail >= 2) ||
      b.stats.failStreak - a.stats.failStreak ||
      b.stats.fail - a.stats.fail ||
      Number(b.stats.latestFail) - Number(a.stats.latestFail) ||
      a.index - b.index ||
      String(a.task.id || "").localeCompare(String(b.task.id || "")));
    const selected = candidates[0];
    return {
      task: selected.task,
      theme: selected.theme,
      originalIndex: selected.index,
      basis: selected.stats.recurring ? "recurring_challenge" :
        selected.stats.failStreak >= 2 || selected.stats.fail >= 2 ? "repeated_fail" :
          selected.stats.latestFail ? "latest_fail" : "current_task_order",
      stats: selected.stats,
      detail: reasonText(selected.stats),
    };
  }

  function normalizedLabel(value) {
    return String(value || "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
  }

  function routineLabel(task) {
    const theme = taskTheme(task);
    if (theme) return ROUTINE_LABELS[theme];
    return typeof task?.title === "string" ? task.title.trim() : "";
  }

  function buildNextGameRoutine(currentTasks) {
    const labels = [];
    const seen = new Set();
    for (const task of (Array.isArray(currentTasks) ? currentTasks : []).slice(0, 3)) {
      const label = routineLabel(task);
      const key = taskTheme(task) || normalizedLabel(label);
      if (!label || !key || seen.has(key)) continue;
      seen.add(key);
      labels.push(label);
    }
    return labels.length ? `指す前に確認: ${labels.join(" → ")}` : null;
  }

  return { ROUTINE_LABELS, buildNextGameRoutine, selectCoachingFocus, taskTheme, themeStats };
});
