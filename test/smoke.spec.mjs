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
  const qcText = (await page.textContent('#quest-card')).replace(/\s+/g, ' ').trim();
  ok(await page.isVisible('#quest-card') && qcText.length > 3, `quest card visible after start ("${qcText.slice(0, 60)}")`);
  ok(await page.evaluate(() => window.__game.plugins.objectives.introsShown === 1 && window.__game.plugins.objectives.quest().stars.length === 3), "Today's quest (3 stars) card shown on start");
  await page.evaluate(() => { const el = document.querySelector('#quest-card .qc-intro'); if (el && !el.hidden) el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); }); // tap (race-free vs. the 3 s auto-close)
  await page.waitForTimeout(200);
  const objText = (await page.textContent('#quest-card .qc-text')).trim();
  ok(await page.isVisible('#quest-card .qc-obj') && objText.length > 0, `quest card shows the objective after a tap ("${objText}")`);
  ok(await page.evaluate(() => window.__game.plugins.objectives.beacon.column.visible), 'beacon column visible');
  await page.screenshot({ path: join(root, 'test/shots/quest-hub.png') });

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
  ok(await logHas(page, 'ui:celebrate', tStar), 'ui:celebrate emitted for the star');
  const celeText = await page.evaluate(() => window.__game.plugins.objectives.lastCelebration);
  const celeDom = await page.textContent('#quest-card .qc-cele-big').catch(() => '');
  ok(/Star 1 \/ 15/.test(celeText) && celeDom === celeText, `celebration card shown ("${celeText}")`);
  await page.screenshot({ path: join(root, 'test/shots/celebrate.png') });
  await page.waitForFunction(t => window.__game.log.some(e => e.type === 'objective:changed' && e.t >= t && e.payload.starId !== 'meadow-1'), tStar, { timeout: 10000 }).catch(() => {});
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
  await uiChecks(page);
  const questBefore = await page.evaluate(() => JSON.stringify(window.__game.plugins.objectives.quest()));

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
  ok(await page.evaluate(() => window.__game.state.settings.breakMinutes) === 15, 'settings change (session length 15) persisted after reload');
  ok(await page.evaluate(q => JSON.stringify(window.__game.plugins.objectives.quest()) === q, questBefore), "Today's quest persisted after reload");
  await questFinale(page);

  ok(errors.length === 0, `no console errors${errors.length ? ':\n    ' + errors.join('\n    ') : ''}`);
  await context.close();
}

