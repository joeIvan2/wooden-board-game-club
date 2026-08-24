/**
 * tests/rules-special.test.mjs — 規則特殊例：各兵種幾何、河界九宮、
 * 炮架、馬腿、象眼、照面、自陷將軍防護、困斃語意與盤面不可變性。
 */

import assert from "node:assert/strict";
import {
  createInitialState,
  getLegalMoves,
  getLegalMovesFrom,
  getGameStatus,
  applyMove,
  perft,
  isInCheck,
} from "../xiangqi-rules.mjs";
import { emptyState, applyCoordinateSequence, coordinateSet, legalCountByType, squareIccs } from "./helpers.mjs";

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

/* ---------------- 初始局面 ---------------- */

check("初始局面：紅方合法著法共 44 著（逐兵種核對，與公開 Perft 值一致）", () => {
  const state = createInitialState();
  const counts = legalCountByType(state, "red");
  assert.deepEqual(counts, {
    rook: 4,      // 車被自己的兵擋住，各只有兩步直進
    horse: 4,     // 馬腿被相/車蹩住側向
    elephant: 4,
    advisor: 2,
    general: 1,
    cannon: 24,   // 每門炮 12 著：橫6、沿己兵空檔直進4、隔黑砲架吃底馬1、退1
    soldier: 5,
  });
  assert.equal(getLegalMoves(state).length, 44);
});

check("初始局面：狀態為 ongoing 且無將軍", () => {
  const status = getGameStatus(createInitialState());
  assert.equal(status.status, "ongoing");
  assert.equal(status.inCheck, false);
  assert.equal(status.winner, null);
});

check("初始局面：炮隔黑砲架吃底馬（b3-b10）存在；平炮（b3-e3）存在", () => {
  const moves = coordinateSet(createInitialState(), "red");
  assert.ok(moves.has("b3-b10"), "應隔 (2,1) 黑砲架吃 (0,1) 馬");
  assert.ok(moves.has("b3-b7"), "(3,1) 為空點，直進安靜著");
  assert.ok(moves.has("b3-e3"));
  assert.ok(moves.has("h3-e3"));
});

check("Perft(1)=44，且 Perft(2) 在合理區間", () => {
  const state = createInitialState();
  assert.equal(perft(state, 1), 44);
  const d2 = perft(state, 2);
  assert.ok(d2 > 1500 && d2 < 2100, `perft(2)=${d2}`);
});

/* ---------------- 馬腿 ---------------- */

check("馬腿：起點馬不能側跳（被相同底的相蹩腿），但可向前兩處日字", () => {
  const state = createInitialState();
  const horseMoves = getLegalMovesFrom(state, 9, 1).map((m) => squareIccs(m.to));
  assert.deepEqual(horseMoves.sort(), ["a3", "c3"]);
  assert.ok(!horseMoves.includes("d4"), "側向被相蹩腿");
});

check("馬腿：正上方有子時不能往上跳日字", () => {
  const state = emptyState({
    placements: [[5, 4, "red", "horse"], [4, 4, "red", "soldier"]],
  });
  const targets = getLegalMovesFrom(state, 5, 4).map((m) => squareIccs(m.to));
  assert.ok(!targets.includes("d7")); // 上跳日字被 (4,4) 蹩腿
  assert.ok(!targets.includes("f7"));
  assert.ok(targets.includes("c6") && targets.includes("g6"));
});

/* ---------------- 象眼與河界 ---------------- */

check("象眼：塞象眼時該方向不可走，另一方向正常", () => {
  const state = emptyState({
    placements: [
      [5, 2, "red", "elephant"],
      [6, 3, "red", "soldier"], // 塞往 (7,4) 的象眼
    ],
  });
  // 相在 c5（row5,col2）：退 a3=(7,0)、e3=(7,4)；iccs 列號 = 10 − row
  const targets = getLegalMovesFrom(state, 5, 2).map((m) => squareIccs(m.to));
  assert.ok(targets.includes("a3"));
  assert.ok(!targets.includes("e3"));
});

check("象不可過河：紅象在河邊只能走己方半場的田字", () => {
  const state = emptyState({
    placements: [[5, 4, "red", "elephant"]],
  });
  // 相在 e5：只能退到 c3、g3（row 7），不得越河進入 row ≤ 4
  const targets = getLegalMovesFrom(state, 5, 4).map((m) => squareIccs(m.to));
  assert.deepEqual(targets.sort(), ["c3", "g3"]);
});

