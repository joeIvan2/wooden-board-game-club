import { createBoard, applyMove as applyGomokuMove, isBoardFull } from "./games/gomoku/gomoku-rules.mjs";
import { validateWhiteMateRun } from "./games/chess/community-game.mjs";
import {
  createInitialState as createXiangqiState,
  applyMove as applyXiangqiMove,
  getGameStatus as getXiangqiStatus,
} from "./games/xiangqi/xiangqi-rules.mjs";
import { parseMoveText, formatCoordinateMove } from "./games/xiangqi/xiangqi-notation.mjs";

export const LEVEL_MIN = 6;
export const LEVEL_MAX = 10;
export const NAME_MAX = 24;
export const LIST_LIMIT = 50;
export const MAX_BODY_CHARS = 100000;
export const GAMES = Object.freeze(["gomoku", "chess", "xiangqi"]);

const ALLOWED_POST_KEYS = new Set(["game", "level", "displayName", "moves"]);

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function isSameOrigin(request) {
  try {
    const origin = request.headers.get("Origin");
    return typeof origin === "string" && origin.length > 0 && origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function readJsonBody(request) {
  const contentType = (request.headers.get("Content-Type") || "").toLowerCase();
  if (!contentType.includes("application/json")) return { error: "contentType" };
  let text;
  try {
    text = await request.text();
  } catch {
    return { error: "unreadableBody" };
  }
  if (text.length > MAX_BODY_CHARS) return { error: "payloadTooLarge" };
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { error: "invalidJson" };
  }
}

export function sanitizeDisplayName(raw) {
  if (typeof raw !== "string") return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  const value = raw.replace(/\s+/g, " ").trim();
  return value.length > 0 && value.length <= NAME_MAX ? value : null;
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateGomoku(moves) {
  if (!Array.isArray(moves) || moves.length < 9 || moves.length > 225) {
    return { ok: false, error: "invalidMoves" };
  }
  if (!moves.every((move) => Number.isInteger(move) && move >= 0 && move < 225)) {
    return { ok: false, error: "invalidMoves" };
  }
  const board = createBoard();
  let winner = 0;
  try {
    for (let index = 0; index < moves.length; index += 1) {
      if (winner || isBoardFull(board)) return { ok: false, error: "movesAfterTerminal" };
      const player = index % 2 === 0 ? 1 : 2;
      const won = applyGomokuMove(board, moves[index], player);
      if (won) {
        winner = player;
        if (index !== moves.length - 1) return { ok: false, error: "movesAfterTerminal" };
      }
    }
  } catch {
    return { ok: false, error: "illegalMove" };
  }
  if (winner !== 1) return { ok: false, error: "notHumanWin" };
  return { ok: true, plyCount: moves.length, normalizedMoves: [...moves] };
}

function validateChess(moves) {
  const verdict = validateWhiteMateRun(moves);
  if (!verdict.ok) return verdict;
  return {
    ok: true,
    plyCount: verdict.plyCount,
    normalizedMoves: moves.map((move) => move.trim().toLowerCase()),
  };
}

function validateXiangqi(moves) {
  if (!Array.isArray(moves) || moves.length < 1 || moves.length > 400 ||
      !moves.every((move) => typeof move === "string" && move.length > 0 && move.length <= 24)) {
    return { ok: false, error: "invalidMoves" };
  }
  let state = createXiangqiState();
  const normalizedMoves = [];
  for (let index = 0; index < moves.length; index += 1) {
    if (getXiangqiStatus(state).status !== "ongoing") {
      return { ok: false, error: "movesAfterTerminal" };
    }
    const move = parseMoveText(state, moves[index]);
    if (!move) return { ok: false, error: "illegalMove" };
    normalizedMoves.push(formatCoordinateMove(move));
    state = applyXiangqiMove(state, move);
  }
  const finalStatus = getXiangqiStatus(state);
  if (!["checkmate", "stalemate"].includes(finalStatus.status) || finalStatus.winner !== "red") {
    return { ok: false, error: "notHumanWin" };
  }
  return { ok: true, plyCount: moves.length, normalizedMoves };
}

export function validateWin(game, moves) {
  if (game === "gomoku") return validateGomoku(moves);
  if (game === "chess") return validateChess(moves);
  if (game === "xiangqi") return validateXiangqi(moves);
  return { ok: false, error: "invalidGame" };
}

function defaultDateOnly() {
  return new Date().toISOString().slice(0, 10).replaceAll("-", ".");
}

export async function handleGetLeaderboard(request, driver) {
  let game;
  let level;
  try {
    const url = new URL(request.url);
    game = url.searchParams.get("game");
    level = Number(url.searchParams.get("level"));
  } catch {
    return json({ error: "invalidUrl" }, 400);
  }
  if (!GAMES.includes(game)) return json({ error: "invalidGame" }, 400);
  if (!Number.isInteger(level) || level < LEVEL_MIN || level > LEVEL_MAX) {
    return json({ error: "levelOutOfRange" }, 400);
  }
  const rows = await driver.listByGameLevel(game, level, LIST_LIMIT);
  const entries = rows.map((row, index) => ({
    id: row.entry_uid,
    rank: index + 1,
    game: row.game,
    level: row.level,
    displayName: row.display_name,
    plyCount: row.ply_count,
    dateOnly: row.date_only,
  }));
  return json({ game, level, sort: "plyCountAsc", verification: "rules-only", entries }, 200);
}

export async function handlePostLeaderboard(request, driver, deps = {}) {
  if (!isSameOrigin(request)) return json({ error: "crossOrigin" }, 403);
  const body = await readJsonBody(request);
  if (body.error) return json({ error: body.error }, body.error === "payloadTooLarge" ? 413 : 400);
  const value = body.value;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return json({ error: "invalidPayload" }, 400);
  }
  if (Object.keys(value).some((key) => !ALLOWED_POST_KEYS.has(key))) {
    return json({ error: "unknownField" }, 400);
  }

  const game = value.game;
  const level = Number(value.level);
  const displayName = sanitizeDisplayName(value.displayName);
  if (!GAMES.includes(game)) return json({ error: "invalidGame" }, 400);
  if (!Number.isInteger(level) || level < LEVEL_MIN || level > LEVEL_MAX) {
    return json({ error: "levelOutOfRange" }, 400);
  }
  if (!displayName) return json({ error: "invalidName" }, 400);

  const verdict = validateWin(game, value.moves);
  if (!verdict.ok) return json({ error: verdict.error, detail: verdict.detail ?? null }, 400);
  const movesJson = JSON.stringify(verdict.normalizedMoves);
  const duplicateHash = await sha256Hex(`${game}\u0000${level}\u0000${movesJson}`);
  const existing = await driver.findByHash(duplicateHash);
  if (existing) return json({ error: "duplicate", existingId: existing.entry_uid }, 409);

  const entryUid = deps.newUid ? deps.newUid() : crypto.randomUUID();
  const dateOnly = deps.todayIso ? deps.todayIso() : defaultDateOnly();
  await driver.insertEntry({
    entryUid,
    game,
    level,
    displayName,
    plyCount: verdict.plyCount,
    dateOnly,
    movesJson,
    duplicateHash,
  });
  const summary = await driver.getSummaryByUid(entryUid);
  const better = summary
    ? await driver.countBetter(game, level, verdict.plyCount, summary.insertion_order)
    : 0;
  return json({
    id: entryUid,
    game,
    level,
    displayName,
    plyCount: verdict.plyCount,
    dateOnly,
    rank: better + 1,
  }, 201);
}
