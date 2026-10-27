/* Shared engine: no DOM. Embedded into index.html between ENGINE markers and
   evaluated by build-levels.js in Node. */
const DIRS = [[0,-1],[1,0],[0,1],[-1,0]]; // up, right, down, left

function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function newLevel(W, H){
  const N = W * H;
  return { W, H, N, start: { x: 0, y: 0 }, floor: new Uint8Array(N), moves: [], count: 0, n: 0, par: 0, rating: 1 };
}

/* Slide from (x,y) in direction d until a wall or the edge. Returns the cells entered as [x, y]. */
function slide(lv, x, y, d){
  const { W, H, floor } = lv, dx = DIRS[d][0], dy = DIRS[d][1], path = [];
  for (;;){
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H || !floor[ny * W + nx]) break;
    x = nx; y = ny; path.push([x, y]);
  }
  return path;
}

function goalOf(lv){
  if (lv._goal === undefined){
    let g = 0n; const bits = [];
    for (let i = 0; i < lv.N; i++){ bits.push(1n << BigInt(i)); if (lv.floor[i]) g |= bits[i]; }
    lv._bits = bits; lv._goal = g;
  }
  return lv._goal;
}

function verify(lv){
  let x = lv.start.x, y = lv.start.y;
  const seen = new Uint8Array(lv.N); seen[y * lv.W + x] = 1;
  for (const d of lv.moves){
    const p = slide(lv, x, y, d);
    if (!p.length) return false;
    for (const c of p) seen[c[1] * lv.W + c[0]] = 1;
    const l = p[p.length - 1]; x = l[0]; y = l[1];
  }
  for (let i = 0; i < lv.N; i++) if (lv.floor[i] && !seen[i]) return false;
  return true;
}

/* ---------- construction ----------
   Walk a legal solution into existence, placing a wall just past each stop.
   The result is verified by replaying the recorded moves with slide(). */
function attempt(rng, W, H, M){
  const N = W * H, idx = (x, y) => y * W + x, inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const wall = new Uint8Array(N), vis = new Uint8Array(N);
  let x = Math.floor(rng() * W), y = Math.floor(rng() * H);
  const start = { x, y };
  vis[idx(x, y)] = 1; let count = 1; const moves = [];

  function run(cx, cy, d){
    const dx = DIRS[d][0], dy = DIRS[d][1], cells = [];
    for (;;){
      cx += dx; cy += dy;
      if (!inb(cx, cy) || wall[idx(cx, cy)]) break;
      cells.push(idx(cx, cy));
    }
    return cells;
  }
  // can the ball stop on e moving in d? (edge/wall beyond, or an unvisited cell that can become a wall)
  function stopOk(e, d){
    const bx = (e % W) + DIRS[d][0], by = ((e / W) | 0) + DIRS[d][1];
    if (!inb(bx, by)) return true;
    const b = idx(bx, by);
    return wall[b] || !vis[b];
  }
  function wallBeyond(e, d){
    const bx = (e % W) + DIRS[d][0], by = ((e / W) | 0) + DIRS[d][1];
    if (inb(bx, by)){ const b = idx(bx, by); if (!vis[b]) wall[b] = 1; }
  }

  for (let s = 0; s < M; s++){
    const opts = [];
    for (let d = 0; d < 4; d++){
      const cells = run(x, y, d); let nw = 0;
      for (let L = 1; L <= cells.length; L++){
        const e = cells[L - 1];
        if (!vis[e]) nw++;
        if (nw && stopOk(e, d)) opts.push({ d, L, nw, cells });
      }
    }
    if (!opts.length) break;
    let total = 0;
    for (const o of opts) total += o.nw + 0.5;
    let r = rng() * total, o = opts[opts.length - 1];
    for (const q of opts){ r -= q.nw + 0.5; if (r <= 0){ o = q; break; } }
    for (let t = 0; t < o.L; t++){ const c = o.cells[t]; if (!vis[c]){ vis[c] = 1; count++; } }
    const e = o.cells[o.L - 1];
    wallBeyond(e, o.d);
    x = e % W; y = (e / W) | 0;
    moves.push(o.d);
  }
  const lv = newLevel(W, H);
  lv.start = start; lv.moves = moves; lv.count = count;
  for (let i = 0; i < N; i++) if (vis[i]) lv.floor[i] = 1;
  return verify(lv) ? lv : null;
}

