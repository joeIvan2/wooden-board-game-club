// 社群棋譜榜核心模組測試：UCI 重放、公開資格判定與標準 PGN 產生。

import assert from "node:assert/strict";
import {
  MIN_PLIES,
  MAX_PLIES,
  moveToUci,
  parseUci,
  replayUci,
  validateWhiteMateRun,
  escapePgnValue,
  isValidDateOnly,
  formatMovetext,
  buildPgn,
  DEFAULT_RULESET,
  DEFAULT_PRIVATE_WHITE,
} from "./community-game.mjs";
import {
  createInitialState,
  generateLegalMoves,
  applyMove,
  getGameStatus,
} from "./chess.mjs";

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (err) {
    failed += 1;
    failures.push({ name, err });
    console.error(`FAIL - ${name}`);
    console.error(`      ${err && err.message ? err.message : err}`);
  }
}

const SCHOLAR_MATE_UCI = [
  "e2e4",
  "e7e5",
  "f1c4",
  "b8c6",
  "d1h5",
  "g8f6",
  "h5f7",
]; // 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6?? 4.Qxf7#

await test("moveToUci/parseUci round-trip including promotion", () => {
  const uci = moveToUci({
    from: [6, 4],
    to: [4, 4],
    promotion: null,
  });
  assert.equal(uci, "e2e4");
  const parsed = parseUci("e7e8q");
  assert.deepEqual(parsed.from, [1, 4]);
  assert.deepEqual(parsed.to, [0, 4]);
  assert.equal(parsed.promotion, "q");
});

await test("parseUci rejects malformed input", () => {
  for (const bad of [null, undefined, 42, "", "e2", "e2e4x", "i1i2", "e9e8", "E2E4X!"]) {
    assert.equal(parseUci(bad), null, JSON.stringify(bad));
  }
});

await test("replayUci rejects non-lists, bad tokens and illegal moves with indices", () => {
  assert.equal(replayUci("e2e4").ok, false);
  const badToken = replayUci(["e2e4", "zzzz"]);
  assert.equal(badToken.ok, false);
  assert.match(badToken.reason, /^badUci@1$/);
  const illegal = replayUci(["e2e4", "e7e5", "e4e5"]);
  assert.equal(illegal.ok, false);
  assert.match(illegal.reason, /^illegalMove@2$/);
});

await test("validateWhiteMateRun accepts a legal white checkmate and derives counts/SAN itself", () => {
  // 先以規則引擎確認該序列確實是白方將死（避免測試夾帶錯誤前提）
  let s = createInitialState();
  for (const uci of SCHOLAR_MATE_UCI) {
    const p = parseUci(uci);
    s = applyMove(s, {
      from: p.from,
      to: p.to,
      ...(p.promotion ? { promotion: p.promotion } : {}),
    });
  }
  assert.equal(getGameStatus(s).status, "checkmate");
  assert.equal(getGameStatus(s).winner, "w");

  const verdict = validateWhiteMateRun(SCHOLAR_MATE_UCI);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.plyCount, 7);
  assert.equal(verdict.whiteMoveCount, 4);
  assert.equal(verdict.sanList.at(-1), "Qxf7#");
});

await test("validateWhiteMateRun rejects black wins, draws, ongoing and short runs", () => {
  const foolsMate = ["f2f3", "e7e5", "g2g4", "d8h4"];
  assert.equal(validateWhiteMateRun(foolsMate).error, "blackWin");
  // 低於最小半步數時先回 tooFewPlies（尚未進入重放）
  assert.equal(
    validateWhiteMateRun(["e2e4", "e7e5"]).error,
    "tooFewPlies"
  );
  assert.equal(validateWhiteMateRun([]).error, "tooFewPlies");
  assert.equal(validateWhiteMateRun(["a2a3"]).error, "tooFewPlies");
  assert.equal(validateWhiteMateRun(null).error, "invalidPayload");

  const longShuffle = [];
  for (let i = 0; i <= Math.ceil(MAX_PLIES / 4); i++) {
    longShuffle.push("g1f3", "g8f6", "f3g1", "f6g8");
  }
  assert.equal(validateWhiteMateRun(longShuffle).error, "tooManyPlies");
  assert.ok(MAX_PLIES >= MIN_PLIES);
});

