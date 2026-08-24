/**
 * xiangqi-rules.mjs — 中國象棋規則引擎（純資料、無 DOM、無 I/O）。
 *
 * 座標系統：row 0 為黑方底線（棋盤上方），row 9 為紅方底線（棋盤下方）；
 * col 0 為紅方視角最左側，col 8 為最右側。紅方先行。
 *
 * 棋子以 { color: "red" | "black", type: ... } 表示；格點為 null 或棋子。
 * 著法為 { from: {row, col}, to: {row, col} }。
 *
 * 規則涵蓋：九宮限制、河界、將帥一步直行與照面禁著、士斜一行宮、
 * 象走田字含塞象眼且不可過河、馬走日含蹩馬腿、車直線滑行、
 * 炮隔一子打擊、兵卒過河前只進過河後可橫移、不得自陷將軍
 * （含自陷照面）、將軍偵測、將死、困斃（依正式規則：無子可動判負）。
 */

export const COLORS = Object.freeze(["red", "black"]);
export const PIECE_TYPES = Object.freeze([
  "general", "advisor", "elephant", "horse", "rook", "cannon", "soldier",
]);

export const BOARD_ROWS = 10;
export const BOARD_COLS = 9;
export const RED_PALACE_ROWS = Object.freeze([7, 8, 9]);
export const BLACK_PALACE_ROWS = Object.freeze([0, 1, 2]);
export const PALACE_COLS = Object.freeze([3, 4, 5]);
export const RIVER_ROW_RED = 4; // 紅方半場最後一列（含）之前為紅方半場
export const RIVER_ROW_BLACK = 5; // 黑方半場從此列開始

const GLYPHS = Object.freeze({
  red: Object.freeze({ general: "帥", advisor: "仕", elephant: "相", horse: "傌", rook: "俥", cannon: "炮", soldier: "兵" }),
  black: Object.freeze({ general: "將", advisor: "士", elephant: "象", horse: "馬", rook: "車", cannon: "砲", soldier: "卒" }),
});

/** 棋子中文字（依顏色區分紅黑用字）。 */
export function pieceGlyph(piece) {
  if (!piece) return "";
  return GLYPHS[piece.color]?.[piece.type] ?? "?";
}

export function pieceName(piece) {
  if (!piece) return "空格";
  return `${piece.color === "red" ? "紅" : "黑"}${GLYPHS[piece.color][piece.type]}`;
}

export function sameSquare(a, b) {
  return !!a && !!b && a.row === b.row && a.col === b.col;
}

export function insideBoard(row, col) {
  return row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS;
}

export function inPalace(color, row, col) {
  if (col < 3 || col > 5) return false;
  return color === "red"
    ? row >= 7 && row <= 9
    : row >= 0 && row <= 2;
}

/** 該色是否已過河（到達對方半場）。red 向上（row 變小）、black 向下。 */
export function crossedRiver(color, row) {
  return color === "red" ? row <= RIVER_ROW_RED : row >= RIVER_ROW_BLACK;
}

function pieceAt(board, row, col) {
  return insideBoard(row, col) ? board[row][col] : null;
}

export function findGeneral(board, color) {
  for (let row = 0; row < BOARD_ROWS; row += 1) {
    for (let col = 3; col <= 5; col += 1) {
      const piece = board[row][col];
      if (piece && piece.color === color && piece.type === "general") {
        return { row, col };
      }
    }
  }
  return null;
}

/**
 * 將帥是否在同一行且中間無子（照面）。照面視同被攻擊，
 * 因此任何造成照面的著法都會在合法性過濾時被剔除。
 */
export function kingsFacingOnBoard(board) {
  const red = findGeneral(board, "red");
  const black = findGeneral(board, "black");
  if (!red || !black || red.col !== black.col) return false;
  const [top, bottom] = red.row < black.row ? [red, black] : [black, red];
  for (let row = top.row + 1; row < bottom.row; row += 1) {
    if (board[row][red.col]) return false;
  }
  return true;
}

const ORTHOGONAL = Object.freeze([{ dr: -1, dc: 0 }, { dr: 1, dc: 0 }, { dr: 0, dc: -1 }, { dr: 0, dc: 1 }]);
const DIAGONAL = Object.freeze([{ dr: -1, dc: -1 }, { dr: -1, dc: 1 }, { dr: 1, dc: -1 }, { dr: 1, dc: 1 }]);

