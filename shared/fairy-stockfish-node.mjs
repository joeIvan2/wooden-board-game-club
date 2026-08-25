/**
 * Node-only Fairy-Stockfish adapter for isolated engine matches.
 *
 * The shipped browser worker owns the interactive protocol.  This adapter uses
 * the exact same pinned Fairy-Stockfish WASM bundle, but exposes a small async
 * UCI interface to the CLI tournament runners.  It is deliberately not part of
 * the browser build.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const VENDOR_DIR = fileURLToPath(
  new URL("../games/xiangqi/vendor/fairy-stockfish-nnue-1.1.11/", import.meta.url),
);
const STOCKFISH_JS = join(VENDOR_DIR, "stockfish.js");
const STOCKFISH_WASM = join(VENDOR_DIR, "stockfish.wasm");
const STOCKFISH_WORKER = join(VENDOR_DIR, "stockfish.worker.js");
const SKILL_LEVELS = Object.freeze([0, 2, 4, 6, 8, 10, 12, 14, 17, 20]);

let cjsWorkerDir = null;
let cjsWorkerPath = null;

function skillFor(level) {
  const index = Math.max(1, Math.min(10, Math.trunc(Number(level) || 1))) - 1;
  return SKILL_LEVELS[index];
}

function normalizeEngineSkill(value, fallbackLevel) {
  if (Number.isFinite(value)) return Math.max(0, Math.min(20, Math.floor(value)));
  return skillFor(fallbackLevel);
}

function normalizeSearchDepth(value) {
  if (!Number.isInteger(value) || value < 1 || value > 99) return null;
  return value;
}

function normalizeNodeBudget(value) {
  if (!Number.isInteger(value) || value < 1) return null;
  return value;
}

function loadFactory() {
  const module = { exports: {} };
  const source = readFileSync(STOCKFISH_JS, "utf8");
  // The vendor bundle is published as CommonJS/browser glue.  Evaluating it in
  // a CommonJS-shaped function preserves its documented Node worker_threads
  // path even though this repository itself is ESM.
  const evaluate = new Function("require", "module", "exports", "__filename", "__dirname", source);
  const nativeRequire = createRequire(STOCKFISH_JS);
  evaluate(vendorRequire(nativeRequire), module, module.exports, STOCKFISH_JS, dirname(STOCKFISH_JS));
  if (typeof module.exports !== "function") {
    throw new Error("Fairy-Stockfish Node factory could not be loaded");
  }
  return module.exports;
}

function nodeCjsWorkerPath() {
  if (cjsWorkerPath) return cjsWorkerPath;
  cjsWorkerDir = mkdtempSync(join(tmpdir(), "wooden-board-game-club-fairy-"));
  cjsWorkerPath = join(cjsWorkerDir, "stockfish.worker.cjs");
  writeFileSync(cjsWorkerPath, readFileSync(STOCKFISH_WORKER));
  return cjsWorkerPath;
}

function vendorRequire(nativeRequire) {
  return (specifier) => {
    if (specifier !== "worker_threads") return nativeRequire(specifier);
    const workerThreads = nativeRequire(specifier);
    function CommonJsStockfishWorker(filename, options) {
      const target = String(filename).replace(/\\/g, "/").endsWith("/stockfish.worker.js")
        ? nodeCjsWorkerPath()
        : filename;
      return new workerThreads.Worker(target, options);
    }
    return { ...workerThreads, Worker: CommonJsStockfishWorker };
  };
}

process.once("exit", () => {
  if (cjsWorkerDir) rmSync(cjsWorkerDir, { recursive: true, force: true });
});

/**
 * One variant-specific UCI engine.  Fairy-Stockfish cannot safely change
 * variants after boot, so a caller chooses `chess` or `xiangqi` in `start`.
 */
export class FairyStockfishNode {
  #engine = null;
  #game = null;
  #commandWaiter = null;
  #moveWaiter = null;

