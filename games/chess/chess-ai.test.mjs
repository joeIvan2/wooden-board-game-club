import assert from "node:assert/strict";
import {
  createInitialState,
  generateLegalMoves,
  applyMove,
  getGameStatus,
} from "./chess.mjs";import { chooseMove, AI_MIN_LEVEL, AI_MAX_LEVEL } from "./chess-ai.mjs";

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (err) {
    failed += 1;
    failures.push({ name, err });
    console.error(`FAIL - ${name}`);
    console.error(`      ${err && err.message ? err.message : err}`);
  }
}

function stateFromRows(rows, turn, opts = {}) {
  if (rows.length !== 8 || rows.some((r) => r.length !== 8)) {
    throw new Error("bad test board dimensions");
  }
  const board = rows.map((line) =>
    [...line].map((ch) => {
      if (ch === ".") return null;
      const isUpper = ch >= "A" && ch <= "Z";
      return { type: ch.toLowerCase(), color: isUpper ? "w" : "b" };
    })
  );
  return {
    board,
    turn,
    castling: {
      wK: false,
      wQ: false,
      bK: false,
      bQ: false,
      ...(opts.castling ?? {}),
    },
    enPassant: opts.enPassant ?? null,
    halfmoveClock: opts.halfmoveClock ?? 0,
    fullmoveNumber: opts.fullmoveNumber ?? 1,
  };
}

function canonicalMove(move) {
  return JSON.stringify([
    move.from,
    move.to,
    move.promotion ?? null,
    move.piece,
    move.captured ?? null,
    Boolean(move.isEnPassant),
    move.isCastle ?? null,
  ]);
}

function isInList(move, list) {
  return list.some((m) => canonicalMove(m) === canonicalMove(move));
}

function allLevels() {
  const levels = [];
  for (let l = AI_MIN_LEVEL; l <= AI_MAX_LEVEL; l++) levels.push(l);
  return levels;
}

test("exported level bounds span 1..10", () => {
  assert.equal(AI_MIN_LEVEL, 1);
  assert.equal(AI_MAX_LEVEL, 10);
});

test("L1 and L10 return a legal engine move from the initial position", () => {
  const initial = createInitialState();
  const legal = generateLegalMoves(initial);
  assert.ok(legal.length > 0);
  for (const level of [1, 10]) {
    const move = chooseMove(initial, level);
    assert.ok(move, `L${level} returned null`);
    assert.ok(
      isInList(move, legal),
      `L${level} move is not one of generateLegalMoves`
    );
    assert.notEqual(getGameStatus(applyMove(initial, move)).status, "invalid");
  }
});

test("every level returns a legal engine move from varied positions", () => {
  const positions = [
    stateFromRows(
      [
        "....k...",
        "........",
        "........",
        "...q....",
        "........",
        "........",
        "........",
        "...RK...",
      ],
      "w"
    ),
    stateFromRows(
      [
        ".......k",
        ".......p",
        "........",
        "...pP...",
        "........",
        "........",
        "........",
        "....K...",
      ],
      "w",
      { enPassant: { row: 2, col: 3 } }
    ),
    stateFromRows(
      [
        "....k...",
        "P.......",
        "........",
        "........",
        "........",
        "........",
        "........",
        "....K...",
      ],
      "w"
    ),
  ];
  for (const pos of positions) {
    const legal = generateLegalMoves(pos);
    for (const level of allLevels()) {
      const move = chooseMove(pos, level);
      assert.ok(move, `L${level} returned null on an ongoing position`);
      assert.ok(isInList(move, legal), `L${level} move not in legal list`);
    }
  }
});

test("chooseMove never mutates the supplied state or nested data", () => {
  const cases = [
    { state: createInitialState(), levels: [1, 5, 10] },
    {
      state: stateFromRows(
        [
          "....k...",
          "........",
          "........",
          "...q....",
          "........",
          "........",
          "........",
          "...RK...",
        ],
        "w"
      ),
      levels: [1, 10],
    },
  ];
  for (const { state, levels } of cases) {
    const before = JSON.stringify(state);
    for (const level of levels) {
      chooseMove(state, level);
      assert.equal(JSON.stringify(state), before, `mutation at L${level}`);
    }
    const parsedBefore = JSON.parse(before);
    assert.deepStrictEqual(state.board, parsedBefore.board);
    assert.deepStrictEqual(state.castling, parsedBefore.castling);
    assert.strictEqual(state.enPassant, parsedBefore.enPassant);
  }
});

test("identical state and level always produce the identical move", () => {
  const initial = createInitialState();
  for (const level of allLevels()) {
    const a = chooseMove(initial, level);
    const b = chooseMove(initial, level);
    assert.ok(a, `L${level} returned null`);
    assert.equal(canonicalMove(a), canonicalMove(b), `L${level} nondeterminism`);
  }
  const epPos = stateFromRows(
    [
      ".......k",
      ".......p",
      "........",
      "...pP...",
      "........",
      "........",
      "........",
      "....K...",
    ],
    "w",
    { enPassant: { row: 2, col: 3 } }
  );
  for (const level of [1, 4, 7, 10]) {
    const a = chooseMove(epPos, level);
    const b = chooseMove(epPos, level);
    assert.equal(canonicalMove(a), canonicalMove(b));
  }
});

