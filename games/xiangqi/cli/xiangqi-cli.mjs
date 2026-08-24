/**
 * cli/xiangqi-cli.mjs — 命令列對弈與循環賽（與瀏覽器共用規則/AI/記譜模組）。
 *
 * 用法：
 *   node cli/xiangqi-cli.mjs help
 *   node cli/xiangqi-cli.mjs play [--level N] [--side red|black] [--max-nodes N]
 *   node cli/xiangqi-cli.mjs tournament --a N --b N [--rounds R] [--max-plies P] [--verbose]
 *
 * play 指令：board|d  moves|l [sq]  move|m <著法>  hint|h  undo|u
 *            status|s  new|n  resign|r  quit|q  help|?
 */

import { pathToFileURL } from "node:url";
import {
  createInitialState,
  getLegalMoves,
  getGameStatus,
  applyMove,
  pieceGlyph,
} from "../xiangqi-rules.mjs";
import { chooseMove, levelConfig, MIN_LEVEL, MAX_LEVEL } from "../xiangqi-ai.mjs";
import {
  formatChineseMove,
  formatCoordinateMove,
  parseMoveText,
} from "../xiangqi-notation.mjs";

/* ------------------------------ 參數解析 ------------------------------ */

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      out._.push(token);
      continue;
    }
    let key = token.slice(2);
    let value = true;
    const eq = key.indexOf("=");
    if (eq >= 0) {
      value = key.slice(eq + 1);
      key = key.slice(0, eq);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      value = argv[i + 1];
      i += 1;
    }
    out[key] = value;
  }
  return out;
}

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function clampLevel(value) {
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, toInt(value, 4)));
}

/* ------------------------------ 棋盤顯示 ------------------------------ */

const FILE_LETTERS = "abcdefghi";

function squareIccs(row, col) {
  return `${FILE_LETTERS[col]}${10 - row}`;
}

function renderBoardAscii(state) {
  const lines = [];
  lines.push("　  a  b  c  d  e  f  g  h  i");
  for (let row = 0; row < 10; row += 1) {
    const cells = [];
    for (let col = 0; col < 9; col += 1) {
      const piece = state.board[row][col];
      cells.push(piece ? pieceGlyph(piece) : "・");
    }
    lines.push(`${String(10 - row).padStart(2)} ${cells.join("  ")}`);
  }
  lines.push("（紅在下、黑在上；紅以漢字紅方用字顯示）");
  return lines.join("\n");
}

/* ------------------------------ 對局狀態 ------------------------------ */

class GameSession {
  constructor({ level = 4, humanSide = "red", maxNodes }) {
    this.level = clampLevel(level);
    this.humanSide = humanSide;
    this.maxNodes = maxNodes;
    this.history = []; // { before, move, chinese, coordinate }
    this.state = createInitialState();
    this.result = null;
  }

  reset() {
    this.history = [];
    this.state = createInitialState();
    this.result = null;
  }

  legalMoves() {
    return getLegalMoves(this.state);
  }

  /** 套用合法著法並推進；回傳中文記法。 */
  apply(move) {
    const chinese = formatChineseMove(this.state, move);
    const coordinate = formatCoordinateMove(move);
    this.history.push({ before: this.state, move, chinese, coordinate });
    this.state = applyMove(this.state, move);
    return { chinese, coordinate };
  }

  undoOnePly() {
    if (!this.history.length) return false;
    const entry = this.history.pop();
    this.state = entry.before;
    this.result = null;
    return true;
  }

  checkEnd() {
    if (this.result) return this.result;
    const status = getGameStatus(this.state);
    if (status.status === "checkmate") {
      this.result = `${status.winner === "red" ? "紅方" : "黑方"}勝 · 將死`;
    } else if (status.status === "stalemate") {
      // 中國象棋規則：困斃的一方判負。
      this.result = `${status.winner === "red" ? "紅方" : "黑方"}勝 · 困斃`;
    }
    return this.result;
  }

