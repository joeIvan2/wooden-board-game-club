// Reproducible L5-L10 Chess self-play.  The match runner calls the same rules
// module as the board and the same L5 classic / L6-L10 Fairy engine routes.

import {
  applyMove,
  createInitialState,
  createRepetitionTracker,
  getGameStatus,
} from "./chess.mjs";
import { chooseMove as chooseClassicMove } from "./chess-ai.mjs";
import { FairyStockfishNode } from "../../shared/fairy-stockfish-node.mjs";
import {
  levelNumber,
  normalizeLevel,
  planPairedGames,
  summarizeTournament,
} from "../../shared/paired-level-tournament.mjs";

export const CHESS_ENGINE_TIMES_MS = Object.freeze({
  l6: 1500,
  l7: 2300,
  l8: 3400,
  l9: 5000,
  l10: 7200,
});

// Fixed, legal opening positions. Each line has an even number of plies, so
// white is to move when the paired game begins. They are deliberately deeper
// than a four-ply opening: an audit needs varied middlegame decisions rather
// than repeated engine draws from near-initial symmetry.
export const CHESS_OPENING_BOOK = Object.freeze([
  Object.freeze({ id: "italian", moves: Object.freeze(["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "d2d3", "f8c5"]) }),
  Object.freeze({ id: "ruy-lopez", moves: Object.freeze(["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5a4", "g8f6"]) }),
  Object.freeze({ id: "scotch", moves: Object.freeze(["e2e4", "e7e5", "g1f3", "b8c6", "d2d4", "e5d4", "f3d4", "g8f6"]) }),
  Object.freeze({ id: "sicilian-open", moves: Object.freeze(["e2e4", "c7c5", "g1f3", "d7d6", "d2d4", "c5d4", "f3d4", "g8f6"]) }),
  Object.freeze({ id: "sicilian-najdorf", moves: Object.freeze(["e2e4", "c7c5", "g1f3", "d7d6", "d2d4", "c5d4", "f3d4", "g8f6", "b1c3", "a7a6"]) }),
  Object.freeze({ id: "queens-gambit", moves: Object.freeze(["d2d4", "d7d5", "c2c4", "e7e6", "b1c3", "g8f6", "c1g5", "f8e7"]) }),
  Object.freeze({ id: "slav", moves: Object.freeze(["d2d4", "d7d5", "c2c4", "c7c6", "b1c3", "g8f6", "g1f3", "d5c4"]) }),
  Object.freeze({ id: "queens-indian", moves: Object.freeze(["d2d4", "g8f6", "c2c4", "e7e6", "g1f3", "b7b6", "g2g3", "c8b7"]) }),
  Object.freeze({ id: "kings-indian", moves: Object.freeze(["d2d4", "g8f6", "c2c4", "g7g6", "b1c3", "f8g7", "e2e4", "d7d6"]) }),
  Object.freeze({ id: "english", moves: Object.freeze(["c2c4", "e7e5", "b1c3", "g8f6", "g2g3", "d7d5", "c4d5", "f6d5"]) }),
  Object.freeze({ id: "french", moves: Object.freeze(["e2e4", "e7e6", "d2d4", "d7d5", "b1c3", "g8f6", "c1g5", "f8e7"]) }),
  Object.freeze({ id: "caro-kann", moves: Object.freeze(["e2e4", "c7c6", "d2d4", "d7d5", "b1c3", "d5e4", "c3e4", "c8f5"]) }),
]);

export const CHESS_AUDIT_DEPTHS = Object.freeze({
  l6: 8,
  l7: 10,
  l8: 12,
  l9: 14,
  l10: 16,
});

function sameMove(left, right) {
  return left?.from?.[0] === right?.from?.[0]
    && left?.from?.[1] === right?.from?.[1]
    && left?.to?.[0] === right?.to?.[0]
    && left?.to?.[1] === right?.to?.[1]
    && (left?.promotion ?? null) === (right?.promotion ?? null);
}

function uciToMove(uci) {
  const match = /^([a-h])([1-8])([a-h])([1-8])([qrbn])?$/i.exec(String(uci || ""));
  if (!match) return null;
  const [, fromFile, fromRank, toFile, toRank, promotion] = match;
  return {
    from: [8 - Number(fromRank), fromFile.toLowerCase().charCodeAt(0) - 97],
    to: [8 - Number(toRank), toFile.toLowerCase().charCodeAt(0) - 97],
    promotion: promotion?.toLowerCase() ?? null,
  };
}

export function stateToFen(state) {
  const rows = state.board.map((row) => {
    let empty = 0;
    let fen = "";
    for (const piece of row) {
      if (!piece) {
        empty += 1;
        continue;
      }
      if (empty) {
        fen += String(empty);
        empty = 0;
      }
      fen += piece.color === "w" ? piece.type.toUpperCase() : piece.type;
    }
    return `${fen}${empty || ""}`;
  });
  const castling = [
    state.castling?.wK ? "K" : "",
    state.castling?.wQ ? "Q" : "",
    state.castling?.bK ? "k" : "",
    state.castling?.bQ ? "q" : "",
  ].join("") || "-";
  const enPassant = state.enPassant
    ? `${String.fromCharCode(97 + state.enPassant.col)}${8 - state.enPassant.row}`
    : "-";
  return `${rows.join("/")} ${state.turn} ${castling} ${enPassant} ${state.halfmoveClock} ${state.fullmoveNumber}`;
}

function applyUci(state, uci) {
  const move = uciToMove(uci);
  if (!move) throw new Error(`Invalid Chess opening move: ${uci}`);
  return applyMove(state, move);
}

function resultForError({ id, openingId, white, black, moves, error }) {
  return {
    id,
    openingId,
    white,
    black,
    winner: null,
    invalid: true,
    reason: "invalid-move",
    error: String(error?.message || error),
    plies: moves.length,
    moves,
  };
}

function engineTimeFor(level, overrides) {
  const normalized = normalizeLevel(level);
  const override = overrides?.[normalized];
  if (Number.isFinite(override) && override >= 50) return Math.floor(override);
  return CHESS_ENGINE_TIMES_MS[normalized] ?? CHESS_ENGINE_TIMES_MS.l10;
}

function auditDepthFor(level, overrides) {
  const normalized = normalizeLevel(level);
  const override = overrides?.[normalized];
  if (Number.isInteger(override) && override >= 1 && override <= 99) return override;
  return CHESS_AUDIT_DEPTHS[normalized] ?? CHESS_AUDIT_DEPTHS.l10;
}

async function chooseLevelMove({ state, level, repetitionCount, engine, engineTimes, engineControl, engineDepths }) {
  if (levelNumber(level) <= 5) {
    return chooseClassicMove(state, levelNumber(level), { repetitionCount });
  }
  const fixedDepth = engineControl === "fixed-depth";
  const uci = await engine.choose({
    game: "chess",
    fen: stateToFen(state),
    level: levelNumber(level),
    movetimeMs: engineTimeFor(level, engineTimes),
    searchDepth: fixedDepth ? auditDepthFor(level, engineDepths) : undefined,
    // The deterministic capability audit removes the stochastic weakening
    // knob; production-parity games retain the shipped per-level Skill value.
    engineSkill: fixedDepth ? 20 : undefined,
  });
  return uciToMove(uci);
}

export function buildOpeningSchedule(options = {}) {
  const gamesPerPair = Number.isInteger(options.gamesPerPair) ? options.gamesPerPair : 1;
  if (gamesPerPair < 1 || gamesPerPair > CHESS_OPENING_BOOK.length) {
    throw new Error(`gamesPerPair must be an integer from 1 to ${CHESS_OPENING_BOOK.length} without repeating openings`);
  }
  const offset = Number.isInteger(options.openingOffset) ? options.openingOffset : 0;
  const start = ((offset % CHESS_OPENING_BOOK.length) + CHESS_OPENING_BOOK.length) % CHESS_OPENING_BOOK.length;
  return Array.from({ length: gamesPerPair }, (_, index) => CHESS_OPENING_BOOK[(start + index) % CHESS_OPENING_BOOK.length]);
}

export async function playGame(options = {}) {
  const white = normalizeLevel(options.white ?? "l5");
  const black = normalizeLevel(options.black ?? "l6");
  const maxPlies = Number.isInteger(options.maxPlies) ? options.maxPlies : 160;
  const opening = options.opening ?? CHESS_OPENING_BOOK[0].moves;
  let state = createInitialState();
  const repetition = createRepetitionTracker();
  repetition.reset(state);
  const moves = [];
  try {
    for (const uci of opening) {
      state = applyUci(state, uci);
      repetition.push(state);
      moves.push({ uci, opening: true });
    }
  } catch (error) {
    return resultForError({ ...options, white, black, moves, error });
  }

  const suppliedEngine = options.engine ?? null;
  const engine = suppliedEngine ?? new FairyStockfishNode();
  try {
    while (moves.length < maxPlies) {
      const status = getGameStatus(state, { repetitionCount: repetition.countCurrent() });
      if (status.status !== "ongoing") {
        return {
          id: options.id ?? null,
          openingId: options.openingId ?? null,
          white,
          black,
          winner: status.winner === "w" ? "white" : status.winner === "b" ? "black" : "draw",
          invalid: false,
          reason: status.status,
          plies: moves.length,
          moves,
        };
      }
      const level = state.turn === "w" ? white : black;
      const move = await chooseLevelMove({
        state,
        level,
        repetitionCount: repetition.countCurrent(),
        engine,
        engineTimes: options.engineTimes,
        engineControl: options.engineControl,
        engineDepths: options.engineDepths,
      });
      if (!move) throw new Error(`${level} returned no move for an ongoing position`);
      const next = applyMove(state, move);
      moves.push({ move, level, opening: false });
      state = next;
      repetition.push(state);
    }
    return {
      id: options.id ?? null,
      openingId: options.openingId ?? null,
      white,
      black,
      winner: "draw",
      invalid: false,
      reason: "max-plies",
      plies: moves.length,
      moves,
    };
  } catch (error) {
    return resultForError({ ...options, white, black, moves, error });
  } finally {
    if (!suppliedEngine) await engine.close();
  }
}

export async function runTournament(options = {}) {
  const levels = (options.levels ?? ["l5", "l6", "l7", "l8", "l9", "l10"]).map(normalizeLevel);
  const openings = buildOpeningSchedule(options);
  const plans = planPairedGames(levels, openings);
  const games = [];
  const engine = new FairyStockfishNode();
  const engineControl = options.engineControl === "fixed-depth" ? "fixed-depth" : "production-parity";
  try {
    for (const plan of plans) {
      await engine.resetGame();
      games.push(await playGame({
        ...plan,
        engine,
        maxPlies: options.maxPlies,
        engineTimes: options.engineTimes,
        engineControl,
        engineDepths: options.engineDepths,
      }));
    }
  } finally {
    await engine.close();
  }
  return {
    schemaVersion: 2,
    engine: { l5: "classic-search", l6to10: "fairy-stockfish-nnue-1.1.11" },
    config: {
      levels,
      gamesPerPair: openings.length,
      pairedColors: true,
      sharedOpeningSchedule: true,
      maxPlies: options.maxPlies ?? 160,
      engineControl,
      engineDepths: engineControl === "fixed-depth"
        ? Object.fromEntries(levels.filter((level) => levelNumber(level) > 5)
          .map((level) => [level, auditDepthFor(level, options.engineDepths)]))
        : null,
      engineTimes: Object.fromEntries(levels.filter((level) => levelNumber(level) > 5)
        .map((level) => [level, engineTimeFor(level, options.engineTimes)])),
    },
    openings,
    games,
    ...summarizeTournament(levels, games),
  };
}
