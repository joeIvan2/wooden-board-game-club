import { BOARD_SIZE, CELLS, createBoard, applyMove, moveToIndex, isBoardFull } from "./gomoku-rules.mjs";
import { AI_LEVELS } from "./gomoku-engine-levels.mjs";
import { createMatchAdapter } from "../../shared/match-adapter.mjs";
import { createLeaderboardController, isLeaderboardLevel } from "../../shared/leaderboard.mjs";

const $ = (id) => document.getElementById(id);
const els = {
  board: $("gomoku-board"),
  grid: $("gomoku-grid"),
  mode: $("mode-select"),
  level: $("level-select"),
  newGame: $("new-game"),
  undo: $("undo-move"),
  status: $("game-status"),
  live: $("sr-live"),
  turn: $("turn-badge"),
  count: $("move-count"),
  moves: $("move-list"),
  thinking: $("thinking-badge"),
};

const match = createMatchAdapter("gomoku");
const leaderboard = createLeaderboardController({ game: "gomoku", initialLevel: 6 });
const buttons = [];
let board = createBoard();
let history = [];
let currentPlayer = 1;
let winner = 0;
let gameOver = false;
let mode = "ai";
let level = 3;
let rovingIndex = 7 * BOARD_SIZE + 7;
let aiBusy = false;
let aiRequestId = 0;
let worker = null;
let touchSelection = null;
let suppressTouchClick = false;
let undoUsedThisGame = false;

const playerName = (player) => player === 1 ? "黑方" : "白方";
const coordinate = (index) => `${String.fromCharCode(65 + (index % BOARD_SIZE))}${Math.floor(index / BOARD_SIZE) + 1}`;

function buildGrid() {
  const ns = "http://www.w3.org/2000/svg";
  const lines = document.createElementNS(ns, "g");
  lines.setAttribute("class", "gomoku-grid-lines");
  for (let n = 5; n <= 145; n += 10) {
    const horizontal = document.createElementNS(ns, "line");
    horizontal.setAttribute("x1", "5"); horizontal.setAttribute("y1", String(n));
    horizontal.setAttribute("x2", "145"); horizontal.setAttribute("y2", String(n));
    const vertical = document.createElementNS(ns, "line");
    vertical.setAttribute("x1", String(n)); vertical.setAttribute("y1", "5");
    vertical.setAttribute("x2", String(n)); vertical.setAttribute("y2", "145");
    lines.append(horizontal, vertical);
  }
  const stars = document.createElementNS(ns, "g");
  stars.setAttribute("class", "gomoku-star-points");
  for (const [x, y] of [[35,35], [115,35], [75,75], [35,115], [115,115]]) {
    const star = document.createElementNS(ns, "circle");
    star.setAttribute("cx", String(x)); star.setAttribute("cy", String(y)); star.setAttribute("r", "1.35");
    stars.append(star);
  }
  els.grid.replaceChildren(lines, stars);
}

function buildBoard() {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < CELLS; index += 1) {
    const row = Math.floor(index / BOARD_SIZE);
    const col = index % BOARD_SIZE;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gomoku-point";
    button.dataset.index = String(index);
    button.setAttribute("role", "gridcell");
    button.setAttribute("aria-rowindex", String(row + 1));
    button.setAttribute("aria-colindex", String(col + 1));
    button.addEventListener("click", (event) => {
      if (suppressTouchClick && event.detail > 0) return;
      playHuman(index);
    });
    button.addEventListener("keydown", onBoardKeydown);
    buttons.push(button);
    fragment.append(button);
  }
  els.board.replaceChildren(fragment);
}

function buildLevels() {
  for (const profile of AI_LEVELS) {
    const option = document.createElement("option");
    option.value = String(profile.level);
    option.textContent = profile.label;
    els.level.append(option);
  }
  els.level.value = String(level);
}

function renderBoard() {
  const lastIndex = history.at(-1)?.index ?? -1;
  for (let index = 0; index < CELLS; index += 1) {
    const button = buttons[index];
    const value = board[index];
    button.className = `gomoku-point${value ? ` has-stone stone-${value === 1 ? "black" : "white"}` : ""}${index === lastIndex ? " is-last" : ""}`;
    button.tabIndex = index === rovingIndex ? 0 : -1;
    button.disabled = value !== 0 || gameOver || aiBusy || (mode === "ai" && currentPlayer === 2);
    button.setAttribute("aria-label", `${coordinate(index)}，${value ? `${playerName(value)}棋子` : "空位"}${index === lastIndex ? "，最後一手" : ""}`);
    if (value) {
      const stone = document.createElement("span");
      stone.className = "gomoku-stone";
      stone.setAttribute("aria-hidden", "true");
      button.replaceChildren(stone);
    } else {
      button.replaceChildren();
    }
  }
}

