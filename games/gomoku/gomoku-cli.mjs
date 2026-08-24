#!/usr/bin/env node
// Usage examples:
//   node gomoku-cli.mjs play --black l3 --white l1 --seed 42
//   node gomoku-cli.mjs tournament --levels l1,l2,l3,l4,l5,l6,l7,l8,l9,l10 --games 8 --symmetries 8 --verify-order --json results/l1-l10.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getLevelProfile, normalizeLevel } from './gomoku-levels.mjs';
import { generateOpening } from './gomoku-rules.mjs';
import { playGame } from './gomoku-match.mjs';
import { runTournament } from './gomoku-tournament.mjs';

const HELP = `
五子棋 AI CLI（直接重用 app 的 L1-L10 演算法）

  node gomoku-cli.mjs play --black l3 --white l1 [--seed 42] [--opening-plies 4] [--symmetry 0] [--json result.json]
  node gomoku-cli.mjs tournament --levels l1,l2,l3,l4,l5,l6,l7,l8,l9,l10 [--games 4] [--seed 42] [--opening-plies 4] [--symmetries 1] [--verify-order] [--json result.json]

說明：
  - 每個 opening 都會交換一次黑白；而且每個等級 pair 共用同一組 opening，避免抽樣局面影響排名。
  - --games 是每個 pair 的 opening 數；實際對局數為 pairs × games × 2。
  - CLI 用固定難度 profile，不依本機 wall-clock 計時，走子可重現；--verify-order 只有在所有強級對弱級的 95% 下界 > 50% 時才回傳成功。
  - 可用等級：l1 到 l10（也可寫成 1 到 10）。
`;

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index++) {
    const token = rest[index];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const equals = token.indexOf('=');
    if (equals >= 0) {
      options[token.slice(2, equals)] = token.slice(equals + 1);
      continue;
    }
    const key = token.slice(2);
    const next = rest[index + 1];
    if (next === undefined || next.startsWith('--')) {
      options[key] = true;
    } else {
      options[key] = next;
      index++;
    }
  }
  return { command, options };
}

function integerOption(options, key, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = options[key] ?? fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`--${key} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function levelOption(value, fallback) {
  const raw = value ?? fallback;
  const levels = String(raw).split(',').map((item) => normalizeLevel(item));
  if (!levels.length || new Set(levels).size !== levels.length) {
    throw new Error('--levels must contain at least one distinct level');
  }
  levels.forEach(getLevelProfile);
  return levels;
}

function writeJsonIfRequested(result, outputPath) {
  if (!outputPath || outputPath === true) return;
  const fullPath = resolve(String(outputPath));
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(`JSON written: ${fullPath}`);
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function printGame(result, verbose) {
  console.log(`${result.black} (black) vs ${result.white} (white): ${result.winner} · ${result.reason} · ${result.plies} plies`);
  if (result.invalid) console.log(`INVALID: ${result.error?.message ?? 'invalid game'}`);
  if (verbose) {
    for (const move of result.moves) {
      console.log(`${String(move.ply).padStart(3, ' ')}  ${move.player.padEnd(5)}  (${move.row + 1}, ${move.col + 1})${move.opening ? ' opening' : ` ${move.level}`}`);
    }
  }
}

function printTournament(result) {
  console.log(`\n${result.games.length} games · engine ${result.engine.version} · deterministic=${result.engine.deterministic}`);
  console.log(`${result.openingSchedule.length} shared openings · every opening is color-paired`);
  console.log('Ranking');
  result.ranking.forEach((entry, index) => {
    console.log(`${index + 1}. ${entry.level}  ${entry.points.toFixed(1)} pts  W${entry.wins} D${entry.draws} L${entry.losses} invalid=${entry.invalid}`);
  });
  console.log('\nHead to head');
  for (const entry of result.headToHead) {
    console.log(`${entry.left.level} vs ${entry.right.level}: ${percent(entry.leftScore)} / ${percent(entry.rightScore)}  (${entry.validGames}/${entry.games} valid)`);
  }
  console.log(`\nOrder verification: ${result.verification.status.toUpperCase()}`);
  for (const check of result.verification.comparisons) {
    console.log(`${check.stronger} > ${check.weaker}: score=${percent(check.score)}, lower95=${percent(check.lowerBound95)}, ${check.status}`);
  }
}

function runPlay(options) {
  const black = normalizeLevel(options.black ?? 'l3');
  const white = normalizeLevel(options.white ?? 'l1');
  const seed = integerOption(options, 'seed', 1, { min: 0, max: 0xFFFFFFFF });
  const openingPlies = integerOption(options, 'opening-plies', 4, { min: 0, max: 20 });
  const symmetry = integerOption(options, 'symmetry', 0, { min: 0, max: 7 });
  const opening = generateOpening({ seed, plies: openingPlies, symmetry });
  const result = playGame({
    id: `play-${black}-vs-${white}-seed${seed}-s${symmetry}`,
    black,
    white,
    seed,
    openingId: `seed${seed}-s${symmetry}`,
    opening,
    context: 'tournament',
  });
  printGame(result, Boolean(options.verbose));
  writeJsonIfRequested(result, options.json);
  return result;
}

function runRoundRobin(options) {
  const levels = levelOption(options.levels, 'l1,l2,l3,l4,l5,l6,l7,l8,l9,l10');
  const gamesPerPair = integerOption(options, 'games', 4, { min: 1, max: 10_000 });
  const seed = integerOption(options, 'seed', 1, { min: 0, max: 0xFFFFFFFF });
  const openingPlies = integerOption(options, 'opening-plies', 4, { min: 0, max: 20 });
  const symmetries = integerOption(options, 'symmetries', 1, { min: 1, max: 8 });
  const result = runTournament({ levels, gamesPerPair, seed, openingPlies, symmetries });
  printTournament(result);
  writeJsonIfRequested(result, options.json);
  if (options['verify-order'] && !result.verification.passed) process.exitCode = 2;
  return result;
}

function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (!command || command === 'help' || options.help) {
    console.log(HELP.trim());
    return;
  }
  if (command === 'play' || command === 'match') {
    runPlay(options);
    return;
  }
  if (command === 'tournament' || command === 'round-robin') {
    runRoundRobin(options);
    return;
  }
  throw new Error(`unknown command: ${command}\n\n${HELP.trim()}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
