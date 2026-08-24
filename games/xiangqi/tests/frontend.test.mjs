/**
 * tests/frontend.test.mjs — 前端語法與結構測試：
 * 1) 所有 JS 以 node --check 驗證語法（ESM）。
 * 2) index.html 具備 app.js 所需的全部元素 id。
 * 3) Worker 與 CLI 確實共用同一套規則/AI 模組。
 * 4) 無任何外部網路資源引用（零連線）。
 * 5) CSS 具備 reduced-motion、focus-visible、44px 觸控目標與響應式。
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFile(join(ROOT, rel), "utf8");

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const JS_FILES = [
  "app.js",
  "serve.mjs",
  "xiangqi-rules.mjs",
  "xiangqi-ai.mjs",
  "xiangqi-notation.mjs",
  "terminal-render.mjs",
  "xiangqi-ai-worker.mjs",
  "cli/xiangqi-cli.mjs",
  "tests/helpers.mjs",
  "tests/run-all.mjs",
];

await check("所有 JS 檔案通過 node --check（ESM 語法）", async () => {
  for (const rel of JS_FILES) {
    const result = spawnSync(process.execPath, ["--check", join(ROOT, rel)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${rel} 語法錯誤：\n${result.stderr}`);
  }
});

await check("index.html、css/style.css、README.md 皆存在", async () => {
  for (const rel of ["index.html", "css/style.css", "README.md"]) {
    await assert.doesNotReject(() => access(join(ROOT, rel)), `${rel} 不存在`);
  }
});

const html = await read("index.html");
const css = await read("css/style.css");
const appJs = await read("app.js");

await check("app.js 引用的所有元素 id 都存在於 index.html", async () => {
  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const wanted = [...appJs.matchAll(/\$\("([\w-]+)"\)/g)].map((m) => m[1]);
  assert.ok(wanted.length >= 20, `應偵測到多個元素引用，實得 ${wanted.length}`);
  const missing = [...new Set(wanted)].filter((id) => !htmlIds.has(id));
  assert.deepEqual(missing, [], `缺少的 id：${missing.join("、")}`);
});

await check("HTML 基本結構：module script、樣式表、語言、視口、無障礙錨點", async () => {
  assert.match(html, /<html lang="zh-Hant">/);
  assert.match(html, /<meta charset="utf-8"/);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /<script type="module" src="\.\/app\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\.\/css\/style\.css" \/>/);
  assert.match(html, /role="grid"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /class="skip-link"/);
});

await check("Worker 鏈：app.js 以 module Worker 載入 worker，worker 與 CLI 共用規則/AI", async () => {
  assert.match(appJs, /new Worker\(new URL\("\.\/xiangqi-ai-worker\.mjs", import\.meta\.url\), \{ type: "module" \}\)/);
  const worker = await read("xiangqi-ai-worker.mjs");
  assert.match(worker, /from "\.\/xiangqi-ai\.mjs"/);
  const ai = await read("xiangqi-ai.mjs");
  assert.match(ai, /from "\.\/xiangqi-rules\.mjs"/);
  const cli = await read("cli/xiangqi-cli.mjs");
  assert.match(cli, /from "\.\.\/xiangqi-rules\.mjs"/);
  assert.match(cli, /from "\.\.\/xiangqi-ai\.mjs"/);
  assert.match(cli, /from "\.\.\/xiangqi-notation\.mjs"/);
});

await check("規則引擎輸出 API 完整（規則/終局/Perft 皆可呼叫）", async () => {
  const rules = await import("../xiangqi-rules.mjs");
  for (const fn of [
    "createInitialState", "getLegalMoves", "getLegalMovesFrom", "applyMove",
    "getGameStatus", "isInCheck", "perft", "pieceGlyph", "isKingAttacked",
  ]) {
    assert.equal(typeof rules[fn], "function", `缺少輸出 ${fn}`);
  }
  const notation = await import("../xiangqi-notation.mjs");
  for (const fn of ["formatChineseMove", "formatCoordinateMove", "parseMoveText"]) {
    assert.equal(typeof notation[fn], "function");
  }
});

await check("零外部連線：HTML/CSS/JS 無任何 http(s) 資源或匯入", async () => {
  const files = ["index.html", "css/style.css", "app.js", "xiangqi-ai-worker.mjs", "cli/xiangqi-cli.mjs"];
  for (const rel of files) {
    const text = await read(rel);
    const external = text.match(/(?:src|href)="https?:|url\(\s*["']?https?:|from\s+["']https?:/);
    assert.equal(external, null, `${rel} 出現外部資源引用`);
  }
});

await check("CSS：深木主題變數、reduced-motion、focus-visible、44px 觸控、響應式", async () => {
  assert.match(css, /--vermilion/);
  assert.match(css, /--jade/);
  assert.match(css, /--wood-900/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /44px/);
  assert.match(css, /\.board-square/);
  assert.match(css, /@media \(max-width/);
});

await check("棋盤格線完整且疊在木紋上、互動格下", async () => {
  const svg = html.match(/<svg id="grid-lines"[\s\S]*?<\/svg>/)?.[0];
  assert.ok(svg, "缺少 #grid-lines SVG");
  assert.match(svg, /viewBox="0 0 90 100"/);
  assert.match(svg, /\bwidth="450"/);
  assert.match(svg, /\bheight="500"/);
  assert.match(svg, /楚　河/);
  assert.match(svg, /漢　界/);

  const lines = [...svg.matchAll(/<line\s+([^>]+)>/g)].map(([, attrs]) => {
    const number = (name) => Number(attrs.match(new RegExp(`${name}="([\\d.]+)"`))?.[1]);
    return { x1: number("x1"), y1: number("y1"), x2: number("x2"), y2: number("y2") };
  });
  const horizontal = lines.filter((line) => line.y1 === line.y2);
  const vertical = lines.filter((line) => line.x1 === line.x2);
  const diagonal = lines.filter((line) => line.x1 !== line.x2 && line.y1 !== line.y2);
  assert.deepEqual(horizontal.map((line) => line.y1), [5, 15, 25, 35, 45, 55, 65, 75, 85, 95]);
  assert.deepEqual([...new Set(vertical.map((line) => line.x1))].sort((a, b) => a - b), [5, 15, 25, 35, 45, 55, 65, 75, 85]);
  assert.equal(vertical.filter((line) => line.x1 === 5 || line.x1 === 85).length, 2, "兩側邊線應保持連續");
  assert.equal(vertical.filter((line) => line.x1 > 5 && line.x1 < 85).length, 14, "內部七路應在楚河漢界中斷");
  assert.equal(diagonal.length, 4, "上下九宮各需兩條斜線");

  const rule = (selector) => css.match(new RegExp(`${selector}\\s*\\{[^}]+\\}`))?.[0] ?? "";
  assert.match(rule("\\.board-shell"), /isolation:\s*isolate/);
  assert.match(rule("\\.grid-lines"), /z-index:\s*1/);
  assert.match(rule("\\.grid-lines"), /pointer-events:\s*none/);
  assert.match(rule("\\.board-square"), /z-index:\s*2/);
});

await check("README 涵蓋啟動、CLI、測試與 AI 等級說明", async () => {
  const readme = await read("README.md");
  assert.match(readme, /serve\.mjs/);
  assert.match(readme, /tournament/);
  assert.match(readme, /npm (run )?test|node tests\/run-all\.mjs/);
  assert.match(readme, /L10/);
});

console.log(`\nfrontend：${passed} 項全數通過`);
