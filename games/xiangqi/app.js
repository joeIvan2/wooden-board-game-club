/**
 * app.js — 楚河漢界 · 象棋衝鋒社 瀏覽器控制器。
 *
 * 規則引擎與 AI 完全不含 DOM，瀏覽器與 CLI 共用同一套模組。
 * 本檔只負責：渲染、輸入（點擊／鍵盤）、模式控制、悔棋、提示、
 * 翻面、本機保存／讀檔、下載私人棋譜與無障礙播報。
 */

import {
  createInitialState,
  getLegalMovesFrom,
  getLegalMoves,
  applyMove,
  getGameStatus,
  sameSquare,
  pieceGlyph,
} from "./xiangqi-rules.mjs";
import { formatChineseMove, formatCoordinateMove, parseMoveText } from "./xiangqi-notation.mjs";
import { createLeaderboardController, isLeaderboardLevel } from "../../shared/leaderboard.mjs";

const LEVEL_NAMES = [
  "初學", "入門", "業餘", "進階", "好手",
  "高手", "大師", "棋王", "超凡", "巔峰",
];
const HINT_LEVEL = 6;
const AI_THINK_MS = 2500;
const RECORD_KEY = "oxalpha-xiangqi-club.records.v1";
const AUTOSAVE_KEY = "oxalpha-xiangqi-club.autosave.v1";
const MAX_SAVED_RECORDS = 12;

const $ = (id) => document.getElementById(id);
const els = {
  board: $("board"),
  modeSelect: $("mode-select"),
  levelSelect: $("level-select"),
  newGame: $("new-game"),
  undoMove: $("undo-move"),
  hintMove: $("hint-move"),
  flipBoard: $("flip-board"),
  gameStatus: $("game-status"),
  turnIndicator: $("turn-indicator"),
  moveList: $("move-list"),
  capturedRed: $("captured-red"),
  capturedBlack: $("captured-black"),
  resultPanel: $("result-panel"),
  resultTitle: $("result-title"),
  resultCopy: $("result-copy"),
  closeResult: $("close-result"),
  playAgain: $("play-again"),
  recordList: $("record-list"),
  downloadRecord: $("download-record"),
  saveGame: $("save-game"),
  loadGame: $("load-game"),
  moveCount: $("move-count"),
  boardLabel: $("board-label"),
  srLive: $("sr-live"),
};

let state = createInitialState();
let selected = null;
let selectedMoves = [];
let lastMove = null;
let hintMove = null;
let history = [];
let aiBusy = false;
let flipped = false;
let mode = "ai";
let level = 4;
let roving = { row: 9, col: 4 };
let gameFinished = false;
let aiGeneration = 0;
let savedRecords = loadRecords();
const buttons = Array.from({ length: 10 }, () => Array(9).fill(null));
const leaderboard = createLeaderboardController({ game: "xiangqi", initialLevel: 6 });
let hintUsedThisGame = false;
let undoUsedThisGame = false;
let restoredGameThisSession = false;

function requiredElementsPresent() {
  const missing = Object.entries(els).filter(([, el]) => !el).map(([key]) => key);
  if (missing.length) throw new Error(`頁面缺少必要控制項：${missing.join("、")}`);
}

const colorName = (color) => (color === "red" ? "紅方" : "黑方");

function pieceLabel(piece) {
  if (!piece) return "空格";
  return `${colorName(piece.color)}${pieceGlyph(piece)}`;
}

function squareKey(square) {
  return `${square.row},${square.col}`;
}

function isSameMove(a, b) {
  return !!a && !!b && sameSquare(a.from, b.from) && sameSquare(a.to, b.to);
}

function safeStatus() {
  const status = getGameStatus(state);
  return status && typeof status === "object"
    ? status
    : { status: "ongoing", inCheck: false, winner: null };
}

function terminal(status) {
  return status.status === "checkmate" || status.status === "stalemate";
}

/* ----------------------------- 棋盤建構與渲染 ----------------------------- */