/* ---------- difficulty ---------- */
function analyze(lv, cap){
  const W = lv.W, goal = goalOf(lv), bits = lv._bits;
  const s0 = lv.start.y * W + lv.start.x, m0 = bits[s0];
  const ids = new Map(), pos = [s0], masks = [m0], edges = [[]], depth = [0];
  ids.set(m0.toString(36) + ':' + s0, 0);
  let opt = -1, capped = false;
  for (let qi = 0; qi < pos.length; qi++){
    const x = pos[qi] % W, y = (pos[qi] / W) | 0;
    for (let d = 0; d < 4; d++){
      const p = slide(lv, x, y, d);
      if (!p.length) continue;
      let m = masks[qi];
      for (const c of p) m |= bits[c[1] * W + c[0]];
      const l = p[p.length - 1], np = l[1] * W + l[0], k = m.toString(36) + ':' + np;
      let id = ids.get(k);
      if (id === undefined){
        if (pos.length >= cap){ capped = true; continue; }
        id = pos.length; ids.set(k, id); pos.push(np); masks.push(m); edges.push([]); depth.push(depth[qi] + 1);
        if (m === goal && opt < 0) opt = depth[id];
      }
      edges[qi].push(id);
    }
  }
  const S = pos.length, rev = pos.map(() => []);
  edges.forEach((es, i) => es.forEach(j => rev[j].push(i)));
  const alive = new Uint8Array(S), st = [];
  for (let i = 0; i < S; i++) if (masks[i] === goal){ alive[i] = 1; st.push(i); }
  while (st.length){ const j = st.pop(); for (const i of rev[j]) if (!alive[i]){ alive[i] = 1; st.push(i); } }
  let aliveN = 0, br = 0;
  for (let i = 0; i < S; i++){ aliveN += alive[i]; br += edges[i].length; }
  const first = edges[0];
  return { S, opt, capped, deadFrac: (S - aliveN) / S, branch: br / S,
           first: first.length, firstTraps: first.filter(j => !alive[j]).length };
}

function difficultyScore(a){
  let s = Math.log2(a.S + 1) + 6 * (a.capped ? 0.5 : a.deadFrac) + 2 * Math.max(0, a.branch - 1.6);
  if (a.capped) s += 3;
  return s;
}

function targetT(n){
  let T = 1 - Math.exp(-n / 38);
  if (n % 10 === 0) T = Math.min(1, T * 1.25 + 0.08);       // boss
  else if (n % 5 === 0) T *= 0.7;                           // breather
  else if ((n - 1) % 10 === 0) T *= 0.75;                   // chapter opener
  return T;
}
function targetScore(n){ return 4.5 + 13 * targetT(n); }

function paramsFor(n){
  const W = Math.min(9, 4 + Math.floor((n - 1) / 8)), H = Math.min(13, W + 4);
  const M = Math.min(20, 4 + Math.floor(n * 0.33));
  return { W, H, M };
}

// Optimal solution by BFS from the start; sets lv.moves and lv.par. Returns false if not found within cap.
function solveOptimal(lv, cap){
  goalOf(lv);
  const p0 = lv.start.y * lv.W + lv.start.x;
  const s = new Search(lv, p0, lv._bits[p0], cap);
  while (s.status === 'run') s.step(1e9);
  if (s.status !== 'alive') return false;
  lv.moves = s.path; lv.par = s.path.length;
  return true;
}

