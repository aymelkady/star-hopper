/*
 * Boot + game loop.  Fixed 60 Hz physics with an accumulator, render every rAF, frame dt clamped
 * to 50 ms, auto-pause when the tab is hidden.  Exposes window.__game test hooks.
 */
import * as THREE from './three.js';
import { createEvents } from './core/events.js';
import { createState } from './core/state.js';
import { createInput } from './core/input.js';
import { createTouch, IS_TOUCH } from './core/touch.js';
import { createCameraRig } from './core/camera.js';
import { createController, TUNING } from './player/controller.js';
import { createPip } from './player/pip.js';
import { createWorld } from './world/world.js';
import { createHud } from './ui/hud.js';
import { createMenus } from './ui/menus.js';

const STEP = 1 / 60, MAX_FRAME = 0.05, FADE_HALF = 0.2; // 0.4 s respawn fade (R5)

const events = createEvents();
const state = createState(events);
const canvas = document.getElementById('game');
const touch = createTouch(document.body);
touch.show(false);
const input = createInput(window, canvas, touch);
input.setPointerLock(state.settings.pointerLock && !IS_TOUCH);
installManifest();

// first user gesture (iOS needs AudioContext creation inside one)
let gestured = false;
const firstGesture = () => { if (gestured) return; gestured = true; events.emit('input:firstGesture', {}); };
for (const t of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(t, firstGesture, { capture: true, passive: true });

let renderer = null, webgl = true;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, IS_TOUCH ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
} catch (err) {
  webgl = false; renderer = null;
  console.warn('[star-hopper] WebGL unavailable:', err && err.message);
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 900);
const world = createWorld({ scene, events, state, mobile: IS_TOUCH });
const ctrl = createController({ col: world.col, events, state });
ctrl.world = world;
const pip = createPip();
scene.add(pip.root); scene.add(pip.blob);
const rig = createCameraRig(camera, world.col, () => state.settings);
const hud = createHud({ events, state, world });

const game = {
  mode: 'title', timeScale: 1, acc: 0, t: 0, zone: null, respawn: null, objective: null, saveTimer: 0,
};
const menus = createMenus({
  state, isTouch: IS_TOUCH,
  onPlay: slot => startGame(slot),
  onResume: () => resume(),
  onSaveStop: () => saveAndStop(),
});
menus.showTitle(webgl ? '' : '3D graphics are not available on this device.');

// ---------- lifecycle ----------
function placeAtSpawn() {
  const sp = world.respawnPoint();
  ctrl.teleport(sp.x, sp.y, sp.z, sp.facing);
  ctrl.bonks = 0;
  rig.snap(ctrl.position, ctrl.facing);
}
function startGame(slot) {
  const data = state.load(slot);
  world.applySave(data);
  placeAtSpawn();
  game.mode = 'playing'; game.zone = null; game.respawn = null; game.acc = 0; game.saveTimer = 0;
  menus.hide(); hud.show(true); touch.show(true); input.setEnabled(true);
  ctrl.frozen = false;
  events.emit('game:start', { slot });
  checkZone(true);
  updateObjective(true);
  window.__game.ready = true;
}
function pause() {
  if (game.mode !== 'playing') return;
  game.mode = 'paused'; input.setEnabled(false); touch.show(false);
  state.save('pause');
  menus.showPause();
  events.emit('game:pause', {});
}
function resume() {
  if (game.mode !== 'paused') return;
  game.mode = 'playing'; menus.hide(); input.setEnabled(true); touch.show(true); game.acc = 0;
  events.emit('game:resume', {});
}
function saveAndStop() {
  const slot = state.slot;
  state.save('stop');
  events.emit('game:stop', { slot });
  state.close();
  game.mode = 'title'; hud.show(false); touch.show(false); input.setEnabled(true);
  window.__game.ready = false;
  menus.showTitle();
}
function beginRespawn(reason) {
  if (game.respawn) return;
  game.respawn = { t: FADE_HALF * 2, moved: false, reason };
  ctrl.frozen = true;
  document.getElementById('fade').classList.add('on');
  for (const e of world.props.entities) if (e.type === 'race' && e.cancel) e.cancel();
}
function tickRespawn(dt) {
  const r = game.respawn; if (!r) return;
  r.t -= dt;
  if (!r.moved && r.t <= FADE_HALF) {
    r.moved = true;
    placeAtSpawn();
    const cp = world.props.activeCheckpoint;
    events.emit('player:respawn', { reason: r.reason, checkpoint: cp ? cp.id : 'hub' });
    document.getElementById('fade').classList.remove('on');
  }
  if (r.t <= 0) { game.respawn = null; ctrl.frozen = false; }
}
function checkZone(force) {
  const z = world.zoneAt(ctrl.position.x, ctrl.position.z);
  if (z !== game.zone || force) {
    game.zone = z;
    if (state.data) state.data.lastZone = z;
    hud.setZone(z);
    events.emit('zone:enter', { zone: z, name: world.zoneName(z) });
  }
}
function updateObjective(force) {
  const s = world.nextStar();
  const id = s ? s.id : null;
  if (!force && id === game.objective) return;
  game.objective = id;
  events.emit('objective:changed', s ? { starId: s.id, name: s.name, zone: s.zone, target: world.objectiveTarget(s, ctrl.position) } : { starId: null, name: 'All stars found!', zone: null, target: null });
}
events.on('pickup:star', () => updateObjective(false));
events.on('star:revealed', () => updateObjective(true));
events.on('checkpoint:reached', () => { ctrl.bonks = 0; });

