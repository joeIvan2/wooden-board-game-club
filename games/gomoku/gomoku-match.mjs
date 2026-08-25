// Browser-independent game runner.  It deliberately calls the same L1-L10
// selection module used by app.js, so CLI results are production-AI results.
import {
  createBoard,
  applyMove,
  applyOpening,
  indexToMove,
  moveToIndex,
  isBoardFull,
  validatePosition,
} from './gomoku-rules.mjs';
import {
  getLevelProfile,
  normalizeLevel,
  selectLevelMove,
  getLastLevelSearchInfo,
} from './gomoku-levels.mjs';

const PLAYER_NAME = Object.freeze({ 1: 'black', 2: 'white' });

function normalizeOpening(opening) {
  if (!Array.isArray(opening)) return [];
  return opening.map((item, ply) => {
    const player = item?.player ?? (ply % 2 === 0 ? 1 : 2);
    const index = Number.isInteger(item) ? item : moveToIndex(item?.index ?? item);
    return { player, index };
  });
}

function resultForInvalidMove({ board, moves, player, level, message, opening, options, diagnostics }) {
  return {
    id: options.id ?? null,
    seed: options.seed ?? null,
    openingId: options.openingId ?? null,
    black: options.black,
    white: options.white,
    opening,
    winner: PLAYER_NAME[3 - player],
    reason: 'invalid-move',
    invalid: true,
    error: { player: PLAYER_NAME[player], level, message },
    plies: moves.length,
    moves,
    finalBoard: board,
    diagnostics,
  };
}

export function playGame(options = {}) {
  const black = normalizeLevel(options.black ?? 'l3');
  const white = normalizeLevel(options.white ?? 'l3');
  getLevelProfile(black);
  getLevelProfile(white);
  const opening = normalizeOpening(options.opening);
  if (opening.length % 2 !== 0) throw new Error('opening must contain an even number of plies');

  const board = createBoard();
  applyOpening(board, opening);
  const position = validatePosition(board, 1);
  if (position.winner !== 0 || position.full) throw new Error('opening must be a non-terminal position');

  const moves = opening.map(({ player, index }, ply) => ({
    ply: ply + 1,
    player: PLAYER_NAME[player],
    level: null,
    index,
    ...indexToMove(index),
    opening: true,
  }));
  const diagnostics = {
    black: { nodes: 0, elapsedMs: 0, timedOut: 0, searches: 0 },
    white: { nodes: 0, elapsedMs: 0, timedOut: 0, searches: 0 },
  };
  const maxPlies = options.maxPlies ?? board.length;
  let player = 1;

  while (moves.length < maxPlies) {
    const level = player === 1 ? black : white;
    let move;
    try {
      move = selectLevelMove(board, player, level, {
        context: options.context ?? 'tournament',
        ...(options.searchOverrides || {}),
      });
    } catch (error) {
      return resultForInvalidMove({
        board,
        moves,
        player,
        level,
        message: error instanceof Error ? error.message : String(error),
        opening,
        options: { ...options, black, white },
        diagnostics,
      });
    }
    const info = getLastLevelSearchInfo();
    const bucket = diagnostics[PLAYER_NAME[player]];
    bucket.nodes += Number(info.nodes) || 0;
    bucket.elapsedMs += Number(info.elapsedMs) || 0;
    bucket.searches++;
    if (info.timedOut) bucket.timedOut++;

    let index;
    try {
      index = moveToIndex(move);
      if (board[index] !== 0) throw new Error('AI selected an occupied square');
    } catch (error) {
      return resultForInvalidMove({
        board,
        moves,
        player,
        level,
        message: error instanceof Error ? error.message : String(error),
        opening,
        options: { ...options, black, white },
        diagnostics,
      });
    }

    const won = applyMove(board, index, player);
    moves.push({
      ply: moves.length + 1,
      player: PLAYER_NAME[player],
      level,
      index,
      ...indexToMove(index),
      opening: false,
      search: info,
    });
    if (won) {
      return {
        id: options.id ?? null,
        seed: options.seed ?? null,
        openingId: options.openingId ?? null,
        black,
        white,
        opening,
        winner: PLAYER_NAME[player],
        reason: 'five',
        invalid: false,
        plies: moves.length,
        moves,
        finalBoard: [...board],
        diagnostics,
      };
    }
    if (isBoardFull(board)) {
      return {
        id: options.id ?? null,
        seed: options.seed ?? null,
        openingId: options.openingId ?? null,
        black,
        white,
        opening,
        winner: 'draw',
        reason: 'board-full',
        invalid: false,
        plies: moves.length,
        moves,
        finalBoard: [...board],
        diagnostics,
      };
    }
    player = 3 - player;
  }

  return {
    id: options.id ?? null,
    seed: options.seed ?? null,
    openingId: options.openingId ?? null,
    black,
    white,
    opening,
    winner: 'draw',
    reason: 'max-plies',
    invalid: true,
    error: { message: `game stopped at configured maxPlies=${maxPlies}` },
    plies: moves.length,
    moves,
    finalBoard: [...board],
    diagnostics,
  };
}

export default { playGame };