// Skip, focus mode, break timer + stretch break, settings, Today's Quest finale (desktop pass)
async function uiChecks(page) {
  const obj = () => page.evaluate(() => window.__game.plugins.objectives.current());
  const mode = () => page.evaluate(() => window.__game.game.mode);
  // Skip (Tab)
  const before = await obj(); let t = await nowT(page);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  const after = await obj();
  ok(after && after !== before && await page.evaluate(([t, id]) => window.__game.log.some(e => e.type === 'objective:changed' && e.t >= t && e.payload.starId === id), [t, after]),
    `Skip (Tab) advanced the objective ${before} -> ${after}`);
  t = await nowT(page);
  await page.click('#btn-skip');
  await page.waitForTimeout(150);
  ok(await obj() !== after && await logHas(page, 'objective:skipped', t), 'Skip button on the quest card advances too');

  // focus mode
  t = await nowT(page);
  await page.click('#btn-focus');
  await page.waitForTimeout(500);
  const fOn = await page.evaluate(t => window.__game.log.filter(e => e.type === 'focus:changed' && e.t >= t).map(e => e.payload.on), t);
  ok(fOn.at(-1) === true && await page.evaluate(() => document.getElementById('btn-focus').classList.contains('active')), 'focus toggle -> focus:changed {on:true} + #btn-focus.active');
  ok(await page.evaluate(() => window.__game.world.props.still === true && !document.querySelector('#hud-coins').offsetParent), 'focus mode: world still + coin chip hidden');
  await page.screenshot({ path: join(root, 'test/shots/focus.png') });
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => !document.getElementById('btn-focus').classList.contains('active') && window.__game.plugins.focus.isOn() === false), 'F turns focus mode off again');

  // break timer: warning at 1 min
  t = await nowT(page);
  await page.evaluate(() => window.__game.plugins.breaks.debugSetRemaining(61));
  await page.waitForFunction(t => window.__game.log.some(e => e.type === 'ui:warn' && e.t >= t && e.payload.minutes === 1), t, { timeout: 8000 }).catch(() => {});
  ok(await page.evaluate(t => window.__game.log.some(e => e.type === 'ui:warn' && e.t >= t && e.payload.minutes === 1), t), 'break timer: ui:warn {minutes:1} fires');
  ok(await page.evaluate(() => document.getElementById('break-ring').dataset.level === 'red'), 'break ring turns red in the last minute');
  // stretch break
  t = await nowT(page);
  await page.evaluate(() => window.__game.plugins.breaks.debugSetRemaining(1));
  await page.waitForSelector('#overlay .stretch', { timeout: 8000 }).catch(() => {});
  ok(await page.isVisible('#overlay .stretch') && await mode() === 'paused', 'stretch break card visible and game paused');
  ok(await logHas(page, 'break:start', t) && await page.evaluate(t => window.__game.log.some(e => e.type === 'save:written' && e.t >= t && e.payload.reason === 'break'), t), 'break:start + auto-save before the break');
  ok(!(await page.isVisible('#btn-break-play')) && await page.isVisible('#btn-break-stop'), 'only "Save & stop" during the 60 s');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ok(await mode() === 'paused' && await page.isVisible('#overlay .stretch'), 'Esc does not skip the stretch break');
  await page.screenshot({ path: join(root, 'test/shots/stretch.png') });
  await page.evaluate(() => window.__game.plugins.breaks.debugFinishStretch());
  await page.waitForSelector('#btn-break-play', { state: 'visible', timeout: 3000 }).catch(() => {});
  await page.click('#btn-break-play');
  await page.waitForTimeout(200);
  ok(await mode() === 'playing' && await logHas(page, 'break:end', t) && await page.evaluate(() => window.__game.plugins.breaks.remaining() > 1100), '"Play again" resumes with a fresh timer');
  await page.evaluate(() => window.__game.pause());
  const r0 = await page.evaluate(() => window.__game.plugins.breaks.remaining());
  await page.waitForTimeout(1200);
  ok(await page.evaluate(() => window.__game.plugins.breaks.remaining()) >= r0 - 0.05, 'pause menu does not use up break time');

  // settings (from the pause menu)
  await page.click('#btn-settings');
  ok(await page.isVisible('#overlay .settings'), 'Settings screen opens from the pause menu');
  const small = await page.evaluate(() => [...document.querySelectorAll('#overlay .settings button, #overlay .settings input')].filter(b => { const r = b.getBoundingClientRect(); return r.height < 44; }).length);
  ok(small === 0, `settings tap targets >= 44 px (${small} too small)`);
  t = await nowT(page);
  await page.click('#set-breakMinutes .seg-btn:nth-child(2)');
  ok(await page.evaluate(t => window.__game.log.some(e => e.type === 'settings:changed' && e.t >= t && e.payload.key === 'breakMinutes' && e.payload.value === 15), t), 'session length 15 -> settings:changed');
  await page.screenshot({ path: join(root, 'test/shots/settings.png') });
  await page.click('#btn-settings-back');
  ok(await page.isVisible('#btn-resume'), 'Settings Back returns to the pause menu');
  await page.click('#btn-resume');
  await page.waitForTimeout(100);

}

