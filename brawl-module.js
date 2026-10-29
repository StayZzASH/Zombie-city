// =====================================================================
//  brawl-module.js — SCRIPT CLASSIQUE (chargé par <script src="brawl-module.js">)
//  Le moteur Platform Fighter (maps, physique, knockback, stocks) est celui d'origine ;
//  il n'est plus un module ES (les « export » empêchaient tout chargement) et expose
//  maintenant window.BRAWL, que la liaison #brawl-glue de index.html attend.
//  Les images des maps sont chargées depuis le dossier  assets/  du jeu :
//  Map_<Nom>.webp  ou  <Nom>.png  ou  Map_<Nom>.png  (voir MAPS plus bas) — uniquement dans assets/.
// =====================================================================
(function () {
'use strict';
// =====================================================================
//  brawl-module.js  —  Platform fighter 2D (style Brawlhalla)
//  Canvas de référence : 1200 x 675
//  1) Maps + colliders (solid / one-way) + résolution X/Y
//  2) Dégâts %, knockback, hitstun, blastzones, stocks, respawn
//  3) VFX : slashes, poussière, hit sparks, indicateurs hors-écran
// =====================================================================

const CANVAS_W = 1200;
const CANVAS_H = 675;

// ---------------------------------------------------------------------
// 1. MAPS
// ---------------------------------------------------------------------
// type: 'solid'  -> bloque sur tous les côtés
//       'oneway' -> on la traverse par le bas / les côtés, on se pose dessus
//                   par le dessus, et on peut la traverser vers le bas (drop)
// Coordonnées estimées à partir des images 16:9 mises à l'échelle 1200x675.
// Activez le mode debug (MapManager.debug = true) pour les ajuster à l'œil.
const S = (x, y, w, h) => ({ x, y, w, h, type: 'solid' });
const O = (x, y, w, h = 14) => ({ x, y, w, h, type: 'oneway' });

const MAPS = {
  // Colliders mesurés sur les images mises à 1200x675 (grille de relevé).
  TempleRuins: {
    files: ['Map_TempleRuins.webp', 'TempleRuins.png', 'Map_TempleRuins.png'],
    spawns: [{ x: 500, y: 385 }, { x: 700, y: 385 }, { x: 256, y: 268 }, { x: 944, y: 272 }],
    platforms: [
      S(362, 388, 470, 130),   // gros bloc central
      S(178, 270, 157, 110),   // bloc gauche
      S(868, 275, 152, 110),   // bloc droit
      O(430, 250, 345),        // passerelle haute
      O(405, 316, 135),        // petite plateforme basse gauche
      O(660, 316, 140),        // petite plateforme basse droite
    ],
  },
  TheGreatHall: {
    files: ['Map_TheGreatHall.webp', 'TheGreatHall.png', 'Map_TheGreatHall.png'],
    spawns: [{ x: 520, y: 374 }, { x: 680, y: 374 }, { x: 390, y: 296 }, { x: 815, y: 294 }],
    platforms: [
      S(388, 377, 424, 188),   // estrade centrale
      O(418, 210, 364),        // plateforme haute
      O(320, 297, 135),        // gauche
      O(745, 295, 140),        // droite
    ],
  },
  KingsPass: {
    files: ['Map_KingsPass.webp', 'KingsPass.png', 'Map_KingsPass.png'],
    spawns: [{ x: 430, y: 299 }, { x: 790, y: 357 }, { x: 600, y: 200 }, { x: 760, y: 235 }],
    platforms: [
      S(298, 302, 258, 200),   // pilier gauche (haut)
      S(355, 500, 120, 175),   // pilier gauche (pied)
      S(652, 360, 272, 210),   // pilier droit (haut)
      S(725, 570, 125, 105),   // pilier droit (pied)
      O(678, 236, 157),        // petite passerelle
    ],
  },
  TwilightGrove: {
    files: ['Map_TwilightGrove.webp', 'TwilightGrove.png', 'Map_TwilightGrove.png'],
    spawns: [{ x: 560, y: 417 }, { x: 800, y: 417 }, { x: 640, y: 258 }, { x: 965, y: 272 }],
    platforms: [
      S(418, 420, 435, 140),   // île principale
      S(470, 560, 330, 115),   // racines sous l'île
      S(900, 275, 130, 150),   // rocher flottant droit
      O(565, 260, 145),        // branche haute
      O(300, 340, 150),        // branche gauche
    ],
  },
  GrumpyTemple: {
    files: ['Map_GrumpyTemple.webp', 'GrumpyTemple.png', 'Map_GrumpyTemple.png'],
    spawns: [{ x: 385, y: 382 }, { x: 815, y: 382 }, { x: 280, y: 318 }, { x: 920, y: 318 }],
    platforms: [
      S(250, 385, 272, 215),   // bloc gauche
      S(680, 385, 272, 215),   // bloc droit
      O(420, 236, 360),        // plateforme du haut
      O(205, 320, 153),        // haut gauche
      O(845, 320, 153),        // haut droit
    ],
  },
  Brawlhaven: {
    files: ['Map_Brawlhaven.webp', 'Brawlhaven.png', 'Map_Brawlhaven.png'],
    spawns: [{ x: 500, y: 395 }, { x: 750, y: 395 }, { x: 560, y: 202 }, { x: 740, y: 202 }],
    platforms: [
      S(348, 398, 552, 200),   // île principale
      O(402, 203, 450),        // dalle haute
      S(160, 130, 132, 190),   // grand bloc gauche
      S(935, 38, 133, 120),    // bloc haut droit
      S(1012, 295, 76, 70),    // petit rocher flottant
    ],
  },
};

// Zones d'explosion (blastzones) communes (hors canvas)
const BLASTZONE = { left: -250, right: CANVAS_W + 250, top: -300, bottom: CANVAS_H + 250 };

class MapManager {
  constructor() {
    this.name = null;
    this.data = null;
    this.image = null;
    this.debug = false;
  }

  /** Charge dynamiquement l'image : essaie chaque nom de fichier candidat. */
  async load(name, basePath = '') {
    const data = MAPS[name];
    if (!data) throw new Error(`Map inconnue : ${name}`);
    this.name = name;
    this.data = data;
    this.image = null;
    for (const file of data.files) {
      try {
        this.image = await loadImage(basePath + file);
        break;
      } catch (_) { /* essaie le suivant */ }
    }
    if (!this.image) console.warn(`[brawl] image introuvable pour ${name}, fond uni utilisé`);
    return this;
  }

  get platforms() { return this.data ? this.data.platforms : []; }
  get spawns() { return this.data ? this.data.spawns : []; }

  draw(ctx) {
    if (this.image) ctx.drawImage(this.image, 0, 0, CANVAS_W, CANVAS_H);
    else { ctx.fillStyle = '#223'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H); }
    if (this.debug) this.drawDebug(ctx);
  }

  drawDebug(ctx) {
    ctx.save();
    ctx.lineWidth = 2;
    for (const p of this.platforms) {
      ctx.strokeStyle = p.type === 'solid' ? '#ff3b3b' : '#3bff7a';
      ctx.fillStyle = p.type === 'solid' ? 'rgba(255,59,59,.25)' : 'rgba(59,255,122,.25)';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.strokeRect(p.x, p.y, p.w, p.h);
    }
    ctx.restore();
  }
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('load failed ' + src));
    img.src = src;
  });
}

// ---------------------------------------------------------------------
// Collisions AABB : axe X puis axe Y
// Le fighter doit avoir : x, y (coin haut-gauche), w, h, vx, vy,
// grounded, dropThrough (frames où les one-way sont ignorées)
// ---------------------------------------------------------------------
const overlap = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function moveAndCollide(f, platforms) {
  f.grounded = false;

  // ----- Axe X : seules les plateformes solides bloquent -----
  f.x += f.vx;
  for (const p of platforms) {
    if (p.type !== 'solid' || !overlap(f, p)) continue;
    if (f.vx > 0) f.x = p.x - f.w;
    else if (f.vx < 0) f.x = p.x + p.w;
    f.vx = 0;
  }

  // ----- Axe Y -----
  const prevBottom = f.y + f.h;      // avant déplacement
  const prevTop = f.y;
  f.y += f.vy;
  for (const p of platforms) {
    if (!overlap(f, p)) continue;

    if (p.type === 'solid') {
      if (f.vy >= 0 && prevBottom <= p.y + 1) {          // atterrit dessus
        f.y = p.y - f.h; f.vy = 0; f.grounded = true;
      } else if (f.vy < 0 && prevTop >= p.y + p.h - 1) { // tape le plafond
        f.y = p.y + p.h; f.vy = 0;
      } else if (f.vy >= 0) {                            // sécurité : repousse vers le haut
        f.y = p.y - f.h; f.vy = 0; f.grounded = true;
      } else {
        f.y = p.y + p.h; f.vy = 0;
      }
    } else {
      // one-way : uniquement par le dessus, en descendant, sans drop
      if (f.vy >= 0 && prevBottom <= p.y + 1 && !(f.dropThrough > 0)) {
        f.y = p.y - f.h; f.vy = 0; f.grounded = true;
      }
    }
  }
  if (f.dropThrough > 0) f.dropThrough--;
}