function buildBoard() {
  els.board.replaceChildren();
  els.board.setAttribute("role", "grid");
  els.board.setAttribute("aria-rowcount", "10");
  els.board.setAttribute("aria-colcount", "9");
  els.board.setAttribute("aria-label", "中國象棋棋盤，紅方先行，使用方向鍵移動、Enter 選子落子");

  const fragment = document.createDocumentFragment();
  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "board-square";
      button.dataset.row = String(row);
      button.dataset.col = String(col);
      button.setAttribute("role", "gridcell");
      button.setAttribute("aria-rowindex", String(row + 1));
      button.setAttribute("aria-colindex", String(col + 1));
      button.tabIndex = -1;
      button.addEventListener("click", () => activateSquare(row, col));
      button.addEventListener("keydown", onSquareKeydown);
      buttons[row][col] = button;
      fragment.append(button);
    }
  }
  els.board.append(fragment);
  renderBoard();
}

/** 翻面後的顯示順序（flex order）。 */
function displayOrder(row, col) {
  const r = flipped ? 9 - row : row;
  const c = flipped ? 8 - col : col;
  return r * 9 + c;
}

function boardCoordinate(row, col) {
  const file = "九八七六五四三二一"[col];
  const rank = flipped ? row + 1 : 10 - row;
  return `第${file}路第${rank}列`;
}

function cellAriaLabel(button, row, col, piece, isSelected, isTarget, isCapture) {
  let label = `${boardCoordinate(row, col)}，${pieceLabel(piece)}`;
  if (isSelected) label += "，已選取";
  else if (isTarget) label += isCapture ? "，可吃子落點" : "，可落子";
  button.setAttribute("aria-label", label);
}

/** 就地更新 90 個格子（不重建節點，保留焦點與動畫）。 */
function renderBoard() {
  if (!els.board) return;
  const legalDestinations = new Set(selectedMoves.map((move) => squareKey(move.to)));
  const interactive = canHumanMove();

  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const button = buttons[row][col];
      const piece = state.board[row][col];
      const key = `${row},${col}`;
      const isSelected = !!selected && selected.row === row && selected.col === col;
      const isTarget = legalDestinations.has(key);
      const classes = ["board-square"];
      if (isSelected) classes.push("is-selected");
      if (isTarget) classes.push(piece ? "is-capture-target" : "is-legal-target");
      if (lastMove && (sameSquare(lastMove.from, { row, col }) || sameSquare(lastMove.to, { row, col }))) {
        classes.push("is-last-move");
      }
      if (hintMove && (sameSquare(hintMove.from, { row, col }) || sameSquare(hintMove.to, { row, col }))) {
        classes.push("is-hint");
      }

      button.className = classes.join(" ");
      button.style.order = String(displayOrder(row, col));
      button.tabIndex = row === roving.row && col === roving.col && interactive ? 0 : -1;
      button.setAttribute("aria-disabled", interactive ? "false" : "true");
      button.setAttribute("aria-selected", isSelected ? "true" : "false");
      cellAriaLabel(button, row, col, piece, isSelected, isTarget, !!piece);

      const glyphText = piece ? pieceGlyph(piece) : "";
      const existing = button.firstChild;
      if (!glyphText) {
        if (existing) existing.remove();
      } else if (existing && existing.dataset.glyph === glyphText) {
        existing.className = `piece piece-${piece.color}`;
      } else {
        if (existing) existing.remove();
        const glyph = document.createElement("span");
        glyph.dataset.glyph = glyphText;
        glyph.className = `piece piece-${piece.color}`;
        glyph.textContent = glyphText;
        glyph.setAttribute("aria-hidden", "true");
        button.appendChild(glyph);
      }
    }
  }
}

/* ------------------------------- 輸入處理 ------------------------------- */

function canHumanMove() {
  return !gameFinished && !aiBusy && (mode === "local" || state.turn === "red");
}

function clearSelection() {
  selected = null;
  selectedMoves = [];
}

