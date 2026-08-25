// 針對 app.js 瀏覽器路徑的零依賴回歸測試：
// 1) renderHistory 在「白先黑後、偶數手」時不得拋出 ReferenceError，
//    且 `.current` 必須標記在最後一手（不論白或黑）。
// 2) AiClient 取消／重開路徑：取消必須拒絕過期請求（帶 cancelled 標記）、
//    解除其逾時計時器、終止舊 worker，讓新請求使用全新 worker；
//    已取消的請求不得退回主執行緒運算。
//
// 做法：從真實的 app.js 原始碼抽出目標函式，注入最小桩件（DOM/Worker/
// 計時器）後直接執行。僅涵蓋這兩個自足區塊，不模擬整個瀏覽器環境。

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "app.js");
const appSrc = await readFile(appPath, "utf8");
const workerSrc = await readFile(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "shared", "stockfish-engine-worker.js"),
  "utf8"
);
const htmlSrc = await readFile(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "index.html"),
  "utf8"
);
const { moveToUci, buildPgn, DEFAULT_PRIVATE_WHITE } = await import(
  "./community-game.mjs"
);

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

function extractBetween(startMarker, endMarker) {
  const start = appSrc.indexOf(startMarker);
  assert.ok(start !== -1, `找不到原始碼片段：${startMarker}`);
  const end = appSrc.indexOf(endMarker, start + startMarker.length);
  assert.ok(end !== -1, `找不到結束邊界：${endMarker}`);
  return appSrc.slice(start, end);
}

// ---------- 最小 DOM 桩件（僅 renderHistory 所需） ----------

function createEl(tagName) {
  const classes = new Set();
  const el = {
    tagName,
    children: [],
    textContent: "",
    scrollTop: 0,
    scrollHeight: 100,
    title: "",
    appendChild(child) {
      el.children.push(child);
      return child;
    },
    append(...kids) {
      for (const k of kids) el.children.push(k);
    },
    classList: {
      add(...names) {
        for (const n of names) classes.add(n);
      },
      has(name) {
        return classes.has(name);
      },
      toggle(name, force) {
        const shouldHave = force === undefined ? !classes.has(name) : Boolean(force);
        if (shouldHave) classes.add(name);
        else classes.delete(name);
      },
    },
  };
  Object.defineProperty(el, "className", {
    get: () => [...classes].join(" "),
    set(v) {
      classes.clear();
      for (const n of String(v).split(/\s+/)) if (n) classes.add(n);
    },
  });
  return el;
}

const minimalDocument = { createElement: (tag) => createEl(tag) };

function allCurrentSpans(moveList) {
  const found = [];
  for (const li of moveList.children) {
    for (const child of li.children) {
      if (child.classList && child.classList.has("current")) found.push(child);
    }
  }
  return found;
}

// ---------- renderHistory 回歸 ----------

const renderHistorySrc = extractBetween("function renderHistory(", "\nfunction ");
const makeRenderHistory = new Function(
  "els",
  "history",
  "document",
  `${renderHistorySrc}\nreturn renderHistory;`
);

function renderWith(historyEntries) {
  const els = { moveList: createEl("ol") };
  const renderHistory = makeRenderHistory(els, historyEntries, minimalDocument);
  renderHistory();
  return els.moveList;
}

await test("renderHistory: e4 followed by black reply must not throw ReferenceError (reported browser bug)", () => {
  const moveList = renderWith([{ san: "e4" }, { san: "c5" }]);
  assert.equal(moveList.children.length, 1);
  const li = moveList.children[0];
  assert.equal(li.children.length, 3, "row must contain num + white SAN + black SAN");
  const [, w, b] = li.children;
  assert.equal(w.textContent, "e4");
  assert.equal(b.textContent, "c5");
});

await test("renderHistory: final black SAN entry carries .current", () => {
  const moveList = renderWith([{ san: "e4" }, { san: "c5" }]);
  const current = allCurrentSpans(moveList);
  assert.equal(current.length, 1, "exactly one entry highlighted");
  assert.equal(current[0].textContent, "c5");
});

