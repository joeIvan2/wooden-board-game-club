import assert from "node:assert/strict";
import {
  createInitialState,
  generateLegalMoves,
  applyMove,
} from "./chess.mjs";
import { formatSan, squareName } from "./chess-notation.mjs";

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

function mv(from, to, promotion = null) {
  return { from, to, promotion };
}

function findMove(moves, from, to, promotion = null) {
  return moves.find(
    (m) =>
      m.from[0] === from[0] &&
      m.from[1] === from[1] &&
      m.to[0] === to[0] &&
      m.to[1] === to[1] &&
      (m.promotion ?? null) === promotion
  );
}

test("squareName converts row/col to algebraic names", () => {
  assert.equal(squareName([6, 4]), "e2");
  assert.equal(squareName([0, 7]), "h8");
  assert.equal(squareName([7, 0]), "a1");
});

test("quiet pawn push and knight move produce bare SAN", () => {
  const initial = createInitialState();
  assert.equal(formatSan(initial, findMove(generateLegalMoves(initial), [6, 4], [4, 4])), "e4");
  assert.equal(formatSan(initial, findMove(generateLegalMoves(initial), [7, 6], [5, 5])), "Nf3");
});

test("fool's mate final queen move is Qh4#", () => {
  let s = createInitialState();
  s = applyMove(s, mv([6, 5], [5, 5]));
  s = applyMove(s, mv([1, 4], [3, 4]));
  s = applyMove(s, mv([6, 6], [4, 6]));
  const mate = findMove(generateLegalMoves(s), [0, 3], [4, 7]);
  assert.equal(formatSan(s, mate), "Qh4#");
});

test("pawn capture uses origin file: exd5", () => {
  const s = stateFromRows(
    [
      ".......k",
      "........",
      "........",
      "...n....",
      "....P...",
      "........",
      "........",
      "K.......",
    ],
    "w"
  );
  const cap = findMove(generateLegalMoves(s), [4, 4], [3, 3]);
  assert.equal(formatSan(s, cap), "exd5");
});

test("en passant capture is written exd6", () => {
  const s = stateFromRows(
    [
      ".......k",
      "........",
      "........",
      "...pP...",
      "........",
      "........",
      "........",
      "K.......",
    ],
    "w",
    { enPassant: { row: 2, col: 3 } }
  );
  const ep = findMove(generateLegalMoves(s), [3, 4], [2, 3]);
  assert.equal(formatSan(s, ep), "exd6");
});

test("castling is written O-O and O-O-O", () => {
  const s = stateFromRows(
    [
      ".k......",
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
      "R...K..R",
    ],
    "w",
    { castling: { wK: true, wQ: true } }
  );
  assert.equal(formatSan(s, findMove(generateLegalMoves(s), [7, 4], [7, 6])), "O-O");
  assert.equal(formatSan(s, findMove(generateLegalMoves(s), [7, 4], [7, 2])), "O-O-O");
});

test("promotion with check is e8=Q+ and quiet promotion is e8=Q", () => {
  const checking = stateFromRows(
    [
      ".......k",
      "....P...",
      "........",
      "........",
      "........",
      "........",
      "........",
      "....K...",
    ],
    "w"
  );
  const promoCheck = findMove(generateLegalMoves(checking), [1, 4], [0, 4], "q");
  assert.equal(formatSan(checking, promoCheck), "e8=Q+");

  const quiet = stateFromRows(
    [
      "........",
      "....P...",
      "........",
      "........",
      "........",
      ".......k",
      "........",
      "....K...",
    ],
    "w"
  );
  const promoQuiet = findMove(generateLegalMoves(quiet), [1, 4], [0, 4], "q");
  assert.equal(formatSan(quiet, promoQuiet), "e8=Q");
});

test("rooks sharing a file disambiguate by rank: R1a3", () => {
  const s = stateFromRows(
    [
      ".......k",
      "........",
      "........",
      "R.......",
      "........",
      "........",
      "....K...",
      "R.......",
    ],
    "w"
  );
  const lower = findMove(generateLegalMoves(s), [7, 0], [5, 0]);
  const upper = findMove(generateLegalMoves(s), [3, 0], [5, 0]);
  assert.equal(formatSan(s, lower), "R1a3");
  assert.equal(formatSan(s, upper), "R5a3");
});

test("knights on b1 and f3 disambiguate by file: Nbd2", () => {
  const s = stateFromRows(
    [
      ".......k",
      "........",
      "........",
      "........",
      "........",
      ".....N..",
      "........",
      ".N..K...",
    ],
    "w"
  );
  const move = findMove(generateLegalMoves(s), [7, 1], [6, 3]);
  assert.equal(formatSan(s, move), "Nbd2");
});

test("formatSan does not mutate the position", () => {
  const initial = createInitialState();
  const before = JSON.stringify(initial);
  formatSan(initial, findMove(generateLegalMoves(initial), [6, 4], [4, 4]));
  assert.equal(JSON.stringify(initial), before);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) {
    console.error(`failed: ${f.name}`);
  }
  process.exitCode = 1;
}
