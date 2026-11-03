// Camera + crouch spec (plain node + playwright, same style as smoke.spec.mjs).  npm run test:camera
// Fails (exit 1) on any assertion failure or ANY console error / page error.
//  1. node-side: camera smoothing is frame-rate independent (same lag at 30 / 60 / 144 fps).
//  2. Pip backed against walls (low block + the tall hub trunk): camera >= 2.4 m from Pip or Pip
//     see-through; camera never below ground + 0.6 m; Pip's tail never in the lens.
//  3. Under the Sky Towers bell: bell fades below 50 %, camera pulls back / up.
//  4. Crouch (C held): < 50 % run speed, player:crouch {on:true/false}, crouch + jump running =
//     player:longjump, crouch + jump standing = backflip with a ~6.3 m apex.
//  5. Pitch stays within -35° .. +60° after long mouse drags; auto-rotate waits 1 s after input.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import * as THREE from '../src/three.js';
import { createCameraRig, CAM } from '../src/core/camera.js';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distFile = join(root, 'dist/star-hopper.html');
if (!existsSync(distFile)) { console.error('dist/star-hopper.html missing: run `npm run build` first'); process.exit(1); }

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ✔' : '  ✘'} ${msg}`); if (!cond) failures++; };
const DEG = 180 / Math.PI;

// ---------- 1. frame-rate independence (no browser) ----------
console.log('Node: camera smoothing vs. frame rate');
{
  const simulate = fps => {
    const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 900);
    const rig = createCameraRig(cam, null, () => ({ helperMode: true }));
    const pos = new THREE.Vector3(0, 0, 0);
    const ctrl = { grounded: true, velocity: new THREE.Vector3(9, 0, 0) };
    rig.snap(pos, 0); // facing +z while running +x: auto-rotate has to swing ~90°
    const dt = 1 / fps; let lagAt05 = 0;
    for (let t = 0; t < 1.0 - 1e-9; t += dt) {
      pos.x += 9 * dt;
      rig.update(dt, ctrl, pos, { x: 0, y: 0 }, null);
      if (Math.abs(t + dt - 0.5) < dt / 2) lagAt05 = pos.x - rig.focus.x;
    }
    return { lag: pos.x - rig.focus.x, lagAt05, yaw: rig.yaw, pitch: rig.pitch };
  };
  const a = simulate(30), b = simulate(60), c = simulate(144);
  const rel = (x, y) => Math.abs(x - y) / Math.max(1e-6, Math.abs(y));
  // continuous-time lag of an exponential follower is v/k; sampling once per frame shifts it by at
  // most half a frame of motion (v*dt/2) - anything more would be frame-rate dependent smoothing
  const ideal = 9 / CAM.followXZ, within = (r, fps) => Math.abs(r.lag - ideal) <= 9 / fps / 2 + 0.02;
  ok(within(a, 30) && within(b, 60) && within(c, 144), `follow lag at 9 m/s ≈ v/k = ${ideal.toFixed(3)} m ± half a frame: 30 fps ${a.lag.toFixed(3)}, 60 fps ${b.lag.toFixed(3)}, 144 fps ${c.lag.toFixed(3)}`);
  ok(b.lag < 0.8, `follow is snappy: lag ${b.lag.toFixed(2)} m at 9 m/s (< 0.8 m)`);
  ok(Math.abs(a.yaw - b.yaw) < 0.03 && Math.abs(c.yaw - b.yaw) < 0.03, `auto-rotate converges the same at 30/60/144 fps (yaw ${a.yaw.toFixed(3)} / ${b.yaw.toFixed(3)} / ${c.yaw.toFixed(3)})`);
  ok(CAM.minPitch * DEG >= -35.01 && CAM.maxPitch * DEG <= 60.01, `pitch clamp is ${(CAM.minPitch * DEG).toFixed(0)}° .. ${(CAM.maxPitch * DEG).toFixed(0)}°`);
}

// ---------- browser ----------
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
const page = await context.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
await page.goto(pathToFileURL(distFile).href);
await page.waitForFunction(() => window.__game && document.getElementById('btn-play'), null, { timeout: 20000 });
await page.evaluate(() => { try { localStorage.clear(); } catch (_) { /* ignore */ } window.__game.start(2); });
await page.waitForFunction(() => window.__game.ready === true, null, { timeout: 15000 });