// 安靜 152 半步見證序列（離線搜尋產生：全程無兵動／無吃子／不送將軍、
// 任一局面重複 ≤ 4，終態 halfmoveClock = 152 → 75 回合自動和棋）。
const QUIET_152_UCI = [
  "b1c3", "b8c6", "c3b1", "c6b4",
  "g1h3", "b4a6", "b1c3", "a6b4",
  "c3d5", "g8h6", "d5c3", "b4d5",
  "h3f4", "d5e3", "f4g6", "h8g8",
  "c3d5", "e3c4", "d5e3", "g8h8",
  "e3f5", "c4a3", "f5h4", "h6g4",
  "g6e5", "g4f6", "h4f5", "f6d5",
  "e5g4", "d5b6", "g4e3", "a3b1",
  "f5g3", "b6d5", "e3c4", "b1c3",
  "c4a3", "d5f4", "a3b5", "f4h5",
  "b5a3", "c3d5", "g3e4", "h5f4",
  "e4g3", "f4e6", "a1b1", "d5e3",
  "g3f5", "e6d4", "b1a1", "d4b5",
  "a3c4", "e3g4", "h1g1", "b5a3",
  "f5d4", "g4f6", "d4b3", "h8g8",
  "c4e3", "f6e4", "e3g4", "a3b5",
  "g4e5", "b5d6", "e5f3", "e4c5",
  "b3a5", "c5e4", "f3d4", "e4c3",
  "d4f5", "c3d5", "a5c6", "d5e3",
  "c6b8", "d6c4", "f5d4", "c4d6",
  "b8c6", "g8h8", "c6e5", "a8b8",
  "e5d3", "e3g4", "d3e5", "b8a8",
  "e5f3", "d6c4", "d4e6", "g4e3",
  "a1b1", "h8g8", "e6g5", "a8b8",
  "f3h4", "c4e5", "h4g6", "e3f5",
  "g6h4", "b8a8", "g5f3", "f5d6",
  "g1h1", "d6f5", "h4g6", "f5d4",
  "f3g5", "d4c6", "g5h3", "e5g4",
  "g6e5", "g4h6", "e5d3", "h6f5",
  "h3f4", "f5g3", "f4g6", "g8h8",
  "d3e5", "g3h5", "g6f4", "c6d4",
  "h1g1", "h8g8", "b1a1", "d4f5",
  "e5d3", "f5h4", "f4h3", "g8h8",
  "d3c5", "a8b8", "c5b3", "h5f6",
  "g1h1", "h4g6", "b3c5", "f6g4",
  "c5e4", "b8a8", "h3g1", "g4e5",
  "e4g5", "a8b8", "g5f3", "g6h4",
  "f3d4", "b8a8", "g1f3", "h4g6",
];


await test("75-move automatic draw reached by varied quiet play is rejected as seventyfive", () => {
  assert.equal(QUIET_152_UCI.length, 152);
  const movesUci = QUIET_152_UCI;
  assert.equal(validateWhiteMateRun(movesUci).error, "seventyfive");
});

await test("moves appended AFTER fivefold termination are rejected at the terminal boundary", () => {
  // 4 輪騎士來回＝16 半步：初始局面第 5 次出現 → 五次重複自動和棋已成立
  const fourRounds = [];
  for (let i = 0; i < 4; i++) fourRounds.push("g1f3", "g8f6", "f3g1", "f6g8");
  assert.equal(fourRounds.length, 16);
  const verdict = validateWhiteMateRun([...fourRounds]);
  assert.equal(verdict.error, "fivefold", "16 quiet plies must already be terminal");

  // 續送第 17 手（在初始局面型態本為合法著法）必須被終局守衛擋下
  const rejected = validateWhiteMateRun([...fourRounds, "g1f3"]);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, "fivefold");
  assert.equal(rejected.detail, "terminal@16:fivefold");
});

await test("moves appended AFTER the 75-move threshold are rejected before continuation", () => {
  // 前 150 個安靜半步：halfmoveClock 恰為 150 → 已達 75 回合終局
  const prefix150 = QUIET_152_UCI.slice(0, 150);
  assert.equal(prefix150.length, 150);
  assert.equal(validateWhiteMateRun(prefix150).error, "seventyfive");

  // 第 151 個 UCI 在該終局之後本為合法著法，但必須在處理前即被擋下：
  // detail 指出 terminal@150（而非等到最終狀態才判和）
  const extra = generateLegalMoves(
    (() => {
      let s = createInitialState();
      for (const uci of prefix150) {
        const parsed = parseUci(uci);
        s = applyMove(s, { from: parsed.from, to: parsed.to });
      }
      return s;
    })()
  ).filter((mv) => mv.piece !== "p" && !mv.captured);
  assert.ok(extra.length > 0, "terminal position should still have legal moves");
  const rejected = validateWhiteMateRun([...prefix150, moveToUci(extra[0])]);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, "seventyfive");
  assert.equal(rejected.detail, "terminal@150:seventyfive");
});

await test("a legal white mate still succeeds after the terminal-guard rework", () => {
  const verdict = validateWhiteMateRun(SCHOLAR_MATE_UCI);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.plyCount, SCHOLAR_MATE_UCI.length);
});

