import { chooseMove } from "./chess-ai.mjs";

self.addEventListener("message", (event) => {
  const data = event.data || {};
  try {
    const move = chooseMove(data.state, data.level, data.context || {});
    self.postMessage({ id: data.id, ok: true, move });
  } catch (err) {
    self.postMessage({
      id: data.id,
      ok: false,
      error: err && err.message ? err.message : String(err),
    });
  }
});