function activateSquare(row, col) {
  roving = { row, col };
  if (!canHumanMove()) {
    renderBoard();
    return;
  }
  const piece = state.board[row][col];
  const target = { row, col };
  const found = selectedMoves.find((move) => sameSquare(move.to, target));

  if (found) {
    commitMove(found);
    return;
  }
  if (piece && piece.color === state.turn) {
    selected = target;
    selectedMoves = getLegalMovesFrom(state, row, col);
    announce(`${pieceLabel(piece)}已選取，${selectedMoves.length} 個合法落點。`);
  } else {
    clearSelection();
  }
  renderBoard();
  buttons[row][col].focus({ preventScroll: true });
}

function onSquareKeydown(event) {
  const key = event.key;
  if (key === "Enter" || key === " ") {
    event.preventDefault();
    activateSquare(Number(event.currentTarget.dataset.row), Number(event.currentTarget.dataset.col));
    return;
  }
  if (key === "Escape") {
    event.preventDefault();
    clearSelection();
    announce("已取消選子。");
    renderBoard();
    event.currentTarget.focus({ preventScroll: true });
    return;
  }
  if (!key.startsWith("Arrow")) return;
  event.preventDefault();
  const originRow = Number(event.currentTarget.dataset.row);
  const originCol = Number(event.currentTarget.dataset.col);
  const direction = flipped ? -1 : 1;
  let row = originRow;
  let col = originCol;
  if (key === "ArrowUp") row -= direction;
  if (key === "ArrowDown") row += direction;
  if (key === "ArrowLeft") col -= direction;
  if (key === "ArrowRight") col += direction;
  row = Math.max(0, Math.min(9, row));
  col = Math.max(0, Math.min(8, col));
  roving = { row, col };
  renderBoard();
  buttons[row][col].focus({ preventScroll: true });
}

/* --------------------------------- AI ---------------------------------- */

const AiClient = (() => {
  let worker = null;
  let localModule = null;
  let sequence = 0;
  const pending = new Map();

  function disposeWorker() {
    if (worker) {
      worker.terminate();
      worker = null;
    }
  }

  function cancel() {
    sequence += 1;
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      const error = new Error("AI 計算已取消");
      error.cancelled = true;
      reject(error);
    }
    pending.clear();
    disposeWorker();
  }

  function failAll(error) {
    for (const job of pending.values()) {
      clearTimeout(job.timer);
      job.reject(error);
    }
    pending.clear();
    disposeWorker();
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(new URL("./xiangqi-ai-worker.mjs", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event) => {
      const message = event.data || {};
      const job = pending.get(message.id);
      if (!job) return;
      pending.delete(message.id);
      clearTimeout(job.timer);
      if (message.ok) job.resolve(message.move);
      else job.reject(new Error(message.error || "AI 無法計算著法"));
    });
    worker.addEventListener("error", () => failAll(new Error("AI worker 發生錯誤")));
    return worker;
  }

  async function fallback(solveState, solveLevel) {
    if (!localModule) localModule = import("./xiangqi-ai.mjs");
    const module = await localModule;
    return module.chooseMove(solveState, solveLevel, { maxTimeMs: AI_THINK_MS });
  }

  function solve(solveState, solveLevel) {
    const requestId = ++sequence;
    try {
      const activeWorker = ensureWorker();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          disposeWorker();
          reject(new Error("AI 思考逾時"));
        }, AI_THINK_MS + 15000);
        pending.set(requestId, { resolve, reject, timer });
        activeWorker.postMessage({
          id: requestId,
          state: solveState,
          level: solveLevel,
          options: { maxTimeMs: AI_THINK_MS },
        });
      });
    } catch {
      return fallback(solveState, solveLevel);
    }
  }

  return { solve, cancel };
})();