/**
 * 產生某格棋子的偽合法著法（不考慮己方被將軍）。
 * 這是幾何規則的唯一事實來源，rules 與 AI 共用。
 */
export function generatePseudoMovesForPiece(board, color, row, col) {
  const piece = pieceAt(board, row, col);
  if (!piece || piece.color !== color) return [];
  const moves = [];
  const push = (r, c) => {
    moves.push({ from: { row, col }, to: { row: r, col: c } });
  };

  switch (piece.type) {
    case "general": {
      // 將/帥：九宮內一次一格直行。
      for (const { dr, dc } of ORTHOGONAL) {
        const r = row + dr;
        const c = col + dc;
        if (!inPalace(color, r, c)) continue;
        const target = board[r][c];
        if (!target || target.color !== color) push(r, c);
      }
      break;
    }
    case "advisor": {
      // 士/仕：九宮內斜行一格。
      for (const { dr, dc } of DIAGONAL) {
        const r = row + dr;
        const c = col + dc;
        if (!inPalace(color, r, c)) continue;
        const target = board[r][c];
        if (!target || target.color !== color) push(r, c);
      }
      break;
    }
    case "elephant": {
      // 象/相：田字斜走兩格；塞象眼（對角中間點有子）不可走；不可過河。
      for (const { dr, dc } of DIAGONAL) {
        const r = row + dr * 2;
        const c = col + dc * 2;
        if (!insideBoard(r, c)) continue;
        if (crossedRiver(color, r)) continue; // 落點在對方半場即非法（象不可過河）
        if (board[row + dr][col + dc]) continue; // 塞象眼
        const target = board[r][c];
        if (!target || target.color !== color) push(r, c);
      }
      break;
    }
    case "horse": {
      // 馬：日字；先直後斜，直向相鄰格有子即蹩腿。
      const HORSE = Object.freeze([
        { legDr: -1, legDc: 0, dr: -2, dc: -1 },
        { legDr: -1, legDc: 0, dr: -2, dc: 1 },
        { legDr: 1, legDc: 0, dr: 2, dc: -1 },
        { legDr: 1, legDc: 0, dr: 2, dc: 1 },
        { legDr: 0, legDc: -1, dr: -1, dc: -2 },
        { legDr: 0, legDc: -1, dr: 1, dc: -2 },
        { legDr: 0, legDc: 1, dr: -1, dc: 2 },
        { legDr: 0, legDc: 1, dr: 1, dc: 2 },
      ]);
      for (const { legDr, legDc, dr, dc } of HORSE) {
        const r = row + dr;
        const c = col + dc;
        if (!insideBoard(r, c)) continue;
        if (board[row + legDr][col + legDc]) continue; // 蹩馬腿
        const target = board[r][c];
        if (!target || target.color !== color) push(r, c);
      }
      break;
    }
    case "rook": {
      // 車：四方向直線滑行，遇子停止（敵子可吃）。
      for (const { dr, dc } of ORTHOGONAL) {
        let r = row + dr;
        let c = col + dc;
        while (insideBoard(r, c)) {
          const target = board[r][c];
          if (!target) {
            push(r, c);
          } else {
            if (target.color !== color) push(r, c);
            break;
          }
          r += dr;
          c += dc;
        }
      }
      break;
    }
    case "cannon": {
      // 炮：平移如車但不吃子；必須恰好隔一個炮架才能吃子。
      for (const { dr, dc } of ORTHOGONAL) {
        let r = row + dr;
        let c = col + dc;
        let screenPassed = false;
        while (insideBoard(r, c)) {
          const target = board[r][c];
          if (!screenPassed) {
            if (!target) {
              push(r, c);
            } else {
              screenPassed = true; // 遇到第一個子成為炮架
            }
          } else if (target) {
            if (target.color !== color) push(r, c);
            break;
          }
          r += dr;
          c += dc;
        }
      }
      break;
    }
    case "soldier": {
      // 兵/卒：未過河只能前進一格；過河後可前進或橫移，永不後退。
      const forward = color === "red" ? -1 : 1;
      const candidates = [{ dr: forward, dc: 0 }];
      if (crossedRiver(color, row)) {
        candidates.push({ dr: 0, dc: -1 }, { dr: 0, dc: 1 });
      }
      for (const { dr, dc } of candidates) {
        const r = row + dr;
        const c = col + dc;
        if (!insideBoard(r, c)) continue;
        const target = board[r][c];
        if (!target || target.color !== color) push(r, c);
      }
      break;
    }
    default:
      break;
  }
  return moves;
}

