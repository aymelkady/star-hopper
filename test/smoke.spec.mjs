// Smoke test (plain node + playwright).  Desktop pass + iPad and phone touch passes.
// Fails (exit 1) on any assertion failure or ANY console error / page error.
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

if (!existsSync(distFile)) { console.error('dist/star-hopper.html missing: run `npm run build` first'); process.exit(1); }

async function openPage(browser, ctxOpts, label) {
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  await page.goto(URL_);
  await page.waitForFunction(() => window.__game && document.getElementById('btn-play'), null, { timeout: 20000 });
  return { context, page, errors, label };
}
const logHas = (page, type, since = 0) => page.evaluate(([t, s]) => window.__game.log.some(e => e.type === t && e.t >= s), [type, since]);
const nowT = page => page.evaluate(() => (window.__game.log.at(-1)?.t ?? 0));
const pos = page => page.evaluate(() => { const p = window.__game.player.position; return { x: p.x, y: p.y, z: p.z }; });
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

async function desktopPass(browser) {
  console.log('Desktop pass (1280x720, keyboard)');
  const { context, page, errors } = await openPage(browser, { viewport: { width: 1280, height: 720 } });
  const webgl = await page.evaluate(() => window.__game.webgl);
  ok(webgl, 'WebGL context created');
  ok(await page.isVisible('#btn-play'), 'title screen shows Play');
  await page.click('#btn-play');
  await page.click('#slot-1');
  await page.waitForFunction(() => window.__game.ready === true, null, { timeout: 15000 });
  ok(true, 'game ready after Title -> Play -> slot 1');
  ok(await logHas(page, 'game:start'), 'game:start emitted');
  ok(await page.isVisible('#hud'), 'HUD visible');
  ok(await page.isVisible('#btn-pause') && await page.isVisible('#btn-focus'), 'on-screen pause + focus buttons visible');
  await page.waitForTimeout(300);

  const p0 = await pos(page);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(700);
  await page.keyboard.down('Space');
  await page.waitForTimeout(250);
  await page.keyboard.up('Space');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(400);
  const p1 = await pos(page);
  ok(dist(p0, p1) > 1.5, `Pip moved with W (${dist(p0, p1).toFixed(2)} m)`);
  ok(await logHas(page, 'player:jump'), 'player:jump fired on Space');
  ok(await logHas(page, 'player:land'), 'player:land fired');

  const coinId = await page.evaluate(() => window.__game.listPickups().find(p => p.type === 'coin').id);
  const got = await page.evaluate(id => window.__game.collect(id), coinId);
  ok(got && await logHas(page, 'pickup:coin'), `collect(${coinId}) -> pickup:coin`);

  const star = await page.evaluate(() => window.__game.listPickups().find(p => p.type === 'star' && p.id === 'meadow-1'));
  const tStar = await nowT(page);
  await page.evaluate(s => window.__game.teleport(s.x, s.y - 0.9, s.z), star);
  await page.waitForFunction(() => window.__game.log.some(e => e.type === 'pickup:star'), null, { timeout: 5000 }).catch(() => {});
  ok(await logHas(page, 'pickup:star'), 'standing on the hilltop star -> pickup:star');
  const obj = await page.evaluate(t => window.__game.log.filter(e => e.type === 'objective:changed' && e.t >= t).map(e => e.payload.starId), tStar);
  ok(obj.length > 0 && obj.at(-1) !== 'meadow-1', `objective advanced to ${obj.at(-1)}`);
  ok(await logHas(page, 'save:written'), 'save:written after star');
  const calls = await page.evaluate(() => window.__game.drawCalls());
  ok(calls > 0 && calls < 300, `draw calls < 300 (${calls})`);

  // fall off the world -> respawn within 1 s, coins kept
  const coinsBefore = await page.evaluate(() => window.__game.state.totalCoins());
  const tFall = await nowT(page);
  await page.evaluate(() => window.__game.teleport(0, -25, -60));
  const t0 = Date.now();
  await page.waitForFunction(t => window.__game.log.some(e => e.type === 'player:respawn' && e.t >= t), tFall, { timeout: 3000 }).catch(() => {});
  ok(await logHas(page, 'player:respawn', tFall) && Date.now() - t0 < 1500, `fall -> player:respawn (${Date.now() - t0} ms incl. polling)`);
  ok(await page.evaluate(() => window.__game.state.totalCoins()) === coinsBefore, 'coins kept after respawn');
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(root, 'test/last-run.png') });

  // reload: save must persist
  await page.reload();
  await page.waitForFunction(() => window.__game && document.getElementById('btn-play'));
  await page.click('#btn-play');
  const slotText = await page.textContent('#slot-1');
  ok(/★\s*1/.test(slotText), `slot 1 shows 1 star after reload ("${slotText.replace(/\s+/g, ' ').trim()}")`);
  await page.click('#slot-1');
  await page.waitForFunction(() => window.__game.ready === true);
  const persisted = await page.evaluate(id => ({ star: window.__game.state.data.stars.includes('meadow-1'), coin: window.__game.state.data.coinIds.includes(id) }), coinId);
  ok(persisted.star, 'star persisted after reload');
  ok(persisted.coin, 'collected coin persisted after reload');

  ok(errors.length === 0, `no console errors${errors.length ? ':\n    ' + errors.join('\n    ') : ''}`);
  await context.close();
}