async function requestAiMove() {
  if (gameFinished || mode !== "ai" || state.turn !== "black") return;
  const generation = ++aiGeneration;
  aiBusy = true;
  updateControls();
  announce(`L${level} AI 正在研判局勢…`);
  try {
    const move = await AiClient.solve(state, level);
    if (generation !== aiGeneration || gameFinished || mode !== "ai" || state.turn !== "black") return;
    if (move) commitMove(move);
  } catch (error) {
    if (!error?.cancelled) announce("AI 暫時無法回應，請按「新局」重開或改用雙人模式。", true);
  } finally {
    if (generation === aiGeneration) {
      aiBusy = false;
      updateControls();
    }
  }
}

function maybeTriggerAi() {
  if (!gameFinished && mode === "ai" && state.turn === "black" && !aiBusy) {
    requestAiMove();
  }
}

async function showHint() {
  if (!canHumanMove()) return;
  const generation = ++aiGeneration;
  aiBusy = true;
  updateControls();
  announce("提示正在分析…");
  try {
    const move = await AiClient.solve(state, HINT_LEVEL);
    if (generation !== aiGeneration || !move) return;
    hintMove = move;
    hintUsedThisGame = true;
    announce(`建議：${formatChineseMove(state, move)}（${formatCoordinateMove(move)}），虛線標示起訖。`);
  } catch (error) {
    if (!error?.cancelled) announce("提示分析未完成，請稍後重試。", true);
  } finally {
    if (generation === aiGeneration) {
      aiBusy = false;
      renderBoard();
      updateControls();
    }
  }
}

/* ------------------------------ 對局流程 ------------------------------ */

function commitMove(move) {
  if (!move || gameFinished) return;
  const before = state;
  const chinese = formatChineseMove(before, move);
  const coordinate = formatCoordinateMove(move);
  history.push({ before, move, chinese, coordinate });
  state = applyMove(before, move);
  lastMove = move;
  hintMove = null;
  clearSelection();
  autosaveGame();

  const status = safeStatus();
  if (terminal(status)) {
    finishGame(status);
    return;
  }
  const checkNote = status.inCheck ? "，將軍！" : "";
  announce(`落子：${chinese}${checkNote}`);
  renderBoard();
  renderSidebar(status);
  renderMoveList();
  renderCaptured();
  updateControls();
  maybeTriggerAi();
}

function finishGame(status) {
  gameFinished = true;
  aiBusy = false;
  const winner = status.winner || null;
  let title;
  let copy;
  if (status.status === "checkmate") {
    title = `${colorName(winner)}勝 · 將死`;
    copy = `${colorName(winner)}將死對方，本局結束。棋譜已保存在此瀏覽器，可隨時下載私人記錄。`;
  } else {
    // 中國象棋規則：困斃（無子可動且未被將軍）的一方判負。
    title = `${colorName(winner)}勝 · 困斃`;
    copy = `${colorName(winner) === "紅方" ? "黑方" : "紅方"}困斃（無子可動），依規則判負。棋譜已保存在此瀏覽器。`;
  }
  archiveFinishedRecord(title, status.status, winner);
  if (els.resultTitle) els.resultTitle.textContent = title;
  if (els.resultCopy) els.resultCopy.textContent = copy;
  if (els.resultPanel) {
    els.resultPanel.hidden = false;
    els.closeResult?.focus({ preventScroll: true });
  }
  if (mode === "ai" && winner === "red" && isLeaderboardLevel(level)) {
    const summary = `你以 ${history.length} 步擊敗 L${level} AI，請留下排行榜暱稱。`;
    const reasons = [
      hintUsedThisGame ? "提示" : null,
      undoUsedThisGame ? "悔棋" : null,
      restoredGameThisSession ? "讀取存檔" : null,
    ].filter(Boolean);
    if (reasons.length) {
      leaderboard.showBlocked({
        level,
        summary,
        reason: `本局曾使用${reasons.join("、")}，為維持排行榜公平性不開放登記。`,
      });
    } else {
      leaderboard.showWin({
        level,
        summary,
        moves: history.map((entry) => entry.coordinate),
      });
    }
  }
  announce(copy, true);
  renderSidebar(safeStatus());
  renderMoveList();
  renderCaptured();
  updateControls();
}

