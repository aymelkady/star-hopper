// Gesture-recogniser test (plain node + playwright), DESIGN.md §5.1.  iPad + phone emulation,
// real multi-touch through CDP Input.dispatchTouchEvent with real-time spacing (the recogniser
// uses performance.now()).  Exits 1 on any failed check or ANY console error / page error.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distFile = join(root, 'dist/star-hopper.html');
const URL_ = pathToFileURL(distFile).href;
mkdirSync(join(root, 'test/shots'), { recursive: true });

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ✔' : '  ✘'} ${msg}`); if (!cond) failures++; };
const SWIFTSHADER = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
if (!existsSync(distFile)) { console.error('dist/star-hopper.html missing: run `npm run build` first'); process.exit(1); }

// ---------- multi-touch driver (CDP) ----------
// Every event carries an explicit timestamp from a virtual clock that advances only through
// T.wait(ms).  CDP waits for the page to handle each event, so on a slow software-GL machine real
// spacing would stretch a 50 ms tap into a long press; event.timeStamp (which the recogniser uses)
// follows the virtual clock instead, exactly like a real finger on a janky frame.
export function touchDriver(cdp) {
  const active = new Map();
  let vt = Date.now();
  const pts = () => [...active.values()].map(p => ({ x: p.x, y: p.y, id: p.id, radiusX: 4, radiusY: 4, force: 1 }));
  const send = type => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts(), timestamp: vt / 1000 });
  const anchor = () => { const n = Date.now(); if (active.size === 0 || n - vt > 3000) vt = Math.max(vt, n); };
  const d = {
    async wait(ms) { vt += ms; await sleep(ms); },
    async down(id, x, y) { anchor(); active.set(id, { id, x, y }); await send('touchStart'); },
    /** several fingers touching in the same instant */
    async downMany(list) { anchor(); for (const [id, x, y] of list) active.set(id, { id, x, y }); await send('touchStart'); },
    async move(id, x, y) { Object.assign(active.get(id), { x, y }); await send('touchMove'); },
    async up(id) { active.delete(id); await send('touchEnd'); },
    async upMany(ids) { for (const id of ids) active.delete(id); await send('touchEnd'); },
    async tap(id, x, y, hold = 40) { await d.down(id, x, y); await d.wait(hold); await d.up(id); },
    /** straight-line stroke: `steps` moves spread over `ms` (virtual) milliseconds */
    async stroke(id, x, y, dx, dy, ms, steps = 5, lift = true) {
      await d.down(id, x, y);
      for (let i = 1; i <= steps; i++) { await d.wait(ms / steps); await d.move(id, x + dx * i / steps, y + dy * i / steps); }
      if (lift) await d.up(id);
    },
  };
  return d;
}
const swipe = (T, id, x, y, dx, dy) => T.stroke(id, x, y, dx, dy, 60, 4);       // 4 moves in 60 ms -> ~1000+ px/s
const slowDrag = (T, id, x, y, dx, dy) => T.stroke(id, x, y, dx, dy, 900, 18);  // ~150-250 px/s

