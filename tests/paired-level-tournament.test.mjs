import assert from "node:assert/strict";
import test from "node:test";
import {
  planPairedGames,
  summarizeTournament,
  verifyExpectedOrder,
} from "../shared/paired-level-tournament.mjs";

test("paired level schedule swaps colours for every opening", () => {
  const plans = planPairedGames(["l5", "l6"], [{ id: "o1", moves: ["x"] }]);
  assert.equal(plans.length, 2);
  assert.deepEqual(plans.map(({ white, black }) => [white, black]), [["l5", "l6"], ["l6", "l5"]]);
  assert.equal(plans[0].pairId, plans[1].pairId);
});

test("paired verification treats a small tied sample as insufficient evidence", () => {
  const summary = summarizeTournament(["l5", "l6"], [
    { pairId: "o1", white: "l5", black: "l6", winner: "white", invalid: false },
    { pairId: "o1", white: "l6", black: "l5", winner: "white", invalid: false },
  ]);
  assert.equal(summary.verification.status, "inconclusive");
  assert.equal(summary.verification.comparisons[0].score, 0.5);
  assert.equal(summary.verification.comparisons[0].pairCount, 1);
  assert.equal(summary.verification.comparisons[0].status, "insufficient");
  assert.equal(verifyExpectedOrder(["l5", "l6"], summary.headToHead).passed, false);
});

test("paired verification confirms a consistent adjacent-level advantage", () => {
  const games = [];
  for (let index = 1; index <= 4; index += 1) {
    const pairId = `o${index}`;
    games.push(
      { pairId, white: "l6", black: "l5", winner: "white", invalid: false },
      { pairId, white: "l5", black: "l6", winner: "black", invalid: false },
    );
  }
  const summary = summarizeTournament(["l5", "l6"], games);
  const comparison = summary.verification.comparisons[0];
  assert.equal(comparison.status, "passed");
  assert.equal(comparison.pairCount, 4);
  assert.equal(comparison.score, 1);
  assert.equal(summary.verification.policy.unit, "paired-opening");
});
