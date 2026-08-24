const WHITE = "w";
const BLACK = "b";

const KNIGHT_DELTAS = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1],
];
const KING_DELTAS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const PROMOTION_PIECES = ["q", "r", "b", "n"];

function inside(row, col) {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

function opponentOf(color) {
  return color === WHITE ? BLACK : WHITE;
}

export function createInitialState() {
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  const backRank = ["r", "n", "b", "q", "k", "b", "n", "r"];
  for (let col = 0; col < 8; col++) {
    board[0][col] = { type: backRank[col], color: BLACK };
    board[1][col] = { type: "p", color: BLACK };
    board[6][col] = { type: "p", color: WHITE };
    board[7][col] = { type: backRank[col], color: WHITE };
  }
  return {
    board,
    turn: WHITE,
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    enPassant: null,
    halfmoveClock: 0,
    fullmoveNumber: 1,
  };
}

function cloneState(state) {
  return {
    board: state.board.map((row) =>
      row.map((p) => (p ? { type: p.type, color: p.color } : null))
    ),
    turn: state.turn,
    castling: {
      wK: state.castling.wK,
      wQ: state.castling.wQ,
      bK: state.castling.bK,
      bQ: state.castling.bQ,
    },
    enPassant: state.enPassant
      ? { row: state.enPassant.row, col: state.enPassant.col }
      : null,
    halfmoveClock: state.halfmoveClock,
    fullmoveNumber: state.fullmoveNumber,
  };
}

function findKing(board, color) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.type === "k" && p.color === color) return [r, c];
    }
  }
  return null;
}

function isKingAttacked(board, color) {
  const king = findKing(board, color);
  if (!king) return false;
  return isSquareAttacked(board, king[0], king[1], opponentOf(color));
}

function isSquareAttacked(board, row, col, byColor) {
  const pawnRow = byColor === WHITE ? row + 1 : row - 1;
  for (const dc of [-1, 1]) {
    const pc = col + dc;
    if (inside(pawnRow, pc)) {
      const p = board[pawnRow][pc];
      if (p && p.color === byColor && p.type === "p") return true;
    }
  }
  for (const [dr, dc] of KNIGHT_DELTAS) {
    const nr = row + dr;
    const nc = col + dc;
    if (!inside(nr, nc)) continue;
    const p = board[nr][nc];
    if (p && p.color === byColor && p.type === "n") return true;
  }
  for (const [dr, dc] of KING_DELTAS) {
    const nr = row + dr;
    const nc = col + dc;
    if (!inside(nr, nc)) continue;
    const p = board[nr][nc];
    if (p && p.color === byColor && p.type === "k") return true;
  }
  for (const [dr, dc] of BISHOP_DIRS) {
    let nr = row + dr;
    let nc = col + dc;
    while (inside(nr, nc)) {
      const p = board[nr][nc];
      if (p) {
        if (p.color === byColor && (p.type === "b" || p.type === "q")) return true;
        break;
      }
      nr += dr;
      nc += dc;
    }
  }
  for (const [dr, dc] of ROOK_DIRS) {
    let nr = row + dr;
    let nc = col + dc;
    while (inside(nr, nc)) {
      const p = board[nr][nc];
      if (p) {
        if (p.color === byColor && (p.type === "r" || p.type === "q")) return true;
        break;
      }
      nr += dr;
      nc += dc;
    }
  }
  return false;
}

function makeMove(from, to, piece, captured, extra) {
  return {
    from,
    to,
    piece,
    captured,
    promotion: null,
    isEnPassant: false,
    isCastle: null,
    isDoublePush: false,
    ...extra,
  };
}

function pushPawnMoves(moves, fromR, fromC, toR, toC, capturedType, isEnPassant, promoRow) {
  if (toR === promoRow) {
    for (const promotion of PROMOTION_PIECES) {
      moves.push(
        makeMove([fromR, fromC], [toR, toC], "p", capturedType, { promotion })
      );
    }
  } else {
    moves.push(makeMove([fromR, fromC], [toR, toC], "p", capturedType));
  }
}