async function touchPass(browser, name, viewport) {
  console.log(`Touch pass: ${name} (${viewport.width}x${viewport.height})`);
  const { context, page, errors } = await openPage(browser, { viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  await page.tap('#btn-play');
  ok(await logHas(page, 'input:firstGesture'), 'first tap emitted input:firstGesture');
  await page.tap('#slot-1');
  await page.waitForFunction(() => window.__game.ready === true, null, { timeout: 15000 });
  ok(await page.isVisible('#touch-controls'), '#touch-controls visible');
  for (const id of ['#touch-jump', '#touch-long', '#touch-pound']) {
    const bb = await page.locator(id).boundingBox();
    ok(bb && bb.width >= 64 && bb.height >= 64, `${id} >= 64 px (${bb ? Math.round(bb.width) : 0})`);
  }
  // touch buttons must not overlap HUD chips, HUD buttons or the quest card
  const overlap = await page.evaluate(() => {
    const r = s => document.querySelector(s).getBoundingClientRect();
    const hit = (a, b) => a.width && b.width && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    const btns = ['#touch-jump', '#touch-long', '#touch-pound'].map(r);
    const others = ['.hud-left', '.hud-right', '#quest-card'].map(r);
    return btns.some(b => others.some(o => hit(b, o)));
  });
  ok(!overlap, 'touch buttons do not overlap HUD / quest card');
  await page.waitForTimeout(300);

  const cdp = await context.newCDPSession(page);
  const touchEv = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(p => ({ x: p.x, y: p.y, id: p.id, radiusX: 4, radiusY: 4, force: 1 })) });
  const jb = await page.locator('#touch-jump').boundingBox();
  const jump = { x: jb.x + jb.width / 2, y: jb.y + jb.height / 2, id: 2 };
  const stick = { x: viewport.width * 0.2, y: viewport.height * 0.65, id: 1 };
  const p0 = await pos(page);
  await touchEv('touchStart', [stick]);
  for (let i = 1; i <= 6; i++) { await touchEv('touchMove', [{ ...stick, y: stick.y - i * 12 }]); await page.waitForTimeout(16); }
  const held = { ...stick, y: stick.y - 72 };
  await page.waitForTimeout(600);
  await touchEv('touchStart', [held, jump]);        // multi-touch: joystick + jump together
  await page.waitForTimeout(250);
  await touchEv('touchEnd', [held]);
  await page.waitForTimeout(500);
  await touchEv('touchEnd', []);
  await page.waitForTimeout(400);
  const p1 = await pos(page);
  ok(dist(p0, p1) > 1.5, `joystick moved Pip (${dist(p0, p1).toFixed(2)} m)`);
  ok(await logHas(page, 'player:jump'), 'Jump button -> player:jump (while holding the joystick)');

  // camera drag on the right half (away from the buttons)
  const yaw0 = await page.evaluate(() => window.__game.camera.yaw);
  const cam = { x: viewport.width * 0.7, y: viewport.height * 0.35, id: 3 };
  await touchEv('touchStart', [cam]);
  for (let i = 1; i <= 8; i++) { await touchEv('touchMove', [{ ...cam, x: cam.x - i * 15 }]); await page.waitForTimeout(16); }
  await touchEv('touchEnd', []);
  await page.waitForTimeout(200);
  const yaw1 = await page.evaluate(() => window.__game.camera.yaw);
  ok(Math.abs(yaw1 - yaw0) > 0.2, `camera drag orbits (Δyaw ${(yaw1 - yaw0).toFixed(2)})`);
  await page.screenshot({ path: join(root, `test/shots/${name}.png`) });
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
  await desktopPass(browser);
  await touchPass(browser, 'ipad', { width: 1080, height: 810 });
  await touchPass(browser, 'phone', { width: 844, height: 390 });
} catch (err) {
  failures++; console.error('  ✘ test crashed:', err && err.stack || err);
} finally {
  await browser.close();
}
console.log(failures ? `\nFAILED (${failures} problem${failures > 1 ? 's' : ''})` : '\nALL SMOKE CHECKS PASSED');
process.exit(failures ? 1 : 0);