// ---------------------------------------------------------------------
// 2. COMBATTANT : % dégâts, knockback, hitstun, stocks
// ---------------------------------------------------------------------
const PHYS = {
  gravity: 0.55,
  maxFall: 14,
  fastFall: 18,
  runSpeed: 5.2,
  airSpeed: 4.4,
  jumpVel: -13.5,
  maxJumps: 2,
  friction: 0.8,
  airDrag: 0.98,
  dashSpeed: 11,
  dashFrames: 10,
  respawnInvuln: 90,
};

class Fighter {
  constructor({ id, color = '#4af', x = 0, y = 0, stocks = 3, weight = 100, name = 'P' + id }) {
    this.id = id; this.name = name; this.color = color;
    this.w = 40; this.h = 80;
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.facing = 1;
    this.percent = 0;
    this.stocks = stocks;
    this.weight = weight;       // plus lourd = moins éjecté
    this.grounded = false;
    this.wasGrounded = false;
    this.jumps = PHYS.maxJumps;
    this.hitstun = 0;
    this.invuln = 0;
    this.dashTimer = 0;
    this.dropThrough = 0;
    this.attackTimer = 0;
    this.dead = false;
    this.spawn = { x, y };
    this.spd = 1; this.jmp = 1;
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  /** input : { left, right, jump, down, dash, attack, heavy } (booléens, jump/dash/attack = front montant) */
  update(input, map, vfx) {
    if (this.dead) return;
    this.wasGrounded = this.grounded;

    const stunned = this.hitstun > 0;
    if (stunned) this.hitstun--;
    if (this.invuln > 0) this.invuln--;
    if (this.attackTimer > 0) this.attackTimer--;

    if (!stunned) {
      const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      if (dir) this.facing = dir;
      const speed = (this.grounded ? PHYS.runSpeed : PHYS.airSpeed) * this.spd;

      if (this.dashTimer > 0) {
        this.dashTimer--;
        this.vx = this.facing * PHYS.dashSpeed;
        if (this.grounded && this.dashTimer % 3 === 0) vfx.dust(this.cx - this.facing * 15, this.y + this.h, 2, -this.facing);
      } else {
        if (dir) this.vx += dir * 0.9, this.vx = clamp(this.vx, -speed, speed);
        else this.vx *= this.grounded ? PHYS.friction : PHYS.airDrag;
        if (input.dash && this.grounded) {
          this.dashTimer = PHYS.dashFrames;
          vfx.dust(this.cx, this.y + this.h, 8, -this.facing);
        }
      }

      if (input.jump && this.jumps > 0) {
        this.vy = PHYS.jumpVel * this.jmp;
        this.jumps--;
        vfx.dust(this.cx, this.y + this.h, this.grounded ? 8 : 4, 0);
      }
      if (input.down && !this.grounded) this.vy = Math.min(this.vy + 1.2, PHYS.fastFall);
      if (input.down && this.grounded) this.dropThrough = 12;   // traverser vers le bas
    }

    // Gravité
    this.vy = Math.min(this.vy + PHYS.gravity, stunned ? PHYS.maxFall * 1.4 : PHYS.maxFall);

    moveAndCollide(this, map.platforms);

    if (this.grounded) {
      this.jumps = PHYS.maxJumps;
      if (!this.wasGrounded && this.vy === 0) vfx.dust(this.cx, this.y + this.h, 10, 0);  // atterrissage
    }

    this.checkBlastzone(map, BLASTZONE, vfx);
  }

  /**
   * Applique un coup.
   * hit = { damage, baseKb, kbGrowth, angle (degrés, 0 = horizontal, 90 = vertical), dir (-1/1), x, y }
   */
  takeHit(hit, vfx) {
    if (this.invuln > 0 || this.dead) return false;

    this.percent = Math.min(999, this.percent + hit.damage);

    // Formule : l'éjection augmente avec le % et diminue avec le poids
    const weightFactor = 100 / this.weight;
    const kb = (hit.baseKb + this.percent * hit.kbGrowth * 0.1) * weightFactor;

    const rad = (hit.angle * Math.PI) / 180;
    this.vx = Math.cos(rad) * kb * hit.dir;
    this.vy = -Math.sin(rad) * kb;
    this.grounded = false;
    this.dashTimer = 0;

    // Hitstun proportionnel à la force d'éjection
    this.hitstun = Math.floor(clamp(kb * 1.6, 8, 90));

    if (vfx) vfx.hitSpark(hit.x ?? this.cx, hit.y ?? this.cy, kb, this.color);
    return true;
  }

  checkBlastzone(map, bz, vfx) {
    if (this.x + this.w < bz.left || this.x > bz.right || this.y + this.h < bz.top || this.y > bz.bottom) {
      this.stocks--;
      if (vfx) vfx.blastExplosion(
        clamp(this.cx, 0, CANVAS_W), clamp(this.cy, 0, CANVAS_H), this.color);
      if (this.stocks <= 0) { this.dead = true; return; }
      this.respawn();
    }
  }

  respawn() {
    this.x = this.spawn.x - this.w / 2; this.y = this.spawn.y - this.h;
    this.vx = 0; this.vy = 0;
    this.percent = 0;
    this.hitstun = 0;
    this.dashTimer = 0;
    this.jumps = PHYS.maxJumps;
    this.invuln = PHYS.respawnInvuln;
  }

  draw(ctx) {
    if (this.dead) return;
    ctx.save();
    // clignotement pendant l'invulnérabilité
    if (this.invuln > 0 && Math.floor(this.invuln / 4) % 2 === 0) ctx.globalAlpha = 0.4;
    ctx.fillStyle = this.hitstun > 0 ? '#fff' : this.color;
    ctx.fillRect(this.x, this.y, this.w, this.h);
    ctx.fillStyle = '#000';
    ctx.fillRect(this.cx + this.facing * 8 - 3, this.y + 14, 6, 6); // œil
    ctx.restore();
  }
}

/** Hitbox d'attaque devant le personnage. Renvoie un rect {x,y,w,h}. */
function attackBox(f, { reach = 55, h = 50, yOff = 15 } = {}) {
  return {
    x: f.facing > 0 ? f.x + f.w : f.x - reach,
    y: f.y + yOff, w: reach, h,
  };
}

/** Teste attaquant -> victimes. Renvoie le point d'impact (centre de l'intersection) ou null. */
function resolveAttack(attacker, victim, box, hitData, vfx) {
  if (victim === attacker || victim.dead) return false;
  if (!overlap(box, victim)) return false;
  const ix = Math.max(box.x, victim.x), iy = Math.max(box.y, victim.y);
  const ix2 = Math.min(box.x + box.w, victim.x + victim.w);
  const iy2 = Math.min(box.y + box.h, victim.y + victim.h);
  return victim.takeHit(
    { ...hitData, dir: attacker.facing, x: (ix + ix2) / 2, y: (iy + iy2) / 2 }, vfx);
}

// Coups prêts à l'emploi
const MOVES = {
  light: { damage: 7,  baseKb: 4.5, kbGrowth: 0.55, angle: 40, reach: 55, duration: 14 },
  heavy: { damage: 16, baseKb: 7.5, kbGrowth: 1.1,  angle: 50, reach: 75, duration: 28 },
};

/** Démarre une attaque : slash visuel + hitbox active sur une frame (à appeler une fois). */
function startAttack(f, kind, opponents, vfx) {
  const m = MOVES[kind];
  if (!m || f.attackTimer > 0 || f.hitstun > 0) return;
  f.attackTimer = m.duration;
  const box = attackBox(f, { reach: m.reach });
  vfx.slash(f.cx, f.cy - 5, f.facing, kind === 'heavy', f.color);
  for (const o of opponents) resolveAttack(f, o, box, m, vfx);
}

// ---------------------------------------------------------------------
// 3. VFX
// ---------------------------------------------------------------------
class VFX {
  constructor() {
    this.particles = [];
    this.slashes = [];
    this.sparks = [];
    this.rings = [];
  }

  /** Poussière : dir = direction opposée au mouvement (0 = symétrique) */
  dust(x, y, count = 6, dir = 0) {
    for (let i = 0; i < count; i++) {
      const spread = dir === 0 ? (Math.random() - 0.5) * 4 : dir * (0.5 + Math.random() * 2);
      this.particles.push({
        x: x + (Math.random() - 0.5) * 20, y: y - 2,
        vx: spread, vy: -Math.random() * 1.2,
        r: 3 + Math.random() * 4, life: 22 + Math.random() * 10, max: 32,
        color: '200,190,170',
      });
    }
  }

  /** Traînée d'attaque : arc lumineux devant le joueur */
  slash(x, y, facing, heavy, color = '#fff') {
    this.slashes.push({
      x, y, facing, color,
      radius: heavy ? 85 : 60,
      width: heavy ? 14 : 8,
      start: -1.1, end: 1.1,
      life: heavy ? 14 : 9, max: heavy ? 14 : 9,
    });
  }