test("checkmate-to-move position returns null at every sampled level", () => {
  let s = createInitialState();
  s = applyMove(s, { from: [6, 5], to: [5, 5] });
  s = applyMove(s, { from: [1, 4], to: [3, 4] });
  s = applyMove(s, { from: [6, 6], to: [4, 6] });
  s = applyMove(s, { from: [0, 3], to: [4, 7] });
  assert.equal(getGameStatus(s).status, "checkmate");
  for (const level of [1, 5, 10]) {
    assert.equal(chooseMove(s, level), null, `expected null at L${level}`);
  }
});

test("stalemate-to-move position returns null at every sampled level", () => {
  const s = stateFromRows(
    [
      ".......k",
      ".....Q..",
      "........",
      "........",
      "........",
      "........",
      "........",
      "K.......",
    ],
    "b"
  );
  assert.equal(getGameStatus(s).status, "stalemate");
  for (const level of [1, 5, 10]) {
    assert.equal(chooseMove(s, level), null);
  }
});

test("invalid or unusable inputs return null", () => {
  const kingless = stateFromRows(
    [
      "r.......",
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
      "K.......",
    ],
    "w"
  );
  assert.equal(getGameStatus(kingless).status, "invalid");
  for (const level of [1, 5, 10]) {
    assert.equal(chooseMove(kingless, level), null);
  }
  assert.equal(chooseMove(null, 3), null);
  assert.equal(chooseMove(undefined, 3), null);
  assert.equal(chooseMove({}, 3), null);
  assert.equal(chooseMove({ board: [] }, 3), null);
});

test("an immediately available checkmate is chosen at every level", () => {
  const s = stateFromRows(
    [
      ".......k",
      "......pp",
      "........",
      "........",
      "........",
      "........",
      "........",
      "R......K",
    ],
    "w"
  );
  assert.equal(getGameStatus(s).status, "ongoing");
  for (const level of allLevels()) {
    const move = chooseMove(s, level);
    assert.ok(move, `L${level} returned null`);
    assert.deepEqual(move.from, [7, 0], `L${level} wrong origin`);
    assert.deepEqual(move.to, [0, 0], `L${level} did not deliver mate`);
    assert.equal(getGameStatus(applyMove(s, move)).status, "checkmate");
  }
});

test("moves allowing opponent mate-in-one are avoided when a safe alternative exists", () => {
  // Fool's-mate geometry: black threatens Qh4#. Nearly every white move
  // allows it; Nf3/Nh3 defend. Sets are classified via the rules engine.
  const s = stateFromRows(
    [
      "rnbqkbnr",
      "pppp.ppp",
      "........",
      "...p....",
      "........",
      "........",
      "PPPPP..P",
      "RNBQKBN.",
    ],
    "w"
  );
  const legal = generateLegalMoves(s);
  const unsafe = [];
  const safe = [];
  for (const move of legal) {
    const child = applyMove(s, move);
    const replies = generateLegalMoves(child);
    const losesToMateInOne = replies.some(
      (reply) => getGameStatus(applyMove(child, reply)).status === "checkmate"
    );
    (losesToMateInOne ? unsafe : safe).push(move);
  }
  assert.ok(unsafe.length > 0, "position lacks an unsafe move");
  assert.ok(safe.length > 0, "position lacks a safe alternative");

  const knightGuard = safe.find((m) => m.piece === "n" && m.to[1] === 5 && m.from[0] === 7);
  assert.ok(knightGuard, "Nf3 should be among the safe moves");

  for (const level of allLevels()) {
    const move = chooseMove(s, level);
    assert.ok(move, `L${level} returned null`);
    assert.ok(
      isInList(move, safe),
      `L${level} chose a move that allows opponent mate-in-one: ${canonicalMove(move)}`
    );
  }
});

test("promotion position: L10 promotes to queen and every level stays legal", () => {
  const s = stateFromRows(
    [
      "....k...",
      "P.......",
      "........",
      "........",
      "........",
      "........",
      "........",
      "....K...",
    ],
    "w"
  );
  const legal = generateLegalMoves(s);
  const promoMoves = legal.filter((m) => m.from[0] === 1 && m.to[0] === 0);
  assert.deepEqual(
    promoMoves.map((m) => m.promotion).sort(),
    ["b", "n", "q", "r"]
  );
  for (const level of allLevels()) {
    const move = chooseMove(s, level);
    assert.ok(move, `L${level} returned null`);
    assert.ok(isInList(move, legal), `L${level} illegal move`);
  }
  const best = chooseMove(s, 10);
  assert.deepEqual(best.from, [1, 0]);
  assert.deepEqual(best.to, [0, 0]);
  assert.equal(best.promotion, "q");
});