function undo() {
  if (!history.length || aiBusy) return;
  undoUsedThisGame = true;
  leaderboard.reset();
  AiClient.cancel();
  aiGeneration += 1;
  const plies = mode === "ai" && history.length >= 2 ? 2 : 1;
  for (let i = 0; i < plies; i += 1) {
    const entry = history.pop();
    state = entry.before;
  }
  lastMove = history.at(-1)?.move ?? null;
  hintMove = null;
  clearSelection();
  gameFinished = false;
  if (els.resultPanel) els.resultPanel.hidden = true;
  autosaveGame();
  announce("已悔棋。");
  renderBoard();
  renderSidebar(safeStatus());
  renderMoveList();
  renderCaptured();
  updateControls();
  buttons[roving.row][roving.col]?.focus({ preventScroll: true });
}

function resetGameState() {
  AiClient.cancel();
  aiGeneration += 1;
  state = createInitialState();
  history = [];
  clearSelection();
  lastMove = null;
  hintMove = null;
  aiBusy = false;
  gameFinished = false;
  hintUsedThisGame = false;
  undoUsedThisGame = false;
  restoredGameThisSession = false;
  roving = { row: 9, col: 4 };
  if (els.resultPanel) els.resultPanel.hidden = true;
  leaderboard.reset();
}

function newGame() {
  if (history.length && !window.confirm("目前棋局尚未結束，要放棄並開新局嗎？")) return;
  resetGameState();
  autosaveGame();
  announce("新局開始，紅方先行。");
  renderBoard();
  renderSidebar(safeStatus());
  renderMoveList();
  renderCaptured();
  updateControls();
  maybeTriggerAi();
  buttons[roving.row][roving.col]?.focus({ preventScroll: true });
}

function changeMode() {
  const next = els.modeSelect?.value || "ai";
  if (next === mode) return;
  if (history.length && !window.confirm("切換模式會開新局，是否繼續？")) {
    els.modeSelect.value = mode;
    return;
  }
  mode = next;
  resetGameState();
  autosaveGame();
  announce(mode === "ai" ? "人機對弈新局開始，你執紅先行。" : "雙人對戰新局開始，紅方先行。");
  renderBoard();
  renderSidebar(safeStatus());
  renderMoveList();
  renderCaptured();
  updateControls();
  maybeTriggerAi();
}

function changeLevel() {
  const next = Number(els.levelSelect?.value || level);
  if (!Number.isInteger(next) || next < 1 || next > 10) return;
  if (next === level) return;
  if (history.length && !window.confirm("切換 AI 等級會開新局，是否繼續？")) {
    els.levelSelect.value = String(level);
    return;
  }
  level = next;
  if (history.length) resetGameState();
  autosaveGame();
  announce(`AI 等級調整為 L${level} ${LEVEL_NAMES[level - 1]}，新局開始。`);
  renderBoard();
  renderSidebar(safeStatus());
  renderMoveList();
  renderCaptured();
  updateControls();
  maybeTriggerAi();
}

/* ------------------------------- 側欄渲染 ------------------------------- */

function renderSidebar(status = safeStatus(), message = "") {
  const turnText = `${colorName(state.turn)}行棋`;
  let statusText = message || turnText;
  if (!gameFinished && status.inCheck && !message.startsWith("落子")) {
    statusText = `${colorName(state.turn)}被將軍，必須應將！`;
  }
  if (gameFinished) {
    statusText = status.status === "checkmate"
      ? `${colorName(status.winner)}勝 · 將死`
      : `${colorName(status.winner)}勝 · 困斃`;
  }
  if (els.turnIndicator) {
    els.turnIndicator.textContent = gameFinished ? "對局結束" : turnText;
    els.turnIndicator.dataset.side = state.turn;
  }
  if (els.gameStatus) els.gameStatus.textContent = statusText;
  if (els.srLive && statusText !== els.gameStatus?.textContent) {
    els.srLive.textContent = statusText;
  }
  if (els.moveCount) els.moveCount.textContent = `${history.length} 半回合`;
  if (els.boardLabel) els.boardLabel.textContent = flipped ? "黑方視角" : "紅方視角";
}