/** 產生該色全部偽合法著法。 */
export function generatePseudoMoves(board, color) {
  const moves = [];
  for (let row = 0; row < BOARD_ROWS; row += 1) {
    for (let col = 0; col < BOARD_COLS; col += 1) {
      const piece = board[row][col];
      if (piece && piece.color === color) {
        moves.push(...generatePseudoMovesForPiece(board, color, row, col));
      }
    }
  }
  return moves;
}

/**
 * 該色將帥在此盤面是否被攻擊（含被照面）。
 * 直接在 board 上檢查，呼叫端負責暫時套用著法。
 */
export function isKingAttacked(board, color) {
  const king = findGeneral(board, color);
  if (!king) return true; // 將帥不存在視同被攻擊（防禦性）
  const enemy = color === "red" ? "black" : "red";

  // 照面即違規位置。
  const oppo = findGeneral(board, enemy);
  if (oppo && oppo.col === king.col) {
    const clear = (() => {
      const [top, bottom] = king.row < oppo.row ? [king, oppo] : [oppo, king];
      for (let row = top.row + 1; row < bottom.row; row += 1) {
        if (board[row][king.col]) return false;
      }
      return true;
    })();
    if (clear) return true;
  }

  // 直線攻擊：車（滑行第一個子）、炮（隔一架）、將（照面已處理，僅鄰格理論上不可能）。
  for (const { dr, dc } of ORTHOGONAL) {
    let r = king.row + dr;
    let c = king.col + dc;
    let screens = 0;
    while (insideBoard(r, c)) {
      const piece = board[r][c];
      if (piece) {
        screens += 1;
        if (screens === 1) {
          if (piece.color === enemy && (piece.type === "rook" || piece.type === "general")) return true;
        } else if (screens === 2) {
          if (piece.color === enemy && piece.type === "cannon") return true;
          break;
        }
      }
      r += dr;
      c += dc;
    }
  }

  // 馬攻擊：從王看八個日字來向；馬腿位於「馬」旁直向一格。
  const KNIGHT_THREATS = Object.freeze([
    { dr: -2, dc: -1 }, { dr: -2, dc: 1 }, { dr: 2, dc: -1 }, { dr: 2, dc: 1 },
    { dr: -1, dc: -2 }, { dr: 1, dc: -2 }, { dr: -1, dc: 2 }, { dr: 1, dc: 2 },
  ]);
  for (const src of KNIGHT_THREATS) {
    const sr = king.row + src.dr;
    const sc = king.col + src.dc;
    if (!insideBoard(sr, sc)) continue;
    const piece = board[sr][sc];
    if (!piece || piece.color !== enemy || piece.type !== "horse") continue;
    // 馬腿：長邊方向的相鄰格（相對於馬本身）必須為空才吃得到王。
    const lr = sr + (Math.abs(src.dr) === 2 ? (src.dr > 0 ? -1 : 1) : 0);
    const lc = sc + (Math.abs(src.dc) === 2 ? (src.dc > 0 ? -1 : 1) : 0);
    if (!board[lr][lc]) return true;
  }

  // 兵卒攻擊：敵兵向前推進可達王格；橫向只有過河兵能攻擊同列鄰格。
  // 敵兵前進方向與其顏色有關；攻擊者位於王「後方一格」（前進的反向）。
  const pawnForwardFrom = { dr: color === "red" ? -1 : 1, dc: 0 };
  for (const { dr, dc } of [pawnForwardFrom, { dr: 0, dc: -1 }, { dr: 0, dc: 1 }]) {
    const r = king.row + dr;
    const c = king.col + dc;
    if (!insideBoard(r, c)) continue;
    const piece = board[r][c];
    if (!piece || piece.color !== enemy || piece.type !== "soldier") continue;
    if (dc !== 0 && !crossedRiver(enemy, r)) continue; // 未過河不能橫吃
    return true;
  }

  return false;
}

/**
 * 在 board 上試走著法並回傳是否讓自己陷入被將軍/照面。
 * 使用原地修改＋還原，不配置新盤面（供高頻搜尋使用）。
 */