await test("renderHistory: four plies highlight the last black SAN (Nc6)", () => {
  const moveList = renderWith([
    { san: "e4" },
    { san: "c5" },
    { san: "Nf3" },
    { san: "Nc6" },
  ]);
  const current = allCurrentSpans(moveList);
  assert.equal(current.length, 1);
  assert.equal(current[0].textContent, "Nc6");
});

await test("renderHistory: odd ply count highlights the final white SAN", () => {
  const moveList = renderWith([{ san: "e4" }, { san: "c5" }, { san: "e5" }]);
  const current = allCurrentSpans(moveList);
  assert.equal(current.length, 1);
  assert.equal(current[0].textContent, "e5");
  const firstRow = moveList.children[0].children;
  assert.equal(firstRow[1].classList.has("current"), false, "earlier white SAN not highlighted");
  assert.equal(firstRow[2].classList.has("current"), false, "earlier black SAN not highlighted");
});

await test("renderHistory: single white move highlights e4", () => {
  const moveList = renderWith([{ san: "e4" }]);
  const current = allCurrentSpans(moveList);
  assert.equal(current.length, 1);
  assert.equal(current[0].textContent, "e4");
});

await test("renderHistory: empty history shows placeholder without throwing", () => {
  const moveList = renderWith([]);
  assert.equal(moveList.children.length, 1);
  assert.equal(moveList.children[0].className, "move-list-empty");
});

// ---------- 最小 Worker／計時器桩件（僅 AiClient 所需） ----------

