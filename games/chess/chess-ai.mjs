// Pure, deterministic chess AI for 星火西洋棋衝鋒社 (L1-L10).
//
// Public API (the only exports a browser app should need):
//
//   chooseMove(state, level) -> move | null
//     - `state` is a game state as produced by chess.mjs
//       (createInitialState / applyMove). It is never mutated: every move is
//       explored on states cloned by the rules engine.
//     - `level` is an integer 1..10 (AI_MIN_LEVEL..AI_MAX_LEVEL); non-finite
//       values default to 10 and out-of-range values are clamped.
//     - Returns null for terminal positions (checkmate / stalemate to move,
//       or any automatic draw reported by getGameStatus), invalid positions
//       (e.g. missing king), or unusable input.
//     - Otherwise returns one of the moves from generateLegalMoves(state):
//       promotion and en-passant support comes for free because only legal
//       engine moves are ever considered.
//     - Deterministic: identical state + level always yield the identical
//       move. No randomness, clocks, or environment data are used.
//     - Guarantees at every level:
//         * an immediately available checkmate is always chosen;
//         * a move that lets the opponent deliver mate-in-one is avoided
//           whenever any safe legal alternative exists.
//
// Level ladder (deliberately graduated, bounded work per call so a browser
// stays responsive; budgets are fixed node counts, not wall-clock time):
//
//   L1      restricted deterministic candidate pick: lexicographically first
//           quiet pawn/knight move (falls back to quiet moves, then any move)
//   L2      greedy static evaluation over the top 8 moves by immediate gain
//   L3      negamax depth 1 full width          (~2k node budget)
//   L4-L5   negamax alpha-beta depth 2          (4k / 8k node budgets)
//   L6-L7   negamax alpha-beta depth 3          (12k / 16k node budgets)
//   L8-L10  negamax alpha-beta depth 4          (20k / 28k / 36k node budgets)
//
// Higher levels use iterative deepening up to their fixed depth with a hard
// node budget; if a deeper iteration exhausts its budget its partial result is
// discarded and the best move from the last completed depth is returned.
// Evaluation is bounded material plus simple piece-square tables.

import { generateLegalMoves, applyMove, getGameStatus } from "./chess.mjs";

export const AI_MIN_LEVEL = 1;
export const AI_MAX_LEVEL = 10;

const MATE_SCORE = 100000;

const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

const PST = {
  p: [
      0,  0,  0,  0,  0,  0,  0,  0,
     50, 50, 50, 50, 50, 50, 50, 50,
     10, 10, 20, 30, 30, 20, 10, 10,
      5,  5, 10, 25, 25, 10,  5,  5,
      0,  0,  0, 20, 20,  0,  0,  0,
      5, -5,-10,  0,  0,-10, -5,  5,
      5, 10, 10,-20,-20, 10, 10,  5,
      0,  0,  0,  0,  0,  0,  0,  0,
  ],
  n: [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50,
  ],
  b: [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20,
  ],
  r: [
      0,  0,  0,  0,  0,  0,  0,  0,
      5, 10, 10, 10, 10, 10, 10,  5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
      0,  0,  0,  5,  5,  0,  0,  0,
  ],
  q: [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20,
  ],
  k: [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20,
  ],
};

const LEVEL_PLANS = {
  1: { kind: "restricted" },
  2: { kind: "greedy", width: 8 },
  3: { kind: "search", depth: 1, nodeBudget: 2000 },
  4: { kind: "search", depth: 2, nodeBudget: 4000 },
  5: { kind: "search", depth: 2, nodeBudget: 8000 },
  6: { kind: "search", depth: 3, nodeBudget: 12000 },
  7: { kind: "search", depth: 3, nodeBudget: 16000 },
  8: { kind: "search", depth: 4, nodeBudget: 20000 },
  9: { kind: "search", depth: 4, nodeBudget: 28000 },
  10: { kind: "search", depth: 4, nodeBudget: 36000 },
};

function normalizeLevel(level) {
  const n = Math.round(Number(level));
  if (!Number.isFinite(n)) return AI_MAX_LEVEL;
  return Math.min(AI_MAX_LEVEL, Math.max(AI_MIN_LEVEL, n));
}

function looksLikeState(state) {
  return (
    state !== null &&
    typeof state === "object" &&
    Array.isArray(state.board) &&
    state.board.length === 8
  );
}

function pieceValue(type) {
  return PIECE_VALUES[type] ?? 0;
}

function evaluate(state) {
  const { board, turn } = state;
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      const table = PST[piece.type];
      let value = pieceValue(piece.type);
      if (table) {
        value += piece.color === "w" ? table[r * 8 + c] : table[(7 - r) * 8 + c];
      }
      score += piece.color === "w" ? value : -value;
    }
  }
  return turn === "w" ? score : -score;
}

function orderScore(move) {
  let score = 0;
  if (move.captured) {
    score += 10 * pieceValue(move.captured) - pieceValue(move.piece);
  }
  if (move.promotion) score += pieceValue(move.promotion);
  return score;
}

function sortByOrderDesc(entries) {
  entries.sort((a, b) => b.order - a.order);
}

function findImmediateMate(state, legalMoves) {
  for (const move of legalMoves) {
    const child = applyMove(state, move);
    if (getGameStatus(child).status === "checkmate") return move;
  }
  return null;
}

