/* ============================================================
   zombies-chemin.js — LOT 3 : pathfinding A* (contournement)
   À placer APRÈS « zombies-ia » (dernier script de index.html),
   dans un <script id="zombies-chemin"> ... </script>.

   Fonctionnement :
   - Une grille de navigation est construite à partir de `boxes`
     (murs, meubles, voitures, barils, barricades) et rafraîchie toutes
     les 0,8 s (les barricades cassées / barils explosés sont pris en compte).
   - Si la ligne droite vers la cible est libre : comportement inchangé.
   - Sinon, le zombie calcule un chemin A* et suit des points de passage
     (lissés par vue directe). La cible est recalculée toutes les ~0,6 s
     ou quand elle bouge de plus de 2,5 m.
   - Les barricades sont franchissables à fort coût : il les contourne
     s'il peut, sinon il passe dessus et les attaque (comportement d'origine).
   - Budget : 4 calculs A* par image maximum, 9000 nœuds par calcul ;
     au-delà, le zombie garde son ancien chemin ou la ligne droite.
   Fonctionne avec ou sans zombies-ia.js (les états recherche / chasse
   utilisent la même cible). Tous les réglages sont dans CFG.
   ============================================================ */
(function () {
  'use strict';
  const safe = f => { try { return f(); } catch (e) { console.warn('[zombies-chemin]', e && e.message || e); } };

  const CFG = { cell: 0.75, radius: 0.45, barrierCost: 12, maxNodes: 2500, perFrame: 1, repath: 1.2,
                goalMove: 3.5, lookahead: 6, rebuildEvery: 1.6 };
  const C = CFG.cell, R = CFG.radius, N = Math.ceil(2 * M / C);
  const hard = new Uint8Array(N * N), soft = new Uint8Array(N * N);
  const gS = new Float32Array(N * N), fS = new Float32Array(N * N), par = new Int32Array(N * N);
  const seen = new Uint32Array(N * N), done = new Uint32Array(N * N);
  let stamp = 0, rebuildT = 0, budget = CFG.perFrame, now = 0;
  const pMap = new Map();

  const ix = x => Math.min(N - 1, Math.max(0, Math.floor((x + M) / C)));
  const cc = i => (i + .5) * C - M;

  function rebuild() {
    hard.fill(0); soft.fill(0);
    const e0 = ix(-M + 1), e1 = ix(M - 1);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++)
      if (i < e0 || i > e1 || j < e0 || j > e1) hard[j * N + i] = 1;
    for (const b of boxes) {
      const g = b.bar ? soft : hard, ex = b.hx + R, ez = b.hz + R;
      const i0 = ix(b.x - ex), i1 = ix(b.x + ex), j0 = ix(b.z - ez), j1 = ix(b.z + ez);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++)
        if (Math.abs(cc(i) - b.x) <= ex && Math.abs(cc(j) - b.z) <= ez) g[j * N + i] = 1;
    }
  }

  // ligne droite libre ? (on ignore le début : un zombie collé à un mur est dans la zone gonflée)
  function clear(x0, z0, x1, z1) {
    const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / (C * .5));
    for (let s = 1; s <= n; s++) {
      const t = s / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      if (Math.hypot(x - x0, z - z0) < R + .2) continue;
      const k = ix(z) * N + ix(x); if (hard[k] || soft[k]) return false;
    }
    return true;
  }

  function nearestFree(i, j) {
    if (!hard[j * N + i]) return j * N + i;
    for (let r = 1; r <= 4; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= N || b >= N) continue;
      if (!hard[b * N + a]) return b * N + a;
    }
    return -1;
  }

  // ---- A* (tas binaire, 8 voisins, sans couper les coins) ----
  let heap = [];
  const hpush = k => { heap.push(k); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (fS[heap[p]] <= fS[heap[i]]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const hpop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && fS[heap[l]] < fS[heap[m]]) m = l; if (r < heap.length && fS[heap[r]] < fS[heap[m]]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const H = (a, b) => { const dx = Math.abs((a % N) - (b % N)), dz = Math.abs(((a / N) | 0) - ((b / N) | 0)); return (Math.max(dx, dz) + .414 * Math.min(dx, dz)) * C; };

  function findPath(sx, sz, gx, gz) {
    const s = nearestFree(ix(sx), ix(sz)), g = nearestFree(ix(gx), ix(gz));
    if (s < 0 || g < 0) return null;
    stamp++; heap = []; gS[s] = 0; fS[s] = H(s, g); par[s] = -1; seen[s] = stamp; hpush(s);
    let best = s, bh = H(s, g), exp = 0;
    while (heap.length) {
      const k = hpop(); if (done[k] === stamp) continue; done[k] = stamp;
      if (k === g) { best = g; break; }
      const h = H(k, g); if (h < bh) { bh = h; best = k; }
      if (++exp > CFG.maxNodes) break;
      const ki = k % N, kj = (k / N) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const a = ki + di, b = kj + dj; if (a < 0 || b < 0 || a >= N || b >= N) continue;
        const n = b * N + a; if (hard[n] || done[n] === stamp) continue;
        if (di && dj && (hard[kj * N + a] || hard[b * N + ki])) continue;
        const ng = gS[k] + (di && dj ? 1.414 : 1) * C * (1 + (soft[n] ? CFG.barrierCost : 0));
        if (seen[n] !== stamp || ng < gS[n]) { seen[n] = stamp; gS[n] = ng; par[n] = k; fS[n] = ng + H(n, g); hpush(n); }
      }
    }
    const out = []; for (let k = best; k >= 0 && k !== s; k = par[k]) out.push({ x: cc(k % N), z: cc((k / N) | 0) });
    out.reverse();
    if (best === g && !hard[ix(gz) * N + ix(gx)]) out.push({ x: gx, z: gz });
    return out.length ? out : null;
  }

  function waypoint(z, p, gx, gz) {
    const st = z._pn || (z._pn = { path: null, i: 0, gx: 1e9, gz: 1e9, at: -1e9 });
    const stale = now - st.at > CFG.repath * 1000 + (z.id % 7) * 40 || Math.hypot(gx - st.gx, gz - st.gz) > CFG.goalMove;
    if ((!st.path || stale) && budget > 0) {
      budget--; st.at = now; st.gx = gx; st.gz = gz; st.path = findPath(p.x, p.z, gx, gz); st.i = 0;
    }
    const path = st.path; if (!path) return null;
    while (st.i < path.length - 1 && Math.hypot(path[st.i].x - p.x, path[st.i].z - p.z) < .9) st.i++;
    let best = st.i;
    for (let j = st.i + 1; j < Math.min(path.length, st.i + CFG.lookahead); j++) { if (clear(p.x, p.z, path[j].x, path[j].z)) best = j; else break; }
    st.i = best;
    return path[best];
  }

  // ---- La cible devient un point de passage tant que la ligne droite est bloquée ----
  safe(() => {
    const _nt = nearTg;
    nearTg = function (p) {
      const t = _nt(p), z = pMap.get(p);
      if (!z || z.dead || z.pup || isCli() || mode === 'pvp') return t;
      const a = z.ai; if (a && a.s === 'idle') return t;
      const gx = (a && t.id === 'ghost') ? a.tx : t.x, gz = (a && t.id === 'ghost') ? a.tz : t.z;
      if (Math.hypot(gx - p.x, gz - p.z) < 2 || clear(p.x, p.z, gx, gz)) return t;
      const w = waypoint(z, p, gx, gz); if (!w) return t;
      const dx = w.x - p.x, dz = w.z - p.z, d = Math.hypot(dx, dz) || 1, k = (d + (z.type === 'spitter' ? 25 : 6)) / d;
      return { x: p.x + dx * k, y: 0, z: p.z + dz * k, loc: false, id: 'ghost', rl: true };   // jamais « atteinte », jamais attaquée
    };
  });

  safe(() => {
    const _u = update;
    update = function (dt) {
      const paused = window.__paused || (typeof mapOpen !== 'undefined' && mapOpen && !net.on);
      if (state === 'PLAYING' && !paused && mode !== 'pvp') {
        now = performance.now(); budget = CFG.perFrame; pMap.clear();
        for (const z of zombies) pMap.set(z.root.position, z);
        rebuildT -= dt; if (rebuildT <= 0) { rebuildT = CFG.rebuildEvery; safe(rebuild); }
      }
      return _u.apply(this, arguments);
    };
  });
})();
