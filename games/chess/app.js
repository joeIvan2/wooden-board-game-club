import {
  createInitialState,
  generateLegalMoves,
  applyMove,
  getGameStatus,
  createRepetitionTracker,
  claimableDraws,
} from "./chess.mjs";
import { formatSan, squareName } from "./chess-notation.mjs";
import {
  buildPgn,
  moveToUci,
  DEFAULT_PRIVATE_WHITE,
} from "./community-game.mjs";
import { createLeaderboardController, isLeaderboardLevel } from "../../shared/leaderboard.mjs";

const GLYPHS = { k: "\u265A", q: "\u265B", r: "\u265C", b: "\u265D", n: "\u265E", p: "\u265F" };
const PIECE_ZH = { k: "王", q: "后", r: "車", b: "象", n: "馬", p: "兵" };
const PROMO_ZH = { q: "后", r: "車", b: "象", n: "馬" };
const COLOR_ZH = { w: "白", b: "黑" };
const POINTS = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const LEVEL_NAMES = [
  "入門", "初學", "見習", "業餘", "進階",
  "認真", "強手", "大師", "教頭", "冠軍",
];

const $ = (id) => document.getElementById(id);

const els = {};

let state = null;
let posLegal = [];
let curStatus = null;
let history = [];
let lastMove = null;
let selected = null;
let selDests = [];
let gameOverInfo = null;
let aiBusy = false;
let aiRequestSeq = 0;
let gameGeneration = 0;
let pendingPromotion = null;
let rovingPos = [6, 4];
let mode = "ai";
let level = 6;
const repetitionTracker = createRepetitionTracker();
let claimable = { threefold: false, fiftyMove: false };
const HINT_LEVEL = 7;
let hintBusy = false;
let hintRequestSeq = 0;
let hintInfo = null;
let hintUsedThisGame = false;
let undoUsedThisGame = false;
let recordPromptedThisGame = false;
let leaderboard = null;
const sqButtons = [];

function engineThinkTimeMs(solveLevel) {
  const budgets = [250, 350, 500, 700, 950, 1300, 1800, 2600, 3800, 5600];
  const index = Math.max(1, Math.min(10, Math.trunc(Number(solveLevel) || 1))) - 1;
  return budgets[index];
}

function buildLevelSelect() {
  for (let l = 1; l <= 10; l++) {
    const opt = document.createElement("option");
    opt.value = String(l);
    opt.textContent = `L${l} · ${LEVEL_NAMES[l - 1]}`;
    els.levelSelect.appendChild(opt);
  }
  els.levelSelect.value = String(level);
}

function buildCoords() {
  for (let r = 0; r < 8; r++) {
    const span = document.createElement("span");
    span.textContent = String(8 - r);
    els.coordRanks.appendChild(span);
  }
  for (let c = 0; c < 8; c++) {
    const span = document.createElement("span");
    span.textContent = "abcdefgh"[c];
    els.coordFiles.appendChild(span);
  }
}

function buildBoard() {
  for (let r = 0; r < 8; r++) {
    const rowEl = document.createElement("div");
    rowEl.className = "grid-row";
    rowEl.setAttribute("role", "row");
    sqButtons[r] = [];
    for (let c = 0; c < 8; c++) {
      const cell = document.createElement("div");
      cell.className = "sq-cell";
      cell.setAttribute("role", "gridcell");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `sq ${(r + c) % 2 === 0 ? "dark" : "light"}`;
      btn.tabIndex = -1;
      btn.dataset.r = String(r);
      btn.dataset.c = String(c);
      cell.appendChild(btn);
      rowEl.appendChild(cell);
      sqButtons[r][c] = btn;
    }
    els.boardGrid.appendChild(rowEl);
  }

  els.boardGrid.addEventListener("click", (event) => {
    const btn = event.target.closest("button.sq");
    if (!btn || !els.boardGrid.contains(btn)) return;
    onSquareActivate(Number(btn.dataset.r), Number(btn.dataset.c));
  });

  els.boardGrid.addEventListener("keydown", (event) => {
    const key = event.key;
    let dr = 0;
    let dc = 0;
    if (key === "ArrowUp") dr = -1;
    else if (key === "ArrowDown") dr = 1;
    else if (key === "ArrowLeft") dc = -1;
    else if (key === "ArrowRight") dc = 1;
    else return;
    event.preventDefault();
    const nr = Math.min(7, Math.max(0, rovingPos[0] + dr));
    const nc = Math.min(7, Math.max(0, rovingPos[1] + dc));
    if (nr === rovingPos[0] && nc === rovingPos[1]) return;
    rovingPos = [nr, nc];
    renderBoardOnly();
    sqButtons[nr][nc].focus();
  });
}