function renderMoves() {
  els.moves.replaceChildren();
  if (!history.length) {
    const empty = document.createElement("li");
    empty.className = "empty-record";
    empty.textContent = "尚未落子";
    els.moves.append(empty);
    return;
  }
  for (let index = 0; index < history.length; index += 2) {
    const item = document.createElement("li");
    const black = history[index];
    const white = history[index + 1];
    item.innerHTML = `<span>${index / 2 + 1}</span><b>${coordinate(black.index)}</b><b>${white ? coordinate(white.index) : "—"}</b>`;
    els.moves.append(item);
  }
  els.moves.scrollTop = els.moves.scrollHeight;
}

function renderStatus(message = "") {
  els.turn.dataset.player = currentPlayer === 1 ? "black" : "white";
  els.turn.querySelector("strong").textContent = gameOver ? "對局結束" : `${playerName(currentPlayer)}行棋`;
  els.count.textContent = `${history.length} 手`;
  els.thinking.hidden = !aiBusy;
  els.undo.disabled = aiBusy || history.length === 0;
  els.level.disabled = mode !== "ai" || aiBusy;
  const status = message || (aiBusy ? `L${level} Rapfi 正在選擇落點…` : `${playerName(currentPlayer)}行棋。`);
  els.status.textContent = status;
  els.live.textContent = status;
}

function render(message = "") {
  renderBoard();
  renderMoves();
  renderStatus(message);
}

function finishMove(index, player) {
  const won = applyMove(board, index, player);
  history.push({ index, player });
  rovingIndex = index;
  match.publish("move", { index, player, ply: history.length });
  if (won) {
    winner = player;
    gameOver = true;
    render(`${playerName(player)}連成五子，贏得本局。`);
    if (mode === "ai" && player === 1 && isLeaderboardLevel(level)) {
      const payload = {
        level,
        summary: `你以 ${history.length} 步擊敗 L${level} AI，請留下排行榜暱稱。`,
      };
      if (undoUsedThisGame) {
        leaderboard.showBlocked({ ...payload, reason: "本局曾使用悔棋，為維持排行榜公平性不開放登記。" });
      } else {
        leaderboard.showWin({ ...payload, moves: history.map((move) => move.index) });
      }
    }
    return;
  }
  if (isBoardFull(board)) {
    gameOver = true;
    render("棋盤已滿，本局和棋。");
    return;
  }
  currentPlayer = player === 1 ? 2 : 1;
  render();
  if (mode === "ai" && currentPlayer === 2) requestAiMove();
}

function playHuman(index) {
  if (gameOver || aiBusy || board[index] !== 0 || (mode === "ai" && currentPlayer === 2)) return;
  finishMove(index, currentPlayer);
}

function indexFromPointer(event) {
  const rect = els.board.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return -1;
  const col = Math.min(BOARD_SIZE - 1, Math.floor(x / rect.width * BOARD_SIZE));
  const row = Math.min(BOARD_SIZE - 1, Math.floor(y / rect.height * BOARD_SIZE));
  return row * BOARD_SIZE + col;
}

function clearTouchPreview() {
  els.board.querySelector(".is-touch-preview")?.classList.remove("is-touch-preview");
}

function updateTouchPreview(event) {
  clearTouchPreview();
  if (!touchSelection || touchSelection.pointerId !== event.pointerId) return;
  const index = indexFromPointer(event);
  touchSelection.index = index >= 0 && board[index] === 0 ? index : -1;
  if (touchSelection.index >= 0) buttons[touchSelection.index].classList.add("is-touch-preview");
}

function onBoardPointerDown(event) {
  if (event.pointerType !== "touch" || !event.isPrimary) return;
  if (gameOver || aiBusy || (mode === "ai" && currentPlayer === 2)) return;
  touchSelection = { pointerId: event.pointerId, index: -1 };
  els.board.setPointerCapture?.(event.pointerId);
  updateTouchPreview(event);
}