class FakeWorker {
  constructor(url) {
    this.url = String(url);
    this.terminated = false;
    this.posted = [];
    this.listeners = {};
    // getWorker 於 solve() 內才建立 worker，故以靜態掛鉤預先注入回應
    this.autoReply = FakeWorker.nextAutoReply;
    FakeWorker.nextAutoReply = null;
    FakeWorker.created.push(this);
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  postMessage(msg) {
    this.posted.push(msg);
    if (!this.autoReply) return;
    queueMicrotask(() =>
      this.dispatch({ data: { id: msg.id, ...(this.autoReply || {}) } })
    );
  }
  dispatch(event) {
    for (const fn of this.listeners.message ?? []) fn(event);
  }
  terminate() {
    this.terminated = true;
  }
}
FakeWorker.created = [];
FakeWorker.nextAutoReply = null;

let timersIssued = 0;
const timersCleared = [];
function spySetTimeout(_fn, ms) {
  return { spyTimerId: ++timersIssued, ms };
}
function spyClearTimeout(timer) {
  timersCleared.push(timer);
}

const aiClientBlock = extractBetween("const AiClient = (() => {", "function refreshDerived");
assert.ok(aiClientBlock.includes("import.meta.url"), "AiClient block unexpectedly changed");
const aiClientPatched = aiClientBlock.replaceAll("import.meta.url", "__workerBaseUrl");
const buildAiClient = new Function(
  "Worker",
  "URL",
  "__workerBaseUrl",
  "setTimeout",
  "clearTimeout",
  "engineThinkTimeMs",
  `${aiClientPatched}\nreturn AiClient;`
);

function freshAiClient() {
  FakeWorker.created = [];
  FakeWorker.nextAutoReply = null;
  timersIssued = 0;
  timersCleared.length = 0;
  return buildAiClient(FakeWorker, URL, "file:///fake/app.js", spySetTimeout, spyClearTimeout, () => 1000);
}

const AI_STATE = { board: [], turn: "b" };
const AI_MOVE = { from: [6, 4], to: [4, 4], piece: "p" };

await test("AiClient.solve resolves through the worker and keeps a healthy worker warm", async () => {
  const client = freshAiClient();
  FakeWorker.nextAutoReply = { ok: true, move: AI_MOVE };
  const pendingReply = client.solve(AI_STATE, 6);
  const worker = FakeWorker.created[0];
  assert.ok(worker, "solve must construct a worker");
  const move = await pendingReply;
  assert.deepEqual(move, AI_MOVE);
  assert.equal(FakeWorker.created.length, 1, "no extra workers needed");
  assert.equal(worker.terminated, false, "healthy worker must survive normal completion");
  assert.equal(worker.posted.length, 1);
  assert.equal(worker.posted[0].level, 6);
  assert.equal(worker.posted[0].state, AI_STATE);

  client.cancelAll(); // 無進行中請求時應為無操作
  assert.equal(worker.terminated, false, "cancelAll with nothing pending must not kill the idle worker");
});

await test("cancelAll rejects the obsolete request with a cancelled marker (no local-compute fallback)", async () => {
  const client = freshAiClient();
  let caught = null;
  const settled = client.solve(AI_STATE, 9).then(
    () => {
      throw new Error("obsolete request must not resolve");
    },
    (err) => {
      caught = err;
    }
  );
  const worker = FakeWorker.created[0];
  assert.ok(worker, "solve must construct a worker");
  assert.equal(timersIssued, 1, "one pending timeout for the in-flight job");

  client.cancelAll();
  await settled;
  await new Promise((resolve) => setImmediate(resolve)); // 讓任何誤觸發的 fallback 浮現

  assert.ok(caught, "promise must reject");
  assert.equal(caught.cancelled, true, "rejection must be marked cancelled, not routed to viaLocal");
  assert.equal(timersCleared.length, 1, "the stale 60s timeout must be defused");
  assert.equal(worker.terminated, true, "stale worker compute must be terminated");
});

await test("a request made after cancellation runs on a fresh worker and completes", async () => {
  const client = freshAiClient();
  let staleCaught = null;
  const staleJob = client.solve(AI_STATE, 10).then(
    () => {
      throw new Error("stale job resolved");
    },
    (err) => {
      staleCaught = err;
    }
  );
  const staleWorker = FakeWorker.created[0];
  assert.ok(staleWorker, "stale solve must construct a worker");
  client.cancelAll();
  await staleJob;
  assert.equal(staleCaught.cancelled, true);

  const replyMove = { from: [0, 1], to: [2, 2], piece: "n" };
  const second = client.solve(AI_STATE, 3);
  const freshWorker = FakeWorker.created[FakeWorker.created.length - 1];
  assert.notEqual(freshWorker, staleWorker, "must construct a brand-new worker after cancellation");
  assert.equal(staleWorker.terminated, true);
  assert.equal(freshWorker.terminated, false, "new worker must not be killed by stale timeouts");
  assert.equal(freshWorker.posted.length, 1, "new job must not queue behind stale work");
  freshWorker.dispatch({
    data: { id: freshWorker.posted[0].id, ok: true, move: replyMove },
  });
  assert.deepEqual(await second, replyMove);
});

await test("AiClient.solve forwards repetition context to the worker job", async () => {
  const client = freshAiClient();
  FakeWorker.nextAutoReply = { ok: true, move: AI_MOVE };
  const pendingReply = client.solve(AI_STATE, 6, { repetitionCount: 2 });
  const worker = FakeWorker.created[0];
  assert.ok(worker);
  assert.deepEqual(await pendingReply, AI_MOVE);
  assert.deepEqual(worker.posted[0].context, { repetitionCount: 2 });
});

await test("cancelled contextual requests still reject with cancelled and skip viaLocal", async () => {
  const client = freshAiClient();
  let caught = null;
  const settled = client
    .solve(AI_STATE, 9, { repetitionCount: 4 })
    .then(
      () => {
        throw new Error("obsolete request must not resolve");
      },
      (err) => {
        caught = err;
      }
    );
  client.cancelAll();
  await settled;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(caught && caught.cancelled, true);
});

await test("controller wiring: doReset cancels in-flight AI work", () => {
  const doResetSrc = extractBetween("function doReset(", "\nfunction ");
  assert.match(doResetSrc, /AiClient\.cancelAll\(\)/, "doReset must call AiClient.cancelAll()");
});

// ---------- 特殊和棋規則：控制器接線與純邏輯 ----------

await test("worker protocol pins the local Stockfish chess variant and difficulty setting", () => {
  assert.match(workerSrc, /UCI_Variant value \$\{game === "xiangqi" \? "xiangqi" : "chess"\}/);
  assert.match(workerSrc, /setoption name Skill Level value/);
});

await test("reset wiring keeps tracker lifecycle and cancels in-flight AI work", () => {
  const doResetSrc = extractBetween("function doReset(", "\nfunction ");
  assert.match(doResetSrc, /AiClient\.cancelAll\(\)/);
  assert.match(doResetSrc, /repetitionTracker\.reset\(state\)/);
});

await test("startAiTurn and refreshDerived feed the repetition tracker into the engine", () => {
  const startSrc = extractBetween("function startAiTurn(", "\nfunction ");
  assert.match(startSrc, /repetitionTracker\.countCurrent\(\)/);
  const refreshSrc = extractBetween("function refreshDerived(", "\nfunction ");
  assert.match(refreshSrc, /getGameStatus\(state, \{ repetitionCount \}\)/);
  assert.match(refreshSrc, /claimableDraws\(/);
});

await test("move/undo/reset lifecycle maintains the repetition tracker", () => {
  const execSrc = extractBetween("function executeMove(", "\nfunction ");
  assert.match(execSrc, /repetitionTracker\.push\(next\)/);
  const undoSrc = extractBetween("function undoPlies(", "\nfunction ");
  assert.match(undoSrc, /repetitionTracker\.truncate\(n\)/);
});

await test("controller wiring: doReset cancels in-flight AI work", () => {
  const doResetSrc = extractBetween("function doReset(", "\nfunction ");
  assert.match(doResetSrc, /AiClient\.cancelAll\(\)/, "doReset must call AiClient.cancelAll()");
});

const makeDrawHelpers = new Function(
  `${extractBetween("function drawOutcomeText(", "\nfunction ")}\n` +
    `${extractBetween("function claimButtonVisible(", "\nfunction ")}\n` +
    "return { drawOutcomeText, claimButtonVisible };"
);

await test("drawOutcomeText maps every automatic/claimed draw to status and banner text", () => {
  const { drawOutcomeText } = makeDrawHelpers();
  assert.deepEqual(drawOutcomeText({ status: "insufficient" }), {
    main: "子力不足，和棋！",
    title: "子力不足 · 自動判和",
  });
  assert.deepEqual(drawOutcomeText({ status: "seventyfive" }), {
    main: "75 回合規則，自動和棋",
    title: "75 回合規則 · 自動和棋",
  });
  assert.deepEqual(drawOutcomeText({ status: "fivefold" }), {
    main: "五次重複局面，自動和棋",
    title: "五次重複 · 自動和棋",
  });
  assert.deepEqual(
    drawOutcomeText({ status: "claim", claimKind: "fiftyMove" }),
    { main: "五十步規則，宣告和棋成立", title: "宣告和棋 · 五十步規則" }
  );
  assert.deepEqual(
    drawOutcomeText({ status: "claim", claimKind: "threefold" }),
    { main: "三次重複局面，宣告和棋成立", title: "宣告和棋 · 三次重複" }
  );
  assert.equal(drawOutcomeText({ status: "checkmate" }), null);
});

await test("claimButtonVisible hides claims when over/busy/promo or nothing claimable", () => {
  const { claimButtonVisible } = makeDrawHelpers();
  const claims = { threefold: true, fiftyMove: false };
  assert.equal(claimButtonVisible(null, false, false, claims), true);
  assert.equal(claimButtonVisible(null, false, false, { threefold: false, fiftyMove: true }), true);
  assert.equal(claimButtonVisible(null, false, false, { threefold: false, fiftyMove: false }), false);
  assert.equal(claimButtonVisible({ status: "stalemate" }, false, false, claims), false);
  assert.equal(claimButtonVisible(null, true, false, claims), false);
  assert.equal(claimButtonVisible(null, false, true, claims), false);
});

// ---------- renderStatus 行為（抽出後以最小 DOM 桩件驅動） ----------

const COLOR_ZH_STUB = { w: "白", b: "黑" };
const LEVEL_NAMES_STUB = ["入門", "初學", "見習", "業餘", "進階", "認真", "強手", "大師", "教頭", "冠軍"];

const makeRenderStatus = new Function(
  "els",
  "gameOverInfo",
  "aiBusy",
  "pendingPromotion",
  "history",
  "state",
  "curStatus",
  "claimable",
  "mode",
  "level",
  "COLOR_ZH",
  "LEVEL_NAMES",
  "confirmResolve",
  "hintInfo",
  "hintBusy",
  `${extractBetween("function drawOutcomeText(", "\nfunction ")}\n` +
    `${extractBetween("function claimButtonVisible(", "\nfunction ")}\n` +
    `${extractBetween("function renderStatus(", "\nfunction ")}\nreturn renderStatus;`
);

function runRenderStatus(opts) {
  const els = {
    statusMain: createEl("p"),
    statusSub: createEl("p"),
    thinkingBadge: createEl("span"),
    undoBtn: { disabled: false },
    hintBtn: { disabled: false, title: "" },
    claimDrawBtn: createEl("button"),
  };
  const renderStatus = makeRenderStatus(
    els,
    opts.gameOverInfo ?? null,
    Boolean(opts.aiBusy),
    opts.pendingPromotion ?? null,
    opts.history ?? [],
    opts.state ?? { fullmoveNumber: 1, turn: "w" },
    opts.curStatus ?? { inCheck: false },
    opts.claimable ?? { threefold: false, fiftyMove: false },
    opts.mode ?? "pvp",
    opts.level ?? 6,
    COLOR_ZH_STUB,
    LEVEL_NAMES_STUB,
    opts.confirmResolve ?? null,
    opts.hintInfo ?? null,
    Boolean(opts.hintBusy)
  );
  renderStatus();
  return els;
}

await test("renderStatus announces an insufficient-material draw and locks claim/hint", () => {
  const els = runRenderStatus({
    gameOverInfo: { status: "insufficient", inCheck: false, winner: null },
    history: [{}, {}, {}],
  });
  assert.equal(els.statusMain.textContent, "子力不足，和棋！");
  assert.ok(els.hintBtn.disabled);
  assert.ok(els.claimDrawBtn.classList.has("hidden"));
});

await test("renderStatus shows the claim affordance exactly while a draw is claimable and idle", () => {
  const els = runRenderStatus({
    claimable: { threefold: true, fiftyMove: false },
    mode: "pvp",
  });
  assert.ok(els.statusSub.textContent.includes("可宣告和棋"));
  assert.equal(els.claimDrawBtn.classList.has("hidden"), false);
  assert.equal(els.hintBtn.disabled, false);

  const busy = runRenderStatus({
    claimable: { threefold: true, fiftyMove: true },
    aiBusy: true,
    mode: "pvp",
  });
  assert.ok(busy.claimDrawBtn.classList.has("hidden"), "AI 思考中不得開放宣告");
  assert.ok(busy.hintBtn.disabled, "AI 思考中不得提示");
  assert.equal(busy.thinkingBadge.classList.has("hidden"), false);
});

await test("renderStatus renders claimed fifty-move draw text", () => {
  const els = runRenderStatus({
    gameOverInfo: { status: "claim", claimKind: "fiftyMove", inCheck: false, winner: null },
    history: [{}],
  });
  assert.equal(els.statusMain.textContent, "五十步規則，宣告和棋成立");
});

await test("renderStatus presents hint suggestion without hiding other info", () => {
  const els = runRenderStatus({
    hintInfo: { san: "Nf3", move: { from: [7, 6], to: [5, 5] } },
  });
  assert.ok(els.statusMain.textContent.includes("（建議：Nf3）"));
  assert.ok(els.statusMain.textContent.includes("輪到白方行棋"));
  assert.equal(els.hintBtn.disabled, false);

  const analyzing = runRenderStatus({ hintBusy: true });
  assert.ok(analyzing.statusSub.textContent.includes("提示分析中…"));
  assert.ok(analyzing.hintBtn.disabled);
});

await test("renderStatus disables hints while busy, terminal, promo, confirm, or AI turn", () => {
  const base = { mode: "ai", state: { fullmoveNumber: 2, turn: "w" } };
  assert.equal(runRenderStatus(base).hintBtn.disabled, false);
  assert.ok(runRenderStatus({ ...base, aiBusy: true }).hintBtn.disabled);
  assert.ok(
    runRenderStatus({
      ...base,
      gameOverInfo: { status: "fivefold", inCheck: false, winner: null },
    }).hintBtn.disabled
  );
  assert.ok(runRenderStatus({ ...base, pendingPromotion: { candidates: [] } }).hintBtn.disabled);
  assert.ok(runRenderStatus({ ...base, confirmResolve: () => {} }).hintBtn.disabled);
  assert.ok(
    runRenderStatus({ ...base, state: { fullmoveNumber: 2, turn: "b" } }).hintBtn.disabled
  );
});

// ---------- 提示（L7 建議）：不落子、可取消、過期不渲染 ----------

await test("hint wiring: fixed L7 level, triple-stale guard, never applies a move", () => {
  assert.match(appSrc, /const HINT_LEVEL = 7;/);
  const src = extractBetween("function requestHint(", "\nfunction ");
  assert.match(src, /AiClient\.solve\(snapState, HINT_LEVEL/);
  assert.match(src, /gen !== gameGeneration/);
  assert.match(src, /reqId !== hintRequestSeq/);
  assert.match(src, /snapState !== state/);
  assert.match(src, /gameOverInfo/);
  assert.doesNotMatch(src, /applyMove|executeMove/, "hint must not apply a move");
});

await test("superseding paths invalidate hints and free the shared worker", () => {
  const execSrc = extractBetween("function executeMove(", "\nfunction ");
  assert.match(execSrc, /stopHintComputation\(\)/);
  const undoSrc = extractBetween("function undoPlies(", "\nfunction ");
  assert.match(undoSrc, /stopHintComputation\(\)/);
  const resetSrc = extractBetween("function doReset(", "\nfunction ");
  assert.match(resetSrc, /stopHintComputation\(\)/);
  assert.match(resetSrc, /AiClient\.cancelAll\(\)/);
  const claimSrc = extractBetween("function applyClaimDraw(", "\nfunction ");
  assert.match(claimSrc, /stopHintComputation\(\)/);
  const stopSrc = extractBetween("function stopHintComputation(", "\nfunction ");
  assert.match(stopSrc, /AiClient\.cancelAll\(\)/, "a running hint job must release the worker");
});

await test("init wires the 提示 button click to requestHint", () => {
  const start = appSrc.indexOf("function init(");
  assert.ok(start !== -1, "init() not found");
  const next = appSrc.indexOf("\nfunction ", start + 1);
  const initSrc = appSrc.slice(start, next === -1 ? appSrc.length : next);
  assert.match(initSrc, /els\.hintBtn\.addEventListener\(\s*"click"/);
  assert.match(initSrc, /requestHint\(\)/);
});

await test("clean level change invalidates hints and immediately re-renders", async () => {
  const src = extractBetween("async function requestLevelChange(", "\nfunction ");
  const build = (isDirtyResult) =>
    new Function(
      "level",
      "LEVEL_NAMES",
      "isDirty",
      "showConfirm",
      "syncControls",
      "doReset",
      "stopHintComputation",
      "render",
      "AiClient",
      `${src}\nreturn requestLevelChange;`
    )(
      6,
      ["入門", "初學", "見習", "業餘", "進階", "認真", "強手", "大師", "教頭", "冠軍"],
      () => isDirtyResult,
      async () => true,
      () => calls.push("sync"),
      () => calls.push("reset"),
      () => calls.push("hintStop"),
      () => calls.push("render"),
      { warm: () => calls.push("warm") }
    );

  let calls = [];
  await build(false)(8); // 局面未動：不得重開新局，但必須清掉提示並立即重繪
  assert.ok(calls.includes("hintStop"), "clean level change must invalidate hints");
  assert.ok(calls.includes("sync"), "controls must be synced");
  assert.ok(!calls.includes("reset"), "clean level change must not reset the game");
  assert.ok(
    calls.includes("render"),
    "clean level change must render the cleared hint/status immediately"
  );
  assert.ok(calls.includes("warm"), "selected engine should be warmed before the next move");
  assert.ok(
    calls.indexOf("hintStop") < calls.indexOf("render"),
    "the cleared state must be what gets rendered"
  );

  // 對照組：對局已動且確認後走 doReset，由 doReset 負責清提示與取消 AI
  calls = [];
  await build(true)(9);
  assert.ok(calls.includes("reset"));
  assert.ok(calls.includes("warm"));
});

await test("board rendering marks hint origin/destination squares distinctly", () => {
  const boardSrc = extractBetween("function renderBoardOnly(", "\nfunction ");
  assert.match(boardSrc, /hintInfo/);
  assert.match(boardSrc, /classes\.push\("hint-move"\)/);
});

await test("index.html exposes the 提示 button and claim button", () => {
  assert.match(htmlSrc, /id="hintBtn"[^>]*>提示<\/button>/);
  assert.match(htmlSrc, /id="claimDrawBtn"/);
});

await test("documented FIDE boundary: claims resolve on the current position only", () => {
  assert.match(appSrc, /在執行預期著法/);
});

await test("L6-L10 white wins pass nested moves to the shared leaderboard controller", () => {
  const src = extractBetween("function updateResultPanel(", "\nfunction ");
  assert.match(src, /isLeaderboardLevel\(level\)/);
  assert.match(src, /leaderboard\.showWin/);
  assert.match(src, /moves:\s*history\.map\(\(entry\)\s*=>\s*moveToUci\(entry\.move\)\)/);
});

await test("savePrivatePgn downloads locally with generic White tag and never touches network", async () => {
  const src = extractBetween("function savePrivatePgn(", "\nfunction ");
  assert.ok(src.includes("triggerDownload"), "extraction sanity");
  const els = { statusSub: { textContent: "" } };

  function build(over) {
    const downloads = [];
    const triggerDownload = (filename, content) =>
      downloads.push({ filename, content });
    const fetchSpy = () => {
      throw new Error("私人棋譜不得進行任何網路存取");
    };
    const savePrivatePgn = new Function(
      "gameOverInfo",
      "history",
      "level",
      "buildPgn",
      "DEFAULT_PRIVATE_WHITE",
      "localDateDot",
      "triggerDownload",
      "els",
      "fetch",
      `${src}\nreturn savePrivatePgn;`
    )(
      over.gameOverInfo ?? null,
      over.history ?? [],
      over.level ?? 8,
      buildPgn,
      DEFAULT_PRIVATE_WHITE,
      () => "2026.08.23",
      triggerDownload,
      els,
      fetchSpy
    );
    return { savePrivatePgn, downloads };
  }

  // 正常路徑：白方將死後，於本機產生並下載 PGN（White 為通用「玩家」）
  const { savePrivatePgn, downloads } = build({
    gameOverInfo: { status: "checkmate", winner: "w", inCheck: false },
    history: [
      { before: {}, move: {}, san: "e4" },
      { before: {}, move: {}, san: "c5" },
      { before: {}, move: {}, san: "Qh5#" },
    ],
  });
  savePrivatePgn();
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].filename, "oxalpha-private-L8-20260823.pgn");
  assert.ok(downloads[0].content.includes('[White "玩家"]'));
  assert.ok(!downloads[0].content.includes("阿明"), "private PGN must not reuse public nickname");
  assert.ok(downloads[0].content.trimEnd().endsWith("1-0"));
  assert.ok(els.statusSub.textContent.includes("僅存於此裝置"));

  // 非將死／無歷史：早退，不產生下載、不連網
  const idle = build({ gameOverInfo: null, history: [{ san: "e4" }] });
  idle.savePrivatePgn();
  const noHistory = build({
    gameOverInfo: { status: "checkmate", winner: "w", inCheck: false },
    history: [],
  });
  noHistory.savePrivatePgn();
  assert.equal(idle.downloads.length, 0);
  assert.equal(noHistory.downloads.length, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) {
    console.error(`failed: ${f.name}`);
  }
  process.exitCode = 1;
}
