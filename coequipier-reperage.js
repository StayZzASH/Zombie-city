/* ============================================================
   zombies-coequipier.js — LOT 5 : repérer ses coéquipiers (Mate)
   À placer APRÈS « zombies-ambiance » (dernier script de index.html).

   Le pseudo 3D (nom + niveau + barre de vie) existait déjà au-dessus des
   alliés. Ce lot ajoute :
   - la DISTANCE sous le pseudo quand l'allié est à l'écran ;
   - une FLÈCHE sur le bord de l'écran, avec pseudo + distance, quand
     l'allié est hors écran ou derrière toi, pour aller l'aider vite ;
   - la couleur du coéquipier et sa barre de vie sur la flèche
     (rouge sous 25 PV, pour voir qu'il est en danger).
   Actif en coop / multijoueur PvE uniquement (pas en PvP).
   ============================================================ */
(function () {
  'use strict';
  const safe = f => { try { return f(); } catch (e) { console.warn('[zombies-coequipier]', e && e.message || e); } };
  const els = {}, v = new THREE.Vector3();

  function make(id) {
    const e = document.createElement('div');
    e.style.cssText = 'position:fixed;z-index:16;pointer-events:none;display:none;transform:translate(-50%,-50%);font:700 11px Inter,system-ui,sans-serif;text-align:center;text-shadow:0 1px 3px #000;white-space:nowrap';
    e.innerHTML = '<div class="zc-a" style="font-size:18px;line-height:14px">▲</div><div class="zc-n"></div><div style="width:40px;height:4px;background:#1e293b;border-radius:3px;margin:2px auto 0;overflow:hidden"><div class="zc-h" style="height:4px"></div></div>';
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;z-index:16;pointer-events:none;display:none;transform:translate(-50%,0);font:700 10px Inter,system-ui,sans-serif;color:#e2e8f0;text-shadow:0 1px 3px #000';
    document.body.appendChild(e); document.body.appendChild(d);
    return (els[id] = { arrow: e, dist: d });
  }

  function tick() {
    const active = state === 'PLAYING' && net.on && mode !== 'pvp';
    for (const id in els) if (!net.pl[id] || !active) { els[id].arrow.style.display = els[id].dist.style.display = 'none'; }
    if (!active) return;
    const W = innerWidth, H = innerHeight, m = 44;
    for (const id in net.pl) {
      const q = net.pl[id], e = els[id] || make(id);
      if (!q.al) { e.arrow.style.display = e.dist.style.display = 'none'; continue; }
      const dist = Math.round(Math.hypot(q.x - player.pos.x, q.z - player.pos.z));
      v.set(q.x, q.y + 2.6, q.z).project(camera);
      const behind = v.z >= 1, on = !behind && Math.abs(v.x) < .92 && Math.abs(v.y) < .88;
      if (on) {
        e.arrow.style.display = 'none';
        e.dist.style.display = 'block'; e.dist.textContent = dist + ' m';
        e.dist.style.left = (v.x * .5 + .5) * W + 'px'; e.dist.style.top = ((-v.y * .5 + .5) * H + 18) + 'px';
        continue;
      }
      e.dist.style.display = 'none';
      let dx = v.x, dy = v.y; if (behind) { dx = -dx; dy = -dy; }
      if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = -1;
      const k = Math.min((W / 2 - m) / Math.abs(dx || 1e-6), (H / 2 - m) / Math.abs(dy || 1e-6));   // projeté sur le bord de l'écran
      const sx = W / 2 + dx * k * 1, sy = H / 2 - dy * k * 1;
      const ang = Math.atan2(sx - W / 2, -(sy - H / 2)) * 180 / Math.PI;
      e.arrow.style.display = 'block'; e.arrow.style.left = sx + 'px'; e.arrow.style.top = sy + 'px';
      const a = e.arrow.querySelector('.zc-a'), n = e.arrow.querySelector('.zc-n'), h = e.arrow.querySelector('.zc-h');
      a.style.transform = 'rotate(' + ang + 'deg)'; a.style.color = q.col || '#fff';
      n.textContent = (net.ro[id] || q.n || id) + ' · ' + dist + ' m'; n.style.color = q.col || '#fff';
      h.style.width = Math.max(0, Math.min(100, q.hp)) + '%'; h.style.background = q.hp > 50 ? '#22c55e' : q.hp > 25 ? '#eab308' : '#ef4444';
    }
  }

  setInterval(() => {                       // masque tout hors partie (update ne tourne plus alors)
    if (!(state === 'PLAYING' && net.on && mode !== 'pvp')) for (const id in els) els[id].arrow.style.display = els[id].dist.style.display = 'none';
  }, 300);

  safe(() => {
    const _u = update;
    update = function () { const r = _u.apply(this, arguments); safe(tick); return r; };
  });
})();
