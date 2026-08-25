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

function scoreForLevel(game, level) {
  if (game.invalid) return null;
  if (game.winner === "draw") return 0.5;
  return (game.winner === "white" && game.white === level)
    || (game.winner === "black" && game.black === level) ? 1 : 0;
}

// A base/swap pair is one observation, not two independent coin flips. This
// prevents a colour-balanced opening from being counted twice by the evidence
// gate and makes a tied pair explicit rather than a misleading hard failure.
function summarizePairedEvidence(left, right, games) {
  const groups = new Map();
  for (const game of games) {
    const id = game.pairId ?? game.openingId ?? "unpaired";
    const group = groups.get(id) ?? { id, games: 0, invalid: false, leftPoints: 0, rightPoints: 0 };
    group.games += 1;
    const leftScore = scoreForLevel(game, left);
    const rightScore = scoreForLevel(game, right);
    if (leftScore === null || rightScore === null) group.invalid = true;
    else {
      group.leftPoints += leftScore;
      group.rightPoints += rightScore;
    }
    groups.set(id, group);
  }

  const complete = [];
  let invalidPairs = 0;
  let incompletePairs = 0;
  for (const group of groups.values()) {
    if (group.invalid) {
      invalidPairs += 1;
      continue;
    }
    if (group.games !== 2) {
      incompletePairs += 1;
      continue;
    }
    complete.push({
      ...group,
      // -1 means left lost both legs, 0 a colour-balanced tie, +1 a sweep.
      leftMargin: (group.leftPoints - group.rightPoints) / 2,
    });
  }

  const pairCount = complete.length;
  const meanMargin = pairCount
    ? complete.reduce((sum, pair) => sum + pair.leftMargin, 0) / pairCount
    : null;
  const sampleVariance = pairCount > 1
    ? complete.reduce((sum, pair) => sum + (pair.leftMargin - meanMargin) ** 2, 0) / (pairCount - 1)
    : null;
  const standardError = sampleVariance === null ? null : Math.sqrt(sampleVariance / pairCount);
  const lowerBound90 = standardError === null ? null : meanMargin - 1.645 * standardError;
  const upperBound90 = standardError === null ? null : meanMargin + 1.645 * standardError;
  return {
    pairCount,
    invalidPairs,
    incompletePairs,
    leftScore: pairCount ? 0.5 + meanMargin / 2 : null,
    rightScore: pairCount ? 0.5 - meanMargin / 2 : null,
    leftMargin: meanMargin,
    rightMargin: meanMargin === null ? null : -meanMargin,
    leftLowerBound90: lowerBound90,
    rightLowerBound90: upperBound90 === null ? null : -upperBound90,
    pairs: complete,
  };
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
            pairId: `${left}-vs-${right}-${opening.id}`,
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
    paired: summarizePairedEvidence(left, right, games),
  };
}

export function summarizeTournament(levels, games, options = {}) {
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
  return { headToHead, ranking, verification: verifyExpectedOrder(normalized, headToHead, options.verification) };
}

export function verifyExpectedOrder(levels, headToHead, options = {}) {
  const expected = [...levels].map(normalizeLevel).sort((left, right) => levelNumber(right) - levelNumber(left));
  const byKey = new Map(headToHead.map((entry) => [entry.key, entry]));
  const scope = options?.scope === "all" ? "all" : "adjacent";
  const minimumPairCount = Number.isInteger(options?.minimumPairCount) && options.minimumPairCount >= 2
    ? options.minimumPairCount
    : 4;
  const comparisons = [];
  for (let strongerIndex = 0; strongerIndex < expected.length; strongerIndex += 1) {
    for (let weakerIndex = strongerIndex + 1; weakerIndex < expected.length; weakerIndex += 1) {
      if (scope === "adjacent" && weakerIndex !== strongerIndex + 1) continue;
      const stronger = expected[strongerIndex];
      const weaker = expected[weakerIndex];
      const entry = byKey.get(`${weaker}-vs-${stronger}`) ?? byKey.get(`${stronger}-vs-${weaker}`);
      if (!entry) {
        comparisons.push({ stronger, weaker, status: "missing", games: 0, pairCount: 0, score: null, lowerBound90: null, passed: false });
        continue;
      }
      const strongerIsLeft = entry.left.level === stronger;
      const paired = entry.paired;
      const score = strongerIsLeft ? paired?.leftScore : paired?.rightScore;
      const margin = strongerIsLeft ? paired?.leftMargin : paired?.rightMargin;
      const lowerBound90 = strongerIsLeft ? paired?.leftLowerBound90 : paired?.rightLowerBound90;
      const invalid = entry.invalidGames > 0 || (paired?.invalidPairs ?? 0) > 0;
      const insufficient = !paired || paired.pairCount < minimumPairCount;
      const passed = !invalid && !insufficient && margin > 0 && lowerBound90 > 0;
      const status = invalid ? "invalid-contaminated"
        : insufficient ? "insufficient"
          : passed ? "passed"
            : margin < 0 ? "reversed"
              : "inconclusive";
      comparisons.push({
        stronger,
        weaker,
        games: entry.games,
        validGames: entry.validGames,
        invalidGames: entry.invalidGames,
        score,
        margin,
        lowerBound90,
        pairCount: paired?.pairCount ?? 0,
        incompletePairs: paired?.incompletePairs ?? 0,
        minimumPairCount,
        passed,
        status,
      });
    }
  }
  const passed = comparisons.length > 0 && comparisons.every((comparison) => comparison.passed);
  const failed = comparisons.some((comparison) => ["reversed", "missing", "invalid-contaminated"].includes(comparison.status));
  return {
    expected,
    policy: { scope, unit: "paired-opening", minimumPairCount, confidence: 0.90 },
    comparisons,
    passed,
    status: passed ? "passed" : failed ? "failed" : "inconclusive",
  };
}