function announce(text, assertive = false) {
  if (els.gameStatus) els.gameStatus.textContent = text;
  if (els.srLive) {
    els.srLive.setAttribute("aria-live", assertive ? "assertive" : "polite");
    els.srLive.textContent = text;
  }
}

function renderMoveList() {
  if (!els.moveList) return;
  els.moveList.replaceChildren();
  if (!history.length) {
    const empty = document.createElement("p");
    empty.className = "empty-copy";
    empty.textContent = "尚未落子。紅方先行。";
    els.moveList.appendChild(empty);
    return;
  }
  for (let i = 0; i < history.length; i += 2) {
    const row = document.createElement("div");
    row.className = "move-row";
    row.setAttribute("role", "listitem");
    const number = document.createElement("span");
    number.className = "move-number";
    number.textContent = `${Math.floor(i / 2) + 1}.`;
    const red = document.createElement("span");
    red.className = "move-red";
    red.textContent = history[i]?.chinese || "";
    const black = document.createElement("span");
    black.className = "move-black";
    black.textContent = history[i + 1]?.chinese || "";
    const labelBits = [`${Math.floor(i / 2) + 1}手`];
    if (history[i]) labelBits.push(`紅 ${history[i].chinese}（${history[i].coordinate}）`);
    if (history[i + 1]) labelBits.push(`黑 ${history[i + 1].chinese}（${history[i + 1].coordinate}）`);
    row.setAttribute("aria-label", labelBits.join("，"));
    row.append(number, red, black);
    els.moveList.appendChild(row);
  }
  els.moveList.scrollTop = els.moveList.scrollHeight;
}

function renderCaptured() {
  const draw = (target, pieces, emptyText) => {
    if (!target) return;
    target.replaceChildren();
    if (!pieces.length) {
      const empty = document.createElement("span");
      empty.className = "capture-empty";
      empty.textContent = emptyText;
      target.appendChild(empty);
      return;
    }
    for (const piece of pieces) {
      const span = document.createElement("span");
      span.className = `capture-piece piece-${piece.color}`;
      span.textContent = pieceGlyph(piece);
      span.title = pieceLabel(piece);
      target.appendChild(span);
    }
  };
  draw(els.capturedRed, state.captured?.red || [], "紅方尚未失子");
  draw(els.capturedBlack, state.captured?.black || [], "黑方尚未失子");
}

function updateControls() {
  const hasMoves = history.length > 0;
  if (els.undoMove) els.undoMove.disabled = !hasMoves || aiBusy;
  if (els.hintMove) els.hintMove.disabled = !canHumanMove();
  if (els.downloadRecord) els.downloadRecord.disabled = !hasMoves;
  if (els.saveGame) els.saveGame.disabled = !hasMoves || aiBusy;
  if (els.loadGame) els.loadGame.disabled = aiBusy;
  if (els.levelSelect) els.levelSelect.disabled = aiBusy;
}

/* --------------------------- 保存／讀檔／下載 --------------------------- */

function serializeGame() {
  const startState = history[0]?.before ?? state;
  return {
    version: 1,
    game: "oxalpha-xiangqi-club",
    savedAt: new Date().toISOString(),
    mode,
    level,
    startBoard: startState.board.map((line) => line.map((p) => (p ? { color: p.color, type: p.type } : null))),
    moves: history.map((entry) => entry.coordinate),
  };
}

function rebuildFromPayload(payload) {
  if (!payload || payload.version !== 1 || !Array.isArray(payload.startBoard) || !Array.isArray(payload.moves)) {
    throw new Error("存檔格式不正確");
  }
  let restored = {
    board: payload.startBoard.map((line) => line.slice()),
    turn: "red",
    captured: { red: [], black: [] },
    plies: 0,
  };
  history = [];
  for (const coordinate of payload.moves) {
    const move = parseMoveText(restored, coordinate);
    if (!move) throw new Error(`存檔中的著法無法重現：${coordinate}`);
    const chinese = formatChineseMove(restored, move);
    history.push({
      before: restored,
      move,
      chinese,
      coordinate: formatCoordinateMove(move),
    });
    restored = applyMove(restored, move);
  }
  return restored;
}

