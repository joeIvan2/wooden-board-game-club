// V4 search layer over gomoku-ai-v4-core.
// Pipeline: strict 1-ply tactics -> conservative VCF/VCT-style threat probe
// (with an optional root defense probe for strong profiles) -> iterative
// deepening negamax with PVS, depth-aware TT, killer/history ordering and a
// stand-pat quiescence that only extends forcing moves.
//
// Determinism: with `useClock: false` plus finite node budgets every search is
// a pure function of the board and the options (no Date.now() influence), so
// CLI/tournament moves reproduce exactly across machines.
import {
  BOARD_SIZE, CELLS, DIRS, flattenBoard, winsAt, findWinningMoves,
  candidateMoves, analyzePlacement, makeHash, hashBoard,
} from './gomoku-ai-v4-core.mjs';

export const AI_VERSION = 'V4';
const WIN = 100000;
const TT_MAX = 262144;
const OPP = (p) => (p === 1 ? 2 : 1);
const rc = (i) => ({ row: (i / BOARD_SIZE) | 0, col: i % BOARD_SIZE });
const norm = (m) => (typeof m === 'number' ? m
  : m.index != null ? m.index : m.idx != null ? m.idx
  : (m.y != null && m.x != null) ? m.y * BOARD_SIZE + m.x : null);
const budget = (value, fallback) => {
  if (value === Infinity) return Infinity;
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;
};

// Threat-space verdicts.  UNKNOWN is deliberately distinct from REFUTED: an
// exhausted or truncated probe must never be read as "no win exists" nor as
// "win proven"; it simply falls back to ordinary alpha-beta.
const PROVEN = 2, UNKNOWN = 1, REFUTED = 0;

let info = { version: AI_VERSION, depth: 0, nodes: 0, elapsedMs: 0, timedOut: false };
export function getLastSearchInfo() { return { ...info }; }

// A placement is forcing only if it makes a five, an open four, at least one
// immediate winning continuation (a simple/closed four), or a genuine double
// threat (two separate three-gain directions).  Single open threes are too
// slow to count as forcing for VCF/VCT purposes.
const isForcing = (a) => a.five || a.openFour || a.winningContinuations.size >= 1 || a.threeGains.size >= 2;

// ---- cheap tactical classification ----------------------------------------
// Ordering and quiescence pre-filtering run thousands of times per second, so
// they use these bounded window scans instead of the full (Set-heavy)
// analyzePlacement.  Threat PROOFS still use the exact analysis.
function countConts(b, idx, p) {
  let conts = 0;
  const r0 = (idx / BOARD_SIZE) | 0, c0 = idx % BOARD_SIZE;
  for (const [dr, dc] of DIRS) {
    for (let f = -4; f <= 0; f++) {
      let pn = 0, empty = 0, bad = false;
      for (let j = 0; j < 5; j++) {
        const r = r0 + dr * (f + j), c = c0 + dc * (f + j);
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) { bad = true; break; }
        const v = b[r * BOARD_SIZE + c];
        if (v === p) pn++;
        else if (v !== 0) { bad = true; break; }
        else empty++;
      }
      if (!bad && pn === 4 && empty === 1) conts++;
    }
  }
  return conts;
}

function countOpenLines(b, idx, p) {
  let open = 0;
  const r0 = (idx / BOARD_SIZE) | 0, c0 = idx % BOARD_SIZE;
  for (const [dr, dc] of DIRS) {
    let n = 1, r = r0 + dr, c = c0 + dc;
    while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && b[r * BOARD_SIZE + c] === p) { n++; r += dr; c += dc; }
    const endA = r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && b[r * BOARD_SIZE + c] === 0;
    r = r0 - dr; c = c0 - dc;
    while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && b[r * BOARD_SIZE + c] === p) { n++; r -= dr; c -= dc; }
    const endB = r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && b[r * BOARD_SIZE + c] === 0;
    if (n === 3 && endA && endB) open++;
  }
  return open;
}

