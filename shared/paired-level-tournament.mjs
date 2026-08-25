// Shared result accounting for the Node-only Chess and Xiangqi level audits.
// Every pairing receives identical opening positions and swaps colours, so the
// score describes the level profiles rather than an accidental first-move edge.

export function normalizeLevel(level) {
  const text = String(level).trim().toLowerCase();
  const value = /^l?(10|[1-9])$/.test(text) ? Number(text.replace(/^l/, "")) : NaN;
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    throw new Error(`Unknown level: ${String(level)}`);
  }
  return `l${value}`;
}

export function levelNumber(level) {
  return Number(normalizeLevel(level).slice(1));
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

function addResult(record, game, level) {
  if (game.invalid) {
    record.invalid += 1;
    return;
  }
  if (game.winner === "draw") {
    record.draws += 1;
    record.points += 0.5;
    return;
  }
  const won = (game.winner === "white" && game.white === level)
    || (game.winner === "black" && game.black === level);
  if (won) {
    record.wins += 1;
    record.points += 1;
  } else {
    record.losses += 1;
  }
}

export function planPairedGames(levels, openings) {
  const normalized = levels.map(normalizeLevel);
  if (normalized.length < 2 || new Set(normalized).size !== normalized.length) {
    throw new Error("Tournament levels must contain at least two unique levels");
  }
  if (!Array.isArray(openings) || openings.length === 0) {
    throw new Error("Tournament needs at least one opening");
  }
  const plans = [];
  for (let leftIndex = 0; leftIndex < normalized.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < normalized.length; rightIndex += 1) {
      const left = normalized[leftIndex];
      const right = normalized[rightIndex];
      for (const opening of openings) {
        for (const swapped of [false, true]) {
          plans.push(Object.freeze({
            id: `${left}-vs-${right}-${opening.id}-${swapped ? "swap" : "base"}`,
            openingId: opening.id,
            opening: opening.moves,
            white: swapped ? right : left,
            black: swapped ? left : right,
          }));
        }
      }
    }
  }
  return plans;
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

export function summarizeTournament(levels, games) {
  const normalized = levels.map(normalizeLevel);
  const headToHead = [];
  for (let leftIndex = 0; leftIndex < normalized.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < normalized.length; rightIndex += 1) {
      const left = normalized[leftIndex];
      const right = normalized[rightIndex];
      const pairGames = games.filter((game) => game.white === left && game.black === right
        || game.white === right && game.black === left);
      headToHead.push(summarizePair(left, right, pairGames));
    }
  }
  const standings = new Map(normalized.map((level) => [level, blankRecord(level)]));
  for (const game of games) {
    addResult(standings.get(game.white), game, game.white);
    addResult(standings.get(game.black), game, game.black);
  }
  const ranking = [...standings.values()]
    .map((record) => ({ ...record, games: record.wins + record.draws + record.losses }))
    .sort((left, right) => right.points - left.points || levelNumber(right.level) - levelNumber(left.level));
  return { headToHead, ranking, verification: verifyExpectedOrder(normalized, headToHead) };
}

export function verifyExpectedOrder(levels, headToHead) {
  const expected = [...levels].map(normalizeLevel).sort((left, right) => levelNumber(right) - levelNumber(left));
  const byKey = new Map(headToHead.map((entry) => [entry.key, entry]));
  const comparisons = [];
  for (let strongerIndex = 0; strongerIndex < expected.length; strongerIndex += 1) {
    for (let weakerIndex = strongerIndex + 1; weakerIndex < expected.length; weakerIndex += 1) {
      const stronger = expected[strongerIndex];
      const weaker = expected[weakerIndex];
      const entry = byKey.get(`${weaker}-vs-${stronger}`) ?? byKey.get(`${stronger}-vs-${weaker}`);
      if (!entry) {
        comparisons.push({ stronger, weaker, status: "missing", games: 0, score: 0, lowerBound95: 0, passed: false });
        continue;
      }
      const record = entry.left.level === stronger ? entry.left : entry.right;
      const score = entry.validGames ? record.points / entry.validGames : 0;
      const lowerBound95 = wilsonLowerBound(record.points, entry.validGames);
      const passed = entry.invalidGames === 0 && score > 0.5 && lowerBound95 > 0.5;
      comparisons.push({
        stronger,
        weaker,
        games: entry.games,
        validGames: entry.validGames,
        invalidGames: entry.invalidGames,
        score,
        lowerBound95,
        passed,
        status: passed ? "passed" : score <= 0.5 ? "failed" : "inconclusive",
      });
    }
  }
  const passed = comparisons.length > 0 && comparisons.every((comparison) => comparison.passed);
  const failed = comparisons.some((comparison) => comparison.status === "failed" || comparison.status === "missing");
  return {
    expected,
    comparisons,
    passed,
    status: passed ? "passed" : failed ? "failed" : "inconclusive",
  };
}
