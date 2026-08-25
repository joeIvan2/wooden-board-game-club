// Shared L1-L10 difficulty profiles for both the browser and the headless arena.
// Every level uses the same 15x15, five-or-more-wins rule.
//
// L1-L4 are intentionally weaker, deterministic one-ply profiles.  L5-L10 are
// true search profiles on the shared V4 engine with monotonically increasing
// resources: iterative-deepening depth, candidate width, quiescence depth,
// threat-probe depth and node budgets.
//
// Contexts:
//   interactive -> bounded wall-clock budgets so the browser stays responsive.
//   tournament  -> useClock:false + timeBudgetMs/tssTimeBudgetMs Infinity +
//                  fixed node budgets, so CLI moves reproduce on any machine.
import {
  AI_VERSION as V4_VERSION,
  selectMove as selectV4Move,
  getLastSearchInfo as getV4LastSearchInfo,
} from './gomoku-ai-v4.mjs';
import {
  BOARD_SIZE,
  CELLS,
  flattenBoard,
  findWinningMoves,
  candidateMoves,
  scoreMove,
} from './gomoku-ai-v4-core.mjs';

export const AI_ENGINE_VERSION = V4_VERSION;

const freezeProfile = (profile) => Object.freeze({
  ...profile,
  search: Object.freeze({ ...(profile.search || {}) }),
  interactive: Object.freeze({ ...(profile.interactive || {}) }),
  tournament: Object.freeze({ ...(profile.tournament || {}) }),
});

export const AI_LEVELS = Object.freeze([
  freezeProfile({
    id: 'l1',
    level: 1,
    label: 'L1 入門',
    shortLabel: 'L1',
    description: '最小局部候選，只保留立即勝與立即擋。',
    engine: 'greedy',
  }),
  freezeProfile({
    id: 'l2',
    level: 2,
    label: 'L2 基礎',
    shortLabel: 'L2',
    description: '局部棋形評分；固定保留一些可預期的初學者失誤。',
    engine: 'heuristic',
    candidateRadius: 1,
    baseRank: 1,
    mistakeInterval: 3,
    mistakeRank: 2,
  }),
  freezeProfile({
    id: 'l3',
    level: 3,
    label: 'L3 均衡',
    shortLabel: 'L3',
    description: '較寬的棋形評分；偶爾採用次佳候選。',
    engine: 'heuristic',
    candidateRadius: 2,
    baseRank: 0,
    mistakeInterval: 3,
    mistakeRank: 2,
  }),
  freezeProfile({
    id: 'l4',
    level: 4,
    label: 'L4 進階',
    shortLabel: 'L4',
    description: '完整局部候選評分與一步安全檢查；很少採用次佳候選。',
    engine: 'heuristic',
    candidateRadius: 2,
    safetyCheck: true,
    baseRank: 0,
    mistakeInterval: 7,
    mistakeRank: 2,
  }),
  freezeProfile({
    id: 'l5',
    level: 5,
    label: 'L5 專家',
    shortLabel: 'L5',
    description: 'V4 淺層搜尋入門：小寬度、短威脅探測。',
    engine: 'search',
    search: { maxDepth: 4, maxCandidates: 8, threatDepth: 2, qDepth: 2, rootDefenseProbe: false },
    interactive: { useClock: true, timeBudgetMs: 250, tssTimeBudgetMs: 60 },
    tournament: {
      useClock: false, timeBudgetMs: Infinity, tssTimeBudgetMs: Infinity,
      nodeBudget: 1800, tssNodeBudget: 180, tssScanBudget: 5000,
    },
  }),
  freezeProfile({
    id: 'l6',
    level: 6,
    label: 'L6 挑戰',
    shortLabel: 'L6',
    description: 'V4 中等搜尋：更深的主搜尋與威脅探測。',
    engine: 'search',
    search: { maxDepth: 6, maxCandidates: 10, threatDepth: 3, qDepth: 2, rootDefenseProbe: false },
    interactive: { useClock: true, timeBudgetMs: 350, tssTimeBudgetMs: 80 },
    tournament: {
      useClock: false, timeBudgetMs: Infinity, tssTimeBudgetMs: Infinity,
      nodeBudget: 2600, tssNodeBudget: 260, tssScanBudget: 7000,
    },
  }),
  freezeProfile({
    id: 'l7',
    level: 7,
    label: 'L7 菁英',
    shortLabel: 'L7',
    description: 'V4 深搜尋：完整靜態搜尋與較長 VCF 探測。',
    engine: 'search',
    search: { maxDepth: 8, maxCandidates: 12, threatDepth: 4, qDepth: 3, rootDefenseProbe: false },
    interactive: { useClock: true, timeBudgetMs: 450, tssTimeBudgetMs: 100 },
    tournament: {
      useClock: false, timeBudgetMs: Infinity, tssTimeBudgetMs: Infinity,
      nodeBudget: 3600, tssNodeBudget: 360, tssScanBudget: 9000,
    },
  }),
  freezeProfile({
    id: 'l8',
    level: 8,
    label: 'L8 大師',
    shortLabel: 'L8',
    description: 'V4 深搜尋加上根防禦探測：先驗證對手的強攻手段。',
    engine: 'search',
    search: { maxDepth: 10, maxCandidates: 12, threatDepth: 5, qDepth: 3, rootDefenseProbe: true },
    interactive: { useClock: true, timeBudgetMs: 600, tssTimeBudgetMs: 130 },
    tournament: {
      useClock: false, timeBudgetMs: Infinity, tssTimeBudgetMs: Infinity,
      nodeBudget: 5000, tssNodeBudget: 500, tssScanBudget: 12000,
    },
  }),
  freezeProfile({
    id: 'l9',
    level: 9,
    label: 'L9 宗師',
    shortLabel: 'L9',
    description: 'V4 更深主搜尋、更寬候選與更長威脅鏈驗證。',
    engine: 'search',
    search: { maxDepth: 12, maxCandidates: 14, threatDepth: 6, qDepth: 4, rootDefenseProbe: true },
    interactive: { useClock: true, timeBudgetMs: 800, tssTimeBudgetMs: 160 },
    tournament: {
      useClock: false, timeBudgetMs: Infinity, tssTimeBudgetMs: Infinity,
      nodeBudget: 7000, tssNodeBudget: 700, tssScanBudget: 16000,
    },
  }),
  freezeProfile({
    id: 'l10',
    level: 10,
    label: 'L10 傳奇',
    shortLabel: 'L10',
    description: 'V4 最高強度：最深迭代深化、最長 VCF/VCT 與根防禦探測。',
    engine: 'search',
    search: { maxDepth: 14, maxCandidates: 18, threatDepth: 8, qDepth: 4, rootDefenseProbe: true },
    interactive: { useClock: true, timeBudgetMs: 1000, tssTimeBudgetMs: 200 },
    tournament: {
      useClock: false, timeBudgetMs: Infinity, tssTimeBudgetMs: Infinity,
      nodeBudget: 9500, tssNodeBudget: 950, tssScanBudget: 20000,
    },
  }),
]);

