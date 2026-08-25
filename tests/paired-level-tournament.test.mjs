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
});

test("strict verification rejects tied adjacent levels", () => {
  const summary = summarizeTournament(["l5", "l6"], [
    { white: "l5", black: "l6", winner: "white", invalid: false },
    { white: "l6", black: "l5", winner: "white", invalid: false },
  ]);
  assert.equal(summary.verification.status, "failed");
  assert.equal(summary.verification.comparisons[0].score, 0.5);
  assert.equal(verifyExpectedOrder(["l5", "l6"], summary.headToHead).passed, false);
});
