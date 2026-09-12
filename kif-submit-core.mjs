export const MAX_KIF_BYTES = 128 * 1024;
export const MAX_MOVES = 512;

const FULL_DIGITS = "１２３４５６７８９";
const RANKS = "一二三四五六七八九";
const PIECES = { 歩: "P", 香: "L", 桂: "N", 銀: "S", 金: "G", 角: "B", 飛: "R", 玉: "K", 王: "K" };
const LOSS_TERMINALS = new Set(["投了", "時間切れ", "切れ負け", "反則負け", "詰み"]);
const WIN_TERMINALS = new Set(["反則勝ち", "入玉勝ち", "宣言勝ち"]);
const DRAW_TERMINALS = new Set(["中断", "千日手", "持将棋"]);
export const UNKNOWN = "unknown";

function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

function digit(ch) {
  const full = FULL_DIGITS.indexOf(ch);
  return full >= 0 ? full + 1 : Number(ch);
}

function rank(ch) {
  const japanese = RANKS.indexOf(ch);
  return japanese >= 0 ? japanese + 1 : Number(ch);
}

function square(file, boardRank) {
  return `${file}${String.fromCharCode(96 + boardRank)}`;
}

function metadata(lines, key) {
  const prefix = `${key}：`;
  const line = lines.find((value) => value.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : "";
}

export function normalizeProvider(value) {
  const text = String(value || "").normalize("NFKC").trim().toLowerCase();
  if (["将棋ウォーズ", "shogi wars", "shogiwars", "shogi-wars"].includes(text)) return "shogi-wars";
  return text ? (text.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || null) : null;
}

export function normalizeOfficialRank(value) {
  const text = String(value || "").normalize("NFKC").trim();
  const match = text.match(/^(\d+|[初一二三四五六七八九十])(級|段)$/u);
  if (!match) return null;
  const kanji = { 初: 1, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const number = /^\d+$/.test(match[1]) ? Number(match[1]) : kanji[match[1]];
  if ((match[2] === "級" && (number < 1 || number > 10)) || (match[2] === "段" && number < 1)) return null;
  return { rankType: match[2] === "級" ? "kyu" : "dan", rankNumber: number,
    rankOrder: match[2] === "級" ? 10 - number : 9 + number,
    label: match[2] === "級" ? `${number}級` : (number === 1 ? "初段" : `${number}段`) };
}

export function normalizeTimeControl(value) {
  const raw = String(value || "").normalize("NFKC").trim();
  if (/^\d+m-sudden-death$/.test(raw) || /^\d+m-\d+s-byoyomi$/.test(raw) || /^\d+s-per-move$/.test(raw)) return { id: raw, raw, status: "available" };
  let match = raw.match(/^(\d+)分切れ負け$/u);
  if (match) return { id: `${Number(match[1])}m-sudden-death`, raw, status: "available" };
  match = raw.match(/^(\d+)分\+(\d+)秒$/u);
  if (match) return { id: `${Number(match[1])}m-${Number(match[2])}s-byoyomi`, raw, status: "available" };
  match = raw.match(/^(\d+)秒$/u);
  if (match) return { id: `${Number(match[1])}s-per-move`, raw, status: "available" };
  return raw ? { id: "other", raw, status: "unavailable-normalization" } : null;
}

function sideResult(result, side) {
  if (["千日手", "持将棋", "中断"].some((value) => result.includes(value))) return "draw";
  const winner = result.startsWith("先手・") ? "sente" : result.startsWith("後手・") ? "gote" : null;
  return winner ? (winner === side ? "win" : "loss") : UNKNOWN;
}

function canonicalStart(dateMatch) {
  const time = `${String(dateMatch[4] || 0).padStart(2, "0")}:${String(dateMatch[5] || 0).padStart(2, "0")}:${String(dateMatch[6] || 0).padStart(2, "0")}`;
  return `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}T${time}`;
}

function canonicalMove(moveText, previousTo) {
  let targetFile;
  let targetRank;
  let rest;
  const normal = moveText.match(/^([1-9１-９])([一二三四五六七八九1-9])(.+)$/u);
  if (normal) {
    targetFile = digit(normal[1]);
    targetRank = rank(normal[2]);
    rest = normal[3];
  } else {
    const same = moveText.match(/^同[　 ]*(.+)$/u);
    if (!same || !previousTo) throw new Error(`指し手を解釈できません: ${moveText}`);
    targetFile = Number(previousTo[0]);
    targetRank = previousTo.charCodeAt(1) - 96;
    rest = same[1];
  }
  const source = rest.match(/\(([1-9])([1-9])\)/u);
  const drop = rest.includes("打") && !source;
  if (drop) {
    const pieceName = rest.split("打", 1)[0];
    const piece = Object.entries(PIECES).find(([name]) => pieceName.startsWith(name));
    if (!piece) throw new Error(`打ち駒を解釈できません: ${moveText}`);
    return `${piece[1]}*${square(targetFile, targetRank)}`;
  }
  if (!source) throw new Error(`移動元がありません: ${moveText}`);
  const promote = rest.includes("成") && !rest.includes("不成") &&
    !["成銀", "成桂", "成香"].some((name) => rest.startsWith(name));
  return `${square(Number(source[1]), Number(source[2]))}${square(targetFile, targetRank)}${promote ? "+" : ""}`;
}

function resultFromTerminal(number, terminal, sente, gote) {
  if (DRAW_TERMINALS.has(terminal)) return terminal;
  const terminalSide = number % 2 === 1 ? "先手" : "後手";
  let winner;
  if (LOSS_TERMINALS.has(terminal)) winner = terminalSide === "先手" ? "後手" : "先手";
  else if (WIN_TERMINALS.has(terminal)) winner = terminalSide;
  else return "";
  return `${winner}・${winner === "先手" ? sente : gote}勝利`;
}

export function parseKifForSubmit(kif) {
  if (typeof kif !== "string") throw new Error("KIF本文がありません");
  if (kif.includes("\0")) throw new Error("KIFに使用できない文字があります");
  if (byteLength(kif) > MAX_KIF_BYTES) throw new Error("KIFが128KBを超えています");
  const lines = kif.replace(/\r\n?/g, "\n").split("\n");
  const startedAt = metadata(lines, "開始日時");
  const sente = metadata(lines, "先手");
  const gote = metadata(lines, "後手");
  if (!startedAt || !sente || !gote) throw new Error("開始日時・先手・後手が必要です");
  const dateMatch = startedAt.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/u);
  if (!dateMatch) throw new Error("開始日時の形式が不正です");
  const date = `${dateMatch[1]}/${dateMatch[2].padStart(2, "0")}/${dateMatch[3].padStart(2, "0")}`;
  const displayDate = `${date}${dateMatch[4] ? ` ${dateMatch[4].padStart(2, "0")}:${dateMatch[5]}` : ""}`;
  const moves = [];
  let previousTo = "";
  let terminalResult = "";
  let expected = 1;
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\s+(.+?)(?:\s+\(|$)/u);
    if (!match) continue;
    const number = Number(match[1]);
    const moveText = match[2].trim();
    if (LOSS_TERMINALS.has(moveText) || WIN_TERMINALS.has(moveText) || DRAW_TERMINALS.has(moveText)) {
      if (number !== expected) throw new Error("終局手数が連続していません");
      terminalResult = resultFromTerminal(number, moveText, sente, gote);
      break;
    }
    if (number !== expected) throw new Error("手数が1手目から連続していません");
    const usi = canonicalMove(moveText, previousTo);
    moves.push(usi);
    previousTo = usi.replace("+", "").slice(-2);
    expected += 1;
    if (moves.length > MAX_MOVES) throw new Error("手数が上限を超えています");
  }
  if (!moves.length) throw new Error("指し手がありません");
  const footer = lines.map((line) => line.trim()).find((line) => /^まで\d+手で/.test(line));
  if (!terminalResult && footer) {
    if (footer.includes("先手の勝ち")) terminalResult = `先手・${sente}勝利`;
    else if (footer.includes("後手の勝ち")) terminalResult = `後手・${gote}勝利`;
    else if (footer.includes("千日手") || footer.includes("持将棋")) terminalResult = footer.replace(/^まで\d+手で/u, "");
  }
  if (!terminalResult) throw new Error("終局結果がありません");
  const footerMoves = footer && footer.match(/^まで(\d+)手で/u);
  if (footerMoves && Number(footerMoves[1]) !== moves.length) throw new Error("終局手数が一致しません");
  const providerRaw = metadata(lines, "場所");
  const timeControlRaw = metadata(lines, "持ち時間");
  const provider = normalizeProvider(providerRaw);
  const timeControl = normalizeTimeControl(timeControlRaw);
  const gameStartedAt = canonicalStart(dateMatch);
  return {
    date,
    displayDate,
    startedAt,
    sente,
    gote,
    moves: moves.length,
    result: terminalResult,
    canonicalMoves: moves,
    submissionMetadata: {
      schemaVersion: "pwa-kif-metadata-v1", provider, providerRaw: providerRaw || null,
      timeControl: timeControl?.id || null, timeControlRaw: timeControlRaw || null,
      gameStartedAt,
      players: [
        { username: sente, side: "sente", result: sideResult(terminalResult, "sente"), officialRankSource: metadata(lines, "先手段級") ? "kif" : "unknown",
          officialRankRaw: metadata(lines, "先手段級") || null,
          officialRank: normalizeOfficialRank(metadata(lines, "先手段級")) },
        { username: gote, side: "gote", result: sideResult(terminalResult, "gote"), officialRankSource: metadata(lines, "後手段級") ? "kif" : "unknown",
          officialRankRaw: metadata(lines, "後手段級") || null,
          officialRank: normalizeOfficialRank(metadata(lines, "後手段級")) },
      ],
    },
  };
}