  async start(game) {
    if (!["chess", "xiangqi"].includes(game)) {
      throw new Error(`Unsupported Fairy-Stockfish game: ${String(game)}`);
    }
    if (this.#engine) {
      if (this.#game !== game) throw new Error("A Fairy-Stockfish instance cannot change variants");
      return;
    }

    const Factory = loadFactory();
    const engine = await Factory({
      wasmBinary: readFileSync(STOCKFISH_WASM),
      locateFile: (asset) => join(VENDOR_DIR, asset),
      mainScriptUrlOrBlob: STOCKFISH_JS,
    });
    engine.addMessageListener((line) => this.#onLine(line));
    this.#engine = engine;
    try {
      await this.#commandUntil("uci", (line) => line === "uciok");
      this.#send(`setoption name UCI_Variant value ${game}`);
      this.#send("setoption name Threads value 1");
      this.#send("setoption name Hash value 32");
      await this.#commandUntil("isready", (line) => line === "readyok");
      this.#game = game;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async resetGame() {
    if (!this.#engine) return;
    if (this.#moveWaiter || this.#commandWaiter) throw new Error("Fairy-Stockfish cannot reset while a command is active");
    this.#send("ucinewgame");
    this.#send("setoption name Clear Hash");
    await this.#commandUntil("isready", (line) => line === "readyok");
  }

  async choose({ game, fen, level, movetimeMs, searchDepth, nodeBudget, engineSkill }) {
    await this.start(game);
    if (typeof fen !== "string" || !fen.trim()) throw new Error("Engine match needs a FEN position");
    if (this.#moveWaiter || this.#commandWaiter) throw new Error("Fairy-Stockfish command overlap");
    const movetime = Math.max(50, Math.floor(Number(movetimeMs) || 1000));
    const depth = normalizeSearchDepth(searchDepth);
    const nodes = depth ? null : normalizeNodeBudget(nodeBudget);
    const skill = normalizeEngineSkill(engineSkill, level);
    this.#send(`setoption name Skill Level value ${skill}`);
    await this.#commandUntil("isready", (line) => line === "readyok");

    // `go depth` and `go nodes` make an audit independent of host scheduling.
    // Product-parity matches deliberately retain movetime because that is what
    // the browser board ships to players.
    const searchCommand = depth ? `go depth ${depth}` : nodes ? `go nodes ${nodes}` : `go movetime ${movetime}`;
    const timeoutMs = depth || nodes
      ? Math.max(30_000, Math.ceil((nodes ?? depth * 50_000) / 10_000) * 1_000)
      : movetime + 15_000;

    const move = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.#moveWaiter?.timer !== timer) return;
        this.#moveWaiter = null;
        reject(new Error(`Fairy-Stockfish did not return a move within ${timeoutMs}ms`));
      }, timeoutMs);
      this.#moveWaiter = {
        timer,
        resolve: (bestmove) => {
          clearTimeout(timer);
          resolve(bestmove);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
    });
    this.#send(`position fen ${fen}`);
    this.#send(searchCommand);
    return move.finally(() => {
      this.#moveWaiter = null;
    });
  }

  async close() {
    const engine = this.#engine;
    this.#engine = null;
    this.#game = null;
    const commandWaiter = this.#commandWaiter;
    this.#commandWaiter = null;
    commandWaiter?.reject(new Error("Fairy-Stockfish was closed"));
    const moveWaiter = this.#moveWaiter;
    this.#moveWaiter = null;
    moveWaiter?.reject(new Error("Fairy-Stockfish was closed"));
    if (engine?.terminate) engine.terminate();
  }

  #send(command) {
    if (!this.#engine) throw new Error("Fairy-Stockfish has not started");
    this.#engine.postMessage(command);
  }

  #commandUntil(command, matches) {
    if (this.#commandWaiter) return Promise.reject(new Error("Fairy-Stockfish command overlap"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.#commandWaiter?.timer !== timer) return;
        this.#commandWaiter = null;
        reject(new Error(`Fairy-Stockfish did not acknowledge ${command}`));
      }, 15_000);
      this.#commandWaiter = {
        matches,
        timer,
        resolve: (line) => {
          clearTimeout(timer);
          resolve(line);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      this.#send(command);
    });
  }

  #onLine(rawLine) {
    const line = String(rawLine || "").trim();
    if (!line) return;
    const commandWaiter = this.#commandWaiter;
    if (commandWaiter?.matches(line)) {
      this.#commandWaiter = null;
      commandWaiter.resolve(line);
      return;
    }
    if (line.startsWith("bestmove") && this.#moveWaiter) {
      const match = /^bestmove\s+(\S+)/.exec(line);
      if (!match || match[1] === "(none)") {
        this.#moveWaiter.reject(new Error(`Fairy-Stockfish returned no move: ${line}`));
      } else {
        this.#moveWaiter.resolve(match[1]);
      }
    }
  }
}

export { skillFor, normalizeEngineSkill };
