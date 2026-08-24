/**
 * xiangqi-ai.mjs — L1–L10 確定性 AI（純函式、無 I/O、無 DOM）。
 *
 * 設計原則（誠實且務實）：
 * - 只走合法棋：所有著法都經過與 xiangqi-rules.mjs 相同的幾何產生器＋自陷將軍過濾。
 * - 有界搜尋：迭代加深 alpha-beta＋僅吃子靜態搜尋，以「節點數」為主要預算，
 *   因此同輸入必得同輸出（deterministic）。options.maxTimeMs 僅作為保險絲，
 *   預設不啟用；啟用時極端慢的機器才可能提前截斷。
 * - 評估為公開、保守的物質值＋簡單位置加權；不宣稱任何未經驗證的棋力等級。
 * - 困斃依正式規則判負，故搜尋中「無合法著法」一律回傳 -（MATE-ply）。
 */

import {
  BOARD_ROWS,
  BOARD_COLS,
  generatePseudoMovesForPiece,
  leavesOwnKingAttacked,
} from "./xiangqi-rules.mjs";

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 10;
export const MATE_SCORE = 1_000_000;

const MATERIAL = Object.freeze({
  general: 100_000,
  rook: 900,
  cannon: 450,
  horse: 400,
  advisor: 200,
  elephant: 200,
  soldier: 100,
});

/** 各等級搜尋參數：深度上限、靜態搜尋深度、節點預算、是否只用物質評估。 */
const LEVELS = Object.freeze([
  /* L1 */ Object.freeze({ depth: 1, quiescence: 0, maxNodes: 2_000, materialOnly: true }),
  /* L2 */ Object.freeze({ depth: 1, quiescence: 0, maxNodes: 6_000, materialOnly: false }),
  /* L3 */ Object.freeze({ depth: 2, quiescence: 0, maxNodes: 20_000, materialOnly: false }),
  /* L4 */ Object.freeze({ depth: 2, quiescence: 4, maxNodes: 45_000, materialOnly: false }),
  /* L5 */ Object.freeze({ depth: 3, quiescence: 4, maxNodes: 90_000, materialOnly: false }),
  /* L6 */ Object.freeze({ depth: 3, quiescence: 6, maxNodes: 160_000, materialOnly: false }),
  /* L7 */ Object.freeze({ depth: 4, quiescence: 6, maxNodes: 260_000, materialOnly: false }),
  /* L8 */ Object.freeze({ depth: 4, quiescence: 8, maxNodes: 420_000, materialOnly: false }),
  /* L9 */ Object.freeze({ depth: 5, quiescence: 8, maxNodes: 650_000, materialOnly: false }),
  /* L10 */ Object.freeze({ depth: 6, quiescence: 10, maxNodes: 900_000, materialOnly: false }),
]);

class SearchBudgetExceeded extends Error {}

const other = (color) => (color === "red" ? "black" : "red");

/** 簡單位置加權（紅黑對稱）：兵推進、馬居中、炮佔中路、士象歸位。 */
function positional(type, color, row, col) {
  switch (type) {
    case "soldier": {
      const crossed = color === "red" ? row <= 4 : row >= 5;
      if (!crossed) return 0;
      const progress = color === "red" ? 6 - row : row - 3;
      const centre = col >= 3 && col <= 5 ? 15 : 0;
      return 55 + progress * 16 + centre;
    }
    case "horse": {
      let score = 0;
      if (col === 0 || col === 8) score -= 14;
      const backRank = color === "red" ? row === 9 : row === 0;
      if (backRank) score -= 10;
      if (col >= 2 && col <= 6 && row >= 2 && row <= 7) score += 12;
      return score;
    }
    case "cannon": {
      return col >= 3 && col <= 5 ? 10 : 0;
    }
    case "advisor":
    case "elephant":
      return 6;
    default:
      return 0;
  }
}

/** 車的開放度：所在直線越通暢加分越高。 */
function rookOpenness(board, color, row, col) {
  let blockers = 0;
  for (let r = 0; r < BOARD_ROWS; r += 1) {
    if (r !== row && board[r][col]) blockers += 1;
  }
  if (blockers === 0) return 26;
  if (blockers === 1) return 12;
  return 0;
}

/** 盤面評估，紅方為正。materialOnly 供低階等級使用。 */
function evaluateBoard(board, materialOnly) {
  let score = 0;
  let redAdvisors = 0;
  let blackAdvisors = 0;
  let redElephants = 0;
  let blackElephants = 0;

  for (let row = 0; row < BOARD_ROWS; row += 1) {
    const line = board[row];
    for (let col = 0; col < BOARD_COLS; col += 1) {
      const piece = line[col];
      if (!piece) continue;
      const sign = piece.color === "red" ? 1 : -1;
      let value = MATERIAL[piece.type];
      if (!materialOnly) {
        value += positional(piece.type, piece.color, row, col);
        if (piece.type === "rook") value += rookOpenness(board, piece.color, row, col);
        if (piece.type === "advisor") {
          if (piece.color === "red") redAdvisors += 1; else blackAdvisors += 1;
        }
        if (piece.type === "elephant") {
          if (piece.color === "red") redElephants += 1; else blackElephants += 1;
        }
      }
      score += sign * value;
    }
  }

  if (!materialOnly) {
    // 防守體系完整度：雙士／雙象健在給小額團隊分。
    if (redAdvisors === 2) score += 14;
    if (blackAdvisors === 2) score -= 14;
    if (redElephants === 2) score += 14;
    if (blackElephants === 2) score -= 14;
  }
  return score;
}

