import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFile(join(ROOT, path), "utf8");
let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

await check("五子棋全等級都保留 V4 Pattern 模組", async () => {
  for (const path of [
    "games/gomoku/ai-worker.mjs",
    "games/gomoku/gomoku-levels.mjs",
    "games/gomoku/gomoku-ai-v4.mjs",
    "games/gomoku/gomoku-ai-v4-core.mjs",
  ]) await assert.doesNotReject(access(join(ROOT, path)));
  const app = await read("games/gomoku/app.js");
  assert.match(app, /from "\.\/gomoku-levels\.mjs"/);
  assert.match(app, /new URL\("\.\/ai-worker\.mjs", import\.meta\.url\)/);
  assert.doesNotMatch(app, /rapfi-engine-worker/);
});

await check("西洋棋與中國象棋依等級固定選擇引擎，而非失敗 fallback", async () => {
  const [chessApp, xiangqiApp, chessWorker, xiangqiWorker, stockfishWorker] = await Promise.all([
    read("games/chess/app.js"),
    read("games/xiangqi/app.js"),
    read("games/chess/chess-ai-worker.mjs"),
    read("games/xiangqi/xiangqi-ai-worker.mjs"),
    read("shared/stockfish-engine-worker.js"),
  ]);
  for (const app of [chessApp, xiangqiApp]) {
    assert.match(app, /solveLevel <= 5 \? "classic" : "fairy"/);
    assert.match(app, /shared\/stockfish-engine-worker\.js/);
  }
  assert.match(chessApp, /\.\/chess-ai-worker\.mjs/);
  assert.match(xiangqiApp, /\.\/xiangqi-ai-worker\.mjs/);
  assert.match(chessWorker, /from "\.\/chess-ai\.mjs"/);
  assert.match(xiangqiWorker, /from "\.\/xiangqi-ai\.mjs"/);
  assert.match(stockfishWorker, /UCI_Variant/);
  assert.match(stockfishWorker, /setoption name Skill Level value/);
  assert.doesNotMatch(chessApp + xiangqiApp, /viaLocal|\.catch\([^)]*chooseMove/);
});

await check("發布清單只帶入目前分流所需的 worker 與模組", async () => {
  const build = await read("build-dist.mjs");
  for (const path of [
    "games/gomoku/ai-worker.mjs",
    "games/gomoku/gomoku-levels.mjs",
    "games/gomoku/gomoku-ai-v4.mjs",
    "games/chess/chess-ai-worker.mjs",
    "games/xiangqi/xiangqi-ai-worker.mjs",
    "shared/stockfish-engine-worker.js",
  ]) assert.ok(build.includes(path), `build missing ${path}`);
  assert.doesNotMatch(build, /rapfi-engine-worker|rapfi-single\.wasm|gomoku-engine-levels/);
});

console.log(`\n${passed} 等級分流引擎契約測試通過`);
