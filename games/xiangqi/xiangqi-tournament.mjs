// Reproducible L5-L10 Xiangqi self-play using the production rules module and
// the same classic/Fairy-Stockfish boundary as the browser board.

import { applyMove, createInitialState, getGameStatus, getLegalMoves, sameSquare } from "./xiangqi-rules.mjs";
import { chooseMove as chooseClassicMove } from "./xiangqi-ai.mjs";
import { FairyStockfishNode } from "../../shared/fairy-stockfish-node.mjs";
import {
  levelNumber,
  normalizeLevel,
  planPairedGames,
  summarizeTournament,
} from "../../shared/paired-level-tournament.mjs";

export const XIANGQI_ENGINE_TIMES_MS = Object.freeze({
  l6: 2500,
  l7: 3400,
  l8: 4600,
  l9: 6200,
  l10: 8200,
});

// Fixed, legal opening positions. Each even-length line leaves Red to move,
// so every level pairing gets the same position once as Red and once as Black.
// A varied mid-opening corpus avoids repeatedly benchmarking a near-initial,
// symmetric position where strong engines naturally converge to a draw.
export const XIANGQI_OPENING_BOOK = Object.freeze([
  Object.freeze({ id: "central-cannon-screen-horse", moves: Object.freeze(["h3e3", "h8e8", "h1g3", "b10c8", "b1c3", "h10g8", "g4g5", "g7g6"]) }),
  Object.freeze({ id: "central-cannon-left-horse", moves: Object.freeze(["h3e3", "h8e8", "b1c3", "b10c8", "h1g3", "h10g8", "c4c5", "c7c6"]) }),
  Object.freeze({ id: "central-soldier", moves: Object.freeze(["e4e5", "e7e6", "h3e3", "h8e8", "b1c3", "b10c8", "h1g3", "h10g8"]) }),
  Object.freeze({ id: "right-cannon", moves: Object.freeze(["h3h6", "h8e8", "b1c3", "b10c8", "h1g3", "h10g8", "e4e5", "e7e6"]) }),
  Object.freeze({ id: "left-cannon", moves: Object.freeze(["b3b6", "b10c8", "h1g3", "h8h5", "b1c3", "h10g8", "e4e5", "e7e6"]) }),
  Object.freeze({ id: "left-horse", moves: Object.freeze(["b1c3", "h10g8", "h3e3", "b8e8", "h1g3", "b10c8", "e4e5", "e7e6"]) }),
  Object.freeze({ id: "double-horses", moves: Object.freeze(["h3e3", "h8e8", "b1c3", "b10c8", "h1g3", "h10g8", "e4e5", "e7e6"]) }),
  Object.freeze({ id: "wing-soldier", moves: Object.freeze(["g4g5", "g7g6", "h3e3", "h8e8", "h1g3", "b10c8", "b1c3", "h10g8"]) }),
  Object.freeze({ id: "left-soldier", moves: Object.freeze(["c4c5", "c7c6", "h3e3", "h8e8", "b1c3", "b10c8", "h1g3", "h10g8"]) }),
  Object.freeze({ id: "wing-cannon", moves: Object.freeze(["b3b6", "h8h5", "h1g3", "b10c8", "b1c3", "h10g8", "e4e5", "e7e6"]) }),
  Object.freeze({ id: "central-vs-left-cannon", moves: Object.freeze(["h3e3", "b8e8", "b1c3", "h10g8", "h1g3", "b10c8", "e4e5", "e7e6"]) }),
  Object.freeze({ id: "right-vs-left-horse", moves: Object.freeze(["h3h6", "b8c8", "h1g3", "h8e8", "b1c3", "h10g8", "e4e5", "e7e6"]) }),
]);

export const XIANGQI_AUDIT_DEPTHS = Object.freeze({
  l6: 8,
  l7: 10,
  l8: 12,
  l9: 14,
  l10: 16,
});

function uciToMove(uci) {
  const match = /^([a-i])(10|[1-9])([a-i])(10|[1-9])$/i.exec(String(uci || ""));
  if (!match) return null;
  const [, fromFile, fromRank, toFile, toRank] = match;
  const row = (rank) => 10 - Number(rank);
  return {
    from: { row: row(fromRank), col: fromFile.toLowerCase().charCodeAt(0) - 97 },
    to: { row: row(toRank), col: toFile.toLowerCase().charCodeAt(0) - 97 },
  };
}

export function stateToFen(state) {
  const typeToUci = Object.freeze({
    general: "k", rook: "r", cannon: "c", horse: "h", advisor: "a", elephant: "e", soldier: "p",
  });
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
      const symbol = typeToUci[piece.type];
      if (!symbol) throw new Error(`Unsupported Xiangqi piece: ${piece.type}`);
      fen += piece.color === "red" ? symbol.toUpperCase() : symbol;
    }
    return `${fen}${empty || ""}`;
  });
  const fullmove = Math.max(1, Math.floor((Number(state.plies) || 0) / 2) + 1);
  return `${rows.join("/")} ${state.turn === "red" ? "w" : "b"} - - 0 ${fullmove}`;
}

