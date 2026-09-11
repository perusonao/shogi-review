/* Evidence-only reason generation from saved SFEN, moves, scores and PVs. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ShogiReasonEvidence = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const PIECE_JA = { P: "歩", L: "香", N: "桂", S: "銀", G: "金", B: "角", R: "飛", K: "玉", "+P": "と", "+L": "杏", "+N": "圭", "+S": "全", "+B": "馬", "+R": "龍" };
  const RANK_JA = "一二三四五六七八九";
  const MATERIAL_KEYS = ["P", "L", "N", "S", "G", "B", "R"];

  function opposite(side) { return side === "b" ? "w" : "b"; }
  function square(file, rank) { return `${file},${rank}`; }
  function unpromoted(key) { return String(key || "").replace(/^\+/, ""); }

  function parseSfen(sfen) {
    const [boardPart, turn = "b", handPart = "-"] = String(sfen || "").split(" ");
    const board = new Map();
    (boardPart || "").split("/").forEach((row, rowIndex) => {
      let file = 9;
      let promoted = false;
      for (const token of row) {
        if (/\d/.test(token)) { file -= Number(token); continue; }
        if (token === "+") { promoted = true; continue; }
        const side = token === token.toUpperCase() ? "b" : "w";
        const key = `${promoted ? "+" : ""}${token.toUpperCase()}`;
        board.set(square(file, rowIndex + 1), { side, key });
        file -= 1;
        promoted = false;
      }
    });
    const hands = { b: {}, w: {} };
    if (handPart !== "-") {
      let count = "";
      for (const token of handPart) {
        if (/\d/.test(token)) { count += token; continue; }
        const side = token === token.toUpperCase() ? "b" : "w";
        const key = token.toUpperCase();
        hands[side][key] = (hands[side][key] || 0) + Number(count || 1);
        count = "";
      }
    }
    return { board, turn, hands };
  }

  function clonePosition(position) {
    return {
      board: new Map(Array.from(position.board, ([key, piece]) => [key, { ...piece }])),
      turn: position.turn,
      hands: { b: { ...position.hands.b }, w: { ...position.hands.w } },
    };
  }

  function parseUsi(usi) {
    if (typeof usi !== "string") return null;
    const drop = usi.match(/^([PLNSGBR])\*([1-9])([a-i])$/);
    if (drop) return { usi, drop: true, piece: drop[1], to: { file: Number(drop[2]), rank: drop[3].charCodeAt(0) - 96 }, promote: false };
    const move = usi.match(/^([1-9])([a-i])([1-9])([a-i])(\+)?$/);
    if (!move) return null;
    return {
      usi, drop: false,
      from: { file: Number(move[1]), rank: move[2].charCodeAt(0) - 96 },
      to: { file: Number(move[3]), rank: move[4].charCodeAt(0) - 96 },
      promote: Boolean(move[5]),
    };
  }

  function clearPath(position, from, to) {
    const fileStep = Math.sign(to.file - from.file);
    const rankStep = Math.sign(to.rank - from.rank);
    for (let file = from.file + fileStep, rank = from.rank + rankStep; file !== to.file || rank !== to.rank; file += fileStep, rank += rankStep) {
      if (position.board.has(square(file, rank))) return false;
    }
    return true;
  }

  function canReach(position, key, from, to, side) {
    const fileDelta = Math.abs(to.file - from.file);
    const rankDelta = to.rank - from.rank;
    const forward = side === "b" ? -rankDelta : rankDelta;
    if (!fileDelta && !rankDelta) return false;
    switch (key) {
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

  function isInCheck(position, side) {
    let king = null;
    for (const [coordinate, piece] of position.board) {
      if (piece.side === side && piece.key === "K") {
        const [file, rank] = coordinate.split(",").map(Number);
        king = { file, rank };
        break;
      }
    }
    if (!king) return false;
    for (const [coordinate, piece] of position.board) {
      if (piece.side === side) continue;
      const [file, rank] = coordinate.split(",").map(Number);
      if (canReach(position, piece.key, { file, rank }, king, piece.side)) return true;
    }
    return false;
  }

  function applyUsi(source, usi) {
    const position = clonePosition(source);
    const move = parseUsi(usi);
    if (!move) return { position, valid: false, move: null, captured: null, check: false };
    const side = position.turn;
    let key;
    let captured = null;
    if (move.drop) {
      key = move.piece;
      if (position.board.has(square(move.to.file, move.to.rank))) return { position, valid: false, move, captured, check: false };
      position.hands[side][key] = Math.max(0, Number(position.hands[side][key] || 0) - 1);
    } else {
      const originKey = square(move.from.file, move.from.rank);
      const piece = position.board.get(originKey);
      if (!piece || piece.side !== side) return { position, valid: false, move, captured, check: false };
      key = piece.key;
      captured = position.board.get(square(move.to.file, move.to.rank)) || null;
      if (captured?.side === side) return { position, valid: false, move, captured: null, check: false };
      position.board.delete(originKey);
      if (captured) {
        const handKey = unpromoted(captured.key);
        position.hands[side][handKey] = Number(position.hands[side][handKey] || 0) + 1;
      }
      if (move.promote && !key.startsWith("+")) key = `+${key}`;
    }
    position.board.set(square(move.to.file, move.to.rank), { side, key });
    const check = isInCheck(position, opposite(side));
    position.turn = opposite(side);
    return { position, valid: true, move, side, piece: key, captured, check };
  }

  function replayBranch(sfen, pv, jaMoves = []) {
    let position = parseSfen(sfen);
    const events = [];
    const material = { b: Object.fromEntries(MATERIAL_KEYS.map((key) => [key, 0])), w: Object.fromEntries(MATERIAL_KEYS.map((key) => [key, 0])) };
    for (let index = 0; index < (Array.isArray(pv) ? pv : []).length; index += 1) {
      const result = applyUsi(position, pv[index]);
      if (!result.valid) break;
      if (result.captured) material[result.side][unpromoted(result.captured.key)] += 1;
      events.push({
        pvPly: index + 1, moveUsi: pv[index], moveJa: jaMoves[index] || null,
        side: result.side, piece: unpromoted(result.piece), capture: result.captured ? unpromoted(result.captured.key) : null,
        check: result.check, drop: result.move.drop, promotion: result.move.promote,
      });
      position = result.position;
    }
    return { events, material, finalPosition: position, complete: events.length === (Array.isArray(pv) ? pv.length : 0) };
  }

  function scoreState(score) {
    if (!score || !["cp", "mate"].includes(score.type) || !Number.isFinite(Number(score.value))) return "unknown";
    if (score.type === "mate") return Number(score.value) < 0 ? "mate-against" : "mate-for";
    return "cp";
  }

  function materialDelta(branch, mover) {
    const foe = opposite(mover);
    return Object.fromEntries(MATERIAL_KEYS.map((key) => [key, branch.material[mover][key] - branch.material[foe][key]]));
  }

  function strictMaterialAdvantage(actual, recommended, mover) {
    if (!actual.events.length || actual.events.length !== recommended.events.length) return null;
    const left = materialDelta(actual, mover);
    const right = materialDelta(recommended, mover);
    if (!MATERIAL_KEYS.every((key) => right[key] >= left[key]) || !MATERIAL_KEYS.some((key) => right[key] > left[key])) return null;
    const gains = MATERIAL_KEYS.filter((key) => right[key] > left[key]).map((key) => ({ piece: key, count: right[key] - left[key] }));
    return { actual: left, recommended: right, gains };
  }

  function moveCard(input) {
    const position = parseSfen(input.sfen);
    const parsed = parseUsi(input.move);
    if (!parsed) return { piece: "?", pieceJa: "?", destination: "-", action: "-", notation: input.notation || "-", isDrop: false, isPromotion: false, isNonPromotion: false };
    const moving = parsed.drop ? { key: parsed.piece } : position.board.get(square(parsed.from.file, parsed.from.rank));
    const key = unpromoted(moving?.key || parsed.piece || "?");
    const canChoosePromotion = !parsed.drop && ["P", "L", "N", "S", "B", "R"].includes(key) && ((position.turn === "b" && (parsed.from.rank <= 3 || parsed.to.rank <= 3)) || (position.turn === "w" && (parsed.from.rank >= 7 || parsed.to.rank >= 7)));
    const mandatory = !parsed.drop && ((["P", "L"].includes(key) && (position.turn === "b" ? parsed.to.rank === 1 : parsed.to.rank === 9)) || (key === "N" && (position.turn === "b" ? parsed.to.rank <= 2 : parsed.to.rank >= 8)));
    const isNonPromotion = canChoosePromotion && !mandatory && !parsed.promote;
    const destination = `${parsed.to.file}${RANK_JA[parsed.to.rank - 1]}`;
    return {
      piece: key, pieceJa: PIECE_JA[key] || key, destination,
      action: parsed.drop ? `${destination}へ打つ` : parsed.promote ? `${destination}へ・成る` : isNonPromotion ? `${destination}へ・成らず` : `${destination}へ`,
      notation: input.notation || input.move, isDrop: parsed.drop, isPromotion: parsed.promote, isNonPromotion,
    };
  }

  function firstTactical(events) { return events.find((event) => event.check || event.capture) || null; }
  function typesFrom(actual, recommended, mateDifference, material, input) {
    const types = new Set();
    if (mateDifference) types.add("mate");
    const mover = actual.events[0]?.side || recommended.events[0]?.side;
    const actualReplyChecks = actual.events.filter((event) => event.side === opposite(mover) && event.check).length;
    if ((recommended.events[0]?.check && !actual.events[0]?.check) || (mateDifference && actualReplyChecks >= 2)) types.add("check");
    if ([...actual.events, ...recommended.events].some((event) => event.capture)) types.add("capture");
    if (parseUsi(input.actualMove)?.promote || parseUsi(input.bestMove)?.promote) types.add("promotion");
    if (parseUsi(input.bestMove)?.drop) types.add("drop");
    if (material) types.add("material");
    if (actual.events.slice(1, 3).some((event) => event.side !== actual.events[0]?.side && (event.check || event.capture))) types.add("immediate threat");
    return Array.from(types);
  }

  function generateReasonEvidence(input) {
    const actualPv = input.actualPV?.length ? input.actualPV : (input.actualMove ? [input.actualMove] : []);
    const recommendedPv = input.recommendedPV?.length ? input.recommendedPV : (input.bestMove ? [input.bestMove] : []);
    const actual = replayBranch(input.sfen, actualPv.slice(0, 6), (input.actualPVJa || []).slice(0, 6));
    const recommended = replayBranch(input.sfen, recommendedPv.slice(0, 6), (input.recommendedPVJa || []).slice(0, 6));
    const mover = parseSfen(input.sfen).turn;
    const actualState = scoreState(input.actualScore || input.score);
    const recommendedState = scoreState(input.recommendedScore || input.bestScore);
    const mateDifference = actualState !== recommendedState && actualState !== "unknown" && recommendedState !== "unknown" && (actualState.includes("mate") || recommendedState.includes("mate"));
    const material = actualPv.length >= 6 && recommendedPv.length >= 6 ? strictMaterialAdvantage(
      replayBranch(input.sfen, actualPv.slice(0, 6)),
      replayBranch(input.sfen, recommendedPv.slice(0, 6)),
      mover,
    ) : null;
    const actualThreat = actual.events.slice(1, 3).find((event) => event.side !== mover && (event.check || event.capture));
    const recommendedFact = firstTactical(recommended.events) || recommended.events.find((event) => event.drop || event.promotion);
    const level = mateDifference || material ? 1 : (typesFrom(actual, recommended, false, null, input).length ? 2 : 3);
    const actualName = input.actualMoveJa || "実戦手";
    const bestName = input.bestMoveJa || "推奨手";
    const blocks = [];

    if (level === 3) {
      blocks.push({ key: "why", title: "なぜ良くなかった？", text: "この手のあと評価が大きく下がりました。保存された読み筋だけでは、原因を一つに特定できません。", evidence: [{ type: "evaluation", branch: "actual" }] });
    } else if (mateDifference && actualState === "mate-against") {
      const opposingChecks = actual.events.filter((event) => event.side !== mover && event.check);
      const final = actual.events[actual.events.length - 1];
      const sequence = opposingChecks.length >= 2 ? "相手の王手が続き、" : "相手の王手があり、";
      const ending = final?.moveJa || final?.moveUsi || "保存手順の終端";
      blocks.push({ key: "why", title: "なぜ良くなかった？", text: `${actualName}のあと、保存された読み筋では${sequence}${ending}まで詰み評価になります。`, evidence: [{ type: "mate", branch: "actual", score: input.actualScore || input.score }, ...opposingChecks] });
      blocks.push({ key: "recommended", title: "推奨手では", text: `水匠5は${bestName}を選んでいます。この枝では、実戦枝と同じ詰み評価にはなっていません。`, evidence: [{ type: "mate", branch: "recommended", score: input.recommendedScore || input.bestScore }] });
      blocks.push({ key: "next", title: "次に確認すること", text: "指す前に、相手の次の王手と、その次の自分の応手後も王手が続くか確認します。", evidence: opposingChecks.slice(0, 2) });
    } else {
      const fact = actualThreat || firstTactical(actual.events);
      if (fact) {
        const actor = fact.side === mover ? "自分" : "相手";
        const action = fact.check ? "王手になります" : `${PIECE_JA[fact.capture]}を取ります`;
        blocks.push({ key: "why", title: "なぜ良くなかった？", text: `${actualName}のあと、保存された読み筋の${fact.pvPly}手目に${actor}の手が${action}。`, evidence: [fact] });
      } else {
        blocks.push({ key: "why", title: "なぜ良くなかった？", text: "この手のあと評価が下がりました。保存データから確認できる差だけを表示します。", evidence: [{ type: "evaluation", branch: "actual" }] });
      }
      if (material) {
        const gain = material.gains.map((item) => `${PIECE_JA[item.piece]}${item.count}枚`).join("・");
        blocks.push({ key: "recommended", title: "推奨手では", text: `同じ手数の保存手順では、推奨枝の方が${gain}分多く残ります。`, evidence: [{ type: "material", branch: "comparison", ...material }] });
      } else if (recommendedFact) {
        const feature = recommendedFact.drop ? `${PIECE_JA[recommendedFact.piece]}を打つ手` : recommendedFact.promotion ? `${PIECE_JA[recommendedFact.piece]}が成る手` : recommendedFact.check ? "王手" : recommendedFact.capture ? `${PIECE_JA[recommendedFact.capture]}を取る手` : "保存手順";
        blocks.push({ key: "recommended", title: "推奨手では", text: `水匠5は${bestName}を選んでいます。保存された推奨枝では${feature}を確認できます。`, evidence: [recommendedFact] });
      }
      if (actualThreat) {
        blocks.push({ key: "next", title: "次に確認すること", text: actualThreat.check ? "指す前に、相手の次の王手を確認します。" : "指した直後、相手に取られる駒がないか確認します。", evidence: [actualThreat] });
      }
    }

    return { level, types: typesFrom(actual, recommended, mateDifference, material, input), blocks, branches: { actual, recommended }, actualCard: moveCard({ sfen: input.sfen, move: input.actualMove, notation: actualName }), recommendedCard: moveCard({ sfen: input.sfen, move: input.bestMove, notation: bestName }) };
  }

  return { parseSfen, parseUsi, applyUsi, replayBranch, isInCheck, moveCard, generateReasonEvidence, strictMaterialAdvantage, PIECE_JA };
});