  aiTurnColor() {
    return this.humanSide === "red" ? "black" : "red";
  }
}

/* ------------------------------- play -------------------------------- */

function printPlayHelp() {
  console.log([
    "指令：",
    "  board | d        顯示棋盤",
    "  moves | l [sq]   列出合法著法（可加起點座標過濾，如 l h3）",
    "  move  | m <著法> 走子，接受座標（h3-e3 / h3e3）或中文記法（炮二平五）",
    "  hint  | h        AI 提示建議著法",
    "  undo  | u        悔棋一著（人機模式連 AI 回合一併退回）",
    "  status | s       目前輪到誰、是否被將軍、手數",
    "  new   | n        重開新局",
    "  resign | r       認輸結束本局",
    "  quit  | q        離開",
    "  help  | ?        本說明",
  ].join("\n"));
}

/** 無損逐行讀取器：自行緩衝，避免一次湧入的多行輸入被 readline 丢弃。 */
async function* readLines(readable) {
  let buffer = "";
  for await (const chunk of readable) {
    buffer += chunk.toString("utf8");
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      yield buffer.slice(0, newlineIndex).replace(/\r$/, "");
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
  }
  if (buffer.trim()) yield buffer.replace(/\r$/, "");
}

async function cmdPlay(args) {
  const level = clampLevel(args.level ?? 4);
  const sideArg = String(args.side ?? "red").toLowerCase();
  const humanSide = sideArg === "black" ? "black" : "red";
  const maxNodes = args["max-nodes"] ? toInt(args["max-nodes"], undefined) : undefined;
  const session = new GameSession({ level, humanSide, maxNodes });
  const lineIterator = readLines(process.stdin);
  const nextLine = async () => (await lineIterator.next()).value ?? "";
  const aiName = `L${level} AI`;

  console.log(`楚河漢界 · 象棋衝鋒社 CLI — 人機對弈（你執${humanSide === "red" ? "紅" : "黑"}，AI 為 ${aiName}）`);
  console.log(renderBoardAscii(session.state));
  printPlayHelp();

  const runAiIfNeeded = async () => {
    while (!session.checkEnd() && session.state.turn !== session.humanSide) {
      process.stdout.write(`〔${aiName} 思考中…〕\n`);
      const options = maxNodes ? { maxNodes } : {};
      const { move, meta } = chooseMove(session.state, session.level, options);
      if (!move) break;
      const applied = session.apply(move);
      console.log(`${aiName} 落子：${applied.chinese}（${applied.coordinate}）　評估=${meta.score}　深度=${meta.depth}　節點=${meta.nodes}`);
      console.log(renderBoardAscii(session.state));
    }
    const end = session.checkEnd();
    if (end) console.log(`【終局】${end}`);
  };

  if (session.state.turn !== session.humanSide) await runAiIfNeeded();

  while (true) {
    process.stdout.write(`輪到你（${session.state.turn === "red" ? "紅" : "黑"}）> `);
    const line = (await nextLine()).trim();
    if (!line) break; // EOF
    const [rawCmd, ...rest] = line.split(/\s+/);
    const cmd = rawCmd.toLowerCase();
    const argText = rest.join(" ");

    if (cmd === "quit" || cmd === "q" || cmd === "exit") break;

    if (cmd === "help" || cmd === "?") {
      printPlayHelp();
      continue;
    }
    if (cmd === "board" || cmd === "d") {
      console.log(renderBoardAscii(session.state));
      continue;
    }
    if (cmd === "moves" || cmd === "l") {
      const all = session.legalMoves();
      const filtered = argText
        ? all.filter((m) => squareIccs(m.from.row, m.from.col).toLowerCase().startsWith(argText.toLowerCase()))
        : all;
      for (const m of filtered) {
        console.log(`  ${formatChineseMove(session.state, m)}　${formatCoordinateMove(m)}`);
      }
      console.log(`共 ${filtered.length}/${all.length}著。`);
      continue;
    }
    if ((cmd === "move" || cmd === "m") && argText) {
      if (session.checkEnd()) {
        console.log(`本局已結束（${session.result}），請用 n 開新局。`);
        continue;
      }
      if (session.state.turn !== session.humanSide) {
        console.log("還在等待 AI 回合。");
        continue;
      }
      const move = parseMoveText(session.state, argText);
      if (!move) {
        console.log(`無效或不合法的著法：「${argText}」。可用 moves 查詢。`);
        continue;
      }
      const applied = session.apply(move);
      console.log(`你落子：${applied.chinese}（${applied.coordinate}）`);
      console.log(renderBoardAscii(session.state));
      const end = session.checkEnd();
      if (end) {
        console.log(`【終局】${end}`);
        continue;
      }
      await runAiIfNeeded();
      continue;
    }
    if (cmd === "hint" || cmd === "h") {
      const { move, meta } = chooseMove(session.state, session.level, maxNodes ? { maxNodes } : {});
      if (move) {
        console.log(`建議：${formatChineseMove(session.state, move)}（${formatCoordinateMove(move)}）評估=${meta.score}`);
      } else {
        console.log("已無合法著法。");
      }
      continue;
    }
    if (cmd === "undo" || cmd === "u") {
      if (!session.history.length) {
        console.log("沒有著法可悔。");
        continue;
      }
      session.undoOnePly();
      if (humanSide === "red" && session.history.length && session.state.turn !== session.humanSide) {
        session.undoOnePly();
      }
      console.log("已悔棋。");
      console.log(renderBoardAscii(session.state));
      continue;
    }
    if (cmd === "status" || cmd === "s") {
      const status = getGameStatus(session.state);
      console.log([
        `輪到：${session.state.turn === "red" ? "紅方" : "黑方"}`,
        `被將軍：${status.inCheck ? "是" : "否"}`,
        `手數：${session.history.length}`,
        session.result ? `結果：${session.result}` : null,
      ].filter(Boolean).join("　"));
      continue;
    }
    if (cmd === "new" || cmd === "n") {
      session.reset();
      console.log("新局開始，紅方先行。");
      console.log(renderBoardAscii(session.state));
      if (session.state.turn !== session.humanSide) await runAiIfNeeded();
      continue;
    }
    if (cmd === "resign" || cmd === "r") {
      const winner = session.humanSide === "red" ? "黑方" : "紅方";
      session.result = `${winner}勝 · 對手認輸`;
      console.log(`【終局】${session.result}`);
      continue;
    }
    console.log(`未知指令：「${rawCmd}」。輸入 help 查看說明。`);
  }

  console.log("再會！楚河漢界，後會有期。");
}

