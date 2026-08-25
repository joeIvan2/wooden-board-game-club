import assert from "node:assert/strict";
import test from "node:test";
import { buildOpeningSchedule, playGame, stateToFen } from "./chess-tournament.mjs";
import { createInitialState } from "./chess.mjs";

test("Chess tournament FEN preserves the standard initial position", () => {
  assert.equal(stateToFen(createInitialState()), "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
});

test("Chess tournament openings and L5/L6 route complete a checked short game", async () => {
  const openings = buildOpeningSchedule({ gamesPerPair: 2 });
  assert.notEqual(openings[0].id, openings[1].id);
  const result = await playGame({
    white: "l5",
    black: "l6",
    opening: openings[0].moves,
    maxPlies: 8,
    engineTimes: { l6: 80 },
  });
  assert.equal(result.invalid, false, result.error);
  assert.equal(result.reason, "max-plies");
});
