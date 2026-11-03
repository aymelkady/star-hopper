/*
 * More props: Grumble enemy, numbered chimes (sequence star), bell, ghost-race pads, wind
 * volumes, canvas-text signs and the waterfall sheet.  All register into P.entities.
 */
import * as THREE from '../three.js';
import { PAL } from './palette.js';
import { solid as toon, named } from './materials.js';

// ---------- Grumble: slow patrol box with eyes ----------
// opts: {id, zone, a:[x,z], b:[x,z], speed}
export function grumble(P, opts) {
  const { events, state } = P;
  const g = { ...opts, type: 'grumble', alive: true, stun: 0, t: 0, dir: 1, wait: 0, popT: 0 };
  const [ax, az] = opts.a, [bx, bz] = opts.b;
  g.x = ax; g.z = az; g.y = P.ground(ax, az); g.yaw = 0;
  g.mesh = P.vcMesh(b => {
    b.box(0, 0.6, 0, 1.3, 1.0, 1.3, PAL.grumble, { collide: false });
    b.box(0, 1.14, 0, 1.36, 0.1, 1.36, PAL.grumbleLo, { collide: false });
    for (const s of [-1, 1]) {
      b.sphere(s * 0.3, 0.78, 0.62, 0.2, PAL.white, { detail: 1, sz: 0.5 });
      b.sphere(s * 0.27, 0.74, 0.7, 0.1, PAL.inkLo, { detail: 0, sz: 0.5 });
      b.box(s * 0.3, 1.02, 0.64, 0.36, 0.08, 0.06, PAL.ink, { collide: false, yaw: 0 });
      b.box(s * 0.35, 0.06, 0.1, 0.42, 0.14, 0.6, PAL.grumbleFoot, { collide: false });
    }
    b.box(0, 0.4, 0.66, 0.5, 0.08, 0.04, PAL.ink, { collide: false });
  });
  g.mesh.position.set(g.x, g.y, g.z);
  P.scene.add(g.mesh);
  // the 3 coins it drops (hidden until popped; ids stay stable for saves)
  g.drops = [0, 1, 2].map(k => P.coin(g.x, g.y + 1, g.z, { id: `${opts.id}-c${k}`, zone: opts.zone, hidden: true }));

  g.pop = (silent = false) => {
    if (!g.alive) return;
    g.alive = false; g.popT = 0.4;
    g.drops.forEach((c, k) => {
      const a = g.yaw + k * 2.1;
      c.x = g.x + Math.sin(a) * 1.4; c.z = g.z + Math.cos(a) * 1.4; c.y = P.ground(c.x, c.z, g.y + 2) + 1;
      if (!Number.isFinite(c.y)) c.y = g.y + 1;
      c.hidden = false; c.alive = !state.hasCoin(c.id);
    });
    if (!silent) {
      const left = P.entities.filter(e => e.type === 'grumble' && e.zone === g.zone && e.group === g.group && e.alive).length;
      const total = P.entities.filter(e => e.type === 'grumble' && e.group === g.group).length;
      events.emit('enemy:popped', { id: g.id, zone: g.zone, x: g.x, y: g.y, z: g.z, count: total - left, total });
      if (g.onPop) g.onPop(total - left, total);
    }
  };
  g.update = (dt, ctrl, respawn) => {
    if (!g.alive) return;
    g.t += dt;
    if (g.stun > 0) g.stun -= dt;
    else if (g.wait > 0) g.wait -= dt;
    else {
      const tx = g.dir > 0 ? bx : ax, tz = g.dir > 0 ? bz : az;
      const dx = tx - g.x, dz = tz - g.z, L = Math.hypot(dx, dz), st = (g.speed || 1.6) * dt;
      if (L < st) { g.x = tx; g.z = tz; g.dir *= -1; g.wait = 0.6; }
      else { g.x += dx / L * st; g.z += dz / L * st; g.yaw = Math.atan2(dx, dz); }
      g.y = P.ground(g.x, g.z, g.y + 1.5);
    }
    // player interaction
    const p = ctrl.position, dx = p.x - g.x, dz = p.z - g.z;
    if (Math.hypot(dx, dz) > 1.15 || p.y > g.y + 1.25 || p.y + 1.3 < g.y) return;
    const fromAbove = (ctrl.velocity.y < 0 && p.y > g.y + 0.6) || ctrl.isPounding();
    if (fromAbove) { g.pop(); if (!ctrl.isPounding()) ctrl.bounceUp(3.2); }
    else if (g.stun <= 0) {
      g.stun = 1; // bounce the player back + stun self 1 s
      if (ctrl.hurt(g.x, g.z)) respawn('bonk');
    }
  };
  g.onPound = (pos, r) => { if (g.alive && Math.hypot(pos.x - g.x, pos.z - g.z) < r + 0.7 && Math.abs(pos.y - g.y) < 1.6) g.pop(); };
  g.animate = (dt, t) => {
    if (!g.alive) {
      if (g.popT > 0) { g.popT -= dt; const s = Math.max(0.01, g.popT / 0.4); g.mesh.scale.set(1 + (1 - s), s, 1 + (1 - s)); }
      else g.mesh.visible = false;
      return;
    }
    g.mesh.position.set(g.x, g.y + Math.abs(Math.sin(t * 6)) * 0.08, g.z);
    g.mesh.rotation.y = g.yaw + (g.stun > 0 ? Math.sin(t * 30) * 0.3 : 0);
    g.mesh.scale.set(1, 1 + Math.sin(t * 6) * 0.04, 1);
  };
  P.entities.push(g);
  return g;
}