function onBoardPointerMove(event) {
  if (!touchSelection || touchSelection.pointerId !== event.pointerId) return;
  updateTouchPreview(event);
}

function onBoardPointerUp(event) {
  if (!touchSelection || touchSelection.pointerId !== event.pointerId) return;
  updateTouchPreview(event);
  const index = touchSelection.index;
  touchSelection = null;
  clearTouchPreview();
  suppressTouchClick = true;
  window.setTimeout(() => { suppressTouchClick = false; }, 0);
  if (index >= 0) playHuman(index);
}

function onBoardPointerCancel(event) {
  if (!touchSelection || touchSelection.pointerId !== event.pointerId) return;
  touchSelection = null;
  clearTouchPreview();
}

function ensureWorker() {
  if (!worker) worker = new Worker(new URL("./rapfi-engine-worker.js", import.meta.url));
  return worker;
}

function requestAiMove() {
  aiBusy = true;
  const id = ++aiRequestId;
  render();
  const currentWorker = ensureWorker();
  currentWorker.onmessage = ({ data }) => {
    if (data?.id !== id) return;
    aiBusy = false;
    if (!data.ok || !data.move) {
      render(`AI 無法完成運算：${data?.error || "沒有合法落點"}`);
      return;
    }
    const index = moveToIndex(data.move);
    if (!gameOver && currentPlayer === 2 && board[index] === 0) finishMove(index, 2);
  };
  currentWorker.onerror = (event) => {
    if (id !== aiRequestId) return;
    aiBusy = false;
    const detail = event?.message ? `：${event.message}` : "";
    render(`Rapfi 引擎發生錯誤${detail}，請重新開始本局。`);
  };
  currentWorker.postMessage({ id, board: [...board], level });
}

function cancelAi() {
  aiRequestId += 1;
  aiBusy = false;
  if (worker) worker.terminate();
  worker = null;
}

function resetGame() {
  cancelAi();
  board = createBoard();
  history = [];
  currentPlayer = 1;
  winner = 0;
  gameOver = false;
  undoUsedThisGame = false;
  rovingIndex = 7 * BOARD_SIZE + 7;
  leaderboard.reset();
  match.publish("reset", { mode, level });
  render("新局開始，黑方先行。");
}

function undoMove() {
  if (aiBusy || history.length === 0) return;
  undoUsedThisGame = true;
  leaderboard.reset();
  const plies = mode === "ai" ? Math.min(2, history.length) : 1;
  for (let count = 0; count < plies; count += 1) {
    const move = history.pop();
    if (move) board[move.index] = 0;
  }
  winner = 0;
  gameOver = false;
  currentPlayer = history.length % 2 === 0 ? 1 : 2;
  rovingIndex = history.at(-1)?.index ?? 7 * BOARD_SIZE + 7;
  match.publish("undo", { plies });
  render(`已收回 ${plies} 手，${playerName(currentPlayer)}行棋。`);
}

function onBoardKeydown(event) {
  const index = Number(event.currentTarget.dataset.index);
  let row = Math.floor(index / BOARD_SIZE);
  let col = index % BOARD_SIZE;
  if (event.key === "ArrowUp") row = Math.max(0, row - 1);
  else if (event.key === "ArrowDown") row = Math.min(BOARD_SIZE - 1, row + 1);
  else if (event.key === "ArrowLeft") col = Math.max(0, col - 1);
  else if (event.key === "ArrowRight") col = Math.min(BOARD_SIZE - 1, col + 1);
  else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    playHuman(index);
    return;
  } else return;
  event.preventDefault();
  rovingIndex = row * BOARD_SIZE + col;
  renderBoard();
  buttons[rovingIndex].focus();
}

els.mode.addEventListener("change", () => {
  mode = els.mode.value;
  resetGame();
});
els.level.addEventListener("change", () => {
  level = Number(els.level.value);
  resetGame();
});
els.newGame.addEventListener("click", resetGame);
els.undo.addEventListener("click", undoMove);
els.board.addEventListener("pointerdown", onBoardPointerDown);
els.board.addEventListener("pointermove", onBoardPointerMove);
els.board.addEventListener("pointerup", onBoardPointerUp);
els.board.addEventListener("pointercancel", onBoardPointerCancel);

buildGrid();
buildBoard();
buildLevels();
resetGame();