function addCastlingMoves(state, moves) {
  const { board, turn, castling } = state;
  const enemy = opponentOf(turn);
  const row = turn === WHITE ? 7 : 0;
  const kingSideRight = turn === WHITE ? castling.wK : castling.bK;
  const queenSideRight = turn === WHITE ? castling.wQ : castling.bQ;
  const king = board[row][4];
  if (!king || king.type !== "k" || king.color !== turn) return;
  if (isSquareAttacked(board, row, 4, enemy)) return;

  if (kingSideRight) {
    const rook = board[row][7];
    if (
      !board[row][5] &&
      !board[row][6] &&
      rook &&
      rook.type === "r" &&
      rook.color === turn &&
      !isSquareAttacked(board, row, 5, enemy) &&
      !isSquareAttacked(board, row, 6, enemy)
    ) {
      moves.push(makeMove([row, 4], [row, 6], "k", null, { isCastle: "k" }));
    }
  }
  if (queenSideRight) {
    const rook = board[row][0];
    if (
      !board[row][1] &&
      !board[row][2] &&
      !board[row][3] &&
      rook &&
      rook.type === "r" &&
      rook.color === turn &&
      !isSquareAttacked(board, row, 3, enemy) &&
      !isSquareAttacked(board, row, 2, enemy)
    ) {
      moves.push(makeMove([row, 4], [row, 2], "k", null, { isCastle: "q" }));
    }
  }
}

function generatePseudoMoves(state) {
  const { board, turn, enPassant } = state;
  const moves = [];

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece.color !== turn) continue;

      if (piece.type === "p") {
        const dir = turn === WHITE ? -1 : 1;
        const startRow = turn === WHITE ? 6 : 1;
        const promoRow = turn === WHITE ? 0 : 7;
        const oneR = r + dir;

        if (inside(oneR, c) && !board[oneR][c]) {
          pushPawnMoves(moves, r, c, oneR, c, null, false, promoRow);
          const twoR = r + 2 * dir;
          if (r === startRow && !board[twoR][c]) {
            moves.push(
              makeMove([r, c], [twoR, c], "p", null, { isDoublePush: true })
            );
          }
        }

        for (const dc of [-1, 1]) {
          const nc = c + dc;
          if (!inside(oneR, nc)) continue;
          const target = board[oneR][nc];
          if (target && target.color !== turn) {
            pushPawnMoves(moves, r, c, oneR, nc, target.type, false, promoRow);
          } else if (
            !target &&
            enPassant &&
            enPassant.row === oneR &&
            enPassant.col === nc
          ) {
            moves.push(
              makeMove([r, c], [oneR, nc], "p", "p", { isEnPassant: true })
            );
          }
        }
      } else if (piece.type === "n" || piece.type === "k") {
        const deltas = piece.type === "n" ? KNIGHT_DELTAS : KING_DELTAS;
        for (const [dr, dc] of deltas) {
          const nr = r + dr;
          const nc = c + dc;
          if (!inside(nr, nc)) continue;
          const target = board[nr][nc];
          if (target && target.color === turn) continue;
          moves.push(
            makeMove([r, c], [nr, nc], piece.type, target ? target.type : null)
          );
        }
      } else {
        const dirs =
          piece.type === "b"
            ? BISHOP_DIRS
            : piece.type === "r"
              ? ROOK_DIRS
              : [...BISHOP_DIRS, ...ROOK_DIRS];
        for (const [dr, dc] of dirs) {
          let nr = r + dr;
          let nc = c + dc;
          while (inside(nr, nc)) {
            const target = board[nr][nc];
            if (target) {
              if (target.color !== turn) {
                moves.push(
                  makeMove([r, c], [nr, nc], piece.type, target.type)
                );
              }
              break;
            }
            moves.push(makeMove([r, c], [nr, nc], piece.type, null));
            nr += dr;
            nc += dc;
          }
        }
      }
    }
  }

  addCastlingMoves(state, moves);
  return moves;
}

