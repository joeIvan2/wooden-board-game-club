import { applyMove, generateLegalMoves, getGameStatus } from "./chess.mjs";

const FILES = "abcdefgh";

const LETTERS = { k: "K", q: "Q", r: "R", b: "B", n: "N" };

export function squareName(square) {
  return FILES[square[1]] + String(8 - square[0]);
}

export function formatSan(state, move) {
  if (move.isCastle === "k") return withSuffix(state, move, "O-O");
  if (move.isCastle === "q") return withSuffix(state, move, "O-O-O");
  let core;
  if (move.piece === "p") {
    core = move.captured
      ? FILES[move.from[1]] + "x" + squareName(move.to)
      : squareName(move.to);
    if (move.promotion) core += "=" + LETTERS[move.promotion];
  } else {
    core =
      LETTERS[move.piece] +
      disambiguation(state, move) +
      (move.captured ? "x" : "") +
      squareName(move.to);
  }
  return withSuffix(state, move, core);
}

function withSuffix(state, move, core) {
  try {
    const next = applyMove(state, move);
    const status = getGameStatus(next);
    if (status.status === "checkmate") return core + "#";
    if (status.inCheck) return core + "+";
  } catch {
    return core;
  }
  return core;
}

function disambiguation(state, move) {
  if (move.piece === "k") return "";
  const rivals = generateLegalMoves(state).filter(
    (m) =>
      !(m.from[0] === move.from[0] && m.from[1] === move.from[1]) &&
      m.piece === move.piece &&
      m.to[0] === move.to[0] &&
      m.to[1] === move.to[1]
  );
  if (rivals.length === 0) return "";
  const sharesFile = rivals.some((m) => m.from[1] === move.from[1]);
  const sharesRank = rivals.some((m) => m.from[0] === move.from[0]);
  if (!sharesFile) return FILES[move.from[1]];
  if (!sharesRank) return String(8 - move.from[0]);
  return FILES[move.from[1]] + String(8 - move.from[0]);
}