// Both sides' quick signals for one candidate square; board restored on exit.
function quickClassify(b, idx, s) {
  const o = OPP(s);
  b[idx] = s;
  const five = winsAt(b, idx, s);
  const ownConts = five ? 2 : countConts(b, idx, s);
  const ownOpens = five ? 0 : countOpenLines(b, idx, s);
  b[idx] = o;
  const oppConts = winsAt(b, idx, o) ? 2 : countConts(b, idx, o);
  const oppOpens = oppConts ? 0 : countOpenLines(b, idx, o);
  b[idx] = 0;
  return { five, ownConts, ownOpens, oppConts, oppOpens };
}

export function selectMove(inputBoard, aiPlayer, options = {}) {
  if (aiPlayer !== 1 && aiPlayer !== 2) throw new Error('aiPlayer must be 1 or 2');
  const t0 = Date.now();
  const useClock = options.useClock !== false;
  const rawTime = options.timeBudgetMs ?? options.timeLimitMs ?? options.timeLimit ?? 700;
  const timeLimit = useClock ? budget(rawTime, 700) : Infinity;
  const nodeLimit = budget(options.nodeBudget, Infinity);
  const tssNodeLimit = budget(options.tssNodeBudget, Infinity);
  const scanLimit = budget(options.tssScanBudget, 24000);
  const maxDepth = Math.max(1, Math.floor(options.maxDepth ?? 8));
  const maxC = Math.max(4, Math.floor(options.maxCandidates ?? 12));
  const threatDepth = Math.max(1, Math.floor(options.threatDepth ?? 5));
  const qDepth = Math.max(0, Math.floor(options.qDepth ?? 2));
  const rootDefenseProbe = options.rootDefenseProbe === true;
  const side = aiPlayer, opp = OPP(side);
  const board = flattenBoard(inputBoard) || [];
  const S = {
    board,
    deadline: timeLimit === Infinity ? Infinity : t0 + Math.max(1, timeLimit),
    nodes: 0,
    searchNodes: 0,
    tssNodes: 0,
    scans: 0,
    timedOut: false,
    tt: new Map(),
    tssWinMove: -1,
    defenseRefutations: new Set(),
    opponentForcedWin: false,
    opponentKeyMove: -1,
    attackProbed: false,
    defenseProbed: false,
  };
  const hashTable = makeHash();
  const hChild = (h, i, p) => h ^ hashTable[i * 3 + p - 1];
  const check = () => { if (!S.timedOut && S.deadline !== Infinity && Date.now() >= S.deadline) S.timedOut = true; };
  // A main-search node cap keeps CLI tournaments repeatable across machines.
  // Threat probing has its own caps so an inconclusive probe can never erase
  // the ordinary search budget and turn a mid-tier level into a depth-0 bot.
  const consumeSearchNode = () => {
    if (S.timedOut || S.searchNodes >= nodeLimit) { S.timedOut = true; return false; }
    S.searchNodes++; S.nodes++; check();
    return !S.timedOut;
  };
  const consumeTssNode = () => {
    if (S.timedOut || S.tssNodes >= tssNodeLimit) return false;
    S.tssNodes++; S.nodes++; check();
    return !S.timedOut;
  };
  // Placement analyses inside threat enumeration are metered separately so a
  // busy position cannot loop unbounded; exhaustion reads as UNKNOWN.
  const spendScan = () => { S.scans++; check(); return !S.timedOut && S.scans <= scanLimit; };
  const finish = (depth) => {
    info = {
      version: AI_VERSION,
      depth,
      nodes: S.nodes,
      elapsedMs: Date.now() - t0,
      timedOut: S.timedOut,
      searchNodes: S.searchNodes,
      tssNodes: S.tssNodes,
      attackProbed: S.attackProbed,
      defenseProbed: S.defenseProbed,
      opponentForcedWin: S.opponentForcedWin,
    };
  };

  let legal = [];
  for (let i = 0; i < CELLS; i++) if (board[i] === 0) legal.push(i);
  if (!legal.length) { finish(0); return null; }
  if (legal.length === CELLS) { finish(0); return rc(7 * BOARD_SIZE + 7); }

  // ---- 1) strict priority: own win; block only if ONE square neutralizes ALL
  //         opponent wins; otherwise continue with full search.
  const myWins = findWinningMoves(board, side);
  if (myWins.length) { finish(0); return rc(myWins[0]); }
  const oppWins = findWinningMoves(board, opp);
  if (oppWins.length === 1) { finish(0); return rc(oppWins[0]); }
  if (legal.length === 1) { finish(0); return rc(legal[0]); }

  // ---- 2) bounded conservative threat-space probes -------------------------
  const rawTssTime = options.tssTimeBudgetMs
    ?? (timeLimit === Infinity ? Infinity : Math.min(120, Math.round(0.2 * timeLimit)));
  const tssTime = useClock ? budget(rawTssTime, Math.min(120, Math.round(0.2 * Math.max(1, timeLimit)))) : Infinity;
  const tssDeadline = (timeLimit === Infinity || tssTime === Infinity) ? Infinity
    : Math.min(S.deadline, t0 + tssTime);
  const tssOver = () => {
    check();
    return S.timedOut || (tssDeadline !== Infinity && Date.now() >= tssDeadline);
  };
  const place = (i, p) => { board[i] = p; };
  const clear = (i) => { board[i] = 0; };

  // Empty squares where `defender` placing a stone would create an immediate
  // five-threat (four) or a double-three counter-threat.  These replies must
  // be verified explicitly: a counter-threat REFUTES the attacker's branch
  // unless the attacker's continuation survives it.  Scan truncation is
  // reported so callers stay conservative (UNKNOWN, never PROVEN).
  function counterThreatSquares(defender) {
    const out = [];
    let truncated = false;
    const cells = candidateMoves(board, 1);
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k];
      if (board[i] !== 0) continue;
      if (!spendScan()) { truncated = true; break; }
      const a = analyzePlacement(board, i, defender);
      if (a.winningContinuations.size >= 1 || a.threeGains.size >= 2) out.push(i);
    }
    return { out, truncated };
  }

  // Attacker `p` just played a multi-threat move described by `a`; defender to
  // move.  PROVEN only when EVERY relevant defense fails: defensive cost
  // squares (blocks + gain points of both threats) AND any counter-threatening
  // defender reply.  A single surviving/unknown defense refutes or voids the
  // whole attack branch.
  function verifyDefenses(p, a, d, collect) {
    const def = OPP(p);
    const costs = new Set();
    for (const c of a.defenseSquares) if (board[c] === 0) costs.add(c);
    const counters = counterThreatSquares(def);
    if (counters.truncated) return UNKNOWN;
    for (const c of counters.out) costs.add(c);
    if (costs.size === 0) return REFUTED;
    let sawUnknown = false;
    for (const b of costs) {
      if (tssOver() || !consumeTssNode()) { sawUnknown = true; break; }
      place(b, def);
      let res;
      if (winsAt(board, b, def)) {
        res = REFUTED;                                   // defense IS a five
      } else {
        const defFive = findWinningMoves(board, def);
        if (defFive.length >= 2) res = REFUTED;          // counter double-four kills the race
        else if (defFive.length === 1) {
          const atkFive = findWinningMoves(board, p);
          if (atkFive.length >= 1) res = PROVEN;         // attacker fives first
          else {
            place(defFive[0], p);                        // forced block, then continue proving
            res = attackerCanWin(p, d - 1, false, false);
            clear(defFive[0]);
          }
        } else {
          const atkFive = findWinningMoves(board, p);
          res = atkFive.length >= 1 ? PROVEN : attackerCanWin(p, d - 1, false, false);
        }
      }
      clear(b);
      if (res === UNKNOWN) { sawUnknown = true; break; }
      if (res === PROVEN) continue;                      // this defense fails
      if (collect && res === REFUTED) S.defenseRefutations.add(b);
      return REFUTED;                                    // this defense survives
    }
    return sawUnknown ? UNKNOWN : PROVEN;
  }

  // Can attacker `p` (to move) force a win within `d` attacker moves?
  // Every inconclusive outcome collapses to UNKNOWN; PROVEN requires a fully
  // verified forcing chain against all relevant defenses.
  function attackerCanWin(p, d, isTop, collect) {
    if (S.timedOut || tssOver()) return UNKNOWN;
    if (d <= 0) return REFUTED;
    // Quick pre-filter keeps the exact (expensive) analysis for squares that
    // look forcing at all.  The filter can only SHRINK the tried set, so it
    // may miss exotic wins (probe falls back to ordinary search) but can
    // never fabricate a proof: verification below stays exact.
    const tries = candidateMoves(board, 2)
      .map((i) => {
        const q = quickClassify(board, i, p);
        return { i, q, signal: q.five ? 100 : q.ownConts * 8 + q.ownOpens * 2 };
      })
      .filter((e) => e.q.five || e.q.ownConts >= 1 || e.q.ownOpens >= 2)
      .sort((x, y) => y.signal - x.signal || x.i - y.i);
    let sawUnknown = false;
    for (const { i } of tries) {
      if (S.timedOut || tssOver()) { sawUnknown = true; break; }
      if (!consumeTssNode()) { sawUnknown = true; break; }
      const a = analyzePlacement(board, i, p);
      if (!isForcing(a)) continue;
      if (a.five) { if (isTop) S.tssWinMove = i; return PROVEN; }
      place(i, p);
      let res;
      const defImmediate = findWinningMoves(board, OPP(p));
      if (defImmediate.length >= 1) {
        res = REFUTED;                                   // defender just wins
      } else {
        const atkImmediate = findWinningMoves(board, p);
        if (atkImmediate.length >= 2) res = PROVEN;      // double five threat: unstoppable
        else if (atkImmediate.length === 1) {
          const w = atkImmediate[0];                     // blocking it is literally forced
          place(w, OPP(p));
          res = winsAt(board, w, OPP(p)) ? REFUTED : attackerCanWin(p, d - 1, false, false);
          clear(w);
        } else {
          res = verifyDefenses(p, a, d, collect);
        }
      }
      clear(i);
      if (res === PROVEN) { if (isTop) S.tssWinMove = i; return PROVEN; }
      if (res === UNKNOWN) sawUnknown = true;
    }
    return sawUnknown ? UNKNOWN : REFUTED;
  }

  const attackStatus = attackerCanWin(side, threatDepth, true, false);
  S.attackProbed = true;
  if (attackStatus === PROVEN && S.tssWinMove >= 0) { finish(0); return rc(S.tssWinMove); }

  // Strong profiles additionally probe the OPPONENT's forcing lines at the
  // root and keep the concrete squares that refute them, so the main search
  // orders those defenses first.  Any other verdict is silently ignored.
  if (rootDefenseProbe && attackStatus !== PROVEN) {
    S.defenseRefutations.clear();
    const defenseStatus = attackerCanWin(opp, threatDepth, true, true);
    S.defenseProbed = true;
    if (defenseStatus === PROVEN && S.tssWinMove >= 0) {
      S.opponentForcedWin = true;
      S.opponentKeyMove = S.tssWinMove;
    } else {
      S.opponentForcedWin = false;
    }
  }

  // ---- 3) deterministic move ordering with preserved tactical buckets ------
  // Bucket order: own five -> opponent-five blocks -> fours / open & double
  // threats / root-defense refutations (+ killers) -> quiet by pattern score,
  // with a supplied TT/PV move promoted to the HEAD OF THE QUIET SEGMENT ONLY
  // (it never jumps ahead of wins, mandatory blocks or tactical moves).
  // Only the quiet tail is ever truncated to maxCandidates; tactical and
  // defensive candidates are never sliced away.
  const history = new Int32Array(CELLS * 2);
  const killers = new Array(maxDepth + 8).fill(null).map(() => [-1, -1]);

  function orderMoves(s, srcList, ttMove, ply, boost) {
    const oppSide = OPP(s);
    const oppFives = new Set(findWinningMoves(board, oppSide));
    const [k1, k2] = killers[Math.min(ply, killers.length - 1)] || [-1, -1];
    const ownWinsL = [], blocksL = [], tacL = [], quietL = [];
    for (const m of srcList) {
      const i = norm(m);
      if (i == null || i < 0 || i >= CELLS || board[i] !== 0) continue;
      if (oppFives.has(i)) { blocksL.push(i); continue; }
      const q = quickClassify(board, i, s);
      if (q.five) { ownWinsL.push(i); continue; }
      // rank: 5 open/double own four, 4 simple four (either side),
      // 3 double own open three, 2 deny opponent open three / boosted defense,
      // 1 own open three
      let rank;
      if (q.ownConts >= 2) rank = 5;
      else if (q.ownConts === 1 || q.oppConts >= 1) rank = 4;
      else if (q.ownOpens >= 2) rank = 3;
      else if (q.oppOpens >= 1) rank = 2;
      else if (q.ownOpens === 1) rank = 1;
      else rank = 0;
      if (rank < 2 && boost && boost.has(i)) rank = 2;
      const r = (i / BOARD_SIZE) | 0, c = i % BOARD_SIZE;
      const center = (7 - Math.abs(r - 7)) * 2 + (7 - Math.abs(c - 7)) * 2;
      const key = rank > 0
        ? rank * 100000000
          + q.ownConts * 4000000 + q.ownOpens * 1000000
          + q.oppConts * 3000000 + q.oppOpens * 900000
          + center
        : (i === k1 ? 90000000 : i === k2 ? 80000000 : 0)
          + history[(s - 1) * CELLS + i] * 4096 + center;
      (rank > 0 ? tacL : quietL).push({ i, key });
    }
    tacL.sort((x, y) => y.key - x.key || x.i - y.i);
    quietL.sort((x, y) => y.key - x.key || x.i - y.i);
    const tac = tacL.map((e) => e.i);
    const quiet = quietL.map((e) => e.i);
    // Promote the TT/PV move ONLY within the quiet segment: own wins,
    // mandatory blocks and tactical moves keep their exact front priority.
    // If the PV move is quiet (or absent from the candidate list), pull it to
    // the front of the quiet segment without disturbing anything ahead of it.
    if (ttMove != null && ttMove >= 0 && ttMove < CELLS && board[ttMove] === 0
      && !ownWinsL.includes(ttMove) && !blocksL.includes(ttMove)
      && !tac.includes(ttMove)) {
      const qi = quiet.indexOf(ttMove);
      if (qi > 0) quiet.splice(qi, 1);   // drop from its sorted quiet slot
      if (qi !== 0) quiet.unshift(ttMove);
    }
    let ordered = [...ownWinsL, ...blocksL, ...tac, ...quiet];
    // Truncate ONLY the quiet tail; tactical/defensive buckets always survive.
    const forced = ordered.length - quiet.length;
    const room = Math.max(maxC, forced);
    if (ordered.length > room) {
      ordered = ordered.slice(0, room);
    }
    return ordered;
  }

  const orderMovesAt = orderMoves;

  // ---- 4) symmetric static evaluation on ranked candidates -----------------
  // Candidates are ranked by a perspective-independent key (own + opponent
  // quick signals at the same square), so both sides are scored over the SAME
  // set: evaluateBoard(b, 1) === -evaluateBoard(b, 2).  Cheap window scans
  // keep leaf evaluation affordable; input boards stay untouched.
  const EVAL_CANDIDATES = 24;
  const evaluateBoard = (b, s) => {
    const o = OPP(s);
    const scored = [];
    for (const i of candidateMoves(b, 1)) {
      if (b[i] !== 0) continue;
      const own = quickClassify(b, i, s);
      const theirs = quickClassify(b, i, o);
      const pv = (five, conts, opens) => five ? 100000 : conts * 8000 + opens * 2600;
      const mult = (five, conts) => (five || conts >= 2 ? 2 : 1);
      scored.push({
        k: own.ownConts * 4 + (own.five ? 16 : 0) + own.ownOpens * 2
          + theirs.ownConts * 4 + (theirs.five ? 16 : 0) + theirs.ownOpens * 2,
        d: pv(own.five, own.ownConts, own.ownOpens) * mult(own.five, own.ownConts)
          - pv(theirs.five, theirs.ownConts, theirs.ownOpens) * mult(theirs.five, theirs.ownConts),
      });
    }
    scored.sort((x, y) => y.k - x.k);
    let sum = 0;
    const n = Math.min(scored.length, EVAL_CANDIDATES);
    for (let k = 0; k < n; k++) sum += scored[k].d;
    // Clamp strictly inside (-WIN, WIN): pattern potentials repeat across
    // neighboring candidate squares, so raw sums can otherwise outrank a
    // proven mate score in root comparisons.
    return Math.max(-20000, Math.min(20000, sum));
  };

  // ---- 5) quiescence: stand-pat alpha/beta + forced blocks + forcing extends
  const startHash = hashBoard(board, hashTable);

  function quiesce(alpha, beta, ply, h, s, d) {
    if (!consumeSearchNode()) return 0;
    const s2 = OPP(s);
    const myW = findWinningMoves(board, s);
    if (myW.length) return WIN - ply;
    const opW = findWinningMoves(board, s2);
    if (opW.length >= 2) return -WIN + ply;   // no single block works
    if (opW.length === 1) {
      // Standing pat is illegal here in spirit: the five must be met.  Search
      // ONLY the forced block (it may even win outright for the blocker).
      const block = opW[0];
      place(block, s);
      const sc = winsAt(board, block, s)
        ? WIN - ply
        : -quiesce(-beta, -alpha, ply + 1, hChild(h, block, s), s2, d - 1);
      clear(block);
      return sc;
    }
    const standPat = evaluateBoard(board, s);
    if (standPat >= beta) return standPat;
    if (standPat > alpha) alpha = standPat;
    if (d <= 0) return standPat;
    let best = standPat;
    // The forcing scan is naturally bounded by candidateMoves; it does not
    // share the threat-probe scan meter, so long main searches keep full
    // quiescence accuracy.  Quick signals pre-filter; exact semantics are
    // approximated here by design (quiescence is heuristic).
    for (const i of candidateMoves(board, 2)) {
      const q = quickClassify(board, i, s);
      const forcing = q.five || q.ownConts >= 1 || q.ownOpens >= 2;
      if (!forcing) continue;
      place(i, s);
      const sc = winsAt(board, i, s)
        ? WIN - ply
        : -quiesce(-beta, -alpha, ply + 1, hChild(h, i, s), s2, d - 1);
      clear(i);
      if (S.timedOut) return 0;
      if (sc > best) best = sc;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  // ---- 6) PVS negamax with depth-aware TT ----------------------------------
  function search(depth, alpha, beta, ply, h, s) {
    if (!consumeSearchNode()) return 0;
    const a0 = alpha, b0 = beta;
    const key = h ^ (s === 1 ? 0x9E3779B9n : 0xD1B54A32n);
    const hit = S.tt.get(key);
    if (hit && hit.d >= depth) {
      if (hit.f === 0) return hit.s;
      if (hit.f === 1) { if (hit.s >= beta) return hit.s; if (hit.s > alpha) alpha = hit.s; }
      else { if (hit.s <= alpha) return hit.s; if (hit.s < beta) beta = hit.s; }
      if (alpha >= beta) return hit.s;
    }
    if (depth <= 0) return quiesce(alpha, beta, ply, h, s, qDepth);
    const s2 = OPP(s);
    let moves = orderMovesAt(s, candidateMoves(board, 2), hit ? hit.m : null, ply, null);
    // tactical branch cap: while immediate-winning moves exist, search only those
    const tac = [];
    for (const i of moves) { place(i, s); if (winsAt(board, i, s)) tac.push(i); clear(i); }
    if (tac.length) moves = tac;
    if (!moves.length) return -WIN + ply;
    let best = -Infinity, bestMove = null;
    for (let mi = 0; mi < moves.length; mi++) {
      const i = moves[mi];
      place(i, s);
      const h3 = hChild(h, i, s);
      let child;
      if (winsAt(board, i, s)) child = WIN - ply;
      else if (mi === 0) child = -search(depth - 1, -beta, -alpha, ply + 1, h3, s2);
      else {
        child = -search(depth - 1, -alpha - 1, -alpha, ply + 1, h3, s2);
        if (!S.timedOut && child > alpha && child < beta)
          child = -search(depth - 1, -beta, -alpha, ply + 1, h3, s2);
      }
      clear(i);
      if (S.timedOut) return 0;
      if (child > best) { best = child; bestMove = i; }
      if (child > alpha) alpha = child;
      if (alpha >= beta) {
        history[(s - 1) * CELLS + i] += depth * depth;
        const ks = killers[ply];
        if (ks && ks[0] !== i && ks[1] !== i) { ks[1] = ks[0]; ks[0] = i; }
        break;
      }
    }
    if (!S.timedOut) {
      if (S.tt.size >= TT_MAX) S.tt.clear();
      S.tt.set(key, { d: depth, s: best, m: bestMove, f: best >= b0 ? 1 : best <= a0 ? 2 : 0 });
    }
    return best;
  }

  // ---- 7) iterative deepening with deterministic fallback ------------------
  const rootBoost = new Set(S.defenseRefutations);
  if (S.opponentKeyMove >= 0 && board[S.opponentKeyMove] === 0) rootBoost.add(S.opponentKeyMove);
  const rootSet = new Set(candidateMoves(board, 2));
  for (const b of rootBoost) if (board[b] === 0) rootSet.add(b);
  const boostArg = rootBoost.size ? rootBoost : null;
  const rootMoves = orderMovesAt(side, [...rootSet], null, 0, boostArg);
  if (!rootMoves.length) rootMoves.push(...legal.slice(0, maxC));

  // PV move carried across iterations: the TT is empty before the first
  // iteration completes, so ordering uses this instead of a root TT lookup.
  let previousRootMove = null;
  let lastGood = null, doneDepth = 0;
  for (let d = 1; d <= maxDepth; d++) {
    let bestScore = -Infinity, bestMove = null, alpha = -Infinity;
    const ord = orderMovesAt(side, rootMoves.length ? rootMoves : legal, previousRootMove, 0, boostArg);
    for (const i of ord) {
      place(i, side);
      const h2 = hChild(startHash, i, side);
      const sc = winsAt(board, i, side) ? WIN : -search(d - 1, -Infinity, -alpha, 1, h2, opp);
      clear(i);
      if (S.timedOut) break;
      if (sc > bestScore) { bestScore = sc; bestMove = i; }
      if (sc > alpha) alpha = sc;
    }
    if (S.timedOut || bestMove == null) break;
    doneDepth = d; lastGood = bestMove;
    previousRootMove = bestMove;
    if (bestScore >= WIN - 32) break;
  }
  const move = lastGood ?? rootMoves[0] ?? legal[0];
  finish(doneDepth);
  return rc(move);
}

export default { AI_VERSION, selectMove, getLastSearchInfo };
