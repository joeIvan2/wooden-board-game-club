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

await check("所有退役自研搜尋、worker 與 AI CLI 都已移除", async () => {
  const retired = [
    "games/gomoku/ai-worker.mjs",
    "games/gomoku/gomoku-ai-v4-core.mjs",
    "games/gomoku/gomoku-ai-v4.mjs",
    "games/gomoku/gomoku-levels.mjs",
    "games/gomoku/gomoku-cli.mjs",
    "games/gomoku/gomoku-match.mjs",
    "games/gomoku/gomoku-tournament.mjs",
    "games/chess/chess-ai.mjs",
    "games/chess/chess-ai-worker.mjs",
    "games/xiangqi/xiangqi-ai.mjs",
    "games/xiangqi/xiangqi-ai-worker.mjs",
    "games/xiangqi/xiangqi-grandmaster-worker.js",
    "games/xiangqi/cli/xiangqi-cli.mjs",
  ];
  for (const path of retired) {
    await assert.rejects(access(join(ROOT, path)), `${path} should be retired`);
  }
});

await check("五子棋只接 Rapfi，西洋棋與象棋只接共用 Fairy-Stockfish", async () => {
  const [gomokuApp, rapfiWorker, chessApp, xiangqiApp, stockfishWorker] = await Promise.all([
    read("games/gomoku/app.js"),
    read("games/gomoku/rapfi-engine-worker.js"),
    read("games/chess/app.js"),
    read("games/xiangqi/app.js"),
    read("shared/stockfish-engine-worker.js"),
  ]);
  assert.match(gomokuApp, /rapfi-engine-worker\.js/);
  assert.doesNotMatch(gomokuApp, /gomoku-ai-v4|ai-worker\.mjs|fallback/);
  assert.match(rapfiWorker, /rapfi-single\.js/);
  assert.match(rapfiWorker, /START 15/);
  assert.match(rapfiWorker, /INFO RULE 0/);
  assert.match(rapfiWorker, /INFO STRENGTH/);
  assert.doesNotMatch(rapfiWorker, /gomoku-ai-v4/);
  for (const app of [chessApp, xiangqiApp]) {
    assert.match(app, /shared\/stockfish-engine-worker\.js/);
    assert.doesNotMatch(app, /chess-ai|xiangqi-ai|fallback/);
  }
  assert.match(stockfishWorker, /UCI_Variant/);
  assert.match(stockfishWorker, /setoption name Skill Level value/);
});

await check("發布清單僅含目前三款引擎所需資產", async () => {
  const build = await read("build-dist.mjs");
  for (const current of [
    "games/gomoku/rapfi-engine-worker.js",
    "games/gomoku/vendor/rapfi-classic-0.43.02/rapfi-single.wasm",
    "shared/stockfish-engine-worker.js",
    "games/xiangqi/vendor/fairy-stockfish-nnue-1.1.11/stockfish.wasm",
  ]) assert.match(build, new RegExp(current.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(build, /gomoku-ai-v4|chess-ai|xiangqi-ai|ai-worker\.mjs/);
});

console.log(`\n${passed} 引擎替換契約測試通過`);