/** 吃子排序用 MVV-LVA 分數。 */
function captureOrderScore(board, move) {
  const victim = board[move.to.row][move.to.col];
  if (!victim) {
    // 安靜著法的小啟發：位置加權變化量，讓開局傾向出子。
    const mover = board[move.from.row][move.from.col];
    const delta = positional(mover.type, mover.color, move.to.row, move.to.col)
      - positional(mover.type, mover.color, move.from.row, move.from.col);
    return delta / 8;
  }
  const mover = board[move.from.row][move.from.col];
  return MATERIAL[victim.type] * 32 - MATERIAL[mover.type] / 16;
}

function orderMoves(board, moves) {
  const decorated = moves.map((move, index) => ({
    move,
    index,
    key: `${move.from.row}${move.from.col}${move.to.row}${move.to.col}`,
    score: captureOrderScore(board, move),
  }));
  // Array#sort 在現代引擎為穩定排序；再以座標字串做最終決定性平手裁決。
  decorated.sort((a, b) => (b.score - a.score) || (a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index));
  return decorated.map((entry) => entry.move);
}

/**
 * 搜尋上下文：直接在可變盤面上 make/unmake，
 * 幾何合法性完全沿用 xiangqi-rules 的產生器與檢查。
 */
function createContext(board, config, budget) {
  let nodes = 0;
  const deadline = config.deadline;

  function tick() {
    nodes += 1;
    if (nodes > budget) throw new SearchBudgetExceeded();
    if (deadline && (nodes & 1023) === 0 && Date.now() > deadline) throw new SearchBudgetExceeded();
  }

  function legalMoves(color) {
    const moves = [];
    for (let row = 0; row < BOARD_ROWS; row += 1) {
      for (let col = 0; col < BOARD_COLS; col += 1) {
        const piece = board[row][col];
        if (!piece || piece.color !== color) continue;
        for (const move of generatePseudoMovesForPiece(board, color, row, col)) {
          if (!leavesOwnKingAttacked(board, color, move.from, move.to)) moves.push(move);
        }
      }
    }
    return moves;
  }

  function make(move) {
    const moving = board[move.from.row][move.from.col];
    const captured = board[move.to.row][move.to.col];
    board[move.to.row][move.to.col] = moving;
    board[move.from.row][move.from.col] = null;
    return captured ?? null;
  }

  function unmake(move, captured) {
    const moving = board[move.to.row][move.to.col];
    board[move.from.row][move.from.col] = moving;
    board[move.to.row][move.to.col] = captured ?? null;
  }

  function quiesce(alpha, beta, color, qdepth) {
    tick();
    const staticScore = evaluateBoard(board, config.materialOnly);
    const stand = color === "red" ? staticScore : -staticScore;
    // 失軟（fail-soft）：即使超出視窗也回傳真實評估，
    // 避免不同著法在根節點被壓成同分而靠座標排序誤選。
    if (qdepth <= 0 || stand >= beta) return stand;
    let best = stand;
    if (stand > alpha) alpha = stand;

    const tactical = [];
    for (const move of generateTactical(color)) {
      if (!leavesOwnKingAttacked(board, color, move.from, move.to)) tactical.push(move);
    }
    for (const move of orderMoves(board, tactical)) {
      const captured = make(move);
      const score = -quiesce(-beta, -alpha, other(color), qdepth - 1);
      unmake(move, captured);
      if (score > best) {
        best = score;
        if (score > alpha) {
          alpha = score;
          if (score >= beta) break;
        }
      }
    }
    return best;
  }

  function generateTactical(color) {
    const moves = [];
    for (let row = 0; row < BOARD_ROWS; row += 1) {
      for (let col = 0; col < BOARD_COLS; col += 1) {
        const piece = board[row][col];
        if (!piece || piece.color !== color) continue;
        for (const move of generatePseudoMovesForPiece(board, color, row, col)) {
          if (board[move.to.row][move.to.col]) moves.push(move);
        }
      }
    }
    return moves;
  }

  function negamax(depth, alpha, beta, color, ply) {
    tick();
    if (depth <= 0) return quiesce(alpha, beta, color, config.quiescence);
    const moves = orderMoves(board, legalMoves(color));
    if (moves.length === 0) {
      // 將死或困斃：行棋方皆直接落敗（中國象棋規則），距離越近分數越極端。
      return -(MATE_SCORE - ply);
    }
    let best = -Infinity;
    for (const move of moves) {
      const captured = make(move);
      const score = -negamax(depth - 1, -beta, -alpha, other(color), ply + 1);
      unmake(move, captured);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  return {
    nodesUsed: () => nodes,
    legalMoves,
    make,
    unmake,
    negamax,
    evaluate: (color) => {
      const raw = evaluateBoard(board, config.materialOnly);
      return color === "red" ? raw : -raw;
    },
  };
}

function clampLevel(level) {
  const numeric = Number(level);
  if (!Number.isFinite(numeric)) return 6;
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(numeric)));
}

