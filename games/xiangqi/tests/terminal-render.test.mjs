import assert from "node:assert/strict";
import { renderCommittedTerminalMove } from "../terminal-render.mjs";

const calls = [];
const status = { status: "checkmate", winner: "black", inCheck: true };
const record = (name) => (...args) => calls.push([name, ...args]);

renderCommittedTerminalMove({
  renderBoard: record("board"),
  renderMoveList: record("moves"),
  renderCaptured: record("captured"),
  finishGame: record("finish"),
  renderSidebar: record("sidebar"),
  updateControls: record("controls"),
}, status);

assert.deepEqual(calls, [
  ["board"],
  ["moves"],
  ["captured"],
  ["finish", status],
  ["sidebar", status],
  ["controls"],
]);

console.log("ok - 終局時先渲染最後一步，再公告勝負");