/* ----------------------------- tournament ----------------------------- */

const MATERIAL_FOR_SCORE = Object.freeze({
  general: 100000, rook: 900, cannon: 450, horse: 400, advisor: 200, elephant: 200, soldier: 100,
});

function materialBalance(state) {
  let score = 0;
  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const p = state.board[row][col];
      if (!p) continue;
      score += (p.color === "red" ? 1 : -1) * MATERIAL_FOR_SCORE[p.type];
    }
  }
  return score;
}

function playTournamentGame(redLevel, blackLevel, maxPlies, verbose) {
  const session = new GameSession({ level: redLevel, humanSide: "none" });
  let plies = 0;
  while (!session.checkEnd()) {
    if (plies >= maxPlies) {
      const balance = materialBalance(session.state);
      if (balance > 150) session.result = "紅方勝 · 子力裁定";
      else if (balance < -150) session.result = "黑方勝 · 子力裁定";
      else session.result = "和局 · 步數上限";
      break;
    }
    const turnLevel = session.state.turn === "red" ? redLevel : blackLevel;
    const { move } = chooseMove(session.state, turnLevel);
    if (!move) break;
    const applied = session.apply(move);
    plies += 1;
    if (verbose) console.log(`    ${plies}. ${session.state.turn === "red" ? "黑" : "紅"} ${applied.chinese} (${applied.coordinate})`);
  }
  return { result: session.checkEnd(), plies };
}

