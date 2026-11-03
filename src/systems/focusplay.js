/*
 * Focus training as gameplay (DESIGN.md §5.3).  Optional, adaptive, < 90 s, never "fail badly".
 *  - Focus Meter (ui/focus-meter.js): 0..100 sun docked left of the quest card.  +2/s while Pip
 *    gets closer to the current objective target, +8 per objective item / challenge hit, +25 per
 *    star; drains 1.5/s only after 25 s without progress (it just dims).  100 = Focus Burst:
 *    10 s golden trail + coins x2 (world.props.coinMultiplier) + toast, then back to 0.
 *  - Challenges (challenges/*.js): Gem Rush x3 (Go/No-Go), Two Things (dual task), Spot It
 *    (visual search) each own a start pad + an optional star; Freeze! (impulse control) is
 *    scheduled 2-3 times per session; Echo Chimes (towers-4) feeds the meter + stats.
 *    Pad -> rule card (icon + <= 5 words, tap) -> 3-2-1 -> run -> result card (star, or
 *    "Try again / Easier").  Pip is never stopped; walking away simply closes the card.
 *  - Adaptivity: per save, last 10 responses per type -> level 1..5 (up at >= 85 % with median
 *    RT < 1.2 s, down at < 60 %).  Saved as state.data.focus = {levels, history, bursts, results}.
 * Events: challenge:start/hit/miss/end, freeze:start/success/fail, focus:burst, focus:meter.
 * API (window.__game.plugins.focusplay): meter(), level(type), challenges(), active(),
 *   settingsRows(), debugSetMeter(v), debugStart(type, zone, {card}), debugHit(), debugMiss(),
 *   debugFreeze(), debugTapCard(), freeze (scheduler)
 */
import { createFocusUI } from '../ui/focus-meter.js';
import { createGem } from './challenges/gem.js';
import { createTwo } from './challenges/two.js';
import { createSpot } from './challenges/spot.js';
import { createFreeze } from './challenges/freeze.js';
import { solid, vcMaterial, named, PAL } from '../world/materials.js';

export const NAME = 'focusplay';
const TYPES = ['gem', 'two', 'spot', 'echo', 'freeze'];
const sine = (x0, z0, x1, z1, amp, periods, n = 28) => Array.from({ length: n + 1 }, (_, i) => {
  const t = i / n, dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz), w = Math.sin(t * periods * Math.PI * 2) * amp;
  return [x0 + dx * t - (dz / L) * w, z0 + dz * t + (dx / L) * w];
});
// positions verified with a ground/collider probe (see docs/FOCUS-TRAINING.md, "Where")
const COURSES = {
  gem: [
    { zone: 'meadow', pad: [-31, -4], path: sine(-34, -4, -55, -4, 2.2, 1.5), after: 'meadow-2' },
    { zone: 'cove', pad: [28, -9.5], path: sine(31, -9.5, 42.5, -9.5, 2.3, 2), after: 'cove-2' },
    { zone: 'towers', pad: [-7.5, -56], path: sine(-9.5, -54, -25, -54, 1.0, 1.5), lateral: 1.4, after: 'towers-2' },
  ],
  two: { pad: [45, -23], padMaxY: 5, lantern: [72, -29], after: 'focus-gem-cove' },
  spot: { center: [-16, -43], r: 6.5, plank: [-16, -32.8, -37.2], pad: [-16, -38.3], after: 'focus-gem-towers' },
};
const freshFocus = () => ({ levels: Object.fromEntries(TYPES.map(t => [t, 1])), history: {}, bursts: 0, results: {} });

