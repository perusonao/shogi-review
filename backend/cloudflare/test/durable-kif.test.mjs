import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import worker from "../src/index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const kif = await readFile(resolve(root, "games/20260910_ひぐれ.kif"), "utf8");
const submitSecret = "submit-secret-for-tests";
const workerSecret = "worker-secret-for-tests";

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

class FakeStatement {
  constructor(db, sql) { this.db = db; this.sql = sql.replace(/\s+/g, " ").trim(); this.values = []; }
  bind(...values) { this.values = values; return this; }
  first() { return this.db.first(this.sql, this.values); }
  run() { return this.db.run(this.sql, this.values); }
}

class FakeD1 {
  constructor({ failInsert = false } = {}) { this.rows = []; this.failInsert = failInsert; }
  prepare(sql) { return new FakeStatement(this, sql); }
  clone(row) { return row ? { ...row } : null; }

  async first(sql, values) {
    if (sql.startsWith("SELECT * FROM analysis_requests WHERE request_id = ?")) {
      return this.clone(this.rows.find((row) => row.request_id === values[0]));
    }
    if (sql.startsWith("SELECT * FROM analysis_requests WHERE fingerprint = ?")) {
      return this.clone(this.rows.find((row) => row.fingerprint === values[0]));
    }
    if (sql.startsWith("UPDATE analysis_requests SET status = 'processing'")) {
      const [updatedAt, claimToken, leaseUntil, expiredBefore] = values;
      const row = this.rows
        .filter((candidate) => candidate.kif && (candidate.status === "queued" ||
          (candidate.status === "processing" && candidate.lease_until < expiredBefore)))
        .sort((left, right) => left.created_at.localeCompare(right.created_at))[0];
      if (!row) return null;
      Object.assign(row, { status: "processing", updated_at: updatedAt, claim_token: claimToken, lease_until: leaseUntil });
      return this.clone(row);
    }
    throw new Error(`unsupported D1 first(): ${sql}`);
  }

  async run(sql, values) {
    if (sql.startsWith("INSERT INTO analysis_requests")) {
      if (this.failInsert) throw new Error("simulated D1 write failure");
      const [requestId, fingerprint, createdAt, updatedAt, sourceKif, metadataJson] = values;
      if (this.rows.some((row) => row.fingerprint === fingerprint)) throw new Error("UNIQUE constraint failed");
      this.rows.push({ request_id: requestId, fingerprint, created_at: createdAt, updated_at: updatedAt,
        status: "queued", kif: sourceKif, metadata_json: metadataJson, game_id: null,
        error_message: null, claim_token: null, lease_until: null });
      return { success: true };
    }
    if (sql.startsWith("UPDATE analysis_requests SET status='completed'")) {
      const [updatedAt, gameId, requestId, claimToken] = values;
      const row = this.rows.find((candidate) => candidate.request_id === requestId && candidate.claim_token === claimToken);
      if (row) Object.assign(row, { status: "completed", updated_at: updatedAt, game_id: gameId,
        error_message: null, claim_token: null, lease_until: null });
      return { success: true };
    }
    if (sql.startsWith("UPDATE analysis_requests SET status='failed'")) {
      const [updatedAt, message, requestId, claimToken] = values;
      const row = this.rows.find((candidate) => candidate.request_id === requestId && candidate.claim_token === claimToken);
      if (row) Object.assign(row, { status: "failed", updated_at: updatedAt, error_message: message,
        claim_token: null, lease_until: null });
      return { success: true };
    }
    if (sql.startsWith("UPDATE analysis_requests SET status='queued'")) {
      const [updatedAt, requestId] = values;
      const row = this.rows.find((candidate) => candidate.request_id === requestId && candidate.status === "failed");
      if (row) Object.assign(row, { status: "queued", updated_at: updatedAt, error_message: null,
        claim_token: null, lease_until: null });
      return { success: true };
    }
    throw new Error(`unsupported D1 run(): ${sql}`);
  }
}

async function environment(db = new FakeD1()) {
  return {
    QUEUE_DB: db,
    SUBMIT_SECRET_HASH: await sha256(submitSecret),
    WORKER_SECRET_HASH: await sha256(workerSecret),
  };
}

async function call(env, path, { secret = submitSecret, body, method = "POST" } = {}) {
  const headers = { authorization: `Bearer ${secret}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await worker.fetch(new Request(`https://queue.example${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { response, body: await response.json() };
}

function submission() {
  return { kif, confirmations: { provider: "shogi-wars", ranks: { sente: "2級", gote: "初段" } } };
}

async function submitStored(env) {
  const created = await call(env, "/api/requests", { body: submission() });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.storageStatus, "stored");
  assert.equal(created.body.analysisStatus, "queued");
  assert.equal(created.body.status, "queued");
  assert.ok(created.body.sourceSavedAt);
  assert.equal("kif" in created.body, false);
  return created.body;
}

