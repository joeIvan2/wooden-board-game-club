import assert from "node:assert/strict";
import test from "node:test";
import {
  XIANGQI_AUDIT_DEPTHS,
  XIANGQI_OPENING_BOOK,
  buildOpeningSchedule,
  playGame,
  runTournament,
  stateToFen,
} from "../xiangqi-tournament.mjs";
import { createInitialState } from "../xiangqi-rules.mjs";

test("Xiangqi tournament FEN preserves the standard initial position", () => {
  assert.equal(stateToFen(createInitialState()), "rheakaehr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RHEAKAEHR w - - 0 1");
});

test("Xiangqi audit corpus is unique, deeper, and legal under the production rules", async () => {
  assert.equal(XIANGQI_OPENING_BOOK.length, 12);
  assert.equal(new Set(XIANGQI_OPENING_BOOK.map((opening) => opening.id)).size, XIANGQI_OPENING_BOOK.length);
  assert.throws(() => buildOpeningSchedule({ gamesPerPair: XIANGQI_OPENING_BOOK.length + 1 }), /without repeating openings/);
  const openings = buildOpeningSchedule({ gamesPerPair: XIANGQI_OPENING_BOOK.length });
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

test("Xiangqi tournament supports the fixed-depth capability audit", async () => {
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
  assert.equal(result.config.engineDepths.l7, 4);
  assert.equal(XIANGQI_AUDIT_DEPTHS.l10, 16);
});

test("Xiangqi tournament production route completes a checked L5/L6 short game", async () => {
  const opening = buildOpeningSchedule({ gamesPerPair: 1 })[0];
  const result = await playGame({
    white: "l5",
    black: "l6",
    opening: opening.moves,
    maxPlies: opening.moves.length + 2,
    classicTimeMs: 100,
    engineTimes: { l6: 80 },
  });
  assert.equal(result.invalid, false, result.error);
});
