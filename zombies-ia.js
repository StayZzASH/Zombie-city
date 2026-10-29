/* ============================================================
   zombies-ia.js — LOT 2 : bruit, détection, alerte, traque
   À placer APRÈS « zombies-combat » (dernier script de index.html),
   dans un <script id="zombies-ia"> ... </script>.

   Comportement :
   - Chaque zombie a un état : CHASSE (te voit/t'entend : cible tes
     coordonnées en direct), RECHERCHE (va fouiller la dernière position
     connue ou la source d'un bruit) ou VEILLE (planté sur place / erre
     lentement).
   - Immobile = presque invisible (rayon de détection très court).
     Marcher = visible, courir = très visible, s'accroupir / viser = discret.
   - Bruits : tirs, sprint, explosions (barils, zombies explosifs) attirent
     les zombies à portée. Arbalète = quasi silencieuse.
   - Un zombie qui te repère alerte ses voisins (ils viennent à ta position).
   - Boss et Alpha sont des chasseurs : toujours en chasse.
   - Anti-blocage : un zombie en veille depuis trop longtemps part en
     recherche vers un joueur, pour que les vagues finissent toujours.
   - Mode coop : l'IA tourne sur l'hôte ; les mouvements et les tirs
     qui touchent un zombie (message « zh ») des coéquipiers sont pris en compte.
   Tous les réglages sont dans CFG.
   ============================================================ */