await test("replayUci canonicalizes castling, en passant and promotion SAN", () => {
  const castle = replayUci([
    "e2e4", "e7e5",
    "g1f3", "b8c6",
    "f1c4", "g8f6",
    "e1g1",
  ]);
  assert.equal(castle.sanList.at(-1), "O-O");

  const ep = replayUci(["e2e4", "a7a6", "e4e5", "d7d5", "e5d6"]);
  assert.equal(ep.sanList.at(-1), "exd6");

  const promo = replayUci([
    "a2a4", "h7h5",
    "a4a5", "h5h4",
    "a5a6", "h4h3",
    "a6b7", "h3g2",
    "b7a8q",
  ]);
  assert.equal(promo.sanList.at(-1), "bxa8=Q");
  assert.equal(getGameStatus(promo.finalState).status, "ongoing");
});

await test("escapePgnValue neutralizes quotes, backslashes, newlines and control chars", () => {
  assert.equal(escapePgnValue('He said "hi"'), 'He said \\"hi\\"');
  assert.equal(escapePgnValue("back\\slash"), "back\\\\slash");
  assert.equal(escapePgnValue("A\nB\tC"), "A B C");
  assert.equal(escapePgnValue("x\u0001y\u001bz"), "x y z");
  const evil = 'p\\n"x"y';
  const escaped = escapePgnValue(evil);
  assert.ok(!escaped.includes("\n"));
  assert.equal((escaped.match(/\\/g) ?? []).length % 2, 0, "escapes balanced");
});

await test("buildPgn emits the seven-tag roster plus Level/PlyCount/Termination/Ruleset in order", () => {
  const pgn = buildPgn({
    sanList: ["e4", "f6", "Bc4", "g5", "Qh5#"],
    dateOnly: "2026.08.23",
    white: "玩家",
    black: "Community opponent L8 (player-selected, unverified)",
    level: 8,
    plyCount: 5,
  });
  const lines = pgn.split("\n");
  const expectedHeads = [
    '[Event "社群棋譜榜 Community Board L8"]',
    '[Site "oxalpha-chess-club"]',
    '[Date "2026.08.23"]',
    '[Round "-"]',
    '[White "玩家"]',
    "[Black \"Community opponent L8 (player-selected, unverified)\"]",
    '[Result "1-0"]',
    '[Level "L8"]',
    '[PlyCount "5"]',
    '[Termination "checkmate"]',
    `[Ruleset "${DEFAULT_RULESET}"]`,
  ];
  assert.deepEqual(lines.slice(0, expectedHeads.length), expectedHeads);
  const body = lines.slice(expectedHeads.length).join("\n");
  assert.ok(body.startsWith("\n1. e4 f6 2. Bc4 g5 3. Qh5# 1-0"));
  assert.ok(pgn.trimEnd().endsWith("1-0"));
});

await test("buildPgn escapes hostile display names and keeps one-line tags", () => {
  const hostile = 'p\\n"x"\u0001y';
  const pgn = buildPgn({
    sanList: ["e4", "f6", "Bc4", "g5", "Qh5#"],
    dateOnly: "2026.08.23",
    white: hostile,
    black: "v",
    level: 5,
    plyCount: 5,
  });
  for (const line of pgn.split("\n")) {
    if (line.startsWith("[")) {
      assert.match(line, /^\[[A-Za-z]+ ".+"\]$/, JSON.stringify(line));
      assert.ok(!line.includes("\n"));
    }
  }
  assert.ok(pgn.includes('p\\\\n\\"x\\" y'), "hostile name must be escaped/space-folded");
});

await test("formatMovetext wraps long games without exceeding 80 characters", () => {
  const sans = [];
  for (let i = 0; i < 120; i++) sans.push(i % 2 === 0 ? "Nf3" : "Nf6");
  const text = formatMovetext(sans, "1-0");
  for (const line of text.split("\n")) {
    assert.ok(line.length <= 80, `line too long: ${line.length}`);
  }
  assert.ok(text.trimEnd().endsWith("1-0"));
});

await test("date-only validation and private defaults", () => {
  assert.ok(isValidDateOnly("2026.08.23"));
  assert.ok(!isValidDateOnly("2026-08-23"));
  assert.ok(!isValidDateOnly("2026.08.23T10:00"));
  assert.equal(DEFAULT_PRIVATE_WHITE, "玩家");
  const pgn = buildPgn({
    sanList: ["e4", "f6", "Bc4", "g5", "Qh5#"],
    dateOnly: "2026.08.23",
    white: DEFAULT_PRIVATE_WHITE,
    black: "Community opponent L6 (practice)",
    level: 6,
    plyCount: 5,
  });
  assert.ok(pgn.includes('[White "玩家"]'));
  assert.throws(
    () =>
      buildPgn({
        sanList: ["e4"],
        dateOnly: "2026-08-23",
        white: "a",
        black: "b",
        level: 3,
        plyCount: 1,
      }),
    TypeError
  );
  assert.throws(
    () =>
      buildPgn({
        sanList: [],
        dateOnly: "2026.08.23",
        white: "a",
        black: "b",
        level: 3,
        plyCount: 1,
      }),
    TypeError
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) {
    console.error(`failed: ${f.name}`);
  }
  process.exitCode = 1;
}