const AiClient = (() => {
  let worker = null;
  let workerKind = null;
  let seq = 0;
  const pending = new Map();

  function dropWorker() {
    if (worker) {
      try {
        worker.terminate();
      } catch {}
      worker = null;
      workerKind = null;
    }
  }

  function failAllPending(reason) {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    pending.clear();
  }

  // 中止所有進行中的 AI 請求（重開新局、切換模式／等級時呼叫）：
  // 清掉計時器並以「已取消」拒絕，讓過期工作不會在之後逾時而誤砍
  // 新對局正在使用的 worker；同時終止 worker，避免舊運算佇列擋住新請求。
  function cancelAll() {
    if (pending.size === 0) return;
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      const err = new Error("AI 計算已取消");
      err.cancelled = true;
      entry.reject(err);
    }
    pending.clear();
    dropWorker();
  }

  function getWorker(solveLevel) {
    const desiredKind = solveLevel <= 5 ? "classic" : "fairy";
    if (worker && workerKind !== desiredKind) dropWorker();
    if (worker) return worker;
    try {
      worker = desiredKind === "classic"
        ? new Worker(new URL("./chess-ai-worker.mjs", import.meta.url), { type: "module" })
        : new Worker(new URL("../../shared/stockfish-engine-worker.js", import.meta.url));
      workerKind = desiredKind;
      worker.addEventListener("message", (event) => {
        const data = event.data || {};
        if (data.type === "ready") return;
        const entry = pending.get(data.id);
        if (!entry) return;
        pending.delete(data.id);
        clearTimeout(entry.timer);
        if (data.ok) entry.resolve(data.move);
        else entry.reject(new Error(data.error || "worker 回傳失敗"));
      });
      worker.addEventListener("error", () => {
        dropWorker();
        failAllPending(desiredKind === "classic" ? "本機快速 AI worker 發生錯誤" : "Fairy-Stockfish worker 發生錯誤");
      });
      return worker;
    } catch (error) {
      const label = desiredKind === "classic" ? "本機快速 AI" : "Fairy-Stockfish";
      throw new Error(`無法建立 ${label} worker：${error?.message || error}`);
    }
  }

  function viaWorker(solveState, solveLevel, solveContext) {
    const isClassic = solveLevel <= 5;
    const w = getWorker(solveLevel);
    if (!w) return Promise.reject(new Error("無法建立 AI worker"));
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const maxTimeMs = isClassic ? [350, 500, 750, 1100, 1500][solveLevel - 1] : engineThinkTimeMs(solveLevel);
      const timer = setTimeout(() => {
        pending.delete(id);
        dropWorker();
        reject(new Error(isClassic ? "本機快速 AI 思考逾時" : "Fairy-Stockfish 思考逾時"));
      }, maxTimeMs + (isClassic ? 1000 : 25000));
      pending.set(id, { resolve, reject, timer });
      w.postMessage({
        id,
        game: "chess",
        state: solveState,
        level: solveLevel,
        maxTimeMs,
        context: solveContext || {},
      });
    });
  }

  return {
    solve(solveState, solveLevel, solveContext) {
      return viaWorker(solveState, solveLevel, solveContext);
    },
    cancelAll,
  };
})();

function terminalInfo(status) {
  if (
    status.status === "checkmate" ||
    status.status === "stalemate" ||
    status.status === "insufficient" ||
    status.status === "fivefold" ||
    status.status === "seventyfive"
  ) {
    return {
      status: status.status,
      inCheck: status.inCheck,
      winner: status.winner ?? null,
    };
  }
  return null;
}

function refreshDerived() {
  posLegal = generateLegalMoves(state);
  const repetitionCount = repetitionTracker.countCurrent();
  curStatus = getGameStatus(state, { repetitionCount });
  gameOverInfo = terminalInfo(curStatus);
  claimable = gameOverInfo
    ? { threefold: false, fiftyMove: false }
    : claimableDraws(state, repetitionCount);
}

function doReset() {
  gameGeneration += 1;
  aiRequestSeq += 1;
  stopHintComputation();
  AiClient.cancelAll();
  aiBusy = false;
  pendingPromotion = null;
  closeOverlays();
  state = createInitialState();
  repetitionTracker.reset(state);
  hintUsedThisGame = false;
  undoUsedThisGame = false;
  recordPromptedThisGame = false;
  leaderboard?.reset();
  history = [];
  lastMove = null;
  selected = null;
  selDests = [];
  rovingPos = [6, 4];
  refreshDerived();
  render();
}

function isDirty() {
  return history.length > 0 || gameOverInfo !== null;
}

function pieceAt(r, c) {
  return state.board[r][c];
}

function humanControlsLocked() {
  return aiBusy || pendingPromotion !== null || gameOverInfo !== null;
}

