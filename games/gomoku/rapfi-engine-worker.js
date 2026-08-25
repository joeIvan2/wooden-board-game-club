/*
 * Rapfi classic WebAssembly bridge for the fixed 15x15 freestyle game.
 * The product intentionally bundles one pinned engine build; an engine error
 * is reported to the UI instead of sourcing a move elsewhere.
 */

const VENDOR_DIR = "./vendor/rapfi-classic-0.43.02/";
const PROFILES = Object.freeze([
  null,
  { timeout: 180, depth: 3, strength: 10, nodes: 300 },
  { timeout: 260, depth: 4, strength: 20, nodes: 700 },
  { timeout: 380, depth: 5, strength: 30, nodes: 1500 },
  { timeout: 550, depth: 6, strength: 40, nodes: 3000 },
  { timeout: 750, depth: 7, strength: 52, nodes: 6000 },
  { timeout: 1000, depth: 8, strength: 64, nodes: 12000 },
  { timeout: 1400, depth: 9, strength: 74, nodes: 24000 },
  { timeout: 2000, depth: 10, strength: 84, nodes: 48000 },
  { timeout: 3000, depth: 12, strength: 93, nodes: 96000 },
  { timeout: 4500, depth: 14, strength: 100, nodes: 180000 },
]);

let engine = null;
let bootPromise = null;
let activeJob = null;

function vendorUrl(asset) {
  return new URL(`${VENDOR_DIR}${asset}`, self.location.href).href;
}

function profileFor(level) {
  return PROFILES[Math.max(1, Math.min(10, Math.trunc(Number(level) || 1)))];
}

function send(command) {
  engine.sendCommand(command);
}

function boardCommand(board) {
  const entries = [];
  for (let index = 0; index < board.length; index += 1) {
    const stone = board[index];
    if (stone === 0) continue;
    const row = Math.floor(index / 15);
    const col = index % 15;
    entries.push(`${col},${row},${stone}`);
  }
  return `BOARD ${entries.join(" ")} DONE`;
}

function onEngineLine(rawLine) {
  const line = String(rawLine || "").trim();
  if (!activeJob || !/^\d{1,2},\d{1,2}$/.test(line)) return;
  const [col, row] = line.split(",").map(Number);
  const job = activeJob;
  activeJob = null;
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= 15 || col < 0 || col >= 15) {
    self.postMessage({ id: job.id, ok: false, error: `Rapfi 回傳盤外座標：${line}` });
    return;
  }
  const index = row * 15 + col;
  if (job.board[index] !== 0) {
    self.postMessage({ id: job.id, ok: false, error: `Rapfi 回傳已佔用座標：${line}` });
    return;
  }
  self.postMessage({ id: job.id, ok: true, move: { row, col } });
}

async function ensureEngine() {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    // This pinned Rapfi build predates Chrome's resizable WebAssembly memory
    // buffers.  Its optional TextDecoder fast path rejects those buffers in
    // current Chromium.  Disabling only that optional fast path inside this
    // isolated worker makes Rapfi use its bundled byte decoder instead.
    self.TextDecoder = undefined;
    importScripts(vendorUrl("rapfi-single.js"));
    if (typeof Rapfi !== "function") throw new Error("Rapfi 載入失敗");
    engine = await Rapfi({
      locateFile: (asset) => vendorUrl(/^rapfi.*\.data$/i.test(asset) ? "rapfi.data" : asset),
      onReceiveStdout: onEngineLine,
      onReceiveStderr: () => {},
    });
    send("START 15");
    send("INFO RULE 0");
    send("INFO THREAD_NUM 1");
    self.postMessage({ type: "ready", game: "gomoku" });
  })().catch((error) => {
    engine = null;
    bootPromise = null;
    throw error;
  });
  return bootPromise;
}

self.addEventListener("message", async ({ data }) => {
  const { id, board, level } = data || {};
  if (typeof id !== "number" || !Array.isArray(board) || board.length !== 225) {
    self.postMessage({ id: null, ok: false, error: "Rapfi worker 收到格式不正確的棋局" });
    return;
  }
  if (activeJob) {
    self.postMessage({ id, ok: false, error: "Rapfi 仍在計算上一手" });
    return;
  }
  if (board.some((stone) => stone !== 0 && stone !== 1 && stone !== 2)) {
    self.postMessage({ id, ok: false, error: "Rapfi 收到不正確的棋子資料" });
    return;
  }
  try {
    await ensureEngine();
    const profile = profileFor(level);
    activeJob = { id, board: [...board] };
    send(`INFO STRENGTH ${profile.strength}`);
    send(`INFO TIMEOUT_TURN ${profile.timeout}`);
    send(`INFO MAX_DEPTH ${profile.depth}`);
    send(`INFO MAX_NODE ${profile.nodes}`);
    send(boardCommand(board));
  } catch (error) {
    activeJob = null;
    self.postMessage({ id, ok: false, error: String(error?.message || error) });
  }
});
