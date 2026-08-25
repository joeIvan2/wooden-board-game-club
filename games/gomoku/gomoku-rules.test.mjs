import assert from "node:assert/strict";
import {
  BOARD_SIZE,
  CELLS,
  applyMove,
  createBoard,
  generateOpening,
  indexToMove,
  legalMoves,
  moveToIndex,
  validatePosition,
  winnerOnBoard,
} from "./gomoku-rules.mjs";

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

check("15×15 棋盤與座標互轉正確", () => {
  const board = createBoard();
  assert.equal(board.length, CELLS);
  assert.equal(BOARD_SIZE, 15);
  assert.deepEqual(indexToMove(112), { row: 7, col: 7 });
  assert.equal(moveToIndex({ row: 7, col: 7 }), 112);
  assert.equal(legalMoves(board).length, CELLS);
});

check("規則層能辨識五連勝且不依賴引擎", () => {
  const board = createBoard();
  for (let col = 3; col < 8; col += 1) applyMove(board, moveToIndex({ row: 6, col }), 1);
  assert.equal(winnerOnBoard(board), 1);
  assert.equal(legalMoves(board).length, CELLS - 5);
});

check("局面計數驗證與固定開局保持可重現", () => {
  const board = createBoard();
  applyMove(board, 112, 1);
  assert.deepEqual(validatePosition(board).nextPlayer, 2);
  const first = generateOpening({ seed: 20260825, plies: 4, symmetry: 3 });
  const second = generateOpening({ seed: 20260825, plies: 4, symmetry: 3 });
  assert.deepEqual(first, second);
  assert.equal(first.length, 4);
});

console.log(`\n${passed} Gomoku 規則測試通過`);