function applyRestoredGame(restored, payload) {
  AiClient.cancel();
  aiGeneration += 1;
  state = restored;
  mode = payload.mode === "local" ? "local" : "ai";
  level = Math.min(10, Math.max(1, Number(payload.level) || level));
  if (els.modeSelect) els.modeSelect.value = mode;
  if (els.levelSelect) els.levelSelect.value = String(level);
  clearSelection();
  lastMove = history.at(-1)?.move ?? null;
  hintMove = null;
  aiBusy = false;
  gameFinished = false;
  hintUsedThisGame = false;
  undoUsedThisGame = false;
  restoredGameThisSession = true;
  roving = { row: 9, col: 4 };
  if (els.resultPanel) els.resultPanel.hidden = true;
  leaderboard.reset();
  renderBoard();
  renderSidebar(safeStatus());
  renderMoveList();
  renderCaptured();
  updateControls();
}

function autosaveGame() {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serializeGame()));
  } catch {
    /* 本機儲存為附加便利，遊戲進行不依賴它。 */
  }
}

function saveGame() {
  if (!history.length) {
    announce("尚無著法可保存。");
    return;
  }
  autosaveGame();
  announce(`已存檔於本機瀏覽器（${history.length} 半回合）。`);
}

function loadGame() {
  let payload = null;
  try {
    payload = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || "null");
  } catch {
    payload = null;
  }
  if (!payload) {
    announce("找不到本機存檔。");
    return;
  }
  try {
    const restored = rebuildFromPayload(payload);
    applyRestoredGame(restored, payload);
    announce(`已讀取本機存檔（${history.length} 半回合）。`);
    maybeTriggerAi();
  } catch (error) {
    announce(`讀檔失敗：${error.message}`, true);
  }
}

function tryRestoreAutosave() {
  let payload = null;
  try {
    payload = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || "null");
  } catch {
    payload = null;
  }
  if (!payload || !Array.isArray(payload.moves) || payload.moves.length === 0) return false;
  try {
    const restored = rebuildFromPayload(payload);
    applyRestoredGame(restored, payload);
    return true;
  } catch {
    return false;
  }
}

function currentRecordPayload(extra = {}) {
  return {
    version: 1,
    game: "oxalpha-xiangqi-club",
    createdAt: new Date().toISOString(),
    mode,
    aiLevel: mode === "ai" ? level : null,
    plies: history.length,
    result: gameFinished ? safeStatus().status : "ongoing",
    winner: gameFinished ? safeStatus().winner : null,
    moves: history.map((entry, index) => ({
      ply: index + 1,
      coordinate: entry.coordinate,
      chinese: entry.chinese,
    })),
    ...extra,
  };
}

function loadRecords() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECORD_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, MAX_SAVED_RECORDS) : [];
  } catch {
    return [];
  }
}

function persistRecords() {
  try {
    localStorage.setItem(RECORD_KEY, JSON.stringify(savedRecords));
  } catch {
    /* 忽略：隱私棋譜庫為附加便利。 */
  }
}

function archiveFinishedRecord(title, outcome, winner) {
  if (!history.length) return;
  const record = currentRecordPayload({ title, outcome, winner });
  savedRecords = [record, ...savedRecords].slice(0, MAX_SAVED_RECORDS);
  persistRecords();
  renderRecords();
}