function coordinateKey(move) {
  return `${move.from.row},${move.from.col}>${move.to.row},${move.to.col}`;
}

/**
 * 選擇著法。
 * @param {object} state 規則引擎狀態。
 * @param {number} level 1–10。
 * @param {object} [options] { maxNodes?, maxTimeMs? }
 * @returns {{move: object|null, meta: {score: number, depth: number, nodes: number}}}
 */
export function chooseMove(state, level = 6, options = {}) {
  const config = LEVELS[clampLevel(level) - 1];
  const board = state.board.map((row) => row.slice());
  const budget = Math.max(1, Number.isFinite(options.maxNodes) ? Math.floor(options.maxNodes) : config.maxNodes);
  const deadline = Number.isFinite(options.maxTimeMs) && options.maxTimeMs > 0
    ? Date.now() + options.maxTimeMs
    : null;
  const ctx = createContext(board, { materialOnly: config.materialOnly, quiescence: config.quiescence, deadline }, budget);

  const color = state.turn;
  const rootMoves = ctx.legalMoves(color);
  if (rootMoves.length === 0) {
    return { move: null, meta: { score: -(MATE_SCORE), depth: 0, nodes: ctx.nodesUsed() } };
  }
  if (rootMoves.length === 1) {
    return { move: rootMoves[0], meta: { score: ctx.evaluate(color), depth: 0, nodes: ctx.nodesUsed() } };
  }

  // 一步終結偵測：任何造成對方無子可動（將死／困斃）的著法直接取用，
  // 保證最低等級也能立刻抓住貼臉殺著，且結果完全確定。
  for (const move of rootMoves) {
    const captured = ctx.make(move);
    const opponentStuck = ctx.legalMoves(other(color)).length === 0;
    ctx.unmake(move, captured);
    if (opponentStuck) {
      return { move, meta: { score: MATE_SCORE - 1, depth: 0, nodes: ctx.nodesUsed() } };
    }
  }

  let bestMove = null;
  let bestScore = -Infinity;
  let completedDepth = 0;

  for (let depth = 1; depth <= config.depth; depth += 1) {
    let iterationBest = null;
    let iterationBestScore = -Infinity;
    try {
      const ordered = orderMoves(board, rootMoves.slice());
      // 上一輪最佳著法排最前，加速剪枝（結果仍完全確定）。
      if (iterationBest === null && bestMove) {
        const idx = ordered.indexOf(bestMove);
        if (idx > 0) {
          ordered.splice(idx, 1);
          ordered.unshift(bestMove);
        }
      }
      let alpha = -Infinity;
      for (const move of ordered) {
        const captured = ctx.make(move);
        const score = -ctx.negamax(depth - 1, -Infinity, -alpha, other(color), 1);
        ctx.unmake(move, captured);
        const better = score > iterationBestScore
          || (score === iterationBestScore && coordinateKey(move) < coordinateKey(iterationBest));
        if (better) {
          iterationBestScore = score;
          iterationBest = move;
        }
        if (score > alpha) alpha = score;
      }
    } catch (error) {
      if (!(error instanceof SearchBudgetExceeded)) throw error;
      break; // 預算用用盡：採用最後一個完成深度的結果。
    }
    if (iterationBest) {
      bestMove = iterationBest;
      bestScore = iterationBestScore;
      completedDepth = depth;
    } else {
      break;
    }
  }

  if (!bestMove || completedDepth === 0) {
    // 保險路徑：連深度 1 都沒跑完（理論上不會發生），退回靜態評估貪婪。
    let fallback = rootMoves[0];
    let fallbackScore = -Infinity;
    for (const move of rootMoves) {
      const captured = ctx.make(move);
      const score = -ctx.evaluate(other(color));
      ctx.unmake(move, captured);
      const better = score > fallbackScore
        || (score === fallbackScore && coordinateKey(move) < coordinateKey(fallback));
      if (better) {
        fallbackScore = score;
        fallback = move;
      }
    }
    bestMove = fallback;
    bestScore = fallbackScore;
    completedDepth = 1;
  }

  return { move: bestMove, meta: { score: bestScore, depth: completedDepth, nodes: ctx.nodesUsed() } };
}

/** 各等級參數（供 README/CLI 說明與測試）。 */
export function levelConfig(level) {
  return LEVELS[clampLevel(level) - 1];
}