const LEVEL_BY_ID = new Map(AI_LEVELS.map((profile) => [profile.id, profile]));
let lastLevelSearchInfo = Object.freeze({
  version: AI_ENGINE_VERSION,
  level: 'l3',
  depth: 0,
  nodes: 0,
  elapsedMs: 0,
  timedOut: false,
});

export function normalizeLevel(level = 3) {
  if (typeof level === 'number' && Number.isInteger(level) && level >= 1 && level <= 10) {
    return `l${level}`;
  }
  if (typeof level === 'string') {
    const compact = level.trim().toLowerCase();
    if (/^(?:[1-9]|10)$/.test(compact)) return `l${compact}`;
    if (/^l(?:[1-9]|10)$/.test(compact)) return compact;
  }
  throw new Error(`Unknown AI level: ${String(level)}`);
}

export function getLevelProfile(level = 3) {
  const profile = LEVEL_BY_ID.get(normalizeLevel(level));
  if (!profile) throw new Error(`Unknown AI level: ${String(level)}`);
  return profile;
}

export function getLevelSearchOptions(level = 3, context = 'interactive') {
  const profile = getLevelProfile(level);
  if (context !== 'interactive' && context !== 'tournament') {
    throw new Error(`Unknown AI search context: ${String(context)}`);
  }
  return { ...profile.search, ...profile[context] };
}

const toMove = (index) => ({ row: (index / BOARD_SIZE) | 0, col: index % BOARD_SIZE });

function selectGreedyMove(inputBoard, player) {
  const board = flattenBoard(inputBoard);
  if (!board || board.length !== CELLS) throw new Error('board must be a 15x15 numeric board');
  const startedAt = Date.now();
  const legal = [];
  for (let index = 0; index < CELLS; index++) {
    if (board[index] === 0) legal.push(index);
  }
  if (!legal.length) {
    lastLevelSearchInfo = { version: 'L1-greedy', level: 'l1', depth: 0, nodes: 0, elapsedMs: Date.now() - startedAt, timedOut: false };
    return null;
  }
  if (legal.length === CELLS) {
    lastLevelSearchInfo = { version: 'L1-greedy', level: 'l1', depth: 0, nodes: 0, elapsedMs: Date.now() - startedAt, timedOut: false };
    return toMove(7 * BOARD_SIZE + 7);
  }

  const ownWins = findWinningMoves(board, player);
  if (ownWins.length) {
    lastLevelSearchInfo = { version: 'L1-greedy', level: 'l1', depth: 1, nodes: ownWins.length, elapsedMs: Date.now() - startedAt, timedOut: false };
    return toMove(ownWins[0]);
  }
  const opponentWins = findWinningMoves(board, 3 - player);
  if (opponentWins.length === 1) {
    lastLevelSearchInfo = { version: 'L1-greedy', level: 'l1', depth: 1, nodes: opponentWins.length, elapsedMs: Date.now() - startedAt, timedOut: false };
    return toMove(opponentWins[0]);
  }

  // L1 deliberately has no pattern evaluator: after mandatory one-move tactics,
  // it takes the first local legal square in stable row-major order.
  const candidates = candidateMoves(board, 1);
  const ranked = (candidates.length ? candidates : legal).sort((left, right) => left - right);
  const best = ranked[0] ?? legal[0];
  lastLevelSearchInfo = {
    version: 'L1-greedy',
    level: 'l1',
    depth: 1,
    nodes: ranked.length,
    elapsedMs: Date.now() - startedAt,
    timedOut: false,
  };
  return toMove(best);
}