export function leavesOwnKingAttacked(board, color, from, to) {
  const moving = board[from.row][from.col];
  const captured = board[to.row][to.col];
  board[to.row][to.col] = moving;
  board[from.row][from.col] = null;
  const attacked = isKingAttacked(board, color);
  board[from.row][from.col] = moving;
  board[to.row][to.col] = captured;
  return attacked;
}

export function cloneState(state) {
  return {
    board: state.board.map((row) => row.slice()),
    turn: state.turn,
    captured: {
      red: (state.captured?.red ?? []).slice(),
      black: (state.captured?.black ?? []).slice(),
    },
    plies: state.plies ?? 0,
  };
}

export function createInitialState() {
  const board = Array.from({ length: BOARD_ROWS }, () => Array(BOARD_COLS).fill(null));
  const put = (row, col, color, type) => {
    board[row][col] = Object.freeze({ color, type });
  };
  const backRank = ["rook", "horse", "elephant", "advisor", "general", "advisor", "elephant", "horse", "rook"];
  backRank.forEach((type, col) => put(0, col, "black", type));
  put(2, 1, "black", "cannon");
  put(2, 7, "black", "cannon");
  for (const col of [0, 2, 4, 6, 8]) put(3, col, "black", "soldier");
  for (const col of [0, 2, 4, 6, 8]) put(6, col, "red", "soldier");
  put(7, 1, "red", "cannon");
  put(7, 7, "red", "cannon");
  backRank.forEach((type, col) => put(9, col, "red", type));
  return { board, turn: "red", captured: { red: [], black: [] }, plies: 0 };
}

/** 該色當前所有合法著法（已過濾自陷將軍／照面）。 */
export function getLegalMoves(state, color = state.turn) {
  const board = state.board;
  const legal = [];
  for (const move of generatePseudoMoves(board, color)) {
    if (!leavesOwnKingAttacked(board, color, move.from, move.to)) legal.push(move);
  }
  return legal;
}

/** 某一格棋子的所有合法著法；若該格沒有己方棋子則回傳空陣列。 */
export function getLegalMovesFrom(state, row, col, color = state.turn) {
  if (!insideBoard(row, col)) return [];
  const piece = state.board[row]?.[col];
  if (!piece || piece.color !== color) return [];
  const board = state.board;
  return generatePseudoMovesForPiece(board, color, row, col)
    .filter((move) => !leavesOwnKingAttacked(board, color, move.from, move.to));
}

/** 套用著法，回傳全新狀態（原狀態不可變）。假設著法合法。 */
export function applyMove(state, move) {
  const next = cloneState(state);
  const piece = next.board[move.from.row][move.from.col];
  const captured = next.board[move.to.row][move.to.col];
  next.board[move.to.row][move.to.col] = piece;
  next.board[move.from.row][move.from.col] = null;
  if (captured) {
    next.captured[captured.color].push(captured);
  }
  next.turn = state.turn === "red" ? "black" : "red";
  next.plies = (state.plies ?? 0) + 1;
  return next;
}

export function isInCheck(state, color = state.turn) {
  return isKingAttacked(state.board, color);
}

/**
 * 局面狀態：
 * - ongoing：未結束（inCheck 標示當前行棋方是否被將軍）。
 * - checkmate：行棋方被將軍且無合法著法 → 對方勝。
 * - stalemate：行棋方未被將軍但無合法著法（困斃）→ 依中國象棋規則判負，對方勝。
 */
export function getGameStatus(state) {
  const moves = getLegalMoves(state, state.turn);
  const inCheck = isKingAttacked(state.board, state.turn);
  if (moves.length === 0) {
    const winner = state.turn === "red" ? "black" : "red";
    return inCheck
      ? { status: "checkmate", inCheck: true, winner }
      : { status: "stalemate", inCheck: false, winner };
  }
  return { status: "ongoing", inCheck, winner: null };
}

/** 由狀態找出與給定起訖完全一致的合法著法（找不到回傳 null）。 */
export function findLegalMove(state, from, to) {
  return getLegalMovesFrom(state, from.row, from.col)
    .find((move) => sameSquare(move.to, to)) ?? null;
}

/** Perft：計算 depth 內全部合法著法序列數（規則引擎驗證用）。 */
export function perft(state, depth) {
  if (depth <= 0) return 1;
  const moves = getLegalMoves(state);
  if (depth === 1) return moves.length;
  let total = 0;
  for (const move of moves) {
    total += perft(applyMove(state, move), depth - 1);
  }
  return total;
}
