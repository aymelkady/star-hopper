// Audio + FX test (plain node + playwright), same style as smoke.spec.mjs.
//  1. Default autoplay policy: AudioContext must NOT exist before a gesture, and must exist after
//     the first click (desktop) / tap (iPad emulation).  Gameplay feedback checks run here.
//  2. --autoplay-policy=no-user-gesture-required: still nothing before a gesture; after the first
//     click / tap the context is 'running'.
// Exits 1 on any failure or ANY console error / page error.
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
const AUTOPLAY = ['--autoplay-policy=no-user-gesture-required'];
const IPAD = { viewport: { width: 1080, height: 810 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 };
const DESKTOP = { viewport: { width: 1280, height: 720 } };

if (!existsSync(distFile)) { console.error('dist/star-hopper.html missing: run `npm run build` first'); process.exit(1); }

async function openPage(browser, ctxOpts) {
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  await page.goto(URL_);
  await page.waitForFunction(() => window.__game && window.__game.audio && window.__game.fx && document.getElementById('btn-play'), null, { timeout: 20000 });
  return { context, page, errors };
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const audioInfo = page => ev(page, () => { const a = window.__game.audio; return { has: !!a.ctx, state: a.ctx ? a.ctx.state : null, unlocked: a.unlocked }; });
const fxStats = page => ev(page, () => window.__game.fx.stats());
const sfx = page => ev(page, () => window.__game.audio.debugList());
const frames = (page, n = 2) => ev(page, k => new Promise(r => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

async function startGame(page, touch) {
  if (touch) { await page.tap('#btn-play'); await page.tap('#slot-1'); } else { await page.click('#btn-play'); await page.click('#slot-1'); }
  await page.waitForFunction(() => window.__game.ready === true, null, { timeout: 15000 });
  await page.waitForTimeout(300);
}
async function groundPound(page) {
  const t0 = await ev(page, () => window.__game.log.at(-1)?.t ?? 0);
  await ev(page, () => { const p = window.__game.player.position; window.__game.teleport(p.x, p.y + 5, p.z); });
  await page.waitForTimeout(180);
  await page.keyboard.press('KeyX');
  await page.waitForFunction(t => window.__game.log.some(e => e.type === 'player:groundpound' && e.t >= t), t0, { timeout: 4000 }).catch(() => {});
  return ev(page, t => window.__game.log.some(e => e.type === 'player:groundpound' && e.t >= t), t0);
}

// ---------------------------------------------------------------------------------------------
async function desktopGameplay(browser) {
  console.log('Desktop (default autoplay policy): gesture gating + feedback');
  const { context, page, errors } = await openPage(browser, DESKTOP);
  let a = await audioInfo(page);
  ok(!a.has && !a.unlocked, 'audio.ctx === null before any input');
  await page.waitForTimeout(1200);
  ok(!(await audioInfo(page)).has, 'still no AudioContext 1.2 s later without a gesture');
  ok(await ev(page, () => window.__game.drawCalls() > 0), 'scene renders');

  await startGame(page, false);
  a = await audioInfo(page);
  ok(a.has && a.unlocked, `AudioContext created on first click (state: ${a.state})`);

  // coin
  const coinId = await ev(page, () => window.__game.listPickups().find(p => p.type === 'coin').id);
  const before = await fxStats(page);
  await ev(page, id => window.__game.collect(id), coinId);
  const afterCount = await ev(page, () => window.__game.fx.count());
  const s1 = await fxStats(page);
  ok(afterCount > 0 && s1.spawned > before.spawned, `coin -> fx.count() rose (${afterCount}, +${s1.spawned - before.spawned} spawned)`);
  ok(s1.labels > before.labels, 'coin -> floating "+1" label');
  ok((await sfx(page)).includes('coin'), "coin -> audio.debugList() contains 'coin'");
  const coinSpawnNormal = s1.spawned - before.spawned;

  // star (teleport onto it)
  const star = await ev(page, () => window.__game.listPickups().find(p => p.type === 'star' && p.id === 'meadow-1'));
  const sfxBeforeStar = (await sfx(page)).length;
  await ev(page, s => window.__game.teleport(s.x, s.y - 0.9, s.z), star);
  await page.waitForFunction(() => window.__game.log.some(e => e.type === 'pickup:star'), null, { timeout: 5000 }).catch(() => {});
  const slow = await ev(page, () => window.__game.game.timeScale);
  const st = await fxStats(page);
  ok(st.confetti > 40, `star -> confetti count > 40 (${st.confetti})`);
  ok(st.particles >= 40, `star -> gold fountain particles (${st.particles})`);
  ok(slow < 1 && st.slowmos >= 1, `star -> brief slow-mo (timeScale ${slow})`);
  ok(st.flashes >= 1, 'star -> white flash');
  ok((await sfx(page)).includes('star'), 'star fanfare logged');
  await page.waitForTimeout(300);
  const starPlays = (await sfx(page)).slice(sfxBeforeStar).filter(n => n === 'star').length;
  ok(starPlays === 1, `one star pickup -> the star jingle plays exactly once (${starPlays})`);
  await page.waitForTimeout(160);
  await page.screenshot({ path: join(root, 'test/shots/fx-star.png') });
  await page.waitForTimeout(500);
  ok(await ev(page, () => window.__game.game.timeScale) === 1, 'timeScale back to 1 after slow-mo');

  // floating coin label shows the coin's value (Freeze! gift +5, Focus Burst coins +2)
  const gift = await ev(page, () => { window.__game.world.props.giftCoins(5, 'meadow'); return [...document.querySelectorAll('.fx-label')].map(e => e.textContent); });
  ok(gift.includes('+5'), `Freeze! coin shower label reads "+5" (${gift.filter(Boolean).join(' ')})`);

  // ground pound
  const sh0 = (await fxStats(page)).shakes;
  const camBefore = await ev(page, () => window.__game.renderer ? 1 : 0);
  ok(await groundPound(page), 'ground pound impact happened');
  await frames(page, 2);
  const sp = await fxStats(page);
  ok(sp.shakes > sh0 && sp.lastShake > 0 && camBefore, `pound -> camera shake (offset ${sp.lastShake.toFixed(3)} m)`);
  ok(sp.rings >= 1, 'pound -> shockwave ring');
  ok((await sfx(page)).includes('pound'), "pound -> 'pound' sfx");
  await page.screenshot({ path: join(root, 'test/shots/fx-pound.png') });
  ok(await ev(page, () => window.__game.drawCalls() < 300), 'draw calls still < 300');

  // squash & stretch reaches Pip
  await page.waitForTimeout(400);
  await page.keyboard.press('Space');
  await frames(page, 2);
  const py = (await fxStats(page)).stretchPeak;
  ok(py > 1.02, `jump -> Pip stretched (peak root.scale.y ${py.toFixed(2)})`);
  ok((await sfx(page)).includes('jump'), "jump -> 'jump' sfx");
  await page.waitForTimeout(900);

  // reduce motion
  await ev(page, () => window.__game.state.setSetting('reduceMotion', true));
  const coin2 = await ev(page, () => window.__game.listPickups().filter(p => p.type === 'coin')[3].id);
  const r0 = await fxStats(page);
  await ev(page, id => window.__game.collect(id), coin2);
  const r1 = await fxStats(page);
  const coinSpawnRM = r1.spawned - r0.spawned;
  ok(coinSpawnRM > 0 && coinSpawnRM < coinSpawnNormal, `reduceMotion -> fewer particles (${coinSpawnRM} < ${coinSpawnNormal})`);
  const star2 = await ev(page, () => window.__game.listPickups().find(p => p.type === 'star' && p.id !== 'meadow-1')?.id);
  const ts = await ev(page, id => { window.__game.collect(id); return window.__game.game.timeScale; }, star2);
  await frames(page, 3);
  const r2 = await fxStats(page);
  ok(ts === 1 && r2.timeScale === 1 && r2.slowmos === r1.slowmos, `reduceMotion -> no slow-mo on star (${star2}, timeScale ${r2.timeScale})`);
  ok(r2.flashes === r1.flashes, 'reduceMotion -> no white flash');
  await page.waitForTimeout(800);
  const shR = (await fxStats(page)).shakes;
  ok(await groundPound(page), 'ground pound (reduceMotion)');
  await frames(page, 2);
  ok((await fxStats(page)).shakes === shR, 'reduceMotion -> no camera shake');
  await ev(page, () => window.__game.state.setSetting('reduceMotion', false));

  // focus mode + celebrate events from the UI agent (tolerated / handled)
  await ev(page, () => window.__game.events.emit('focus:changed', { on: true }));
  await frames(page, 3);
  ok((await fxStats(page)).ambient === 0, 'focus mode -> ambient particles off');
  await ev(page, () => window.__game.events.emit('focus:changed', { on: false }));
  const cr0 = (await fxStats(page)).confettiSpawned;
  await ev(page, () => window.__game.events.emit('ui:celebrate', { kind: 'quest', name: 'Today' }));
  await page.waitForTimeout(600);
  ok((await fxStats(page)).confettiSpawned > cr0, 'ui:celebrate quest -> confetti rain');
  ok((await sfx(page)).includes('quest'), 'ui:celebrate quest -> quest fanfare');
  await ev(page, () => window.__game.events.emit('ui:warn', { minutes: 5 }));
  ok((await sfx(page)).includes('warn'), 'ui:warn -> gentle tones');
  await ev(page, () => { window.__game.events.emit('break:start', {}); window.__game.events.emit('break:end', {}); });
  ok((await sfx(page)).includes('breakstart'), 'break:start -> calm tones');
  ok(await ev(page, () => window.__game.audio.musicZone !== null), `music playing (${await ev(page, () => window.__game.audio.musicZone)})`);
  await ev(page, () => window.__game.state.setSetting('musicVolume', 0));
  await page.waitForTimeout(1800);
  ok(await ev(page, () => window.__game.audio.musicTracks === 0), 'musicVolume 0 -> scheduler stopped');
  await ev(page, () => window.__game.state.setSetting('musicVolume', 0.5));
  ok(await ev(page, () => window.__game.audio.musicTracks > 0), 'musicVolume back -> music restarts');
  // every sfx can play without throwing
  const all = await ev(page, () => { const a = window.__game.audio; return a.names.every(n => a.play(n, { tier: 3, index: 4, fallSpeed: 20 })); });
  ok(all, 'every sfx name plays without error');
  await page.waitForTimeout(400);

  ok(errors.length === 0, `no console errors${errors.length ? ':\n    ' + errors.join('\n    ') : ''}`);
  await context.close();
}

async function ipadGating(browser) {
  console.log('iPad emulation (default autoplay policy): first tap creates audio');
  const { context, page, errors } = await openPage(browser, IPAD);
  ok(!(await audioInfo(page)).has, 'audio.ctx === null before any tap');
  await startGame(page, true);
  const a = await audioInfo(page);
  ok(a.has && a.unlocked, `AudioContext created on first tap (state: ${a.state})`);
  const coinId = await ev(page, () => window.__game.listPickups().find(p => p.type === 'coin').id);
  await ev(page, id => window.__game.collect(id), coinId);
  await frames(page, 2); // fx.count() is refreshed by the particle update on the next rendered frame
  ok((await sfx(page)).includes('coin') && (await ev(page, () => window.__game.fx.count())) > 0, 'coin -> sound + particles on iPad');
  ok(errors.length === 0, `no console errors${errors.length ? ':\n    ' + errors.join('\n    ') : ''}`);
  await context.close();
}

async function runningState(browser, label, opts, touch) {
  console.log(`${label} (--autoplay-policy=no-user-gesture-required): running after gesture`);
  const { context, page, errors } = await openPage(browser, opts);
  await page.waitForTimeout(500);
  ok(!(await audioInfo(page)).has, 'no AudioContext before a gesture even when autoplay is allowed');
  if (touch) await page.tap('#btn-play'); else await page.click('#btn-play');
  await page.waitForFunction(() => window.__game.audio.ctx && window.__game.audio.ctx.state === 'running', null, { timeout: 4000 }).catch(() => {});
  const a = await audioInfo(page);
  ok(a.has && a.state === 'running', `AudioContext state 'running' after first ${touch ? 'tap' : 'click'} (${a.state})`);
  ok(errors.length === 0, `no console errors${errors.length ? ':\n    ' + errors.join('\n    ') : ''}`);
  await context.close();
}

async function launch(extra = []) {
  let browser = await chromium.launch({ args: extra });
  const probe = await browser.newPage();
  const gl = await probe.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
  await probe.close();
  if (!gl) { await browser.close(); browser = await chromium.launch({ args: [...SWIFTSHADER, ...extra] }); }
  return browser;
}

let b1 = null, b2 = null;
try {
  b1 = await launch();
  await desktopGameplay(b1);
  await ipadGating(b1);
  await b1.close(); b1 = null;
  b2 = await launch(AUTOPLAY);
  await runningState(b2, 'Desktop', DESKTOP, false);
  await runningState(b2, 'iPad', IPAD, true);
} catch (err) {
  failures++; console.error('  ✘ test crashed:', err && err.stack || err);
} finally {
  if (b1) await b1.close();
  if (b2) await b2.close();
}
console.log(failures ? `\nFAILED (${failures} problem${failures > 1 ? 's' : ''})` : '\nALL AUDIO/FX CHECKS PASSED');
process.exit(failures ? 1 : 0);
