import { fingerprintKif } from "./kif-submit-core.mjs";

const STORAGE = {
  endpoint: "shogiReviewQueueEndpoint",
  secret: "shogiReviewQueueSecret",
  requests: "shogiReviewQueueRequests",
};
const POLL_MS = 45_000;
const elements = Object.fromEntries([
  "queueEndpoint", "queueSecret", "saveQueueSettings", "kifInput", "pasteKif", "submitKif",
  "kifValidation", "kifPreview", "previewGame", "previewDate", "previewMoves", "previewResult", "queueStatus",
].map((id) => [id, document.getElementById(id)]));

let parsedKif = null;
let currentFingerprint = "";
let validationSequence = 0;

function setText(element, value) { element.textContent = value; }
function setHidden(element, hidden, shownDisplay = "block") {
  element.hidden = hidden;
  element.style.display = hidden ? "none" : shownDisplay;
}
function loadRequests() {
  try { return JSON.parse(localStorage.getItem(STORAGE.requests) || "[]"); }
  catch { return []; }
}
function rememberRequest(requestId, endpoint) {
  const requests = loadRequests().filter((item) => item.requestId !== requestId);
  requests.unshift({ requestId, endpoint, savedAt: new Date().toISOString() });
  localStorage.setItem(STORAGE.requests, JSON.stringify(requests.slice(0, 10)));
}
function configured() {
  const endpoint = elements.queueEndpoint.value.trim().replace(/\/+$/, "");
  const secret = elements.queueSecret.value || localStorage.getItem(STORAGE.secret) || "";
  if (!endpoint.startsWith("https://")) throw new Error("backend URLはHTTPSで入力してください");
  if (secret.length < 16) throw new Error("個人用secretは16文字以上で入力してください");
  return { endpoint, secret };
}
async function api(endpoint, secret, path, options = {}) {
  const response = await fetch(endpoint + path, {
    ...options,
    cache: "no-store",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", ...(options.headers || {}) },
  });
  let body = {};
  try { body = await response.json(); } catch { /* use the safe generic error below */ }
  if (!response.ok) throw new Error(body.error || `backend error (${response.status})`);
  return body;
}
function renderPreview(parsed) {
  setText(elements.previewGame, `${parsed.sente} vs ${parsed.gote}`);
  setText(elements.previewDate, parsed.displayDate);
  setText(elements.previewMoves, `${parsed.moves}手`);
  setText(elements.previewResult, parsed.result);
  setHidden(elements.kifPreview, false, "grid");
}
async function validateInput() {
  const sequence = ++validationSequence;
  parsedKif = null;
  currentFingerprint = "";
  elements.submitKif.disabled = true;
  setHidden(elements.kifPreview, true);
  const kif = elements.kifInput.value;
  if (!kif.trim()) { setText(elements.kifValidation, "KIFを貼り付けてください"); return; }
  try {
    const result = await fingerprintKif(kif);
    if (sequence !== validationSequence) return;
    parsedKif = result.parsed;
    currentFingerprint = result.fingerprint;
    renderPreview(parsedKif);
    setText(elements.kifValidation, "送信前チェック OK");
    elements.submitKif.disabled = false;
  } catch (error) {
    if (sequence === validationSequence) setText(elements.kifValidation, error.message || "KIFが不正です");
  }
}
function statusButton(label, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "primary queueAction";
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}
function statusContent(item, endpoint, secret) {
  const box = document.createElement("div");
  const heading = document.createElement("b");
  const detail = document.createElement("div");
  detail.className = "sub";
  const labels = { queued: "解析待ち", processing: "解析中", completed: "解析完了", failed: "解析失敗" };
  heading.textContent = item.duplicate && item.status === "completed" ? "解析済みです" : (labels[item.status] || item.status);
  detail.textContent = item.metadata ? `${item.metadata.sente} vs ${item.metadata.gote} / ${item.metadata.moves}手` : `request: ${item.requestId}`;
  box.append(heading, detail);
  if (item.status === "completed" && item.gameId) {
    box.append(statusButton("感想戦を開く", async () => {
      await window.refreshCatalog?.();
      await window.loadGame?.(item.gameId, true);
    }));
  } else if (item.status === "failed") {
    const error = document.createElement("div");
    error.className = "queueError";
    error.textContent = item.error || "安全のため詳細はWindows workerのログで確認してください";
    box.append(error, statusButton("再試行", async () => {
      try {
        const updated = await api(endpoint, secret, `/api/requests/${item.requestId}/retry`, { method: "POST", body: "{}" });
        renderQueueStatus(updated, endpoint, secret);
      } catch (retryError) { setText(elements.kifValidation, retryError.message); }
    }));
  }
  return box;
}
function renderQueueStatus(item, endpoint, secret) {
  elements.queueStatus.replaceChildren(statusContent(item, endpoint, secret));
  setHidden(elements.queueStatus, false);
}
async function pollLatestRequest() {
  const latest = loadRequests()[0];
  const secret = localStorage.getItem(STORAGE.secret) || "";
  if (!latest || !secret) return;
  try {
    renderQueueStatus(await api(latest.endpoint, secret, `/api/requests/${latest.requestId}`), latest.endpoint, secret);
  } catch (error) {
    setText(elements.queueStatus, `状態確認に失敗しました: ${error.message}`);
    setHidden(elements.queueStatus, false);
  }
}

elements.saveQueueSettings.addEventListener("click", () => {
  try {
    const settings = configured();
    localStorage.setItem(STORAGE.endpoint, settings.endpoint);
    localStorage.setItem(STORAGE.secret, settings.secret);
    elements.queueSecret.value = "";
    setText(elements.kifValidation, "接続設定をこのiPhoneに保存しました");
  } catch (error) { setText(elements.kifValidation, error.message); }
});
elements.pasteKif.addEventListener("click", async () => {
  try { elements.kifInput.value = await navigator.clipboard.readText(); await validateInput(); }
  catch { setText(elements.kifValidation, "クリップボードを読めませんでした。長押しで貼り付けてください"); }
});
elements.kifInput.addEventListener("input", validateInput);
elements.submitKif.addEventListener("click", async () => {
  if (!parsedKif || !currentFingerprint) return;
  try {
    const settings = configured();
    elements.submitKif.disabled = true;
    setText(elements.kifValidation, "送信中…");
    const item = await api(settings.endpoint, settings.secret, "/api/requests", {
      method: "POST",
      body: JSON.stringify({ kif: elements.kifInput.value, fingerprint: currentFingerprint }),
    });
    rememberRequest(item.requestId, settings.endpoint);
    renderQueueStatus(item, settings.endpoint, settings.secret);
    setText(elements.kifValidation, item.duplicate ? "同じ棋譜の既存依頼を表示しています" : "解析依頼を送信しました");
  } catch (error) { setText(elements.kifValidation, error.message || "送信に失敗しました"); }
  finally { elements.submitKif.disabled = !parsedKif; }
});

elements.queueEndpoint.value = localStorage.getItem(STORAGE.endpoint) || "";
setInterval(pollLatestRequest, POLL_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden) pollLatestRequest(); });
pollLatestRequest();