/* ---------------- 兵卒與河界 ---------------- */

check("兵：過河前只能前進；過河後可橫移；永不後退", () => {
  let state = createInitialState();
  assert.deepEqual(
    getLegalMovesFrom(state, 6, 0).map((m) => squareIccs(m.to)),
    ["a5"],
  );
  state = applyCoordinateSequence(state, ["a4-a5"]);
  assert.deepEqual(
    getLegalMovesFrom(state, 5, 0, "red").map((m) => squareIccs(m.to)),
    ["a6"],
    "尚未過河（row5）仍只能前進",
  );
  state = applyCoordinateSequence(state, ["a5-a6"]);
  const crossed = getLegalMovesFrom(state, 4, 0, "red").map((m) => squareIccs(m.to)).sort();
  assert.deepEqual(crossed, ["a7", "b6"], "過河後可進可平");
  // 驗證永不後退
  assert.ok(!crossed.includes("a5"));
});

check("兵到底線：只剩橫移", () => {
  const state = emptyState({
    redKing: { row: 9, col: 3 },
    blackKing: { row: 1, col: 5 },
    placements: [[0, 4, "red", "soldier"]],
  });
  const targets = getLegalMovesFrom(state, 0, 4).map((m) => squareIccs(m.to)).sort();
  assert.deepEqual(targets, ["d10", "f10"]);
});

/* ---------------- 九宮 ---------------- */

check("九宮：帥不出九宮、士斜行不出九宮", () => {
  const state = emptyState({
    redKing: { row: 7, col: 4 },
    blackKing: { row: 0, col: 5 },
    // 黑卒站在四路上，避免照面規則吃掉帥往 f3 的合法著法
    placements: [[4, 5, "black", "soldier"]],
  });
  // 帥在 e3：(8,4)=e2、(7,3)=d3、(7,5)=f3
  const kingTargets = getLegalMovesFrom(state, 7, 4).map((m) => squareIccs(m.to)).sort();
  assert.deepEqual(kingTargets, ["d3", "e2", "f3"]);
  const advisorState = emptyState({
    placements: [
      [7, 4, "red", "advisor"],
      [4, 5, "black", "soldier"],
    ],
    redKing: { row: 9, col: 4 },
    blackKing: { row: 0, col: 5 },
  });
  // 士在 e3：只能斜到 (8,3)=d2、(8,5)=f2
  const advisorTargets = getLegalMovesFrom(advisorState, 7, 4).map((m) => squareIccs(m.to)).sort();
  assert.deepEqual(advisorTargets, ["d2", "f2"]);
});

/* ---------------- 照面與自陷 ---------------- */

check("將帥照面：同路無隔子即視同被攻擊", () => {
  const state = emptyState({
    redKing: { row: 9, col: 4 },
    blackKing: { row: 0, col: 4 },
  });
  assert.equal(isInCheck(state, "red"), true);
  assert.equal(isInCheck(state, "black"), true);
});

check("照面防護：只有能解除照面的著法合法（墊子沿同路移動），他子皆非法", () => {
  const state = emptyState({
    redKing: { row: 9, col: 4 },
    blackKing: { row: 0, col: 4 },
    placements: [
      [5, 4, "red", "rook"],
      [3, 0, "red", "soldier"],
    ],
  });
  const moves = coordinateSet(state, "red");
  // 他子移動不解除照面 → 全部非法
  assert.ok(!moves.has("a6-a5"));
  // 墊子在四路上移動仍隔開二帥 → 合法；平開即非法
  assert.ok(moves.has("e5-e4"));
  assert.ok(moves.has("e5-e6"));
  assert.ok(!moves.has("e5-d5"));
  assert.ok(!moves.has("e5-f5"));
});