function givesOpponentMateInOne(state, move) {
  const child = applyMove(state, move);
  const replies = generateLegalMoves(child);
  const ordered = replies
    .map((m) => ({ m, order: orderScore(m) }))
    .sort((a, b) => b.order - a.order);
  for (const { m } of ordered) {
    const after = applyMove(child, m);
    if (getGameStatus(after).status === "checkmate") return true;
  }
  return false;
}

function partitionSafeMoves(state, legalMoves) {
  const safe = [];
  for (const move of legalMoves) {
    if (!givesOpponentMateInOne(state, move)) safe.push(move);
  }
  return safe;
}

function restrictedPick(pool) {
  const tiers = [
    pool.filter(
      (m) => !m.captured && !m.promotion && (m.piece === "p" || m.piece === "n")
    ),
    pool.filter((m) => !m.captured && !m.promotion),
    pool,
  ];
  for (const tier of tiers) {
    if (tier.length === 0) continue;
    let best = tier[0];
    for (let i = 1; i < tier.length; i++) {
      const a = best;
      const b = tier[i];
      const less =
        b.from[0] < a.from[0] ||
        (b.from[0] === a.from[0] &&
          (b.from[1] < a.from[1] ||
            (b.from[1] === a.from[1] &&
              (b.to[0] < a.to[0] ||
                (b.to[0] === a.to[0] &&
                  (b.to[1] < a.to[1] ||
                    (b.to[1] === a.to[1] &&
                      String(b.promotion ?? "") <
                        String(a.promotion ?? ""))))))));
      if (less) best = b;
    }
    return best;
  }
  return pool[0];
}

function greedyPick(state, pool, width) {
  const scored = pool
    .map((move) => ({
      move,
      gain:
        (move.captured ? pieceValue(move.captured) : 0) +
        (move.promotion ? pieceValue(move.promotion) - PIECE_VALUES.p : 0),
    }))
    .sort((a, b) => b.gain - a.gain);
  const shortlist = scored.slice(0, width);
  let best = shortlist[0].move;
  let bestVal = -Infinity;
  for (const { move } of shortlist) {
    const child = applyMove(state, move);
    const val = -evaluate(child);
    if (val > bestVal) {
      bestVal = val;
      best = move;
    }
  }
  return best;
}

function negamax(state, depth, alpha, beta, ply, ctx) {
  if (ctx.aborted) return 0;
  ctx.nodes += 1;
  if (ctx.nodes > ctx.nodeBudget) {
    ctx.aborted = true;
    return 0;
  }
  const moves = generateLegalMoves(state);
  if (moves.length === 0) {
    const status = getGameStatus(state);
    return status.status === "checkmate" ? -(MATE_SCORE - ply) : 0;
  }
  if (depth <= 0) return evaluate(state);
  const ordered = moves.map((m) => ({ m, order: orderScore(m) }));
  sortByOrderDesc(ordered);
  for (const { m } of ordered) {
    const child = applyMove(state, m);
    const val = -negamax(child, depth - 1, -beta, -alpha, ply + 1, ctx);
    if (ctx.aborted) return 0;
    if (val > alpha) alpha = val;
    if (alpha >= beta) break;
  }
  return alpha;
}

function searchPick(state, pool, plan) {
  const ctx = { nodes: 0, nodeBudget: plan.nodeBudget, aborted: false };
  const entries = pool.map((m) => ({ m, order: orderScore(m), score: 0 }));
  let best = entries.length > 0 ? entries[0].m : null;
  for (let depth = 1; depth <= plan.depth; depth++) {
    let alpha = -Infinity;
    let completed = true;
    for (const entry of entries) {
      const child = applyMove(state, entry.m);
      entry.score = -negamax(child, depth - 1, -Infinity, -alpha, 1, ctx);
      if (ctx.aborted) {
        completed = false;
        break;
      }
      if (entry.score > alpha) alpha = entry.score;
    }
    if (!completed) break;
    entries.sort((a, b) => b.score - a.score);
    best = entries[0].m;
  }
  return best;
}

/**
 * Pick a move for the side to move in `state`.
 *
 * @param {object} state Game state from chess.mjs (never mutated).
 * @param {number} [level=AI_MAX_LEVEL] Difficulty 1..10.
 * @param {object} [context={}] Optional getGameStatus context
 *   (e.g. `{ repetitionCount }`) so history-based automatic draws also
 *   yield null.
 * @returns {object|null} A legal engine move, or null when the position is
 *   terminal (checkmate/stalemate/drawn), invalid, or unusable input.
 */
export function chooseMove(state, level = AI_MAX_LEVEL, context = {}) {
  try {
    if (!looksLikeState(state)) return null;
    const lvl = normalizeLevel(level);
    const status = getGameStatus(state, context);
    if (status.status !== "ongoing") return null;
    const legalMoves = generateLegalMoves(state);
    if (legalMoves.length === 0) return null;

    const matingMove = findImmediateMate(state, legalMoves);
    if (matingMove) return matingMove;

    const safeMoves = partitionSafeMoves(state, legalMoves);
    const pool = safeMoves.length > 0 ? safeMoves : legalMoves;

    const plan = LEVEL_PLANS[lvl];
    if (plan.kind === "restricted") return restrictedPick(pool);
    if (plan.kind === "greedy") return greedyPick(state, pool, plan.width);
    return searchPick(state, pool, plan);
  } catch {
    return null;
  }
}

