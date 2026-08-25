/**
 * tests/ai.test.mjs — AI 合法性、決定性、戰術能力與自我對弈煙霧測試。
 */

import assert from "node:assert/strict";
import {
  createInitialState,
  getLegalMoves,
  getGameStatus,
  applyMove,
} from "../xiangqi-rules.mjs";
import { chooseMove, levelConfig, MIN_LEVEL, MAX_LEVEL } from "../xiangqi-ai.mjs";
import { emptyState } from "./helpers.mjs";

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function moveKey(move) {
  return `${move.from.row},${move.from.col}>${move.to.row},${move.to.col}`;
}

check("L1-L10 從初始局面都只回傳合法著法", () => {
  const state = createInitialState();
  const legal = new Set(getLegalMoves(state).map(moveKey));
  for (let level = MIN_LEVEL; level <= MAX_LEVEL; level += 1) {
    const { move } = chooseMove(state, level);
    assert.ok(move, `L${level} 應有著法`);
    assert.ok(legal.has(moveKey(move)), `L${level} 著法必須合法`);
  }
});

check("L1-L10 同輸入必得同輸出（deterministic）", () => {
  const state = createInitialState();
  for (let level = MIN_LEVEL; level <= MAX_LEVEL; level += 1) {
    const first = chooseMove(state, level);
    const second = chooseMove(state, level);
    assert.deepEqual(
      first.move && moveKey(first.move),
      second.move && moveKey(second.move),
      `L${level} 兩次結果應一致`,
    );
    assert.equal(first.meta.score, second.meta.score);
    assert.equal(first.meta.nodes, second.meta.nodes);
  }
});

check("戰術：無保護黑車可被白吃時，L1-L10 都會吃車", () => {
  // 紅炮(7,4)、紅兵(6,4)為炮架、黑車(3,4)懸空無保護。
  const state = emptyState({
    turn: "red",
    redKing: { row: 9, col: 3 },
    blackKing: { row: 0, col: 5 },
    placements: [
      [7, 4, "red", "cannon"],
      [6, 4, "red", "soldier"],
      [3, 4, "black", "rook"],
    ],
  });
  for (let level = MIN_LEVEL; level <= MAX_LEVEL; level += 1) {
    const { move } = chooseMove(state, level);
    assert.ok(move, `L${level} 應有著法`);
    assert.equal(move.to.row, 3, `L${level} 应回應吃車`);
    assert.equal(move.to.col, 4);
  }
});

check("搜尋等級表：深度與節點預算單調不減，且夾擊範圍正確", () => {
  let lastDepth = 0;
  let lastNodes = 0;
  for (let level = MIN_LEVEL; level <= MAX_LEVEL; level += 1) {
    const cfg = levelConfig(level);
    assert.ok(cfg.depth >= lastDepth);
    assert.ok(cfg.maxNodes >= lastNodes);
    lastDepth = cfg.depth;
    lastNodes = cfg.maxNodes;
  }
  assert.equal(levelConfig(-5).depth, levelConfig(MIN_LEVEL).depth);
  assert.equal(levelConfig(99).depth, levelConfig(MAX_LEVEL).depth);
});

check("L7-L10：換位表、應將靜態搜尋與資源上限皆逐級啟用", () => {
  let previousTableSize = 0;
  let previousQuiescence = 0;
  for (let level = 7; level <= 10; level += 1) {
    const cfg = levelConfig(level);
    assert.equal(cfg.checkAwareQuiescence, true, `L${level} 應處理葉節點被將軍`);
    assert.ok(cfg.ttEntries > previousTableSize, `L${level} 換位表容量應遞增`);
    assert.ok(cfg.quiescence > previousQuiescence, `L${level} 靜態搜尋深度應遞增`);
    previousTableSize = cfg.ttEntries;
    previousQuiescence = cfg.quiescence;
  }
});

check("L7-L10：固定局面實際命中換位表，且維持合法與確定性", () => {
  const state = createInitialState();
  const legal = new Set(getLegalMoves(state).map(moveKey));
  for (let level = 7; level <= 10; level += 1) {
    const first = chooseMove(state, level);
    const second = chooseMove(state, level);
    assert.ok(first.move && legal.has(moveKey(first.move)), `L${level} 必須走合法著法`);
    assert.equal(moveKey(first.move), moveKey(second.move), `L${level} 必須可重現`);
    assert.ok(first.meta.ttHits > 0, `L${level} 應重用換位局面`);
    assert.ok(first.meta.ttCutoffs > 0, `L${level} 應由換位表產生剪枝`);
  }
});

check("自我對弈煙霧測試：L3 對 L3 走 40 半回合，每步皆合法且無例外", () => {
  let state = createInitialState();
  for (let ply = 1; ply <= 40; ply += 1) {
    const legal = new Set(getLegalMoves(state).map(moveKey));
    const level = state.turn === "red" ? 3 : 3;
    const { move } = chooseMove(state, level);
    assert.ok(move && legal.has(moveKey(move)), `第${ply}手必須合法`);
    state = applyMove(state, move);
    if (getGameStatus(state).status !== "ongoing") break;
  }
});

check("長對局：L5 對 L2 走到分出勝負或 60 半回合上限，全程合法", () => {
  let state = createInitialState();
  let plies = 0;
  while (plies < 60) {
    const legal = new Set(getLegalMoves(state).map(moveKey));
    const { move } = chooseMove(state, state.turn === "red" ? 5 : 2);
    assert.ok(move && legal.has(moveKey(move)));
    state = applyMove(state, move);
    plies += 1;
    if (getGameStatus(state).status !== "ongoing") break;
  }
  assert.ok(plies >= 2);
});

console.log(`\nai：${passed} 項全數通過`);