check("牽制：被牽制的車目前未被將軍，但平開即自陷被車將", () => {
  const state = emptyState({
    redKing: { row: 9, col: 4 },
    blackKing: { row: 0, col: 3 },
    placements: [
      [0, 4, "black", "rook"],
      [5, 4, "red", "rook"],
    ],
  });
  // 紅車仍在四路上墊著 → 紅帥此刻並未被將軍（牽制，非照面）
  assert.equal(isInCheck(state, "red"), false, "墊子未離開前不應被將軍");
  const moves = coordinateSet(state, "red");
  assert.ok(!moves.has("e5-d5"), "平開會暴露紅帥 → 非法");
  assert.ok(!moves.has("e5-f5"), "平開會暴露紅帥 → 非法");
  assert.ok(moves.has("e5-e6"), "沿四路上行仍隔開二王/車 → 合法");
  assert.ok(moves.has("e5-e4"), "沿四路下行仍隔開攻擊線 → 合法");
  assert.ok(moves.has("e5-e10"), "吃掉牽制來源黑車後不再有攻擊 → 合法");

  // 反證：一旦墊子消失，紅帥立刻被同一隻黑車將軍
  const exposed = emptyState({
    redKing: { row: 9, col: 4 },
    blackKing: { row: 0, col: 3 },
    placements: [[0, 4, "black", "rook"]],
  });
  assert.equal(isInCheck(exposed, "red"), true, "無墊子時黑車確實將軍紅帥");
});

/* ---------------- 炮架 ---------------- */

check("炮：無架不能吃、單架才能吃、雙架又不能吃", () => {
  const base = {
    redKing: { row: 9, col: 3 },
    blackKing: { row: 0, col: 5 },
  };
  // 無架：敵車緊鄰正上方，既不可平移上去也不可吃
  const noScreen = emptyState({ ...base, placements: [[5, 4, "red", "cannon"], [4, 4, "black", "rook"]] });
  let moves = coordinateSet(noScreen, "red");
  assert.ok(!moves.has("e5-e6"));

  // 單架：隔一個炮架可以吃（炮 e5、架 e7、黑車 e9）
  const oneScreen = emptyState({
    ...base,
    placements: [[5, 4, "red", "cannon"], [3, 4, "red", "soldier"], [1, 4, "black", "rook"]],
  });
  moves = coordinateSet(oneScreen, "red");
  assert.ok(moves.has("e5-e6"), "炮架前可直行");
  assert.ok(moves.has("e5-e9"), "隔一架吃車");
  assert.ok(!moves.has("e5-e7"), "不可落在炮架上");

  // 雙架：兩個遮蔽子之後不能吃
  const twoScreens = emptyState({
    ...base,
    placements: [[5, 4, "red", "cannon"], [3, 4, "red", "soldier"], [2, 4, "red", "soldier"], [1, 4, "black", "rook"]],
  });
  moves = coordinateSet(twoScreens, "red");
  assert.ok(!moves.has("e5-e9"));
});

/* ---------------- 困斃語意 ---------------- */

check("困斃：無子可動且未被將軍 → 行棋方判負（非和局）", () => {
  // 黑帥(0,4)；雙紅馬佔 (0,3)(0,5) 且各被底線車保護（吃馬即遭車將）；
  // 紅車(1,7)封鎖第二橫線；紅帥在 (9,3) 遠端安全。
  const state = emptyState({
    turn: "black",
    redKing: { row: 9, col: 3 },
    blackKing: { row: 0, col: 4 },
    placements: [
      [0, 3, "red", "horse"],
      [0, 5, "red", "horse"],
      [1, 7, "red", "rook"],
      [0, 0, "red", "rook"],
      [0, 8, "red", "rook"],
    ],
  });
  assert.equal(isInCheck(state, "black"), false, "黑帥未被將軍");
  assert.equal(getLegalMoves(state, "black").length, 0);
  const status = getGameStatus(state);
  assert.equal(status.status, "stalemate");
  assert.equal(status.winner, "red");
});

/* ---------------- 盤面不可變性 ---------------- */

check("applyMove 不會改動原狀態（immutable）", () => {
  const before = createInitialState();
  const snapshot = JSON.stringify(before.board);
  const move = getLegalMoves(before).find((m) => squareIccs(m.from) === "b3" && squareIccs(m.to) === "e3");
  assert.ok(move, "b3-e3 應為合法著法");
  const after = applyMove(before, move);
  assert.equal(JSON.stringify(before.board), snapshot, "原盤面不可被修改");
  assert.equal(after.turn, "black");
  assert.equal(before.turn, "red");
  assert.equal(after.plies, 1);
});

console.log(`\nrules-special：${passed} 項全數通過`);