// ---------- canvas text helpers ----------
export function textTexture(text, { w = 512, h = 128, bg = '#fff4d6', fg = '#3a2a1a', size = 64 } = {}) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  if (c) {
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    c.fillStyle = fg; c.font = `bold ${size}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, w / 2, h / 2 + 4);
  }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
// Signpost with a text board. yaw = direction the board faces.
export function sign(P, x, z, text, opts = {}) {
  const y = opts.y ?? P.ground(x, z);
  const w = opts.w || 3.2;
  const post = P.vcMesh(b => { b.cyl(0, 0, 0, 0.12, 2.2, PAL.woodLo, { collide: false, seg: 6 }); b.box(0, 2.2, -0.06, w + 0.2, 0.95, 0.12, PAL.wood, { collide: false }); b.sphere(0, 2.75, -0.06, 0.12, PAL.gold, { detail: 0 }); });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.8), named(new THREE.MeshBasicMaterial({ color: PAL.white, map: textTexture(text, { bg: opts.bg, fg: opts.fg }) }), 'sign-board'));
  board.position.set(0, 2.2, 0.01); post.add(board);
  post.position.set(x, y, z); post.rotation.y = opts.yaw || 0;
  P.col.add({ kind: 'cyl', x, z, y0: y, y1: y + 2.2, r: 0.15 });
  P.scene.add(post);
  return post;
}

// ---------- chimes: ring 1-2-3-4 in order ----------
export function chimes(P, list, onDone) {
  const ent = { type: 'chimes', next: 0, done: false, items: [] };
  const colors = [PAL.chime1, PAL.chime2, PAL.chime3, PAL.chime4];
  list.forEach(([x, z], i) => {
    const y = P.ground(x, z);
    const item = { x, y, z, i, lit: false, touching: false, swing: 0 };
    const frame = P.vcMesh(b => { b.cyl(-0.9, 0, 0, 0.1, 3.6, PAL.towerBlue2, { collide: false, seg: 6 }); b.cyl(0.9, 0, 0, 0.1, 3.6, PAL.towerBlue2, { collide: false, seg: 6 }); b.box(0, 3.6, 0, 2.1, 0.16, 0.24, PAL.gold, { collide: false }); b.sphere(-0.9, 3.75, 0, 0.14, PAL.gold, { detail: 0 }); b.sphere(0.9, 3.75, 0, 0.14, PAL.gold, { detail: 0 }); });
    frame.position.set(x, y, z);
    item.mat = named(toon(colors[i], { emissive: 0x000000 }), `chime-${i + 1}`);
    item.tube = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.4 + i * 0.25, 10), item.mat);
    item.pivot = new THREE.Group(); item.pivot.position.set(0, 3.5, 0); frame.add(item.pivot);
    item.tube.position.y = -(0.7 + i * 0.125) - 0.15; item.tube.castShadow = true; item.pivot.add(item.tube);
    const num = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), named(new THREE.MeshBasicMaterial({ color: PAL.white, map: textTexture(String(i + 1), { w: 128, h: 128, size: 96, bg: '#fffaf0', fg: '#2b1d45' }), side: THREE.DoubleSide }), 'chime-number'));
    num.position.set(0, 4.25, 0); frame.add(num); item.num = num;
    P.col.add({ kind: 'cyl', x: x - 0.9, z, y0: y, y1: y + 3.6, r: 0.12 });
    P.col.add({ kind: 'cyl', x: x + 0.9, z, y0: y, y1: y + 3.6, r: 0.12 });
    P.scene.add(frame); ent.items.push(item);
  });
  const ring = (it) => {
    it.swing = 1;
    if (ent.done) return;
    const correct = it.i === ent.next;
    if (correct) { ent.next++; it.lit = true; it.mat.emissive.setHex(PAL.chimeLit); }
    else {
      for (const o of ent.items) { o.lit = false; o.mat.emissive.setHex(0x000000); }
      ent.next = it.i === 0 ? 1 : 0;
      if (it.i === 0) { it.lit = true; it.mat.emissive.setHex(PAL.chimeLit); }
      P.events.emit('ui:toast', { text: 'Oops! Start again at chime 1' });
    }
    P.events.emit('chime:ring', { index: it.i, correct, next: ent.next });
    if (ent.next >= ent.items.length) { ent.done = true; onDone(); }
  };
  ent.update = (dt, ctrl) => {
    const p = ctrl.position;
    for (const it of ent.items) {
      const near = Math.hypot(p.x - it.x, p.z - it.z) < 0.9 && p.y < it.y + 3.4 && p.y > it.y - 1;
      if (near && !it.touching) ring(it);
      it.touching = near;
    }
  };
  ent.target = () => { const it = ent.items[Math.min(ent.next, ent.items.length - 1)]; return { x: it.x, y: it.y + 1, z: it.z }; };
  ent.animate = (dt, t) => {
    for (const it of ent.items) {
      if (it.swing > 0) it.swing = Math.max(0, it.swing - dt * 1.2);
      it.pivot.rotation.x = Math.sin(t * 14) * 0.35 * it.swing;
      it.num.rotation.y = t * 0.8;
    }
  };
  ent.complete = () => { ent.done = true; ent.next = 4; for (const it of ent.items) { it.lit = true; it.mat.emissive.setHex(PAL.chimeLit); } };
  P.entities.push(ent);
  return ent;
}

// ---------- bell on the top of the towers ----------
export function bell(P, x, y, z) {
  const ent = { type: 'bell', swing: 0, touching: false };
  const frame = P.vcMesh(b => { b.cyl(-1.6, 0, 0, 0.16, 4, PAL.towerBlue, { collide: false, seg: 6 }); b.cyl(1.6, 0, 0, 0.16, 4, PAL.towerBlue, { collide: false, seg: 6 }); b.box(0, 4.1, 0, 3.8, 0.35, 0.5, PAL.roofRed, { collide: false }); b.cone(0, 4.28, 0, 2.6, 1.3, PAL.roofRedLo, { seg: 4, yaw: Math.PI / 4 }); b.sphere(0, 5.7, 0, 0.22, PAL.gold, { detail: 0 }); b.sphere(-1.6, 0.1, 0, 0.3, PAL.gold, { detail: 0, sy: 0.6 }); b.sphere(1.6, 0.1, 0, 0.3, PAL.gold, { detail: 0, sy: 0.6 }); });
  frame.position.set(x, y, z);
  ent.pivot = new THREE.Group(); ent.pivot.position.set(0, 3.9, 0); frame.add(ent.pivot);
  const pts = []; for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new THREE.Vector2(0.25 + Math.pow(t, 2.2) * 0.95, -t * 1.6)); }
  const bm = new THREE.Mesh(new THREE.LatheGeometry(pts, 16), named(toon(PAL.bell, { emissive: PAL.bellEmissive, side: THREE.DoubleSide }), 'bell'));
  bm.castShadow = true; ent.pivot.add(bm);
  P.col.add({ kind: 'cyl', x: x - 1.6, z, y0: y, y1: y + 4, r: 0.18 });
  P.col.add({ kind: 'cyl', x: x + 1.6, z, y0: y, y1: y + 4, r: 0.18 });
  P.scene.add(frame);
  ent.update = (dt, ctrl) => {
    const p = ctrl.position, near = Math.hypot(p.x - x, p.z - z) < 1.6 && p.y > y - 0.5 && p.y < y + 3.5;
    if (near && !ent.touching) { ent.swing = 1; P.events.emit('bell:ring', {}); }
    ent.touching = near;
  };
  ent.animate = (dt, t) => { if (ent.swing > 0) ent.swing = Math.max(0, ent.swing - dt * 0.5); ent.pivot.rotation.x = Math.sin(t * 5) * 0.5 * ent.swing; };
  P.entities.push(ent);
  return ent;
}

// ---------- ghost race: start pad -> finish pad within `target` seconds ----------
export function ghostRace(P, { start, finish, path, target = 30, ghostTime = 26, onWin }) {
  const ent = { type: 'race', running: false, time: 0, lastSec: 0 };
  const pad = (x, z, color, color2) => {
    const y = P.ground(x, z);
    const m = P.vcMesh(b => { b.cyl(0, 0, 0, 1.6, 0.18, color, { collide: false, seg: 16 }); b.cyl(0, 0.18, 0, 1.1, 0.04, color2, { collide: false, seg: 16 }); });
    m.position.set(x, y, z); P.scene.add(m);
    return { x, y, z };
  };
  const sp = pad(start[0], start[1], PAL.padStart, PAL.white), fp = pad(finish[0], finish[1], PAL.padFinish, PAL.platformTrim);
  ent.startPad = sp; ent.finishPad = fp;
  const ghost = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), named(new THREE.MeshBasicMaterial({ color: PAL.ghost, transparent: true, opacity: 0.45, depthWrite: false }), 'race-ghost'));
  ghost.visible = false; P.scene.add(ghost);
  const pts = [[sp.x, sp.z], ...path, [fp.x, fp.z]];
  let total = 0; const segs = [];
  for (let i = 0; i < pts.length - 1; i++) { const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); segs.push(L); total += L; }
  const ghostAt = t => {
    let d = Math.min(1, t / ghostTime) * total, i = 0;
    while (i < segs.length - 1 && d > segs[i]) { d -= segs[i]; i++; }
    const k = Math.min(1, d / segs[i]), x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, z = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k;
    return [x, z];
  };
  ent.stop = (won) => {
    if (!ent.running) return;
    ent.running = false; ghost.visible = false;
    P.events.emit('race:end', { won, time: +ent.time.toFixed(2) });
    if (won) onWin(); else P.events.emit('ui:toast', { text: 'Try again?' });
  };
  ent.update = (dt, ctrl) => {
    const p = ctrl.position;
    const on = (q) => Math.hypot(p.x - q.x, p.z - q.z) < 1.7 && Math.abs(p.y - q.y) < 1.2;
    if (!ent.running) {
      if (on(sp) && !ent.onStart) {
        ent.running = true; ent.time = 0; ent.lastSec = target; ghost.visible = true;
        P.events.emit('race:start', { target });
        P.events.emit('ui:toast', { text: `Race the ghost! ${target} s` });
      }
      ent.onStart = on(sp);
      return;
    }
    ent.time += dt;
    const rem = Math.ceil(target - ent.time);
    if (rem !== ent.lastSec) { ent.lastSec = rem; P.events.emit('race:tick', { remaining: Math.max(0, rem) }); }
    const [gx, gz] = ghostAt(ent.time);
    ghost.position.set(gx, P.ground(gx, gz, 20) + 0.8, gz);
    if (on(fp)) ent.stop(true);
    else if (ent.time > target) ent.stop(false);
  };
  ent.cancel = () => { if (ent.running) ent.stop(false); };
  P.entities.push(ent);
  return ent;
}

// ---------- wind volume (pushes the player; streaks show the direction) ----------
export function wind(P, { min, max, force }) {
  const ent = { type: 'wind', min, max, force };
  const n = 24;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 0.05, 0.05), named(new THREE.MeshBasicMaterial({ color: PAL.wind, transparent: true, opacity: 0.55 }), 'wind-streaks'), n);
  const L = Math.hypot(force[0], force[1]) || 1, dir = [force[0] / L, force[1] / L];
  const streaks = []; for (let i = 0; i < n; i++) streaks.push([Math.random(), Math.random(), Math.random()]);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-dir[1], dir[0]));
  const v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  P.scene.add(mesh); mesh.frustumCulled = false;
  P.winds = P.winds || []; P.winds.push(ent);
  ent.animate = (dt) => {
    if (P.still) { mesh.visible = false; return; }
    mesh.visible = true;
    streaks.forEach((st, i) => {
      st[0] = (st[0] + dt * 0.5) % 1;
      const along = st[0];
      v.set(min[0] + (max[0] - min[0]) * (dir[0] ? (dir[0] > 0 ? along : 1 - along) : st[1]),
        min[1] + (max[1] - min[1]) * st[2],
        min[2] + (max[2] - min[2]) * (dir[1] ? (dir[1] > 0 ? along : 1 - along) : st[1]));
      m4.compose(v, q, s); mesh.setMatrixAt(i, m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  P.entities.push(ent);
  return ent;
}
export function windAt(P, p) {
  if (!P.winds) return null;
  for (const w of P.winds) {
    if (p.x >= w.min[0] && p.x <= w.max[0] && p.y >= w.min[1] && p.y <= w.max[1] && p.z >= w.min[2] && p.z <= w.max[2]) return { x: w.force[0], z: w.force[1] };
  }
  return null;
}

// ---------- waterfall sheet (scrolling stripes + foam at the foot) ----------
export function waterfall(P, x, y0, z, w, h, yaw = 0) {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 256;
  const c = cv.getContext('2d');
  if (c) {
    const g = c.createLinearGradient(0, 0, 64, 0);
    g.addColorStop(0, '#4fc4f4'); g.addColorStop(0.5, '#8fe0ff'); g.addColorStop(1, '#4fc4f4');
    c.fillStyle = g; c.fillRect(0, 0, 64, 256);
    for (let i = 0; i < 46; i++) { c.fillStyle = `rgba(240,252,255,${0.35 + Math.random() * 0.55})`; const sx = Math.random() * 64, sy = Math.random() * 256, L = 24 + Math.random() * 70; c.fillRect(sx, sy, 2 + Math.random() * 5, L); if (sy + L > 256) c.fillRect(sx, sy - 256, 2, L); }
  }
  const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(w / 3, h / 8); tex.colorSpace = THREE.SRGBColorSpace;
  const mat = named(new THREE.MeshBasicMaterial({ color: PAL.white, map: tex, transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false }), 'waterfall');
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h, 1, 1), mat);
  m.position.set(x, y0 + h / 2, z); m.rotation.y = yaw; m.name = 'waterfall'; P.scene.add(m);
  // scrolling is driven by world's tick handler (P.ambient), which stops in focus mode
  (P.ambient || (P.ambient = [])).push(dt => { tex.offset.y += dt * 1.2; });
  return m;
}
