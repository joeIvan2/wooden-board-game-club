/**
 * tests/cli.test.mjs — CLI 煙霧測試：help/levels/play/tournament。
 * 以子程序實際執行 node cli/xiangqi-cli.mjs，驗證結束碼與輸出內容。
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(ROOT, "cli", "xiangqi-cli.mjs");

function runCli(args, stdinText = "") {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    input: stdinText,
    encoding: "utf8",
    timeout: 120_000,
  });
}

let passed = 0;
function check(name, fn) {
  const result = fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
  return result;
}

check("help：正常結束且列出指令", () => {
  const r = runCli(["help"]);
  assert.equal(r.status, 0, r.stderr);
  for (const word of ["play", "tournament", "levels"]) {
    assert.ok(r.stdout.includes(word), `說明應包含 ${word}`);
  }
});

check("levels：列出 L1-L10 參數", () => {
  const r = runCli(["levels"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /L 1|L1/u);
  assert.match(r.stdout, /L10/u);
});

check("play：顯示棋盤與合法著法清單", () => {
  const r = runCli(["play"], "board\nmoves\nquit\n");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes("帥"), "棋盤應包含紅帥");
  assert.ok(r.stdout.includes("將"), "棋盤應包含黑將");
  assert.ok(r.stdout.includes("b3-e3"), "著法清單應含座標記法");
  assert.ok(r.stdout.includes("炮二平五"), "著法清單應含中文記法");
});

check("play：接受座標走子並讓 AI 回合，認輸後正常結束", () => {
  const r = runCli(["play", "--level", "2"], "m b3-e3\nstatus\nresign\nquit\n");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes("你落子"), "應確認玩家落子");
  assert.ok(r.stdout.includes("AI 落子") || r.stdout.includes("思考中"), "AI 應有回應");
  assert.ok(r.stdout.includes("終局"), "認輸應產生終局訊息");
});

check("play：無效著法會被拒絕且不中斷", () => {
  const r = runCli(["play"], "m e3-h3\nmoves h3\nquit\n");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes("無效"), "應提示無效著法");
});

check("tournament：L1 vs L2 一輪兩局，輸出戰績表", () => {
  const r = runCli([
    "tournament", "--a", "1", "--b", "2",
    "--rounds", "1", "--max-plies", "48",
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes("第1局"));
  assert.ok(r.stdout.includes("第2局"));
  assert.ok(r.stdout.includes("最終積分"));
  assert.ok(r.stdout.includes("L1") && r.stdout.includes("L2"));
}, );

check("tournament：verbose 模式逐手記錄", () => {
  const r = runCli([
    "tournament", "--a", "1", "--b", "1",
    "--rounds", "1", "--max-plies", "24", "--verbose",
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(" 1."), "verbose 應印出手數");
});

console.log(`\ncli：${passed} 項全數通過`);
