import assert from "node:assert/strict";
import {
  handleGetLeaderboard,
  handlePostLeaderboard,
  sanitizeDisplayName,
  validateWin,
} from "./leaderboard-api.mjs";
import { memoryDriver, D1_INSERT_SQL } from "./leaderboard-store.mjs";

const ORIGIN = "https://wooden-board-game-club.pages.dev";
const GOMOKU_9 = [108, 0, 109, 1, 110, 2, 111, 3, 112];
const GOMOKU_11 = [108, 0, 109, 2, 110, 4, 111, 6, 200, 8, 112];
const CHESS_MATE = ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"];
const XIANGQI_MATE = [
  "b3-c3", "h8-h1", "i1-h1", "a10-a9", "c3-c7", "b10-a8",
  "c7-g7", "c10-e8", "g7-a7", "d10-e9", "a7-a9", "e10-d10",
  "a9-b9", "d10-e10", "b9-d9", "e10-d10", "d9-d7", "d10-e10",
  "c4-c5", "e10-d10", "c5-c6", "d10-e10", "h3-d3", "g10-i8",
  "d7-i7", "e8-c6", "i7-i10", "e10-d10", "h1-h10", "d10-e10",
  "h10-h9",
];

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function postRequest(body, { origin = ORIGIN } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (origin !== null) headers.Origin = origin;
  return new Request(`${ORIGIN}/api/leaderboard`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const deps = {
  todayIso: () => "2026.08.24",
  newUid: (() => {
    let id = 0;
    return () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`;
  })(),
};

await test("all three rule engines accept a legal human win", () => {
  assert.deepEqual(validateWin("gomoku", GOMOKU_9).ok, true);
  assert.deepEqual(validateWin("chess", CHESS_MATE).ok, true);
  const xiangqi = validateWin("xiangqi", XIANGQI_MATE);
  assert.deepEqual(xiangqi.ok, true, JSON.stringify(xiangqi));
});

await test("invalid, ongoing, and wrong-winner records are rejected", () => {
  assert.equal(validateWin("gomoku", GOMOKU_9.slice(0, -1)).ok, false);
  assert.equal(validateWin("chess", ["f2f3", "e7e5", "g2g4", "d8h4"]).ok, false);
  assert.equal(validateWin("xiangqi", XIANGQI_MATE.slice(0, -1)).ok, false);
});

await test("POST accepts only L6-L10 and stores each game independently", async () => {
  const driver = memoryDriver();
  for (const [game, moves, level] of [
    ["gomoku", GOMOKU_9, 6],
    ["chess", CHESS_MATE, 8],
    ["xiangqi", XIANGQI_MATE, 10],
  ]) {
    const response = await handlePostLeaderboard(
      postRequest({ game, level, displayName: "棋友", moves }),
      driver,
      deps
    );
    assert.equal(response.status, 201, `${game} should be accepted`);
    const data = await response.json();
    assert.equal(data.game, game);
    assert.equal(data.level, level);
  }
  const low = await handlePostLeaderboard(
    postRequest({ game: "gomoku", level: 5, displayName: "棋友", moves: GOMOKU_9 }),
    driver,
    deps
  );
  assert.equal(low.status, 400);
});

await test("GET filters by game and level, then ranks the fewest plies first", async () => {
  const driver = memoryDriver();
  const longer = await handlePostLeaderboard(
    postRequest({ game: "gomoku", level: 6, displayName: "十一手", moves: GOMOKU_11 }),
    driver,
    deps
  );
  assert.equal(longer.status, 201);
  const shorter = await handlePostLeaderboard(
    postRequest({ game: "gomoku", level: 6, displayName: "九手", moves: GOMOKU_9 }),
    driver,
    deps
  );
  assert.equal(shorter.status, 201);
  assert.equal((await shorter.json()).rank, 1);

  const response = await handleGetLeaderboard(
    new Request(`${ORIGIN}/api/leaderboard?game=gomoku&level=6`),
    driver
  );
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.sort, "plyCountAsc");
  assert.deepEqual(data.entries.map((entry) => [entry.displayName, entry.plyCount]), [
    ["九手", 9],
    ["十一手", 11],
  ]);

  const chess = await handleGetLeaderboard(
    new Request(`${ORIGIN}/api/leaderboard?game=chess&level=6`),
    driver
  );
  assert.deepEqual((await chess.json()).entries, []);
});

await test("duplicate records, cross-origin posts, and unsafe names are rejected", async () => {
  const driver = memoryDriver();
  const body = { game: "gomoku", level: 7, displayName: " 阿 明 ", moves: GOMOKU_9 };
  const first = await handlePostLeaderboard(postRequest(body), driver, deps);
  assert.equal(first.status, 201);
  const duplicate = await handlePostLeaderboard(postRequest(body), driver, deps);
  assert.equal(duplicate.status, 409);
  const crossOrigin = await handlePostLeaderboard(postRequest(body, { origin: "https://evil.example" }), driver, deps);
  assert.equal(crossOrigin.status, 403);
  assert.equal(sanitizeDisplayName("  阿   明  "), "阿 明");
  assert.equal(sanitizeDisplayName("bad\u0007name"), null);
});

await test("D1 statements scope rank by game and level", () => {
  assert.match(D1_INSERT_SQL, /game, level/);
  const driverSource = String(memoryDriver);
  assert.match(driverSource, /row\.game === game && row\.level === level/);
});

console.log(`\nleaderboard API: ${passed} passed`);
