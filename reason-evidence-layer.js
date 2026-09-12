/* Shadow Reason Evidence Layer. No production UI imports this module. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ShogiReasonEvidenceLayer = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const PIECES = new Set(["P", "L", "N", "S", "G", "B", "R", "K", "+P", "+L", "+N", "+S", "+B", "+R"]);
  const HAND_PIECES = ["P", "L", "N", "S", "G", "B", "R"];
  const PROMOTABLE = new Set(["P", "L", "N", "S", "B", "R"]);
  const PIECE_LIMITS = { P: 18, L: 4, N: 4, S: 4, G: 4, B: 2, R: 2, K: 2 };
  const PIECE_JA = { P: "歩", L: "香", N: "桂", S: "銀", G: "金", B: "角", R: "飛", K: "玉", "+P": "と", "+L": "成香", "+N": "成桂", "+S": "成銀", "+B": "馬", "+R": "龍" };
  const SIDE_JA = { b: "先手", w: "後手" };
  const RANK_JA = "一二三四五六七八九";
  const TACTICAL_TYPES = new Set(["MATE_ENDPOINT", "CHECK", "CHECK_SEQUENCE", "LEGAL_CAPTURE", "IMMEDIATE_RECAPTURE", "PROMOTION", "DROP", "CHECK_AND_CAPTURE"]);
  const POSITION_TYPES = new Set(["LEGAL_REPLY_COUNT", "LEGAL_CAPTURE_COUNT", "ATTACK_MAP", "DEFENDER_COUNT", "KING_ESCAPE_COUNT", "MOVED_PIECE_ATTACKERS"]);
  const PROOF_LEVELS = new Set(["HIGH", "MEDIUM", "LOW"]);
  const USABILITY_LEVELS = new Set(["PRIMARY", "SUPPORTING", "NOT_USABLE"]);

  function opposite(side) { return side === "b" ? "w" : "b"; }
  function square(file, rank) { return `${file}${String.fromCharCode(96 + rank)}`; }
  function coords(value) { return { file: Number(value[0]), rank: value.charCodeAt(1) - 96 }; }
  function unpromoted(piece) { return String(piece || "").replace(/^\+/, ""); }
  function clonePosition(position) {
    return {
      board: new Map(Array.from(position.board, ([key, piece]) => [key, { ...piece }])),
      turn: position.turn,
      hands: { b: { ...position.hands.b }, w: { ...position.hands.w } },
      move_number: position.move_number,
      sfen: position.sfen,
    };
  }

  function parseSfen(sfen) {
    const errors = [];
    if (typeof sfen !== "string") return { valid: false, errors: ["SFEN_NOT_STRING"], position: null };
    const parts = sfen.trim().split(/\s+/);
    if (parts.length !== 4) return { valid: false, errors: ["SFEN_FIELD_COUNT"], position: null };
    const [boardPart, turn, handPart, movePart] = parts;
    if (!/^[bw]$/.test(turn)) errors.push("SFEN_TURN");
    if (!/^[1-9]\d*$/.test(movePart)) errors.push("SFEN_MOVE_NUMBER");
    const rows = boardPart.split("/");
    if (rows.length !== 9) errors.push("SFEN_RANK_COUNT");
    const board = new Map();
    const totals = Object.fromEntries(Object.keys(PIECE_LIMITS).map((key) => [key, 0]));
    const kings = { b: 0, w: 0 };
    rows.forEach((row, rowIndex) => {
      let file = 9;
      let promoted = false;
      for (let index = 0; index < row.length; index += 1) {
        const token = row[index];
        if (/[1-9]/.test(token)) {
          if (promoted) errors.push("SFEN_PROMOTION_TOKEN");
          file -= Number(token);
          continue;
        }
        if (token === "+") {
          if (promoted) errors.push("SFEN_PROMOTION_TOKEN");
          promoted = true;
          continue;
        }
        if (!/[PLNSGBRKplnsgbrk]/.test(token)) {
          errors.push("SFEN_PIECE_TOKEN");
          promoted = false;
          continue;
        }
        const side = token === token.toUpperCase() ? "b" : "w";
        const base = token.toUpperCase();
        const piece = `${promoted ? "+" : ""}${base}`;
        if (!PIECES.has(piece) || (promoted && !PROMOTABLE.has(base))) errors.push("SFEN_PROMOTED_PIECE");
        if (file < 1 || file > 9) errors.push("SFEN_FILE_OVERFLOW");
        else board.set(square(file, rowIndex + 1), { side, piece, id: `initial:${side}:${file}${String.fromCharCode(97 + rowIndex)}:${base}` });
        totals[base] += 1;
        if (base === "K") kings[side] += 1;
        file -= 1;
        promoted = false;
      }
      if (promoted) errors.push("SFEN_PROMOTION_TOKEN");
      if (file !== 0) errors.push("SFEN_FILE_COUNT");
    });
    const hands = { b: {}, w: {} };
    if (handPart !== "-") {
      let count = "";
      for (const token of handPart) {
        if (/\d/.test(token)) { count += token; continue; }
        if (!/[PLNSGBRplnsgbr]/.test(token)) { errors.push("SFEN_HAND_TOKEN"); count = ""; continue; }
        const side = token === token.toUpperCase() ? "b" : "w";
        const piece = token.toUpperCase();
        const amount = Number(count || 1);
        if (!Number.isInteger(amount) || amount < 1) errors.push("SFEN_HAND_COUNT");
        hands[side][piece] = (hands[side][piece] || 0) + amount;
        totals[piece] += amount;
        count = "";
      }
      if (count) errors.push("SFEN_HAND_COUNT");
    }
    if (kings.b !== 1 || kings.w !== 1) errors.push("SFEN_KINGS");
    for (const [piece, limit] of Object.entries(PIECE_LIMITS)) if (totals[piece] > limit) errors.push(`SFEN_TOO_MANY_${piece}`);
    const position = { board, turn, hands, move_number: Number(movePart), sfen };
    return { valid: errors.length === 0, errors: [...new Set(errors)], position };
  }

  function parseUsi(usi) {
    if (typeof usi !== "string") return null;
    let match = usi.match(/^([PLNSGBR])\*([1-9][a-i])$/);
    if (match) return { usi, drop: true, piece: match[1], from: null, to: match[2], promote: false };
    match = usi.match(/^([1-9][a-i])([1-9][a-i])(\+)?$/);
    if (!match) return null;
    return { usi, drop: false, piece: null, from: match[1], to: match[2], promote: Boolean(match[3]) };
  }

  function clearPath(position, from, to) {
    const a = coords(from), b = coords(to);
    const df = Math.sign(b.file - a.file), dr = Math.sign(b.rank - a.rank);
    for (let file = a.file + df, rank = a.rank + dr; file !== b.file || rank !== b.rank; file += df, rank += dr) {
      if (position.board.has(square(file, rank))) return false;
    }
    return true;
  }

  function canReach(position, piece, from, to, side) {
    const a = coords(from), b = coords(to);
    const fileDelta = Math.abs(b.file - a.file);
    const rankDelta = b.rank - a.rank;
    const forward = side === "b" ? -rankDelta : rankDelta;
    if (!fileDelta && !rankDelta) return false;
    switch (piece) {
      case "P": return fileDelta === 0 && forward === 1;
      case "L": return fileDelta === 0 && forward > 0 && clearPath(position, from, to);
      case "N": return fileDelta === 1 && forward === 2;
      case "S": return (forward === 1 && fileDelta <= 1) || (forward === -1 && fileDelta === 1);
      case "G": case "+P": case "+L": case "+N": case "+S":
        return (forward === 1 && fileDelta <= 1) || (forward === 0 && fileDelta === 1) || (forward === -1 && fileDelta === 0);
      case "K": return fileDelta <= 1 && Math.abs(rankDelta) <= 1;
      case "B": return fileDelta === Math.abs(rankDelta) && clearPath(position, from, to);
      case "R": return (fileDelta === 0 || rankDelta === 0) && clearPath(position, from, to);
      case "+B": return (fileDelta === Math.abs(rankDelta) && clearPath(position, from, to)) || fileDelta + Math.abs(rankDelta) === 1;
      case "+R": return ((fileDelta === 0 || rankDelta === 0) && clearPath(position, from, to)) || (fileDelta === 1 && Math.abs(rankDelta) === 1);
      default: return false;
    }
  }

  function attackers(position, target, bySide) {
    const found = [];
    for (const [from, piece] of position.board) {
      if (piece.side === bySide && canReach(position, piece.piece, from, target, bySide)) found.push({ from, piece: piece.piece, piece_id: piece.id });
    }
    return found;
  }

  function kingSquare(position, side) {
    for (const [at, piece] of position.board) if (piece.side === side && piece.piece === "K") return at;
    return null;
  }

  function isInCheck(position, side) {
    const king = kingSquare(position, side);
    return Boolean(king && attackers(position, king, opposite(side)).length);
  }

  function inZone(side, rank) { return side === "b" ? rank <= 3 : rank >= 7; }
  function mandatoryPromotion(piece, side, rank) {
    return ((piece === "P" || piece === "L") && rank === (side === "b" ? 1 : 9)) || (piece === "N" && (side === "b" ? rank <= 2 : rank >= 8));
  }

  function applyMove(source, usi, options = {}) {
    const move = parseUsi(usi);
    const fail = (error) => ({ valid: false, error, position: clonePosition(source), move, event: null });
    if (!move) return fail("MOVE_SYNTAX");
    const position = clonePosition(source);
    const side = position.turn;
    let piece;
    let pieceId;
    let captured = null;
    if (move.drop) {
      piece = move.piece;
      if (position.board.has(move.to)) return fail("DROP_OCCUPIED");
      if (!(position.hands[side][piece] > 0)) return fail("DROP_NOT_IN_HAND");
      const rank = coords(move.to).rank;
      if (mandatoryPromotion(piece, side, rank)) return fail("DROP_DEAD_SQUARE");
      if (piece === "P" && Array.from(position.board.entries()).some(([at, value]) => coords(at).file === coords(move.to).file && value.side === side && value.piece === "P")) return fail("DROP_DOUBLE_PAWN");
      position.hands[side][piece] -= 1;
      pieceId = `drop:${side}:${piece}:${source.move_number}:${move.to}`;
    } else {
      const moving = position.board.get(move.from);
      if (!moving || moving.side !== side) return fail("MOVE_SOURCE_PIECE");
      piece = moving.piece;
      pieceId = moving.id;
      const target = position.board.get(move.to) || null;
      if (target?.side === side) return fail("MOVE_OWN_PIECE");
      if (target?.piece === "K") return fail("MOVE_CAPTURE_KING");
      if (!canReach(position, piece, move.from, move.to, side)) return fail("MOVE_GEOMETRY");
      const fromRank = coords(move.from).rank, toRank = coords(move.to).rank;
      if (move.promote) {
        if (!PROMOTABLE.has(piece) || (!inZone(side, fromRank) && !inZone(side, toRank))) return fail("MOVE_PROMOTION");
        piece = `+${piece}`;
      } else if (mandatoryPromotion(piece, side, toRank)) return fail("MOVE_MANDATORY_PROMOTION");
      captured = target;
      position.board.delete(move.from);
      if (captured) {
        const handPiece = unpromoted(captured.piece);
        position.hands[side][handPiece] = (position.hands[side][handPiece] || 0) + 1;
      }
    }
    position.board.set(move.to, { side, piece, id: pieceId });
    if (isInCheck(position, side)) return fail("MOVE_SELF_CHECK");
    const check = isInCheck(position, opposite(side));
    position.turn = opposite(side);
    position.move_number += 1;
    const event = { usi, side, piece, piece_id: pieceId, from: move.from, to: move.to, captured, check, promotion: move.promote, drop: move.drop };
    if (options.enforcePawnDropMate !== false && move.drop && piece === "P" && check && legalMoves(position, { enforcePawnDropMate: false }).length === 0) return fail("DROP_PAWN_MATE");
    return { valid: true, error: null, position, move, event };
  }

  function legalMoves(position, options = {}) {
    const candidates = [];
    for (const [from, value] of position.board) {
      if (value.side !== position.turn) continue;
      for (let rank = 1; rank <= 9; rank += 1) for (let file = 1; file <= 9; file += 1) {
        const to = square(file, rank);
        if (position.board.get(to)?.side === position.turn || position.board.get(to)?.piece === "K") continue;
        if (!canReach(position, value.piece, from, to, position.turn)) continue;
        const canPromote = PROMOTABLE.has(value.piece) && (inZone(position.turn, coords(from).rank) || inZone(position.turn, rank));
        if (!mandatoryPromotion(value.piece, position.turn, rank)) candidates.push(`${from}${to}`);
        if (canPromote) candidates.push(`${from}${to}+`);
      }
    }
    for (const piece of HAND_PIECES) if (position.hands[position.turn][piece] > 0) {
      for (let rank = 1; rank <= 9; rank += 1) for (let file = 1; file <= 9; file += 1) candidates.push(`${piece}*${square(file, rank)}`);
    }
    return candidates.filter((move) => applyMove(position, move, options).valid);
  }

  function replay(sfen, pv) {
    const parsed = parseSfen(sfen);
    if (!parsed.valid) return { valid: false, complete: false, errors: parsed.errors, events: [], final_position: null, failed_ply: 0 };
    let position = parsed.position;
    const events = [];
    for (let index = 0; index < (Array.isArray(pv) ? pv : []).length; index += 1) {
      const applied = applyMove(position, pv[index]);
      if (!applied.valid) return { valid: false, complete: false, errors: [applied.error], events, final_position: position, failed_ply: index + 1 };
      events.push({ ...applied.event, ply_distance: index + 1, position_before: position, position_after: applied.position });
      position = applied.position;
    }
    return { valid: true, complete: true, errors: [], events, final_position: position, failed_ply: null };
  }

  function usability(type, branch, event, context = {}) {
    if (POSITION_TYPES.has(type)) return type === "ATTACK_MAP" ? "SUPPORTING" : "NOT_USABLE";
    if (type === "MATE_ENDPOINT") return branch === "actual" && event.side !== context.mover || branch === "recommended" && event.side === context.mover ? "PRIMARY" : "SUPPORTING";
    if (type === "IMMEDIATE_RECAPTURE") return "SUPPORTING";
    if (type === "CHECK_SEQUENCE") return branch === "actual" && event.side !== context.mover && event.ply_distance <= 2 || branch === "recommended" && event.side === context.mover && event.ply_distance === 1 ? "PRIMARY" : "SUPPORTING";
    if (type === "CHECK_AND_CAPTURE") return (branch === "actual" && event.side !== context.mover || branch === "recommended" && event.side === context.mover) && event.ply_distance <= 3 ? "PRIMARY" : "SUPPORTING";
    if (type === "LEGAL_CAPTURE" && branch === "actual" && event.side !== context.mover && event.ply_distance <= 2 && event.captured?.piece !== "P") return "PRIMARY";
    return "SUPPORTING";
  }

  function evidenceBase(input, branch, type, event, extra = {}) {
    const category = TACTICAL_TYPES.has(type) ? "TACTICAL_FACT" : "POSITION_FACT";
    const target = event.captured || null;
    return {
      id: `${branch}:${type}:${event.ply_distance || 1}:${event.usi || event.to || "position"}${extra.target_square ? `:${extra.target_square}` : ""}`,
      category,
      type,
      branch,
      side: event.side || null,
      piece: event.piece || null,
      from: event.from || null,
      to: event.to || null,
      target_piece: target?.piece || null,
      target_square: extra.target_square || (target ? event.to : null),
      ply_distance: event.ply_distance || 1,
      proof_confidence: extra.proof_confidence || "HIGH",
      reason_usability: extra.reason_usability || usability(type, branch, event, { mover: input.mover }),
      proof: extra.proof || { method: "LEGAL_REPLAY", move_usi: event.usi || null, event: type },
      source_position: input.sfen,
      source_pv: [...input[`${branch}PV`]],
      ...extra.fields,
    };
  }

  function tacticalEvidence(input, branch, branchReplay) {
    const result = [];
    for (const event of branchReplay.events) {
      if (event.captured) result.push(evidenceBase(input, branch, "LEGAL_CAPTURE", event));
      if (event.check) result.push(evidenceBase(input, branch, "CHECK", event));
      if (event.check && event.captured) result.push(evidenceBase(input, branch, "CHECK_AND_CAPTURE", event));
      if (event.promotion) result.push(evidenceBase(input, branch, "PROMOTION", event));
      if (event.drop) result.push(evidenceBase(input, branch, "DROP", event));
    }
    for (let index = 1; index < branchReplay.events.length; index += 1) {
      const capture = branchReplay.events[index - 1], recapture = branchReplay.events[index];
      if (capture.captured && recapture.captured?.id === capture.piece_id && recapture.to === capture.to) {
        result.push(evidenceBase(input, branch, "IMMEDIATE_RECAPTURE", recapture, {
          fields: { captured_ply: capture.ply_distance, captured_piece: capture.piece, recaptured_piece: capture.piece, exchange_target_piece: capture.captured.piece, capturer_from: capture.from },
          proof: { method: "LEGAL_REPLAY", capture_move: capture.usi, recapture_move: recapture.usi, square: capture.to },
        }));
      }
    }
    for (const side of ["b", "w"]) {
      const checks = branchReplay.events.filter((event) => event.side === side && event.check);
      const runs = [];
      for (const event of checks) {
        const run = runs.at(-1);
        if (run && event.ply_distance === run.at(-1).ply_distance + 2) run.push(event);
        else runs.push([event]);
      }
      for (const run of runs.filter((items) => items.length >= 2)) result.push(evidenceBase(input, branch, "CHECK_SEQUENCE", run[0], {
        fields: { check_plies: run.map((event) => event.ply_distance), sequence_length: run.length },
        proof: { method: "LEGAL_REPLAY", check_moves: run.map((event) => event.usi), check_plies: run.map((event) => event.ply_distance) },
      }));
    }
    if (branchReplay.events.length && branchReplay.events.at(-1).check) {
      const replies = legalMoves(branchReplay.final_position);
      if (replies.length === 0) {
        const endpoint = branchReplay.events.at(-1);
        result.push(evidenceBase(input, branch, "MATE_ENDPOINT", endpoint, {
          fields: { mate_ply: endpoint.ply_distance, legal_reply_count: 0 },
          proof: { method: "COMPLETE_LEGAL_PV_ENDPOINT", terminal_move: endpoint.usi, terminal_check: true, legal_reply_count: 0 },
        }));
      }
    }
    return result;
  }

  function positionEvidence(input, branch, branchReplay) {
    if (!branchReplay.events.length) return [];
    const first = branchReplay.events[0];
    const position = first.position_after;
    const replies = legalMoves(position);
    const captures = replies.filter((move) => applyMove(position, move).event?.captured);
    const kingEscapes = replies.filter((move) => {
      const parsed = parseUsi(move);
      return !parsed.drop && position.board.get(parsed.from)?.piece === "K";
    });
    const moved = position.board.get(first.to);
    const friendlyDefenders = moved ? attackers(position, first.to, moved.side).filter((entry) => entry.piece_id !== moved.id) : [];
    const movedAttackers = moved ? attackers(position, first.to, opposite(moved.side)) : [];
    const attackedTargets = [];
    if (moved) for (const [at, target] of position.board) {
      if (target.side !== moved.side && target.piece !== "K" && canReach(position, moved.piece, first.to, at, moved.side)) attackedTargets.push({ square: at, piece: target.piece, piece_id: target.id });
    }
    const common = { ...first, ply_distance: 1 };
    const result = [
      evidenceBase(input, branch, "LEGAL_REPLY_COUNT", common, { fields: { count: replies.length }, proof: { method: "LEGAL_MOVE_ENUMERATION", count: replies.length } }),
      evidenceBase(input, branch, "LEGAL_CAPTURE_COUNT", common, { fields: { count: captures.length }, proof: { method: "LEGAL_MOVE_ENUMERATION", moves: captures } }),
      evidenceBase(input, branch, "DEFENDER_COUNT", common, { fields: { count: friendlyDefenders.length, defenders: friendlyDefenders }, proof: { method: "GEOMETRIC_ATTACK_MAP", count: friendlyDefenders.length } }),
      evidenceBase(input, branch, "KING_ESCAPE_COUNT", common, { fields: { count: kingEscapes.length, squares: kingEscapes.map((move) => parseUsi(move).to) }, proof: { method: "LEGAL_MOVE_ENUMERATION", moves: kingEscapes } }),
      evidenceBase(input, branch, "MOVED_PIECE_ATTACKERS", common, { fields: { count: movedAttackers.length, attackers: movedAttackers }, proof: { method: "GEOMETRIC_ATTACK_MAP", count: movedAttackers.length } }),
    ];
    for (const target of attackedTargets) result.push(evidenceBase(input, branch, "ATTACK_MAP", common, {
      target_square: target.square,
      fields: { target_piece: target.piece, target_piece_id: target.piece_id },
      proof: { method: "GEOMETRIC_ATTACK_MAP", attacker_square: first.to, target_square: target.square },
    }));
    return result;
  }

  function prepareInput(source) {
    const actualPV = Array.isArray(source.actualPV) ? [...source.actualPV] : [];
    const recommendedPV = Array.isArray(source.recommendedPV) ? [...source.recommendedPV] : [];
    if (!actualPV.length && source.actualMove) actualPV.push(source.actualMove);
    if (!recommendedPV.length && source.bestMove) recommendedPV.push(source.bestMove);
    return { sfen: source.sfen, actualMove: source.actualMove, bestMove: source.bestMove, actualPV, recommendedPV };
  }

  function sourceStatus(input, parsed, replays) {
    if (!parsed.valid) return { status: "INVALID", issues: parsed.errors };
    const issues = [];
    for (const branch of ["actual", "recommended"]) {
      const move = branch === "actual" ? input.actualMove : input.bestMove;
      const pv = input[`${branch}PV`];
      if (!move) issues.push(`${branch.toUpperCase()}_MOVE_MISSING`);
      if (pv.length && pv[0] !== move) issues.push(`${branch.toUpperCase()}_PV_FIRST_MOVE_MISMATCH`);
      const first = move ? applyMove(parsed.position, move) : { valid: false, error: "MOVE_MISSING" };
      if (!first.valid) issues.push(`${branch.toUpperCase()}_MOVE_${first.error}`);
      if (!replays[branch].valid) issues.push(`${branch.toUpperCase()}_PV_${replays[branch].errors[0]}_PLY_${replays[branch].failed_ply}`);
      if (!pv.length) issues.push(`${branch.toUpperCase()}_PV_MISSING`);
    }
    if (issues.some((issue) => /^(ACTUAL|RECOMMENDED)_MOVE_/.test(issue) && !issue.endsWith("_MISSING") || issue.includes("FIRST_MOVE_MISMATCH"))) return { status: "INVALID", issues };
    if (issues.length) return { status: "PARTIAL", issues };
    return { status: "VALID", issues: [] };
  }

  function semanticKey(item) {
    return [item.type, item.side, item.piece, item.from, item.to, item.target_piece, item.target_square, item.ply_distance].join("|");
  }

  function applySharedBranch(evidence, input) {
    if (input.actualMove !== input.bestMove || JSON.stringify(input.actualPV) !== JSON.stringify(input.recommendedPV)) return evidence;
    const seen = new Map();
    for (const item of evidence) {
      const key = semanticKey(item);
      if (!seen.has(key)) seen.set(key, { ...item, id: `shared:${item.id.split(":").slice(1).join(":")}`, branch: "shared", source_pv: [...input.actualPV] });
    }
    return [...seen.values()];
  }

  function applyComparativeUsability(evidence) {
    const actualHasPrimary = evidence.some((item) => item.branch === "actual" && item.reason_usability === "PRIMARY" && (item.type === "MATE_ENDPOINT" || item.type === "LEGAL_CAPTURE" || item.type === "CHECK_AND_CAPTURE"));
    return evidence.map((item) => {
      if (item.branch === "recommended" && item.type === "IMMEDIATE_RECAPTURE" && item.captured_ply === 2 && evidence.some((candidate) => candidate.branch === "recommended" && candidate.type === "ATTACK_MAP" && candidate.target_square === item.capturer_from)) return { ...item, reason_usability: "PRIMARY" };
      if (item.branch === "recommended" && item.type === "CHECK_AND_CAPTURE" && evidence.some((candidate) => candidate.branch === "recommended" && candidate.type === "IMMEDIATE_RECAPTURE" && candidate.captured_ply === item.ply_distance)) return { ...item, reason_usability: "SUPPORTING" };
      if (actualHasPrimary && item.branch === "recommended" && ((item.type === "CHECK" && item.ply_distance === 1) || item.type === "MATE_ENDPOINT")) return { ...item, reason_usability: "PRIMARY" };
      return item;
    });
  }

  function validateEvidence(inputSource, item) {
    const input = prepareInput(inputSource);
    if (!item || !TACTICAL_TYPES.has(item.type) && !POSITION_TYPES.has(item.type)) return { valid: false, errors: ["TYPE"] };
    const errors = [];
    if (!["actual", "recommended", "shared"].includes(item.branch)) errors.push("BRANCH");
    if (!PROOF_LEVELS.has(item.proof_confidence)) errors.push("PROOF_CONFIDENCE");
    if (!USABILITY_LEVELS.has(item.reason_usability)) errors.push("REASON_USABILITY");
    const parsed = parseSfen(item.source_position);
    if (!parsed.valid || item.source_position !== input.sfen) errors.push("SOURCE_POSITION");
    input.mover = parsed.position?.turn || null;
    const branch = item.branch === "shared" ? "actual" : item.branch;
    const pv = input[`${branch}PV`];
    if (JSON.stringify(item.source_pv) !== JSON.stringify(pv)) errors.push("SOURCE_PV");
    const branchReplay = replay(input.sfen, pv);
    if (!branchReplay.valid) errors.push("PV_REPLAY");
    const expected = branchReplay.events[item.ply_distance - 1];
    if (TACTICAL_TYPES.has(item.type) && item.type !== "CHECK_SEQUENCE" && item.type !== "MATE_ENDPOINT" && !expected) errors.push("PLY_DISTANCE");
    if (expected) {
      if (item.side !== expected.side) errors.push("SIDE");
      if (item.piece !== expected.piece) errors.push("PIECE");
      if (item.from !== expected.from || item.to !== expected.to) errors.push("SQUARE");
      if ((item.type === "LEGAL_CAPTURE" || item.type === "CHECK_AND_CAPTURE") && (!expected.captured || item.target_piece !== expected.captured.piece || item.target_square !== expected.to)) errors.push("CAPTURE");
      if ((item.type === "CHECK" || item.type === "CHECK_AND_CAPTURE") && !expected.check) errors.push("CHECK");
      if (item.type === "CHECK_AND_CAPTURE" && !expected.captured) errors.push("CAPTURE");
      if (item.type === "PROMOTION" && !expected.promotion) errors.push("PROMOTION");
      if (item.type === "DROP" && !expected.drop) errors.push("DROP");
    }
    if (item.type === "MATE_ENDPOINT") {
      const endpoint = branchReplay.events.at(-1);
      if (!endpoint?.check || endpoint.ply_distance !== item.ply_distance || legalMoves(branchReplay.final_position).length !== 0) errors.push("MATE_ENDPOINT");
    }
    if (item.type === "IMMEDIATE_RECAPTURE") {
      const recapture = expected, capture = branchReplay.events[item.captured_ply - 1];
      if (!capture?.captured || !recapture?.captured || recapture.captured.id !== capture.piece_id || recapture.to !== capture.to) errors.push("IMMEDIATE_RECAPTURE");
    }
    if (item.type === "CHECK_SEQUENCE") {
      const checks = (item.check_plies || []).map((ply) => branchReplay.events[ply - 1]);
      if (checks.length < 2 || checks.some((event, index) => !event?.check || event.side !== item.side || index && event.ply_distance !== checks[index - 1].ply_distance + 2)) errors.push("CHECK_SEQUENCE");
    }
    if (POSITION_TYPES.has(item.type) && branchReplay.events.length) {
      const position = branchReplay.events[0].position_after;
      const replies = legalMoves(position);
      const moved = position.board.get(branchReplay.events[0].to);
      const values = {
        LEGAL_REPLY_COUNT: replies.length,
        LEGAL_CAPTURE_COUNT: replies.filter((move) => applyMove(position, move).event?.captured).length,
        DEFENDER_COUNT: moved ? attackers(position, branchReplay.events[0].to, moved.side).filter((entry) => entry.piece_id !== moved.id).length : 0,
        KING_ESCAPE_COUNT: replies.filter((move) => { const parsedMove = parseUsi(move); return !parsedMove.drop && position.board.get(parsedMove.from)?.piece === "K"; }).length,
        MOVED_PIECE_ATTACKERS: moved ? attackers(position, branchReplay.events[0].to, opposite(moved.side)).length : 0,
      };
      if (item.type === "ATTACK_MAP") {
        const target = position.board.get(item.target_square);
        if (!moved || !target || target.side === moved.side || !canReach(position, moved.piece, branchReplay.events[0].to, item.target_square, moved.side) || target.piece !== item.target_piece) errors.push("ATTACK_MAP");
      } else if (item.count !== values[item.type]) errors.push(item.type);
    }
    return { valid: errors.length === 0, errors: [...new Set(errors)] };
  }

  function jaMove(item) {
    const mark = item.side === "b" ? "▲" : "△";
    const destination = item.to ? `${item.to[0]}${RANK_JA[coords(item.to).rank - 1]}` : "";
    return `${mark}${destination}${PIECE_JA[item.piece] || item.piece || "駒"}${item.type === "DROP" || item.from === null && item.piece !== "K" ? "打" : ""}`;
  }

  function candidateReason(bundle) {
    if (bundle.status === "INVALID") return { status: "UNRESOLVED", problem_reason: "UNRESOLVED", recommended_reason: "UNRESOLVED", q1_candidate: "×", q2_candidate: "×" };
    const primary = bundle.evidence.filter((item) => item.validation.valid && ["HIGH", "MEDIUM"].includes(item.proof_confidence) && item.reason_usability === "PRIMARY");
    const actual = primary.filter((item) => item.branch === "actual" || item.branch === "shared");
    const recommended = primary.filter((item) => item.branch === "recommended" || item.branch === "shared");
    const actualMate = actual.find((item) => item.type === "MATE_ENDPOINT");
    const recommendedMate = recommended.find((item) => item.type === "MATE_ENDPOINT");
    let problem = null, recommendation = null, recommendationKind = null;
    if (actualMate) problem = `実戦手の読み筋では${actualMate.ply_distance}plyで詰みまで到達します。`;
    if (recommendedMate) {
      recommendation = actualMate
        ? `推奨手の読み筋でも詰みは残りますが、保存された読み筋では${recommendedMate.ply_distance}plyで詰みまで到達します。`
        : `推奨手の読み筋では${recommendedMate.ply_distance}plyで詰みまで到達します。`;
      recommendationKind = "MATE_ENDPOINT";
    }
    if (!problem) {
      const capture = actual.find((item) => item.type === "LEGAL_CAPTURE");
      if (capture) problem = `実戦手の読み筋では${capture.ply_distance}ply目に${jaMove(capture)}が${capture.target_square[0]}${RANK_JA[coords(capture.target_square).rank - 1]}の${PIECE_JA[capture.target_piece]}を取ります。`;
    }
    if (!recommendation) {
      const sequence = recommended.find((item) => item.type === "CHECK_SEQUENCE");
      const check = recommended.find((item) => item.type === "CHECK");
      const checkCapture = recommended.find((item) => item.type === "CHECK_AND_CAPTURE");
      const recapture = recommended.find((item) => item.type === "IMMEDIATE_RECAPTURE");
      if (sequence) { recommendation = `推奨手の読み筋では、保存PVの${sequence.check_plies.join("・")}ply目に${SIDE_JA[sequence.side]}の王手が続きます。`; recommendationKind = "CHECK_SEQUENCE"; }
      else if (check) { recommendation = `推奨手は初手の${jaMove(check)}で王手になります。`; recommendationKind = "CHECK"; }
      else if (recapture) {
        const captureEvent = bundle.branches.recommended.events[recapture.captured_ply - 1];
        const first = bundle.branches.recommended.events[0];
        const attacked = bundle.evidence.find((item) => item.branch === "recommended" && item.type === "ATTACK_MAP" && item.to === first.to && item.target_square === captureEvent.from && item.target_piece === captureEvent.piece);
        recommendation = attacked
          ? `${jaMove(first)}は${attacked.target_square[0]}${RANK_JA[coords(attacked.target_square).rank - 1]}の${PIECE_JA[attacked.target_piece]}に当たり、保存PVでは${jaMove({ ...captureEvent, type: captureEvent.drop ? "DROP" : "LEGAL_CAPTURE" })}、${jaMove(recapture)}で、その${PIECE_JA[attacked.target_piece]}と${PIECE_JA[first.piece]}が盤上から消えます。`
          : `推奨手の読み筋では、${recapture.captured_ply}ply目に${captureEvent.to[0]}${RANK_JA[coords(captureEvent.to).rank - 1]}の${PIECE_JA[captureEvent.piece]}が${PIECE_JA[captureEvent.captured.piece]}を取り、${recapture.ply_distance}ply目に${jaMove(recapture)}がその駒を取り返します。`;
        recommendationKind = "IMMEDIATE_RECAPTURE";
      }
      else if (checkCapture) { recommendation = `推奨手の読み筋では${checkCapture.ply_distance}ply目の${jaMove(checkCapture)}が${PIECE_JA[checkCapture.target_piece]}を取りながら王手になります。`; recommendationKind = "CHECK_AND_CAPTURE"; }
    }
    return {
      status: problem || recommendation ? "RESOLVED" : "UNRESOLVED",
      problem_reason: problem || "UNRESOLVED",
      recommended_reason: recommendation || "UNRESOLVED",
      q1_candidate: problem ? (actualMate ? "○" : "△") : "×",
      q2_candidate: recommendation ? (recommendationKind === "MATE_ENDPOINT" || recommendationKind === "CHECK" && problem ? "○" : "△") : "×",
    };
  }

  function extractEvidence(source) {
    const input = prepareInput(source);
    const parsed = parseSfen(input.sfen);
    const emptyReplay = { valid: false, complete: false, errors: parsed.errors, events: [], final_position: null, failed_ply: 0 };
    const replays = parsed.valid ? { actual: replay(input.sfen, input.actualPV), recommended: replay(input.sfen, input.recommendedPV) } : { actual: emptyReplay, recommended: emptyReplay };
    const status = sourceStatus(input, parsed, replays);
    input.mover = parsed.position?.turn || null;
    let evidence = [];
    if (status.status !== "INVALID") for (const branch of ["actual", "recommended"]) {
      if (!replays[branch].events.length) continue;
      evidence.push(...tacticalEvidence(input, branch, replays[branch]), ...positionEvidence(input, branch, replays[branch]));
    }
    evidence = applyComparativeUsability(applySharedBranch(evidence, input)).map((item) => ({ ...item, validation: validateEvidence(input, item) }));
    const bundle = {
      schema: "reason-evidence-layer-v1",
      schema_version: 1,
      status: status.status,
      issues: status.issues,
      source: { sfen: input.sfen, actualMove: input.actualMove, bestMove: input.bestMove, actualPV: input.actualPV, recommendedPV: input.recommendedPV },
      evidence,
      branches: replays,
    };
    bundle.reason_candidate = candidateReason(bundle);
    return bundle;
  }

  function validateBundle(source, bundle) {
    const results = bundle.evidence.map((item) => ({ id: item.id, ...validateEvidence(source, item) }));
    return { valid: bundle.status !== "INVALID" && results.every((item) => item.valid), status: bundle.status, evidence: results };
  }

  return { parseSfen, parseUsi, applyMove, legalMoves, replay, attackers, isInCheck, extractEvidence, validateEvidence, validateBundle, candidateReason, PIECE_JA };
});
