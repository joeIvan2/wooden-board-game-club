// Pure Gomoku rule helpers shared by the headless arena and tactical tests.
// Board values are 0 (empty), 1 (black), and 2 (white); five or more wins.
import {
  BOARD_SIZE,
  CELLS,
  flattenBoard,
  winsAt,
  candidateMoves,
} from './gomoku-ai-v4-core.mjs';

export { BOARD_SIZE, CELLS };

export function createBoard() {
  return Array(CELLS).fill(0);
}

export function normalizeBoard(inputBoard) {
  const board = flattenBoard(inputBoard);
  if (!board || board.length !== CELLS) {
    throw new Error(`board must contain exactly ${BOARD_SIZE}x${BOARD_SIZE} cells`);
  }
  for (let index = 0; index < CELLS; index++) {
    if (board[index] !== 0 && board[index] !== 1 && board[index] !== 2) {
      throw new Error(`invalid board value at index ${index}: ${String(board[index])}`);
    }
  }
  return board;
}

export function indexToMove(index) {
  if (!Number.isInteger(index) || index < 0 || index >= CELLS) {
    throw new Error(`invalid board index: ${String(index)}`);
  }
  return { row: (index / BOARD_SIZE) | 0, col: index % BOARD_SIZE };
}

export function moveToIndex(move) {
  if (Number.isInteger(move)) {
    indexToMove(move);
    return move;
  }
  if (!move || !Number.isInteger(move.row) || !Number.isInteger(move.col)
    || move.row < 0 || move.row >= BOARD_SIZE || move.col < 0 || move.col >= BOARD_SIZE) {
    throw new Error(`invalid move: ${JSON.stringify(move)}`);
  }
  return move.row * BOARD_SIZE + move.col;
}

export function legalMoves(board) {
  const moves = [];
  for (let index = 0; index < CELLS; index++) if (board[index] === 0) moves.push(index);
  return moves;
}

export function isBoardFull(board) {
  return !board.includes(0);
}

export function applyMove(board, index, player) {
  if (player !== 1 && player !== 2) throw new Error(`invalid player: ${String(player)}`);
  indexToMove(index);
  if (board[index] !== 0) throw new Error(`occupied move at ${JSON.stringify(indexToMove(index))}`);
  board[index] = player;
  return winsAt(board, index, player);
}

export function winnerOnBoard(board) {
  let winner = 0;
  for (let index = 0; index < CELLS; index++) {
    const player = board[index];
    if (player === 0 || !winsAt(board, index, player)) continue;
    if (winner !== 0 && winner !== player) throw new Error('position has winners for both players');
    winner = player;
  }
  return winner;
}

export function validatePosition(inputBoard, expectedPlayer = null) {
  const board = normalizeBoard(inputBoard);
  let black = 0;
  let white = 0;
  for (const cell of board) {
    if (cell === 1) black++;
    if (cell === 2) white++;
  }
  if (white > black || black - white > 1) {
    throw new Error(`invalid turn counts: black=${black}, white=${white}`);
  }
  const winner = winnerOnBoard(board);
  if (winner === 1 && black !== white + 1) throw new Error('black winner has invalid turn counts');
  if (winner === 2 && black !== white) throw new Error('white winner has invalid turn counts');
  const nextPlayer = black === white ? 1 : 2;
  if (expectedPlayer !== null && expectedPlayer !== nextPlayer) {
    throw new Error(`expected player ${expectedPlayer}, but position turn is ${nextPlayer}`);
  }
  return { board, black, white, nextPlayer, winner, full: isBoardFull(board) };
}

function seededRandom(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

export function transformIndex(index, symmetry = 0) {
  const { row, col } = indexToMove(index);
  const n = BOARD_SIZE - 1;
  let nextRow = row;
  let nextCol = col;
  switch (((symmetry % 8) + 8) % 8) {
    case 1: nextRow = col; nextCol = n - row; break;
    case 2: nextRow = n - row; nextCol = n - col; break;
    case 3: nextRow = n - col; nextCol = row; break;
    case 4: nextRow = row; nextCol = n - col; break;
    case 5: nextRow = n - col; nextCol = n - row; break;
    case 6: nextRow = n - row; nextCol = col; break;
    case 7: nextRow = col; nextCol = row; break;
    default: break;
  }
  return nextRow * BOARD_SIZE + nextCol;
}

// Produces an even-ply opening so black is always to move when the game starts.
// The compact, center-adjacent book reduces black-first/opening-position bias
// while remaining deterministic from seed + symmetry.
export function generateOpening({ seed = 1, plies = 4, symmetry = 0 } = {}) {
  if (!Number.isInteger(plies) || plies < 0 || plies > 20 || plies % 2 !== 0) {
    throw new Error('opening plies must be an even integer from 0 to 20');
  }
  const board = createBoard();
  const random = seededRandom(seed);
  const baseMoves = [];
  for (let ply = 0; ply < plies; ply++) {
    const player = ply % 2 === 0 ? 1 : 2;
    let index;
    if (ply === 0) {
      index = 7 * BOARD_SIZE + 7;
    } else {
      const candidates = candidateMoves(board, 2).sort((left, right) => left - right);
      // Draw from a stable local subset, not all 225 squares, to create usable
      // midgame positions without baking in one particular tactical opening.
      const choiceCount = Math.min(candidates.length, 12);
      index = candidates[Math.floor(random() * choiceCount)] ?? legalMoves(board)[0];
    }
    applyMove(board, index, player);
    baseMoves.push({ player, index });
  }
  return baseMoves.map(({ player, index }) => ({ player, index: transformIndex(index, symmetry) }));
}

export function applyOpening(board, openingMoves) {
  if (!Array.isArray(openingMoves)) throw new Error('opening must be an array');
  for (let ply = 0; ply < openingMoves.length; ply++) {
    const item = openingMoves[ply];
    const player = item?.player ?? (ply % 2 === 0 ? 1 : 2);
    const index = Number.isInteger(item) ? item : moveToIndex(item?.index ?? item);
    const expected = ply % 2 === 0 ? 1 : 2;
    if (player !== expected) throw new Error(`opening ply ${ply} has wrong player`);
    if (applyMove(board, index, player)) throw new Error(`opening already ends at ply ${ply + 1}`);
  }
  return board;
}

export default {
  BOARD_SIZE,
  CELLS,
  createBoard,
  normalizeBoard,
  indexToMove,
  moveToIndex,
  legalMoves,
  isBoardFull,
  applyMove,
  winnerOnBoard,
  validatePosition,
  transformIndex,
  generateOpening,
  applyOpening,
};
