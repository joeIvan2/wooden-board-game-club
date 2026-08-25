import assert from "node:assert/strict";
import test from "node:test";
import { buildOpeningSchedule, playGame, stateToFen } from "../xiangqi-tournament.mjs";
import { createInitialState } from "../xiangqi-rules.mjs";

test("Xiangqi tournament FEN preserves the standard initial position", () => {
  assert.equal(stateToFen(createInitialState()), "rheakaehr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RHEAKAEHR w - - 0 1");
});

test("Xiangqi tournament openings and L5/L6 route complete a checked short game", async () => {
  const openings = buildOpeningSchedule({ gamesPerPair: 6 });
  for (const opening of openings) {
    const result = await playGame({
      white: "l5",
      black: "l6",
      opening: opening.moves,
      maxPlies: 8,
      classicTimeMs: 100,
      engineTimes: { l6: 80 },
    });
    assert.equal(result.invalid, false, `${opening.id}: ${result.error}`);
  }
});
