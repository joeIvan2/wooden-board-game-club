import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const suites = [
  "tests/platform.test.mjs",
  "games/gomoku/gomoku-rules.test.mjs",
  "tests/engine-runtime-contract.test.mjs",
  "games/chess/chess-rules.test.mjs",
  "games/chess/chess-notation.test.mjs",
  "games/chess/community-game.test.mjs",
  "games/chess/app.test.mjs",
  "games/xiangqi/tests/run-all.mjs",
  "leaderboard-api.test.mjs"
];

for (const suite of suites) {
  console.log(`\n=== ${suite} ===`);
  const result = spawnSync(process.execPath, [join(ROOT, suite)], { cwd: ROOT, encoding: "utf8", timeout: 180_000 });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("\n========================================");
console.log(`${suites.length} 個測試套件全數通過。`);
