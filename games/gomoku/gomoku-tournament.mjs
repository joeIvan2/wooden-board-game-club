// Deterministic, color-paired round-robin utilities for the ten difficulty levels.
import { AI_ENGINE_VERSION, getLevelProfile, normalizeLevel } from './gomoku-levels.mjs';
import { generateOpening } from './gomoku-rules.mjs';
import { playGame } from './gomoku-match.mjs';

const levelNumber = (level) => getLevelProfile(level).level;

function tournamentInteger(value, name, { min = 0, max = 0xFFFFFFFF } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

// Every strength pairing receives this exact same opening schedule.  This makes
// a tournament comparable when levels are added, removed, or reordered: only
// the two AI profiles differ, never the sampled positions.  Each schedule entry
// is subsequently played twice with black and white swapped.
export function buildOpeningSchedule(options = {}) {
  const gamesPerPair = tournamentInteger(options.gamesPerPair ?? 4, 'gamesPerPair', { min: 1, max: 10_000 });
  const openingPlies = tournamentInteger(options.openingPlies ?? 4, 'openingPlies', { min: 0, max: 20 });
  if (openingPlies % 2 !== 0) throw new Error('openingPlies must be even so black is to move');
  const symmetries = tournamentInteger(options.symmetries ?? 1, 'symmetries', { min: 1, max: 8 });
  const seed = tournamentInteger(options.seed ?? 1, 'seed');

  return Array.from({ length: gamesPerPair }, (_, gameIndex) => {
    const symmetry = gameIndex % symmetries;
    // Uint32 wrapping mirrors generateOpening's seeded RNG normalization and
    // keeps schedules reproducible at the upper edge of the CLI seed range.
    const openingSeed = (seed + gameIndex) >>> 0;
    return Object.freeze({
      id: `o${gameIndex + 1}-s${symmetry}`,
      seed: openingSeed,
      symmetry,
      opening: Object.freeze(generateOpening({ seed: openingSeed, plies: openingPlies, symmetry })),
    });
  });
}

export function wilsonLowerBound(score, games, z = 1.96) {
  if (!Number.isFinite(score) || !Number.isFinite(games) || games <= 0) return 0;
  const p = Math.min(1, Math.max(0, score / games));
  const z2 = z * z;
  const denominator = 1 + z2 / games;
  const center = p + z2 / (2 * games);
  const spread = z * Math.sqrt((p * (1 - p) + z2 / (4 * games)) / games);
  return Math.max(0, (center - spread) / denominator);
}

function blankRecord(level) {
  return { level, wins: 0, draws: 0, losses: 0, invalid: 0, points: 0 };
}

function addResult(record, result, level) {
  if (result.invalid) {
    record.invalid++;
    return;
  }
  if (result.winner === 'draw') {
    record.draws++;
    record.points += 0.5;
  } else if ((result.winner === 'black' && result.black === level)
    || (result.winner === 'white' && result.white === level)) {
    record.wins++;
    record.points += 1;
  } else {
    record.losses++;
  }
}

// Resource profiles only prove a level is stronger when they actually reach
// deeper completed iterations on representative positions. Keep that evidence
// in every headless result without changing the shipped V4 search algorithm.
function summarizeSearchDiagnostics(levels, games) {
  const totals = new Map(levels.map((level) => [level, {
    level,
    searches: 0,
    nodes: 0,
    timedOut: 0,
    totalDepth: 0,
    minDepth: null,
    maxDepth: 0,
  }]));
  for (const game of games) {
    for (const move of game.moves ?? []) {
      if (move.opening || !move.level || !move.search) continue;
      const entry = totals.get(move.level);
      if (!entry) continue;
      const depth = Number(move.search.depth) || 0;
      entry.searches += 1;
      entry.nodes += Number(move.search.nodes) || 0;
      entry.totalDepth += depth;
      entry.minDepth = entry.minDepth === null ? depth : Math.min(entry.minDepth, depth);
      entry.maxDepth = Math.max(entry.maxDepth, depth);
      if (move.search.timedOut) entry.timedOut += 1;
    }
  }
  return Object.fromEntries([...totals.entries()].map(([level, entry]) => [level, {
    ...entry,
    averageDepth: entry.searches ? entry.totalDepth / entry.searches : null,
  }]));
}

function summarizePair(left, right, games) {
  const leftRecord = blankRecord(left);
  const rightRecord = blankRecord(right);
  for (const game of games) {
    addResult(leftRecord, game, left);
    addResult(rightRecord, game, right);
  }
  const validGames = games.length - leftRecord.invalid;
  return {
    key: `${left}-vs-${right}`,
    left: leftRecord,
    right: rightRecord,
    games: games.length,
    validGames,
    invalidGames: leftRecord.invalid,
    leftScore: validGames ? leftRecord.points / validGames : 0,
    rightScore: validGames ? rightRecord.points / validGames : 0,
  };
}

export function verifyExpectedOrder(levels, headToHead) {
  const expected = [...levels].map(normalizeLevel).sort((left, right) => levelNumber(right) - levelNumber(left));
  const byKey = new Map(headToHead.map((entry) => [entry.key, entry]));
  const comparisons = [];
  for (let strongerIndex = 0; strongerIndex < expected.length; strongerIndex++) {
    for (let weakerIndex = strongerIndex + 1; weakerIndex < expected.length; weakerIndex++) {
      const stronger = expected[strongerIndex];
      const weaker = expected[weakerIndex];
      const entry = byKey.get(`${weaker}-vs-${stronger}`) ?? byKey.get(`${stronger}-vs-${weaker}`);
      if (!entry) {
        comparisons.push({ stronger, weaker, status: 'missing', games: 0, score: 0, lowerBound95: 0, passed: false });
        continue;
      }
      const strongerRecord = entry.left.level === stronger ? entry.left : entry.right;
      const validGames = entry.validGames;
      const score = validGames ? strongerRecord.points / validGames : 0;
      const lowerBound95 = wilsonLowerBound(strongerRecord.points, validGames);
      const passed = entry.invalidGames === 0 && score > 0.5 && lowerBound95 > 0.5;
      comparisons.push({
        stronger,
        weaker,
        games: entry.games,
        validGames,
        invalidGames: entry.invalidGames,
        score,
        lowerBound95,
        passed,
        status: passed ? 'passed' : score <= 0.5 ? 'failed' : 'inconclusive',
      });
    }
  }
  const passed = comparisons.length > 0 && comparisons.every((comparison) => comparison.passed);
  const failed = comparisons.some((comparison) => comparison.status === 'failed' || comparison.status === 'missing');
  return {
    expected,
    comparisons,
    passed,
    status: passed ? 'passed' : failed ? 'failed' : 'inconclusive',
  };
}

// Pure pairing planner: every unordered level pair meets once per opening
// entry, and each opening is played twice with colors swapped.  Exposed so
// tests can verify schedule structure without running any games.
export function planTournamentGames(levels, openingSchedule) {
  const normalized = levels.map(normalizeLevel);
  if (normalized.length < 2) throw new Error('tournament needs at least two levels');
  if (new Set(normalized).size !== normalized.length) throw new Error('tournament levels must be unique');
  const plans = [];
  for (let leftIndex = 0; leftIndex < normalized.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < normalized.length; rightIndex++) {
      const left = normalized[leftIndex];
      const right = normalized[rightIndex];
      for (const openingEntry of openingSchedule) {
        for (const swapped of [false, true]) {
          plans.push(Object.freeze({
            id: `${left}-vs-${right}-${openingEntry.id}-${swapped ? 'swap' : 'base'}`,
            seed: openingEntry.seed,
            openingId: openingEntry.id,
            black: swapped ? right : left,
            white: swapped ? left : right,
            opening: openingEntry.opening,
          }));
        }
      }
    }
  }
  return plans;
}

