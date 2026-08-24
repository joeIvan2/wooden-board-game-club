import assert from "node:assert/strict";
import {
  createInitialState,
  generateLegalMoves,
  applyMove,
  getGameStatus,
  positionKey,
  createRepetitionTracker,
  claimableDraws,
} from "./chess.mjs";

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

function snapshot(state) {
  return JSON.stringify(state);
}

test("initial position has exactly 20 legal moves", () => {
  const moves = generateLegalMoves(createInitialState());
  assert.equal(moves.length, 20);
});

test("initial legal moves include pawn advances and knight hops only where unblocked", () => {
  const moves = generateLegalMoves(createInitialState());
  assert.ok(findMove(moves, [6, 4], [5, 4]));
  assert.ok(findMove(moves, [6, 4], [4, 4]));
  assert.ok(findMove(moves, [7, 6], [5, 5]));
  assert.ok(findMove(moves, [7, 1], [5, 0]));
  assert.ok(!findMove(moves, [7, 3], [5, 3]));
  assert.ok(!findMove(moves, [7, 5], [5, 3]));
  assert.ok(!findMove(moves, [7, 5], [5, 7]));
  assert.ok(!findMove(moves, [6, 4], [3, 4]));
});

test("initial game status is ongoing with nobody in check", () => {
  const status = getGameStatus(createInitialState());
  assert.deepStrictEqual(status, {
    status: "ongoing",
    inCheck: false,
    winner: null,
  });
});

test("generateLegalMoves does not mutate the input state", () => {
  const s = createInitialState();
  const before = snapshot(s);
  generateLegalMoves(s);
  generateLegalMoves(s);
  assert.equal(snapshot(s), before);
});

test("applyMove does not mutate the input state and returns an independent new state", () => {
  const s = createInitialState();
  const before = snapshot(s);
  const next = applyMove(s, mv([6, 4], [4, 4]));
  assert.equal(snapshot(s), before);
  assert.notEqual(next, s);
  assert.notEqual(next.board, s.board);
  next.turn = "w";
  next.board[0][0] = { type: "q", color: "w" };
  assert.equal(snapshot(s), before);
});

test("knights jump over blockers and sliders stop at them", () => {
  const s = stateFromRows(
    [
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
      ".......p",
      "K....NR.",
    ],
    "w"
  );
  const moves = generateLegalMoves(s);
  const knightDests = moves
    .filter((m) => m.piece === "n")
    .map((m) => `${m.to[0]},${m.to[1]}`)
    .sort();
  assert.deepEqual(knightDests, ["5,4", "5,6", "6,3", "6,7"]);
  const capKnight = findMove(moves, [7, 5], [6, 7]);
  assert.equal(capKnight.captured, "p");
  assert.ok(findMove(moves, [7, 6], [0, 6]));
  assert.ok(findMove(moves, [7, 6], [7, 7]));
  assert.ok(!findMove(moves, [7, 6], [7, 5]));
});

test("king moves one step and may capture an undefended piece", () => {
  const s = stateFromRows(
    [
      "k.......",
      "........",
      "........",
      "...nK...",
      "........",
      "........",
      "........",
      "........",
    ],
    "w"
  );
  const moves = generateLegalMoves(s);
  const cap = findMove(moves, [3, 4], [3, 3]);
  assert.ok(cap);
  assert.equal(cap.captured, "n");
  assert.ok(findMove(moves, [3, 4], [2, 4]));
  assert.ok(!findMove(moves, [3, 4], [1, 4]));
});

test("absolutely pinned knight cannot move at all", () => {
  const s = stateFromRows(
    [
      "k...r...",
      "........",
      "........",
      "........",
      "....N...",
      "........",
      "........",
      "....K...",
    ],
    "w"
  );
  const moves = generateLegalMoves(s);
  assert.ok(moves.every((m) => m.piece !== "n"));
  assert.ok(findMove(moves, [7, 4], [7, 3]));
});