  /** Étincelles à l'impact : force = knockback */
  hitSpark(x, y, force = 6, color = '#ffd34d') {
    const n = Math.min(24, 8 + Math.floor(force));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * (4 + force * 0.4);
      this.sparks.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        len: 8 + Math.random() * 10, life: 10 + Math.random() * 8, max: 18,
      });
    }
    this.rings.push({ x, y, r: 6, grow: 3.5 + force * 0.25, life: 12, max: 12, color: '#fff' });
    this.rings.push({ x, y, r: 3, grow: 2, life: 14, max: 14, color });
  }

  blastExplosion(x, y, color) {
    this.hitSpark(x, y, 28, color);
    this.rings.push({ x, y, r: 10, grow: 14, life: 26, max: 26, color });
  }

  update() {
    for (const p of this.particles) { p.x += p.vx; p.y += p.vy; p.vx *= 0.94; p.r += 0.15; p.life--; }
    this.particles = this.particles.filter(p => p.life > 0);
    for (const s of this.slashes) s.life--;
    this.slashes = this.slashes.filter(s => s.life > 0);
    for (const s of this.sparks) { s.x += s.vx; s.y += s.vy; s.vx *= 0.9; s.vy *= 0.9; s.life--; }
    this.sparks = this.sparks.filter(s => s.life > 0);
    for (const r of this.rings) { r.r += r.grow; r.life--; }
    this.rings = this.rings.filter(r => r.life > 0);
  }

  draw(ctx) {
    ctx.save();
    // Poussière
    for (const p of this.particles) {
      ctx.fillStyle = `rgba(${p.color},${(p.life / p.max) * 0.55})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    // Slashes (additif pour l'effet lumineux)
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.slashes) {
      const t = s.life / s.max;          // 1 -> 0
      const sweep = 1 - t;               // l'arc "balaie"
      const a0 = s.start, a1 = s.start + (s.end - s.start) * Math.min(1, sweep * 1.8 + 0.25);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.scale(s.facing, 1);
      ctx.lineCap = 'round';
      ctx.shadowColor = s.color; ctx.shadowBlur = 18;
      ctx.strokeStyle = `rgba(255,255,255,${t})`;
      ctx.lineWidth = s.width * t + 1;
      ctx.beginPath(); ctx.arc(-10, 0, s.radius, a0, a1); ctx.stroke();
      ctx.strokeStyle = s.color; ctx.globalAlpha = t * 0.7;
      ctx.lineWidth = s.width * 1.8 * t + 1;
      ctx.beginPath(); ctx.arc(-10, 0, s.radius - 4, a0, a1); ctx.stroke();
      ctx.restore();
    }
    // Étincelles
    ctx.strokeStyle = '#ffe58a'; ctx.lineCap = 'round';
    for (const s of this.sparks) {
      const t = s.life / s.max, sp = Math.hypot(s.vx, s.vy) || 1;
      ctx.globalAlpha = t; ctx.lineWidth = 2.5 * t + 0.5;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - (s.vx / sp) * s.len * t, s.y - (s.vy / sp) * s.len * t);
      ctx.stroke();
    }
    // Anneaux d'impact
    for (const r of this.rings) {
      ctx.globalAlpha = r.life / r.max; ctx.strokeStyle = r.color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
}

/** Flèches de bordure pour les combattants hors du canvas. */
function drawOffscreenIndicators(ctx, fighters, margin = 34) {
  ctx.save();
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const f of fighters) {
    if (f.dead) continue;
    const cx = f.cx, cy = f.cy;
    if (cx >= 0 && cx <= CANVAS_W && cy >= 0 && cy <= CANVAS_H) continue;

    const px = clamp(cx, margin, CANVAS_W - margin);
    const py = clamp(cy, margin, CANVAS_H - margin);
    const ang = Math.atan2(cy - CANVAS_H / 2, cx - CANVAS_W / 2);

    // distance -> la flèche rétrécit quand on s'éloigne
    const dist = Math.hypot(cx - px, cy - py);
    const scale = clamp(1 - dist / 600, 0.55, 1);

    ctx.save();
    ctx.translate(px, py);
    ctx.scale(scale, scale);
    // fond
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = f.color; ctx.lineWidth = 3; ctx.stroke();
    // flèche
    ctx.save();
    ctx.rotate(ang);
    ctx.fillStyle = f.color;
    ctx.beginPath(); ctx.moveTo(34, 0); ctx.lineTo(20, -9); ctx.lineTo(20, 9); ctx.closePath(); ctx.fill();
    ctx.restore();
    // pourcentage
    ctx.fillStyle = '#fff';
    ctx.fillText(Math.floor(f.percent) + '%', 0, 1);
    ctx.restore();
  }
  ctx.restore();
}

/** HUD simple : % et stocks. */
function drawHUD(ctx, fighters) {
  ctx.save();
  ctx.font = 'bold 28px sans-serif'; ctx.textBaseline = 'top';
  const slot = CANVAS_W / (fighters.length + 1);
  fighters.forEach((f, i) => {
    const x = slot * (i + 1);
    ctx.textAlign = 'center';
    ctx.fillStyle = f.color;
    ctx.fillText(Math.floor(f.percent) + '%', x, CANVAS_H - 70);
    ctx.font = '16px sans-serif'; ctx.fillStyle = '#fff';
    ctx.fillText(f.name + '  ' + '●'.repeat(Math.max(0, f.stocks)), x, CANVAS_H - 34);
    ctx.font = 'bold 28px sans-serif';
  });
  ctx.restore();
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------------
// EXEMPLE D'UTILISATION
// ---------------------------------------------------------------------
/*
import { MapManager, Fighter, VFX, startAttack, drawOffscreenIndicators, drawHUD, CANVAS_W, CANVAS_H } from './brawl-module.js';

const canvas = document.getElementById('game');
canvas.width = CANVAS_W; canvas.height = CANVAS_H;
const ctx = canvas.getContext('2d');

const map = new MapManager();
await map.load('Brawlhaven', './assets/');   // essaie Map_Brawlhaven.webp puis Brawlhaven.png
map.debug = true;                             // affiche les colliders (rouge = solide, vert = one-way)

const vfx = new VFX();
const p1 = new Fighter({ id: 1, color: '#4af', x: map.spawns[0].x, y: map.spawns[0].y });
const p2 = new Fighter({ id: 2, color: '#f64', x: map.spawns[1].x, y: map.spawns[1].y });
const fighters = [p1, p2];

function loop() {
  p1.update(readInput1(), map, vfx);   // readInput1 : { left, right, jump, down, dash, attack, heavy }
  p2.update(readInput2(), map, vfx);
  if (input1.attack) startAttack(p1, 'light', [p2], vfx);
  if (input1.heavy)  startAttack(p1, 'heavy', [p2], vfx);
  vfx.update();

  map.draw(ctx);
  fighters.forEach(f => f.draw(ctx));
  vfx.draw(ctx);
  drawOffscreenIndicators(ctx, fighters);
  drawHUD(ctx, fighters);
  requestAnimationFrame(loop);
}
loop();
*/

/* =====================================================================
   PERSONNAGES  —  Valen · Kaelen · Pyra · Thorgrimm
   Coup léger = J / clic gauche   (+ ↓ : coup bas)
   Pouvoir    = K / clic droit    neutre | ← → (côté) | ↓ (bas)
   ===================================================================== */
const CHAR_IDS = ['valen', 'kaelen', 'pyra', 'thorgrimm'];
const CHARS = {
  valen:     { name: 'Valen',     title: 'Chevalier Céleste',   color: '#f5c542', weight: 100, spd: 1.05, jmp: 1.0,  w: 40, h: 82,
               light: { dmg: 6, kb: 4.2, grow: .5,  angle: 35, reach: 66, dur: 12, h: 54 },
               low:   { dmg: 5, kb: 3.6, grow: .4,  angle: 20, reach: 72, dur: 16, h: 26, yOff: 54 },
               powers: ['Envol Céleste', 'Charge de Paladin', 'Onde de Choc'] },
  kaelen:    { name: 'Kaelen',    title: 'Assassin des Ombres', color: '#a855f7', weight: 82,  spd: 1.3,  jmp: 1.12, w: 36, h: 80,
               light: { dmg: 4, kb: 3.4, grow: .4,  angle: 45, reach: 56, dur: 8,  h: 50 },
               low:   { dmg: 4, kb: 3.0, grow: .3,  angle: 25, reach: 60, dur: 12, h: 26, yOff: 54 },
               powers: ['Téléportation d’Ombre', 'Guillotine', 'Clone d’Ombre'] },
  pyra:      { name: 'Pyra',      title: 'Pyromancienne',       color: '#fb923c', weight: 90,  spd: 1.0,  jmp: 1.0,  w: 38, h: 80,
               light: { shot: true, dmg: 3.5, kb: 2.6, grow: .3, angle: 28, dur: 11 },
               low:   { shot: true, dmg: 3.5, kb: 2.6, grow: .3, angle: 28, dur: 11, low: true },
               powers: ['Éruption Solaire', 'Boule de Feu Géante', 'Piège Pyrotechnique'] },
  thorgrimm: { name: 'Thorgrimm', title: 'Brawler Berserker',   color: '#60a5fa', weight: 135, spd: 0.82, jmp: 0.92, w: 46, h: 88,
               light: { dmg: 9, kb: 5.6, grow: .75, angle: 38, reach: 80, dur: 20, h: 62 },
               low:   { dmg: 8, kb: 5.0, grow: .6,  angle: 30, reach: 72, dur: 22, h: 28, yOff: 56 },
               powers: ['Fracas du Titan', 'Tourbillon de la Hache', 'Saisie Féroce'] },
};

/* =====================================================================
   LIAISON  window.BRAWL  —  API attendue par #brawl-glue (index.html)
   ===================================================================== */
const ASSET_DIRS = ['assets/'];   // les maps Brawl sont uniquement dans le dossier assets du jeu
const MAP_REG = {};

function loadMapImage(entry) {
  const urls = [];
  for (const d of ASSET_DIRS) for (const f of entry.files) urls.push(d + f);
  let i = 0;
  const img = new Image();
  const next = () => {
    if (i >= urls.length) {
      entry.failed = true;
      console.warn('[brawl] image introuvable pour la map ' + entry.id + ' — fichiers cherchés dans assets/ : ' + entry.files.join(', ') + ' (fond uni utilisé)');
      return;
    }
    img.src = urls[i++];
  };
  img.onload = () => { entry.image = img; entry.src = img.src; };
  img.onerror = next;
  next();
}
function mapEntry(id) {
  if (MAP_REG[id]) return MAP_REG[id];
  const m = MAPS[id];
  if (!m) return null;
  const extra = [id + '.webp', 'Map_' + id + '.jpg', id + '.jpg'];
  const e = MAP_REG[id] = { id, platforms: m.platforms, spawns: m.spawns, files: m.files.concat(extra), image: null, failed: false };
  loadMapImage(e);
  return e;
}
const NOOP_VFX = new Proxy({}, { get: () => () => {} });     // la simulation n'a pas besoin des particules
const dmgColor = p => p < 50 ? '#ffffff' : p < 100 ? '#ffd34d' : p < 150 ? '#ff9a3c' : '#ff4d4d';
const r1 = v => Math.round(v * 10) / 10;
const TAU = Math.PI * 2;

function pushEvent(g, type, data) {
  g.events.push(Object.assign({ seq: ++g.seq, type }, data));
  if (g.events.length > 80) g.events.splice(0, g.events.length - 80);
}
function setVx(f, v) { f.vx = v / (f.grounded ? PHYS.friction : PHYS.airDrag); }   // compense le frottement de Fighter.update
const solidAt = (g, box) => g.map.platforms.some(pl => pl.type === 'solid' && overlap(box, pl));
function nearest(g, p) {
  let best = null, bd = 1e9;
  for (const o of g.players) { if (o === p || o.f.dead) continue; const d = Math.abs(o.f.cx - p.f.cx) + Math.abs(o.f.cy - p.f.cy); if (d < bd) { bd = d; best = o.f; } }
  return best;
}
const puff = (g, x, y) => g.ents.push({ type: 'puff', x, y, life: 14, max: 14 });

/** Touche tous les adversaires dans `box` (une seule fois chacun grâce à hitSet). Renvoie les victimes. */
function strike(g, p, box, m, hitSet, opts) {
  const out = [], f = p.f;
  for (const o of g.players) {
    if (o === p || o.f.dead || hitSet.has(o.id) || !overlap(box, o.f)) continue;
    const dir = opts && opts.fromX != null ? (o.f.cx >= opts.fromX ? 1 : -1) : (opts && opts.dir) || f.facing;
    if (o.f.takeHit({ damage: m.dmg, baseKb: m.kb, kbGrowth: m.grow, angle: m.angle, dir, x: o.f.cx, y: o.f.cy }, NOOP_VFX)) {
      hitSet.add(o.id); out.push(o);
      pushEvent(g, 'hit', { attackerId: p.id, targetId: o.id, damage: m.dmg, knockback: r1(Math.hypot(o.f.vx, o.f.vy)), color: CHARS[p.char].color });
    }
  }
  return out;
}
function explode(g, own, x, y, m) {
  g.ents.push({ type: 'boom', x, y, life: 14, max: 14, r: 80 });
  if (own) strike(g, own, { x: x - 80, y: y - 80, w: 160, h: 160 }, m, new Set(), { fromX: x });
}
const front = (f, reach, h, yOff) => attackBox(f, { reach, h, yOff });

/* ---------- les 3 pouvoirs de chaque personnage ---------- */
const POWERS = {
  valen: {
    n: { dur: 28, start(g, p) { const f = p.f; f.vy = -12; f.vx = f.facing * 7.5; f.grounded = false; },            // Envol Céleste
         tick(g, p, t) { const f = p.f; if (t <= 12) setVx(f, f.facing * 7.5);
           if (t >= 2 && t <= 18) strike(g, p, front(f, 62, 94, -44), { dmg: 11, kb: 6.8, grow: .95, angle: 66 }, p.act.hit); } },
    s: { dur: 24, tick(g, p, t) { const f = p.f; if (t <= 16) setVx(f, f.facing * 12.5);                            // Charge de Paladin
           if (t <= 18) strike(g, p, front(f, 56, 74, 4), { dmg: 13, kb: 8, grow: 1, angle: 26 }, p.act.hit); } },
    d: { dur: 30, tick(g, p, t) { const f = p.f;                                                                   // Onde de Choc
           if (t === 8) g.ents.push({ type: 'shock', x: f.cx, y: f.y + f.h, life: 12, max: 12, w: 200, c: '#f5c542' });
           if (t >= 8 && t <= 11) strike(g, p, { x: f.cx - 100, y: f.y + f.h - 48, w: 200, h: 54 }, { dmg: 12, kb: 7, grow: .9, angle: 74 }, p.act.hit, { fromX: f.cx }); } },
  },
  kaelen: {
    n: { dur: 38, start(g, p) { const f = p.f, e = nearest(g, p);                                                  // Téléportation d'Ombre
           puff(g, f.cx, f.cy);
           if (e) { f.facing = e.cx >= f.cx ? 1 : -1; f.x = clamp(e.cx - f.w / 2, 10, CANVAS_W - 10 - f.w); f.y = e.y - 125; f.vx = 0; f.vy = 0; puff(g, f.cx, f.cy); }
           f.invuln = Math.max(f.invuln, 10); },
         tick(g, p, t) { const f = p.f, a = p.act;
           if (t < 9) { f.vy = 0; f.vx = 0; return; }
           f.vy = Math.max(f.vy, 15);
           strike(g, p, { x: f.x - 10, y: f.y + f.h - 24, w: f.w + 20, h: 62 }, { dmg: 12, kb: 6.8, grow: .9, angle: 32 }, a.hit, { fromX: f.cx });
           if (f.grounded && t > 12 && !a.land) { a.land = 1; a.dur = t + 6; f.attackTimer = 6; p.atkMax = Math.max(p.atkMax, t + 6); } } },
    s: { dur: 34, tick(g, p, t) { const f = p.f;                                                                   // Guillotine
           if (t === 5) g.ents.push({ type: 'chain', x: f.cx, y: f.cy - 6, f: f.facing, life: 14, max: 14, len: 150 });
           if (t >= 5 && t <= 10) for (const o of strike(g, p, front(f, 150, 38, 18), { dmg: 8, kb: 1.5, grow: .2, angle: 20 }, p.act.hit)) {
             o.f.vx = -f.facing * 16; o.f.vy = -4; o.f.hitstun = Math.max(o.f.hitstun, 22); } } },
    d: { dur: 26, start(g, p) { const f = p.f;                                                                     // Clone d'Ombre
           g.ents.push({ type: 'clone', x: f.cx, y: f.y, f: f.facing, life: 20, max: 20, owner: p.id, hit: new Set() });
           f.invuln = Math.max(f.invuln, 12); },
         tick(g, p, t) { if (t <= 8) setVx(p.f, -p.f.facing * 10); } },
  },
  pyra: {
    n: { dur: 36, tick(g, p, t) { const f = p.f;                                                                   // Éruption Solaire
           if (t === 10) g.ents.push({ type: 'pillar', x: f.cx + f.facing * 62, y: f.y + f.h, life: 16, max: 16, w: 58, h: 210, owner: p.id, hit: new Set() }); } },
    s: { dur: 30, tick(g, p, t) { const f = p.f;                                                                   // Boule de Feu Géante
           if (t === 10) g.ents.push({ type: 'fire', x: f.cx + f.facing * 34, y: f.cy - 6, vx: f.facing * 8.5, r: 24, life: 110, max: 110, owner: p.id }); } },
    d: { dur: 22, tick(g, p, t) { const f = p.f;                                                                   // Piège Pyrotechnique
           if (t === 6) {
             const mine = g.ents.filter(e => e.type === 'mine' && e.owner === p.id);
             if (mine.length >= 2) g.ents.splice(g.ents.indexOf(mine[0]), 1);
             g.ents.push({ type: 'mine', x: f.cx, y: f.y + f.h - 6, life: 900, max: 900, arm: 24, owner: p.id }); } } },
  },
  thorgrimm: {
    n: { dur: 48, start(g, p) { p.f.vy = -12.5; p.f.grounded = false; },                                           // Fracas du Titan
         tick(g, p, t) { const f = p.f, a = p.act;
           if (t <= 8) setVx(f, f.facing * 2.5);
           if (t >= 9 && !a.slam) {
             f.vy = Math.max(f.vy, 15);
             strike(g, p, { x: f.x - 6, y: f.y + f.h - 10, w: f.w + 12, h: 46 }, { dmg: 10, kb: 6, grow: .8, angle: 62 }, a.hit, { fromX: f.cx });
             if (f.grounded && t >= 12) {
               a.slam = 1; a.dur = t + 9; f.attackTimer = 9; p.atkMax = Math.max(p.atkMax, t + 9);
               g.ents.push({ type: 'shock', x: f.cx, y: f.y + f.h, life: 14, max: 14, w: 240, c: '#9ca3af' });
               strike(g, p, { x: f.cx - 120, y: f.y + f.h - 56, w: 240, h: 62 }, { dmg: 15, kb: 8.6, grow: 1.05, angle: 70 }, a.hit, { fromX: f.cx });
             } } } },
    s: { dur: 40, tick(g, p, t) { const f = p.f;                                                                   // Tourbillon de la Hache
           if (t <= 30) { setVx(f, f.facing * 6.5); if (t % 8 === 1) p.act.hit = new Set();
             strike(g, p, { x: f.x - 38, y: f.y - 4, w: f.w + 76, h: f.h + 8 }, { dmg: 5, kb: 4.2, grow: .5, angle: 55 }, p.act.hit, { fromX: f.cx }); }
           if (t === 31) { p.act.hit = new Set(); strike(g, p, { x: f.x - 44, y: f.y - 4, w: f.w + 88, h: f.h + 8 }, { dmg: 8, kb: 8.6, grow: 1, angle: 40 }, p.act.hit, { dir: f.facing }); } } },
    d: { dur: 36, tick(g, p, t) { const f = p.f, a = p.act;                                                        // Saisie Féroce
           if (t === 6) for (const o of g.players) {
             if (o === p || o.f.dead || o.f.invuln > 0 || !o.f.grounded) continue;
             if (overlap(front(f, 66, 70, 10), o.f)) { a.vic = o; o.f.hitstun = 40; break; } }
           if (a.vic && t >= 6 && t < 16) { const o = a.vic.f; o.vx = 0; o.vy = 0; o.hitstun = Math.max(o.hitstun, 4); o.x = f.facing > 0 ? f.x + f.w : f.x - o.w; o.y = f.y - 26; }
           if (a.vic && t === 16) { const o = a.vic; o.f.hitstun = 0;
             if (o.f.takeHit({ damage: 14, baseKb: 20, kbGrowth: 1.3, angle: 18, dir: f.facing, x: o.f.cx, y: o.f.cy }, NOOP_VFX))
               pushEvent(g, 'hit', { attackerId: p.id, targetId: o.id, damage: 14, knockback: r1(Math.hypot(o.f.vx, o.f.vy)), color: CHARS[p.char].color });
             a.vic = null; } } },
  },
};

function startPower(g, p, i) {
  const f = p.f, kind = i.down ? 'd' : (i.left || i.right) ? 's' : 'n';
  if (kind === 's') f.facing = (i.left && !i.right) ? -1 : 1;
  const pw = POWERS[p.char][kind];
  p.act = { k: kind, t: 0, dur: pw.dur, hit: new Set(), vic: null };
  f.attackTimer = pw.dur; p.atkMax = pw.dur; p.ak = kind;
  pushEvent(g, 'attack', { playerId: p.id, kind });
  if (pw.start) pw.start(g, p);
}
function startLight(g, p, i) {
  const f = p.f, c = CHARS[p.char], m = i.down ? c.low : c.light;
  f.attackTimer = m.dur; p.atkMax = m.dur; p.ak = i.down ? 'L' : 'l';
  pushEvent(g, 'attack', { playerId: p.id, kind: p.ak });
  if (m.shot) {
    g.ents.push({ type: 'bolt', x: f.cx + f.facing * 28, y: m.low ? f.cy + 14 : f.cy - 4, vx: f.facing * 14, life: 46, max: 46, owner: p.id, m });
    return;
  }
  strike(g, p, attackBox(f, { reach: m.reach, h: m.h, yOff: m.yOff != null ? m.yOff : 15 }),
         { dmg: m.dmg, kb: m.kb, grow: m.grow, angle: m.angle }, new Set());
}
function tickEnts(g) {
  for (let n = g.ents.length - 1; n >= 0; n--) {
    const e = g.ents[n], own = g.players.find(q => q.id === e.owner);
    e.life--;
    let dead = e.life <= 0;
    if (e.type === 'bolt') {
      e.x += e.vx; const box = { x: e.x - 8, y: e.y - 5, w: 16, h: 10 };
      if (solidAt(g, box) || e.x < -50 || e.x > CANVAS_W + 50) dead = true;
      else if (own && strike(g, own, box, { dmg: e.m.dmg, kb: e.m.kb, grow: e.m.grow, angle: e.m.angle }, new Set(), { dir: Math.sign(e.vx) }).length) dead = true;
    } else if (e.type === 'fire') {
      e.x += e.vx; const box = { x: e.x - e.r, y: e.y - e.r, w: e.r * 2, h: e.r * 2 };
      let hitSomething = solidAt(g, box) || e.x < -60 || e.x > CANVAS_W + 60;
      if (!hitSomething) for (const o of g.players) if (o.id !== e.owner && !o.f.dead && overlap(box, o.f)) { hitSomething = true; break; }
      if (hitSomething) { explode(g, own, e.x, e.y, { dmg: 14, kb: 8.5, grow: 1, angle: 40 }); dead = true; }
    } else if (e.type === 'pillar') {
      if (own && e.life > 2) strike(g, own, { x: e.x - e.w / 2, y: e.y - e.h, w: e.w, h: e.h }, { dmg: 12, kb: 7.6, grow: .95, angle: 84 }, e.hit, { fromX: e.x });
    } else if (e.type === 'mine') {
      if (e.arm > 0) e.arm--;
      else {
        const box = { x: e.x - 36, y: e.y - 44, w: 72, h: 52 };
        for (const o of g.players) if (o.id !== e.owner && !o.f.dead && o.f.invuln <= 0 && overlap(box, o.f)) {
          explode(g, own, e.x, e.y - 10, { dmg: 13, kb: 7.5, grow: .95, angle: 80 }); dead = true; break; }
      }
    } else if (e.type === 'clone') {
      if (e.life === 10 && own) strike(g, own, { x: e.f > 0 ? e.x + 18 : e.x - 90, y: e.y + 10, w: 72, h: 60 }, { dmg: 10, kb: 6.5, grow: .85, angle: 40 }, e.hit, { dir: e.f });
    }
    if (dead) g.ents.splice(n, 1);
  }
  if (g.ents.length > 40) g.ents.splice(0, g.ents.length - 40);
}

function applyChar(p, id) {
  const c = CHARS[id]; if (!c) return;
  const f = p.f, sx = f.spawn.x, sy = f.spawn.y;
  p.char = id; f.weight = c.weight; f.spd = c.spd; f.jmp = c.jmp; f.w = c.w; f.h = c.h;
  f.x = sx - f.w / 2; f.y = sy - f.h;
}

const BRAWL = {
  version: 'persos-4',
  CANVAS_W, CANVAS_H, MAPS, PHYS, CHARS, CHAR_IDS,
  getMapIds: () => Object.keys(MAPS),
  getMap: id => mapEntry(id) || mapEntry(Object.keys(MAPS)[0]),

  createGame({ mapId, config } = {}) {
    const ids = Object.keys(MAPS);
    const id = MAPS[mapId] ? mapId : ids[0];
    return { mapId: id, map: mapEntry(id), config: Object.assign({ stocks: 3 }, config), players: [], status: 'waiting',
             winnerId: null, events: [], seq: 0, tick: 0, ents: [] };
  },
  addPlayer(g, { id, username, char }) {
    const i = g.players.length, sp = g.map.spawns[i % g.map.spawns.length];
    const f = new Fighter({ id, color: i === 0 ? '#55b7ff' : '#ff6685', x: sp.x, y: sp.y, stocks: g.config.stocks, name: username });
    const used = g.players.map(q => q.char), free = CHAR_IDS.filter(c => !used.includes(c));
    const pick = CHARS[char] ? char : (free.length ? free : CHAR_IDS)[Math.floor(Math.random() * (free.length ? free.length : CHAR_IDS.length))];
    const p = { id, username: username || String(id), f, inp: {}, prev: {}, atkMax: 1, ak: '', act: null, cd: 0, char: pick };
    g.players.push(p); applyChar(p, pick);
    return f;
  },
  /** Choix du personnage : possible tant que le combat n'a pas commencé (compte à rebours). */
  setChar(g, id, char) {
    const p = g.players.find(q => q.id === id);
    if (p && CHARS[char] && g.tick === 0 && p.char !== char) applyChar(p, char);
  },
  start(g) { g.status = 'playing'; },
  applyInput(g, id, inp) {
    const p = g.players.find(q => q.id === id);
    if (!p) return;
    inp = inp || {};
    p.inp = { left: !!inp.left, right: !!inp.right, jump: !!inp.jump, light: !!inp.light, heavy: !!inp.heavy, pickup: !!inp.pickup, down: !!inp.down };
  },
  step(g, dt) {
    if (g.status !== 'playing') return;
    g.tick++;
    for (const p of g.players) {
      const f = p.f, i = p.inp, pr = p.prev, edge = k => i[k] && !pr[k];
      if (f.dead) { p.prev = Object.assign({}, i); continue; }
      if (f.hitstun > 0 && p.act) { p.act = null; p.cd = 0; }                 // un coup reçu interrompt le pouvoir
      const stocks0 = f.stocks;
      if (!p.act && p.cd <= 0 && f.hitstun <= 0 && f.attackTimer <= 0) {
        if (edge('heavy')) startPower(g, p, i);
        else if (edge('light')) startLight(g, p, i);
      }
      if (p.cd > 0) p.cd--;
      let ctl = { left: i.left, right: i.right, jump: edge('jump'), down: i.down && !i.heavy && !i.light, dash: false };
      if (p.act) {
        ctl = { left: false, right: false, jump: false, down: false, dash: false };
        p.act.t++; POWERS[p.char][p.act.k].tick(g, p, p.act.t);
      }
      f.update(ctl, g.map, NOOP_VFX);
      if (p.act && p.act.t >= p.act.dur) { p.act = null; p.cd = 16; }
      if (f.stocks < stocks0) { p.act = null; p.cd = 0; pushEvent(g, 'ko', { playerId: p.id }); }
      p.prev = Object.assign({}, i);
    }
    tickEnts(g);
    const alive = g.players.filter(p => !p.f.dead);
    if (g.players.length >= 2 && alive.length <= 1) {
      g.status = 'finished';
      g.winnerId = alive.length ? alive[0].id : null;
      pushEvent(g, 'matchOver', { winnerId: g.winnerId });
    }
  },
  snapshot(g, opts) {
    const players = g.players.map(p => {
      const f = p.f;
      return { id: p.id, username: p.username, color: f.color, char: p.char, x: r1(f.x), y: r1(f.y), w: f.w, h: f.h, facing: f.facing,
               alive: !f.dead, damage: r1(f.percent), damageColor: dmgColor(f.percent), stocks: Math.max(0, f.stocks),
               hitstun: f.hitstun, invuln: f.invuln, atk: f.attackTimer, atkMax: p.atkMax, ak: p.ak,
               gr: f.grounded ? 1 : 0, vx: r1(f.vx), vy: r1(f.vy) };
    });
    const ents = g.ents.map(e => ({ t: e.type, x: r1(e.x), y: r1(e.y), f: e.f, l: e.life, m: e.max, r: e.r, w: e.w, h: e.h, c: e.c, vx: e.vx, len: e.len, arm: e.arm }));
    const s = { mapId: g.mapId, status: g.status, winnerId: g.winnerId, tick: g.tick, players, ents, events: g.events.slice() };
    if (!(opts && opts.noMap)) s.map = g.map;
    return s;
  },
  render(ctx, s, opts) {
    opts = opts || {};
    const t = opts.timeMs || 0, map = s.map;
    ctx.save();
    // --- fond : image de la map (dossier assets) ou fond uni + plateformes si l'image manque ---
    if (map && map.image) ctx.drawImage(map.image, 0, 0, CANVAS_W, CANVAS_H);
    else {
      ctx.fillStyle = '#16203a'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      if (map) for (const pl of map.platforms) {
        ctx.fillStyle = pl.type === 'solid' ? '#3b4a6b' : '#4f8f6b';
        ctx.fillRect(pl.x, pl.y, pl.w, pl.type === 'solid' ? pl.h : 10);
      }
    }
    if (window.BRAWL_DEBUG && map) {
      ctx.lineWidth = 2;
      for (const pl of map.platforms) { ctx.strokeStyle = pl.type === 'solid' ? '#ff3b3b' : '#3bff7a'; ctx.strokeRect(pl.x, pl.y, pl.w, pl.type === 'solid' ? pl.h : 14); }
    }
    for (const e of s.ents || []) drawEnt(ctx, e, t);
    for (const p of s.players || []) {
      if (!p.alive) continue;
      drawChar(ctx, p, t, p.invuln > 0 && Math.floor(p.invuln / 4) % 2 === 0 ? 0.45 : 1);
    }
    // --- flèches hors-écran (pourcentage visible) ---
    ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of s.players || []) {
      if (!p.alive) continue;
      const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      if (cx >= 0 && cx <= CANVAS_W && cy >= 0 && cy <= CANVAS_H) continue;
      const m = 34, px = clamp(cx, m, CANVAS_W - m), py = clamp(cy, m, CANVAS_H - m);
      const ang = Math.atan2(cy - CANVAS_H / 2, cx - CANVAS_W / 2);
      const sc = clamp(1 - Math.hypot(cx - px, cy - py) / 600, 0.55, 1);
      ctx.save(); ctx.translate(px, py); ctx.scale(sc, sc);
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.beginPath(); ctx.arc(0, 0, 24, 0, TAU); ctx.fill();
      ctx.strokeStyle = p.color; ctx.lineWidth = 3; ctx.stroke();
      ctx.save(); ctx.rotate(ang); ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.moveTo(34, 0); ctx.lineTo(20, -9); ctx.lineTo(20, 9); ctx.closePath(); ctx.fill(); ctx.restore();
      ctx.fillStyle = '#fff'; ctx.fillText(Math.floor(p.damage) + '%', 0, 1);
      ctx.restore();
    }
    ctx.restore();
  },
};

/* =====================================================================
   DESSIN DES PERSONNAGES (vue de profil, dessinés au Canvas, animés)
   ===================================================================== */
function limb(c, x1, y1, x2, y2, w, col) { c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); }
function disc(c, x, y, r, col) { c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); }
function glow(c, x, y, r, col, a) {
  const gr = c.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(255,255,255,0)');
  c.save(); c.globalAlpha *= a; c.fillStyle = gr; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); c.restore();
}
const STY = {
  valen:     { skin: '#f1c79c', body: '#e3ab2f', trim: '#fff0b0', leg: '#c98a1c', boot: '#7a4e12', tw: 25, lw: 10, aw: 8,  sc: 1 },
  kaelen:    { skin: '#1d1630', body: '#1b1530', trim: '#7c3aed', leg: '#15102a', boot: '#0d0a1c', tw: 17, lw: 7,  aw: 6,  sc: 1 },
  pyra:      { skin: '#f1b48d', body: '#d52b2b', trim: '#f6c343', leg: '#7a1616', boot: '#f6c343', tw: 19, lw: 8,  aw: 7,  sc: 1 },
  thorgrimm: { skin: '#e2a679', body: '#e2a679', trim: '#3b82f6', leg: '#5b3a1e', boot: '#2b1a0c', tw: 32, lw: 13, aw: 11, sc: 1.14 },
};
const SLASH = { valen: '#bfe9ff', kaelen: '#c084fc', pyra: '#ffb347', thorgrimm: '#e5e7eb' };
const smooth = k => k * k * (3 - 2 * k);
/** angle du bras avant (0 = vers le bas, + = vers l'avant) selon l'attaque en cours */
function armAngle(id, ak, k) {
  const e = smooth(k);
  if (ak === 'l') return -2.3 + e * 3.9;
  if (ak === 'L') return 1.75 - e * 0.45;
  if (ak === 'n') return id === 'valen' ? -2.9 : id === 'kaelen' ? k * TAU * 2 : id === 'pyra' ? -2.7 : (k < 0.55 ? -3.0 : -3.0 + (k - 0.55) * 7);
  if (ak === 's') return id === 'thorgrimm' ? k * TAU * 3 : 1.55;
  if (ak === 'd') return id === 'valen' ? 0.1 : id === 'kaelen' ? -0.6 : id === 'pyra' ? 0.05 : 0.4;
  return 0.2;
}
function drawWeapon(c, id, hx, hy, th, ak, k, t, F) {
  const dx = Math.sin(th), dy = Math.cos(th), nx = dy, ny = -dx;     // direction du bras / normale
  if (id === 'valen') {
    if (ak === 's') {                                                    // bouclier brandi (Charge de Paladin)
      c.fillStyle = F('#2f6bff'); c.strokeStyle = F('#f5c542'); c.lineWidth = 3;
      c.beginPath(); c.ellipse(hx + dx * 8, hy + dy * 8, 11, 22, 0, 0, TAU); c.fill(); c.stroke();
      disc(c, hx + dx * 8, hy + dy * 8, 4, F('#fff0b0')); return;
    }
    limb(c, hx, hy, hx + dx * 46, hy + dy * 46, 5, F('#e8f7ff'));
    limb(c, hx + dx * 8, hy + dy * 8, hx + dx * 44, hy + dy * 44, 1.6, F('#8fd3ff'));
    limb(c, hx - nx * 8, hy - ny * 8, hx + nx * 8, hy + ny * 8, 3.5, F('#f5c542'));
    disc(c, hx - dx * 5, hy - dy * 5, 3, F('#f5c542'));
  } else if (id === 'kaelen') {
    if (ak === 'l' || ak === 'L' || !ak) { limb(c, hx, hy, hx + dx * 20, hy + dy * 20, 4, F('#d4d4e8')); return; }
    const tx = hx + dx * 46, ty = hy + dy * 46;                          // faux
    limb(c, hx - dx * 10, hy - dy * 10, tx, ty, 3.5, F('#6b5b8a'));
    c.fillStyle = F('#c4b5fd'); c.beginPath(); c.moveTo(tx - dx * 6, ty - dy * 6);
    c.quadraticCurveTo(tx + nx * 36 + dx * 10, ty + ny * 36 + dy * 10, tx + nx * 28 - dx * 26, ty + ny * 28 - dy * 26);
    c.quadraticCurveTo(tx + nx * 14 - dx * 6, ty + ny * 14 - dy * 6, tx - dx * 6, ty - dy * 6); c.fill();
  } else if (id === 'pyra') {
    if (ak === 'l' || ak === 'L') {
      limb(c, hx, hy, hx + dx * 15, hy + dy * 15, 6, F('#2b2b33'));
      if (k < 0.5) { glow(c, hx + dx * 20, hy + dy * 20, 14, '#ffd34d', 1); disc(c, hx + dx * 19, hy + dy * 19, 3.5, '#fff'); }
    } else {
      const r = ak ? 11 : 7;
      glow(c, hx + dx * 8, hy + dy * 8, r * 2.4, '#ff8a1c', 0.9);
      disc(c, hx + dx * 8, hy + dy * 8, r, F('#ff7a18')); disc(c, hx + dx * 8, hy + dy * 8, r * 0.55, F('#ffe08a'));
    }
  } else {
    const tx = hx + dx * 50, ty = hy + dy * 50;
    limb(c, hx - dx * 10, hy - dy * 10, tx, ty, 5, F('#6b4423'));
    if (ak === 'n') {                                                    // marteau (Fracas du Titan)
      c.fillStyle = F('#aeb6c0'); c.beginPath();
      c.moveTo(tx + dx * 12 + nx * 15, ty + dy * 12 + ny * 15); c.lineTo(tx + dx * 12 - nx * 15, ty + dy * 12 - ny * 15);
      c.lineTo(tx - dx * 12 - nx * 15, ty - dy * 12 - ny * 15); c.lineTo(tx - dx * 12 + nx * 15, ty - dy * 12 + ny * 15); c.fill();
    } else {                                                             // hache à large lame
      c.fillStyle = F('#cfd6dd'); c.beginPath(); c.moveTo(tx - dx * 14, ty - dy * 14);
      c.quadraticCurveTo(tx + nx * 34 - dx * 2, ty + ny * 34 - dy * 2, tx + dx * 16, ty + dy * 16);
      c.quadraticCurveTo(tx + nx * 12 + dx * 4, ty + ny * 12 + dy * 4, tx - dx * 14, ty - dy * 14); c.fill();
    }
  }
}
function drawChar(c, p, t, alpha) {
  const id = STY[p.char] ? p.char : 'valen', S = STY[id];
  const atkOn = p.atk > 0, k = atkOn ? 1 - p.atk / (p.atkMax || 1) : 0, ak = atkOn ? p.ak : '';
  const run = p.gr && Math.abs(p.vx || 0) > 0.9, air = !p.gr, ph = t * 0.0125;
  const flash = p.hitstun > 0 && Math.floor(t / 70) % 2 === 0, F = col => flash ? '#ffffff' : col;
  c.save();
  c.translate(p.x + p.w / 2, p.y + p.h);
  c.save(); c.globalAlpha = 0.5 * alpha; c.fillStyle = p.color; c.beginPath(); c.ellipse(0, 1, 26, 6, 0, 0, TAU); c.fill(); c.restore();   // anneau de couleur du joueur
  c.globalAlpha = alpha;
  c.scale(p.facing * S.sc, S.sc);
  if (p.hitstun > 0) c.rotate(-0.3); else if (atkOn) c.rotate(0.08);
  c.translate(0, air || run ? 0 : Math.sin(t / 280) * 1.3);
  const hipY = -34, shY = -61;
  // --- jambes ---
  let a1, a2;
  if (run) { a1 = Math.sin(ph) * 0.75; a2 = -a1; }
  else if (air) { a1 = (p.vy || 0) < 0 ? 0.55 : 0.22; a2 = (p.vy || 0) < 0 ? -0.3 : -0.2; }
  else if (atkOn) { a1 = 0.5; a2 = -0.45; }
  else { a1 = 0.12; a2 = -0.12; }
  // --- effets arrière (cape, écharpe, flammes) ---
  const fl = Math.sin(t / 130), spd = Math.min(1, Math.abs(p.vx || 0) / 8);
  if (id === 'valen') {
    c.fillStyle = F('#2f6bff'); c.beginPath(); c.moveTo(-3, shY); c.quadraticCurveTo(-28 - spd * 14, shY + 14 + fl * 3, -34 - spd * 18, -10 + fl * 5);
    c.lineTo(-12, -22); c.closePath(); c.fill();
  } else if (id === 'kaelen') {
    for (let j = 0; j < 3; j++) { const o = j * 7, w = Math.sin(t / 110 + j) * 4;
      c.strokeStyle = F(j === 1 ? '#a78bfa' : '#6d28d9'); c.lineWidth = 5 - j; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-2, shY + 3 + j * 2); c.quadraticCurveTo(-24 - spd * 10, shY + 2 + w + o, -44 - spd * 22 - j * 6, shY + 6 + o + w * 1.6); c.stroke(); }
  } else if (id === 'pyra') {
    for (let j = 0; j < 5; j++) { const w = Math.sin(t / 90 + j * 1.7) * 3;
      c.fillStyle = j % 2 ? '#ffd34d' : '#ff6a13'; c.beginPath(); c.moveTo(-1, -78 + j * 3);
      c.quadraticCurveTo(-14 - j * 3 - spd * 6, -86 - j * 3 + w, -26 - j * 5 - spd * 12, -78 + j * 6 + w); c.lineTo(-2, -68 + j * 3); c.fill(); }
  }
  // --- bras arrière ---
  const front = atkOn ? armAngle(id, ak, k) : run ? -Math.sin(ph) * 0.8 : air ? -1.0 : 0.2;
  const backA = atkOn ? 0.7 : run ? Math.sin(ph) * 0.8 : air ? 0.9 : -0.2;
  const bx = -2 + Math.sin(backA) * 27, by = shY + 1 + Math.cos(backA) * 27;
  limb(c, -2, shY + 1, bx, by, S.aw, F(id === 'thorgrimm' ? S.skin : id === 'pyra' ? S.skin : S.body));
  if (id === 'valen' && ak !== 's') { c.fillStyle = F('#2f6bff'); c.strokeStyle = F('#f5c542'); c.lineWidth = 3;
    c.beginPath(); c.ellipse(bx + 3, by + 2, 10, 17, 0, 0, TAU); c.fill(); c.stroke(); disc(c, bx + 3, by + 2, 3, F('#fff0b0')); }
  if (id === 'pyra') { limb(c, bx, by, bx + 12, by + 3, 5, F('#2b2b33')); }
  // --- jambes (dessinées après le bras arrière) ---
  const L = 33;
  for (const [a, col] of [[a2, S.leg], [a1, S.leg]]) {
    const fx = Math.sin(a) * L, fy = hipY + Math.cos(a) * L;
    limb(c, 0, hipY, fx, fy, S.lw, F(col));
    c.fillStyle = F(S.boot); c.beginPath(); c.ellipse(fx + 4, fy - 1, 8, 5, 0, 0, TAU); c.fill();
  }
  // --- torse ---
  const hw = S.tw / 2;
  c.fillStyle = F(S.body); c.beginPath(); c.moveTo(-hw, hipY); c.lineTo(hw, hipY); c.quadraticCurveTo(hw + 3, shY + 10, hw + 1, shY); c.lineTo(-hw - 1, shY); c.quadraticCurveTo(-hw - 3, shY + 10, -hw, hipY); c.fill();
  c.fillStyle = F(S.trim); c.fillRect(-hw, hipY - 5, S.tw, 5);                       // ceinture
  if (id === 'valen') { c.fillStyle = F('#fff0b0'); c.beginPath(); c.moveTo(-hw, shY); c.lineTo(hw, shY); c.lineTo(0, shY + 15); c.fill(); }
  if (id === 'kaelen') { limb(c, -hw + 2, shY + 3, hw - 2, hipY - 8, 3, F('#7c3aed')); }
  if (id === 'pyra') { c.fillStyle = F('#f6c343'); c.fillRect(-hw, shY, S.tw, 4); c.fillStyle = F('#7a1616'); c.fillRect(-hw, hipY - 12, S.tw, 7); }
  if (id === 'thorgrimm') { for (let j = 0; j < 3; j++) limb(c, -8 + j * 8, shY + 6, -4 + j * 8, shY + 16, 3, F('#3b82f6'));
    c.fillStyle = F('#5b3a1e'); c.fillRect(-hw, hipY - 8, S.tw, 8); }
  // --- tête ---
  const hy = -73, hx = 3;
  disc(c, hx, hy, id === 'thorgrimm' ? 11 : 10, F(S.skin));
  if (id === 'valen') {
    c.fillStyle = F('#e3ab2f'); c.beginPath(); c.arc(hx, hy - 1, 11, Math.PI, 0); c.lineTo(hx + 11, hy + 2); c.lineTo(hx - 11, hy + 2); c.fill();
    c.fillStyle = F('#d9362b'); c.beginPath(); c.moveTo(hx - 2, hy - 11); c.quadraticCurveTo(hx - 16, hy - 18 + fl * 2, hx - 24 - spd * 8, hy - 8); c.lineTo(hx - 4, hy - 6); c.fill();
    disc(c, hx + 6, hy + 1, 1.8, '#1f2937');
  } else if (id === 'kaelen') {
    c.fillStyle = F('#1b1530'); c.beginPath(); c.arc(hx, hy, 10.5, 0, TAU); c.fill();
    glow(c, hx + 5, hy, 11, '#c084fc', 0.8); c.fillStyle = '#e9d5ff'; c.beginPath(); c.ellipse(hx + 5, hy - 1, 4.5, 2, 0.25, 0, TAU); c.fill();
  } else if (id === 'pyra') {
    c.fillStyle = F('#ff6a13'); c.beginPath(); c.arc(hx - 1, hy - 3, 11, Math.PI * 0.95, Math.PI * 2.05); c.fill();
    disc(c, hx + 6, hy + 1, 1.8, '#1f2937'); c.fillStyle = F('#c2410c'); c.fillRect(hx + 3, hy + 5, 5, 1.5);
  } else {
    c.fillStyle = F('#b45309'); c.beginPath(); c.moveTo(hx - 8, hy + 3); c.lineTo(hx + 10, hy + 3); c.lineTo(hx + 7, hy + 16); c.lineTo(hx - 5, hy + 15); c.fill();   // barbe
    c.fillStyle = F('#9ca3af'); c.beginPath(); c.arc(hx, hy - 2, 12, Math.PI, 0); c.lineTo(hx + 12, hy + 1); c.lineTo(hx - 12, hy + 1); c.fill();   // casque
    c.strokeStyle = F('#f3f4f6'); c.lineWidth = 4; c.lineCap = 'round';
    c.beginPath(); c.moveTo(hx - 9, hy - 6); c.quadraticCurveTo(hx - 22, hy - 8, hx - 20, hy - 22); c.stroke();
    c.beginPath(); c.moveTo(hx + 9, hy - 6); c.quadraticCurveTo(hx + 22, hy - 8, hx + 18, hy - 22); c.stroke();
    limb(c, hx + 1, hy + 2, hx + 9, hy + 3, 2.5, F('#3b82f6')); disc(c, hx + 6, hy - 1, 1.8, '#1f2937');
  }
  // --- traînées de pouvoir ---
  if (atkOn && (ak === 'n' || ak === 's') && (id === 'valen' || id === 'kaelen')) {
    const tvx = (p.vx || 0) * p.facing, tvy = p.vy || 0;
    for (let j = 1; j <= 4; j++) { glow(c, -tvx * j * 2.6, -42 - tvy * j * 2.6, 20 - j * 2, id === 'valen' ? '#ffd966' : '#a855f7', 0.5 / j * 1.6); }
  }
  if (atkOn && id === 'thorgrimm' && ak === 's') {                                    // tourbillon de la hache
    c.save(); c.strokeStyle = 'rgba(229,231,235,.75)'; c.lineWidth = 6; c.lineCap = 'round';
    for (let j = 0; j < 3; j++) { const a0 = t * 0.045 + j * TAU / 3; c.beginPath(); c.arc(0, -42, 54, a0, a0 + 1.4); c.stroke(); }
    c.restore();
  }
  // --- bras avant + arme + arc de coup ---
  const fx = -2 + Math.sin(front) * 27 * (S.sc > 1 ? 1 : 1), fy = shY + 1 + Math.cos(front) * 27;
  limb(c, 2, shY + 1, fx + 4, fy, S.aw, F(id === 'thorgrimm' || id === 'pyra' ? S.skin : S.body));
  disc(c, fx + 4, fy, S.aw * 0.55, F(S.skin === '#1d1630' ? '#241b3a' : S.skin));
  drawWeapon(c, id, fx + 4, fy, front, ak, k, t, F);
  if (atkOn && (ak === 'l' || ak === 'L') && id !== 'pyra') {
    const ang = Math.PI / 2 - front;
    c.save(); c.globalAlpha *= 0.85 * (1 - k * 0.7); c.strokeStyle = SLASH[id]; c.lineWidth = id === 'thorgrimm' ? 9 : 6; c.lineCap = 'round';
    c.beginPath(); c.arc(2, shY + 1, id === 'thorgrimm' ? 62 : 52, ang, ang + 1.05); c.stroke(); c.restore();
  }
  c.restore();
}
function drawEnt(c, e, t) {
  const q = e.m ? 1 - e.l / e.m : 0;
  c.save();
  if (e.t === 'shock') {
    c.globalAlpha = Math.max(0, 1 - q); c.strokeStyle = e.c || '#f5c542'; c.lineWidth = 7;
    c.beginPath(); c.ellipse(e.x, e.y - 4, (e.w / 2) * (0.3 + 0.7 * q), 16 * (1 - q * 0.4), 0, 0, TAU); c.stroke();
    c.lineWidth = 3; c.strokeStyle = '#fff'; c.beginPath(); c.ellipse(e.x, e.y - 4, (e.w / 2) * (0.25 + 0.6 * q), 11, 0, 0, TAU); c.stroke();
  } else if (e.t === 'chain') {
    const len = e.len * Math.min(1, q * 3.2), x2 = e.x + e.f * len;
    c.globalAlpha = Math.max(0.2, 1 - q * 0.6); c.strokeStyle = '#9ca3af'; c.lineWidth = 3; c.setLineDash([6, 4]);
    c.beginPath(); c.moveTo(e.x, e.y); c.lineTo(x2, e.y); c.stroke(); c.setLineDash([]);
    c.fillStyle = '#c4b5fd'; c.beginPath(); c.moveTo(x2 - e.f * 4, e.y - 18); c.quadraticCurveTo(x2 + e.f * 22, e.y - 10, x2 + e.f * 6, e.y + 14); c.lineTo(x2 - e.f * 2, e.y); c.fill();
  } else if (e.t === 'puff') {
    c.globalAlpha = Math.max(0, 0.7 * (1 - q)); disc(c, e.x, e.y, 10 + q * 34, '#6d28d9'); disc(c, e.x, e.y, 5 + q * 18, '#c084fc');
  } else if (e.t === 'bolt') {
    const dir = Math.sign(e.vx) || 1;
    glow(c, e.x, e.y, 16, '#ff7a18', 0.8); limb(c, e.x - dir * 18, e.y, e.x, e.y, 4, 'rgba(255,170,60,.6)'); disc(c, e.x, e.y, 4.5, '#ffe08a');
  } else if (e.t === 'fire') {
    const dir = Math.sign(e.vx) || 1;
    for (let j = 1; j <= 4; j++) disc(c, e.x - dir * j * 14, e.y + Math.sin(t / 70 + j) * 4, e.r * (1 - j * 0.17), 'rgba(255,120,20,' + (0.5 - j * 0.1) + ')');
    glow(c, e.x, e.y, e.r * 2.2, '#ff7a18', 0.9); disc(c, e.x, e.y, e.r, '#ff9f1c'); disc(c, e.x, e.y, e.r * 0.55, '#ffe08a');
  } else if (e.t === 'boom') {
    c.globalAlpha = Math.max(0, 1 - q); glow(c, e.x, e.y, e.r * (0.5 + q), '#ffb347', 1);
    c.strokeStyle = '#fff3b0'; c.lineWidth = 5; c.beginPath(); c.arc(e.x, e.y, e.r * (0.3 + 0.7 * q), 0, TAU); c.stroke();
  } else if (e.t === 'pillar') {
    const f = e.l / e.m, h = e.h * Math.min(1, q * 5 + 0.2) * (0.6 + 0.4 * f);
    c.globalAlpha = Math.min(1, f * 2);
    for (const [wd, col] of [[1, '#ff6a13'], [0.62, '#ffb347'], [0.3, '#fff3b0']]) {
      c.fillStyle = col; c.beginPath(); c.moveTo(e.x - e.w / 2 * wd, e.y);
      c.quadraticCurveTo(e.x - e.w / 2 * wd - 7 + Math.sin(t / 60) * 4, e.y - h * 0.5, e.x + Math.sin(t / 45) * 6, e.y - h);
      c.quadraticCurveTo(e.x + e.w / 2 * wd + 7, e.y - h * 0.5, e.x + e.w / 2 * wd, e.y); c.fill();
    }
  } else if (e.t === 'mine') {
    const armed = !(e.arm > 0), blink = Math.floor(t / (armed ? 220 : 90)) % 2 === 0;
    c.fillStyle = '#4b5563'; c.beginPath(); c.ellipse(e.x, e.y, 13, 6, 0, 0, TAU); c.fill();
    disc(c, e.x, e.y - 5, 4.5, armed ? (blink ? '#ff3b30' : '#7f1d1d') : (blink ? '#fde047' : '#78350f'));
    if (armed && blink) glow(c, e.x, e.y - 5, 16, '#ff3b30', 0.7);
  } else if (e.t === 'clone') {
    drawChar(c, { x: e.x - 18, y: e.y, w: 36, h: 80, facing: e.f, char: 'kaelen', color: '#7c3aed', atk: Math.max(0, Math.min(12, e.l - 4)),
                  atkMax: 12, ak: 'l', gr: 1, vx: 0, vy: 0, hitstun: 0, invuln: 0 }, t, 0.5);
  }
  c.restore();
}

// moteur brut aussi disponible (MapManager, Fighter, VFX…) pour d'autres usages
BRAWL.Engine = { MapManager, Fighter, VFX, startAttack, moveAndCollide, attackBox, resolveAttack, drawOffscreenIndicators, drawHUD };
window.BRAWL = BRAWL;
Object.keys(MAPS).forEach(mapEntry);       // précharge toutes les images depuis assets/

})();