function applyUci(state, uci) {
  const move = uciToMove(uci);
  if (!move) throw new Error(`Invalid Xiangqi opening move: ${uci}`);
  const legal = getLegalMoves(state).find((candidate) => sameSquare(candidate.from, move.from)
    && sameSquare(candidate.to, move.to));
  if (!legal) throw new Error(`Illegal Xiangqi move: ${uci}`);
  return applyMove(state, legal);
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
  return XIANGQI_ENGINE_TIMES_MS[normalized] ?? XIANGQI_ENGINE_TIMES_MS.l10;
}

function auditDepthFor(level, overrides) {
  const normalized = normalizeLevel(level);
  const override = overrides?.[normalized];
  if (Number.isInteger(override) && override >= 1 && override <= 99) return override;
  return XIANGQI_AUDIT_DEPTHS[normalized] ?? XIANGQI_AUDIT_DEPTHS.l10;
}

async function chooseLevelMove({ state, level, engine, engineTimes, classicTimeMs, engineControl, engineDepths }) {
  if (levelNumber(level) <= 5) {
    return chooseClassicMove(state, levelNumber(level), { maxTimeMs: classicTimeMs }).move;
  }
  const fixedDepth = engineControl === "fixed-depth";
  const uci = await engine.choose({
    game: "xiangqi",
    fen: stateToFen(state),
    level: levelNumber(level),
    movetimeMs: engineTimeFor(level, engineTimes),
    searchDepth: fixedDepth ? auditDepthFor(level, engineDepths) : undefined,
    engineSkill: fixedDepth ? 20 : undefined,
  });
  return uciToMove(uci);
}

export function buildOpeningSchedule(options = {}) {
  const gamesPerPair = Number.isInteger(options.gamesPerPair) ? options.gamesPerPair : 1;
  if (gamesPerPair < 1 || gamesPerPair > XIANGQI_OPENING_BOOK.length) {
    throw new Error(`gamesPerPair must be an integer from 1 to ${XIANGQI_OPENING_BOOK.length} without repeating openings`);
  }
  const offset = Number.isInteger(options.openingOffset) ? options.openingOffset : 0;
  const start = ((offset % XIANGQI_OPENING_BOOK.length) + XIANGQI_OPENING_BOOK.length) % XIANGQI_OPENING_BOOK.length;
  return Array.from({ length: gamesPerPair }, (_, index) => XIANGQI_OPENING_BOOK[(start + index) % XIANGQI_OPENING_BOOK.length]);
}

export async function playGame(options = {}) {
  const white = normalizeLevel(options.white ?? "l5");
  const black = normalizeLevel(options.black ?? "l6");
  const maxPlies = Number.isInteger(options.maxPlies) ? options.maxPlies : 180;
  const classicTimeMs = Number.isFinite(options.classicTimeMs) ? Math.max(50, Math.floor(options.classicTimeMs)) : 1500;
  const opening = options.opening ?? XIANGQI_OPENING_BOOK[0].moves;
  let state = createInitialState();
  const moves = [];
  try {
    for (const uci of opening) {
      state = applyUci(state, uci);
      moves.push({ uci, opening: true });
    }
  } catch (error) {
    return resultForError({ ...options, white, black, moves, error });
  }

  const suppliedEngine = options.engine ?? null;
  const engine = suppliedEngine ?? new FairyStockfishNode();
  try {
    while (moves.length < maxPlies) {
      const status = getGameStatus(state);
      if (status.status !== "ongoing") {
        return {
          id: options.id ?? null,
          openingId: options.openingId ?? null,
          white,
          black,
          winner: status.winner === "red" ? "white" : status.winner === "black" ? "black" : "draw",
          invalid: false,
          reason: status.status,
          plies: moves.length,
          moves,
        };
      }
      const level = state.turn === "red" ? white : black;
      const move = await chooseLevelMove({
        state,
        level,
        engine,
        engineTimes: options.engineTimes,
        classicTimeMs,
        engineControl: options.engineControl,
        engineDepths: options.engineDepths,
      });
      if (!move) throw new Error(`${level} returned no move for an ongoing position`);
      state = applyUci(state, `${String.fromCharCode(97 + move.from.col)}${10 - move.from.row}${String.fromCharCode(97 + move.to.col)}${10 - move.to.row}`);
      moves.push({ move, level, opening: false });
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
        classicTimeMs: options.classicTimeMs,
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
      maxPlies: options.maxPlies ?? 180,
      classicTimeMs: options.classicTimeMs ?? 1500,
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
