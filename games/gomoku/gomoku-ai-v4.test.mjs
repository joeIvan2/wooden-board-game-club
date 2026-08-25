import assert from 'node:assert/strict';
import { AI_VERSION, selectMove, getLastSearchInfo } from './gomoku-ai-v4.mjs';
import { analyzePlacement } from './gomoku-ai-v4-core.mjs';

const SIZE = 15;
const index = (row, col) => row * SIZE + col;
const board = () => Array(SIZE * SIZE).fill(0);
const legal = (position, move) => move
  && Number.isInteger(move.row)
  && Number.isInteger(move.col)
  && move.row >= 0 && move.row < SIZE
  && move.col >= 0 && move.col < SIZE
  && position[index(move.row, move.col)] === 0;

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`PASS ${name}`);
}

check('exports V4', () => assert.equal(AI_VERSION, 'V4'));

check('empty board chooses center', () => {
  assert.deepEqual(selectMove(board(), 1), { row: 7, col: 7 });
});

check('takes an immediate win before search', () => {
  const position = board();
  for (const col of [3, 4, 5, 6]) position[index(7, col)] = 1;
  for (const [row, col] of [[0, 0], [1, 1], [2, 2], [3, 3]]) position[index(row, col)] = 2;
  const move = selectMove(position, 1);
  assert(legal(position, move));
  assert.equal(move.row, 7);
  assert([2, 7].includes(move.col));
});

check('blocks a single immediate opponent win', () => {
  const position = board();
  for (const col of [3, 4, 5, 6]) position[index(7, col)] = 2;
  for (const [row, col] of [[0, 0], [1, 2], [2, 4], [3, 6]]) position[index(row, col)] = 1;
  const move = selectMove(position, 1);
  assert(legal(position, move));
  assert.equal(move.row, 7);
  assert([2, 7].includes(move.col));
});

check('fixed node and threat budgets are deterministic and non-mutating', () => {
  const position = board();
  for (const [row, col, player] of [
    [7, 7, 1], [7, 8, 2], [6, 7, 1], [8, 8, 2], [6, 6, 1], [8, 7, 2],
  ]) position[index(row, col)] = player;
  const before = JSON.stringify(position);
  const options = {
    maxDepth: 4,
    maxCandidates: 10,
    threatDepth: 4,
    qDepth: 2,
    timeBudgetMs: Infinity,
    tssTimeBudgetMs: Infinity,
    nodeBudget: 20,
    tssNodeBudget: 5,
  };
  const first = selectMove(position, 1, options);
  const firstInfo = getLastSearchInfo();
  const second = selectMove(position, 1, options);
  assert.deepEqual(second, first);
  assert(legal(position, first));
  assert.equal(JSON.stringify(position), before);
  assert(firstInfo.nodes <= 25, `expected <= 25 total nodes, got ${firstInfo.nodes}`);
});

check('an inconclusive TSS budget leaves the ordinary search usable', () => {
  const position = board();
  position[index(7, 7)] = 1;
  position[index(7, 8)] = 2;
  const move = selectMove(position, 1, {
    maxDepth: 2,
    maxCandidates: 6,
    threatDepth: 4,
    qDepth: 1,
    timeBudgetMs: Infinity,
    tssTimeBudgetMs: Infinity,
    nodeBudget: 500,
    tssNodeBudget: 1,
  });
  assert(legal(position, move));
  assert(getLastSearchInfo().depth >= 1, 'main search must still complete a depth after TSS stops');
});

check('full board returns null', () => {
  const position = board().map((_, cell) => (cell % 2) + 1);
  assert.equal(selectMove(position, 1), null);
});