function cmdTournament(args) {
  const a = clampLevel(args.a ?? 2);
  const b = clampLevel(args.b ?? 4);
  const rounds = Math.max(1, toInt(args.rounds ?? 1, 1));
  const maxPlies = Math.max(10, toInt(args["max-plies"] ?? 160, 160));
  const verbose = Boolean(args.verbose);

  console.log(`循環賽：L${a} vs L${b}，進行 ${rounds} 輪（每輪互換先後手），步數上限 ${maxPlies}。`);
  const tally = {
    [`L${a}`]: { name: `L${a}`, win: 0, draw: 0, loss: 0 },
    [`L${b}`]: { name: `L${b}`, win: 0, draw: 0, loss: 0 },
  };
  const recordOutcome = (winnerLabel /* 'a' | 'b' | null */) => {
    if (winnerLabel === "a") { tally[`L${a}`].win += 1; tally[`L${b}`].loss += 1; }
    else if (winnerLabel === "b") { tally[`L${b}`].win += 1; tally[`L${a}`].loss += 1; }
    else { tally[`L${a}`].draw += 1; tally[`L${b}`].draw += 1; }
  };

  let gameNo = 0;
  for (let round = 1; round <= rounds; round += 1) {
    const pairs = [
      { red: ["a", a], black: ["b", b] },
      { red: ["b", b], black: ["a", a] },
    ];
    for (const pair of pairs) {
      gameNo += 1;
      const startedAt = Date.now();
      const { result, plies } = playTournamentGame(pair.red[1], pair.black[1], maxPlies, verbose);
      const ms = Date.now() - startedAt;
      console.log(`第${gameNo}局　L${pair.red[1]}(紅) vs L${pair.black[1]}(黑) → ${result}　${plies}半回合　${ms}ms`);
      if (result.startsWith("紅方勝")) recordOutcome(pair.red[0]);
      else if (result.startsWith("黑方勝")) recordOutcome(pair.black[0]);
      else recordOutcome(null);
    }
  }

  console.log("");
  console.log("最終積分（勝2 和1 敗0）：");
  for (const entry of Object.values(tally)) {
    const points = entry.win * 2 + entry.draw;
    console.log(`  ${entry.name.padEnd(4)} 勝${entry.win} 和${entry.draw} 敗${entry.loss}　積分 ${points}`);
  }
}

/* ------------------------------- 主入口 ------------------------------- */

function printMainHelp() {
  console.log([
    "楚河漢界 · 象棋衝鋒社 CLI",
    "",
    "用法：node cli/xiangqi-cli.mjs <指令>",
    "",
    "指令：",
    "  play        與 AI 對弈（--level 1-10，--side red|black）",
    "  tournament  兩個 AI 循環賽（--a N --b N --rounds R --max-plies P --verbose）",
    "  levels      顯示 L1-L10 各等級搜尋參數",
    "  help        本說明",
  ].join("\n"));
}

export function main(argv = process.argv.slice(2)) {
  const command = (argv[0] ?? "help").toLowerCase();
  switch (command) {
    case "play":
      return cmdPlay(parseArgs(argv.slice(1))).catch((error) => {
        console.error("play 發生錯誤：", error);
        process.exitCode = 1;
      });
    case "tournament":
      cmdTournament(parseArgs(argv.slice(1)));
      return Promise.resolve();
    case "levels":
      for (let lv = MIN_LEVEL; lv <= MAX_LEVEL; lv += 1) {
        const cfg = levelConfig(lv);
        console.log(`L${String(lv).padStart(2)} 深度=${cfg.depth} 靜態搜尋=${cfg.quiescence} 節點預算=${cfg.maxNodes}${cfg.materialOnly ? " （僅物質評估）" : ""}`);
      }
      return Promise.resolve();
    case "help":
    default:
      printMainHelp();
      return Promise.resolve();
  }
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main();
}
