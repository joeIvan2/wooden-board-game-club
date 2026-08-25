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
  l7: 3200,
  l8: 3200,
  l9: 4500,
  l10: 6000,
});

const OPENING_BOOK = Object.freeze([
  Object.freeze({ id: "central-cannons", moves: Object.freeze(["h3e3", "h8e8", "b3c3", "b8c8"]) }),
  Object.freeze({ id: "horses-out", moves: Object.freeze(["h1g3", "b10c8", "b1c3", "h10g8"]) }),
  Object.freeze({ id: "central-soldiers", moves: Object.freeze(["e4e5", "e7e6", "h3e3", "h8e8"]) }),
  Object.freeze({ id: "right-cannon", moves: Object.freeze(["h3h6", "h8e8", "b1c3", "b10c8"]) }),
  Object.freeze({ id: "left-cannon", moves: Object.freeze(["b3b6", "b10c8", "h1g3", "h8h5"]) }),
  Object.freeze({ id: "left-horse", moves: Object.freeze(["b1c3", "h10g8", "h3e3", "b8e8"]) }),
]);

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

async function chooseLevelMove({ state, level, engine, engineTimes, classicTimeMs }) {
  if (levelNumber(level) <= 5) {
    return chooseClassicMove(state, levelNumber(level), { maxTimeMs: classicTimeMs }).move;
  }
  const uci = await engine.choose({
    game: "xiangqi",
    fen: stateToFen(state),
    level: levelNumber(level),
    movetimeMs: engineTimeFor(level, engineTimes),
  });
  return uciToMove(uci);
}

export function buildOpeningSchedule(options = {}) {
  const gamesPerPair = Number.isInteger(options.gamesPerPair) ? options.gamesPerPair : 1;
  if (gamesPerPair < 1 || gamesPerPair > 10_000) throw new Error("gamesPerPair must be an integer from 1 to 10000");
  const offset = Number.isInteger(options.openingOffset) ? options.openingOffset : 0;
  return Array.from({ length: gamesPerPair }, (_, index) => OPENING_BOOK[(offset + index) % OPENING_BOOK.length]);
}

export async function playGame(options = {}) {
  const white = normalizeLevel(options.white ?? "l5");
  const black = normalizeLevel(options.black ?? "l6");
  const maxPlies = Number.isInteger(options.maxPlies) ? options.maxPlies : 180;
  const classicTimeMs = Number.isFinite(options.classicTimeMs) ? Math.max(50, Math.floor(options.classicTimeMs)) : 1500;
  const opening = options.opening ?? OPENING_BOOK[0].moves;
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
      const move = await chooseLevelMove({ state, level, engine, engineTimes: options.engineTimes, classicTimeMs });
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
  try {
    for (const plan of plans) {
      games.push(await playGame({
        ...plan,
        engine,
        maxPlies: options.maxPlies,
        classicTimeMs: options.classicTimeMs,
        engineTimes: options.engineTimes,
      }));
    }
  } finally {
    await engine.close();
  }
  return {
    schemaVersion: 1,
    engine: { l5: "classic-search", l6to10: "fairy-stockfish-nnue-1.1.11" },
    config: {
      levels,
      gamesPerPair: openings.length,
      pairedColors: true,
      sharedOpeningSchedule: true,
      maxPlies: options.maxPlies ?? 180,
      classicTimeMs: options.classicTimeMs ?? 1500,
      engineTimes: Object.fromEntries(levels.filter((level) => levelNumber(level) > 5)
        .map((level) => [level, engineTimeFor(level, options.engineTimes)])),
    },
    openings,
    games,
    ...summarizeTournament(levels, games),
  };
}
