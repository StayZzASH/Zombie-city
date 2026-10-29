/* ============================================================
   zombies-voix.js — voix des zombies (synthèse par formants, 100 % Web Audio)
   · grognement grave en veille, murmure interrogatif en recherche, grondement rauque en chasse
   · CRI D'ALERTE quand un zombie te repère, et les voisins lui RÉPONDENT (appel / réponse)
   · voix propres à chaque type : hurlement aigu (rapides), rugissement (tank / boss / alpha),
     gargouillis (cracheur), sifflement à bips (explosif)
   · spatialisation : pan gauche/droite, étouffé derrière toi, plus sourd et plus « réverbéré » au loin
   · rugissements lointains de la horde sur l'alarme générale
   Tous les réglages sont en haut : VOL (volume global), RANGE (portée).
   ============================================================ */
(function () {
  'use strict';
  const safe = f => { try { return f(); } catch (e) { console.warn('[zombies-voix]', e && e.message || e); } };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const VOL = 1, RANGE = 46, MAXLIVE = 8;
  let live = 0, lastT = 0, rev = null, gritCurve = null;

  function lazy() {
    if (rev || !AC || !master) return;
    const n = Math.floor(AC.sampleRate * 1.3), b = AC.createBuffer(2, n, AC.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); let lp = 0; for (let i = 0; i < n; i++) { lp += ((Math.random() * 2 - 1) - lp) * .35; d[i] = lp * Math.pow(1 - i / n, 2.6); } }
    const cv = AC.createConvolver(); cv.buffer = b; const g = AC.createGain(); g.gain.value = .7; cv.connect(g); g.connect(master); rev = cv;
    gritCurve = new Float32Array(256); for (let i = 0; i < 256; i++) gritCurve[i] = Math.tanh((i / 128 - 1) * 3);
  }

  function space(x, z) {
    if (x == null) return { g: 1, pan: 0, cut: 9000, wet: .12, d: 0 };
    const dx = x - player.pos.x, dz = z - player.pos.z, d = Math.hypot(dx, dz) || .001;
    if (d > RANGE) return null;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw), fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const pan = clamp((dx * rx + dz * rz) / d, -1, 1), front = (dx * fx + dz * fz) / d;
    return { g: 1 / (1 + d / 8), pan: pan * .85, cut: (front < 0 ? .55 : 1) * Math.max(700, 5200 / (1 + d / 10)), wet: Math.min(.7, .08 + d / 45), d };
  }

  /* sp : f [f0,f1,f2] (Hz), dur, vol, forms [[f,Q,gain]…], forms2 [f finales], vib [Hz, profondeur Hz], am [Hz, profondeur 0-1],
          noise (0-1), nf (Hz du souffle), saw2 (désaccord en cents), grit, sq (onde carrée), delay */
  function voice(sp, sx, sz) {
    if (!AC || !master || !noiseBuf || AC.state !== 'running') return;
    const sc = space(sx, sz); if (!sc) return;
    if (live >= MAXLIVE) return;
    lazy(); if (!rev) return;
    const t0 = AC.currentTime + (sp.delay || 0), dur = sp.dur, vol = sp.vol * sc.g * VOL * (sp.k || 1);
    if (vol < .004) return;
    const mix = AC.createGain(), env = AC.createGain();
    const src = [], oscs = [];
    const o1 = AC.createOscillator(); o1.type = sp.sq ? 'square' : 'sawtooth';
    o1.frequency.setValueAtTime(sp.f[0], t0);
    o1.frequency.linearRampToValueAtTime(sp.f[1], t0 + dur * .4); o1.frequency.linearRampToValueAtTime(sp.f[2], t0 + dur);
    oscs.push(o1); src.push(o1);
    if (sp.saw2) { const o2 = AC.createOscillator(); o2.type = 'sawtooth'; o2.detune.value = sp.saw2; o2.frequency.setValueAtTime(sp.f[0] * .5, t0); o2.frequency.linearRampToValueAtTime(sp.f[1] * .5, t0 + dur * .4); o2.frequency.linearRampToValueAtTime(sp.f[2] * .5, t0 + dur); oscs.push(o2); src.push(o2); }
    if (sp.vib) { const l = AC.createOscillator(), lg = AC.createGain(); l.frequency.value = sp.vib[0] * rnd(.9, 1.1); lg.gain.value = sp.vib[1]; l.connect(lg); src.forEach(o => lg.connect(o.frequency)); oscs.push(l); }
    let pre = AC.createGain(); src.forEach(o => o.connect(pre));
    if (sp.grit) { const ws = AC.createWaveShaper(); ws.curve = gritCurve; pre.connect(ws); pre = ws; }
    let amNode = pre;
    if (sp.am) {                                    // grondement : modulation d'amplitude rapide
      const a = AC.createGain(); a.gain.value = 1 - sp.am[1] * .5;
      const l = AC.createOscillator(), lg = AC.createGain(); l.frequency.value = sp.am[0] * rnd(.9, 1.1); lg.gain.value = sp.am[1] * .5; l.connect(lg); lg.connect(a.gain); oscs.push(l);
      pre.connect(a); amNode = a;
    }
    sp.forms.forEach(([f, q, a], i) => {
      const b = AC.createBiquadFilter(); b.type = 'bandpass'; b.Q.value = q; b.frequency.setValueAtTime(f, t0);
      if (sp.forms2 && sp.forms2[i]) b.frequency.linearRampToValueAtTime(sp.forms2[i], t0 + dur);
      const fg = AC.createGain(); fg.gain.value = a; amNode.connect(b); b.connect(fg); fg.connect(mix);
    });
    let ns = null;
    if (sp.noise) {                                 // souffle rauque
      ns = AC.createBufferSource(); ns.buffer = noiseBuf; ns.loop = true;
      const nb = AC.createBiquadFilter(); nb.type = 'bandpass'; nb.frequency.value = sp.nf || 900; nb.Q.value = sp.nq || .8;
      const ng = AC.createGain(); ng.gain.value = sp.noise; ns.connect(nb); nb.connect(ng); ng.connect(mix);
    }
    const att = sp.att || dur * .14;
    env.gain.setValueAtTime(.0001, t0); env.gain.linearRampToValueAtTime(vol, t0 + att); env.gain.setValueAtTime(vol, t0 + dur * .55); env.gain.exponentialRampToValueAtTime(.001, t0 + dur);
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(sp.lp || 9000, sc.cut); lp.Q.value = .5;
    mix.connect(env); env.connect(lp);
    let out = lp;
    if (AC.createStereoPanner) { const p = AC.createStereoPanner(); p.pan.value = sc.pan; lp.connect(p); out = p; }
    out.connect(master);
    const w = AC.createGain(); w.gain.value = sc.wet; out.connect(w); w.connect(rev);
    const end = t0 + dur + .08; live++;
    oscs.forEach(o => o.start(t0)); if (ns) ns.start(t0, Math.random() * .5);
    let n = oscs.length + (ns ? 1 : 0);
    const done = () => { if (--n === 0) live--; };
    oscs.forEach(o => { o.stop(end); o.onended = done; }); if (ns) { ns.stop(end); ns.onended = done; }
  }

  /* ---- catalogue ---- */
  const KINDS = {
    moan: pm => { const b = rnd(85, 125) * pm; return { dur: rnd(.8, 1.3), vol: .15, f: [b * 1.25, b * 1.5, b * .75], forms: [[650, 7, 1], [1080, 9, .6], [2400, 10, .25]], forms2: [450, 800, 2300], vib: [5.2, b * .03], am: [rnd(18, 26), .25], noise: .12, nf: 700, lp: 3800 }; },
    hunt: pm => { const b = rnd(65, 95) * pm; return { dur: rnd(.7, 1.1), vol: .19, f: [b * 1.4, b * 1.1, b * .8], forms: [[500, 6, 1], [900, 8, .7], [1700, 9, .3]], forms2: [420, 700, 1500], am: [rnd(28, 40), .6], grit: true, noise: .25, nf: 900, lp: 3500 }; },
    search: pm => { const b = rnd(95, 130) * pm; return { dur: rnd(.7, 1), vol: .13, f: [b, b * 1.25, b * 1.7], forms: [[550, 7, 1], [1700, 9, .6], [2500, 10, .25]], forms2: [600, 1900, 2600], vib: [5.5, b * .035], am: [20, .2], noise: .1, nf: 1100, lp: 4000 }; },
    answer: pm => { const b = rnd(80, 115) * pm; return { dur: rnd(.7, 1.1), vol: .11, f: [b * 1.2, b * 1.6, b * .8], forms: [[600, 7, 1], [1000, 9, .6], [2300, 10, .25]], forms2: [450, 800, 2200], vib: [5, b * .03], am: [22, .3], noise: .12, nf: 800, lp: 3300 }; },
    cry: pm => { const b = rnd(330, 460) * pm; return { dur: rnd(.9, 1.3), vol: .22, f: [b * .8, b * 1.7, b * 1.2], forms: [[800, 8, 1], [1500, 9, .8], [2800, 10, .45]], forms2: [950, 1800, 3000], vib: [7.5, b * .05], am: [11, .35], grit: true, noise: .3, nf: 2500, nq: 1.5, lp: 6000 }; },
    screech: pm => { const b = rnd(520, 700) * pm; return { dur: rnd(.6, .9), vol: .2, f: [b * .9, b * 1.6, b * 1.1], forms: [[900, 8, 1], [1700, 9, .8], [3000, 10, .5]], forms2: [1100, 2000, 3200], vib: [9, b * .06], am: [14, .4], grit: true, noise: .3, nf: 3000, nq: 1.5, lp: 7000 }; },
    roar: pm => { const b = rnd(48, 62) * pm; return { dur: rnd(1.3, 1.9), vol: .3, f: [b * 1.8, b * 2.4, b * 1.2], saw2: 14, forms: [[420, 5, 1], [800, 6, .9], [1500, 8, .5]], forms2: [300, 650, 1200], am: [rnd(14, 20), .7], grit: true, noise: .4, nf: 600, lp: 2600, att: .12 }; },
    gurgle: pm => { const b = rnd(100, 140) * pm; return { dur: .9, vol: .16, f: [b, b * 1.2, b * .8], forms: [[400, 6, 1], [900, 8, .6]], forms2: [900, 1300], am: [rnd(10, 16), .9], noise: .5, nf: 1200, nq: 2, lp: 2500 }; },
    wheeze: () => ({ dur: .8, vol: .1, sq: true, f: [900, 1500, 900], forms: [[1200, 4, 1]], am: [9, .95], noise: .3, nf: 3500, lp: 6000 }),
    pain: pm => { const b = rnd(160, 260) * pm; return { dur: .35, vol: .2, f: [b * 1.3, b * .7, b * .5], forms: [[700, 7, 1], [1300, 8, .6]], grit: true, noise: .2, nf: 1500, lp: 4500, att: .02 }; }
  };
  const BIG = ['tank', 'colosse', 'boss', 'alpha'], FAST = ['fast', 'sprinter', 'hurleur', 'rampant'];

  function play(kind, x, z, o) {
    const mk = KINDS[kind]; if (!mk) return;
    const sp = mk((o && o.pm) || 1); if (o && o.k) sp.k = o.k; if (o && o.delay) sp.delay = o.delay;
    voice(sp, x, z);
  }

  /* voix d'un zombie précis selon son type et son état (call = 'cry' : il vient de te repérer) */
  function zombie(z, st, call) {
    const p = z.root.position, ty = z.type, pm = (z.cfg && z.cfg.s > 1.3) ? .7 : 1;
    let kind;
    if (call) kind = BIG.includes(ty) ? 'roar' : FAST.includes(ty) ? 'screech' : ty === 'spitter' ? 'gurgle' : ty === 'exploder' ? 'wheeze' : 'cry';
    else if (BIG.includes(ty)) kind = st === 'chase' && Math.random() < .4 ? 'roar' : 'hunt';
    else if (ty === 'spitter') kind = 'gurgle';
    else if (ty === 'exploder') kind = st === 'idle' ? 'moan' : 'wheeze';
    else if (FAST.includes(ty) && st === 'chase') kind = Math.random() < .35 ? 'screech' : 'hunt';
    else kind = st === 'idle' ? 'moan' : st === 'search' ? 'search' : (Math.random() < .6 ? 'hunt' : 'moan');
    play(kind, p.x, p.z, { pm: kind === 'screech' || kind === 'cry' ? (ty === 'fast' ? 1.1 : 1) : pm });
    if (call === 'cry' && !BIG.includes(ty)) answer(z);
  }

  /* appel / réponse : les zombies voisins répondent au cri */
  function answer(src) {
    const p = src.root.position; let n = 0;
    for (const o of zombies) {
      if (n >= 3) break;
      if (o === src || o.dead || o.pup) continue;
      const q = o.root.position; if (Math.hypot(q.x - p.x, q.z - p.z) > 24) continue;
      n++;
      setTimeout(() => safe(() => { if (!o.dead && state === 'PLAYING') play(Math.random() < .5 ? 'answer' : 'moan', o.root.position.x, o.root.position.z, { pm: (o.cfg && o.cfg.s > 1.3) ? .7 : 1 }); }), rnd(400, 1300));
    }
  }

  /* alarme générale : la horde rugit au loin */
  function horde() {
    for (let i = 0; i < 4; i++) {
      const a = rnd(0, Math.PI * 2), r = rnd(14, 30);
      play(i % 2 ? 'roar' : 'cry', player.pos.x + Math.cos(a) * r, player.pos.z + Math.sin(a) * r, { delay: i * rnd(.25, .6), k: .9 });
    }
  }

  /* voix non positionnelle (appels du jeu : SFX.groan(2) = boss / alpha, SFX.groan(1.5) = zombie touché) */
  function globalVoice(v) { if (v >= 2) play('roar', null, null, { k: .9 }); else play('pain', null, null, { k: .8 }); }

  window.ZVOICE = { play, zombie, answer, horde, global: globalVoice, kinds: Object.keys(KINDS) };
})();