check('quiescence resolves a forcing win at depth 1', () => {
  const position = board();
  for (const col of [5, 6, 7]) position[index(7, col)] = 1;   // black open three
  for (const [row, col] of [[0, 0], [0, 14], [14, 0]]) position[index(row, col)] = 2;
  const move = selectMove(position, 1, {
    maxDepth: 1, maxCandidates: 8, threatDepth: 0 + 2, qDepth: 4,
    useClock: false, timeBudgetMs: Infinity, tssTimeBudgetMs: Infinity,
    nodeBudget: 50000, tssNodeBudget: 1,
  });
  // tssNodeBudget 1 disables the probe shortcut: the main search/quiescence
  // must still find an open-four (or better) continuation.
  assert(legal(position, move));
  const placed = analyzePlacement(position, index(move.row, move.col), 1);
  assert(placed.five || placed.winningContinuations.size >= 2,
    `depth-1 search missed the forcing win: ${move.row},${move.col}`);
});

check('defensive candidates survive aggressive candidate truncation', () => {
  const position = board();
  // White open three (7,5)-(7,7): black must parry at an end square even
  // though maxCandidates leaves room for only four moves.
  for (const col of [5, 6, 7]) position[index(7, col)] = 2;
  for (const [row, col] of [[0, 0], [0, 14], [14, 0]]) position[index(row, col)] = 1;
  const move = selectMove(position, 1, {
    maxDepth: 2, maxCandidates: 4, threatDepth: 3, qDepth: 2,
    useClock: false, timeBudgetMs: Infinity, tssTimeBudgetMs: Infinity,
    nodeBudget: 20000, tssNodeBudget: 3000,
  });
  assert(legal(position, move));
  const ok = (move.row === 7 && [4, 8].includes(move.col))
    || analyzePlacement(position, index(move.row, move.col), 1).winningContinuations.size >= 2;
  assert(ok, `truncated search played a losing move: ${move.row},${move.col}`);
});

check('threat probe proves a real forced sequence and stays deterministic', () => {
  const position = board();
  // Black open three plus a far white stone: extending is a proven VCF-style win.
  for (const col of [5, 6, 7]) position[index(7, col)] = 1;
  position[index(11, 11)] = 2;
  const options = {
    maxDepth: 2, maxCandidates: 8, threatDepth: 4, qDepth: 2,
    useClock: false, timeBudgetMs: Infinity, tssTimeBudgetMs: Infinity,
    nodeBudget: 60000, tssNodeBudget: 8000,
  };
  const first = selectMove(position, 1, options);
  const firstInfo = getLastSearchInfo();
  const second = selectMove(position, 1, { ...options });
  const secondInfo = getLastSearchInfo();
  assert.deepEqual(second, first);
  assert.equal(secondInfo.nodes, firstInfo.nodes, 'node counts must repeat exactly');
  assert(legal(position, first));
  const placed = analyzePlacement(position, index(first.row, first.col), 1);
  assert(placed.five || placed.winningContinuations.size >= 2 || placed.openFour,
    'probe returned a non-winning move');
});

check('useClock:false ignores wall clock and obeys only node budgets', () => {
  const position = board();
  for (const [row, col, player] of [
    [7, 7, 1], [7, 8, 2], [6, 7, 1], [8, 8, 2], [6, 6, 1], [9, 9, 2],
  ]) position[index(row, col)] = player;
  const before = JSON.stringify(position);
  const options = {
    maxDepth: 12, maxCandidates: 20, threatDepth: 8, qDepth: 4,
    useClock: false, timeBudgetMs: Infinity, tssTimeBudgetMs: Infinity,
    nodeBudget: 400, tssNodeBudget: 100, tssScanBudget: 1000,
  };
  const t0 = Date.now();
  const move = selectMove(position, 1, options);
  const info = getLastSearchInfo();
  assert(Date.now() - t0 < 15000, 'clock-free search ran away');
  assert(info.nodes <= 500, `node cap exceeded: ${info.nodes}`);
  assert(info.searchNodes <= 400);
  assert(info.tssNodes <= 100);
  assert(legal(position, move));
  assert.equal(JSON.stringify(position), before);
  const again = selectMove(position, 1, options);
  assert.deepEqual(again, move);
});

console.log(`\n${passed} V4 checks passed`);

