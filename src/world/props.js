/*
 * Props: coins (InstancedMesh), red coins (InstancedMesh), stars, checkpoint flags, ground-pound
 * switches, lanterns, moving platforms, bouncy mushrooms.  Grumbles, chimes, bell, ghost race and
 * wind live in props-extra.js.  Every pickup has a stable id (see listPickups()).
 */
import * as THREE from '../three.js';
import { StaticBuilder } from './builder.js';
import { PAL } from './palette.js';
import { solid as toon, vcMaterial, named } from './materials.js';
import { zoneAt, ZONE_NAMES } from './terrain.js';

export const COIN_RADIUS = 1.05, MAGNET_RADIUS = 2.5, STAR_RADIUS = 1.4;

function starGeometry() {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.36 : 0.8;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.08, bevelSegments: 1 });
  g.center();
  return g;
}

let _glowMat = null;
function lanternGlowMat() {
  if (_glowMat) return _glowMat;
  const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d');
  if (c) { const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); g.addColorStop(0, 'rgba(255,236,160,0.95)'); g.addColorStop(0.35, 'rgba(255,190,70,0.45)'); g.addColorStop(1, 'rgba(255,170,40,0)'); c.fillStyle = g; c.fillRect(0, 0, S, S); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  _glowMat = named(new THREE.SpriteMaterial({ map: t, color: PAL.lanternLit, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), 'lantern-glow');
  return _glowMat;
}

export function createProps({ scene, col, events, state }) {
  const vcMat = named(vcMaterial(), 'props-vc');
  const P = {
    scene, col, events, state, vcMat,
    coins: [], stars: [], checkpoints: [], switches: [], platforms: [], mushrooms: [], lanterns: [],
    entities: [],          // objects with update(dt, ctrl, P) / animate(dt, t)
    starById: new Map(), coinById: new Map(),
    activeCheckpoint: null, magnet: true, still: false,
    _zoneCount: {},
  };
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  const toast = text => events.emit('ui:toast', { text });

  // Build a small vertex-coloured mesh (1 draw call) from builder calls.
  P.vcMesh = (fn, cast = true) => {
    const b = new StaticBuilder(null, 'prop'); fn(b);
    const m = b.build(vcMat); m.castShadow = cast; m.receiveShadow = false; return m;
  };
  P.ground = (x, z, maxY = 1e9) => col.groundHeight(x, z, maxY);

  // ---------- coins ----------
  P.coin = (x, y, z, opts = {}) => {
    const zone = opts.zone || zoneAt(x, z);
    const n = (P._zoneCount[zone] = (P._zoneCount[zone] || 0) + 1);
    const c = { id: opts.id || `${zone}-c${n}`, type: 'coin', zone, x, y, z, alive: !opts.hidden, hidden: !!opts.hidden, value: 1, magnet: false };
    P.coins.push(c); P.coinById.set(c.id, c); return c;
  };
  P.redCoin = (starId, index, x, y, z) => {
    const c = { id: `${starId}-r${index}`, type: 'redcoin', starId, index, zone: zoneAt(x, z), x, y, z, alive: true, value: 2, magnet: false };
    P.coins.push(c); P.coinById.set(c.id, c); return c;
  };
  // coin patterns at a height above the ground (or absolute y when opts.abs)
  P.coinAt = (x, z, lift = 1, opts = {}) => P.coin(x, (opts.abs ?? P.ground(x, z, opts.maxY)) + lift, z, opts);
  P.coinLine = (x0, z0, x1, z1, n, lift = 1, opts = {}) => {
    for (let i = 0; i < n; i++) { const t = n === 1 ? 0 : i / (n - 1); P.coinAt(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, lift, opts); }
  };
  P.coinRing = (cx, cz, r, n, lift = 1, opts = {}) => {
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; P.coinAt(cx + Math.cos(a) * r, cz + Math.sin(a) * r, lift, opts); }
  };

  function finalizeCoins() {
    const geo = new THREE.CylinderGeometry(0.42, 0.42, 0.1, 18); geo.rotateX(Math.PI / 2);
    const gold = named(toon(PAL.coin, { emissive: PAL.coinEmissive, emissiveIntensity: 0.6 }), 'coin');
    const red = named(toon(PAL.coinRed, { emissive: PAL.redEmissive, emissiveIntensity: 0.6 }), 'red-coin');
    const normal = P.coins.filter(c => c.type === 'coin'), reds = P.coins.filter(c => c.type === 'redcoin');
    P.coinMesh = new THREE.InstancedMesh(geo, gold, Math.max(1, normal.length));
    P.redMesh = new THREE.InstancedMesh(geo, red, Math.max(1, reds.length));
    normal.forEach((c, i) => { c.mesh = P.coinMesh; c.idx = i; });
    reds.forEach((c, i) => { c.mesh = P.redMesh; c.idx = i; });
    for (const m of [P.coinMesh, P.redMesh]) { m.castShadow = true; m.frustumCulled = false; scene.add(m); }
    P.coinMesh.count = normal.length; P.redMesh.count = reds.length;
  }
  function drawCoins(t) {
    const spin = t * 3;
    for (const c of P.coins) {
      if (!c.mesh) continue;
      if (c.alive) {
        _q.setFromAxisAngle(_up, spin + c.x * 0.3); _s.setScalar(c.type === 'redcoin' ? 1.15 : 1);
        _p.set(c.x, c.y + Math.sin(t * 2 + c.z) * 0.08, c.z);
      } else if (c.popT > 0) { // collect pop: rise + shrink
        c.popT -= 1 / 60; _s.setScalar(Math.max(0.01, c.popT * 3)); _p.set(c.x, c.y + (0.35 - c.popT) * 3, c.z);
        _q.setFromAxisAngle(_up, spin * 4);
      } else { _s.setScalar(0); _p.set(c.x, -999, c.z); }
      _m.compose(_p, _q, _s); c.mesh.setMatrixAt(c.idx, _m);
    }
    P.coinMesh.instanceMatrix.needsUpdate = true; P.redMesh.instanceMatrix.needsUpdate = true;
  }

  P.collectCoin = c => {
    if (!c || !c.alive) return false;
    c.alive = false; c.popT = 0.35;
    if (c.type === 'coin') {
      const v = Math.max(1, P.coinMultiplier || 1); // focus-play: Focus Burst sets coinMultiplier = 2
      const zoneCoins = state.addCoin(c.id, c.zone, v);
      events.emit('pickup:coin', { id: c.id, value: v, total: state.totalCoins(), zone: c.zone, zoneCoins });
      if (zoneCoins >= 100 && c.zone !== 'hub') {
        const b = P.starById.get(`bonus-${c.zone}`);
        if (b && !b.revealed) P.revealStar(b, 'Bonus star appeared!');
      }
    } else {
      const count = state.addRedCoin(c.starId, c.index);
      state.addCoin(c.id, c.zone, 2);
      events.emit('pickup:redcoin', { id: c.id, starId: c.starId, index: c.index, count, total: 8 });
      events.emit('pickup:coin', { id: c.id, value: 2, total: state.totalCoins(), zone: c.zone, zoneCoins: state.data ? state.data.coins[c.zone] : 0 });
      if (count >= 8) { const s = P.starById.get(c.starId); if (s) P.revealStar(s, 'All 8 red coins!'); }
      else toast(`Red coin ${count} / 8`);
    }
    return true;
  };

  // focus-play: coins with no coin object (Freeze! coin shower); same events as a normal pickup
  P.giftCoins = (n, zone) => {
    if (!state.data || !(n > 0)) return 0;
    const zc = (state.data.coins[zone] = (state.data.coins[zone] || 0) + n);
    events.emit('pickup:coin', { id: `gift-${zone}`, value: n, total: state.totalCoins(), zone, zoneCoins: zc, gift: true });
    if (zc >= 100 && zone !== 'hub') { const b = P.starById.get(`bonus-${zone}`); if (b && !b.revealed) P.revealStar(b, 'Bonus star appeared!'); }
    return zc;
  };

  // ---------- stars ----------
  const starGeo = starGeometry();
  const starMat = named(toon(PAL.star, { emissive: PAL.starEmissive, emissiveIntensity: 0.7 }), 'star');
  const ghostMat = named(new THREE.MeshLambertMaterial({ color: PAL.starGhost, transparent: true, opacity: 0.45, emissive: PAL.ghostEmissive }), 'star-ghost');
  const glowGeo = new THREE.SphereGeometry(1.1, 16, 10);
  const glowMat = named(new THREE.MeshBasicMaterial({ color: PAL.starHalo, transparent: true, opacity: 0.22, depthWrite: false }), 'star-glow');
  P.starMaterial = starMat; P.ghostMaterial = ghostMat;
  // def: {id, zone, name, x,y,z, hidden, bonus, task, target(from)}
  P.star = def => {
    const s = { type: 'star', revealed: !def.hidden, collected: false, revealT: 0, ...def };
    s.mesh = new THREE.Mesh(starGeo, starMat); s.mesh.castShadow = true;
    const glow = new THREE.Mesh(glowGeo, glowMat); s.mesh.add(glow); s.glow = glow;
    s.mesh.position.set(s.x, s.y, s.z); s.mesh.visible = s.revealed;
    scene.add(s.mesh); P.stars.push(s); P.starById.set(s.id, s);
    return s;
  };
  P.revealStar = (s, why) => {
    if (s.revealed) return;
    s.revealed = true; s.revealT = 0.8; s.mesh.visible = true;
    events.emit('star:revealed', { id: s.id, zone: s.zone, name: s.name, x: s.x, y: s.y, z: s.z });
    toast(`⭐ ${why || 'A star appeared!'}`); // ≤ 5 words (each `why` is a short cheer)
  };
  P.collectStar = s => {
    if (!s || s.collected) return false;
    s.collected = true; s.revealed = true;
    state.addStar(s.id);
    events.emit('pickup:star', { id: s.id, zone: s.zone, name: s.name, bonus: !!s.bonus });
    s.mesh.material = ghostMat; s.glow.visible = false; s.mesh.visible = true; s.revealT = 0.8;
    return true;
  };

  // ---------- checkpoints ----------
  const flagOff = PAL.flagBlue, flagOn = PAL.flagGreen;
  P.checkpoint = (id, x, z, opts = {}) => {
    const y = opts.y ?? P.ground(x, z, opts.maxY);
    const cp = { id, x, y, z, zone: opts.zone || zoneAt(x, z), active: false, facing: opts.facing ?? 0 };
    cp.pole = P.vcMesh(b => { b.cyl(0, 0, 0, 0.09, 2.6, PAL.white, { collide: false, seg: 8 }); b.sphere(0, 2.65, 0, 0.16, PAL.gold, { detail: 0 }); b.cyl(0, 0, 0, 0.55, 0.18, PAL.woodLo, { collide: false, seg: 10 }); b.cyl(0, 0.18, 0, 0.42, 0.06, PAL.gold, { collide: false, seg: 10 }); });
    cp.pole.position.set(x, y, z);
    cp.flagMat = named(toon(flagOff, { side: THREE.DoubleSide }), 'checkpoint-flag');
    cp.flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7, 4, 1), cp.flagMat);
    cp.flag.position.set(0.58, 2.2, 0); cp.pole.add(cp.flag);
    scene.add(cp.pole); P.checkpoints.push(cp);
    return cp;
  };
  P.activateCheckpoint = (cp, silent = false) => {
    if (P.activeCheckpoint === cp) return;
    if (P.activeCheckpoint) P.activeCheckpoint.flagMat.color.setHex(flagOff), P.activeCheckpoint.active = false;
    P.activeCheckpoint = cp; cp.active = true; cp.flagMat.color.setHex(flagOn);
    if (!silent) {
      state.setCheckpoint(cp);
      events.emit('checkpoint:reached', { id: cp.id, zone: cp.zone, x: cp.x, y: cp.y, z: cp.z });
      toast('Checkpoint!');
    }
  };

  // ---------- ground-pound switches ----------
  P.groundSwitch = (id, x, z, onPress, opts = {}) => {
    const y = opts.y ?? P.ground(x, z);
    const sw = { id, x, y, z, zone: zoneAt(x, z), pressed: false, onPress };
    sw.base = P.vcMesh(b => { b.cyl(0, 0, 0, 1.0, 0.3, PAL.switchBase, { collide: false, seg: 12 }); b.cyl(0, 0.3, 0, 0.86, 0.04, PAL.gold, { collide: false, seg: 12 }); });
    sw.base.position.set(x, y, z);
    sw.btnMat = named(toon(PAL.switchRed), 'switch-button');
    sw.btn = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.75, 0.35, 14), sw.btnMat);
    sw.btn.position.y = 0.45; sw.btn.castShadow = true; sw.base.add(sw.btn);
    col.add({ kind: 'cyl', x, z, y0: y - 0.5, y1: y + 0.3, r: 1.0 });
    scene.add(sw.base); P.switches.push(sw);
    return sw;
  };
  P.pressSwitch = (sw, silent = false) => {
    if (sw.pressed) return;
    sw.pressed = true; sw.btn.scale.y = 0.25; sw.btn.position.y = 0.33; sw.btnMat.color.setHex(PAL.switchGreen);
    if (!silent) events.emit('switch:pressed', { id: sw.id, zone: sw.zone });
    if (sw.onPress) sw.onPress(sw, silent);
  };

  // ---------- lanterns ----------
  P.lantern = (id, x, z) => {
    const y = P.ground(x, z);
    const ln = { id, x, y, z, lit: false };
    const post = P.vcMesh(b => { b.cyl(0, 0, 0, 0.12, 2.4, PAL.woodLo, { collide: false, seg: 6 }); b.cyl(0, 0, 0, 0.3, 0.3, PAL.lanternFrame, { collide: false, seg: 6 }); b.box(0, 2.45, 0, 0.7, 0.12, 0.7, PAL.lanternFrame, { collide: false }); b.cone(0, 3.18, 0, 0.62, 0.45, PAL.roofRed, { seg: 4, yaw: Math.PI / 4 }); b.sphere(0, 3.7, 0, 0.09, PAL.gold, { detail: 0 }); });
    post.position.set(x, y, z);
    ln.mat = named(new THREE.MeshLambertMaterial({ color: PAL.lanternGlass, emissive: 0x000000 }), 'lantern-glass');
    ln.head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.65, 0.55), ln.mat);
    ln.head.position.y = 2.85; post.add(ln.head);
    col.add({ kind: 'cyl', x, z, y0: y, y1: y + 2.4, r: 0.2 });
    scene.add(post); P.lanterns.push(ln);
    ln.glow = new THREE.Sprite(lanternGlowMat()); ln.glow.scale.setScalar(3.2); ln.glow.position.y = 2.85; ln.glow.visible = false; post.add(ln.glow);
    ln.light = () => { if (ln.lit) return; ln.lit = true; ln.mat.color.setHex(PAL.lanternLit); ln.mat.emissive.setHex(PAL.lanternGlow); ln.glow.visible = true; };
    ln.unlight = () => { ln.lit = false; ln.mat.color.setHex(PAL.lanternGlass); ln.mat.emissive.setHex(0); ln.glow.visible = false; };
    return ln;
  };

  // ---------- moving platforms ----------
  // opts: {id, size:[sx,sy,sz], path:[[x,y,z],..], speed, wait, color, look:'stone'|'log', loop}
  P.platform = opts => {
    const [sx, sy, sz] = opts.size;
    const pl = { ...opts, seg: 0, dir: 1, t: 0, wait: 0, pos: new THREE.Vector3(...opts.path[0]) };
    pl.mesh = P.vcMesh(b => {
      if (opts.look === 'log') {
        const r = sy / 2;
        b.geo(new THREE.CylinderGeometry(r, r, sz, 10), 0, 0, 0, opts.color || PAL.bark, { pitch: Math.PI / 2 });
        b.geo(new THREE.CylinderGeometry(r * 0.75, r * 0.75, sz + 0.04, 10), 0, 0, 0, PAL.logCore, { pitch: Math.PI / 2, jitter: 0.02 });
        if (sx > sy * 1.2) b.geo(new THREE.CylinderGeometry(r, r, sz, 10), (sx - sy) / 2, 0, 0, opts.color || PAL.bark, { pitch: Math.PI / 2 }), b.geo(new THREE.CylinderGeometry(r, r, sz, 10), -(sx - sy) / 2, 0, 0, opts.color || PAL.bark, { pitch: Math.PI / 2 });
      } else {
        b.box(0, 0, 0, sx, sy, sz, opts.color || PAL.platform, { collide: false, shade: { under: 0.3 } });
        b.box(0, sy / 2 + 0.02, 0, sx - 0.3, 0.06, sz - 0.3, PAL.platformTrim, { collide: false, jitter: 0.02 });
      }
    });
    pl.mesh.receiveShadow = true;
    pl.col = col.addDynamic({ kind: 'box', minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0, platform: true });
    const place = () => {
      const c = pl.col; c.minX = pl.pos.x - sx / 2; c.maxX = pl.pos.x + sx / 2; c.minY = pl.pos.y - sy / 2; c.maxY = pl.pos.y + sy / 2;
      c.minZ = pl.pos.z - sz / 2; c.maxZ = pl.pos.z + sz / 2;
      c.bMinX = c.minX; c.bMaxX = c.maxX; c.bMinY = c.minY; c.bMaxY = c.maxY; c.bMinZ = c.minZ; c.bMaxZ = c.maxZ;
      pl.mesh.position.copy(pl.pos);
    };
    place(); pl.place = place;
    scene.add(pl.mesh); P.platforms.push(pl);
    return pl;
  };
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  function updatePlatform(pl, dt) {
    const ox = pl.pos.x, oy = pl.pos.y, oz = pl.pos.z;
    if (pl.wait > 0) pl.wait -= dt;
    else {
      const path = pl.path, i0 = pl.seg, i1 = pl.seg + pl.dir;
      _a.set(...path[i0]); _b.set(...path[i1]);
      const L = _a.distanceTo(_b);
      pl.t += (pl.speed * dt) / Math.max(0.01, L);
      if (pl.t >= 1) {
        pl.t = 0; pl.seg = i1;
        if (pl.seg === path.length - 1 || pl.seg === 0) {
          if (pl.loop && pl.seg === path.length - 1) pl.seg = 0; else pl.dir = pl.seg === 0 ? 1 : -1;
          pl.wait = pl.pause ?? 0.6;
        }
        pl.pos.set(...path[i1]);
      } else {
        const e = pl.t * pl.t * (3 - 2 * pl.t); // ease in/out between nodes
        pl.pos.lerpVectors(_a, _b, pl.ease === false ? pl.t : e);
      }
    }
    pl.col.dx = pl.pos.x - ox; pl.col.dy = pl.pos.y - oy; pl.col.dz = pl.pos.z - oz;
    pl.place();
  }

  // ---------- bouncy mushrooms ----------
  P.mushroom = (x, z, opts = {}) => {
    const y = opts.y ?? P.ground(x, z), s = opts.scale || 1, apex = opts.apex || 9;
    const capR = 1.3 * s, stemH = 1.2 * s;
    const mu = { x, y, z, apex, sq: 0 };
    mu.mesh = P.vcMesh(b => {
      b.cyl(0, 0, 0, 0.38 * s, stemH, PAL.mushStem, { collide: false, seg: 8, rTop: 0.3 * s });
      b.geo(new THREE.SphereGeometry(capR, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, stemH - 0.1, 0, opts.color || PAL.mushRed, { sy: 0.55, shade: { under: 0.45 } });
      for (let i = 0; i < 6; i++) { const a = i * 1.05; b.sphere(Math.cos(a) * capR * 0.6, stemH + 0.35 * s, Math.sin(a) * capR * 0.6, 0.17 * s, PAL.white, { detail: 0, sy: 0.5 }); }
      b.sphere(0, stemH + 0.62 * s, 0, 0.2 * s, PAL.white, { detail: 0, sy: 0.5 });
    });
    mu.mesh.position.set(x, y, z);
    col.add({ kind: 'cyl', x, z, y0: y, y1: y + stemH, r: 0.38 * s });
    col.add({ kind: 'cyl', x, z, y0: y + stemH - 0.1, y1: y + stemH + 0.55 * s, r: capR * 0.95, bounce: apex, onBounce: () => { mu.sq = 1; } });
    scene.add(mu.mesh); P.mushrooms.push(mu);
    return mu;
  };

  // ---------- per-step logic ----------
  P.updatePlatforms = dt => { for (const pl of P.platforms) updatePlatform(pl, dt); };
  P.update = (dt, ctrl, onRespawnNeeded) => {
    const px = ctrl.position.x, py = ctrl.position.y + 0.65, pz = ctrl.position.z;
    const helper = state.settings.helperMode !== false;
    for (const c of P.coins) {
      if (!c.alive) continue;
      const dx = px - c.x, dy = py - c.y, dz = pz - c.z, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < COIN_RADIUS * COIN_RADIUS) { P.collectCoin(c); continue; }
      if (helper && P.magnet && (c.magnet || d2 < MAGNET_RADIUS * MAGNET_RADIUS)) {
        c.magnet = true; const d = Math.sqrt(d2), k = Math.min(1, (14 * dt) / d);
        c.x += dx * k; c.y += dy * k; c.z += dz * k;
      }
    }
    for (const s of P.stars) {
      if (!s.revealed || s.collected || s.revealT > 0.3) continue;
      const dx = px - s.x, dy = py - s.y, dz = pz - s.z;
      if (dx * dx + dy * dy + dz * dz < STAR_RADIUS * STAR_RADIUS) P.collectStar(s);
    }
    for (const cp of P.checkpoints) {
      if (cp.active) continue;
      if (Math.hypot(px - cp.x, pz - cp.z) < 1.7 && Math.abs(ctrl.position.y - cp.y) < 2.5) { P.activateCheckpoint(cp); ctrl.bonks = 0; }
    }
    for (const e of P.entities) if (e.update) e.update(dt, ctrl, onRespawnNeeded);
  };
  P.onPound = (pos, r) => {
    for (const sw of P.switches) {
      if (sw.pressed) continue;
      if (Math.hypot(pos.x - sw.x, pos.z - sw.z) < r + 0.2 && Math.abs(pos.y - (sw.y + 0.3)) < 1.3) P.pressSwitch(sw);
    }
    for (const e of P.entities) if (e.onPound) e.onPound(pos, r);
  };
  // ---------- per-frame visuals ----------
  P.animate = (dt, t) => {
    drawCoins(t);
    for (const s of P.stars) {
      if (!s.mesh.visible) continue;
      s.mesh.rotation.y = t * 2;
      let sc = s.collected ? 0.8 : 1;
      if (s.revealT > 0) { s.revealT -= dt; sc *= 1 - Math.max(0, s.revealT) / 0.8 * 0.9; }
      s.mesh.scale.setScalar(sc);
      s.mesh.position.y = s.y + Math.sin(t * 2.2 + s.x) * 0.18;
      s.glow.scale.setScalar(1 + Math.sin(t * 4) * 0.08);
    }
    for (const cp of P.checkpoints) cp.flag.rotation.y = cp.active ? Math.sin(t * 6 + cp.x) * 0.25 : 0;
    for (const mu of P.mushrooms) {
      if (mu.sq > 0) mu.sq = Math.max(0, mu.sq - dt * 3);
      const k = Math.sin(mu.sq * Math.PI * 2) * 0.25 * mu.sq;
      mu.mesh.scale.set(1 + k, 1 - k, 1 + k);
    }
    for (const e of P.entities) if (e.animate) e.animate(dt, t);
  };

  P.finalize = () => finalizeCoins();
  P.zoneName = z => ZONE_NAMES[z] || z;
  return P;
}
