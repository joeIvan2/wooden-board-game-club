/**
 * xiangqi-notation.mjs — 著法記譜與解析（純函式）。
 *
 * 支援兩種記法：
 * 1. 中文縱線記法：如「炮二平五」「馬8進7」。
 *    - 紅方以漢數字由紅方右至左數一～九；黑方以阿拉伯數字由黑方右至左數 1～9。
 *    - 同線同種子以前／中／後區分；使用前綴時依慣例省略起點路數。
 *    - 直行子（車炮將帥兵卒）進退以步數表示；斜走子（馬象士）進退以目標路數表示。
 * 2. 座標記法：欄 a–i（col 0–8）、列 1–10（row 9→1 … row 0→10），如「h3-e3」。
 */

import { BOARD_ROWS, getLegalMoves } from "./xiangqi-rules.mjs";

const CHINESE_NUMERALS = Object.freeze(["一", "二", "三", "四", "五", "六", "七", "八", "九"]);
const STRAIGHT_TYPES = Object.freeze(new Set(["rook", "cannon", "general", "soldier"]));
const DUPLICATE_PREFIXES_2 = Object.freeze(["前", "後"]);
const DUPLICATE_PREFIXES_3 = Object.freeze(["前", "中", "後"]);

/** 該色視角的路數（1 起）。紅：9-col；黑：col+1。 */
export function fileNumberOf(color, col) {
  return color === "red" ? 9 - col : col + 1;
}

function numeralFor(color, number) {
  return color === "red" ? CHINESE_NUMERALS[number - 1] : String(number);
}

/** 座標字串，如 "h3"。 */
export function formatSquare(square) {
  const fileLetter = String.fromCharCode(97 + square.col);
  const rank = 10 - square.row;
  return `${fileLetter}${rank}`;
}

/** 座標記法著法，如 "h3-e3"。 */
export function formatCoordinateMove(move) {
  return `${formatSquare(move.from)}-${formatSquare(move.to)}`;
}

/**
 * 中文縱線記法。需要局面以判定棋種、同線重複與方向。
 * 假設 move 為該局面的合法著法。
 */
export function formatChineseMove(state, move) {
  const { board } = state;
  const { from, to } = move;
  const piece = board[from.row][from.col];
  if (!piece) throw new Error("記譜失敗：起點沒有棋子");
  const { color, type } = piece;

  // 同一列上同色同種棋子 → 需要前中後前綴（依「越接近敵方越前」排序）。
  let prefix = null;
  const twinRows = [];
  for (let row = 0; row < BOARD_ROWS; row += 1) {
    const other = board[row][from.col];
    if (other && other.color === color && other.type === type) twinRows.push(row);
  }
  if (twinRows.length > 1) {
    twinRows.sort((a, b) => (color === "red" ? a - b : b - a));
    const index = twinRows.indexOf(from.row);
    if (twinRows.length === 2) {
      prefix = DUPLICATE_PREFIXES_2[index];
    } else if (twinRows.length === 3) {
      prefix = DUPLICATE_PREFIXES_3[Math.min(index, 2)];
    } else {
      // 超過三枚（極罕見的多兵同線）：首尾用前/後，其餘依序編號。
      if (index === 0) prefix = "前";
      else if (index === twinRows.length - 1) prefix = "後";
      else prefix = numeralFor(color, index);
    }
  }

  const glyph = type === "general"
    ? (color === "red" ? "帥" : "將")
    : ({
        advisor: color === "red" ? "仕" : "士",
        elephant: color === "red" ? "相" : "象",
        horse: color === "red" ? "傌" : "馬",
        rook: color === "red" ? "俥" : "車",
        cannon: color === "red" ? "炮" : "砲",
        soldier: color === "red" ? "兵" : "卒",
      }[type]);

  const action = from.row === to.row
    ? "平"
    : (color === "red" ? to.row < from.row : to.row > from.row) ? "進" : "退";

  let target;
  if (action === "平" || !STRAIGHT_TYPES.has(type)) {
    target = numeralFor(color, fileNumberOf(color, to.col));
  } else {
    target = numeralFor(color, Math.abs(to.row - from.row));
  }

  const startFile = numeralFor(color, fileNumberOf(color, from.col));
  return `${prefix ?? ""}${glyph}${prefix ? "" : startFile}${action}${target}`;
}

/**
 * 由「目前局面的合法著法集合」反查文字對應的著法。
 * 同時接受中文記法與座標記法；找不到回傳 null。
 */
export function parseMoveText(state, text, moves) {
  const normalized = String(text ?? "").trim().toLowerCase();
  if (!normalized) return null;
  const legal = moves ?? getLegalMoves(state);
  let matched = null;
  for (const entry of iterateLegalMovesWithNotation(state, legal)) {
    if (entry.chinese.toLowerCase() === normalized || entry.coordinate === normalized
      || entry.coordinate.replace("-", "") === normalized.replace(/[\s-]+/g, "")) {
      matched = entry.move;
      break;
    }
  }
  return matched;
}

/** 逐一產生合法著法與兩種記法（供 CLI 選單與解析共用）。 */
export function* iterateLegalMovesWithNotation(state, moves) {
  for (const move of moves ?? []) {
    yield {
      move,
      chinese: formatChineseMove(state, move),
      coordinate: formatCoordinateMove(move),
    };
  }
}
