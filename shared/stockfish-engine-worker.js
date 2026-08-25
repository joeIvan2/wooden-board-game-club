/*
 * One local Fairy-Stockfish NNUE worker for the two chess variants.
 *
 * This deliberately owns only engine protocol/FEN conversion.  Every returned
 * coordinate is matched against the product's own rules engine in app.js
 * before it can alter a game. An engine error is returned to the game UI.
 */

const VENDOR_DIR = "../games/xiangqi/vendor/fairy-stockfish-nnue-1.1.11/";
const SKILL_LEVELS = Object.freeze([0, 2, 4, 6, 8, 10, 12, 14, 17, 20]);
const XIANGQI_UCI_TO_TYPE = Object.freeze({
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
let configuredGame = null;
let activeJob = null;
let commandWaiter = null;

function vendorUrl(asset) {
  return new URL(`${VENDOR_DIR}${asset}`, self.location.href).href;
}

function skillFor(level) {
  const index = Math.max(1, Math.min(10, Math.trunc(Number(level) || 1))) - 1;
  return SKILL_LEVELS[index];
}

function chessStateToFen(state) {
  if (!Array.isArray(state?.board) || state.board.length !== 8) {
    throw new Error("西洋棋引擎收到的棋局格式不正確");
  }
  const rows = state.board.map((row) => {
    if (!Array.isArray(row) || row.length !== 8) throw new Error("西洋棋棋盤列數不正確");
    let empty = 0;
    let fen = "";
    for (const piece of row) {
      if (!piece) {
        empty += 1;
        continue;
      }
      if (!/^[kqrbnp]$/.test(piece.type) || !/^[wb]$/.test(piece.color)) {
        throw new Error("西洋棋棋子格式不正確");
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
  const ep = state.enPassant
    ? `${String.fromCharCode(97 + state.enPassant.col)}${8 - state.enPassant.row}`
    : "-";
  const halfmove = Math.max(0, Math.trunc(Number(state.halfmoveClock) || 0));
  const fullmove = Math.max(1, Math.trunc(Number(state.fullmoveNumber) || 1));
  return `${rows.join("/")} ${state.turn === "w" ? "w" : "b"} ${castling} ${ep} ${halfmove} ${fullmove}`;
}

function xiangqiStateToFen(state) {
  if (!Array.isArray(state?.board) || state.board.length !== 10) {
    throw new Error("象棋引擎收到的棋局格式不正確");
  }
  const rows = state.board.map((row) => {
    if (!Array.isArray(row) || row.length !== 9) throw new Error("象棋棋盤列數不正確");
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
      const symbol = Object.entries(XIANGQI_UCI_TO_TYPE).find(([, type]) => type === piece.type)?.[0];
      if (!symbol || !/^(red|black)$/.test(piece.color)) {
        throw new Error(`無法轉換象棋棋子：${piece?.type || "?"}`);
      }
      fen += piece.color === "red" ? symbol.toUpperCase() : symbol;
    }
    return `${fen}${empty || ""}`;
  });
  const fullmove = Math.max(1, Math.floor((Number(state.plies) || 0) / 2) + 1);
  return `${rows.join("/")} ${state.turn === "red" ? "w" : "b"} - - 0 ${fullmove}`;
}

function stateToFen(game, state) {
  if (game === "chess") return chessStateToFen(state);
  if (game === "xiangqi") return xiangqiStateToFen(state);
  throw new Error(`不支援的棋種：${String(game)}`);
}

function engineMoveToProjectMove(game, line) {
  if (game === "chess") {
    const match = /^bestmove\s+([a-h])([1-8])([a-h])([1-8])([qrbn])?/i.exec(line);
    if (!match) return null;
    const [, fromFile, fromRank, toFile, toRank, promotion] = match;
    return {
      from: [8 - Number(fromRank), fromFile.toLowerCase().charCodeAt(0) - 97],
      to: [8 - Number(toRank), toFile.toLowerCase().charCodeAt(0) - 97],
      promotion: promotion?.toLowerCase() ?? null,
    };
  }
  const match = /^bestmove\s+([a-i])(10|[1-9])([a-i])(10|[1-9])/i.exec(line);
  if (!match) return null;
  const [, fromFile, fromRank, toFile, toRank] = match;
  const row = (rank) => 10 - Number(rank);
  return {
    from: { row: row(fromRank), col: fromFile.toLowerCase().charCodeAt(0) - 97 },
    to: { row: row(toRank), col: toFile.toLowerCase().charCodeAt(0) - 97 },
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
  const move = engineMoveToProjectMove(job.game, line);
  if (!move) {
    self.postMessage({ id: job.id, ok: false, error: `引擎沒有回傳可用著法：${line}` });
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

async function ensureEngine(game) {
  if (bootPromise) {
    await bootPromise;
    if (configuredGame !== game) throw new Error("同一個引擎 worker 不可切換棋種");
    return;
  }
  bootPromise = (async () => {
    importScripts(vendorUrl("stockfish.js"));
    if (typeof Stockfish !== "function") throw new Error("Fairy-Stockfish 載入失敗");
    engine = await Stockfish({
      locateFile: (asset) => vendorUrl(asset),
      mainScriptUrlOrBlob: vendorUrl("stockfish.js"),
    });
    engine.addMessageListener(onEngineLine);
    await commandUntil("uci", (line) => line === "uciok");
    engine.postMessage(`setoption name UCI_Variant value ${game === "xiangqi" ? "xiangqi" : "chess"}`);
    engine.postMessage("setoption name Threads value 1");
    engine.postMessage("setoption name Hash value 32");
    await commandUntil("isready", (line) => line === "readyok");
    configuredGame = game;
    self.postMessage({ type: "ready", game });
  })().catch((error) => {
    bootPromise = null;
    engine = null;
    configuredGame = null;
    throw error;
  });
  await bootPromise;
}

self.addEventListener("message", async (event) => {
  const { id, game, state, level, maxTimeMs } = event.data || {};
  if (typeof id !== "number" || !state || !["chess", "xiangqi"].includes(game)) {
    self.postMessage({ id: null, ok: false, error: "engine worker 收到格式不正確的訊息" });
    return;
  }
  try {
    await ensureEngine(game);
    if (activeJob) throw new Error("引擎仍在計算上一手");
    engine.postMessage(`setoption name Skill Level value ${skillFor(level)}`);
    await commandUntil("isready", (line) => line === "readyok");
    activeJob = { id, game };
    engine.postMessage(`position fen ${stateToFen(game, state)}`);
    engine.postMessage(`go movetime ${Math.max(150, Math.floor(Number(maxTimeMs) || 1000))}`);
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error?.message || error) });
  }
});