export function applyUnknownConfirmations(parsedMetadata, confirmations = {}) {
  const output = structuredClone(parsedMetadata);
  if (!output.provider && confirmations.provider !== undefined) output.provider = confirmations.provider === UNKNOWN ? null : normalizeProvider(confirmations.provider);
  if (!output.timeControl && confirmations.timeControl !== undefined) output.timeControl = confirmations.timeControl === UNKNOWN ? null : normalizeTimeControl(confirmations.timeControl)?.id || null;
  output.players = output.players.map((player) => {
    const confirmed = confirmations.ranks?.[player.side];
    if (player.officialRank || confirmed === undefined) return player;
    return { ...player, officialRankSource: "user-confirmed", officialRankRaw: confirmed === UNKNOWN ? null : confirmed,
      officialRank: confirmed === UNKNOWN ? null : normalizeOfficialRank(confirmed) };
  });
  const unresolved = [];
  if (!parsedMetadata.provider && (confirmations.provider === undefined || (confirmations.provider !== UNKNOWN && !output.provider))) unresolved.push("provider");
  if (!parsedMetadata.timeControl && (confirmations.timeControl === undefined || (confirmations.timeControl !== UNKNOWN && !output.timeControl))) unresolved.push("timeControl");
  for (const player of parsedMetadata.players) {
    const confirmed = confirmations.ranks?.[player.side];
    const resolvedPlayer = output.players.find((item) => item.side === player.side);
    if (!player.officialRank && (confirmed === undefined || (confirmed !== UNKNOWN && !resolvedPlayer?.officialRank))) unresolved.push(`rank:${player.side}`);
  }
  return { metadata: output, unresolved };
}

export function canonicalFingerprintPayload(parsed) {
  return JSON.stringify([parsed.date, parsed.sente, parsed.gote, parsed.canonicalMoves]);
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function fingerprintKif(kif) {
  const parsed = parseKifForSubmit(kif);
  return { parsed, fingerprint: await sha256Hex(canonicalFingerprintPayload(parsed)) };
}
