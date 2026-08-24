import assert from 'node:assert/strict';
import {
  createBoard,
  applyMove,
  applyOpening,
  generateOpening,
  validatePosition,
  winnerOnBoard,
} from './gomoku-rules.mjs';
import { playGame } from './gomoku-match.mjs';
import { buildOpeningSchedule, planTournamentGames, runTournament, wilsonLowerBound } from './gomoku-tournament.mjs';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`PASS ${name}`);
}

check('seeded opening is deterministic, legal, and black-to-move', () => {
  const first = generateOpening({ seed: 42, plies: 4, symmetry: 3 });
  const second = generateOpening({ seed: 42, plies: 4, symmetry: 3 });
  assert.deepEqual(second, first);
  const board = createBoard();
  applyOpening(board, first);
  const state = validatePosition(board, 1);
  assert.equal(state.winner, 0);
  assert.equal(state.nextPlayer, 1);
});

check('headless game is valid and can be replayed exactly', () => {
  const opening = generateOpening({ seed: 7, plies: 4, symmetry: 1 });
  const game = playGame({ black: 'l2', white: 'l3', opening, seed: 7, openingId: 'test' });
  assert.equal(game.invalid, false);
  assert(['black', 'white', 'draw'].includes(game.winner));
  const replay = createBoard();
  for (const move of game.moves) {
    const player = move.player === 'black' ? 1 : 2;
    applyMove(replay, move.index, player);
  }
  assert.deepEqual(replay, game.finalBoard);
  if (game.winner === 'black') assert.equal(winnerOnBoard(replay), 1);
  if (game.winner === 'white') assert.equal(winnerOnBoard(replay), 2);
});

check('three-level paired round robin has no invalid games and correct rank', () => {
  const result = runTournament({
    levels: ['l1', 'l2', 'l3'],
    gamesPerPair: 16,
    seed: 42,
    openingPlies: 4,
    symmetries: 8,
  });
  assert.equal(result.games.length, 96);
  assert(result.games.every((game) => !game.invalid));
  assert.deepEqual(result.ranking.map((entry) => entry.level), ['l3', 'l2', 'l1']);
  assert.equal(result.verification.passed, true);
});

check('opening schedule is deterministic, shared by every pair, and color-paired', () => {
  const options = { gamesPerPair: 2, seed: 0xFFFFFFFF, openingPlies: 4, symmetries: 2 };
  const first = buildOpeningSchedule(options);
  const second = buildOpeningSchedule(options);
  assert.deepEqual(second, first);
  assert.deepEqual(first.map((entry) => entry.seed), [0xFFFFFFFF, 0]);

  const result = runTournament({ levels: ['l1', 'l2', 'l3'], ...options });
  assert.equal(result.config.pairedColors, true);
  assert.equal(result.config.sharedOpeningSchedule, true);
  assert.deepEqual(result.openingSchedule, first);
  for (const openingEntry of first) {
    const games = result.games.filter((game) => game.openingId === openingEntry.id);
    assert.equal(games.length, 6, 'three pairs x two colors must share each opening');
    assert(games.every((game) => game.seed === openingEntry.seed));
    assert(games.every((game) => JSON.stringify(game.opening) === JSON.stringify(openingEntry.opening)));
    for (const pair of [['l1', 'l2'], ['l1', 'l3'], ['l2', 'l3']]) {
      const pairGames = games.filter((game) => pair.includes(game.black) && pair.includes(game.white));
      assert.equal(pairGames.length, 2);
      assert.deepEqual(pairGames.map((game) => game.black).sort(), [...pair].sort());
    }
  }
});

check('L10 is accepted by the paired headless tournament', () => {
  const result = runTournament({
    levels: ['l1', 'l10'],
    gamesPerPair: 1,
    seed: 9,
    openingPlies: 4,
    symmetries: 1,
  });
  assert.equal(result.games.length, 2);
  assert.equal(result.openingSchedule.length, 1);
  assert(result.games.every((game) => !game.invalid));
  assert.deepEqual(result.games.map((game) => game.black).sort(), ['l1', 'l10']);
});

check('Wilson lower bound distinguishes strong evidence from no evidence', () => {
  assert(wilsonLowerBound(64, 64) > 0.9);
  assert(wilsonLowerBound(32, 64) < 0.5);
});

check('the ten-level schedule has every pair with color swaps and shared openings', () => {
  const levels = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l10'];
  const schedule = buildOpeningSchedule({ gamesPerPair: 2, seed: 7, openingPlies: 4, symmetries: 2 });
  const plan = planTournamentGames(levels, schedule);
  // 45 pairs x 2 openings x 2 colors
  assert.equal(plan.length, 180);

  const pairs = new Set();
  for (let a = 0; a < levels.length; a++) {
    for (let b = a + 1; b < levels.length; b++) pairs.add(`${levels[a]}|${levels[b]}`);
  }
  for (const pair of pairs) {
    const [a, b] = pair.split('|');
    for (const entry of schedule) {
      const base = plan.find((g) => g.openingId === entry.id && g.black === a && g.white === b);
      const swap = plan.find((g) => g.openingId === entry.id && g.black === b && g.white === a);
      assert(base && swap, `missing color-paired games for ${pair} on ${entry.id}`);
      assert.equal(base.seed, entry.seed);
      assert.deepEqual(base.opening, entry.opening);
      assert.deepEqual(swap.opening, entry.opening);
    }
  }
  // Every opening is shared by all 45 pairs (twice each: base + swap).
  for (const entry of schedule) {
    const games = plan.filter((g) => g.openingId === entry.id);
    assert.equal(games.length, 90, `${entry.id} must be shared by all 45 pairs`);
    assert.equal(new Set(games.map((g) => `${g.black}-vs-${g.white}`)).size, 90);
  }
});

check('tournament-context games repeat move-for-move under fixed node budgets', () => {
  const opening = generateOpening({ seed: 21, plies: 4, symmetry: 3 });
  const options = { black: 'l6', white: 'l5', opening, context: 'tournament' };
  const strip = (game) => JSON.parse(JSON.stringify(game, (key, value) => (key === 'elapsedMs' ? 0 : value)));
  const first = strip(playGame(options));
  const second = strip(playGame(options));
  assert.deepEqual(second, first);
  assert(['black', 'white', 'draw'].includes(first.winner));
  assert(!first.invalid, first.error?.message ?? 'game invalid');
});

console.log(`\n${passed} match/tournament checks passed`);