function canSelect(r, c) {
  const p = pieceAt(r, c);
  if (!p) return false;
  if (p.color !== state.turn) return false;
  if (mode === "ai" && p.color !== "w") return false;
  return true;
}

function onSquareActivate(r, c) {
  if (humanControlsLocked()) return;
  rovingPos = [r, c];
  if (selected) {
    const candidates = selDests.filter(
      (m) => m.to[0] === r && m.to[1] === c
    );
    if (candidates.length > 1) {
      openPromotion(candidates);
      return;
    }
    if (candidates.length === 1) {
      executeMove(candidates[0]);
      return;
    }
    if (selected[0] === r && selected[1] === c) {
      selected = null;
      selDests = [];
      renderBoardOnly();
      return;
    }
  }
  if (canSelect(r, c)) {
    selected = [r, c];
    selDests = posLegal.filter(
      (m) => m.from[0] === selected[0] && m.from[1] === selected[1]
    );
  } else {
    selected = null;
    selDests = [];
  }
  renderBoardOnly();
  sqButtons[r][c].focus();
}

function executeMove(move) {
  if (humanControlsLocked() && !move.__fromAi) return;
  let next;
  try {
    next = applyMove(state, move);
  } catch {
    selected = null;
    selDests = [];
    render();
    flashNotice("引擎拒絕了該著法，已還原選取。");
    return;
  }
  const san = formatSan(state, move);
  history.push({ before: state, move, san });
  state = next;
  repetitionTracker.push(next);
  stopHintComputation();
  lastMove = move;
  selected = null;
  selDests = [];
  refreshDerived();
  render();
  maybeStartAiTurn();
}

function flashNotice(text) {
  els.statusSub.textContent = text;
}

function maybeStartAiTurn() {
  if (mode !== "ai" || gameOverInfo) return;
  if (state.turn !== "b") return;
  startAiTurn();
}

function startAiTurn() {
  aiBusy = true;
  aiRequestSeq += 1;
  const reqId = aiRequestSeq;
  const gen = gameGeneration;
  render();
  AiClient.solve(state, level, {
    repetitionCount: repetitionTracker.countCurrent(),
  }).then(
    (move) => {
      if (gen !== gameGeneration || reqId !== aiRequestSeq) return;
      aiBusy = false;
      const legalMove = move && posLegal.find((candidate) => sameMoveShape(candidate, move));
      if (!legalMove) {
        render();
        flashNotice(`${level <= 5 ? "本機快速 AI" : "Fairy-Stockfish"} 未回傳合法著法；請重新開始本局。`);
        return;
      }
      executeMove({ ...legalMove, __fromAi: true });
    },
    (err) => {
      if (gen !== gameGeneration || reqId !== aiRequestSeq) return;
      aiBusy = false;
      render();
      flashNotice(`AI 運算失敗：${err && err.message ? err.message : err}`);
    }
  );
}

async function requestModeChange(desired) {
  if (desired === mode) {
    syncControls();
    return;
  }
  if (isDirty()) {
    const ok = await showConfirm({
      title: "切換模式並開始新對局？",
      body: `切換為「${desired === "ai" ? "人機對戰" : "雙人對戰"}」將放棄目前進度，開始全新對局。`,
    });
    if (!ok) {
      syncControls();
      return;
    }
    mode = desired;
    doReset();
  } else {
    mode = desired;
    syncControls();
    doReset();
  }
}

async function requestLevelChange(desired) {
  desired = Number(desired);
  if (!Number.isInteger(desired) || desired < 1 || desired > 10) {
    syncControls();
    return;
  }
  if (desired === level) {
    syncControls();
    return;
  }
  if (isDirty()) {
    const ok = await showConfirm({
      title: "調整等級並開始新對局？",
      body: `AI 等級調整為 L${desired} · ${LEVEL_NAMES[desired - 1]}，將放棄目前進度，開始全新對局。`,
    });
    if (!ok) {
      syncControls();
      return;
    }
    level = desired;
    doReset();
  } else {
    level = desired;
    stopHintComputation();
    syncControls();
    render();
  }
}

async function requestNewGame() {
  if (!isDirty()) {
    doReset();
    return;
  }
  const ok = await showConfirm({
    title: "開始新對局？",
    body: "目前的棋局進度將被清除，確定重新開始？",
  });
  if (ok) doReset();
}

// 宣告和棋（FIDE 9.2 三次重複 / 9.3 五十步規則皆為「可主張」的和棋）。
// UI 邊界：本點擊介面無法表達 FIDE「在執行預期著法『之前』主張」的流程，
// 因此宣告一律以「當前局面」立即結算，並需經確認視窗二次確認；AI 不會
// 主動宣告和棋。宣告後可悔棋復原，亦可重開新局。
function claimKindNow() {
  if (!claimable.threefold && !claimable.fiftyMove) return null;
  return claimable.threefold ? "threefold" : "fiftyMove";
}

