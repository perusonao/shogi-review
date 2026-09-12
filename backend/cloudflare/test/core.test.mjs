import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { applyUnknownConfirmations, fingerprintKif, parseKifForSubmit, MAX_KIF_BYTES } from "../../../kif-submit-core.mjs";
import { canTransition } from "../src/state.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const higure = await readFile(resolve(root, "games/20260910_ひぐれ.kif"), "utf8");

test("ひぐれ戦を58手としてpreviewできる", () => {
  const parsed = parseKifForSubmit(higure);
  assert.equal(parsed.sente, "ひぐれ");
  assert.equal(parsed.gote, "ぺるそなお");
  assert.equal(parsed.moves, 58);
  assert.equal(parsed.result, "後手・ぺるそなお勝利");
  assert.equal(parsed.displayDate, "2026/09/10 20:09");
});

test("browser fingerprintはPythonの既存方式と一致する", async () => {
  const first = await fingerprintKif(higure);
  const duplicate = await fingerprintKif(`${higure}\n* duplicate submission comment\n`);
  assert.equal(first.fingerprint, "1b9da2c4eb55c214d426773d7ccbef4af0e5e3a1f1b4dec055d9ca896a73881c");
  assert.equal(duplicate.fingerprint, first.fingerprint);
});

test("invalid KIFとoversized KIFを拒否する", () => {
  assert.throws(() => parseKifForSubmit("先手：a\n後手：b"));
  assert.throws(() => parseKifForSubmit("x".repeat(MAX_KIF_BYTES + 1)), /128KB/);
});

test("shared metadata parserはUNKNOWNだけを確認し対局時rankを保持する", () => {
  const parsed = parseKifForSubmit(higure);
  assert.equal(parsed.submissionMetadata.timeControl, "10m-30s-byoyomi");
  assert.equal(parsed.submissionMetadata.gameStartedAt, "2026-09-10T20:09:10");
  const resolved = applyUnknownConfirmations(parsed.submissionMetadata, {
    provider: "shogi-wars", ranks: { sente: "2級", gote: "初段" },
  });
  assert.deepEqual(resolved.unresolved, []);
  assert.equal(resolved.metadata.players[0].officialRank.rankOrder, 8);
  assert.equal(resolved.metadata.players[0].officialRankSource, "user-confirmed");
});

test("XSS文字列はdataとして保持し、UIはtextContentを使う", async () => {
  const dangerous = higure.replace("先手：ひぐれ", "先手：<img src=x onerror=alert(1)>");
  assert.equal(parseKifForSubmit(dangerous).sente, "<img src=x onerror=alert(1)>");
  const ui = await readFile(resolve(root, "kif-submit-ui.mjs"), "utf8");
  assert.match(ui, /textContent/);
  assert.doesNotMatch(ui, /innerHTML/);
});

test("queue status transitionを制限する", () => {
  assert.equal(canTransition("queued", "processing"), true);
  assert.equal(canTransition("processing", "completed"), true);
  assert.equal(canTransition("processing", "failed"), true);
  assert.equal(canTransition("failed", "queued"), true);
  assert.equal(canTransition("queued", "completed"), false);
  assert.equal(canTransition("completed", "queued"), false);
});
