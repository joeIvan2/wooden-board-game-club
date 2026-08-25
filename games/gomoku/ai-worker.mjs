import { selectLevelMove, getLastLevelSearchInfo } from "./gomoku-levels.mjs";

self.addEventListener("message", ({ data }) => {
  const { id, board, player, level } = data || {};
  try {
    const move = selectLevelMove(board, player, level, { context: "interactive" });
    self.postMessage({ id, ok: true, move, info: getLastLevelSearchInfo() });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