function claimReasonText(kind, both) {
  if (kind === "threefold") {
    return both
      ? "局面已第三次重複，且已達五十步規則門檻"
      : "目前局面已完成第三次重複";
  }
  return "已連續 100 半步（50 回合）無兵移動與無吃子";
}

async function requestClaimDraw() {
  if (gameOverInfo || aiBusy || pendingPromotion) return;
  const kind = claimKindNow();
  if (!kind) return;
  const both = claimable.threefold && claimable.fiftyMove;
  const ok = await showConfirm({
    title: "宣告和棋？",
    body: `${claimReasonText(kind, both)}。宣告後本局立即以和棋結束。`,
  });
  if (!ok) return;
  applyClaimDraw(kind);
}

function applyClaimDraw(kind) {
  gameGeneration += 1;
  aiRequestSeq += 1;
  stopHintComputation();
  AiClient.cancelAll();
  aiBusy = false;
  pendingPromotion = null;
  selected = null;
  selDests = [];
  gameOverInfo = { status: "claim", claimKind: kind, inCheck: false, winner: null };
  closeOverlays();
  render();
}

// ---------- 提示（L7 建議著法，不代下） ----------
//
// 提示只「分析當前局面並顯示建議」，絕不套用著法、不改變行棋方或等級。
// 與正式 AI 請求共用 worker／cancelAll 架構；任何會改變局面或結束對局的
// 操作（落子、悔棋、重開、宣告和棋、切換模式／等級）都會使提示失效並
// 釋放 worker，過期結果以序號／代數／狀態三重守衛丟棄，不會渲染進新局。

function stopHintComputation() {
  if (hintBusy) {
    hintRequestSeq += 1;
    AiClient.cancelAll();
  }
  hintBusy = false;
  hintInfo = null;
}

// ---------- 公開投稿資格（公平性守衛，純函式便於測試） ----------
// 僅接受：AI 模式、玩家執白、L6–L10、
// 白方將死取勝、且本局未曾使用提示或悔棋。
function canPublishResult(
  gameOverInfo,
  gameMode,
  gameLevel,
  hintUsed,
  undoUsed
) {
  return Boolean(
    gameOverInfo &&
      gameOverInfo.status === "checkmate" &&
      gameOverInfo.winner === "w" &&
      gameMode === "ai" &&
      Number(gameLevel) >= 6 &&
      Number(gameLevel) <= 10 &&
      !hintUsed &&
      !undoUsed
  );
}

function publicSubmitDisabled({ nickname, eligible, done, submitting }) {
  return Boolean(!eligible || done || submitting || nickname.length === 0);
}

function fairnessText(hintUsed, undoUsed) {
  const used = [hintUsed ? "提示" : null, undoUsed ? "悔棋" : null].filter(
    Boolean
  );
  return `本局曾使用${used.join("與")}，基於公平性不開放公開投稿；您仍可私下保存棋譜。`;
}

function sameMoveShape(a, b) {
  return (
    a.from[0] === b.from[0] &&
    a.from[1] === b.from[1] &&
    a.to[0] === b.to[0] &&
    a.to[1] === b.to[1] &&
    (a.promotion ?? null) === (b.promotion ?? null)
  );
}

function requestHint() {
  if (gameOverInfo || aiBusy || hintBusy || pendingPromotion) return;
  if (confirmResolve) return;
  if (mode === "ai" && state.turn !== "w") return;
  if (!posLegal || posLegal.length === 0) return;
  hintUsedThisGame = true; // 公平性守衛：本局使用過提示即不得公開投稿
  hintBusy = true;
  hintRequestSeq += 1;
  const reqId = hintRequestSeq;
  const gen = gameGeneration;
  const snapState = state;
  render();
  AiClient.solve(snapState, HINT_LEVEL, {
    repetitionCount: repetitionTracker.countCurrent(),
  }).then(
    (move) => {
      if (
        gen !== gameGeneration ||
        reqId !== hintRequestSeq ||
        snapState !== state ||
        gameOverInfo
      ) {
        return;
      }
      hintBusy = false;
      if (!move || !posLegal.some((m) => sameMoveShape(m, move))) {
        render();
        return;
      }
      hintInfo = { move, san: formatSan(snapState, move) };
      render();
    },
    () => {
      // 取消（重開／換局等）或運算失敗：靜默還原按鈕，不報錯、不落子。
      if (
        gen !== gameGeneration ||
        reqId !== hintRequestSeq ||
        snapState !== state
      ) {
        return;
      }
      hintBusy = false;
      render();
    }
  );
}

