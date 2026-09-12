import { applyUnknownConfirmations, fingerprintKif, MAX_KIF_BYTES } from "../../../kif-submit-core.mjs";
import { canTransition } from "./state.mjs";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const SAFE_ERROR = "解析処理に失敗しました。Windows workerのログを確認してください。";

function response(body, status = 200, origin = "") {
  const headers = { ...JSON_HEADERS };
  if (origin) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-headers"] = "authorization, content-type";
    headers["access-control-allow-methods"] = "GET, POST, OPTIONS";
    headers.vary = "Origin";
  }
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("origin") || "";
  if (!origin) return "";
  const allowed = String(env.ALLOWED_ORIGINS || "https://perusonao.github.io")
    .split(",").map((value) => value.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

async function hash(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

async function authorized(request, expectedHash) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ") || !expectedHash) return false;
  return constantTimeEqual(await hash(header.slice(7)), String(expectedHash).toLowerCase());
}

async function bodyJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_KIF_BYTES + 8192) throw new Error("request too large");
  return request.json();
}

function publicRequest(row, duplicate = false) {
  return {
    requestId: row.request_id,
    fingerprint: row.fingerprint,
    createdAt: row.created_at,
    status: row.status,
    metadata: JSON.parse(row.metadata_json),
    gameId: row.game_id || null,
    error: row.error_message || null,
    duplicate,
  };
}

async function getRequest(env, requestId) {
  return env.QUEUE_DB.prepare("SELECT * FROM analysis_requests WHERE request_id = ?")
    .bind(requestId).first();
}

async function submit(request, env, origin) {
  let input;
  try { input = await bodyJson(request); } catch { return response({ error: "送信データが不正です" }, 400, origin); }
  if (typeof input.kif !== "string") return response({ error: "KIF本文がありません" }, 400, origin);
  let parsed;
  let fingerprint;
  try {
    ({ parsed, fingerprint } = await fingerprintKif(input.kif));
  } catch (error) {
    return response({ error: error.message || "KIFが不正です" }, 400, origin);
  }
  if (input.fingerprint && input.fingerprint !== fingerprint) return response({ error: "fingerprintが一致しません" }, 400, origin);
  const resolved = applyUnknownConfirmations(parsed.submissionMetadata, input.confirmations || {});
  if (resolved.unresolved.length) return response({ error: "不明な対局情報の確認が不足しています" }, 400, origin);
  const existing = await env.QUEUE_DB.prepare("SELECT * FROM analysis_requests WHERE fingerprint = ?")
    .bind(fingerprint).first();
  if (existing) return response(publicRequest(existing, true), 200, origin);
  const now = new Date().toISOString();
  const requestId = crypto.randomUUID();
  const metadata = {
    date: parsed.date,
    startedAt: parsed.startedAt,
    sente: parsed.sente,
    gote: parsed.gote,
    moves: parsed.moves,
    result: parsed.result,
    calibration: resolved.metadata,
  };
  try {
    await env.QUEUE_DB.prepare(
      "INSERT INTO analysis_requests (request_id, fingerprint, created_at, updated_at, status, kif, metadata_json) VALUES (?, ?, ?, ?, 'queued', ?, ?)"
    ).bind(requestId, fingerprint, now, now, input.kif, JSON.stringify(metadata)).run();
  } catch {
    const raced = await env.QUEUE_DB.prepare("SELECT * FROM analysis_requests WHERE fingerprint = ?")
      .bind(fingerprint).first();
    if (raced) return response(publicRequest(raced, true), 200, origin);
    return response({ error: "依頼を保存できませんでした" }, 500, origin);
  }
  return response({ requestId, fingerprint, createdAt: now, status: "queued", metadata, gameId: null, error: null, duplicate: false }, 201, origin);
}

async function claim(env, origin) {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  const claimToken = crypto.randomUUID();
  const row = await env.QUEUE_DB.prepare(
    `UPDATE analysis_requests
       SET status = 'processing', updated_at = ?, claim_token = ?, lease_until = ?
     WHERE request_id = (
       SELECT request_id FROM analysis_requests
        WHERE status = 'queued' OR (status = 'processing' AND lease_until < ?)
        ORDER BY created_at LIMIT 1
     )
     RETURNING *`
  ).bind(now.toISOString(), claimToken, leaseUntil, now.toISOString()).first();
  if (!row) return response({ request: null }, 200, origin);
  return response({ request: { ...publicRequest(row), kif: row.kif, claimToken } }, 200, origin);
}

