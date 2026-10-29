/* ============================================================
   zombies-ambiance.js — LOT 4 : endurance, grognements, alarmes
   À placer APRÈS « zombies-chemin » (dernier script de index.html).

   1. ENDURANCE : jauge sous la santé. Sprint = Alt gauche maintenu
      (clavier) · joystick poussé à fond (tactile) · L3 (manette).
      Elle se vide en courant (≈ 4 s de sprint), se recharge
      après ~1 s de repos (plus vite à l'arrêt). À zéro : joueur
      ESSOUFFLÉ, fortement ralenti jusqu'à 25 % de jauge.
      Le sprint fait du bruit (cf. zombies-ia.js).
   2. GROGNEMENTS DIRECTIONNELS : chaque zombie en recherche / en chasse
      grogne à sa position (gauche / droite via stéréo, étouffé s'il est
      derrière, plus fort s'il est proche). Un premier grognement part dès
      qu'il te repère ou qu'il commence à contourner un obstacle. Remplace
      les grognements d'ambiance non directionnels.
   3. ALARMES : à chaque début de vague, message d'alerte sous le titre +
      sirène stridente. « ALARME GÉNÉRALE » quand beaucoup de zombies te
      traquent en même temps.
   Tous les réglages sont dans CFG.
   ============================================================ */