function rawApply(state, move) {
  const board = state.board;
  const [fr, fc] = move.from;
  const [tr, tc] = move.to;
  const piece = board[fr][fc];
  const target = board[tr][tc];

  board[fr][fc] = null;
  if (move.isEnPassant) {
    board[fr][tc] = null;
  }
  board[tr][tc] = move.promotion
    ? { type: move.promotion, color: piece.color }
    : piece;

  if (move.isCastle === "k") {
    board[fr][5] = board[fr][7];
    board[fr][7] = null;
  } else if (move.isCastle === "q") {
    board[fr][3] = board[fr][0];
    board[fr][0] = null;
  }

  if (piece.type === "k") {
    if (piece.color === WHITE) {
      state.castling.wK = false;
      state.castling.wQ = false;
    } else {
      state.castling.bK = false;
      state.castling.bQ = false;
    }
  }
  if (piece.type === "r") {
    if (fr === 7 && fc === 0) state.castling.wQ = false;
    if (fr === 7 && fc === 7) state.castling.wK = false;
    if (fr === 0 && fc === 0) state.castling.bQ = false;
    if (fr === 0 && fc === 7) state.castling.bK = false;
  }
  if (target && target.type === "r") {
    if (tr === 7 && tc === 0) state.castling.wQ = false;
    if (tr === 7 && tc === 7) state.castling.wK = false;
    if (tr === 0 && tc === 0) state.castling.bQ = false;
    if (tr === 0 && tc === 7) state.castling.bK = false;
  }

  state.enPassant = move.isDoublePush
    ? { row: (fr + tr) / 2, col: fc }
    : null;

  state.halfmoveClock =
    piece.type === "p" || target || move.isEnPassant
      ? 0
      : state.halfmoveClock + 1;

  if (state.turn === BLACK) state.fullmoveNumber += 1;
  state.turn = opponentOf(state.turn);
}

export function generateLegalMoves(state) {
  const pseudo = generatePseudoMoves(state);
  const mover = state.turn;
  const legal = [];
  for (const move of pseudo) {
    if (move.captured === "k") continue;
    const test = cloneState(state);
    rawApply(test, move);
    if (!isKingAttacked(test.board, mover)) {
      legal.push(move);
    }
  }
  return legal;
}

export function applyMove(state, move) {
  const wantedFrom = move.from;
  const wantedTo = move.to;
  const wantedPromotion = move.promotion || null;
  const candidates = generateLegalMoves(state);
  const match = candidates.find(
    (m) =>
      m.from[0] === wantedFrom[0] &&
      m.from[1] === wantedFrom[1] &&
      m.to[0] === wantedTo[0] &&
      m.to[1] === wantedTo[1] &&
      (m.promotion || null) === wantedPromotion
  );
  if (!match) {
    throw new Error(
      `Illegal move: [${wantedFrom}] -> [${wantedTo}]${
        wantedPromotion ? "=" + wantedPromotion : ""
      }`
    );
  }
  const next = cloneState(state);
  rawApply(next, match);
  return next;
}

export function getGameStatus(state, context = {}) {
  if (!findKing(state.board, WHITE) || !findKing(state.board, BLACK)) {
    return {
      status: "invalid",
      reason: "missingKing",
      inCheck: false,
      winner: null,
    };
  }
  const moves = generateLegalMoves(state);
  const inCheck = isKingAttacked(state.board, state.turn);
  if (moves.length === 0) {
    if (inCheck) {
      return {
        status: "checkmate",
        inCheck: true,
        winner: opponentOf(state.turn),
      };
    }
    return { status: "stalemate", inCheck: false, winner: null };
  }
  // 死局（雙方皆無法以任何合法著法序列將死）：立即判和（FIDE 5.2.2）。
  if (isDeadPosition(state.board)) {
    return { status: "insufficient", inCheck, winner: null };
  }
  // 五次重複局面：自動判和（FIDE 9.6b）。重複次數由呼叫端以
  // context.repetitionCount 傳入（引擎本身不追蹤實際對局歷史）。
  const repetitionCount = context.repetitionCount ?? 0;
  if (repetitionCount >= 5) {
    return { status: "fivefold", inCheck, winner: null };
  }
  // 75 回合規則：150 半步無兵移動與無吃子，自動判和（FIDE 9.6b）。
  // 上方的將死／逼和判斷保證「最後一手造成將死」優先於此。
  if (state.halfmoveClock >= 150) {
    return { status: "seventyfive", inCheck, winner: null };
  }
  return { status: "ongoing", inCheck, winner: null };
}