/* Deterministic: same n (or seed) always yields the same level. */
function generateLevel(n, o){
  o = o || {};
  const cands = o.candidates || 24, cap = o.cap || 12000;
  const P = paramsFor(o.like || n), rng = mulberry32((o.seed !== undefined ? o.seed : n) * 7919 + 101);
  const target = targetScore(o.like || n);
  let best = null, bestD = 1e9, fallback = null;
  for (let i = 0; i < cands; i++){
    const M = Math.max(3, P.M + ((rng() * 5) | 0) - 2);
    const lv = attempt(rng, P.W, P.H, M);
    if (!lv) continue;
    if (lv.count < 0.42 * lv.N) continue;
    if (!fallback) fallback = lv;
    const a = analyze(lv, cap);
    if (a.opt < 0) continue;
    const sc = difficultyScore(a);
    let dist = Math.abs(sc - target) - lv.count * 0.01;
    if (n >= 12 && !a.capped && a.deadFrac < 0.08) dist += 3;   // past the tutorial, wrong moves must be able to strand you
    if (dist < bestD){ bestD = dist; best = lv; lv._a = a; lv._score = sc; }
  }
  const lv = best || fallback;
  if (!lv) return null;
  lv.n = n;
  if (!solveOptimal(lv, cap * 3)) lv.par = lv.moves.length;
  const sc = lv._score !== undefined ? lv._score : target;
  lv.rating = Math.max(1, Math.min(5, Math.round((sc - 4) / 3.4) + 1));
  return lv;
}

/* ---------- search (trap detection, hints, optimal solve) ---------- */
function Search(lv, pos, mask, cap){
  this.lv = lv; this.cap = cap || 30000; this.goal = goalOf(lv);
  this.nodes = [{ pos, mask, par: -1, mv: -1 }];
  this.seen = new Set([mask.toString(36) + ':' + pos]);
  this.qi = 0; this.path = [];
  this.status = mask === this.goal ? 'alive' : 'run';
}
Search.prototype.step = function(ms){
  const lv = this.lv, W = lv.W, bits = lv._bits, end = Date.now() + ms;
  while (this.status === 'run'){
    if (Date.now() > end) return;
    if (this.qi >= this.nodes.length){ this.status = 'dead'; return; }
    const nd = this.nodes[this.qi], x = nd.pos % W, y = (nd.pos / W) | 0;
    for (let d = 0; d < 4; d++){
      const p = slide(lv, x, y, d);
      if (!p.length) continue;
      let m = nd.mask;
      for (const c of p) m |= bits[c[1] * W + c[0]];
      const l = p[p.length - 1], np = l[1] * W + l[0], k = m.toString(36) + ':' + np;
      if (this.seen.has(k)) continue;
      if (this.nodes.length >= this.cap){ this.status = 'unknown'; return; }
      this.seen.add(k);
      this.nodes.push({ pos: np, mask: m, par: this.qi, mv: d });
      if (m === this.goal){
        const out = []; let i = this.nodes.length - 1;
        while (this.nodes[i].par >= 0){ out.push(this.nodes[i].mv); i = this.nodes[i].par; }
        this.path = out.reverse(); this.status = 'alive'; return;
      }
    }
    this.qi++;
  }
};

/* ---------- encoding (baked levels) ----------
   W|par|rating|moves|rows, rows joined by '/', '#' wall, '.' floor, '@' start */
function encodeLevel(lv){
  const rows = [];
  for (let y = 0; y < lv.H; y++){
    let r = '';
    for (let x = 0; x < lv.W; x++){
      const i = y * lv.W + x;
      r += !lv.floor[i] ? '#' : x === lv.start.x && y === lv.start.y ? '@' : '.';
    }
    rows.push(r);
  }
  return [lv.W, lv.par, lv.rating, lv.moves.join(''), rows.join('/')].join('|');
}
function decodeLevel(str, n){
  const [Ws, par, rating, moves, rowsS] = str.split('|');
  const rows = rowsS.split('/'), W = +Ws, H = rows.length, lv = newLevel(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    const c = rows[y][x], i = y * W + x;
    if (c === '#') continue;
    lv.floor[i] = 1; lv.count++;
    if (c === '@') lv.start = { x, y };
  }
  lv.par = +par; lv.rating = +rating; lv.n = n;
  lv.moves = moves.split('').map(Number);
  return lv;
}
