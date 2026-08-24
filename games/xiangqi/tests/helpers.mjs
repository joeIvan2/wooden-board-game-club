/**
 * tests/helpers.mjs — 測試共用工具。
 */

import {
  createInitialState,
  applyMove,
  getLegalMoves,
  getLegalMovesFrom,
} from "../xiangqi-rules.mjs";
import { formatCoordinateMove } from "../xiangqi-notation.mjs";

/** 建立近乎空盤的測試局面（預設將帥分置安全位置，避免照面）。 */
export function emptyState({
  redKing = { row: 9, col: 4 },
  blackKing = { row: 0, col: 3 },
  placements = [],
  turn = "red",
} = {}) {
  const board = Array.from({ length: 10 }, () => Array(9).fill(null));
  board[redKing.row][redKing.col] = { color: "red", type: "general" };
  board[blackKing.row][blackKing.col] = { color: "black", type: "general" };
  for (const [row, col, color, type] of placements) {
    board[row][col] = Object.freeze({ color, type });
  }
  return { board, turn, captured: { red: [], black: [] }, plies: 0 };
}

/** 依座標字串序列走子（允許連續同一方；仍須為該子真實合法著法）。 */
export function applyCoordinateSequence(state, coordinates) {
  let current = state;
  for (const text of coordinates) {
    const normalized = String(text).trim().toLowerCase().replace(/[\s-]+/g, "");
    const match = normalized.match(/^([a-i])(\d{1,2})([a-i])(\d{1,2})$/);
    if (!match) throw new Error(`測試用座標格式錯誤：${text}`);
    const from = {
      col: match[1].charCodeAt(0) - 97,
      row: 10 - Number(match[2]),
    };
    const to = {
      col: match[3].charCodeAt(0) - 97,
      row: 10 - Number(match[4]),
    };
    const piece = current.board[from.row]?.[from.col];
    if (!piece) throw new Error(`測試用座標起點沒有棋子：${text}`);
    const move = getLegalMovesFrom(current, from.row, from.col, piece.color)
      .find((m) => m.to.row === to.row && m.to.col === to.col);
    if (!move) throw new Error(`測試用座標不合法：${text}`);
    current = applyMove(current, move);
  }
  return current;
}

/** 著法集合轉成 "from-to" 座標字串集合，方便斷言。 */
export function coordinateSet(state, color) {
  return new Set(
    getLegalMoves(state, color ?? state.turn).map((move) => `${squareIccs(move.from)}-${squareIccs(move.to)}`),
  );
}

export function squareIccs(square) {
  return `${String.fromCharCode(97 + square.col)}${10 - square.row}`;
}

/** 統計某色各種棋子的合法著法數（依起點棋種彙總）。 */
export function legalCountByType(state, color) {
  const counts = {};
  for (const move of getLegalMoves(state, color ?? state.turn)) {
    const piece = state.board[move.from.row][move.from.col];
    counts[piece.type] = (counts[piece.type] ?? 0) + 1;
  }
  return counts;
}