// ---------- 對局結果：私人 PGN（僅本機）與 L6–L10 勝局登記 ----------

function updateResultPanel() {
  const qualified =
    gameOverInfo !== null &&
    gameOverInfo.status === "checkmate" &&
    gameOverInfo.winner === "w" &&
    mode === "ai";
  els.resultPanel.classList.toggle("hidden", !qualified);
  if (!qualified) return;
  els.resultTitle.textContent = "恭喜！白方將死取勝";
  if (!isLeaderboardLevel(level) || recordPromptedThisGame || !leaderboard) return;
  recordPromptedThisGame = true;
  const eligible = canPublishResult(
    gameOverInfo,
    mode,
    level,
    hintUsedThisGame,
    undoUsedThisGame
  );
  const summary = `你以 ${history.length} 步擊敗 L${level} AI，請留下排行榜暱稱。`;
  if (!eligible) {
    leaderboard.showBlocked({
      level,
      summary,
      reason: fairnessText(hintUsedThisGame, undoUsedThisGame),
    });
  } else {
    leaderboard.showWin({
      level,
      summary,
      moves: history.map((entry) => moveToUci(entry.move)),
    });
  }
}

function localDateDot() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}.${mm}.${dd}`;
}

function triggerDownload(filename, text) {
  const blob = new Blob([text], { type: "application/x-chess-pgn" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// 私人棋譜：僅在使用者點擊時於本機組出並下載；White 一律用通用「玩家」，
// 不使用公開暱稱；絕不經由網路傳送。
function savePrivatePgn() {
  if (!gameOverInfo || gameOverInfo.status !== "checkmate") return;
  const sanList = history.map((h) => h.san);
  if (sanList.length === 0) return;
  const pgn = buildPgn({
    sanList,
    dateOnly: localDateDot(),
    white: DEFAULT_PRIVATE_WHITE,
    black: `Community opponent L${level} (practice)`,
    level,
    plyCount: sanList.length,
  });
  const stamp = localDateDot().replaceAll(".", "");
  triggerDownload(`oxalpha-private-L${level}-${stamp}.pgn`, pgn);
  els.statusSub.textContent = "私人棋譜已下載（僅存於此裝置）。";
}

function undoPlies() {
  if (pendingPromotion || aiBusy || history.length === 0) return;
  let n = 1;
  if (mode === "ai") n = history.length % 2 === 0 ? 2 : 1;
  n = Math.min(n, history.length);
  if (n === 0) return;
  undoUsedThisGame = true; // 公平性守衛：本局使用過悔棋即不得公開投稿
  recordPromptedThisGame = false;
  leaderboard?.reset();
  gameGeneration += 1;
  aiRequestSeq += 1;
  history.length -= n;
  state =
    history.length > 0
      ? history[history.length - 1].before
      : createInitialState();
  repetitionTracker.truncate(n);
  stopHintComputation();
  lastMove = history.length > 0 ? history[history.length - 1].move : null;
  selected = null;
  selDests = [];
  gameOverInfo = null;
  refreshDerived();
  render();
}

function syncControls() {
  els.modeAi.checked = mode === "ai";
  els.modePvp.checked = mode === "pvp";
  els.levelSelect.value = String(level);
}

function squareLabel(r, c) {
  const p = pieceAt(r, c);
  const name = squareName([r, c]);
  if (!p) return `${name}（空格）`;
  return `${name}，${COLOR_ZH[p.color]}${PIECE_ZH[p.type]}`;
}

function renderBoardOnly() {
  const checkSquare =
    curStatus && curStatus.inCheck
      ? findKingSquare(state.board, state.turn)
      : null;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const btn = sqButtons[r][c];
      const p = pieceAt(r, c);
      btn.textContent = "";
      if (p) {
        const glyph = document.createElement("span");
        glyph.className = `piece-glyph ${p.color === "w" ? "piece-w" : "piece-b"}`;
        glyph.textContent = GLYPHS[p.type];
        btn.appendChild(glyph);
      }
      const classes = ["sq", (r + c) % 2 === 0 ? "dark" : "light"];
      if (selected && selected[0] === r && selected[1] === c)
        classes.push("selected");
      if (lastMove) {
        if (lastMove.from[0] === r && lastMove.from[1] === c)
          classes.push("last-move");
        if (lastMove.to[0] === r && lastMove.to[1] === c)
          classes.push("last-move");
      }
      const isDest = selDests.some((m) => m.to[0] === r && m.to[1] === c);
      if (isDest) {
        const isEp = selDests.some(
          (m) => m.to[0] === r && m.to[1] === c && m.isEnPassant
        );
        classes.push(pieceAt(r, c) || isEp ? "dest-capture" : "dest-quiet");
      }
      if (
        hintInfo &&
        ((hintInfo.move.from[0] === r && hintInfo.move.from[1] === c) ||
          (hintInfo.move.to[0] === r && hintInfo.move.to[1] === c))
      ) {
        classes.push("hint-move");
      }
      if (checkSquare && checkSquare[0] === r && checkSquare[1] === c)
        classes.push("in-check");
      btn.className = classes.join(" ");
      btn.setAttribute("aria-label", squareLabel(r, c));
      btn.tabIndex = rovingPos[0] === r && rovingPos[1] === c ? 0 : -1;
    }
  }
  els.boardGrid.classList.toggle("locked", humanControlsLocked());
  els.boardGrid.setAttribute(
    "aria-disabled",
    humanControlsLocked() ? "true" : "false"
  );
}

function findKingSquare(board, color) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.type === "k" && p.color === color) return [r, c];
    }
  }
  return null;
}

function drawOutcomeText(info) {
  switch (info.status) {
    case "insufficient":
      return { main: "子力不足，和棋！", title: "子力不足 · 自動判和" };
    case "seventyfive":
      return { main: "75 回合規則，自動和棋", title: "75 回合規則 · 自動和棋" };
    case "fivefold":
      return { main: "五次重複局面，自動和棋", title: "五次重複 · 自動和棋" };
    case "claim":
      return info.claimKind === "fiftyMove"
        ? { main: "五十步規則，宣告和棋成立", title: "宣告和棋 · 五十步規則" }
        : { main: "三次重複局面，宣告和棋成立", title: "宣告和棋 · 三次重複" };
    default:
      return null;
  }
}

function claimButtonVisible(over, busy, promoOpen, claims) {
  if (over || busy || promoOpen) return false;
  return Boolean(claims.threefold || claims.fiftyMove);
}

function renderStatus() {
  let main = "";
  let sub = "";
  const modeLabel = mode === "ai" ? "人機對戰" : "雙人對戰";
  if (gameOverInfo) {
    if (gameOverInfo.status === "checkmate") {
      main = `將死！${COLOR_ZH[gameOverInfo.winner]}方獲勝`;
    } else if (gameOverInfo.status === "stalemate") {
      main = "逼和！雙方言和";
    } else {
      main = drawOutcomeText(gameOverInfo).main;
    }
    sub = `共 ${history.length} 步 · ${modeLabel}`;
  } else if (aiBusy) {
    main = "黑方 AI 思考中…";
    sub = `第 ${state.fullmoveNumber} 手 · ${modeLabel} · L${level} ${LEVEL_NAMES[level - 1]}`;
  } else {
    main = `輪到${COLOR_ZH[state.turn]}方行棋`;
    if (curStatus.inCheck) main += "（被將軍！）";
    if (hintInfo) main += `（建議：${hintInfo.san}）`;
    sub = `第 ${state.fullmoveNumber} 手 · ${modeLabel}${mode === "ai" ? ` · L${level} ${LEVEL_NAMES[level - 1]}` : ""}`;
    if (claimable.threefold || claimable.fiftyMove) sub += " · 可宣告和棋";
    if (hintBusy) sub += " · 提示分析中…";
  }
  els.statusMain.textContent = main;
  els.statusSub.textContent = sub;
  els.thinkingBadge.classList.toggle("hidden", !aiBusy);
  els.undoBtn.disabled = aiBusy || pendingPromotion !== null || history.length === 0;
  const hintUsable =
    !gameOverInfo &&
    !aiBusy &&
    !hintBusy &&
    pendingPromotion === null &&
    confirmResolve === null &&
    (mode === "pvp" || state.turn === "w");
  els.hintBtn.disabled = !hintUsable;
  els.hintBtn.title = hintBusy
    ? "提示分析中…"
    : "以 L7 引擎建議下一步（不會代下）";
  els.claimDrawBtn.classList.toggle(
    "hidden",
    !claimButtonVisible(
      gameOverInfo,
      aiBusy,
      pendingPromotion !== null,
      claimable
    )
  );
}

function renderCaptured() {
  const capW = [];
  const capB = [];
  for (const h of history) {
    if (!h.move.captured) continue;
    const moverWhite = h.before.turn === "w";
    (moverWhite ? capW : capB).push(h.move.captured);
  }
  renderTray(els.capW, els.leadW, capW, "b");
  renderTray(els.capB, els.leadB, capB, "w");
}

function renderTray(trayEl, leadEl, capturedTypes, glyphColor) {
  trayEl.textContent = "";
  if (capturedTypes.length === 0) {
    const empty = document.createElement("span");
    empty.className = "tray-empty";
    empty.textContent = "尚無斬獲";
    trayEl.appendChild(empty);
  } else {
    const sorted = [...capturedTypes].sort((a, b) => POINTS[b] - POINTS[a]);
    for (const t of sorted) {
      const span = document.createElement("span");
      span.className = `piece-glyph ${glyphColor === "w" ? "piece-w" : "piece-b"}`;
      span.textContent = GLYPHS[t];
      span.title = `${glyphColor === "w" ? "白" : "黑"}${PIECE_ZH[t]}`;
      trayEl.appendChild(span);
    }
  }
  updateLeads();
}

function updateLeads() {
  const sumFor = (trayList) => trayList.reduce((a, t) => a + POINTS[t], 0);
  const whiteTake = [];
  const blackTake = [];
  for (const h of history) {
    if (!h.move.captured) continue;
    ((h.before.turn === "w" ? whiteTake : blackTake)).push(h.move.captured);
  }
  const dw = sumFor(whiteTake) - sumFor(blackTake);
  els.leadW.textContent = dw > 0 ? `+${dw}` : "";
  els.leadB.textContent = dw < 0 ? `+${-dw}` : "";
}

function renderHistory() {
  els.moveList.textContent = "";
  if (history.length === 0) {
    const li = document.createElement("li");
    li.className = "move-list-empty";
    li.textContent = "尚無著法——執白先行。";
    els.moveList.appendChild(li);
    return;
  }
  for (let i = 0; i < history.length; i += 2) {
    const li = document.createElement("li");
    li.className = "move-row";
    const num = document.createElement("span");
    num.className = "move-num";
    num.textContent = `${i / 2 + 1}.`;
    const w = document.createElement("span");
    w.className = "move-san";
    w.textContent = history[i].san;
    li.append(num, w);
    let b = null;
    if (i + 1 < history.length) {
      b = document.createElement("span");
      b.className = "move-san";
      b.textContent = history[i + 1].san;
      li.appendChild(b);
    }
    if (i === history.length - 1) {
      w.classList.add("current");
    } else if (b && i + 1 === history.length - 1) {
      b.classList.add("current");
    }
    els.moveList.appendChild(li);
  }
  els.moveList.scrollTop = els.moveList.scrollHeight;
}

function renderBanner() {
  if (gameOverInfo) {
    if (gameOverInfo.status === "checkmate") {
      els.bannerKicker.textContent = "CHECKMATE";
      els.bannerTitle.textContent = `將死 · ${COLOR_ZH[gameOverInfo.winner]}方勝`;
    } else if (gameOverInfo.status === "stalemate") {
      els.bannerKicker.textContent = "STALEMATE";
      els.bannerTitle.textContent = "逼和 · 和棋";
    } else {
      els.bannerKicker.textContent = "DRAW";
      els.bannerTitle.textContent = drawOutcomeText(gameOverInfo).title;
    }
    els.banner.classList.remove("hidden");
  } else {
    els.banner.classList.add("hidden");
  }
}

function render() {
  renderBoardOnly();
  renderStatus();
  renderCaptured();
  renderHistory();
  renderBanner();
  updateResultPanel();
}

function openPromotion(candidates) {
  pendingPromotion = { candidates };
  els.promoGrid.textContent = "";
  const moverClass = state.turn === "w" ? "piece-w" : "piece-b";
  for (const kind of ["q", "r", "b", "n"]) {
    const move = candidates.find((m) => m.promotion === kind);
    if (!move) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "promo-btn";
    btn.dataset.promo = kind;
    const glyph = document.createElement("span");
    glyph.className = `promo-glyph ${moverClass}`;
    glyph.textContent = GLYPHS[kind];
    const name = document.createElement("span");
    name.className = "promo-name";
    name.textContent = PROMO_ZH[kind];
    btn.append(glyph, name);
    btn.addEventListener("click", () => {
      const chosen = pendingPromotion.candidates.find((m) => m.promotion === kind);
      closePromotion();
      if (chosen) executeMove(chosen);
    });
    els.promoGrid.appendChild(btn);
  }
  els.promoOverlay.classList.remove("hidden");
  document.body.classList.add("modal-open");
  rememberFocus();
  const first = els.promoGrid.querySelector("button");
  if (first) first.focus();
}

function closePromotion() {
  pendingPromotion = null;
  els.promoOverlay.classList.add("hidden");
  document.body.classList.remove("modal-open");
  restoreFocus();
}

let confirmResolve = null;

function showConfirm({ title, body }) {
  return new Promise((resolve) => {
    confirmResolve = resolve;
    els.confirmTitle.textContent = title;
    els.confirmBody.textContent = body;
    els.confirmOverlay.classList.remove("hidden");
    document.body.classList.add("modal-open");
    rememberFocus();
    els.confirmOk.focus();
  });
}

function settleConfirm(result) {
  if (!confirmResolve) return;
  const resolve = confirmResolve;
  confirmResolve = null;
  els.confirmOverlay.classList.add("hidden");
  document.body.classList.remove("modal-open");
  restoreFocus();
  resolve(result);
}

let lastFocused = null;

function rememberFocus() {
  lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

function restoreFocus() {
  if (lastFocused && document.contains(lastFocused)) {
    lastFocused.focus();
  }
  lastFocused = null;
}

function closeOverlays() {
  els.promoOverlay.classList.add("hidden");
  els.confirmOverlay.classList.add("hidden");
  document.body.classList.remove("modal-open");
  confirmResolve = null;
}

function trapFocusIn(overlay, event) {
  const focusables = overlay.querySelectorAll("button, [href], select, input");
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function initModals() {
  els.promoCancel.addEventListener("click", () => {
    closePromotion();
    renderBoardOnly();
  });
  els.promoOverlay.addEventListener("mousedown", (e) => {
    if (e.target === els.promoOverlay) {
      closePromotion();
      renderBoardOnly();
    }
  });
  els.confirmOk.addEventListener("click", () => settleConfirm(true));
  els.confirmCancel.addEventListener("click", () => settleConfirm(false));
  els.confirmOverlay.addEventListener("mousedown", (e) => {
    if (e.target === els.confirmOverlay) settleConfirm(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!els.confirmOverlay.classList.contains("hidden")) {
        e.preventDefault();
        settleConfirm(false);
      } else if (!els.promoOverlay.classList.contains("hidden")) {
        e.preventDefault();
        closePromotion();
        renderBoardOnly();
      }
      return;
    }
    if (e.key === "Tab") {
      if (!els.confirmOverlay.classList.contains("hidden"))
        trapFocusIn(els.confirmOverlay, e);
      else if (!els.promoOverlay.classList.contains("hidden"))
        trapFocusIn(els.promoOverlay, e);
    }
  });
}

function init() {
  Object.assign(els, {
    boardGrid: $("boardGrid"),
    coordRanks: $("coordRanks"),
    coordFiles: $("coordFiles"),
    banner: $("banner"),
    bannerKicker: $("bannerKicker"),
    bannerTitle: $("bannerTitle"),
    bannerAgain: $("bannerAgain"),
    statusMain: $("statusMain"),
    statusSub: $("statusSub"),
    thinkingBadge: $("thinkingBadge"),
    modeAi: $("modeAi"),
    modePvp: $("modePvp"),
    levelSelect: $("levelSelect"),
    newGameBtn: $("newGameBtn"),
    hintBtn: $("hintBtn"),
    claimDrawBtn: $("claimDrawBtn"),
    undoBtn: $("undoBtn"),
    resultPanel: $("resultPanel"),
    resultTitle: $("resultTitle"),
    privateSaveBtn: $("privateSaveBtn"),
    leadW: $("leadW"),
    leadB: $("leadB"),
    capW: $("capW"),
    capB: $("capB"),
    moveList: $("moveList"),
    promoOverlay: $("promoOverlay"),
    promoGrid: $("promoGrid"),
    promoCancel: $("promoCancel"),
    confirmOverlay: $("confirmOverlay"),
    confirmTitle: $("confirmTitle"),
    confirmBody: $("confirmBody"),
    confirmOk: $("confirmOk"),
    confirmCancel: $("confirmCancel"),
  });

  buildCoords();
  buildBoard();
  buildLevelSelect();
  leaderboard = createLeaderboardController({ game: "chess", initialLevel: 6 });

  els.newGameBtn.addEventListener("click", () => {
    requestNewGame();
  });
  els.hintBtn.addEventListener("click", () => {
    requestHint();
  });
  els.privateSaveBtn.addEventListener("click", () => {
    savePrivatePgn();
  });
  els.claimDrawBtn.addEventListener("click", () => {
    requestClaimDraw();
  });
  els.bannerAgain.addEventListener("click", () => doReset());
  els.undoBtn.addEventListener("click", () => undoPlies());
  els.modeAi.addEventListener("change", () => {
    if (els.modeAi.checked) requestModeChange("ai");
  });
  els.modePvp.addEventListener("change", () => {
    if (els.modePvp.checked) requestModeChange("pvp");
  });
  els.levelSelect.addEventListener("change", () => {
    requestLevelChange(els.levelSelect.value);
  });

  initModals();

  state = createInitialState();
  repetitionTracker.reset(state);
  hintUsedThisGame = false;
  undoUsedThisGame = false;
  recordPromptedThisGame = false;
  refreshDerived();
  syncControls();
  render();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