async function questFinale(page) {
  const mode = () => page.evaluate(() => window.__game.game.mode);
  // Today's quest finale: collect the other quest stars -> "Great session!"
  const quest = await page.evaluate(() => window.__game.plugins.objectives.quest());
  for (const id of quest.stars) await page.evaluate(id => window.__game.collect(id), id);
  await page.waitForSelector('#btn-keep-going', { timeout: 12000 }).catch(() => {});
  ok(await page.isVisible('#btn-keep-going') && await page.isVisible('#btn-quest-stop'), '"Great session!" card after the 3 quest stars');
  await page.screenshot({ path: join(root, 'test/shots/great-session.png') });
  await page.click('#btn-keep-going');
  await page.waitForTimeout(200);
  ok(await mode() === 'playing' && await page.isVisible('#quest-card .qc-obj'), '"Keep going" resumes with a new objective');
}

// phone / iPad: the quest card must not collide with HUD chips or touch controls
async function questCardLayout(page, name, viewport) {
  const qcOverlap = () => page.evaluate(() => {
    const hit = (a, b) => a.width && b.width && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    const card = document.querySelector('#quest-card').getBoundingClientRect();
    const els = [...document.querySelectorAll('.hud-left > *, .hud-right > *, #touch-controls button')].filter(e => e.offsetParent);
    return els.filter(e => hit(card, e.getBoundingClientRect())).map(e => e.id || e.className);
  });
  const ov1 = await qcOverlap();
  ok(ov1.length === 0, `quest card does not overlap HUD chips / touch controls ${ov1.join(',')}`);
  await page.evaluate(() => { const el = document.querySelector('#quest-card .qc-intro'); if (el && !el.hidden) el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); }); // tap (race-free vs. the 3 s auto-close)
  await page.waitForTimeout(200);
  const ov2 = await qcOverlap();
  ok(await page.isVisible('#quest-card .qc-obj') && ov2.length === 0, `quest card (objective look) does not overlap HUD chips / touch controls ${ov2.join(',')}`);
  ok(await page.evaluate(() => { const r = document.getElementById('break-ring'); return !!r.offsetParent && r.parentElement.classList.contains('hud-left'); }), 'break ring sits top-left under the chips on touch');
  const qbb = await page.locator('#quest-card').boundingBox();
  ok(qbb && qbb.x >= 0 && qbb.x + qbb.width <= viewport.width && qbb.y >= 0, `quest card fits the screen (${qbb ? Math.round(qbb.width) : 0} px wide)`);
  await page.screenshot({ path: join(root, `test/shots/quest-${name}.png`) });
}

