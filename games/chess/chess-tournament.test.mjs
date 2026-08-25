import assert from "node:assert/strict";
import test from "node:test";
import {
  CHESS_AUDIT_DEPTHS,
  CHESS_OPENING_BOOK,
  buildOpeningSchedule,
  playGame,
  runTournament,
  stateToFen,
} from "./chess-tournament.mjs";
import { createInitialState } from "./chess.mjs";

test("Chess tournament FEN preserves the standard initial position", () => {
  assert.equal(stateToFen(createInitialState()), "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
});

test("Chess audit corpus is unique, deeper, and legal under the production rules", async () => {
  assert.equal(CHESS_OPENING_BOOK.length, 12);
  assert.equal(new Set(CHESS_OPENING_BOOK.map((opening) => opening.id)).size, CHESS_OPENING_BOOK.length);
  assert.throws(() => buildOpeningSchedule({ gamesPerPair: CHESS_OPENING_BOOK.length + 1 }), /without repeating openings/);
  const openings = buildOpeningSchedule({ gamesPerPair: CHESS_OPENING_BOOK.length });
  for (const opening of openings) {
    assert.equal(opening.moves.length % 2, 0, opening.id);
    assert(opening.moves.length >= 8, opening.id);
    const result = await playGame({
      white: "l5",
      black: "l6",
      opening: opening.moves,
      maxPlies: opening.moves.length,
    });
    assert.equal(result.invalid, false, `${opening.id}: ${result.error}`);
  }
});

test("Chess tournament supports the fixed-depth capability audit", async () => {
  const opening = buildOpeningSchedule({ gamesPerPair: 1 })[0];
  const result = await runTournament({
    levels: ["l6", "l7"],
    gamesPerPair: 1,
    maxPlies: opening.moves.length + 2,
    engineControl: "fixed-depth",
    engineDepths: { l6: 3, l7: 4 },
  });
  assert.equal(result.games.length, 2);
  assert(result.games.every((game) => !game.invalid), JSON.stringify(result.games));
  assert.equal(result.config.engineControl, "fixed-depth");
  assert.equal(result.config.engineDepths.l6, 3);
  assert.equal(CHESS_AUDIT_DEPTHS.l10, 16);
});

test("Chess tournament production route completes a checked L5/L6 short game", async () => {
  const opening = buildOpeningSchedule({ gamesPerPair: 1 })[0];
  const result = await playGame({
    white: "l5",
    black: "l6",
    opening: opening.moves,
    maxPlies: opening.moves.length + 2,
    engineTimes: { l6: 80 },
  });
  assert.equal(result.invalid, false, result.error);
  assert.equal(result.reason, "max-plies");
});