function selectHeuristicMove(inputBoard, player, profile) {
  const board = flattenBoard(inputBoard);
  if (!board || board.length !== CELLS) throw new Error('board must be a 15x15 numeric board');
  const startedAt = Date.now();
  const legal = [];
  for (let index = 0; index < CELLS; index++) if (board[index] === 0) legal.push(index);
  if (!legal.length) {
    lastLevelSearchInfo = { version: 'V4-pattern', level: profile.id, depth: 0, nodes: 0, elapsedMs: Date.now() - startedAt, timedOut: false };
    return null;
  }
  if (legal.length === CELLS) {
    lastLevelSearchInfo = { version: 'V4-pattern', level: profile.id, depth: 0, nodes: 0, elapsedMs: Date.now() - startedAt, timedOut: false };
    return toMove(7 * BOARD_SIZE + 7);
  }

  const ownWins = findWinningMoves(board, player);
  if (ownWins.length) {
    lastLevelSearchInfo = { version: 'V4-pattern', level: profile.id, depth: 1, nodes: ownWins.length, elapsedMs: Date.now() - startedAt, timedOut: false };
    return toMove(ownWins[0]);
  }
  const opponent = 3 - player;
  const opponentWins = findWinningMoves(board, opponent);
  if (opponentWins.length === 1) {
    lastLevelSearchInfo = { version: 'V4-pattern', level: profile.id, depth: 1, nodes: opponentWins.length, elapsedMs: Date.now() - startedAt, timedOut: false };
    return toMove(opponentWins[0]);
  }

  const candidates = candidateMoves(board, profile.candidateRadius ?? 2);
  const ranked = (candidates.length ? candidates : legal)
    .map((index) => ({ index, score: scoreMove(board, index, player), unsafe: false }))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  // The two upper heuristic levels inspect their strongest candidate set for a
  // reply that immediately loses the game.  A losing candidate remains
  // available only when every move is losing (for example, against an
  // already-created double threat).
  if (profile.safetyCheck) {
    for (const candidate of ranked.slice(0, Math.min(12, ranked.length))) {
      board[candidate.index] = player;
      candidate.unsafe = findWinningMoves(board, opponent).length > 0;
      board[candidate.index] = 0;
      if (candidate.unsafe) candidate.score -= 2_000_000;
    }
    ranked.sort((left, right) => right.score - left.score || left.index - right.index);
  }

  const stoneCount = CELLS - legal.length;
  let rank = profile.baseRank ?? 0;
  if (profile.mistakeInterval && stoneCount % profile.mistakeInterval === 0) {
    rank = profile.mistakeRank ?? Math.max(rank, 1);
  }
  const best = ranked[Math.min(rank, ranked.length - 1)]?.index ?? legal[0];
  lastLevelSearchInfo = {
    version: 'V4-pattern',
    level: profile.id,
    depth: profile.safetyCheck ? 2 : 1,
    nodes: ranked.length,
    elapsedMs: Date.now() - startedAt,
    timedOut: false,
  };
  return toMove(best);
}

// `context` selects browser-safe wall-clock budgets or reproducible CLI node caps.
// Remaining options intentionally override the profile for focused tests/debugging.
export function selectLevelMove(inputBoard, player, level = 3, options = {}) {
  if (player !== 1 && player !== 2) throw new Error('player must be 1 or 2');
  const profile = getLevelProfile(level);
  const { context = 'interactive', ...overrides } = options;
  if (profile.engine === 'greedy') return selectGreedyMove(inputBoard, player);
  if (profile.engine === 'heuristic') return selectHeuristicMove(inputBoard, player, profile);

  const move = selectV4Move(inputBoard, player, {
    ...getLevelSearchOptions(profile.id, context),
    ...overrides,
  });
  lastLevelSearchInfo = { ...getV4LastSearchInfo(), level: profile.id };
  return move;
}

export function getLastLevelSearchInfo() {
  return { ...lastLevelSearchInfo };
}

export default {
  AI_ENGINE_VERSION,
  AI_LEVELS,
  normalizeLevel,
  getLevelProfile,
  getLevelSearchOptions,
  selectLevelMove,
  getLastLevelSearchInfo,
};