function renderRecords() {
  if (!els.recordList) return;
  els.recordList.replaceChildren();
  if (!savedRecords.length) {
    const empty = document.createElement("p");
    empty.className = "empty-copy";
    empty.textContent = "完成一局後，私人棋譜會只存於此瀏覽器。";
    els.recordList.appendChild(empty);
    return;
  }
  savedRecords.slice(0, 5).forEach((record) => {
    const item = document.createElement("div");
    item.className = "record-item";
    const heading = document.createElement("strong");
    heading.textContent = record.title || "未結束對局";
    const meta = document.createElement("span");
    const date = record.createdAt ? new Date(record.createdAt).toLocaleDateString("zh-TW") : "本機紀錄";
    meta.textContent = `${date} · ${record.plies || 0} 半回合`;
    item.append(heading, meta);
    els.recordList.appendChild(item);
  });
}

function downloadCurrentRecord() {
  if (!history.length) return;
  const payload = currentRecordPayload({ title: gameFinished ? "已結束對局" : "進行中對局" });
  const lines = [
    "楚河漢界 · 象棋衝鋒社 私人棋譜",
    `日期：${payload.createdAt}`,
    `模式：${mode === "ai" ? `人機（AI L${level}）` : "雙人對戰"}`,
    `結果：${gameFinished ? (safeStatus().winner ? `${colorName(safeStatus().winner)}勝（${safeStatus().status === "checkmate" ? "將死" : "困斃"}）` : "和局") : "進行中"}`,
    "".padEnd(30, "-"),
  ];
  for (let i = 0; i < history.length; i += 2) {
    const num = String(Math.floor(i / 2) + 1).padStart(3, " ");
    lines.push(`${num}.  ${(history[i].chinese + "   ").slice(0, 8)}  ${history[i].coordinate.padEnd(8)} ${(history[i + 1]?.chinese ?? "").padEnd(6)} ${history[i + 1]?.coordinate ?? ""}`);
  }
  lines.push("".padEnd(30, "-"), "本檔案僅由你的瀏覽器在本機產生，未經網路傳送。");
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  link.download = `xiangqi-private-record-${stamp}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
  announce("已下載私人棋譜（純文字），沒有傳送到網路。");
}

/* -------------------------------- 啟動 -------------------------------- */

function buildLevelSelect() {
  if (!els.levelSelect || els.levelSelect.options.length) return;
  LEVEL_NAMES.forEach((name, index) => {
    const option = document.createElement("option");
    option.value = String(index + 1);
    option.textContent = `L${index + 1} · ${name}`;
    els.levelSelect.appendChild(option);
  });
  els.levelSelect.value = String(level);
}

function wireEvents() {
  els.newGame?.addEventListener("click", newGame);
  els.undoMove?.addEventListener("click", undo);
  els.hintMove?.addEventListener("click", showHint);
  els.flipBoard?.addEventListener("click", () => {
    flipped = !flipped;
    renderBoard();
    renderSidebar();
    buttons[roving.row][roving.col]?.focus({ preventScroll: true });
  });
  els.modeSelect?.addEventListener("change", changeMode);
  els.levelSelect?.addEventListener("change", changeLevel);
  els.closeResult?.addEventListener("click", () => {
    els.resultPanel.hidden = true;
    buttons[roving.row][roving.col]?.focus({ preventScroll: true });
  });
  els.playAgain?.addEventListener("click", () => {
    resetGameState();
    announce("新局開始，紅方先行。");
    renderBoard();
    renderSidebar(safeStatus());
    renderMoveList();
    renderCaptured();
    updateControls();
    maybeTriggerAi();
  });
  els.downloadRecord?.addEventListener("click", downloadCurrentRecord);
  els.saveGame?.addEventListener("click", saveGame);
  els.loadGame?.addEventListener("click", loadGame);
}

function initialise() {
  requiredElementsPresent();
  buildLevelSelect();
  wireEvents();
  buildBoard();
  renderRecords();
  if (tryRestoreAutosave()) {
    announce("已恢復上次本機進度；按「新局」可重新開始。");
  } else {
    announce("新局開始，紅方先行。");
    renderSidebar(safeStatus());
    renderCaptured();
    updateControls();
  }
  maybeTriggerAi();
}

initialise();
