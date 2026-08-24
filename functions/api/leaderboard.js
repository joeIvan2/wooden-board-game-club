import { d1Driver } from "../../leaderboard-store.mjs";
import { handleGetLeaderboard, handlePostLeaderboard } from "../../leaderboard-api.mjs";

function databaseUnavailable() {
  return new Response(JSON.stringify({ error: "databaseUnavailable" }), {
    status: 503,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function onRequestGet(context) {
  const db = context.env?.LEADERBOARD_DB;
  if (!db) return databaseUnavailable();
  return handleGetLeaderboard(context.request, d1Driver(db));
}

export async function onRequestPost(context) {
  const db = context.env?.LEADERBOARD_DB;
  if (!db) return databaseUnavailable();
  return handlePostLeaderboard(context.request, d1Driver(db));
}