test("submit success acknowledges a readable durable KIF and preserves the legacy status field", async () => {
  const db = new FakeD1();
  const env = await environment(db);
  const created = await submitStored(env);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].kif, kif);

  const fetched = await call(env, `/api/requests/${created.requestId}`, { method: "GET" });
  assert.equal(fetched.body.storageStatus, "stored");
  assert.equal(fetched.body.analysisStatus, "queued");
  assert.equal(fetched.body.sourceSavedAt, created.sourceSavedAt);
  assert.equal("kif" in fetched.body, false);
});

for (const stage of ["worker", "engine", "publish"]) {
  test(`${stage} failure keeps one source and retries the same request idempotently`, async () => {
    const db = new FakeD1();
    const env = await environment(db);
    const created = await submitStored(env);

    const claimed = await call(env, "/api/worker/claim", { secret: workerSecret, body: {} });
    assert.equal(claimed.body.request.requestId, created.requestId);
    assert.equal(claimed.body.request.kif, kif);
    assert.equal(claimed.body.request.analysisStatus, "processing");

    const failed = await call(env, `/api/requests/${created.requestId}/fail`, {
      secret: workerSecret,
      body: { claimToken: claimed.body.request.claimToken, error: "Bearer must-not-be-exposed" },
    });
    assert.equal(failed.body.storageStatus, "stored");
    assert.equal(failed.body.analysisStatus, "failed");
    assert.match(failed.body.error, /原棋譜は保存済みです/);
    assert.doesNotMatch(failed.body.error, /must-not-be-exposed/);
    assert.equal(db.rows[0].kif, kif);

    const retried = await call(env, `/api/requests/${created.requestId}/retry`, { body: {} });
    assert.equal(retried.body.requestId, created.requestId);
    assert.equal(retried.body.fingerprint, created.fingerprint);
    assert.equal(retried.body.storageStatus, "stored");
    assert.equal(retried.body.analysisStatus, "queued");
    assert.equal(db.rows.length, 1);

    const reclaimed = await call(env, "/api/worker/claim", { secret: workerSecret, body: {} });
    assert.equal(reclaimed.body.request.requestId, created.requestId);
    assert.equal(reclaimed.body.request.kif, kif);
  });
}

test("retry completion and completed resubmit do not duplicate source, request, or game linkage", async () => {
  const db = new FakeD1();
  const env = await environment(db);
  const created = await submitStored(env);
  const claimed = await call(env, "/api/worker/claim", { secret: workerSecret, body: {} });
  const failed = await call(env, `/api/requests/${created.requestId}/fail`, {
    secret: workerSecret, body: { claimToken: claimed.body.request.claimToken },
  });
  assert.equal(failed.body.analysisStatus, "failed");
  await call(env, `/api/requests/${created.requestId}/retry`, { body: {} });
  const reclaimed = await call(env, "/api/worker/claim", { secret: workerSecret, body: {} });
  const completed = await call(env, `/api/requests/${created.requestId}/complete`, {
    secret: workerSecret, body: { claimToken: reclaimed.body.request.claimToken, gameId: "durable-game" },
  });
  assert.equal(completed.body.analysisStatus, "completed");
  assert.equal(completed.body.gameId, "durable-game");

  const duplicate = await call(env, "/api/requests", { body: submission() });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(duplicate.body.requestId, created.requestId);
  assert.equal(duplicate.body.gameId, "durable-game");
  assert.equal(db.rows.length, 1);
});

test("storage failure is not accepted as an analysis request", async () => {
  const db = new FakeD1({ failInsert: true });
  const result = await call(await environment(db), "/api/requests", { body: submission() });
  assert.equal(result.response.status, 500);
  assert.equal(result.body.storageStatus, "failed");
  assert.equal(result.body.analysisStatus, null);
  assert.match(result.body.error, /原棋譜を保存できません/);
  assert.equal(db.rows.length, 0);
});

test("requests without a stored KIF cannot be claimed or retried", async () => {
  const db = new FakeD1();
  const env = await environment(db);
  const created = await submitStored(env);
  Object.assign(db.rows[0], { status: "failed", kif: "", error_message: "legacy failure" });
  const retry = await call(env, `/api/requests/${created.requestId}/retry`, { body: {} });
  assert.equal(retry.response.status, 409);
  assert.equal(retry.body.storageStatus, "missing");
  assert.equal(retry.body.analysisStatus, "failed");
  const duplicate = await call(env, "/api/requests", { body: submission() });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.body.storageStatus, "missing");
  db.rows[0].status = "queued";
  const claim = await call(env, "/api/worker/claim", { secret: workerSecret, body: {} });
  assert.equal(claim.body.request, null);
});