async function touchPass(browser, name, viewport) {
  console.log(`Touch pass: ${name} (${viewport.width}x${viewport.height}, gestures only)`);
  const { context, page, errors } = await openPage(browser, { viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const sleep = ms => page.waitForTimeout(ms);
  await page.tap('#btn-play');
  ok(await logHas(page, 'input:firstGesture'), 'first tap emitted input:firstGesture');
  await page.tap('#slot-1');
  await page.waitForFunction(() => window.__game.ready === true, null, { timeout: 15000 });
  ok(await page.isVisible('#touch-controls'), '#touch-controls visible');
  const gone = await page.evaluate(() => ['#touch-jump', '#touch-long', '#touch-pound'].filter(s => document.querySelector(s)));
  ok(gone.length === 0, `Jump / Long / Pound buttons removed (${gone.join(',') || 'none left'})`);

  const cdp = await context.newCDPSession(page);
  const active = new Map();
  const send = type => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...active.values()].map(p => ({ ...p, radiusX: 4, radiusY: 4, force: 1 })) });
  const down = async (id, x, y) => { active.set(id, { id, x, y }); await send('touchStart'); };
  const move = async (id, x, y) => { active.set(id, { id, x, y }); await send('touchMove'); };
  const up = async id => { active.delete(id); await send('touchEnd'); };
  const stroke = async (id, x, y, dx, dy, ms, steps) => {
    await down(id, x, y);
    for (let i = 1; i <= steps; i++) { await sleep(ms / steps); await move(id, x + dx * i / steps, y + dy * i / steps); }
    await up(id);
  };
  const grounded = () => page.waitForFunction(() => window.__game.player.grounded && window.__game.player.mode === 'ground', null, { timeout: 5000 }).catch(() => {});

  // first touch play: the "How to move" overlay; dismissed by a tap after 1.5 s
  ok(await page.isVisible('#gs-tutorial'), 'first touch play shows the gesture tutorial');
  await sleep(1600);
  await down(9, viewport.width / 2, viewport.height / 2); await sleep(40); await up(9);
  await sleep(150);
  ok(!await page.isVisible('#gs-tutorial'), 'tutorial dismissed by a tap');
  await questCardLayout(page, name, viewport);
  await grounded(); await sleep(200);

  // drag left = move
  const L = { x: viewport.width * 0.2, y: viewport.height * 0.65 }, R = { x: viewport.width * 0.72, y: viewport.height * 0.55 };
  const p0 = await pos(page);
  await down(1, L.x, L.y);
  for (let i = 1; i <= 6; i++) { await move(1, L.x, L.y - i * 12); await sleep(16); }
  await sleep(1400);
  await up(1); await sleep(300);
  const p1 = await pos(page);
  ok(dist(p0, p1) >= 5, `drag on the left half moved Pip (${dist(p0, p1).toFixed(2)} m)`);
  await grounded();

  // tap right = jump
  let t = await nowT(page);
  await down(2, R.x, R.y); await sleep(50); await up(2);
  await page.waitForFunction(s => window.__game.log.some(e => e.type === 'player:jump' && e.t >= s), t, { timeout: 1000 }).catch(() => {});
  ok(await logHas(page, 'player:jump', t), 'tap on the right half -> player:jump');
  await grounded();

  // swipe down in the air = ground pound
  await page.evaluate(() => { const g = window.__game, p = g.player.position; g.player.teleport(p.x, p.y + 7, p.z); });
  await sleep(60);
  t = await nowT(page);
  await stroke(2, R.x, R.y - 80, 0, 130, 60, 4);
  await page.waitForFunction(s => window.__game.log.some(e => e.type === 'player:groundpound' && e.t >= s), t, { timeout: 3000 }).catch(() => {});
  ok(await logHas(page, 'player:groundpound', t), 'swipe down while airborne -> player:groundpound');
  await grounded(); await sleep(300);

  // swipe sideways while running = long jump
  await down(1, L.x, L.y);
  for (let i = 1; i <= 6; i++) { await move(1, L.x, L.y - i * 12); await sleep(16); }
  await page.waitForFunction(() => Math.hypot(window.__game.player.velocity.x, window.__game.player.velocity.z) > 6, null, { timeout: 2000 }).catch(() => {});
  t = await nowT(page);
  await stroke(2, R.x - 60, R.y, 140, 0, 60, 4);
  await sleep(150);
  await up(1);
  ok(await logHas(page, 'player:longjump', t), 'swipe sideways while running -> player:longjump');
  await grounded(); await sleep(200);

  // slow drag on the right half = camera orbit
  const yaw0 = await page.evaluate(() => window.__game.camera.yaw);
  t = await nowT(page);
  await stroke(3, R.x, R.y, -180, 0, 900, 18);
  await sleep(100);
  const yaw1 = await page.evaluate(() => window.__game.camera.yaw);
  ok(Math.abs(yaw1 - yaw0) > 0.2, `slow drag orbits the camera (Δyaw ${(yaw1 - yaw0).toFixed(2)})`);
  ok(!await logHas(page, 'player:jump', t) && !await logHas(page, 'player:longjump', t), 'slow drag fires no jump');
  await page.screenshot({ path: join(root, `test/shots/${name}.png`) });

  // two-finger tap = pause
  t = await nowT(page);
  await down(4, R.x, R.y); await sleep(30); await down(5, R.x + 90, R.y + 20);
  await sleep(60); await up(4); await sleep(20); await up(5);
  await page.waitForFunction(s => window.__game.log.some(e => e.type === 'game:pause' && e.t >= s), t, { timeout: 1000 }).catch(() => {});
  ok(await logHas(page, 'game:pause', t), 'two-finger tap -> game:pause');
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