test("pinned rook may slide along the pin ray but not off it", () => {
  const s = stateFromRows(
    [
      "....r...",
      "........",
      "........",
      "........",
      "........",
      "........",
      "....R...",
      "....K...",
    ],
    "w"
  );
  const moves = generateLegalMoves(s);
  const rookMoves = moves.filter((m) => m.piece === "r");
  assert.equal(rookMoves.length, 6);
  const escapeCapture = findMove(moves, [6, 4], [0, 4]);
  assert.ok(escapeCapture);
  assert.equal(escapeCapture.captured, "r");
  assert.ok(findMove(moves, [6, 4], [2, 4]));
  assert.ok(!findMove(moves, [6, 4], [6, 3]));
  assert.ok(!findMove(moves, [6, 4], [6, 5]));
});

test("king may not step onto a square still on the attacker's ray", () => {
  const s = stateFromRows(
    [
      "....r...",
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
  const moves = generateLegalMoves(s);
  assert.ok(!findMove(moves, [7, 4], [6, 4]));
  assert.ok(findMove(moves, [7, 4], [7, 3]));
  assert.ok(findMove(moves, [7, 4], [6, 3]));
  assert.ok(findMove(moves, [7, 4], [6, 5]));
});

test("fool's mate is recognised as checkmate for black", () => {
  let s = createInitialState();
  s = applyMove(s, mv([6, 5], [5, 5]));
  s = applyMove(s, mv([1, 4], [3, 4]));
  s = applyMove(s, mv([6, 6], [4, 6]));
  const beforeMate = getGameStatus(s);
  assert.equal(beforeMate.status, "ongoing");
  s = applyMove(s, mv([0, 3], [4, 7]));
  const status = getGameStatus(s);
  assert.deepStrictEqual(status, {
    status: "checkmate",
    inCheck: true,
    winner: "b",
  });
});

test("queen-only corner position is stalemate, not checkmate", () => {
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
  const status = getGameStatus(s);
  assert.deepStrictEqual(status, {
    status: "stalemate",
    inCheck: false,
    winner: null,
  });
});

test("white can castle kingside and queenside when path is clear and safe", () => {
  const s = stateFromRows(
    [
      ".......k",
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
  const moves = generateLegalMoves(s);
  const kingSide = findMove(moves, [7, 4], [7, 6]);
  const queenSide = findMove(moves, [7, 4], [7, 2]);
  assert.ok(kingSide && kingSide.isCastle === "k");
  assert.ok(queenSide && queenSide.isCastle === "q");
  const afterK = applyMove(s, mv([7, 4], [7, 6]));
  assert.equal(afterK.board[7][6].type, "k");
  assert.equal(afterK.board[7][6].color, "w");
  assert.equal(afterK.board[7][5].type, "r");
  assert.equal(afterK.board[7][4], null);
  assert.equal(afterK.board[7][7], null);
  assert.equal(afterK.castling.wK, false);
  assert.equal(afterK.castling.wQ, false);
  assert.equal(afterK.turn, "b");
  const afterQ = applyMove(s, mv([7, 4], [7, 2]));
  assert.equal(afterQ.board[7][2].type, "k");
  assert.equal(afterQ.board[7][3].type, "r");
  assert.equal(afterQ.board[7][0], null);
});

test("black can castle on both sides symmetrically", () => {
  const s = stateFromRows(
    [
      "r...k..r",
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
      "....K...",
    ],
    "b",
    { castling: { bK: true, bQ: true } }
  );
  const moves = generateLegalMoves(s);
  assert.ok(findMove(moves, [0, 4], [0, 6]));
  assert.ok(findMove(moves, [0, 4], [0, 2]));
  const afterK = applyMove(s, mv([0, 4], [0, 6]));
  assert.equal(afterK.board[0][6].type, "k");
  assert.equal(afterK.board[0][6].color, "b");
  assert.equal(afterK.board[0][5].type, "r");
  assert.equal(afterK.turn, "w");
});

test("castling through an attacked square is forbidden but the other wing stays legal", () => {
  const f8Rook = stateFromRows(
    [
      ".....r.k",
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
  const fMoves = generateLegalMoves(f8Rook);
  assert.ok(!findMove(fMoves, [7, 4], [7, 6]));
  assert.ok(findMove(fMoves, [7, 4], [7, 2]));

  const d8Rook = stateFromRows(
    [
      "...r...k",
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
  const dMoves = generateLegalMoves(d8Rook);
  assert.ok(!findMove(dMoves, [7, 4], [7, 2]));
  assert.ok(findMove(dMoves, [7, 4], [7, 6]));
  assert.throws(() => applyMove(d8Rook, mv([7, 4], [7, 2])), /Illegal move/);

  const e8Rook = stateFromRows(
    [
      "....r..k",
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
  const eMoves = generateLegalMoves(e8Rook);
  assert.ok(!findMove(eMoves, [7, 4], [7, 6]));
  assert.ok(!findMove(eMoves, [7, 4], [7, 2]));
});

test("attack on b1 alone does not forbid queenside castling", () => {
  const s = stateFromRows(
    [
      ".r.....k",
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
  const moves = generateLegalMoves(s);
  assert.ok(findMove(moves, [7, 4], [7, 2]));
  assert.ok(findMove(moves, [7, 4], [7, 6]));
});

test("moving king or rook forfeits the corresponding castling rights", () => {
  const kingWalk = stateFromRows(
    [
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
      "....K..R",
    ],
    "w",
    { castling: { wK: true, wQ: true } }
  );
  const afterKing = applyMove(kingWalk, mv([7, 4], [6, 4]));
  assert.equal(afterKing.castling.wK, false);
  assert.equal(afterKing.castling.wQ, false);

  const rookWalk = stateFromRows(
    [
      "........",
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
  const afterRook = applyMove(rookWalk, mv([7, 0], [5, 0]));
  assert.equal(afterRook.castling.wQ, false);
  assert.equal(afterRook.castling.wK, true);
});

test("en passant capture is available immediately after a double push and removes the passed pawn", () => {
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
  assert.ok(ep);
  assert.equal(ep.isEnPassant, true);
  assert.equal(ep.captured, "p");
  const next = applyMove(s, mv([3, 4], [2, 3]));
  assert.equal(next.board[2][3].type, "p");
  assert.equal(next.board[2][3].color, "w");
  assert.equal(next.board[3][3], null);
  assert.equal(next.board[3][4], null);
  assert.equal(next.enPassant, null);
  assert.equal(next.turn, "b");

  const noEpState = stateFromRows(
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
    "w"
  );
  assert.ok(!findMove(generateLegalMoves(noEpState), [3, 4], [2, 3]));
});

test("en passant right expires once the immediate reply is spent", () => {
  let s = createInitialState();
  s = applyMove(s, mv([6, 4], [4, 4]));
  s = applyMove(s, mv([1, 0], [2, 0]));
  s = applyMove(s, mv([4, 4], [3, 4]));
  s = applyMove(s, mv([1, 3], [3, 3]));
  assert.deepStrictEqual(s.enPassant, { row: 2, col: 3 });
  assert.ok(findMove(generateLegalMoves(s), [3, 4], [2, 3]));
  const skipped = applyMove(s, mv([7, 6], [5, 5]));
  assert.equal(skipped.enPassant, null);
  assert.ok(!findMove(generateLegalMoves(skipped), [3, 4], [2, 3]));
  assert.throws(() => applyMove(skipped, mv([3, 4], [2, 3])), /Illegal move/);
});

test("en passant capture that would expose own king along the rank is illegal", () => {
  const pinned = stateFromRows(
    [
      "k.......",
      "........",
      "........",
      "r.pPK...",
      "........",
      "........",
      "........",
      "........",
    ],
    "w",
    { enPassant: { row: 2, col: 2 } }
  );
  const pinnedMoves = generateLegalMoves(pinned);
  assert.ok(!findMove(pinnedMoves, [3, 3], [2, 2]));
  assert.ok(findMove(pinnedMoves, [3, 3], [2, 3]));

  const free = stateFromRows(
    [
      "k.......",
      "........",
      "........",
      "..pPK...",
      "........",
      "........",
      "........",
      "........",
    ],
    "w",
    { enPassant: { row: 2, col: 2 } }
  );
  assert.ok(findMove(generateLegalMoves(free), [3, 3], [2, 2]));
});

test("pawn reaching last rank offers exactly four promotion choices on push and capture", () => {
  const s = stateFromRows(
    [
      ".b.....k",
      "P.......",
      "........",
      "........",
      "........",
      "........",
      "........",
      "......K.",
    ],
    "w"
  );
  const moves = generateLegalMoves(s);
  const pushPromos = moves.filter(
    (m) => m.from[0] === 1 && m.from[1] === 0 && m.to[0] === 0 && m.to[1] === 0
  );
  const capPromos = moves.filter(
    (m) => m.from[0] === 1 && m.from[1] === 0 && m.to[0] === 0 && m.to[1] === 1
  );
  assert.deepEqual(
    pushPromos.map((m) => m.promotion).sort(),
    ["b", "n", "q", "r"]
  );
  assert.deepEqual(
    capPromos.map((m) => m.promotion).sort(),
    ["b", "n", "q", "r"]
  );
  assert.ok(!findMove(moves, [1, 0], [0, 0], null));
});

test("each promotion choice applies as the correct piece", () => {
  const base = () =>
    stateFromRows(
      [
        ".b.....k",
        "P.......",
        "........",
        "........",
        "........",
        "........",
        "........",
        "......K.",
      ],
      "w"
    );
  const q = applyMove(base(), mv([1, 0], [0, 0], "q"));
  assert.equal(q.board[0][0].type, "q");
  assert.equal(q.board[0][0].color, "w");
  const r = applyMove(base(), mv([1, 0], [0, 0], "r"));
  assert.equal(r.board[0][0].type, "r");
  const b = applyMove(base(), mv([1, 0], [0, 0], "b"));
  assert.equal(b.board[0][0].type, "b");
  const n = applyMove(base(), mv([1, 0], [0, 1], "n"));
  assert.equal(n.board[0][1].type, "n");
  assert.equal(n.board[0][1].color, "w");
  assert.equal(n.board[0][0], null);
  assert.throws(() => applyMove(base(), mv([1, 0], [0, 0], "x")), /Illegal move/);
  assert.throws(() => applyMove(base(), mv([1, 0], [0, 0], null)), /Illegal move/);
});

test("black pawn also gets all four promotion choices", () => {
  const s = stateFromRows(
    [
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
      ".p......",
      "......K.",
    ],
    "b"
  );
  const moves = generateLegalMoves(s);
  assert.equal(moves.length, 4);
  assert.deepEqual(
    moves.map((m) => m.promotion).sort(),
    ["b", "n", "q", "r"]
  );
});

test("engine never generates or accepts a move capturing the opposing king", () => {
  const s = stateFromRows(
    [
      "....r...",
      "........",
      "........",
      "....k..R",
      "........",
      "........",
      "........",
      "K.......",
    ],
    "w"
  );
  const moves = generateLegalMoves(s);
  assert.ok(moves.length > 0);
  assert.ok(moves.every((m) => m.captured !== "k"));
  assert.ok(!findMove(moves, [3, 7], [3, 4]));
  assert.throws(() => applyMove(s, mv([3, 7], [3, 4])), /Illegal move/);
});

test("missing king is never reported as a valid stalemate or ongoing game", () => {
  const blackKinglessNoMoves = stateFromRows(
    [
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
      "P.......",
      "K.......",
    ],
    "b"
  );
  const statusA = getGameStatus(blackKinglessNoMoves);
  assert.notEqual(statusA.status, "stalemate");
  assert.notEqual(statusA.status, "checkmate");
  assert.notEqual(statusA.status, "ongoing");
  assert.equal(statusA.status, "invalid");

  const whiteToMoveBlackKingless = stateFromRows(
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
  const statusB = getGameStatus(whiteToMoveBlackKingless);
  assert.notEqual(statusB.status, "stalemate");
  assert.notEqual(statusB.status, "ongoing");
  assert.equal(statusB.status, "invalid");
  assert.equal(statusB.winner, null);
});

test("legal move application updates board, turn, clocks and en passant correctly", () => {
  const initial = createInitialState();
  const afterE4 = applyMove(initial, mv([6, 4], [4, 4]));
  assert.equal(afterE4.board[6][4], null);
  assert.equal(afterE4.board[4][4].type, "p");
  assert.equal(afterE4.board[4][4].color, "w");
  assert.equal(afterE4.turn, "b");
  assert.equal(afterE4.halfmoveClock, 0);
  assert.equal(afterE4.fullmoveNumber, 1);
  assert.deepStrictEqual(afterE4.enPassant, { row: 5, col: 4 });
  assert.equal(afterE4.castling.wK, true);
  assert.equal(afterE4.castling.bQ, true);
  const afterNf6 = applyMove(afterE4, mv([0, 6], [2, 5]));
  assert.equal(afterNf6.turn, "w");
  assert.equal(afterNf6.halfmoveClock, 1);
  assert.equal(afterNf6.fullmoveNumber, 2);
  assert.equal(afterNf6.enPassant, null);
});

test("applyMove throws for illegal, blocked, wrong-turn and non-existent moves", () => {
  const initial = createInitialState();
  assert.throws(() => applyMove(initial, mv([6, 4], [3, 4])), /Illegal move/);
  assert.throws(() => applyMove(initial, mv([7, 4], [6, 4])), /Illegal move/);
  assert.throws(() => applyMove(initial, mv([1, 4], [3, 4])), /Illegal move/);
  assert.throws(() => applyMove(initial, mv([7, 3], [5, 3])), /Illegal move/);
});

test("side to move must answer an existing check; ignoring it is rejected", () => {
  const s = stateFromRows(
    [
      "r...k...",
      "......p.",
      "........",
      ".......Q",
      "........",
      "........",
      "........",
      "....K...",
    ],
    "b"
  );
  const status = getGameStatus(s);
  assert.equal(status.inCheck, true);
  assert.equal(status.status, "ongoing");
  assert.ok(findMove(generateLegalMoves(s), [1, 6], [2, 6]));
  assert.throws(() => applyMove(s, mv([0, 0], [0, 1])), /Illegal move/);
  const block = applyMove(s, mv([1, 6], [2, 6]));
  assert.equal(getGameStatus(block).inCheck, false);
});

// ---------- 特殊和棋規則：局面同一性（positionKey） ----------

function cloneWith(state, patch) {
  return { ...state, ...patch };
}

function knightShuffleOnce(s) {
  s = applyMove(s, mv([7, 6], [5, 5])); // Ng1-f3
  s = applyMove(s, mv([0, 6], [2, 5])); // Ng8-f6
  s = applyMove(s, mv([5, 5], [7, 6])); // Nf3-g1
  s = applyMove(s, mv([2, 5], [0, 6])); // Nf6-g8
  return s;
}

test("positionKey: transposed return to the initial position is the identical key", () => {
  let s = createInitialState();
  const initialKey = positionKey(s);
  for (let i = 0; i < 4; i++) {
    s = knightShuffleOnce(s);
    assert.equal(positionKey(s), initialKey, `round ${i + 1} must repeat the key`);
  }
});

test("positionKey: castling rights distinguish otherwise identical positions", () => {
  const rows = [
    "........",
    "........",
    "........",
    "........",
    "........",
    "........",
    "........",
    "....K..R",
  ];
  const withRights = stateFromRows(rows, "w", { castling: { wK: true } });
  const withoutRights = stateFromRows(rows, "w", {});
  assert.notEqual(positionKey(withRights), positionKey(withoutRights));

  // 由實際著法喪失易位權後，與「同盤面但權利尚在」的局面不得視為同一
  const afterKingMove = applyMove(withRights, mv([7, 4], [6, 4]));
  const sameBoardRightsKept = stateFromRows(
    [
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
      ".....K..",
      "......R.",
    ],
    "b",
    { castling: { wK: true } }
  );
  assert.notEqual(positionKey(afterKingMove), positionKey(sameBoardRightsKept));
});

test("positionKey: side to move distinguishes identical boards", () => {
  const initial = createInitialState();
  assert.notEqual(positionKey(initial), positionKey(cloneWith(initial, { turn: "b" })));
});

test("positionKey: stale (non-capturable) en-passant target does not split repeats", () => {
  // 1.e4：EP 目標 e3 存在，但黑方無兵可吃 → 與無 EP 視為同一局面
  const afterE4 = applyMove(createInitialState(), mv([6, 4], [4, 4]));
  assert.ok(afterE4.enPassant);
  assert.equal(
    positionKey(afterE4),
    positionKey(cloneWith(afterE4, { enPassant: null }))
  );

  // EP 目標存在且看似可吃，但會暴露己王（釘死）→ 同樣不視為相異特徵
  const pinned = stateFromRows(
    [
      "k.......",
      "........",
      "........",
      "r.pPK...",
      "........",
      "........",
      "........",
      "........",
    ],
    "w",
    { enPassant: { row: 2, col: 2 } }
  );
  assert.ok(!findMove(generateLegalMoves(pinned), [3, 3], [2, 2]));
  assert.equal(
    positionKey(pinned),
    positionKey(cloneWith(pinned, { enPassant: null }))
  );
});

test("positionKey: a genuinely legal en-passant capture is a distinct position", () => {
  // 1.e4 Nh6 2.e5 d5：白兵 e5 可真的吃到 d6 過路兵
  let s = createInitialState();
  s = applyMove(s, mv([6, 4], [4, 4]));
  s = applyMove(s, mv([0, 6], [2, 5]));
  s = applyMove(s, mv([4, 4], [3, 4]));
  s = applyMove(s, mv([1, 3], [3, 3]));
  assert.deepStrictEqual(s.enPassant, { row: 2, col: 3 });
  assert.ok(findMove(generateLegalMoves(s), [3, 4], [2, 3]));
  assert.notEqual(
    positionKey(s),
    positionKey(cloneWith(s, { enPassant: null }))
  );
});

test("positionKey: halfmove clock is not part of repetition identity", () => {
  const rookEnd = stateFromRows(
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
    { halfmoveClock: 77 }
  );
  assert.equal(
    positionKey(rookEnd),
    positionKey(cloneWith(rookEnd, { halfmoveClock: 0 }))
  );
});

// ---------- 死局（子力不足，立即判和） ----------

test("bare king endings and single-minor endings are dead draws", () => {
  const cases = [
    ["k.......", "........", "........", "........", "........", "........", "........", "K......."],
    ["k.......", "........", "........", "........", "........", "........", "B.......", "K......."],
    ["k.......", "........", "........", "........", "........", "........", "N.......", "K......."],
  ];
  for (const rows of cases) {
    const status = getGameStatus(stateFromRows(rows, "w"));
    assert.equal(status.status, "insufficient", JSON.stringify(rows[0] + "/" + rows[6]));
    assert.equal(status.winner, null);
  }
});

test("same-coloured bishop endings are dead, opposite colours are not", () => {
  const sameColor = stateFromRows(
    [
      "...kb...",
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
      "....KB..",
    ],
    "w"
  );
  assert.equal(getGameStatus(sameColor).status, "insufficient");

  const oppositeColor = stateFromRows(
    [
      ".....bk.",
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
      "....KB..",
    ],
    "w"
  );
  assert.equal(getGameStatus(oppositeColor).status, "ongoing");
});

test("positions that can still possibly mate are never falsely drawn", () => {
  const alive = [
    // K+雙馬 vs K：存在合作將死，不可判和
    ["k.......", "........", "........", "........", "........", "N......N", "........", "K......."],
    // K+R vs K
    [".......k", "........", "........", "........", "........", "........", "........", "R......K"],
    // KB vs KN
    ["n..k....", "........", "........", "........", "........", "........", "........", "....KB.."],
    // 任何兵在盤上即非死局
    [".......k", "........", "........", "........", "........", "........", "P.......", "K......."],
  ];
  for (const rows of alive) {
    assert.equal(getGameStatus(stateFromRows(rows, "w")).status, "ongoing", rows.join("/"));
  }
});

// ---------- 75 回合 / 五次重複（自動判和）與優先序 ----------

const ROOK_END_ROWS = [
  ".......k",
  "........",
  "........",
  "........",
  "........",
  "........",
  "........",
  "R......K",
];

test("75-move rule: 150 halfmoves draw automatically, 149 do not", () => {
  const at149 = stateFromRows(ROOK_END_ROWS, "w", { halfmoveClock: 149 });
  assert.equal(getGameStatus(at149).status, "ongoing");
  const at150 = stateFromRows(ROOK_END_ROWS, "w", { halfmoveClock: 150 });
  assert.equal(getGameStatus(at150).status, "seventyfive");
  assert.equal(getGameStatus(at150).winner, null);
});

test("an immediately delivered checkmate takes precedence over the 75-move rule", () => {
  // 以實際著法重現 fool's mate，再人工將半步時鐘設為 150
  let mate = createInitialState();
  mate = applyMove(mate, mv([6, 5], [5, 5])); // f3
  mate = applyMove(mate, mv([1, 4], [3, 4])); // e5
  mate = applyMove(mate, mv([6, 6], [4, 6])); // g4
  mate = applyMove(mate, mv([0, 3], [4, 7])); // Qh4#
  const mateAt150 = cloneWith(mate, { halfmoveClock: 150 });
  const status = getGameStatus(mateAt150);
  assert.equal(status.status, "checkmate");
  assert.equal(status.winner, "b");

  // 對照組：同局面在時鐘歸零下同樣是將死（確保合成局面本身正確）
  assert.equal(getGameStatus(cloneWith(mateAt150, { halfmoveClock: 0 })).status, "checkmate");
});

test("fivefold repetition is an automatic draw; four occurrences are not", () => {
  const atFour = stateFromRows(ROOK_END_ROWS, "w", {});
  assert.equal(getGameStatus(atFour, { repetitionCount: 4 }).status, "ongoing");
  const atFive = stateFromRows(ROOK_END_ROWS, "w", {});
  assert.equal(getGameStatus(atFive, { repetitionCount: 5 }).status, "fivefold");
});

test("fivefold repetition also outranks the 75-move clock when both apply", () => {
  const both = stateFromRows(ROOK_END_ROWS, "w", { halfmoveClock: 150 });
  assert.equal(getGameStatus(both, { repetitionCount: 5 }).status, "fivefold");
});

test("checkmate and stalemate keep their immediate precedence over automatic draws", () => {
  const stalemateAt150 = stateFromRows(
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
    "b",
    { halfmoveClock: 150 }
  );
  assert.equal(getGameStatus(stalemateAt150).status, "stalemate");
});

// ---------- 可宣告和棋（三次重複 / 五十步規則） ----------

test("claimableDraws flags threefold at >=3 and fifty-move at >=100 halfmoves", () => {
  const state = stateFromRows(ROOK_END_ROWS, "w", { halfmoveClock: 99 });
  assert.deepEqual(claimableDraws(state, 2), { threefold: false, fiftyMove: false });
  assert.deepEqual(
    claimableDraws(cloneWith(state, { halfmoveClock: 100 }), 2),
    { threefold: false, fiftyMove: true }
  );
  assert.deepEqual(claimableDraws(state, 3), { threefold: true, fiftyMove: false });
  assert.deepEqual(
    claimableDraws(cloneWith(state, { halfmoveClock: 100 }), 3),
    { threefold: true, fiftyMove: true }
  );
});

// ---------- 重複追蹤器生命週期 ----------

test("repetition tracker counts real shuffles and survives undo/reset", () => {
  let s = createInitialState();
  const tracker = createRepetitionTracker();
  tracker.reset(s);
  assert.equal(tracker.countCurrent(), 1);

  s = knightShuffleOnce(s);
  tracker.push(s);
  assert.equal(tracker.countCurrent(), 2);
  s = knightShuffleOnce(s);
  tracker.push(s);
  assert.equal(tracker.countCurrent(), 3);

  // 模擬悔棋前的半步：白方 Ng1-f3 是首次出現的新局面
  s = applyMove(s, mv([7, 6], [5, 5]));
  tracker.push(s);
  assert.equal(tracker.countCurrent(), 1);
  tracker.truncate(1); // 悔去該半步
  assert.equal(tracker.countCurrent(), 3); // 回到第三次重複的初始局面

  // 悔棋後重走一整輪：同一局面第 4 次出現
  s = knightShuffleOnce(createInitialState());
  tracker.push(s);
  assert.equal(tracker.countCurrent(), 4);

  tracker.reset(createInitialState());
  assert.equal(tracker.countCurrent(), 1);
  tracker.truncate(99); // 不得清掉初始局面
  assert.equal(tracker.countCurrent(), 1);
});

test("four full knight-shuffle rounds drive a real game to fivefold status", () => {
  let s = createInitialState();
  const tracker = createRepetitionTracker();
  tracker.reset(s);
  for (let round = 0; round < 4; round++) {
    s = knightShuffleOnce(s);
    tracker.push(s);
    assert.equal(tracker.countCurrent(), round + 2);
  }
  const status = getGameStatus(s, { repetitionCount: tracker.countCurrent() });
  assert.equal(status.status, "fivefold");
  assert.ok(s.halfmoveClock < 100, "scenario must be independent of the 50/75-move clocks");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) {
    console.error(`failed: ${f.name}`);
  }
  process.exitCode = 1;
}
