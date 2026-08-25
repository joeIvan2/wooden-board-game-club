/*
 * xiangqi-grandmaster-worker.js — Fairy-Stockfish NNUE 的瀏覽器 Worker 封裝。
 *
 * 只供 L10 使用；規則、棋譜與最後的合法著法驗證仍由專案自己的
 * xiangqi-rules.mjs 負責。這個 classic worker 不能改成 module worker，
 * 因為上游 Emscripten bundle 以 importScripts 載入，並會自行建立 pthread。
 */

const VENDOR_DIR = "./vendor/fairy-stockfish-nnue-1.1.11/";
const UCI_TO_TYPE = Object.freeze({
  k: "general",
  r: "rook",
  c: "cannon",
  h: "horse",
  a: "advisor",
  e: "elephant",
  p: "soldier",
});

let engine = null;
let bootPromise = null;
let activeJob = null;
let commandWaiter = null;

function vendorUrl(asset) {
  return new URL(`${VENDOR_DIR}${asset}`, self.location.href).href;
}

function stateToFen(state) {
  if (!state?.board || !Array.isArray(state.board)) throw new Error("AI 收到的棋局格式不正確");
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
      const symbol = Object.entries(UCI_TO_TYPE).find(([, type]) => type === piece.type)?.[0];
      if (!symbol) throw new Error(`無法轉換棋子：${piece.type}`);
      fen += piece.color === "red" ? symbol.toUpperCase() : symbol;
    }
    return `${fen}${empty || ""}`;
  });
  const side = state.turn === "red" ? "w" : "b";
  const fullmove = Math.max(1, Math.floor((Number(state.plies) || 0) / 2) + 1);
  return `${rows.join("/")} ${side} - - 0 ${fullmove}`;
}

function uciMoveToProjectMove(line) {
  // 象棋 UCI 的橫列範圍為 1–10，因此 h10g8 這類雙位數座標是合法輸出。
  const match = /^bestmove\s+([a-i])(10|[1-9])([a-i])(10|[1-9])/i.exec(line);
  if (!match) return null;
  const [, fromFile, fromRank, toFile, toRank] = match;
  // Fairy-Stockfish 的象棋 UCI rank 是 1–10，最高列以 0 表示；
  // 專案盤面則是 0（黑方底線）到 9（紅方底線）。
  const toRow = (rank) => 10 - Number(rank);
  return {
    from: { row: toRow(fromRank), col: fromFile.charCodeAt(0) - 97 },
    to: { row: toRow(toRank), col: toFile.charCodeAt(0) - 97 },
  };
}

function settleCommand(line) {
  if (!commandWaiter || !commandWaiter.matches(line)) return false;
  const { resolve } = commandWaiter;
  commandWaiter = null;
  resolve(line);
  return true;
}

function onEngineLine(rawLine) {
  const line = String(rawLine || "").trim();
  if (!line || settleCommand(line)) return;
  if (!activeJob || !line.startsWith("bestmove")) return;
  const job = activeJob;
  activeJob = null;
  const move = uciMoveToProjectMove(line);
  if (!move) {
    self.postMessage({ id: job.id, ok: false, error: `巔峰引擎沒有回傳可用著法：${line}` });
    return;
  }
  self.postMessage({ id: job.id, ok: true, move });
}

function commandUntil(command, matches) {
  return new Promise((resolve, reject) => {
    if (commandWaiter) {
      reject(new Error("引擎初始化命令重疊"));
      return;
    }
    commandWaiter = { resolve, matches };
    engine.postMessage(command);
  });
}

async function ensureEngine() {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    importScripts(vendorUrl("stockfish.js"));
    if (typeof Stockfish !== "function") throw new Error("巔峰引擎載入失敗");
    engine = await Stockfish({
      locateFile: (asset) => vendorUrl(asset),
      // 在 worker 內 importScripts 時 Emscripten 無法可靠推得主 bundle URL；
      // pthread worker 需要此字串來重新載入相同的 bootstrap。
      mainScriptUrlOrBlob: vendorUrl("stockfish.js"),
    });
    engine.addMessageListener(onEngineLine);
    await commandUntil("uci", (line) => line === "uciok");
    engine.postMessage("setoption name UCI_Variant value xiangqi");
    engine.postMessage("setoption name Threads value 1");
    engine.postMessage("setoption name Hash value 32");
    await commandUntil("isready", (line) => line === "readyok");
    self.postMessage({ type: "ready" });
  })().catch((error) => {
    bootPromise = null;
    engine = null;
    throw error;
  });
  return bootPromise;
}

self.addEventListener("message", async (event) => {
  const { id, state, maxTimeMs } = event.data || {};
  if (typeof id !== "number" || !state) {
    self.postMessage({ id: null, ok: false, error: "worker 收到格式不正確的訊息" });
    return;
  }
  try {
    await ensureEngine();
    if (activeJob) throw new Error("巔峰引擎仍在計算上一手");
    activeJob = { id };
    engine.postMessage(`position fen ${stateToFen(state)}`);
    engine.postMessage(`go movetime ${Math.max(250, Math.floor(Number(maxTimeMs) || 6000))}`);
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error?.message || error) });
  }
});