const nowT = () => page.evaluate(() => (window.__game.log.at(-1)?.t ?? 0));
// headless (software GL) can run at a few fps: wait in GAME time, not wall-clock time
const waitGame = async sec => {
  const t0 = await page.evaluate(() => window.__game.game.t);
  await page.waitForFunction(t => window.__game.game.t >= t, t0 + sec, { timeout: 60000, polling: 30 });
};
const events = (type, since) => page.evaluate(([t, s]) => window.__game.log.filter(e => e.type === t && e.t >= s).map(e => e.payload), [type, since]);
const goTo = (x, y, z, f) => page.evaluate(([x, y, z, f]) => {
  const g = window.__game; g.player.teleport(x, y, z, f); g.player.velocity.set(0, 0, 0); g.camera.snap(g.player.position, f);
}, [x, y, z, f]);
await waitGame(0.3);
await page.evaluate(() => { const el = document.querySelector('#quest-card .qc-intro'); if (el && !el.hidden) el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
await waitGame(0.2);
const camState = () => page.evaluate(() => {
  const g = window.__game, r = g.camera, c = r.camera.position, p = g.player.position;
  const ground = g.world.col.groundHeight(c.x, c.z, c.y + 0.6);
  return { dist: r.distToFocus(), pip: r.fader('pip').opacity, bell: r.fader('bell') ? r.fader('bell').opacity : 1,
    camAboveGround: c.y - ground, pitch: r.pitch, actualPitch: r.actualPitch, yaw: r.yaw, under: r.under,
    pipCam: Math.hypot(c.x - p.x, c.y - (p.y + 0.72), c.z - p.z) };
});
// sample the camera every ~50 ms for `ms`
async function watch(sec) {
  const out = [];
  const t0 = await page.evaluate(() => window.__game.game.t);
  let t = t0;
  while (t - t0 < sec) { out.push(await camState()); await page.waitForTimeout(30); t = await page.evaluate(() => window.__game.game.t); }
  return out;
}

// ---------- 2. walls ----------
console.log('Browser: Pip backed against walls');
for (const [label, spot] of [['meadow block (4 m)', [-37.6, 1, 20, Math.PI / 2]], ['hub tree trunk (16 m)', [4.0, 1, 0.5, Math.PI / 2]]]) {
  await goTo(...spot);
  const s = await watch(1.5);
  const bad = s.filter(o => !(o.dist >= CAM.minDist - 0.02 || o.pip < 0.5));
  ok(bad.length === 0, `${label}: every frame camera ≥ ${CAM.minDist} m from Pip or Pip opacity < 0.5 (min dist ${Math.min(...s.map(o => o.dist)).toFixed(2)} m, ${s.length} samples)`);
  ok(Math.min(...s.map(o => o.pipCam)) > 1.2 || Math.min(...s.map(o => o.pip)) < 0.5, `${label}: lens never inside Pip (closest ${Math.min(...s.map(o => o.pipCam)).toFixed(2)} m to Pip's body)`);
  ok(s.every(o => o.camAboveGround >= CAM.groundClear - 0.02), `${label}: camera ≥ ${CAM.groundClear} m above the ground under it (min ${Math.min(...s.map(o => o.camAboveGround)).toFixed(2)} m)`);
}
// looking up hard from flat ground must not dig the camera into the terrain
await goTo(-38, 1, 4, -Math.PI / 2);
await page.evaluate(() => { const r = window.__game.camera; r.pitch = -35 * Math.PI / 180; r.idle = 0; });
{
  const s = await watch(0.4);
  ok(s.every(o => o.camAboveGround >= CAM.groundClear - 0.02), `pitch −35° on open ground: camera stays ≥ ${CAM.groundClear} m above the terrain (min ${Math.min(...s.map(o => o.camAboveGround)).toFixed(2)} m)`);
}

// ---------- 3. bell ----------
console.log('Browser: Sky Towers bell');
await goTo(1.0, 17.7, -95.7, 0.2); // under the bell, behind its centre (away from the towers-1 star)
await waitGame(0.9);
{
  const s = await camState();
  ok(s.bell < 0.5, `standing under the bell: bell opacity ${s.bell.toFixed(2)} (< 0.5)`);
  ok(s.under > 0.9 && s.actualPitch * DEG >= 40 && s.dist > CAM.dist, `camera pulled back and up under the bell (dist ${s.dist.toFixed(2)} m, pitch ${(s.actualPitch * DEG).toFixed(0)}°)`);
}
const bellRing = await events('bell:ring', 0);
ok(bellRing.length >= 1, 'bell still rings when Pip walks under it (collider/ring unchanged)');
await goTo(-38, 1, 4, -Math.PI / 2);
await waitGame(0.7);
ok((await camState()).bell > 0.95, 'bell back to full opacity once the camera is away');

// ---------- 4. crouch ----------
console.log('Browser: crouch');
await page.evaluate(() => { window.__game.state.settings.helperMode = true; });
await goTo(-38, 1, 4, -Math.PI / 2);
await waitGame(0.4);
let t0 = await nowT();
await page.keyboard.down('KeyC');
await page.keyboard.down('KeyW');
await waitGame(1.2);
const crouchSpeed = await page.evaluate(() => Math.hypot(window.__game.player.velocity.x, window.__game.player.velocity.z));
const crouching = await page.evaluate(() => window.__game.player.crouching);
const run = await page.evaluate(() => window.__game.TUNING.topSpeed);
await page.keyboard.up('KeyW');
await page.keyboard.up('KeyC');
await waitGame(0.2);
ok(crouching && crouchSpeed < 0.5 * run && crouchSpeed > 0.3 * run, `C held + W: crouch-walk ${crouchSpeed.toFixed(2)} m/s (< 50 % of ${run} m/s)`);
const cr = await events('player:crouch', t0);
ok(cr.some(p => p.on === true), 'player:crouch {on:true} emitted');
ok(cr.at(-1) && cr.at(-1).on === false, 'player:crouch {on:false} emitted on release');

// crouch + jump while running = long jump
await goTo(-38, 1, 4, -Math.PI / 2);
await waitGame(0.4);
t0 = await nowT();
await page.keyboard.down('KeyW');
await waitGame(0.8);
await page.keyboard.down('KeyC');
await waitGame(0.07);
await page.keyboard.press('Space');
await waitGame(0.15);
await page.keyboard.up('KeyC');
await page.keyboard.up('KeyW');
await waitGame(0.9);
ok((await events('player:longjump', t0)).length === 1, 'crouch + jump while running -> player:longjump');

// crouch + jump standing still = backflip (apex ≈ 6.3 m)
await goTo(-38, 1, 4, -Math.PI / 2);
await waitGame(0.5);
t0 = await nowT();
const y0 = await page.evaluate(() => window.__game.player.position.y);
await page.keyboard.down('KeyC');
await waitGame(0.15);
await page.keyboard.down('Space');
const peak = await page.evaluate(() => new Promise(res => {
  const g = window.__game; let top = g.player.position.y, n = 0;
  const tick = () => { top = Math.max(top, g.player.position.y); if (++n < 90) requestAnimationFrame(tick); else res(top); };
  requestAnimationFrame(tick);
}));
await page.keyboard.up('Space');
await page.keyboard.up('KeyC');
await waitGame(0.6);
ok((await events('player:backflip', t0)).length === 1, 'crouch + jump standing still -> player:backflip');
ok(Math.abs(peak - y0 - 6.3) < 0.35, `backflip apex ${(peak - y0).toFixed(2)} m (≈ 6.3 m)`);

// ---------- 5. pitch clamp + auto-rotate delay ----------
console.log('Browser: pitch clamp and auto-rotate');
await goTo(-38, 1, 4, -Math.PI / 2);
await waitGame(0.3);
const drag = async (dy, steps = 40) => {
  await page.mouse.move(640, 360); await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(640 + i * 3, 360 + (dy * i) / steps);
  await page.mouse.up();
  await waitGame(0.08);
};
await drag(3000);
const pDown = await page.evaluate(() => window.__game.camera.pitch * 180 / Math.PI);
await drag(-6000);
const pUp = await page.evaluate(() => window.__game.camera.pitch * 180 / Math.PI);
ok(pDown <= 60.01 && pDown >= -35.01 && pUp <= 60.01 && pUp >= -35.01 && Math.max(pDown, pUp) > 59 && Math.min(pDown, pUp) < -34, `pitch clamped after long drags (${pDown.toFixed(1)}°, ${pUp.toFixed(1)}°)`);
// auto-rotate: drag the camera to the side, run sideways; nothing for ~1 s, then it swings behind
await goTo(-38, 1, 4, -Math.PI / 2);
await waitGame(0.3);
await drag(0, 10);
const yawA = await page.evaluate(() => window.__game.camera.yaw);
await page.keyboard.down('KeyD');
await waitGame(0.65);
const yawB = await page.evaluate(() => window.__game.camera.yaw);
await waitGame(1.8);
const yawC = await page.evaluate(() => window.__game.camera.yaw);
await page.keyboard.up('KeyD');
ok(Math.abs(yawB - yawA) < 0.05, `no auto-rotate during the first second after camera input (Δyaw ${(yawB - yawA).toFixed(3)})`);
ok(Math.abs(yawC - yawB) > 0.3, `auto-rotate swings behind the run after 1 s idle (Δyaw ${(yawC - yawB).toFixed(2)})`);

ok(errors.length === 0, `no console errors${errors.length ? ':\n    ' + errors.join('\n    ') : ''}`);
await browser.close();
if (failures) { console.log(`\n${failures} CAMERA CHECK(S) FAILED`); process.exit(1); }
console.log('\nALL CAMERA CHECKS PASSED');
