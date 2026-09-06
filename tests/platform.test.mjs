import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { GAME_REGISTRY, getGameDefinition } from "../shared/game-registry.mjs";
import { createMatchAdapter, LocalMatchAdapter, RemoteMatchAdapter } from "../shared/match-adapter.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFile(join(ROOT, path), "utf8");
let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

await check("平台登錄三款遊戲與正確棋盤尺寸", async () => {
  assert.deepEqual(GAME_REGISTRY.map((game) => game.id), ["gomoku", "chess", "xiangqi"]);
  assert.deepEqual(getGameDefinition("gomoku").board, { rows: 15, columns: 15 });
  assert.deepEqual(getGameDefinition("chess").board, { rows: 8, columns: 8 });
  assert.deepEqual(getGameDefinition("xiangqi").board, { rows: 10, columns: 9 });
});

await check("首頁與三個遊戲頁共用平台導覽", async () => {
  for (const [path, id] of [["index.html", "home"], ["games/gomoku/index.html", "gomoku"], ["games/chess/index.html", "chess"], ["games/xiangqi/index.html", "xiangqi"]]) {
    const html = await read(path);
    assert.match(html, new RegExp(`data-game="${id}"`));
    assert.match(html, /<game-platform-nav><\/game-platform-nav>/);
    assert.match(html, /platform\.css/);
  }
  const nav = await read("shared/platform-nav.mjs");
  assert.match(nav, /aria-current="page"/);
  assert.match(nav, /本機對局/);
  assert.match(nav, /https:\/\/assemble-human\.pages\.dev\//);
  assert.match(nav, /https:\/\/abyssal-hunt\.pages\.dev\//);
  assert.match(nav, /target="_blank" rel="noopener noreferrer"/);
});

await check("五子棋已完全改為 2D 且保留 15×15 無障礙棋盤", async () => {
  const html = await read("games/gomoku/index.html");
  const app = await read("games/gomoku/app.js");
  const css = await read("games/gomoku/game.css");
  assert.doesNotMatch(html + app, /three(?:\.module)?|OrbitControls|WebGLRenderer|importmap/i);
  assert.match(html, /aria-rowcount="15"/);
  assert.match(html, /aria-colcount="15"/);
  assert.match(app, /index < CELLS/);
  assert.match(css, /grid-template-columns:\s*repeat\(15/);
  assert.match(css, /z-index:\s*1/);
  assert.match(css, /z-index:\s*2/);
  assert.match(app, /indexFromPointer/);
  assert.match(app, /pointerdown/);
  assert.match(app, /pointercancel/);
  assert.match(css, /touch-action:\s*pan-y pinch-zoom/);
  assert.doesNotMatch(css, /gomoku-point::after[^{]*\{[^}]*44px/s);
  assert.match(css, /--gomoku-cell:\s*min\(24px/);
  assert.match(css, /\.gomoku-frame\s*\{\s*padding:\s*6px;\s*overflow-x:\s*hidden;/);
});

await check("設計系統符合原木 2D、響應式與 reduced-motion 規範", async () => {
  const css = await read("styles/platform.css");
  const master = await read("design-system/原木棋社/MASTER.md");
  for (const token of ["--walnut-950", "--maple-300", "--brass-400", "--paper-100", "--vermilion-500", "--jade-500"]) assert.match(css, new RegExp(token));
  assert.match(css, /@media \(max-width: 600px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(master, /全 2D/);
  assert.match(master, /不使用玻璃擬態/);
});

await check("連線 adapter 明確區分可用本機與尚未開放遠端模式", async () => {
  const local = createMatchAdapter("gomoku");
  assert.ok(local instanceof LocalMatchAdapter);
  assert.equal(local.status, "ready");
  const remote = createMatchAdapter("gomoku", "remote");
  assert.ok(remote instanceof RemoteMatchAdapter);
  assert.equal(remote.status, "unavailable");
  assert.throws(() => remote.connect(), /尚未啟用/);
});

await check("三款遊戲共用 L6-L10 勝局登記、等級篩選與最少步數排行榜", async () => {
  for (const path of ["games/gomoku/index.html", "games/chess/index.html", "games/xiangqi/index.html"]) {
    const html = await read(path);
    for (const id of ["record-panel", "record-name", "record-submit", "leaderboard-levels", "leaderboard-body"]) {
      assert.match(html, new RegExp(`id="${id}"`), `${path} missing ${id}`);
    }
    assert.match(html, /L6–L10/);
    assert.match(html, /總步數越少排名越前/);
  }
  const controller = await read("shared/leaderboard.mjs");
  assert.match(controller, /\[6, 7, 8, 9, 10\]/);
  assert.match(controller, /game,\s*level:\s*pending\.level,\s*displayName,\s*moves:/s);
  const css = await read("styles/platform.css");
  assert.match(css, /\.leaderboard-level\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /\.leaderboard-table-wrap\s*\{[^}]*overflow-x:\s*auto/s);
});

console.log(`\nplatform：${passed} 項全數通過`);
