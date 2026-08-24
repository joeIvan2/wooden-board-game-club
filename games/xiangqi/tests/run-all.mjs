/**
 * tests/run-all.mjs — 依序執行全部測試檔並彙整結果。
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SUITES = [
  "rules-special.test.mjs",
  "endgame.test.mjs",
  "ai.test.mjs",
  "terminal-render.test.mjs",
  "cli.test.mjs",
  "frontend.test.mjs",
];

const failures = [];
for (const suite of SUITES) {
  console.log(`\n=== ${suite} ===`);
  const result = spawnSync(process.execPath, [join(ROOT, suite)], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 300_000,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    failures.push(suite);
    console.log(`--- ${suite} 失敗 ---`);
  }
}

console.log("\n========================================");
if (failures.length) {
  console.log(`失敗套件：${failures.join("、")}`);
  process.exitCode = 1;
} else {
  console.log(`全部 ${SUITES.length} 個測試套件通過。`);
}
