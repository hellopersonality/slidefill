/* Shared engine: no DOM. Embedded into index.html between ENGINE markers and
   evaluated by build-levels.js in Node. */
const DIRS = [[0,-1],[1,0],[0,1],[-1,0]]; // up, right, down, left
const K_NORMAL = 0, K_STICKY = 1, K_ONEWAY = 2, K_PORTAL = 3;

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
  return { W, H, N, start: { x: 0, y: 0 }, floor: new Uint8Array(N), kind: new Uint8Array(N),
           dir: new Uint8Array(N), mate: new Int16Array(N).fill(-1), moves: [], count: 0, n: 0, par: 0, rating: 1 };
}

/* Slide from (x,y) in direction d. Returns cells entered as [x, y, jumped]:
   jumped=1 marks the arrival cell of a portal teleport. Rules:
   - walls / edges stop the ball
   - one-way tiles can only be entered moving in their direction
   - sticky tiles stop the ball when entered
   - portals teleport to their twin and the slide continues (once per slide) */
function slide(lv, x, y, d){
  const { W, H, floor, kind, dir, mate } = lv, dx = DIRS[d][0], dy = DIRS[d][1], path = [];
  let tp = false;
  for (;;){
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) break;
    const i = ny * W + nx;
    if (!floor[i]) break;
    const k = kind[i];
    if (k === K_ONEWAY && dir[i] !== d) break;
    x = nx; y = ny; path.push([x, y, 0]);
    if (k === K_STICKY) break;
    if (k === K_PORTAL && !tp){
      tp = true;
      const m = mate[i]; x = m % W; y = (m / W) | 0;
      path.push([x, y, 1]);
    }
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
   Walk a legal solution into existence, deciding walls and special tiles as we
   go. The result is verified by replaying the recorded moves with slide(). */
function attempt(rng, W, H, M, opt){
  const N = W * H, idx = (x, y) => y * W + x, inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const wall = new Uint8Array(N), vis = new Uint8Array(N), kind = new Uint8Array(N), dir = new Uint8Array(N);
  const mate = new Int16Array(N).fill(-1), entry = new Uint8Array(N), thr = new Uint8Array(N);
  let x = Math.floor(rng() * W), y = Math.floor(rng() * H);
  const start = { x, y }, sidx = idx(x, y);
  vis[sidx] = 1; let count = 1; const moves = [];

  function run(cx, cy, d){
    const dx = DIRS[d][0], dy = DIRS[d][1], cells = [];
    for (;;){
      cx += dx; cy += dy;
      if (!inb(cx, cy)) break;
      const i = idx(cx, cy);
      if (wall[i]) break;
      const k = kind[i];
      if (k === K_ONEWAY && dir[i] !== d) break;
      if (k === K_PORTAL) break;
      cells.push(i);
      if (k === K_STICKY) break;
    }
    return cells;
  }
  // 0: the ball would keep going, 1: sticky stop, 2: stops (edge/wall/one-way), 3: stops once beyond cell becomes a wall
  function stopOk(e, d){
    if (kind[e] === K_STICKY) return 1;
    const bx = (e % W) + DIRS[d][0], by = ((e / W) | 0) + DIRS[d][1];
    if (!inb(bx, by)) return 2;
    const b = idx(bx, by);
    if (wall[b]) return 2;
    if (!vis[b]) return 3;
    if (kind[b] === K_ONEWAY && dir[b] !== d) return 2;
    return 0;
  }
  function mark(i, d, through){
    if (!vis[i]){ vis[i] = 1; count++; }
    if (d >= 0) entry[i] |= 1 << d;
    if (through) thr[i] = 1;
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
        if (nw === 0) continue;
        if (stopOk(e, d)) opts.push({ t: 0, d, L, nw, cells });
        if (opt.sticky > 0 && kind[e] === K_NORMAL && !thr[e] && e !== sidx) opts.push({ t: 1, d, L, nw, cells });
      }
    }
    if (opt.portal > 0){
      for (let tr = 0; tr < 6; tr++){
        const d = (rng() * 4) | 0, cells = run(x, y, d);
        const cand = [];
        for (let j = 0; j < cells.length; j++) if (!vis[cells[j]] && kind[cells[j]] === K_NORMAL) cand.push(j);
        if (!cand.length) continue;
        const j = cand[(rng() * cand.length) | 0], A = cells[j];
        let B = -1;
        for (let k = 0; k < 10; k++){
          const c = (rng() * N) | 0;
          if (c !== A && !vis[c] && !wall[c] && cells.slice(0, j + 1).indexOf(c) < 0){ B = c; break; }
        }
        if (B < 0) continue;
        vis[A] = vis[B] = 1; kind[A] = kind[B] = K_PORTAL;
        const cells2 = run(B % W, (B / W) | 0, d), ends = [];
        for (let L2 = 0; L2 <= cells2.length; L2++){
          const e = L2 === 0 ? B : cells2[L2 - 1];
          if (cells2.slice(0, L2).indexOf(A) >= 0) break;
          if (stopOk(e, d)) ends.push(L2);
        }
        vis[A] = vis[B] = 0; kind[A] = kind[B] = K_NORMAL;
        if (!ends.length) continue;
        opts.push({ t: 2, d, A, j, B, L2: ends[(rng() * ends.length) | 0], cells, cells2 });
      }
    }
    if (!opts.length) break;
    let total = 0;
    const wt = o => o.t === 0 ? o.nw + 0.5 : o.t === 1 ? opt.sticky * (o.nw + 0.5) : opt.portal * 3;
    for (const o of opts) total += wt(o);
    let r = rng() * total, pick = opts[opts.length - 1];
    for (const o of opts){ r -= wt(o); if (r <= 0){ pick = o; break; } }
    const o = pick, d = o.d;

    if (o.t === 2){
      kind[o.A] = kind[o.B] = K_PORTAL; mate[o.A] = o.B; mate[o.B] = o.A;
      for (let t = 0; t <= o.j; t++) mark(o.cells[t], d, t < o.j);
      mark(o.B, -1, false);
      for (let t = 0; t < o.L2; t++) mark(o.cells2[t], d, t < o.L2 - 1);
      const e = o.L2 === 0 ? o.B : o.cells2[o.L2 - 1];
      if (kind[e] !== K_STICKY) wallBeyond(e, d);
      x = e % W; y = (e / W) | 0;
    } else {
      for (let t = 0; t < o.L; t++){
        const c = o.cells[t], through = t < o.L - 1;
        const eligible = through && kind[c] === K_NORMAL && c !== sidx && (entry[c] & ~(1 << d)) === 0;
        mark(c, d, through);
        if (eligible && opt.oneway > 0 && rng() < opt.oneway){ kind[c] = K_ONEWAY; dir[c] = d; }
      }
      const e = o.cells[o.L - 1];
      if (o.t === 1) kind[e] = K_STICKY;
      else if (kind[e] !== K_STICKY) wallBeyond(e, d);
      x = e % W; y = (e / W) | 0;
    }
    moves.push(d);
  }
  const lv = newLevel(W, H);
  lv.start = start; lv.moves = moves; lv.count = count;
  for (let i = 0; i < N; i++){
    if (vis[i]){ lv.floor[i] = 1; lv.kind[i] = kind[i]; lv.dir[i] = dir[i]; lv.mate[i] = mate[i]; }
  }
  return verify(lv) ? lv : null;
}