// HUD buttons (tap targets for mobile; also clickable on desktop)
document.getElementById('btn-pause').addEventListener('click', () => (game.mode === 'playing' ? pause() : resume()));
document.getElementById('btn-focus').addEventListener('click', () => events.emit('input:focus', {}));
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('pagehide', () => { if (state.data) state.save('hide'); });

// ---------- loop ----------
function physicsStep(h) {
  input.setContext({ airborne: !ctrl.grounded });
  const a = input.update();
  if (a.pause.pressed) { pause(); return; }
  if (a.focus.pressed) events.emit('input:focus', {});
  if (a.camReset.pressed) rig.resetBehind(ctrl.facing);
  world.props.updatePlatforms(h);
  if (!game.respawn) {
    ctrl.step(h, a, rig.yaw);
    world.update(h, ctrl, beginRespawn);
    if (ctrl.position.y < TUNING.killY) beginRespawn('fall');
    else { const hz = world.hazardAt(ctrl.position); if (hz) beginRespawn(hz); }
    checkZone(false);
  }
  tickRespawn(h);
}

const renderPos = new THREE.Vector3();
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now;
  if (!(dt > 0)) dt = 0;
  dt = Math.min(dt, MAX_FRAME);
  game.t += dt;

  if (game.mode === 'playing') {
    game.acc += dt * game.timeScale;
    let n = 0;
    while (game.acc >= STEP && n < 8) { physicsStep(STEP); game.acc -= STEP; n++; if (game.mode !== 'playing') break; }
    if (n >= 8) game.acc = 0;
    if (state.data) {
      state.data.playTime += dt;
      game.saveTimer += dt;
      if (game.saveTimer > 60) { game.saveTimer = 0; state.save('auto'); }
    }
    const alpha = Math.min(1, game.acc / STEP);
    renderPos.lerpVectors(ctrl.prevPosition, ctrl.position, alpha);
    rig.update(dt, ctrl, renderPos, input.actions.camera, input.takeMouse());
  } else {
    if (game.mode === 'paused' || game.mode === 'title') {
      input.setContext({ airborne: false });
      const a = input.update();
      menus.nav(a.nav);
      if (game.mode === 'paused' && a.pause.pressed) resume();
    }
    renderPos.copy(ctrl.position);
    if (game.mode === 'title') {
      rig.orbit(dt, 0, 0, 0, 30, 11);
      world.props.updatePlatforms(dt);
    }
  }
  const groundY = world.col.groundHeight(renderPos.x, renderPos.z, renderPos.y + 0.5);
  pip.update(dt, ctrl, renderPos, groundY);
  world.animate(dt, game.t, camera.position, renderPos);
  if (renderer) renderer.render(scene, camera);
  events.emit('tick', { dt, t: game.t });
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  if (renderer) renderer.setSize(w, h, false);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));
resize();
placeAtSpawn();
requestAnimationFrame(frame);

// ---------- PWA manifest + icons (inline data URLs; no files) ----------
function installManifest() {
  try {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#3d8ef0"/><path d="M32 8l7 15 16 2-12 11 3 16-14-8-14 8 3-16L9 25l16-2z" fill="#ffd84a" stroke="#1d1530" stroke-width="3" stroke-linejoin="round"/></svg>`;
    const svgUrl = 'data:image/svg+xml,' + encodeURIComponent(svg);
    const manifest = { name: 'Star Hopper', short_name: 'Star Hopper', display: 'fullscreen', orientation: 'landscape', background_color: '#9fd8ff', theme_color: '#3d8ef0', start_url: '.', icons: [{ src: svgUrl, sizes: 'any', type: 'image/svg+xml' }] };
    const cv = document.createElement('canvas'); cv.width = cv.height = 180;
    const c = cv.getContext('2d');
    if (c) {
      c.fillStyle = '#3d8ef0'; c.fillRect(0, 0, 180, 180);
      c.fillStyle = '#ffd84a'; c.strokeStyle = '#1d1530'; c.lineWidth = 8; c.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 30 : 70; c.lineTo(90 + Math.cos(a) * r, 95 + Math.sin(a) * r); }
      c.closePath(); c.fill(); c.stroke();
      const png = cv.toDataURL('image/png');
      manifest.icons.push({ src: png, sizes: '180x180', type: 'image/png' });
      const apple = document.createElement('link'); apple.rel = 'apple-touch-icon'; apple.href = png; document.head.appendChild(apple);
    }
    const link = document.createElement('link'); link.rel = 'manifest';
    link.href = 'data:application/manifest+json,' + encodeURIComponent(JSON.stringify(manifest));
    document.head.appendChild(link);
  } catch (_) { /* optional */ }
}

// ---------- test / debug hooks ----------
window.__game = {
  ready: false, webgl, player: ctrl, controller: ctrl, state, events, log: events.log, world, camera: rig,
  renderer, scene, input, touch, hud, menus, TUNING, game,
  teleport(x, y, z) { ctrl.teleport(x, y, z); rig.snap(ctrl.position, ctrl.facing); return true; },
  collect(id) {
    const p = world.findPickup(id); if (!p) return false;
    return p.type === 'star' ? world.props.collectStar(p) : world.props.collectCoin(p);
  },
  listPickups: () => world.listPickups(),
  setTimeScale(n) { game.timeScale = Math.max(0, Number(n) || 0); return game.timeScale; },
  start: slot => startGame(slot), pause, resume, saveAndStop, respawn: () => beginRespawn('manual'),
  drawCalls: () => (renderer ? renderer.info.render.calls : 0),
};
