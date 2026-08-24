import assert from 'node:assert/strict';
import {
  AI_LEVELS,
  getLevelProfile,
  getLastLevelSearchInfo,
  normalizeLevel,
  selectLevelMove,
  getLevelSearchOptions,
} from './gomoku-levels.mjs';
import { analyzePlacement } from './gomoku-ai-v4-core.mjs';

const SIZE = 15;
const empty = () => Array(SIZE * SIZE).fill(0);
const at = (row, col) => row * SIZE + col;
const SEARCH_LEVELS = ['l5', 'l6', 'l7', 'l8', 'l9', 'l10'];

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`PASS ${name}`);
}

check('defines exactly L1 through L10', () => {
  assert.deepEqual(AI_LEVELS.map((level) => level.id),
    ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l10']);
  assert.deepEqual(AI_LEVELS.map((level) => level.level), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(getLevelProfile('l4').label, 'L4 進階');
  assert.equal(getLevelProfile('l10').label, 'L10 傳奇');
});

check('normalizes numbers and strings 1-10 and rejects everything else', () => {
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    assert.equal(normalizeLevel(n), `l${n}`);
    assert.equal(normalizeLevel(String(n)), `l${n}`);
    assert.equal(normalizeLevel(` L${n} `), `l${n}`);
    assert.equal(getLevelProfile(`l${n}`).level, n);
  }
  // Note: normalizeLevel(undefined) intentionally yields the default l3.
  for (const bad of [0, 11, -1, 3.5, '0', '11', 'l0', 'l11', 'l3.5', '', null, NaN, {}]) {
    assert.throws(() => normalizeLevel(bad), /Unknown AI level/, String(JSON.stringify(bad)));
    assert.throws(() => getLevelProfile(bad), /Unknown AI level/, String(JSON.stringify(bad)));
  }
});

check('search profiles grow monotonically in resources', () => {
  let previous = null;
  for (const id of SEARCH_LEVELS) {
    const profile = getLevelProfile(id);
    assert.equal(profile.engine, 'search', id);
    const { maxDepth, maxCandidates, threatDepth, qDepth } = profile.search;
    const tournament = profile.tournament;
    assert(Number.isInteger(maxDepth) && maxDepth >= 1, id);
    if (previous) {
      assert(maxDepth >= previous.maxDepth, `${id} depth`);
      assert(maxCandidates >= previous.maxCandidates, `${id} candidates`);
      assert(threatDepth >= previous.threatDepth, `${id} threatDepth`);
      assert(qDepth >= previous.qDepth, `${id} qDepth`);
      assert(tournament.nodeBudget >= previous.tournament.nodeBudget, `${id} nodeBudget`);
      assert(tournament.tssNodeBudget >= previous.tournament.tssNodeBudget, `${id} tssNodeBudget`);
    }
    // Tournament mode must be clock-free and node-capped for reproducibility.
    assert.equal(tournament.useClock, false, id);
    assert.equal(tournament.timeBudgetMs, Infinity, id);
    assert.equal(tournament.tssTimeBudgetMs, Infinity, id);
    assert(Number.isFinite(tournament.nodeBudget), id);
    // Interactive mode must be wall-clock bounded for browser usability.
    assert.equal(profile.interactive.useClock, true, id);
    assert(Number.isFinite(profile.interactive.timeBudgetMs), id);
    previous = { maxDepth, maxCandidates, threatDepth, qDepth, tournament };
  }
  assert.equal(getLevelSearchOptions('l10', 'tournament').useClock, false);
});

check('every level opens at the center', () => {
  for (const level of AI_LEVELS) {
    assert.deepEqual(selectLevelMove(empty(), 1, level.id, { context: 'tournament' }), { row: 7, col: 7 }, level.id);
  }
});

check('every level prioritizes an immediate win and does not mutate input', () => {
  for (const level of AI_LEVELS) {
    const position = empty();
    for (const col of [3, 4, 5, 6]) position[at(7, col)] = 1;
    for (const [row, col] of [[0, 0], [1, 1], [2, 2], [3, 3]]) position[at(row, col)] = 2;
    const before = JSON.stringify(position);
    const move = selectLevelMove(position, 1, level.id, { context: 'tournament' });
    assert.equal(move.row, 7, level.id);
    assert([2, 7].includes(move.col), level.id);
    assert.equal(JSON.stringify(position), before, `${level.id} mutated input`);
  }
});

check('every level blocks one immediate opponent win', () => {
  for (const level of AI_LEVELS) {
    const position = empty();
    for (const col of [3, 4, 5, 6]) position[at(7, col)] = 2;
    position[at(7, 2)] = 1; // closes the left end, leaving only (7,7) to block
    for (const [row, col] of [[0, 0], [1, 2], [2, 4]]) position[at(row, col)] = 1;
    const move = selectLevelMove(position, 1, level.id, { context: 'tournament' });
    assert.deepEqual(move, { row: 7, col: 7 }, level.id);
  }
});

check('profile choice is deterministic for a nonterminal position', () => {
  const position = empty();
  for (const [row, col, player] of [
    [7, 7, 1], [7, 8, 2], [6, 7, 1], [8, 8, 2], [6, 6, 1], [8, 7, 2],
  ]) position[at(row, col)] = player;
  for (const level of AI_LEVELS) {
    const first = selectLevelMove(position, 1, level.id, { context: 'tournament' });
    const second = selectLevelMove(position, 1, level.id, { context: 'tournament' });
    assert.deepEqual(second, first, level.id);
    const info = getLastLevelSearchInfo();
    assert.equal(info.level, level.id);
  }
});

// --- Tactical fixtures for the search profiles (L5-L10) ---

check('L5-L10 take a winning open-four/double-threat move when available', () => {
  const position = empty();
  // One open three for black: extending either end creates an unstoppable
  // four, while anything else lets white back into the game.
  for (const col of [5, 6, 7]) position[at(7, col)] = 1;
  for (const [row, col] of [[0, 0], [0, 14], [14, 0]]) position[at(row, col)] = 2;
  const winning = new Set();
  for (let i = 0; i < position.length; i++) {
    if (position[i] !== 0) continue;
    const a = analyzePlacement(position, i, 1);
    if (a.five || a.winningContinuations.size >= 2) winning.add(i);
  }
  assert.equal(winning.size, 2, 'fixture calibration: exactly the two extensions may force the win');
  for (const id of SEARCH_LEVELS) {
    const move = selectLevelMove(position, 1, id, { context: 'tournament' });
    const index = at(move.row, move.col);
    assert(winning.has(index), `${id} missed a forced win (chose ${move.row},${move.col})`);
    assert.equal(getLastLevelSearchInfo().level, id);
  }
});

check('L5-L10 find the unique immediate defense against a four', () => {
  const position = empty();
  for (const col of [4, 5, 6, 8]) position[at(7, col)] = 2; // five at (7,7)
  for (const [row, col] of [[0, 0], [0, 14], [14, 0]]) position[at(row, col)] = 1;
  for (const id of SEARCH_LEVELS) {
    const move = selectLevelMove(position, 1, id, { context: 'tournament' });
    assert.deepEqual(move, { row: 7, col: 7 }, `${id} failed the unique block`);
  }
});

check('L5-L10 answer an open-three threat with a valid parry', () => {
  const position = empty();
  // White open three (7,5)-(7,7): if black ignores it, (7,4)/(7,8) makes a
  // losing open four for white. Only the two end squares parry in one move.
  for (const col of [5, 6, 7]) position[at(7, col)] = 2;
  for (const [row, col] of [[0, 0], [0, 14], [14, 0]]) position[at(row, col)] = 1;

  function whiteGetsOpenFour(afterBlackIndex) {
    const board = position.slice();
    board[afterBlackIndex] = 1;
    for (let i = 0; i < board.length; i++) {
      if (board[i] !== 0) continue;
      const a = analyzePlacement(board, i, 2);
      if (a.five || a.winningContinuations.size >= 2) return true;
    }
    return false;
  }
  const parries = new Set();
  for (let i = 0; i < position.length; i++) {
    if (position[i] !== 0) continue;
    if (!whiteGetsOpenFour(i)) parries.add(i);
  }
  assert.equal(parries.size, 2, 'fixture calibration: exactly two squares may parry');
  assert(parries.has(at(7, 4)) && parries.has(at(7, 8)), 'fixture calibration: end squares must parry');
  for (const id of SEARCH_LEVELS) {
    const move = selectLevelMove(position, 1, id, { context: 'tournament' });
    const index = at(move.row, move.col);
    assert(parries.has(index), `${id} played a losing move ${move.row},${move.col} against the open three`);
  }
});

check('L5-L10 respect small override node caps and stay legal', () => {
  const position = empty();
  for (const [row, col, player] of [
    [7, 7, 1], [7, 8, 2], [6, 7, 1], [8, 8, 2], [6, 6, 1], [8, 7, 2], [5, 5, 1], [5, 6, 2],
  ]) position[at(row, col)] = player;
  const before = JSON.stringify(position);
  for (const id of SEARCH_LEVELS) {
    const move = selectLevelMove(position, 1, id, {
      context: 'tournament',
      nodeBudget: 300,
      tssNodeBudget: 50,
      tssScanBudget: 400,
    });
    assert(move && Number.isInteger(move.row) && Number.isInteger(move.col), id);
    assert(move.row >= 0 && move.row < SIZE && move.col >= 0 && move.col < SIZE, id);
    assert.equal(position[at(move.row, move.col)], 0, `${id} picked an occupied square`);
    const info = getLastLevelSearchInfo();
    assert(info.nodes <= 350, `${id} exceeded node cap: ${info.nodes}`);
  }
  assert.equal(JSON.stringify(position), before, 'override search mutated input');
});

console.log(`\n${passed} level checks passed`);
