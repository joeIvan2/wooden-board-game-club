// gomoku-ai-v4-core.mjs
export const BOARD_SIZE = 15;
export const CELLS = BOARD_SIZE * BOARD_SIZE;
export const DIRS = [[0,1],[1,0],[1,1],[1,-1]];

export function flattenBoard(b) {
  if (!Array.isArray(b)) return null;
  if (b.length === CELLS && (typeof b[0] === 'number' || b[0] === 0)) return b.slice();
  if (b.length === BOARD_SIZE && Array.isArray(b[0])) {
    const out = new Array(CELLS);
    for (let r = 0; r < BOARD_SIZE; r++)
      for (let c = 0; c < BOARD_SIZE; c++)
        out[r * BOARD_SIZE + c] = b[r][c];
    return out;
  }
  return null;
}

export function cloneBoard(b) { return b.slice(); }
export function isOnBoard(r, c) { return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE; }

export function winsAt(b, idx, player) {
  const r = (idx / BOARD_SIZE) | 0, c = idx % BOARD_SIZE;
  for (const [dr, dc] of DIRS) {
    let n = 1;
    for (let s = 1; s < 5; s++) { const nr=r+dr*s, nc=c+dc*s; if(!isOnBoard(nr,nc)||b[nr*BOARD_SIZE+nc]!==player)break; n++; }
    for (let s = 1; s < 5; s++) { const nr=r-dr*s, nc=c-dc*s; if(!isOnBoard(nr,nc)||b[nr*BOARD_SIZE+nc]!==player)break; n++; }
    if (n >= 5) return true;
  }
  return false;
}

export function findWinningMoves(b, player) {
  const res = [];
  for (let i = 0; i < CELLS; i++) {
    if (b[i] !== 0) continue;
    b[i] = player;
    if (winsAt(b, i, player)) res.push(i);
    b[i] = 0;
  }
  return res;
}

export function candidateMoves(b, radius = 2) {
  let has = false;
  for (let i = 0; i < CELLS; i++) if (b[i] !== 0) { has = true; break; }
  if (!has) return [7 * BOARD_SIZE + 7];
  const s = new Set();
  for (let i = 0; i < CELLS; i++) {
    if (b[i] === 0) continue;
    const r = (i / BOARD_SIZE) | 0, c = i % BOARD_SIZE;
    for (let dr = -radius; dr <= radius; dr++)
      for (let dc = -radius; dc <= radius; dc++) {
        const nr = r+dr, nc = c+dc;
        if (isOnBoard(nr, nc) && b[nr*BOARD_SIZE+nc] === 0) s.add(nr*BOARD_SIZE+nc);
      }
  }
  return [...s];
}
function dirLine(b, r0, c0, dr, dc) {
  const line = [];
  for (let r = r0-dr, c = c0-dc; isOnBoard(r,c); r-=dr, c-=dc) line.unshift(r*BOARD_SIZE+c);
  line.push(r0*BOARD_SIZE+c0);
  for (let r = r0+dr, c = c0+dc; isOnBoard(r,c); r+=dr, c+=dc) line.push(r*BOARD_SIZE+c);
  return line;
}

// Scans only length-5 windows of `line` that contain every required line position.
function windowConts(b, line, req, player) {
  const L = line.length;
  let lo = 0, hi = req[0];
  for (const q of req) { lo = Math.max(lo, q-4); hi = Math.min(hi, q); }
  const conts = new Set();
  let five = false;
  for (let st = lo; st + 5 <= L && st <= hi; st++) {
    let p=0, o=0, e=0, ei=-1;
    for (let k=st;k<st+5;k++) { const v=b[line[k]]; if(v===player)p++; else if(v!==0)o++; else{e++;ei=line[k];} }
    if (o>0) continue;
    if (p===5) five = true;
    if (p===4 && e===1) conts.add(ei);
  }
  return { five, conts };
}

export function analyzePlacement(board, idx, player) {
  const b = board;
  const r0 = (idx/BOARD_SIZE)|0, c0 = idx%BOARD_SIZE;
  const winC = new Set(), threeG = new Set(), defS = new Set();
  let five=false, fourCount=0, openFour=false, threatLevel=0;
  const dirs = [];
  b[idx] = player;
  for (let d=0; d<DIRS.length; d++) {
    const [dr,dc] = DIRS[d];
    const line = dirLine(b, r0, c0, dr, dc);
    let ci = -1;
    for (let k=0;k<line.length;k++) if (line[k]===idx) { ci=k; break; }
    const { five: dFive, conts } = windowConts(b, line, [ci], player);
    if (dFive) five = true;
    conts.forEach(c => { winC.add(c); defS.add(c); });
    if (conts.size >= 2) openFour = true;
    if (conts.size >= 1) fourCount++;
    const dThree = new Set();
    for (let k=0;k<line.length;k++) {
      if (k===ci) continue;
      const cell = line[k];
      if (b[cell]!==0) continue;
      b[cell]=player;
      const w2 = windowConts(b, line, [ci,k], player);
      b[cell]=0;
      if (w2.conts.size >= 1) { dThree.add(cell); threeG.add(cell); defS.add(cell); }
    }
    dirs.push({ dir:d, five:dFive, openFour:conts.size>=2, winningContinuations:new Set(conts), threeGains:dThree });
  }
  b[idx]=0;
  threatLevel = five?5 : openFour?4 : fourCount>0?3 : threeG.size>0?2 : 1;
  return {five, winningContinuations:winC, fourCount, openFour, threeGains:threeG, threatLevel, defenseSquares:defS, directions:dirs};
}

export function makeHash() {
  const t = new BigUint64Array(CELLS * 3);
  let seed = 0x123456789abcdefn;
  for (let i=0;i<t.length;i++){ seed = (seed * 6364136223846793005n + 1442695040888963407n) & 0xFFFFFFFFFFFFFFFFn; t[i] = seed; }
  return t;
}

export function hashBoard(b, table) {
  let h = 0n;
  for (let i=0;i<CELLS;i++) if (b[i]!==0) h ^= table[i*3 + b[i]-1];
  return h;
}

export function scoreMove(board, idx, player) {
  const opp = 3-player;
  const my = analyzePlacement(board, idx, player);
  const op = analyzePlacement(board, idx, opp);
  let s = 0;
  if (my.five) s += 1000000;
  else {
    if (my.openFour) s += 50000;
    s += my.fourCount * 10000;
    s += my.threeGains.size * 5000;
  }
  if (op.five) s += 800000;
  else {
    if (op.openFour) s += 40000;
    s += op.fourCount * 8000;
    s += op.threeGains.size * 4000;
  }
  const r=(idx/BOARD_SIZE)|0, c=idx%BOARD_SIZE;
  s += (7-Math.abs(r-7))*2 + (7-Math.abs(c-7))*2;
  return s;
}

export function evaluate(board, player) {
  const opp = 3-player;
  let s=0;
  for (let i=0;i<CELLS;i++) {
    if (board[i]!==0) continue;
    const a=analyzePlacement(board,i,player), d=analyzePlacement(board,i,opp);
    if (a.five) s+=1000000; else { if(a.openFour)s+=50000; s+=a.fourCount*10000+a.threeGains.size*5000; }
    if (d.five) s-=800000; else { if(d.openFour)s-=40000; s-=d.fourCount*8000+d.threeGains.size*4000; }
  }
  return s;
}