(function () {
  'use strict';
  const safe = f => { try { return f(); } catch (e) { console.warn('[zombies-ambiance]', e && e.message || e); } };

  const CFG = {
    sprintKey: 'AltLeft',      // touche de sprint clavier
    sprintMul: 1.38,           // vitesse de sprint clavier (≈ 5,8 / 4,2, comme le tactile)
    drain: 25,                 // endurance perdue par seconde en sprint
    regen: 16, regenStill: 28, // regain par seconde (en marchant / à l'arrêt)
    regenDelay: 1,             // pause avant le regain après un sprint (s)
    recover: 25,               // seuil pour sortir de l'essoufflement
    exhaustedSpeed: 2.2,       // vitesse max quand on est essoufflé
    groanRange: 38,            // portée d'écoute des grognements
    groanEvery: [4, 9],        // intervalle entre grognements (chasse / recherche)
    groanIdleEvery: [10, 20],  // intervalle en veille
    massAlarm: 6,              // nb de zombies en chasse pour déclencher « alarme générale »
    massCooldown: 45           // délai mini entre deux alarmes générales (s)
  };
  const rnd = (a, b) => a + Math.random() * (b - a);

  // ================= 1. ENDURANCE =================
  let stam = 100, exhausted = false, restT = 0, altDown = false, breathT = 0;
  window.__ZSPRINTING = false;

  addEventListener('keydown', e => { if (e.code === CFG.sprintKey) { altDown = true; e.preventDefault(); } }, true);
  addEventListener('keyup', e => { if (e.code === CFG.sprintKey) { altDown = false; e.preventDefault(); } }, true);
  addEventListener('blur', () => { altDown = false; });

  let stBar = null, stTxt = null;
  function hud() {
    if (stBar && document.body.contains(stBar)) return;
    const hb = document.getElementById('hp-bar'); if (!hb || !hb.parentElement) return;
    hb.parentElement.insertAdjacentHTML('afterend',
      '<div class="flex justify-between text-xs mt-2"><span class="text-slate-400">ENDURANCE (Alt)</span><span id="st-text" class="font-bold text-amber-300">100</span></div>' +
      '<div class="h-2 bg-slate-800 rounded mt-1"><div id="st-bar" class="h-2 bg-amber-400 rounded" style="width:100%"></div></div>');
    stBar = document.getElementById('st-bar'); stTxt = document.getElementById('st-text');
  }
  function paintStam() {
    hud(); if (!stBar) return;
    stBar.style.width = Math.max(0, stam) + '%';
    stBar.style.background = exhausted ? '#64748b' : stam < 30 ? '#f97316' : '#fbbf24';
    stTxt.textContent = exhausted ? 'ESSOUFFLÉ' : Math.round(stam);
    stTxt.style.color = exhausted ? '#94a3b8' : '#fcd34d';
  }
  function breath() {
    safe(() => { if (AC && typeof noise === 'function') noise(.4, 800, 250, .12, 'bandpass'); });
  }

  function stamTick(dt) {
    const inVeh = !!(window.VEH && VEH.cur);
    const sp = Math.hypot(player.vel.x, player.vel.z);
    const canKey = altDown && !crouching() && !ads && !rolling && !selfDead && grounded && sp > 2 && !inVeh;
    const pad = ((typeof isTouch !== 'undefined' && isTouch) || window.__GPSPRINT) && joy.f > .75 && sp > 4.8 && !inVeh;
    let sprint = false;

    if (!exhausted && stam > 0 && (canKey || pad)) {
      sprint = true;
      if (canKey) { player.pos.addScaledVector(player.vel, dt * (CFG.sprintMul - 1)); pushBoxes(player.pos, .4, player.pos.y, true); }
      stam -= CFG.drain * dt; restT = CFG.regenDelay;
      if (stam <= 0) { stam = 0; exhausted = true; breath(); toast('😮‍💨 ESSOUFFLÉ — tu ralentis', '#fbbf24'); }
    } else if (!inVeh) {
      restT -= dt;
      if (restT <= 0) stam = Math.min(100, stam + (sp < 1 ? CFG.regenStill : CFG.regen) * dt);
      if (exhausted && stam >= CFG.recover) exhausted = false;
    }
    // essoufflé : forte réduction de vitesse (on retire une part du déplacement déjà appliqué)
    if (exhausted && !inVeh && !selfDead && sp > CFG.exhaustedSpeed) {
      const cut = Math.min(.7, 1 - CFG.exhaustedSpeed / sp);
      player.pos.addScaledVector(player.vel, -dt * cut); pushBoxes(player.pos, .4, player.pos.y, true);
      breathT -= dt; if (breathT <= 0) { breathT = 1.6; breath(); }
    }
    window.__ZSPRINTING = sprint;
    paintStam();
  }
  const crouching = () => !!(keys.ShiftLeft || keys.ShiftRight);

  // ================= 2. GROGNEMENTS DIRECTIONNELS =================
  function groanAt(z, p, loud) {
    if (!AC || !master) return;
    const dx = p.x - player.pos.x, dz = p.z - player.pos.z, d = Math.hypot(dx, dz) || .001;
    if (d > CFG.groanRange) return;
    const _tg = AC.currentTime; if (!z._gcall && _tg - (groanAt._l || 0) < .3) return; groanAt._l = _tg;
    if (window.ZVOICE) { const _c = z._gcall; z._gcall = null; ZVOICE.zombie(z, z.ai ? z.ai.s : 'chase', _c); return; }   // voix riches (zombies-voix.js)   // jamais plus de ~3 grognements/s
    const rx = Math.cos(yaw), rz = -Math.sin(yaw), fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const pan = Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d)), front = (dx * fx + dz * fz) / d;   // front < 0 : derrière
    const vol = Math.max(.05, 1 - d / CFG.groanRange) * (loud ? 1.3 : 1) * .13, base = rnd(75, 120) * (z.cfg && z.cfg.s > 1.3 ? .7 : 1);
    const t0 = AC.currentTime, dur = rnd(.6, .95);
    const o = AC.createOscillator(), o2 = AC.createOscillator(), g = AC.createGain(), lp = AC.createBiquadFilter(), pn = AC.createStereoPanner ? AC.createStereoPanner() : null;
    o.type = 'sawtooth'; o2.type = 'square';
    o.frequency.setValueAtTime(base * 1.7, t0); o.frequency.exponentialRampToValueAtTime(base * .8, t0 + dur);
    o2.frequency.setValueAtTime(base * 1.69, t0); o2.frequency.exponentialRampToValueAtTime(base * .79, t0 + dur);
    lp.type = 'lowpass'; lp.frequency.value = front < 0 ? 380 : 1100;     // étouffé s'il est derrière
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + .12); g.gain.exponentialRampToValueAtTime(.001, t0 + dur);
    o.connect(lp); o2.connect(lp); lp.connect(g);
    if (pn) { pn.pan.value = pan; g.connect(pn); pn.connect(master); } else g.connect(master);
    o.start(t0); o2.start(t0); o.stop(t0 + dur + .05); o2.stop(t0 + dur + .05);
  }

  safe(() => {                               // coupe les grognements d'ambiance non directionnels
    const _g = SFX.groan;
    SFX.groan = function (v) { if (v !== undefined && v <= 1) return; return _g.apply(this, arguments); };
  });

  let lastMass = -1e9, tNow = 0;
  function groanTick(dt) {
    let chasing = 0;
    for (const z of zombies) {
      if (z.dead) continue;
      const a = z.ai, st = a ? a.s : 'chase', p = z.root.position;
      if (st === 'chase') chasing++;
      if (z._gst !== st) {                               // changement d'état : premier grognement immédiat
        const was = z._gst; z._gst = st;
        if (was !== undefined && st !== 'idle') { z._gt = rnd(.1, .8); z._gcall = st === 'chase' ? 'cry' : null; }   // il te repère : cri d'alerte
      }
      if (z._gt === undefined) z._gt = rnd(1, 8);
      if (z._pn && z._pn.path && st !== 'idle' && !z._gpath) { z._gpath = true; z._gt = Math.min(z._gt, rnd(.2, 1)); }   // il commence un contournement
      if (!z._pn || !z._pn.path) z._gpath = false;
      z._gt -= dt;
      if (z._gt <= 0) {
        z._gt = st === 'idle' ? rnd(...CFG.groanIdleEvery) : rnd(...CFG.groanEvery);
        safe(() => groanAt(z, p, st === 'chase'));
      }
    }
    // alarme générale : beaucoup de zombies te traquent
    if (chasing >= CFG.massAlarm && tNow - lastMass > CFG.massCooldown) {
      lastMass = tNow; alarm(); safe(() => window.ZVOICE && ZVOICE.horde()); banner('🚨 ALARME GÉNÉRALE : la horde converge sur vos coordonnées !', 2600);
    }
  }

  // ================= 3. ALARMES =================
  function alarm() {
    safe(() => {
      if (!AC || !master) return;
      const t0 = AC.currentTime, o = AC.createOscillator(), g = AC.createGain(), f = AC.createBiquadFilter();
      o.type = 'square'; f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = .8;
      for (let i = 0; i < 6; i++) o.frequency.setValueAtTime(i % 2 ? 720 : 1040, t0 + i * .3);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.16, t0 + .05); g.gain.setValueAtTime(.16, t0 + 1.6); g.gain.linearRampToValueAtTime(0, t0 + 1.9);
      o.connect(f); f.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 1.95);
    });
  }
  const WAVE_MSG = [
    'ALERTE : mouvements suspects près de vos coordonnées !',
    'ALERTE : la nuit tombe, la horde se réveille !',
    'ALERTE : ça grouille, restez groupés et silencieux !'
  ];
  safe(() => {
    const _b = banner;
    banner = function (t, ms) {
      const m = /^(⚠ BOSS — )?VAGUE (\d+)$/.exec(String(t));
      if (m && state === 'PLAYING' && mode !== 'pvp') {
        const w = +m[2], msg = m[1] ? 'ALERTE : un colosse approche, la horde est en marche !' : w >= 3 ? WAVE_MSG[1 + (w % 2)] : WAVE_MSG[0];
        alarm(); return _b.call(this, t + '\n' + msg, Math.max(ms || 2200, 3000));
      }
      return _b.apply(this, arguments);
    };
  });

  // ================= boucle =================
  safe(() => {
    const _u = update;
    update = function (dt) {
      const r = _u.apply(this, arguments);
      const paused = window.__paused || (typeof mapOpen !== 'undefined' && mapOpen && !net.on);
      if (state === 'PLAYING' && !paused) {
        tNow += dt;
        safe(() => stamTick(dt));
        if (mode !== 'pvp') safe(() => groanTick(dt));
      } else window.__ZSPRINTING = false;
      return r;
    };
  });
  safe(() => {                                 // jauge pleine à chaque nouvelle partie
    const _sg = startGame;
    startGame = function () { stam = 100; exhausted = false; restT = 0; return _sg.apply(this, arguments); };
  });
})();