function mechCount(lv){
  const m = { sticky: 0, oneway: 0, portal: 0 };
  for (let i = 0; i < lv.N; i++){
    if (!lv.floor[i]) continue;
    if (lv.kind[i] === K_STICKY) m.sticky++;
    else if (lv.kind[i] === K_ONEWAY) m.oneway++;
    else if (lv.kind[i] === K_PORTAL) m.portal += 0.5;
  }
  return m;
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
  const c = Math.floor((n - 1) / 10);
  const W = Math.min(9, 4 + Math.floor((n - 1) / 8)), H = Math.min(13, W + 4);
  const M = Math.min(20, 4 + Math.floor(n * 0.33));
  const mech = { sticky: 0, oneway: 0, portal: 0 };
  if (c === 1) mech.sticky = 1;
  else if (c === 2){ mech.oneway = 0.35; mech.sticky = 0.3; }
  else if (c === 3){ mech.portal = 1; mech.sticky = 0.25; mech.oneway = 0.15; }
  else if (c >= 4){ mech.sticky = 0.6; mech.oneway = 0.25; mech.portal = 0.7; }
  return { W, H, M, mech, c };
}

function meetsMechanic(lv, c){
  const m = mechCount(lv);
  if (c === 1) return m.sticky >= 1;
  if (c === 2) return m.oneway >= 1;
  if (c === 3) return m.portal >= 1;
  if (c >= 4) return (m.sticky > 0) + (m.oneway > 0) + (m.portal > 0) >= 2;
  return true;
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
    const lv = attempt(rng, P.W, P.H, M, P.mech);
    if (!lv) continue;
    if (lv.count < 0.42 * lv.N) continue;
    if (!fallback) fallback = lv;
    if (!meetsMechanic(lv, P.c)) continue;
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

/* ---------- encoding (baked levels) ---------- */
function encodeLevel(lv){
  const rows = [], arrows = '^>v<';
  for (let y = 0; y < lv.H; y++){
    let r = '';
    for (let x = 0; x < lv.W; x++){
      const i = y * lv.W + x;
      if (!lv.floor[i]) r += '#';
      else if (x === lv.start.x && y === lv.start.y) r += '@';
      else if (lv.kind[i] === K_STICKY) r += 'g';
      else if (lv.kind[i] === K_ONEWAY) r += arrows[lv.dir[i]];
      else if (lv.kind[i] === K_PORTAL){
        const m = lv.mate[i];
        // pair letter = index of the lower cell of the pair
        r += String.fromCharCode(65 + pairIndex(lv, Math.min(i, m)));
      }
      else r += '.';
    }
    rows.push(r);
  }
  return [lv.W, lv.par, lv.rating, lv.moves.join(''), rows.join('/')].join('|');
}
function pairIndex(lv, lo){
  let k = 0;
  for (let i = 0; i < lo; i++) if (lv.floor[i] && lv.kind[i] === K_PORTAL && lv.mate[i] > i) k++;
  return k;
}
function decodeLevel(str, n){
  const [Ws, par, rating, moves, rowsS] = str.split('|');
  const rows = rowsS.split('/'), W = +Ws, H = rows.length, lv = newLevel(W, H);
  const arrows = '^>v<', pend = {};
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    const c = rows[y][x], i = y * W + x;
    if (c === '#') continue;
    lv.floor[i] = 1; lv.count++;
    if (c === '@') lv.start = { x, y };
    else if (c === 'g') lv.kind[i] = K_STICKY;
    else if (arrows.indexOf(c) >= 0){ lv.kind[i] = K_ONEWAY; lv.dir[i] = arrows.indexOf(c); }
    else if (c >= 'A' && c <= 'Z'){
      lv.kind[i] = K_PORTAL;
      if (pend[c] !== undefined){ lv.mate[i] = pend[c]; lv.mate[pend[c]] = i; } else pend[c] = i;
    }
  }
  lv.par = +par; lv.rating = +rating; lv.n = n;
  lv.moves = moves.split('').map(Number);
  return lv;
}