(function () {
  'use strict';
  const safe = f => { try { return f(); } catch (e) { console.warn('[zombies-ia]', e && e.message || e); } };

  const CFG = {
    vis: { sprint: 22, walk: 11, sneak: 5, still: 3.5, roll: 12 }, // rayon de détection selon l'action du joueur
    sprintSpeed: 5,        // vitesse à partir de laquelle on « court »
    moveSpeed: 1.2,        // vitesse à partir de laquelle on « bouge »
    loseMult: 1.5,         // une fois en chasse, on te perd à rayon × 1,5
    loseTime: 4,           // secondes sans te percevoir avant de passer en recherche
    searchTTL: 14,         // durée d'une recherche (s)
    searchRadius: 6,       // zone fouillée autour de la dernière position
    alertRadius: 14,       // un zombie qui te repère alerte ceux dans ce rayon
    spawnTTL: 35,          // à l'apparition, la horde converge vers ta position de départ pendant X s
    idleLimit: 30,         // veille max avant de repartir à ta recherche
    wanderK: 0.3,          // vitesse d'errance en veille (× vitesse normale)
    alwaysChase: ['boss', 'alpha'],
    noise: { default: 32, arbalete: 6, sniper: 50, minigun: 45, pompe: 42, melee: 8, run: 16, explosion: 50 }
  };

  const rnd = (a, b) => a + Math.random() * (b - a);
  const zMap = new Map();     // position du zombie -> zombie (pour nearTg)
  const trk = {};             // vitesse estimée des coéquipiers
  let runT = 0;

  function ensure(z) {
    if (z.ai) return z.ai;
    z._k0 = z.spdK;
    return (z.ai = { s: 'search', tx: player.pos.x, tz: player.pos.z, cx: player.pos.x, cz: player.pos.z,
                     ttl: CFG.spawnTTL, lost: 0, idle: 0, wt: 0, still: false });
  }
  function startSearch(a, x, z, ttl) { a.s = 'search'; a.tx = a.cx = x; a.tz = a.cz = z; a.ttl = ttl || CFG.searchTTL; a.lost = 0; }

  // ---- Sources perceptibles (joueur local + coéquipiers vivants) ----
  function sources(dt) {
    const S = [], mk = (x, z, sp, sneak, roll) => ({ x, z, vis: roll ? CFG.vis.roll : sp > CFG.sprintSpeed ? CFG.vis.sprint
      : sp > CFG.moveSpeed ? (sneak ? CFG.vis.sneak : CFG.vis.walk) : CFG.vis.still });
    if (!selfDead) S.push(mk(player.pos.x, player.pos.z, Math.hypot(player.vel.x, player.vel.z) * (window.__ZSPRINTING ? 1.45 : 1), crouchK > .5 || ads, rolling));
    if (net.on) for (const id in net.pl) {
      const q = net.pl[id]; if (!q.al) continue;
      const t = trk[id] || (trk[id] = { x: q.x, z: q.z, sp: 0 });
      const sp = dt > 0 ? Math.hypot(q.x - t.x, q.z - t.z) / dt : 0;
      t.sp += (sp - t.sp) * Math.min(1, dt * 8); t.x = q.x; t.z = q.z;
      S.push(mk(q.x, q.z, t.sp, q.ck > .5 || q.ad, q.rl));
    }
    return S;
  }

  function alertNear(z, x, y) {
    const p = z.root.position;
    for (const o of zombies) {
      if (o === z || o.dead || o.pup || CFG.alwaysChase.includes(o.type)) continue;
      const a = ensure(o); if (a.s === 'chase') continue;
      if (Math.hypot(o.root.position.x - p.x, o.root.position.z - p.z) < CFG.alertRadius) startSearch(a, x, y);
    }
  }

  // ---- Bruit : attire les zombies à portée (hôte / solo uniquement) ----
  function makeNoise(x, z, r) {
    if (isCli() || state !== 'PLAYING') return;
    for (const o of zombies) {
      if (o.dead || o.pup || CFG.alwaysChase.includes(o.type)) continue;
      const a = ensure(o), p = o.root.position, d = Math.hypot(p.x - x, p.z - z);
      if (d > r) continue;
      if (d < r * .5) { a.s = 'chase'; a.lost = 0; a.tx = x; a.tz = z; }
      else if (a.s !== 'chase') startSearch(a, x, z);
    }
  }

  // ---- Réflexion de chaque zombie ----
  function think(dt) {
    zMap.clear();
    if (isCli() || state !== 'PLAYING') return;
    const S = sources(dt);
    for (const z of zombies) {
      zMap.set(z.root.position, z);
      if (z.dead || z.pup) continue;
      const a = ensure(z), p = z.root.position;
      if (CFG.alwaysChase.includes(z.type)) { a.s = 'chase'; z.spdK = z._k0; continue; }

      let best = null, bd = 1e9;
      for (const s of S) {
        const d = Math.hypot(s.x - p.x, s.z - p.z);
        if (d < s.vis * (a.s === 'chase' ? CFG.loseMult : 1) && d < bd) { bd = d; best = s; }
      }
      if (best) {
        if (a.s !== 'chase') { a.s = 'chase'; alertNear(z, best.x, best.z); }
        a.lost = 0; a.idle = 0; a.tx = best.x; a.tz = best.z; a.cx = best.x; a.cz = best.z;
      } else if (a.s === 'chase') {
        a.lost += dt;
        if (a.lost > CFG.loseTime) startSearch(a, a.tx, a.tz);        // dernière position connue
      }

      if (a.s === 'search') {
        a.ttl -= dt; a.idle = 0;
        if (Math.hypot(a.tx - p.x, a.tz - p.z) < 1.8) {               // arrivé : il fouille la zone
          a.tx = a.cx + rnd(-CFG.searchRadius, CFG.searchRadius);
          a.tz = a.cz + rnd(-CFG.searchRadius, CFG.searchRadius);
        }
        if (a.ttl <= 0) { a.s = 'idle'; a.idle = 0; a.wt = 0; a.still = false; }
        z.spdK = z._k0;
      } else if (a.s === 'idle') {
        a.idle += dt; a.wt -= dt;
        if (a.wt <= 0) {
          a.still = !a.still; a.wt = a.still ? rnd(3, 8) : rnd(3, 6);
          if (!a.still) { a.tx = p.x + rnd(-8, 8); a.tz = p.z + rnd(-8, 8); }
        }
        z.spdK = a.still ? 0 : z._k0 * CFG.wanderK;
        if (a.idle > CFG.idleLimit && S.length) {                     // anti-blocage des vagues
          const s = S[Math.random() * S.length | 0]; startSearch(a, s.x, s.z, 40);
        }
      } else z.spdK = z._k0;
    }
  }

  // ---- La cible de chaque zombie dépend de son état ----
  safe(() => {
    const _nt = nearTg;
    nearTg = function (p) {
      const z = zMap.get(p), a = z && z.ai;
      if (!a || a.s === 'chase' || isCli()) return _nt(p);
      const dx = a.tx - p.x, dz = a.tz - p.z, d = Math.hypot(dx, dz) || 1;
      const k = (d + (z.type === 'spitter' ? 25 : 6)) / d;           // cible fantôme : jamais atteinte, jamais attaquée
      return { x: p.x + dx * k, y: 0, z: p.z + dz * k, loc: false, id: 'ghost', rl: true };
    };
  });

  safe(() => {
    const _mz = makeZombie;
    makeZombie = function () { const r = _mz.apply(this, arguments); if (!isCli()) safe(() => ensure(zombies[zombies.length - 1])); return r; };
  });

  safe(() => {
    const _u = update;
    update = function (dt) {
      const paused = window.__paused || (typeof mapOpen !== 'undefined' && mapOpen && !net.on);
      if (state === 'PLAYING' && !paused) {
        safe(() => think(dt));
        runT -= dt;
        if (!selfDead && !isCli() && runT <= 0 && (window.__ZSPRINTING || Math.hypot(player.vel.x, player.vel.z) > CFG.sprintSpeed)) {
          runT = .5; makeNoise(player.pos.x, player.pos.z, CFG.noise.run);
        }
      }
      return _u.apply(this, arguments);
    };
  });

  // tirs du joueur local
  safe(() => {
    const _sh = shoot;
    shoot = function () {
      const ok = _sh.apply(this, arguments);
      if (ok) safe(() => makeNoise(player.pos.x, player.pos.z, CFG.noise[weaponKey] || (WEAPONS[weaponKey] ? CFG.noise.default : CFG.noise.melee)));
      return ok;
    };
  });

  // un zombie touché se retourne contre celui qui l'a touché
  safe(() => {
    const _hz = hurtZombie;
    hurtZombie = function (z) {
      const r = _hz.apply(this, arguments);
      if (!isCli() && z && z.ai && !z.dead) { z.ai.s = 'chase'; z.ai.lost = 0; z.ai.tx = player.pos.x; z.ai.tz = player.pos.z; }
      return r;
    };
  });

  // explosions (barils, zombies explosifs, grenades)
  safe(() => {
    const _ex = explosion;
    explosion = function (c) { safe(() => makeNoise(c.x, c.z, CFG.noise.explosion)); return _ex.apply(this, arguments); };
  });

  // coop : tirs des coéquipiers (seule l'hôte fait tourner l'IA)
  safe(() => {
    const _od = onData;
    onData = function (m) {
      safe(() => {
        if (net.host && m && m.t === 'zh') {
          const q = net.pl[m.f]; if (!q) return;
          makeNoise(q.x, q.z, CFG.noise.default);
          const z = zombies.find(a => a.id === m.id);
          if (z && z.ai && !z.dead) { z.ai.s = 'chase'; z.ai.lost = 0; z.ai.tx = q.x; z.ai.tz = q.z; }
        }
      });
      return _od.apply(this, arguments);
    };
  });
})();