let _glowTex = null;
function glowTexture(THREE) {
  if (_glowTex) return _glowTex;
  const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d');
  if (c) { const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.35, 'rgba(255,255,255,0.4)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, S, S); }
  _glowTex = new THREE.CanvasTexture(cv); _glowTex.colorSpace = THREE.SRGBColorSpace;
  return _glowTex;
}

export function init(ctx) {
  const { THREE, scene, camera, events, state, world, ctrl, game, hud } = ctx;
  const P = world.props, col = world.col;
  const ui = createFocusUI();
  const G = () => window.__game || {};
  const objectives = () => (G().plugins && G().plugins.objectives) || null;
  const sfx = (n, o) => { try { const a = G().audio; if (a && a.play) a.play(n, o); } catch (_) { /* optional */ } };
  const burst = o => { try { const f = G().fx; if (f && f.burst) f.burst(o); } catch (_) { /* optional */ } };
  const vcMat = named(vcMaterial(), 'focus-vc');
  const tmp = [];
  P.coinMultiplier = 1;

  // ---------------- save block + adaptivity ----------------
  function F() {
    const d = state.data; if (!d) return null;
    if (!d.focus || typeof d.focus !== 'object') d.focus = freshFocus();
    const f = d.focus, base = freshFocus();
    for (const k of Object.keys(base)) if (f[k] === undefined) f[k] = base[k];
    for (const t of TYPES) if (!(f.levels[t] >= 1)) f.levels[t] = 1;
    return f;
  }
  const level = type => { const f = F(); return f ? Math.max(1, Math.min(5, f.levels[type] | 0 || 1)) : 1; };
  function record(type, hit, rt) {
    const f = F(); if (!f) return;
    const h = f.history[type] || (f.history[type] = []);
    h.push({ hit: !!hit, rt: rt > 0 ? Math.round(rt) : 0 });
    if (h.length > 10) h.splice(0, h.length - 10);
  }
  function evaluate(type) { // called once per finished attempt
    const f = F(); if (!f) return 0;
    const h = f.history[type] || []; if (h.length < 10) return 0;
    const acc = h.filter(r => r.hit).length / h.length;
    const rts = h.filter(r => r.hit && r.rt > 0).map(r => r.rt).sort((a, b) => a - b);
    const med = rts.length ? rts[rts.length >> 1] : 0;
    const L = level(type);
    let n = L;
    if (acc >= 0.85 && med < 1200) n = Math.min(5, L + 1); else if (acc < 0.6) n = Math.max(1, L - 1);
    if (n !== L) { f.levels[type] = n; f.history[type] = []; }
    return n - L;
  }
  const result = id => { const f = F(); if (!f) return { won: false, fails: 0, attempts: 0, best: 0 }; return f.results[id] || (f.results[id] = { won: false, fails: 0, attempts: 0, best: 0 }); };

  // ---------------- Focus Meter ----------------
  let meter = 0, bucket = 0, idle = 0, prevD = null, sampleT = 0, prog = false, draining = false, playing = false;
  let sessionBursts = 0, burstT = 0, trailT = 0;
  function showMeter() {
    const b = Math.floor(meter / 5);
    if (b !== bucket) { bucket = b; events.emit('focus:meter', { value: Math.round(meter) }); }
    ui.setMeter(meter, draining);
  }
  function addMeter(v) {
    if (!playing || !(v > 0)) return;
    meter = Math.min(100, meter + v); idle = 0; draining = false;
    if (v >= 5) ui.flash();
    if (meter >= 100) focusBurst(); else showMeter();
  }
  function focusBurst() {
    sessionBursts++;
    const f = F(); if (f) f.bursts++;
    events.emit('focus:burst', { streak: sessionBursts });
    burstT = 10; trailT = 0; P.coinMultiplier = 2;
    hud.toast('Focus Burst! ✨ Coins x2', 2200);
    if (sessionBursts === 3) hud.toast('3 bursts today!', 2200);
    sfx('coin100');
    meter = 0; showMeter();
  }

  // ---------------- challenges ----------------
  const kit = {
    THREE, scene, camera, col, P, PAL, events, state, ctrl, ui, vcMat, named, sfx, burst, record, addMeter,
    ground: (x, z, maxY = 40) => col.groundHeight(x, z, maxY),
    clear: (x, z, y) => { const g = col.groundHeight(x, z, y + 3); col.sphereContacts(x, g + 1, z, 0.8, tmp); return Number.isFinite(g) && Math.abs(g - y) < 1.5 && !tmp.some(c => c.col); },
    toon: (c, o, name) => named(solid(c, o), name),
    glowTexture: () => glowTexture(THREE),
    pip: () => ctrl.position,
    zone: () => world.zoneAt(ctrl.position.x, ctrl.position.z),
    chip: text => ui.setChip(text),
    hit: (index, rt, at) => onHit(index, rt, at),
    miss: (reason, at) => onMiss(reason, at),
  };
  const list = [...COURSES.gem.map(d => createGem(kit, d)), createTwo(kit, COURSES.two), createSpot(kit, COURSES.spot)];
  const freeze = createFreeze(kit);
  const PAD_COLOR = { gem: PAL.padStart, two: PAL.mushOrange, spot: PAL.towersAccent };
  for (const ch of list) {
    const p = ch.pad;
    ch.star = world.addStar({ id: ch.starId, zone: ch.zone, name: ch.name, x: p.x, y: p.y + 2.2, z: p.z, hidden: true, task: 'focus', focus: ch.type, label: ch.label }, ch.after);
    ch.star.target = () => ({ x: p.x, y: p.y + 0.5, z: p.z });
    ch.padMesh = P.vcMesh(b => {
      b.geo(new THREE.TorusGeometry(1.15, 0.14, 6, 28), 0, 0.1, 0, PAD_COLOR[ch.type], { pitch: Math.PI / 2, jitter: 0.02 });
      b.cyl(0, 0, 0, 1.05, 0.07, PAL.white, { collide: false, seg: 22, jitter: 0.02 });
      b.cyl(0, 0.07, 0, 0.45, 0.03, PAL.gold, { collide: false, seg: 12, jitter: 0 });
      if (ch.type === 'gem') { b.geo(new THREE.OctahedronGeometry(0.42, 0), 0, 1.7, 0, 0x3aa8ff, { sy: 1.35 }); b.geo(new THREE.TetrahedronGeometry(0.3, 0), 0.7, 1.4, 0, 0xff4050); }
      else if (ch.type === 'two') { b.box(0, 1.7, 0, 0.5, 0.6, 0.5, PAL.flagGreen, { collide: false }); b.cone(0, 2.0, 0, 0.5, 0.35, PAL.roofRed, { seg: 4, yaw: Math.PI / 4 }); }
      else { b.box(0, 1.6, 0, 0.7, 0.7, 0.7, PAL.wood, { collide: false }); b.geo(new THREE.OctahedronGeometry(0.2, 0), 0, 1.6, 0.38, PAL.gold, { sz: 0.3 }); }
    }, false);
    ch.padMesh.position.set(p.x, p.y + 0.02, p.z); scene.add(ch.padMesh);
    ch.snooze = false;
  }
  const byStar = new Map(list.map(c => [c.starId, c]));
  const find = (type, zone) => list.find(c => c.type === type && (!zone || c.zone === zone)) || null;

  let active = null; // { ch, phase: 'card'|'count'|'run'|'result', t }
  const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const earned = ch => state.hasStar(ch.starId) || result(ch.starId).won;

  function openCard(ch) {
    active = { ch, phase: 'card', t: 0 };
    const fails = result(ch.starId).fails;
    ui.showCard({ kind: 'rule', icon: ch.rule.icon, lines: [ch.rule.text], hint: ch.rule.hint, buttons: [
      { id: 'fp-go', label: '▶ Start', primary: true, onClick: () => startCount() },
      ...(fails >= 2 && level(ch.type) > 1 ? [{ id: 'fp-easier', label: '👍 Easier', onClick: () => { easier(ch); startCount(); } }] : []),
      { id: 'fp-later', label: '✕ Later', onClick: () => { ch.snooze = true; close(); } },
    ] });
  }
  function close() {
    if (active && active.ch.padMesh) active.ch.padMesh.visible = !state.hasStar(active.ch.starId) && !earned(active.ch);
    ui.hideCard(); ui.showCount(null); ui.setChip(null); active = null;
  }
  function easier(ch) { const f = F(); if (f) { f.levels[ch.type] = Math.max(1, level(ch.type) - 1); f.history[ch.type] = []; } }
  function startCount() { if (!active) return; ui.hideCard(); active.phase = 'count'; active.t = 0; ui.showCount(3); sfx('click'); }
  function begin() {
    const ch = active.ch, L = level(ch.type);
    active.phase = 'run'; active.level = L; ui.showCount(null);
    result(ch.starId).attempts++;
    ch.begin(L); ch.padMesh.visible = false; // the pad icon looks like a gem: hide it while running
    events.emit('challenge:start', { type: ch.type, zone: ch.zone, level: L });
    sfx('checkpoint');
  }
  function finish(r, cancelled = false) {
    const ch = active.ch, L = active.level || level(ch.type), res = result(ch.starId);
    if (!cancelled) evaluate(ch.type);
    events.emit('challenge:end', { type: ch.type, zone: ch.zone, hits: r.hits, total: r.total, won: !!r.won, level: L, cancelled });
    ui.setChip(null);
    if (cancelled) { active = null; hud.toast('Come back anytime!'); state.save('focus'); return; }
    res.best = Math.max(res.best || 0, r.hits);
    const got = `${ch.type === 'spot' ? 'You found' : 'You got'} ${r.hits} / ${r.total}`;
    active.phase = 'result'; active.t = 0;
    if (r.won) {
      res.won = true; res.fails = 0;
      if (!ch.star.collected) P.revealStar(ch.star, `${ch.label[1]} done!`);
      ui.showCard({ kind: 'win', icon: '⭐', lines: [`${got}!`, 'Star unlocked!'], buttons: [{ id: 'fp-ok', label: '▶ Yay!', primary: true, onClick: close }] });
      addMeter(8);
    } else {
      res.fails = (res.fails || 0) + 1;
      const soft = res.fails >= 2 && level(ch.type) > 1;  // after two misses in a row, "Easier" is the default
      ui.showCard({ kind: 'retry', icon: '🙂', lines: [got, 'Nice try!'], buttons: [
        { id: 'fp-retry', label: '🔁 Try again', primary: !soft, onClick: () => startCount() },
        { id: 'fp-easier', label: '👍 Easier', primary: soft, onClick: () => { easier(ch); startCount(); } },
        { id: 'fp-later', label: '✕ Later', onClick: () => { ch.snooze = true; close(); } },
      ] });
    }
    state.save('focus');
  }
  function onHit(index, rt, at = {}) {
    if (!active || active.phase !== 'run') return;
    const type = active.ch.type;
    record(type, true, rt);
    events.emit('challenge:hit', { type, index, rt });
    addMeter(8);
    if (!at.quiet) { sfx('chime', { index, correct: true }); burst({ x: at.x, y: at.y, z: at.z, count: 18, color: [0x8fd8ff, 0xffffff, 0xffe680], speed: 4, life: 0.5, gravity: -3, size: 0.22 }); }
    else burst({ x: at.x, y: at.y, z: at.z, count: 6, color: 0xffffff, speed: 1.5, life: 0.35, gravity: 0, size: 0.16 });
  }
  function onMiss(reason, at = {}) {
    if (!active || active.phase !== 'run') return;
    const type = active.ch.type;
    record(type, false, 0);
    events.emit('challenge:miss', { type, reason });
    if (!at.quiet) sfx('chime', { index: 0, correct: false });
    if (reason !== 'timeout') burst({ x: at.x, y: at.y, z: at.z, count: 8, color: [0xffd0d5, 0xffffff], speed: 2, life: 0.35, gravity: -2, size: 0.18 });
  }

  // ---------------- Echo Chimes (towers-4) feed the meter + stats ----------------
  let lastChime = 0;
  events.on('chime:ring', p => {
    const now = performance.now(), rt = lastChime ? Math.min(5000, now - lastChime) : 0; lastChime = now;
    record('echo', !!p.correct, rt);
    if (p.correct) { addMeter(8); events.emit('challenge:hit', { type: 'echo', index: p.index, rt: Math.round(rt) }); }
    else events.emit('challenge:miss', { type: 'echo', reason: 'order' });
  });
  const cur = () => (objectives() ? objectives().current() : null);
  events.on('pickup:redcoin', p => { if (p.starId === cur()) addMeter(8); });
  events.on('lantern:lit', () => { if (cur() === 'cove-2') addMeter(8); });
  events.on('enemy:popped', () => { if (cur() === 'meadow-3') addMeter(8); });
  events.on('pickup:star', p => { addMeter(25); const ch = byStar.get(p.id); if (ch) ch.padMesh.visible = false; if (p.id === 'towers-4') evaluate('echo'); });
  events.on('objective:changed', () => { prevD = null; });

  // ---------------- session lifecycle ----------------
  events.on('game:start', () => {
    playing = true; meter = 0; bucket = 0; idle = 0; prevD = null; draining = false; sessionBursts = 0; burstT = 0; P.coinMultiplier = 1;
    F(); close(); freeze.session();
    for (const ch of list) {
      ch.cancel(); ch.snooze = false;
      ch.padMesh.visible = !state.hasStar(ch.starId) && !result(ch.starId).won;
      if (!ch.star.collected && result(ch.starId).won) { ch.star.revealed = true; ch.star.mesh.visible = true; } // earned before a reload
    }
    showMeter(); requestAnimationFrame(() => ui.dock());
  });
  events.on('game:stop', () => { playing = false; if (active && active.ch) active.ch.cancel(); close(); freeze.stop(); P.coinMultiplier = 1; burstT = 0; });
  window.addEventListener('resize', () => setTimeout(() => ui.dock(), 50));
  window.addEventListener('keydown', e => {
    if (!playing || game.mode !== 'playing' || !ui.cardOpen || e.code !== 'Enter') return;
    e.preventDefault(); ui.pressPrimary();
  });

  const raceRunning = () => P.entities.some(e => e.type === 'race' && e.running);
  const celebrating = () => !!(objectives() && objectives().celebrating);
  const eligible = playT => !active && !celebrating() && !game.respawn && !raceRunning() && ctrl.grounded && !(kit.zone() === 'hub' && playT < 60);

  let lastNow = performance.now(), dockT = 0;
  events.on('tick', ({ dt: frameDt }) => {
    const now = performance.now(), rdt = Math.min(0.25, (now - lastNow) / 1000); lastNow = now; // cards + 3-2-1 use wall-clock time
    if (!playing || game.mode !== 'playing') return;
    const dt = frameDt * (game.timeScale || 0);
    const p = ctrl.position;
    if ((dockT -= rdt) <= 0) { dockT = 1; ui.dock(); }
    // pads
    for (const ch of list) {
      if (!ch.padMesh.visible) continue;
      ch.padMesh.rotation.y += frameDt * 0.8;
      const d = flat(p, ch.pad);
      if (ch.snooze && d > 3) ch.snooze = false;
      if (!active && !freeze.active && !ch.snooze && !earned(ch) && d < 1.25 && Math.abs(p.y - ch.pad.y) < 1.6 && !celebrating()) openCard(ch);
    }
    if (active) {
      const a = active, d = flat(p, a.ch.pad);
      a.t += rdt;
      if (a.phase === 'card' && d > 3) close();
      else if (a.phase === 'count') { const n = 3 - Math.floor(a.t / 0.75); if (n <= 0) begin(); else if (String(n) !== ui.layer.querySelector('#fp-count').textContent) { ui.showCount(n); sfx('click'); } }
      else if (a.phase === 'run') {
        if (d > a.ch.leaveR) { a.ch.cancel(); finish({ hits: 0, total: 0, won: false }, true); }
        else { const r = a.ch.update(dt); if (r) finish(r); }
      } else if (a.phase === 'result' && (d > 8 || (ui.cardKind === 'win' && a.t > 3.5))) close();
    }
    freeze.update(dt, rdt, eligible);
    // meter: progress toward the current objective target
    if (burstT > 0) {
      burstT -= dt; trailT -= frameDt;
      if (trailT <= 0) { trailT = 0.07; burst({ x: p.x, y: p.y + 0.5, z: p.z, count: 3, color: [0xffd84a, 0xfff2a0, 0xffb020], speed: 0.8, spread: 0.6, life: 0.7, gravity: 0.6, drag: 1.5, size: 0.22 }); }
      if (burstT <= 0) P.coinMultiplier = 1;
    }
    sampleT += dt;
    if (sampleT >= 0.25) {
      sampleT = 0;
      const tg = objectives() && objectives().target();
      if (tg && !celebrating()) { const dd = Math.hypot(tg.x - p.x, tg.y - p.y, tg.z - p.z); prog = prevD !== null && dd < prevD - 0.1; prevD = dd; }
      else { prog = false; prevD = null; }
    }
    if (prog) { idle = 0; draining = false; meter = Math.min(100, meter + 2 * dt); if (meter >= 100) focusBurst(); }
    else if (!(active && active.phase === 'run')) { idle += dt; if (idle > 25 && meter > 0) { meter = Math.max(0, meter - 1.5 * dt); draining = true; } }
    showMeter();
  });

  return {
    meter: () => meter,
    get draining() { return draining; },
    get bursts() { return sessionBursts; },
    level, freeze,
    challenges: () => list.map(c => ({ type: c.type, zone: c.zone, starId: c.starId, pad: { ...c.pad }, star: { x: c.star.x, y: c.star.y, z: c.star.z }, earned: earned(c) })),
    active: () => active && { type: active.ch.type, zone: active.ch.zone, phase: active.phase, level: active.level || level(active.ch.type) },
    course: (type, zone) => find(type, zone),
    settingsRows: () => [{ key: 'freezeEnabled', icon: '❄️', label: 'Freeze! game', type: 'toggle', opts: [[true, 'On'], [false, 'Off']] }],
    debugSetMeter(v) { meter = Math.max(0, Math.min(100, +v || 0)); idle = 0; showMeter(); return meter; },
    debugAddMeter: v => addMeter(v),
    debugStart(type, zone, { card = false } = {}) {
      const ch = find(type, zone); if (!ch) return false;
      if (active) { active.ch.cancel(); close(); }
      if (card) { openCard(ch); return true; }
      active = { ch, phase: 'count', t: 0 }; begin(); return true;
    },
    debugTapCard: () => ui.pressPrimary(),
    debugHit: () => !!(active && active.phase === 'run' && active.ch.respond(true)),
    debugMiss: () => !!(active && active.phase === 'run' && active.ch.respond(false)),
    debugUpdate: () => { if (active && active.phase === 'run') { const r = active.ch.update(0); if (r) finish(r); } },
    debugFreeze: () => (active ? false : freeze.trigger()),
    debugClose: () => close(),
  };
}
