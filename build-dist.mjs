import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const DIST = join(ROOT, "dist");
if (relative(ROOT, DIST) !== "dist") throw new Error("dist path escaped the project root");

const assets = [
  "index.html",
  "styles/platform.css",
  "shared/game-registry.mjs",
  "shared/match-adapter.mjs",
  "shared/leaderboard.mjs",
  "shared/platform-nav.mjs",
  "shared/mobile-board-actions.mjs",
  "games/gomoku/index.html",
  "games/gomoku/game.css",
  "games/gomoku/app.js",
  "games/gomoku/ai-worker.mjs",
  "games/gomoku/gomoku-ai-v4-core.mjs",
  "games/gomoku/gomoku-ai-v4.mjs",
  "games/gomoku/gomoku-levels.mjs",
  "games/gomoku/gomoku-rules.mjs",
  "games/chess/index.html",
  "games/chess/styles.css",
  "games/chess/app.js",
  "games/chess/chess.mjs",
  "games/chess/chess-ai.mjs",
  "games/chess/chess-ai-worker.mjs",
  "games/chess/chess-notation.mjs",
  "games/chess/community-game.mjs",
  "games/xiangqi/index.html",
  "games/xiangqi/css/style.css",
  "games/xiangqi/app.js",
  "games/xiangqi/xiangqi-rules.mjs",
  "games/xiangqi/xiangqi-ai.mjs",
  "games/xiangqi/xiangqi-ai-worker.mjs",
  "games/xiangqi/xiangqi-notation.mjs",
  "games/xiangqi/terminal-render.mjs"
];

await rm(DIST, { recursive: true, force: true });
for (const asset of assets) {
  const destination = join(DIST, asset);
  await mkdir(dirname(destination), { recursive: true });
  await cp(join(ROOT, asset), destination);
}
console.log(`dist ready: ${assets.length} browser assets`);
