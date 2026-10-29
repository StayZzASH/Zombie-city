/* ============================================================
   fluidite.js — résolution dynamique : la définition de l'image baisse
   automatiquement quand la machine peine (et remonte dès que ça va mieux),
   ce qui évite les saccades sans toucher aux réglages ni à la qualité
   tant que le jeu tourne bien. Aucun effet si le jeu est déjà fluide.
   ============================================================ */
(function () {
  'use strict';
  const MIN = 0.6, STEP = 0.15, COOL = 2500;
  let base = 0, cur = 0, ema = 16.7, last = 0, slow = 0, fast = 0, lastChange = 0;
  const R = () => (typeof renderer !== 'undefined' && renderer) || null;
  function setRatio(v) {
    const r = R(); if (!r) return;
    v = Math.max(MIN, Math.min(base, v)); if (Math.abs(v - cur) < .01) return;
    cur = v; lastChange = performance.now();
    try { r.setPixelRatio(v); r.setSize(innerWidth, innerHeight); } catch (e) {}
    window.__ZRATIO = v;
  }
  function loop(t) {
    requestAnimationFrame(loop);
    const dt = t - last; last = t;
    const r = R();
    if (!r || dt <= 0 || dt > 400 || document.hidden || typeof state === 'undefined' || state !== 'PLAYING') { slow = fast = 0; return; }
    if (!base) { base = r.getPixelRatio(); cur = base; }
    ema += (dt - ema) * .08;
    const lim = (window.ZS && ZS.fps) ? 1000 / ZS.fps : 16.7;     // cadence visée (limite de FPS du joueur, sinon 60)
    if (t - lastChange < COOL) return;
    if (ema > lim * 1.45) { slow++; fast = 0; } else if (ema < lim * 1.12) { fast++; slow = 0; } else slow = fast = 0;
    if (slow > 45 && cur > MIN) { setRatio(cur - STEP); slow = 0; }          // ~0,75 s de lenteur -> on baisse
    else if (fast > 360 && cur < base) { setRatio(cur + STEP); fast = 0; }    // ~6 s de fluidité -> on remonte
  }
  addEventListener('resize', () => { const r = R(); if (r && base) try { r.setPixelRatio(cur); } catch (e) {} });
  requestAnimationFrame(loop);
})();