// 可宣告和棋的條件（FIDE 9.2 / 9.3）：三次重複局面與 50 回合規則
// （100 半步無兵移動與無吃子）。僅供對局進行中呼叫；是否開放宣告
// 由 UI 依遊戲是否已結束與 AI 是否運算中決定。
export function claimableDraws(state, repetitionCount) {
  return {
    threefold: Number(repetitionCount) >= 3,
    fiftyMove: Boolean(state) && state.halfmoveClock >= 100,
  };
}

// FIDE 9.2.3 的局面同一性：盤面、行棋方、王車易位權皆須相同，
// 而吃過路兵僅在「確實存在合法的過路兵吃法」時才算相異特徵——
// 單純殘留、實際上不可執行的 en-passant 目標格不視為相異。
export function positionKey(state) {
  let boardPart = "";
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (!p) {
        boardPart += ".";
      } else {
        boardPart += p.color === WHITE ? p.type.toUpperCase() : p.type;
      }
    }
  }
  const castling = state.castling;
  const castlePart =
    (castling.wK ? "K" : "") +
    (castling.wQ ? "Q" : "") +
    (castling.bK ? "k" : "") +
    (castling.bQ ? "q" : "");
  const epPart =
    state.enPassant && hasLegalEnPassant(state)
      ? `${state.enPassant.row},${state.enPassant.col}`
      : "-";
  return `${boardPart} ${state.turn} ${castlePart || "-"} ${epPart}`;
}

function hasLegalEnPassant(state) {
  for (const move of generateLegalMoves(state)) {
    if (move.isEnPassant) return true;
  }
  return false;
}

// 保守的死局判定（僅依盤面子力，涵蓋標準裸子力案例；絕不誤判
// 仍有可能將死的局面為死局）：
//   - 無兵／車／后，且雙方合計最多一枚輕子 → 死局（K vs K、K+單輕子 vs K）。
//   - 雙方各恰一枚輕子且皆為同色格主教 → 死局。
//   - 其餘（含雙馬、主教對騎士、異色格主教、任一方兩枚以上輕子）
//     皆存在合作將死（helpmate）可能 → 不判死。
function isDeadPosition(board) {
  const minors = { w: [], b: [] };
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p || p.type === "k") continue;
      if (p.type === "p" || p.type === "r" || p.type === "q") return false;
      minors[p.color].push({ type: p.type, squareColor: (r + c) % 2 });
    }
  }
  const w = minors.w;
  const b = minors.b;
  if (w.length + b.length <= 1) return true;
  if (w.length === 1 && b.length === 1) {
    return (
      w[0].type === "b" &&
      b[0].type === "b" &&
      w[0].squareColor === b[0].squareColor
    );
  }
  return false;
}

// 重複局面追蹤器：keys[0] 為初始局面，keys[i] 為第 i 半步後的局面。
// 由呼叫端在行棋／悔棋／重開時維護 push/truncate/reset。
export function createRepetitionTracker() {
  const keys = [];
  return {
    reset(state) {
      keys.length = 0;
      keys.push(positionKey(state));
    },
    push(state) {
      keys.push(positionKey(state));
    },
    truncate(n) {
      keys.length = Math.max(1, keys.length - Math.max(0, n));
    },
    countCurrent() {
      if (keys.length === 0) return 0;
      const current = keys[keys.length - 1];
      let count = 0;
      for (const key of keys) {
        if (key === current) count += 1;
      }
      return count;
    },
  };
}