// ---------- page helpers ----------
async function open(browser, viewport, { tutorialSeen = true } = {}) {
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  if (tutorialSeen) await context.addInitScript(() => { try { localStorage.setItem('starhopper.settings', JSON.stringify({ gestureTutorialSeen: true })); } catch (_) { /* */ } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  if (process.env.DEBUG_GEST) page.on('console', m => { if (m.text().startsWith('C ')) console.log('   ', m.text()); });
  await page.goto(URL_);
  await page.waitForFunction(() => window.__game && document.getElementById('btn-play'), null, { timeout: 20000 });
  if (process.env.DEBUG_GEST) await page.evaluate(() => { window.__dbg = true; });
  await page.tap('#btn-play'); await page.tap('#slot-1');
  await page.waitForFunction(() => window.__game.ready === true, null, { timeout: 15000 });
  await page.evaluate(() => {
    window.__ev = [];
    window.__tickN = 0;
    window.__game.events.on('*', (type, p) => { if (type === 'tick') window.__tickN++; else window.__ev.push({ type, p, t: performance.now(), tick: window.__tickN }); });
  });
  await lowRes(page, true);
  const cdp = await context.newCDPSession(page);
  return { context, page, errors, T: touchDriver(cdp) };
}
// Software GL is slow (and CI machines are busy): render at 1/4 resolution so input events are
// delivered promptly; switch back to full resolution just for screenshots.
const lowRes = (page, on) => page.evaluate(v => { const r = window.__game.renderer; if (r) { r.setPixelRatio(v ? 0.25 : 1); window.dispatchEvent(new Event('resize')); } }, on);
async function shot(page, file) { await lowRes(page, false); await sleep(120); await page.screenshot({ path: join(root, file) }); await lowRes(page, true); }
const mark = page => page.evaluate(() => performance.now());
const evs = (page, type, since) => page.evaluate(([t, s]) => window.__ev.filter(e => e.type === t && e.t >= s), [type, since]);
const count = async (page, type, since) => (await evs(page, type, since)).length;
const yaw = page => page.evaluate(() => window.__game.camera.yaw);
const pos = page => page.evaluate(() => { const p = window.__game.player.position; return { x: p.x, y: p.y, z: p.z }; });
const settle = page => page.waitForFunction(() => window.__game.player.grounded && window.__game.player.mode === 'ground', null, { timeout: 5000 }).catch(() => {});
async function home(page) {
  await page.evaluate(() => { const g = window.__game; const s = g.world.respawnPoint(); g.player.teleport(s.x, s.y, s.z, s.facing); g.camera.snap(g.player.position, g.player.facing); });
  await settle(page); await sleep(150);
}
// Face Pip + camera down a clear, flat 30 m runway from the spawn (combo needs uninterrupted running).
async function openRunway(page) {
  const found = await page.evaluate(() => {
    const g = window.__game, col = g.world.col, p = g.player.position;
    for (let k = 0; k < 16; k++) {
      const a = k * Math.PI / 8, dx = Math.sin(a), dz = Math.cos(a);
      let flat = true; const arr = [];
      for (let d = 1; d <= 30 && flat; d += 1) {
        const x = p.x + dx * d, z = p.z + dz * d;
        col.sphereContacts(x, p.y + 1.2, z, 0.7, arr);
        flat = !arr.some(c => c.depth > 1e-4) && Math.abs(col.groundHeight(x, z, p.y + 1) - p.y) < 0.25;
      }
      if (!flat) continue;
      g.player.facing = a; g.camera.snap(p, a);
      return a;
    }
    return null;
  });
  await sleep(100);
  return found;
}
// Teleport Pip up and slow time down so the fall outlasts a swipe even on a slow software-GL box
// (the game keeps stepping physics, so latched gestures are still consumed).  slowmo(page,1) restores.
const slowmo = (page, k) => page.evaluate(v => window.__game.setTimeScale(v), k);
const waitEv = (page, type, since, n = 1, timeout = 6000) => page.waitForFunction(([ty, s, k]) => window.__ev.filter(e => e.type === ty && e.t >= s).length >= k, [type, since, n], { timeout }).catch(() => {});
async function airborne(page, up = 7) {
  await slowmo(page, 0.15);
  await page.evaluate(h => { const g = window.__game, p = g.player.position; g.player.teleport(p.x, p.y + h, p.z); g.player.sinceGround = 9; }, up); // no coyote window after a teleport
  await page.waitForFunction(() => !window.__game.player.grounded, null, { timeout: 2000 }).catch(() => {});
  await sleep(40);
}

async function run(browser, name, viewport) {
  console.log(`Gestures: ${name} (${viewport.width}x${viewport.height})`);
  const { context, page, errors, T } = await open(browser, viewport);
  const W = viewport.width, H = viewport.height;
  const R = { x: W * 0.72, y: H * 0.55 };   // right-half gesture spot
  const L = { x: W * 0.2, y: H * 0.7 };     // left-half stick spot
  await T.wait(300);

  // --- DOM: no gameplay buttons ---
  const dom = await page.evaluate(() => ({
    buttons: ['#touch-jump', '#touch-long', '#touch-pound', '#touch-stick', '.touch-buttons'].filter(s => document.querySelector(s)),
    container: !!document.getElementById('touch-controls'),
    help: window.__game.touch.GESTURE_HELP,
  }));
  ok(dom.buttons.length === 0, `no gameplay buttons in the DOM (${dom.buttons.join(',') || 'none'})`);
  ok(dom.container && await page.isVisible('#touch-controls'), '#touch-controls container kept + visible');
  const words = s => s.trim().split(/\s+/).length;
  ok(dom.help.length >= 4 && dom.help.every(h => h.icon && words(h.title) <= 4 && words(h.text) <= 4), `GESTURE_HELP: ${dom.help.length} rows, all ≤ 4 words`);

  // --- stick ---
  await home(page);
  let p0 = await pos(page);
  await T.down(1, L.x, L.y);
  for (let i = 1; i <= 6; i++) { await T.wait(16); await T.move(1, L.x, L.y - i * 12); }
  await T.wait(120);
  const stickVis = await page.evaluate(() => { const s = document.getElementById('gs-stick'); return { on: s.classList.contains('on'), op: +getComputedStyle(s).opacity, left: parseFloat(s.style.left) }; });
  ok(stickVis.on && Math.abs(stickVis.left - L.x) < 2, `stick ring appears at the touch point (opacity ${stickVis.op.toFixed(2)})`);
  if (name === 'ipad') await shot(page, 'test/shots/gesture-stick.png');
  await T.wait(900);
  // drift onto the right half: still the stick
  await T.move(1, W * 0.6, L.y - 72);
  await T.wait(80);
  await page.waitForFunction(() => window.__game.touch.state.mx > 0.5, null, { timeout: 3000 }).catch(() => {});
  const drift = await page.evaluate(() => ({ mx: window.__game.touch.state.mx, my: window.__game.touch.state.my }));
  ok(drift.mx > 0.5, `stick keeps steering after drifting to the right half (mx ${drift.mx.toFixed(2)})`);
  await T.wait(300);
  await T.up(1);
  await T.wait(250);
  let p1 = await pos(page);
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  ok(moved >= 5, `drag left moved Pip ${moved.toFixed(2)} m (≥ 5)`);
  const off = await page.evaluate(() => ({ on: document.getElementById('gs-stick').classList.contains('on'), mx: window.__game.touch.state.mx }));
  ok(!off.on && off.mx === 0, 'stick fades out + recentres on lift');

  // dead zone: tiny wobble does not move
  await home(page);
  p0 = await pos(page);
  await T.down(1, L.x, L.y); await T.wait(30); await T.move(1, L.x + 6, L.y - 3); await T.wait(400); await T.up(1); await T.wait(100);
  p1 = await pos(page);
  ok(Math.hypot(p1.x - p0.x, p1.z - p0.z) < 0.05, 'stick dead zone: 6 px wobble does not move Pip');

  // --- tap = jump, no camera motion ---
  await home(page);
  let t = await mark(page), y0 = await yaw(page);
  await page.evaluate(() => { window.__lift = null; window.addEventListener('pointerup', () => { window.__lift = window.__tickN; }, { capture: true, once: true }); });
  await T.tap(2, R.x, R.y, 50);
  await waitEv(page, 'player:jump', t);
  await T.wait(120);
  const jumps = await evs(page, 'player:jump', t);
  ok(jumps.length === 1, `tap right -> exactly one player:jump (${jumps.length})`);
  // latency in rendered frames (machine-independent): the jump must happen in the frame right after the lift
  const liftTick = await page.evaluate(() => window.__lift);
  ok(jumps.length && liftTick !== null && jumps[0].tick - liftTick <= 1, `tap jump fires in the first frame after the lift (${jumps[0]?.tick - liftTick} frame)`);
  ok(Math.abs(await yaw(page) - y0) < 0.01, 'tap does not orbit the camera');
  await settle(page);
  const apex = await page.evaluate(() => window.__ev.filter(e => e.type === 'player:land').at(-1));
  ok(!!apex, 'jump landed');

  // long press (> 180 ms, still) is NOT a jump
  await home(page);
  t = await mark(page);
  await T.tap(2, R.x, R.y, 260); await T.wait(80);
  ok(await count(page, 'player:jump', t) === 0, 'still press for 260 ms -> no jump');

  // --- slow drag = orbit only ---
  await home(page);
  t = await mark(page); y0 = await yaw(page);
  await slowDrag(T, 2, R.x, R.y, -180, 0);
  await T.wait(80);
  const y1 = await yaw(page);
  ok(Math.abs(y1 - y0) > 0.2, `slow drag orbits the camera (Δyaw ${(y1 - y0).toFixed(2)})`);
  ok(await count(page, 'player:jump', t) + await count(page, 'player:longjump', t) + await count(page, 'player:poundstart', t) === 0, 'slow drag fires no jump / long jump / pound');
  // slow vertical drag: pitch only, no pound/crouch
  t = await mark(page);
  await slowDrag(T, 2, R.x, R.y - 60, 0, 150);
  ok(await count(page, 'player:jump', t) + await count(page, 'player:poundstart', t) === 0, 'slow downward drag is camera, not pound');

  // --- swipe up ---
  await home(page);
  t = await mark(page);
  await swipe(T, 2, R.x, R.y, 0, -120);
  await T.wait(100);
  ok(await count(page, 'player:jump', t) === 1, 'swipe up on the ground -> player:jump');
  await settle(page);
  await airborne(page, 12);
  t = await mark(page);
  await swipe(T, 2, R.x, R.y, 0, -120);
  await T.wait(100);
  const airJumps = await count(page, 'player:jump', t), stillAir = await page.evaluate(() => !window.__game.player.grounded);
  ok(airJumps === 0 && stillAir, `swipe up high in the air -> nothing (jumps ${airJumps}, still airborne ${stillAir})`);
  await slowmo(page, 1);
  await settle(page);

  // --- swipe down ---
  await home(page);
  await airborne(page, 7);
  t = await mark(page); y0 = await yaw(page);
  await swipe(T, 2, R.x, R.y - 80, 0, 130);
  await waitEv(page, 'player:poundstart', t);
  await slowmo(page, 1);
  await waitEv(page, 'player:groundpound', t);
  ok(await count(page, 'player:poundstart', t) === 1, 'swipe down in the air -> player:poundstart');
  ok(await count(page, 'player:groundpound', t) === 1, 'swipe down in the air -> player:groundpound on landing');
  ok(Math.abs(await yaw(page) - y0) < 0.01, 'swipe does not orbit the camera');
  await settle(page); await T.wait(300);
  t = await mark(page);
  await T.stroke(2, R.x, R.y - 80, 0, 130, 60, 4, false);  // swipe down and keep holding
  await T.wait(120);
  await page.waitForFunction(() => window.__game.input.actions.crouch.held, null, { timeout: 3000 }).catch(() => {});
  const crouch = await page.evaluate(() => window.__game.input.actions.crouch.held);
  await T.up(2); await T.wait(80);
  await page.waitForFunction(() => !window.__game.input.actions.crouch.held, null, { timeout: 3000 }).catch(() => {});
  const crouchAfter = await page.evaluate(() => window.__game.input.actions.crouch.held);
  ok(crouch && !crouchAfter, `swipe down on the ground -> crouch held until lift (${crouch} -> ${crouchAfter})`);
  ok(await count(page, 'player:poundstart', t) === 0 && await count(page, 'player:jump', t) === 0, 'grounded swipe down: no pound, no jump');

  // --- swipe sideways ---
  await home(page);
  t = await mark(page); y0 = await yaw(page);
  await swipe(T, 2, R.x - 60, R.y, 140, 0);
  await T.wait(120);
  ok(await count(page, 'player:longjump', t) === 0 && await count(page, 'player:jump', t) === 0, 'side swipe standing still -> nothing');
  ok(Math.abs(await yaw(page) - y0) < 0.01, 'side swipe standing still -> no camera orbit either');
  await home(page);
  await T.down(1, L.x, L.y);
  for (let i = 1; i <= 6; i++) { await T.wait(16); await T.move(1, L.x, L.y - i * 12); }
  await page.waitForFunction(() => Math.hypot(window.__game.player.velocity.x, window.__game.player.velocity.z) > 6, null, { timeout: 2000 }).catch(() => {});
  t = await mark(page);
  await T.stroke(2, R.x - 60, R.y, 130, -50, 60, 4);   // diagonal-forward swipe while running
  await T.wait(120);
  await T.up(1);
  ok(await count(page, 'player:longjump', t) === 1, 'diagonal-forward swipe while running -> player:longjump');
  if (name === 'ipad') {
    // freeze the newest streak 40 ms into its 150 ms animation for the screenshot
    await page.evaluate(() => {
      const last = [...document.querySelectorAll('.gs-streak')].sort((a, b) => (+b.dataset.t || 0) - (+a.dataset.t || 0))[0];
      if (last) last.getAnimations().forEach(a => { a.pause(); a.currentTime = 40; });
    });
    await shot(page, 'test/shots/gesture-swipe.png');
    await page.evaluate(() => document.querySelectorAll('.gs-streak').forEach(n => n.getAnimations().forEach(a => a.finish())));
  }
  await settle(page);

  // --- combo: taps on landing chain double + triple (synthetic pointers fired on player:land) ---
  await home(page);
  const runway = await openRunway(page);
  ok(runway !== null, `found a clear runway for the combo (heading ${runway?.toFixed(2)})`);
  await T.down(1, L.x, L.y);
  for (let i = 1; i <= 6; i++) { await T.wait(16); await T.move(1, L.x, L.y - i * 12); }
  // start the chain as soon as Pip is up to speed (a slow machine must not run him off the runway)
  await page.waitForFunction(() => Math.hypot(window.__game.player.velocity.x, window.__game.player.velocity.z) > 6, null, { timeout: 5000 }).catch(() => {});
  t = await mark(page);
  await page.evaluate(([x, y]) => {
    const el = document.getElementById('touch-controls'); let n = 0, id = 900;
    const tap = () => {
      const o = { pointerId: ++id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: false };
      el.dispatchEvent(new PointerEvent('pointerdown', o));
      setTimeout(() => el.dispatchEvent(new PointerEvent('pointerup', o)), 45);
    };
    if (window.__dbg) { for (const ty of ['player:land', 'player:jump']) window.__game.events.on(ty, p => console.log('C', ty, JSON.stringify(p), window.__game.player.mode, performance.now() | 0));
      for (const ty of ['pointerdown', 'pointerup']) el.addEventListener(ty, e => console.log('C', ty, e.pointerId, e.timeStamp | 0, performance.now() | 0, JSON.stringify(window.__game.touch.debug()))); }
    window.__game.events.on('player:land', () => { if (n++ < 2) setTimeout(tap, 10); });
    tap(); // (setTimeout timers are real time; the game may run slower than real time here, which only widens the window)
  }, [R.x, R.y]);
  await page.waitForFunction(s => window.__ev.filter(e => e.type === 'player:jump' && e.t >= s).length >= 3, t, { timeout: 40000 }).catch(() => {});
  await T.up(1);
  const tiers = (await evs(page, 'player:jump', t)).map(e => e.p.tier);
  const dbg = tiers.length < 3 ? JSON.stringify(await page.evaluate(() => ({ t: window.__game.touch.debug(), mode: window.__game.game.mode, hidden: window.__game.touch.el.hidden, p: window.__game.player.mode }))) : '';
  ok(tiers.slice(0, 3).join() === '1,2,3', `tap on landing chains jumps: tiers ${tiers.join(',')} ${dbg}`);
  await settle(page);

  // --- stick held + tap right = jump, NOT pause ---
  await home(page);
  t = await mark(page);
  await T.down(1, L.x, L.y); await T.wait(300);
  await T.tap(2, R.x, R.y, 50); await T.wait(120);
  await T.up(1); await T.wait(60);
  const jp = [await count(page, 'player:jump', t), await count(page, 'game:pause', t)];
  ok(jp[0] === 1 && jp[1] === 0, `still left thumb + tap right -> jump in place, no pause (jumps ${jp[0]}, pauses ${jp[1]})`);
  await settle(page);

  // --- two-finger tap = pause ---
  t = await mark(page);
  await T.down(3, R.x, R.y); await T.wait(30); await T.down(4, R.x + 90, R.y + 20);
  await T.wait(80); await T.upMany([3, 4]);
  await T.wait(120);
  ok(await count(page, 'game:pause', t) === 1, 'two-finger tap -> game:pause');
  ok(await count(page, 'player:jump', t) === 0, 'two-finger tap does not also jump');
  await page.evaluate(() => window.__game.resume());
  await T.wait(200);
  // two fingers but one drags -> no pause
  t = await mark(page);
  await T.down(3, R.x, R.y); await T.wait(20); await T.down(4, W * 0.3, R.y);
  for (let i = 1; i <= 4; i++) { await T.wait(20); await T.move(4, W * 0.3, R.y - i * 10); }
  await T.up(3); await T.up(4); await T.wait(150);
  ok(await count(page, 'game:pause', t) === 0, 'two fingers with one moving -> no pause');
  // two-finger, left + right halves
  await settle(page);
  t = await mark(page);
  await T.downMany([[5, W * 0.25, R.y], [6, W * 0.75, R.y]]);
  await T.wait(90); await T.up(5); await T.wait(15); await T.up(6); await T.wait(120);
  ok(await count(page, 'game:pause', t) === 1, 'two-finger tap across both halves -> game:pause');
  await page.evaluate(() => window.__game.resume());
  await T.wait(200);

  // --- hybrid device: mouse drag still orbits ---
  y0 = await yaw(page);
  await page.mouse.move(W * 0.7, H * 0.4); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(W * 0.7 - i * 20, H * 0.4); await T.wait(16); }
  await page.mouse.up(); await T.wait(80);
  ok(Math.abs(await yaw(page) - y0) > 0.2, `mouse drag orbits on a touch device (Δyaw ${(await yaw(page) - y0).toFixed(2)})`);

  ok(errors.length === 0, `no console errors${errors.length ? ':\n    ' + errors.join('\n    ') : ''}`);
  await context.close();
}

async function tutorial(browser) {
  console.log('Gestures: first-play tutorial (iPad)');
  const viewport = { width: 1080, height: 810 };
  const { context, page, errors, T } = await open(browser, viewport, { tutorialSeen: false });
  ok(await page.isVisible('#gs-tutorial'), 'tutorial overlay shows on first touch game start');
  const caps = await page.$$eval('#gs-tutorial .gs-cap', n => n.map(x => x.textContent));
  ok(caps.length === 4 && caps.every(c => c.split(/\s+/).length <= 4), `captions: ${caps.join(' | ')}`);
  ok(await page.$$eval('#gs-tutorial .gs-hand', n => n.every(x => getComputedStyle(x).animationName !== 'none')), 'hand glyphs are CSS-animated');
  // restart its 1.5 s clock and tap at once (page setup on a slow machine can exceed 1.5 s)
  await page.evaluate(() => {
    window.__game.touch.showTutorial();
    const el = document.getElementById('gs-tutorial'), o = { pointerId: 77, pointerType: 'touch', clientX: 500, clientY: 400, bubbles: true };
    el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new PointerEvent('pointerup', o));
  });
  ok(await page.isVisible('#gs-tutorial'), 'tap before 1.5 s does not dismiss');
  await T.wait(1600);
  await shot(page, 'test/shots/gesture-tutorial.png');
  const t = await mark(page);
  await T.tap(2, 800, 400, 40); await T.wait(300);
  ok(!await page.isVisible('#gs-tutorial'), 'tap after 1.5 s dismisses');
  ok(await count(page, 'player:jump', t) === 0, 'the dismissing tap does not reach the game');
  ok(await page.evaluate(() => window.__game.state.settings.gestureTutorialSeen === true), 'gestureTutorialSeen persisted in settings');
  await page.evaluate(() => window.__game.touch.showTutorial());
  ok(await page.isVisible('#gs-tutorial'), 'touch.showTutorial() reopens it (Controls card)');
  await T.wait(1600); await T.tap(2, 800, 400, 40); await T.wait(100);
  ok(!await page.isVisible('#gs-tutorial'), 'reopened tutorial dismisses');
  await page.reload();
  await page.waitForFunction(() => window.__game && document.getElementById('btn-play'));
  await page.tap('#btn-play'); await page.tap('#slot-1');
  await page.waitForFunction(() => window.__game.ready === true);
  await lowRes(page, true);
  await T.wait(200);
  ok(!await page.isVisible('#gs-tutorial'), 'not shown again after reload');
  ok(errors.length === 0, `no console errors${errors.length ? ':\n    ' + errors.join('\n    ') : ''}`);
  await context.close();
}

async function launch() {
  let browser = await chromium.launch();
  const probe = await browser.newPage();
  const gl = await probe.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
  await probe.close();
  if (!gl) { await browser.close(); console.log('(no WebGL in default headless: relaunching with SwiftShader)'); browser = await chromium.launch({ args: SWIFTSHADER }); }
  return browser;
}

const browser = await launch();
try {
  const only = process.env.ONLY || '';
  if (!only || only === 'tutorial') await tutorial(browser);
  if (!only || only === 'ipad') await run(browser, 'ipad', { width: 1080, height: 810 });
  if (!only || only === 'phone') await run(browser, 'phone', { width: 844, height: 390 });
} catch (err) {
  failures++; console.error('  ✘ test crashed:', err && err.stack || err);
} finally {
  await browser.close();
}
console.log(failures ? `\nFAILED (${failures} problem${failures > 1 ? 's' : ''})` : '\nALL GESTURE CHECKS PASSED');
process.exit(failures ? 1 : 0);