export function runTournament(options = {}) {
  const levels = (options.levels ?? ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l10']).map(normalizeLevel);
  if (levels.length < 2) throw new Error('tournament needs at least two levels');
  if (new Set(levels).size !== levels.length) throw new Error('tournament levels must be unique');
  levels.forEach(getLevelProfile);

  const openingSchedule = buildOpeningSchedule(options);
  const normalizedConfig = {
    gamesPerPair: openingSchedule.length,
    openingPlies: options.openingPlies ?? 4,
    symmetries: options.symmetries ?? 1,
    seed: (options.seed ?? 1) >>> 0,
  };

  const allGames = [];
  const headToHead = [];
  for (let leftIndex = 0; leftIndex < levels.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < levels.length; rightIndex++) {
      const left = levels[leftIndex];
      const right = levels[rightIndex];
      const pairGames = [];
      for (const openingEntry of openingSchedule) {
        for (const swapped of [false, true]) {
          const black = swapped ? right : left;
          const white = swapped ? left : right;
          const result = playGame({
            id: `${left}-vs-${right}-${openingEntry.id}-${swapped ? 'swap' : 'base'}`,
            seed: openingEntry.seed,
            openingId: openingEntry.id,
            black,
            white,
            opening: openingEntry.opening,
            context: 'tournament',
            searchOverrides: options.searchOverrides,
          });
          pairGames.push(result);
          allGames.push(result);
        }
      }
      headToHead.push(summarizePair(left, right, pairGames));
    }
  }

  const standings = new Map(levels.map((level) => [level, blankRecord(level)]));
  for (const game of allGames) {
    for (const level of [game.black, game.white]) addResult(standings.get(level), game, level);
  }
  const ranking = [...standings.values()]
    .map((record) => ({ ...record, games: record.wins + record.draws + record.losses }))
    .sort((left, right) => right.points - left.points || levelNumber(right.level) - levelNumber(left.level));
  const verification = verifyExpectedOrder(levels, headToHead);
  const searchDiagnostics = summarizeSearchDiagnostics(levels, allGames);

  return {
    schemaVersion: 3,
    engine: { version: AI_ENGINE_VERSION, deterministic: true, mode: 'fixed-profile' },
    config: {
      levels,
      ...normalizedConfig,
      pairedColors: true,
      sharedOpeningSchedule: true,
    },
    levelConfigs: Object.fromEntries(levels.map((level) => [level, getLevelProfile(level)])),
    openingSchedule,
    games: allGames,
    headToHead,
    ranking,
    verification,
    searchDiagnostics,
  };
}

export default { buildOpeningSchedule, planTournamentGames, wilsonLowerBound, verifyExpectedOrder, runTournament };