test("en passant position: L10 captures en passant and every level stays legal", () => {
  const s = stateFromRows(
    [
      ".......k",
      ".......p",
      "........",
      "...pP...",
      "........",
      "........",
      "........",
      "....K...",
    ],
    "w",
    { enPassant: { row: 2, col: 3 } }
  );
  const legal = generateLegalMoves(s);
  const ep = legal.find((m) => m.isEnPassant);
  assert.ok(ep, "rules engine should offer en passant here");
  assert.deepEqual(ep.from, [3, 4]);
  assert.deepEqual(ep.to, [2, 3]);
  for (const level of allLevels()) {
    const move = chooseMove(s, level);
    assert.ok(move, `L${level} returned null`);
    assert.ok(isInList(move, legal), `L${level} illegal move`);
  }
  const best = chooseMove(s, 10);
  assert.equal(best.isEnPassant, true, "L10 should capture en passant");
  assert.deepEqual(best.to, [2, 3]);
  assert.equal(best.captured, "p");
});

test("graduated play: L1 stays quiet while L10 grabs the hanging queen", () => {
  const s = stateFromRows(
    [
      "....k...",
      "........",
      "........",
      "...q....",
      "........",
      "........",
      "........",
      "...RK...",
    ],
    "w"
  );
  const quiet = chooseMove(s, 1);
  assert.ok(quiet, "L1 returned null");
  assert.equal(quiet.captured, null, "L1 should make a quiet restricted move");

  const strong = chooseMove(s, 10);
  assert.ok(strong, "L10 returned null");
  assert.equal(strong.piece, "r");
  assert.deepEqual(strong.from, [7, 3]);
  assert.deepEqual(strong.to, [3, 3]);
  assert.equal(strong.captured, "q");
});

test("searching levels find and verify the forced mate in two", () => {
  // Two-rook ladder: Ra7/Rg7 cuts rank 7, then the other rook mates on
  // rank 8 from the opposite wing (the king can never reach the mating
  // rook, and every flight square is covered).
  const s = stateFromRows(
    [
      "...k....",
      "........",
      "........",
      "........",
      "........",
      "........",
      "......R.",
      "R......K",
    ],
    "w"
  );
  assert.equal(getGameStatus(s).status, "ongoing");

  const keys = [
    { from: [7, 0], to: [1, 0] }, // Ra7
    { from: [6, 6], to: [1, 6] }, // Rg7
  ];
  function forcesMateInTwo(move) {
    const afterKey = applyMove(s, move);
    const replies = generateLegalMoves(afterKey);
    if (replies.length === 0) return false;
    return replies.every((reply) => {
      const afterReply = applyMove(afterKey, reply);
      return generateLegalMoves(afterReply).some(
        (finish) => getGameStatus(applyMove(afterReply, finish)).status === "checkmate"
      );
    });
  }

  let sawKey = false;
  for (const level of [7, 8, 9, 10]) {
    const move = chooseMove(s, level);
    assert.ok(move, `L${level} returned null`);
    const isKey = keys.some(
      (k) => k.from[0] === move.from[0] && k.from[1] === move.from[1] &&
             k.to[0] === move.to[0] && k.to[1] === move.to[1]
    );
    assert.ok(isKey, `L${level} missed the forced mate-in-two key`);
    assert.ok(forcesMateInTwo(move), `L${level} key does not force mate`);
    sawKey = true;
  }
  assert.ok(sawKey);
});

test("terminal draw positions (dead material, 75-move clock, fivefold) return null", () => {
  const bareKings = stateFromRows(
    [
      "....k...",
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
      "....K...",
    ],
    "w"
  );
  assert.equal(getGameStatus(bareKings).status, "insufficient");
  const rookEnd75 = stateFromRows(
    [
      ".......k",
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
      "R......K",
    ],
    "w",
    { halfmoveClock: 150 }
  );
  assert.equal(getGameStatus(rookEnd75).status, "seventyfive");
  const fivefold = stateFromRows(
    [
      ".......k",
      "........",
      "........",
      "........",
      "........",
      "........",
      "......R.",
      "R......K",
    ],
    "w"
  );
  assert.equal(getGameStatus(fivefold, { repetitionCount: 5 }).status, "fivefold");
  for (const level of allLevels()) {
    assert.equal(chooseMove(bareKings, level), null, `L${level} moved in a dead position`);
    assert.equal(chooseMove(rookEnd75, level), null, `L${level} moved past the 75-move rule`);
    assert.equal(
      chooseMove(fivefold, level, { repetitionCount: 5 }),
      null,
      `L${level} ignored repetition context`
    );
  }
});

test("AI keeps playing endings that are drawable but not dead (two knights)", () => {
  const twoKnights = stateFromRows(
    [
      "....k...",
      "........",
      "........",
      "........",
      "........",
      "N......N",
      "........",
      "....K...",
    ],
    "w"
  );
  assert.equal(getGameStatus(twoKnights).status, "ongoing");
  for (const level of allLevels()) {
    const move = chooseMove(twoKnights, level);
    assert.ok(move, `L${level} returned null in a live ending`);
    assert.ok(isInList(move, generateLegalMoves(twoKnights)), `L${level} illegal move`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) {
    console.error(`failed: ${f.name}`);
  }
  process.exitCode = 1;
}

