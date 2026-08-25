import assert from "node:assert/strict";
import test from "node:test";
import { FairyStockfishNode } from "../shared/fairy-stockfish-node.mjs";

test("Node tournament adapter returns a legal-looking Chess UCI move", async () => {
  const engine = new FairyStockfishNode();
  try {
    const move = await engine.choose({
      game: "chess",
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      level: 6,
      movetimeMs: 80,
    });
    assert.match(move, /^[a-h][1-8][a-h][1-8][qrbn]?$/i);
  } finally {
    await engine.close();
  }
});

test("Node tournament adapter returns a legal-looking Xiangqi UCI move", async () => {
  const engine = new FairyStockfishNode();
  try {
    const move = await engine.choose({
      game: "xiangqi",
      fen: "rheakaehr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RHEAKAEHR w - - 0 1",
      level: 6,
      movetimeMs: 80,
    });
    assert.match(move, /^[a-i](?:10|[1-9])[a-i](?:10|[1-9])$/i);
  } finally {
    await engine.close();
  }
});
