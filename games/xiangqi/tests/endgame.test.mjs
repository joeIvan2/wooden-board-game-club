/**
 * tests/endgame.test.mjs — 終局：將死判定、困斃判定、搜尋找到殺著、
 * 底線兵、雙士缺糧局面繼續對弈。
 */

import assert from "node:assert/strict";
import {
  getLegalMoves,
  getLegalMovesFrom,
  getGameStatus,
  applyMove,
  isInCheck,
} from "../xiangqi-rules.mjs";
import { chooseMove } from "../xiangqi-ai.mjs";
import { emptyState, squareIccs } from "./helpers.mjs";

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

check("雙車悶殺：黑被將死，紅勝", () => {
  const state = emptyState({
    turn: "black",
    redKing: { row: 9, col: 3 },
    blackKing: { row: 0, col: 4 },
    placements: [
      [0, 0, "red", "rook"], // 沿底橫線將軍
      [1, 7, "red", "rook"], // 封鎖第二橫線
    ],
  });
  assert.equal(isInCheck(state, "black"), true);
  assert.equal(getLegalMoves(state, "black").length, 0);
  const status = getGameStatus(state);
  assert.equal(status.status, "checkmate");
  assert.equal(status.winner, "red");
});

check("已將死的局面：chooseMove 回傳 null 且分數為負極值", () => {
  const state = emptyState({
    turn: "black",
    redKing: { row: 9, col: 3 },
    blackKing: { row: 0, col: 4 },
    placements: [
      [0, 0, "red", "rook"],
      [1, 7, "red", "rook"],
    ],
  });
  const { move, meta } = chooseMove(state, 4);
  assert.equal(move, null);
  assert.ok(meta.score <= -(1_000_000 - 2));
});

check("困斃即判負：搜尋視角下無子可動等同被將死分數", () => {
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
  const status = getGameStatus(state);
  assert.equal(status.status, "stalemate");
  assert.equal(status.winner, "red", "困斃方（黑）判負，紅勝");
});

check("一步殺：AI（L1-L10 全部）都能立即找到殺著並終結比賽", () => {
  // 黑帥(0,4)；黑卒(1,4)恰好成為炮架；紅兵(0,2)(0,6)封鎖底線兩側；
  // 紅車(1,7)封鎖第二橫線；紅炮(3,2)→(3,4) 隔架成殺。
  const state = emptyState({
    turn: "red",
    redKing: { row: 9, col: 3 },
    blackKing: { row: 0, col: 4 },
    placements: [
      [1, 4, "black", "soldier"],
      [0, 2, "red", "soldier"],
      [0, 6, "red", "soldier"],
      [1, 7, "red", "rook"],
      [3, 2, "red", "cannon"],
    ],
  });
  // 先確認殺著存在於合法著法中
  const mating = getLegalMoves(state, "red").find((m) => m.from.row === 3 && m.from.col === 2 && m.to.row === 3 && m.to.col === 4);
  assert.ok(mating, "炮 e…平四應為合法著法");

  for (let level = 1; level <= 10; level += 1) {
    const { move } = chooseMove(state, level);
    assert.ok(move, `L${level} 應回傳著法`);
    const after = applyMove(state, move);
    const status = getGameStatus(after);
    assert.equal(status.status, "checkmate", `L${level} 的著法應構成將死`);
    assert.equal(status.winner, "red");
  }
});

check("底線兵只能橫移（升變概念不適用於象棋）", () => {
  const state = emptyState({
    redKing: { row: 9, col: 3 },
    blackKing: { row: 1, col: 5 },
    placements: [[0, 4, "red", "soldier"]],
  });
  const targets = getLegalMovesFrom(state, 0, 4).map((m) => squareIccs(m.to)).sort();
  assert.deepEqual(targets, ["d10", "f10"]);
});

check("僅剩雙將的局面仍會繼續（不會自動和局）", () => {
  const state = emptyState({});
  const status = getGameStatus(state);
  assert.equal(status.status, "ongoing");
  assert.ok(getLegalMoves(state, "red").length >= 2);
});

console.log(`\nendgame：${passed} 項全數通過`);
