// 社群棋譜榜共用純模組：UCI 解析、規則重放、標準 PGN 產生。
//
// 此模組必須保持純 ESM、零依賴（僅 import 本專案的 chess.mjs 與
// chess-notation.mjs），可同時被瀏覽器、Cloudflare Pages Functions 與
// Node 測試使用。絕不 import app.js 或 worker。

import {
  createInitialState,
  generateLegalMoves,
  applyMove,
  getGameStatus,
  createRepetitionTracker,
} from "./chess.mjs";
import { formatSan } from "./chess-notation.mjs";

export const MIN_PLIES = 4;
export const MAX_PLIES = 600;
export const DEFAULT_RULESET = "oxalpha-chess-rules-v1";
export const DEFAULT_PRIVATE_WHITE = "玩家";

const UCI_RE = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;

function squareToRC(square) {
  return [8 - Number(square[1]), square.charCodeAt(0) - 97];
}

export function moveToUci(move) {
  const fileOf = (col) => String.fromCharCode(97 + col);
  const rankOf = (row) => String(8 - row);
  return (
    fileOf(move.from[1]) +
    rankOf(move.from[0]) +
    fileOf(move.to[1]) +
    rankOf(move.to[0]) +
    (move.promotion ?? "")
  );
}

export function parseUci(uci) {
  if (typeof uci !== "string") return null;
  const m = UCI_RE.exec(uci.trim().toLowerCase());
  if (!m) return null;
  return {
    from: squareToRC(m[1]),
    to: squareToRC(m[2]),
    promotion: m[3] ?? null,
  };
}

// 逐著重放：任何非法著法立即失敗，並回傳位置索引供除錯。
// 終局守衛：每處理候選著法「之前」都以當下狀態＋重複計數檢查終局；
// 一旦達到將死／逼和／死局／五次重複／75 回合等終局，任何後續著法
// 一律以明確的 terminal 原因拒絕——不得在終局後繼續補著法再宣稱取勝。
export function replayUci(movesUci) {
  if (!Array.isArray(movesUci)) return { ok: false, reason: "notAList" };
  const tracker = createRepetitionTracker();
  let state = createInitialState();
  tracker.reset(state);
  const sanList = [];
  for (let i = 0; i < movesUci.length; i++) {
    const current = getGameStatus(state, {
      repetitionCount: tracker.countCurrent(),
    });
    if (current.status !== "ongoing") {
      return { ok: false, reason: `terminal@${i}:${current.status}` };
    }
    const parsed = parseUci(movesUci[i]);
    if (!parsed) return { ok: false, reason: `badUci@${i}` };
    const match = generateLegalMoves(state).find(
      (mv) =>
        mv.from[0] === parsed.from[0] &&
        mv.from[1] === parsed.from[1] &&
        mv.to[0] === parsed.to[0] &&
        mv.to[1] === parsed.to[1] &&
        (mv.promotion ?? null) === parsed.promotion
    );
    if (!match) return { ok: false, reason: `illegalMove@${i}` };
    sanList.push(formatSan(state, match));
    state = applyMove(state, match);
    tracker.push(state);
  }
  const contextStatus = getGameStatus(state, {
    repetitionCount: tracker.countCurrent(),
  });
  return {
    ok: true,
    sanList,
    finalState: state,
    contextStatus,
    repetitionCount: tracker.countCurrent(),
  };
}

function fail(error, detail = null) {
  return { ok: false, error, detail };
}

// 終局狀態 → 公開投稿錯誤碼。續送終局後著法時，錯誤碼即為
// 該終局狀態本身（如 fivefold / seventyfive / checkmate），
// detail 帶 terminal@<index>:<status> 以精確定位。
function classifyContextStatus(status) {
  if (status.status === "checkmate") {
    return status.winner === "w" ? null : "blackWin";
  }
  if (status.status === "stalemate") return "stalemate";
  if (
    status.status === "insufficient" ||
    status.status === "fivefold" ||
    status.status === "seventyfive"
  ) {
    return status.status;
  }
  return "notCheckmate";
}

// 公開投稿的唯一接受條件：自初始局面逐著合法重放（且中途不得穿越
// 任何終局），最終為「白方將死」。其餘結果一律以明確錯誤碼拒絕。
export function validateWhiteMateRun(movesUci) {
  if (!Array.isArray(movesUci)) return fail("invalidPayload");
  if (movesUci.length < MIN_PLIES) return fail("tooFewPlies");
  if (movesUci.length > MAX_PLIES) return fail("tooManyPlies");
  const run = replayUci(movesUci);
  if (!run.ok) {
    const reason = run.reason;
    if (reason.startsWith("badUci")) return fail("badUci", reason);
    if (reason.startsWith("illegalMove")) return fail("illegalMove", reason);
    if (reason.startsWith("terminal@")) {
      const terminalStatus = reason.slice(reason.indexOf(":") + 1);
      return fail(terminalStatus || "terminal", reason);
    }
    return fail("invalidPayload", reason);
  }
  const error = classifyContextStatus(run.contextStatus);
  if (error) return fail(error);
  return {
    ok: true,
    sanList: run.sanList,
    finalState: run.finalState,
    plyCount: movesUci.length,
    whiteMoveCount: Math.ceil(movesUci.length / 2),
  };
}

// PGN 標籤值跳脫：反斜線與雙引號需跳脫；控制字元（含換行）轉為空格，
// 確保任何顯示名稱都無法破壞標籤結構。
export function escapePgnValue(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim();
}

export function isValidDateOnly(value) {
  return typeof value === "string" && /^\d{4}\.\d{2}\.\d{2}$/.test(value);
}

export function formatMovetext(sanList, result = "1-0", maxLineLength = 80) {
  const words = [];
  for (let i = 0; i < sanList.length; i++) {
    words.push(i % 2 === 0 ? `${i / 2 + 1}. ${sanList[i]}` : sanList[i]);
  }
  words.push(result);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (!line) {
      line = word;
    } else if (line.length + 1 + word.length <= maxLineLength) {
      line += " " + word;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

// 標準 PGN：七項必要標籤（Event/Site/Date/Round/White/Black/Result）
// 加上 Level/PlyCount/Termination/Ruleset。日期僅到日（YYYY.MM.DD）。
export function buildPgn({
  sanList,
  dateOnly,
  white,
  black,
  level,
  plyCount,
  event,
  site,
  termination = "checkmate",
  result = "1-0",
  ruleset = DEFAULT_RULESET,
}) {
  if (!isValidDateOnly(dateOnly)) {
    throw new TypeError("dateOnly must be YYYY.MM.DD");
  }
  if (!Array.isArray(sanList) || sanList.length === 0) {
    throw new TypeError("sanList must be a non-empty array");
  }
  const headers = [
    ["Event", event ?? `社群棋譜榜 Community Board L${Number(level)}`],
    ["Site", site ?? "oxalpha-chess-club"],
    ["Date", dateOnly],
    ["Round", "-"],
    ["White", white],
    ["Black", black],
    ["Result", result],
    ["Level", `L${Number(level)}`],
    ["PlyCount", String(Number(plyCount))],
    ["Termination", termination],
    ["Ruleset", ruleset],
  ];
  const tagLines = headers.map(
    ([key, value]) => `[${key} "${escapePgnValue(value)}"]`
  );
  return `${tagLines.join("\n")}\n\n${formatMovetext(sanList, result)}\n`;
}