async function complete(request, env, requestId, origin) {
  let input;
  try { input = await bodyJson(request); } catch { return response({ error: "送信データが不正です" }, 400, origin); }
  if (!input.claimToken || !input.gameId) return response({ error: "完了情報が不足しています" }, 400, origin);
  const current = await getRequest(env, requestId);
  if (!current) return response({ error: "依頼がありません" }, 404, origin);
  if (!canTransition(current.status, "completed") || current.claim_token !== input.claimToken) return response({ error: "依頼状態が一致しません" }, 409, origin);
  const now = new Date().toISOString();
  await env.QUEUE_DB.prepare(
    "UPDATE analysis_requests SET status='completed', updated_at=?, game_id=?, error_message=NULL, claim_token=NULL, lease_until=NULL WHERE request_id=? AND claim_token=?"
  ).bind(now, String(input.gameId).slice(0, 160), requestId, input.claimToken).run();
  return response(publicRequest(await getRequest(env, requestId)), 200, origin);
}

async function fail(request, env, requestId, origin) {
  let input;
  try { input = await bodyJson(request); } catch { return response({ error: "送信データが不正です" }, 400, origin); }
  const current = await getRequest(env, requestId);
  if (!current) return response({ error: "依頼がありません" }, 404, origin);
  if (!canTransition(current.status, "failed") || current.claim_token !== input.claimToken) return response({ error: "依頼状態が一致しません" }, 409, origin);
  const message = typeof input.error === "string" && input.error.length <= 160 ? input.error : SAFE_ERROR;
  await env.QUEUE_DB.prepare(
    "UPDATE analysis_requests SET status='failed', updated_at=?, error_message=?, claim_token=NULL, lease_until=NULL WHERE request_id=? AND claim_token=?"
  ).bind(new Date().toISOString(), message, requestId, input.claimToken).run();
  return response(publicRequest(await getRequest(env, requestId)), 200, origin);
}

async function retry(env, requestId, origin) {
  const current = await getRequest(env, requestId);
  if (!current) return response({ error: "依頼がありません" }, 404, origin);
  if (!canTransition(current.status, "queued")) return response({ error: "再試行できる状態ではありません" }, 409, origin);
  await env.QUEUE_DB.prepare(
    "UPDATE analysis_requests SET status='queued', updated_at=?, error_message=NULL, claim_token=NULL, lease_until=NULL WHERE request_id=? AND status='failed'"
  ).bind(new Date().toISOString(), requestId).run();
  return response(publicRequest(await getRequest(env, requestId)), 200, origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = allowedOrigin(request, env);
    if (origin === null) return response({ error: "許可されていないOriginです" }, 403);
    if (request.method === "OPTIONS") return response({}, 204, origin);
    const workerRoute = url.pathname === "/api/worker/claim" || /\/api\/requests\/[^/]+\/(?:complete|fail)$/.test(url.pathname);
    const expectedHash = workerRoute ? env.WORKER_SECRET_HASH : env.SUBMIT_SECRET_HASH;
    if (!await authorized(request, expectedHash)) return response({ error: "認証に失敗しました" }, 401, origin);
    if (request.method === "POST" && url.pathname === "/api/requests") return submit(request, env, origin);
    if (request.method === "POST" && url.pathname === "/api/worker/claim") return claim(env, origin);
    const match = url.pathname.match(/^\/api\/requests\/([0-9a-f-]+)(?:\/(complete|fail|retry))?$/i);
    if (!match) return response({ error: "not found" }, 404, origin);
    const [, requestId, action] = match;
    if (request.method === "GET" && !action) {
      const row = await getRequest(env, requestId);
      return row ? response(publicRequest(row), 200, origin) : response({ error: "依頼がありません" }, 404, origin);
    }
    if (request.method === "POST" && action === "complete") return complete(request, env, requestId, origin);
    if (request.method === "POST" && action === "fail") return fail(request, env, requestId, origin);
    if (request.method === "POST" && action === "retry") return retry(env, requestId, origin);
    return response({ error: "method not allowed" }, 405, origin);
  },
};
