/* ============================================================
   zombies-combat.js — LOT 1 : équilibrage du combat zombies
   À placer en DERNIER dans index.html (après « audio-immersif »),
   dans un <script id="zombies-combat"> ... </script>
   (ou en <script src="zombies-combat.js"></script> avant </body>).

   Contenu :
   1. Zombies « légers » : exactement 2 coups pour les tuer (tir au corps),
      un tir à la tête les tue en 1 coup. Les plombs d'un fusil à pompe
      comptent pour UN seul coup.
   2. Dégâts zombies élevés : 3 coups max = game over (PV max = 100).
   3. Pression au contact : cooldown d'attaque réduit (~0,67 s au lieu de 1 s).
   4. Zombi Alpha : plus grand, beaucoup plus rapide, gros dégâts,
      un seul à la fois, alerte à l'écran à son apparition.
   Tout se règle dans CONFIG ci-dessous.
   ============================================================ */
(function () {
  'use strict';
  const safe = f => { try { return f(); } catch (e) { console.warn('[zombies-combat]', e && e.message || e); } };

  const CONFIG = {
    // types tués en exactement 2 coups (les costauds gardent leurs PV)
    twoHit: ['normal', 'fast', 'spitter', 'exploder', 'hurleur', 'rampant', 'sprinter', 'radioactif', 'pestifere'],
    // dégâts de contact sur le joueur (PV max = 100)
    dmg: { normal: 34, fast: 34, hurleur: 34, rampant: 34, sprinter: 34, radioactif: 34,
           spitter: 15, pestifere: 25, tank: 50, colosse: 50, boss: 50, alpha: 50 },
    closeRange: 2.2,      // distance (× taille du zombie) à partir de laquelle il « presse » son attaque
    attackSpeedUp: 0.5,   // +50 % de vitesse de récupération entre deux attaques
    pelletWindowMs: 30,   // plombs touchant le même zombie dans cette fenêtre = 1 seul coup
    alpha: { spd: 4.6, s: 1.6, dmg: 50 },
    /* ---- difficulté progressive (tout est ici) ---- */
    hitsStart: 1, hitsEvery: 5, hitsMax: 3,      // coups pour tuer un zombie léger : 1 (manches 1-5), 2 (6-10), 3 (11+) ; tête = toujours 1
    dmgStart: 0.30, dmgPerWave: 0.05, dmgMax: 1.20,   // dégâts au contact = base × (0,30 à la manche 1, +0,05 par manche, plafond 1,20 atteint à la manche 19)
    atkSpeedStart: 0, atkSpeedPerWave: 0.02            // cadence d'attaque : de plus en plus rapide, très lentement
  };
  const W = () => (typeof wave === 'number' && wave > 0 ? wave : 1);
  const hitsFor = () => Math.min(CONFIG.hitsMax, CONFIG.hitsStart + Math.floor((W() - 1) / CONFIG.hitsEvery));
  let _dw = -1;
  function scaleDmg() {
    if (_dw === W()) return; _dw = W();
    const f = Math.min(CONFIG.dmgMax, CONFIG.dmgStart + CONFIG.dmgPerWave * (W() - 1));
    for (const k in CONFIG.dmg) if (ZTYPES[k]) ZTYPES[k].dmg = Math.max(3, Math.round(CONFIG.dmg[k] * f));
  }

  // ---- 2. Dégâts des zombies + Alpha ----
  safe(() => {
    for (const k in CONFIG.dmg) if (ZTYPES[k]) ZTYPES[k].dmg = CONFIG.dmg[k];
    if (ZTYPES.alpha) { ZTYPES.alpha.spd = CONFIG.alpha.spd; ZTYPES.alpha.s = CONFIG.alpha.s; ZTYPES.alpha.dmg = CONFIG.alpha.dmg; }
  });

  // ---- 1. Exactement 2 coups ----
  const light = new Set(CONFIG.twoHit);
  safe(() => {
    const _hz = hurtZombie;
    hurtZombie = function (z, dmg, head, pt) {
      if (z && !z.dead && light.has(z.type)) {
        const now = performance.now();
        if (z._lh && now - z._lh < CONFIG.pelletWindowMs) return;   // plombs du même tir
        z._lh = now;
        dmg = z.max / hitsFor();   // corps : N coups selon la manche ; tête : ×2 dans hurtZombie
      }
      return _hz.call(this, z, dmg, head, pt);
    };
  });

  // ---- 3. Pression au contact ----
  safe(() => {
    const _u = update;
    update = function (dt) {
      if (state === 'PLAYING' && !window.__paused) {
        scaleDmg();
        const atkUp = Math.min(CONFIG.attackSpeedUp, CONFIG.atkSpeedStart + CONFIG.atkSpeedPerWave * (W() - 1));
        for (const z of zombies) {
          if (z.dead || z.pup || !(z.atk > 0)) continue;
          const p = z.root.position, tg = nearTg(p);
          if (Math.hypot(tg.x - p.x, tg.z - p.z) < CONFIG.closeRange * z.cfg.s) z.atk -= dt * atkUp;
        }
      }
      return _u.apply(this, arguments);
    };
  });

  // ---- 4. Zombi Alpha : un seul à la fois + alerte ----
  safe(() => {
    const _pt = pickType;
    pickType = function () {
      const r = _pt();
      return (r === 'alpha' && zombies.some(z => !z.dead && z.type === 'alpha')) ? 'sprinter' : r;
    };
    const _mz = makeZombie;
    makeZombie = function (t, x, z) {
      const r = _mz.apply(this, arguments);
      if (t === 'alpha') { toast('🐺 ZOMBI ALPHA ! Élimine-le en priorité', '#f97316'); SFX.groan(2); }
      return r;
    };
  });
})();
