/**
 * xiangqi-ai-worker.mjs — 瀏覽器 Module Worker 包裝層。
 *
 * 協定：
 *   收到 { id, state, level, options? }
 *   回覆 { id, ok: true, move, meta } 或 { id, ok: false, error }
 *
 * 預設帶 30 秒保險絲（maxTimeMs），正常情況下節點預算先觸發，
 * 結果維持與 CLI 完全相同的確定性輸出。
 */

import { chooseMove } from "./xiangqi-ai.mjs";

const DEFAULT_TIME_GUARD_MS = 30_000;

self.addEventListener("message", (event) => {
  const message = event.data ?? {};
  const { id, state, level, options } = message;
  if (typeof id !== "number" || !state) {
    self.postMessage({ id: null, ok: false, error: "worker 收到格式不正確的訊息" });
    return;
  }
  try {
    const mergedOptions = { maxTimeMs: DEFAULT_TIME_GUARD_MS, ...(options ?? {}) };
    const result = chooseMove(state, level, mergedOptions);
    self.postMessage({ id, ok: true, move: result.move, meta: result.meta });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error?.message ?? error) });
  }
});
