// Focus-play test (plain node + playwright): Focus Meter, Gem Rush, Two Things, Spot It, Freeze!,
// adaptivity, saves.  Desktop pass + iPad / phone layout passes.  Fails on ANY console error.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distFile = join(root, 'dist/star-hopper.html');
const URL_ = pathToFileURL(distFile).href;
const shot = name => join(root, `test/shots/focus-${name}.png`);
mkdirSync(join(root, 'test/shots'), { recursive: true });
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ✔' : '  ✘'} ${msg}`); if (!cond) failures++; };
const SWIFTSHADER = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
if (!existsSync(distFile)) { console.error('dist/star-hopper.html missing: run `npm run build` first'); process.exit(1); }

async function openPage(browser, ctxOpts) {
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  await page.goto(URL_);
  await page.waitForFunction(() => window.__game && document.getElementById('btn-play'), null, { timeout: 20000 });
  return { context, page, errors };
}
async function play(page) {
  await page.evaluate(() => window.__game.state.setSetting('gestureTutorialSeen', true)); // touch agent's one-time overlay
  await page.click('#btn-play'); await page.click('#slot-1');
  await page.waitForFunction(() => window.__game.ready === true, null, { timeout: 15000 });
  await page.evaluate(() => { const el = document.querySelector('#quest-card .qc-intro'); if (el && !el.hidden) el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
  await page.waitForTimeout(250);
  await page.evaluate(() => { const t = document.getElementById('gs-tutorial'); if (t) t.hidden = true; });
}
const FP = 'window.__game.plugins.focusplay';
const fp = (page, expr) => page.evaluate(`(() => ${FP}.${expr})()`);
const nowT = page => page.evaluate(() => (window.__game.log.at(-1)?.t ?? 0));
const since = (page, type, t) => page.evaluate(([y, s]) => window.__game.log.filter(e => e.type === y && e.t >= s).map(e => e.payload), [type, t]);
const waitEv = (page, type, t, ms = 6000, pred = 'true') => page.waitForFunction(([y, s, p]) => window.__game.log.some(e => e.type === y && e.t >= s && new Function('p', `return ${p}`)(e.payload)), [type, t, pred], { timeout: ms }).then(() => true).catch(() => false);
// stand 2 m from a challenge's start pad (close enough to keep its cards open, not on the pad)
const nearPad = (page, type, zone, f = 0) => page.evaluate(([t, z, f]) => {
  const c = window.__game.plugins.focusplay.challenges().find(c => c.type === t && (!z || c.zone === z));
  const g = window.__game, x = c.pad.x, zz = c.pad.z - 2, y = g.world.col.groundHeight(x, zz, c.pad.y + 2) + 0.1;
  g.player.teleport(x, y, zz, f); g.player.velocity.set(0, 0, 0); g.camera.snap(g.player.position, f); return true;
}, [type, zone, f]);
// from the hub spawn, stand 14 m before the current wayfinding target (the meadow entrance), facing it
async function towardTarget(page) {
  await place(page, 0, 14, Math.PI);
  await page.waitForTimeout(300);
  const tg = await page.evaluate(() => window.__game.plugins.objectives.target());
  const f = Math.atan2(tg.x - 0, tg.z - 14);
  await place(page, tg.x - Math.sin(f) * 14, tg.z - Math.cos(f) * 14, f);
  await page.waitForTimeout(200);
}
// put Pip on a spot facing yaw f (0 = +z, -PI/2 = -x), camera snapped behind him
const place = (page, x, z, f, lift = 0.1) => page.evaluate(([x, z, f, lift]) => {
  const g = window.__game, y = g.world.col.groundHeight(x, z, 30) + lift;
  g.player.teleport(x, y, z, f); g.player.velocity.set(0, 0, 0); g.camera.snap(g.player.position, f); return y;
}, [x, z, f, lift]);

async function desktopPass(browser) {
  console.log('Focus-play desktop pass (1280x720)');
  const { context, page, errors } = await openPage(browser, { viewport: { width: 1280, height: 720 } });
  await play(page);
  ok(await page.isVisible('#focus-meter'), 'Focus Meter sun visible next to the quest card');

  // ---- meter rises while walking toward the objective target ----
  const m0 = await fp(page, 'meter()');
  await towardTarget(page);
  await page.keyboard.down('KeyW');
  await page.waitForFunction(m => window.__game.plugins.focusplay.meter() > m + 1, m0, { timeout: 15000 }).catch(() => {});
  await page.keyboard.up('KeyW');
  const m1 = await fp(page, 'meter()');
  ok(m1 > m0 + 1, `meter rises while moving toward the objective (${m0.toFixed(1)} -> ${m1.toFixed(1)})`);

  // ---- drains after 25 s idle (time x20), never red ----
  await place(page, 0, 10, 0);
  await page.waitForTimeout(300);
  await fp(page, 'debugSetMeter(60)');
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('meter') });
  const ov = await page.evaluate(() => { const a = document.getElementById('focus-meter').getBoundingClientRect(), b = document.querySelector('#quest-card > .qc-obj').getBoundingClientRect(); return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top); });
  ok(!ov, 'meter does not overlap the quest card (desktop)');
  await page.evaluate(() => window.__game.setTimeScale(20));
  await page.waitForFunction(`${FP}.draining && ${FP}.meter() < 59`, null, { timeout: 25000 }).catch(() => {});
  const md = await fp(page, 'meter()');
  const dbg = await page.evaluate(() => `mode=${window.__game.game.mode} screen=${document.querySelector('#overlay')?.textContent.slice(0, 40)} v=${JSON.stringify(window.__game.player.velocity)}`);
  ok(md < 59 && await fp(page, 'draining'), `meter drains after 25 s with no progress (${md.toFixed(1)}) ${md < 59 ? '' : dbg}`);
  ok(await page.evaluate(() => document.getElementById('focus-meter').classList.contains('dim') && !/red/.test(document.getElementById('focus-meter').className)), 'draining sun dims (no red, no message)');
  await page.evaluate(() => window.__game.setTimeScale(1));
  await page.evaluate(() => { const fz = window.__game.plugins.focusplay.freeze; fz.stop(); fz.session(); }); // x20 time may have scheduled a real Freeze!
  ok((await since(page, 'focus:meter', 0)).length > 0, 'focus:meter events emitted');

  // ---- Focus Burst at 100 ----
  let t = await nowT(page);
  await fp(page, 'debugSetMeter(99)');
  await towardTarget(page);
  await page.keyboard.down('KeyW');
  const gotBurst = await waitEv(page, 'focus:burst', t, 15000);
  await page.keyboard.up('KeyW');
  ok(gotBurst, 'meter reaches 100 -> focus:burst');
  ok(await page.evaluate(() => window.__game.world.props.coinMultiplier === 2) && await fp(page, 'meter()') < 5, 'burst: coins x2 active, meter reset to 0');
  t = await nowT(page);
  const coinId = await page.evaluate(() => window.__game.listPickups().find(p => p.type === 'coin').id);
  await page.evaluate(id => window.__game.collect(id), coinId);
  ok((await since(page, 'pickup:coin', t)).some(p => p.value === 2), 'coin during a burst is worth 2');

  // ---- Gem Rush (meadow): pad -> rule card -> tap -> 3-2-1 -> 20 gems ----
  const meadow = (await fp(page, 'challenges()')).find(c => c.starId === 'focus-gem-meadow');
  await place(page, meadow.pad.x, meadow.pad.z, -Math.PI / 2);
  await page.waitForSelector('#fp-card.fp-rule', { timeout: 4000 }).catch(() => {});
  const rule = await page.evaluate(() => document.querySelector('#fp-card .fp-big')?.textContent);
  ok(rule === 'Grab blue, skip red', `stepping on the pad shows the rule card ("${rule}")`);
  await page.screenshot({ path: shot('rule') });
  t = await nowT(page);
  await page.click('#fp-go');
  ok(await page.isVisible('#fp-count'), '3-2-1 count shows after the tap');
  ok(await waitEv(page, 'challenge:start', t, 5000, "p.type === 'gem' && p.zone === 'meadow' && p.level === 1"), 'challenge:start {type:gem, zone:meadow, level:1}');
  for (let i = 0; i < 4; i++) await fp(page, 'debugHit()');
  await page.waitForFunction(`${FP}.course('gem', 'meadow').showing && ${FP}.course('gem', 'meadow').showing.red === false`, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(250);
  await page.screenshot({ path: shot('gem') });
  for (let i = 4; i < 20; i++) await fp(page, 'debugHit()');
  ok(await waitEv(page, 'challenge:end', t, 4000, "p.type === 'gem' && p.won === true && p.hits === 20 && p.total === 20"), 'debugHit x20 -> challenge:end {won:true, 20 / 20}');
  ok((await since(page, 'challenge:hit', t)).length >= 20, 'challenge:hit for every correct gem');
  ok(await waitEv(page, 'star:revealed', t, 2000, "p.id === 'focus-gem-meadow'"), 'Gem Rush star revealed (collectable)');
  await page.waitForTimeout(300);
  const winTxt = await page.evaluate(() => document.querySelector('#fp-card.fp-win')?.textContent.replace(/\s+/g, ' ').trim());
  ok(/You got 20 \/ 20/.test(winTxt || ''), `result card ("${winTxt}")`);
  await page.screenshot({ path: shot('result') });
  ok(await fp(page, "level('gem')") === 2, `adaptivity: gem level 1 -> ${await fp(page, "level('gem')")} after 10+ fast hits`);
  t = await nowT(page);
  await page.evaluate(() => window.__game.collect('focus-gem-meadow'));
  ok(await waitEv(page, 'pickup:star', t, 2000, "p.id === 'focus-gem-meadow'"), "collect('focus-gem-meadow') -> pickup:star");
  const hudStars = (await page.textContent('#hud-stars .val')).trim();
  ok(/^\d+ \/ 20$/.test(hudStars), `HUD star total is out of 20 ("${hudStars}")`);
  await fp(page, 'debugClose()');

  // ---- a 50 % run -> "Try again / Easier" ----
  await nearPad(page, 'gem', 'cove');
  t = await nowT(page);
  await fp(page, "debugStart('gem', 'cove')");
  for (let i = 0; i < 20; i++) await fp(page, i % 2 ? 'debugMiss()' : 'debugHit()');
  ok(await waitEv(page, 'challenge:end', t, 4000, "p.type === 'gem' && p.won === false && p.hits === 10"), '50 % run -> challenge:end {won:false, 10 / 20}');
  ok((await since(page, 'challenge:miss', t)).length === 10, 'challenge:miss for every wrong answer');
  await page.waitForTimeout(200);
  ok(await page.isVisible('#fp-retry') && await page.isVisible('#fp-easier'), '"Try again" + "Easier" offered (no loss)');
  await page.screenshot({ path: shot('retry') });
  await fp(page, 'debugClose()');

  // ---- Two Things + Spot It ----
  await nearPad(page, 'two', 'cove', Math.PI / 2);
  t = await nowT(page);
  await fp(page, "debugStart('two', 'cove')");
  for (let i = 0; i < 10; i++) await fp(page, 'debugHit()');
  ok(await waitEv(page, 'challenge:end', t, 4000, "p.type === 'two' && p.won === true"), 'Two Things: 10 greens -> won');
  await fp(page, 'debugClose()');
  const spot = (await fp(page, 'challenges()')).find(c => c.type === 'spot');
  await place(page, spot.pad.x, spot.pad.z + 1.5, Math.PI);
  t = await nowT(page);
  await fp(page, "debugStart('spot', 'towers')");
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot('spot') });
  for (let i = 0; i < 3; i++) await fp(page, 'debugHit()');
  ok(await waitEv(page, 'challenge:end', t, 4000, "p.type === 'spot' && p.won === true && p.hits === 3"), 'Spot It: 3 star crates -> won');
  await fp(page, 'debugClose()');

  // ---- Freeze! ----
  await place(page, 0, 10, Math.PI);
  await page.waitForTimeout(300);
  const coins0 = await page.evaluate(() => window.__game.state.totalCoins());
  t = await nowT(page);
  ok(await fp(page, 'debugFreeze()') === true && await waitEv(page, 'freeze:start', t, 1000), 'debugFreeze() -> freeze:start');
  await page.waitForFunction(`${FP}.freeze.phase === 'hold'`, null, { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(700);
  await page.screenshot({ path: shot('freeze') });
  ok(await waitEv(page, 'freeze:success', t, 12000), 'standing still for 2 s -> freeze:success');
  ok(await page.evaluate(() => window.__game.state.totalCoins()) >= coins0 + 5, 'coin shower: +5 coins');
  await page.waitForFunction(() => !window.__game.plugins.focusplay.freeze.active, null, { timeout: 8000 }).catch(() => {});
  await place(page, 0, 10, 0);
  t = await nowT(page);
  await fp(page, 'debugFreeze()');
  await page.waitForFunction(`${FP}.freeze.phase === 'hold'`, null, { timeout: 6000 }).catch(() => {});
  await page.keyboard.down('KeyW');
  const failed = await waitEv(page, 'freeze:fail', t, 8000);
  await page.keyboard.up('KeyW');
  const why = failed ? '' : await page.evaluate(t => `mode=${window.__game.game.mode} ph=${window.__game.plugins.focusplay.freeze.phase} ev=${window.__game.log.filter(e => e.t >= t && e.type !== 'focus:meter').map(e => e.type).join(',')}`, t);
  ok(failed, `moving during the ring -> freeze:fail (nothing lost) ${why}`);
  await page.waitForFunction(() => !window.__game.plugins.focusplay.freeze.active, null, { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => window.__game.state.setSetting('freezeEnabled', false));
  t = await nowT(page);
  ok(await fp(page, 'debugFreeze()') === false && !(await waitEv(page, 'freeze:start', t, 600)), 'freezeEnabled=false -> debugFreeze() does nothing');
  await page.evaluate(() => window.__game.state.setSetting('freezeEnabled', true));

  // ---- text rules on every card ----
  const textBad = await page.evaluate(() => {
    const bad = [];
    const P = window.__game.plugins.focusplay; P.debugStart('gem', 'towers', { card: true });
    for (const el of document.querySelectorAll('#fp-layer .fp-big, #fp-layer .fp-sub, #fp-layer .fp-hint, #fp-layer .fp-btn, #fp-layer .fz-big, #fp-layer .fz-sub')) {
      const fs = parseFloat(getComputedStyle(el).fontSize), words = el.textContent.trim().split(/\s+/).filter(w => /\w/.test(w)).length;
      if (fs < 20 || words > 6) bad.push(`${el.className}:${fs}px:${words}w`);
    }
    P.debugClose(); return bad;
  });
  ok(textBad.length === 0, `card text >= 20 px and <= 6 words per line ${textBad.join(' ')}`);

  // ---- save persists ----
  await page.evaluate(() => window.__game.state.save('test'));
  await page.reload();
  await page.waitForFunction(() => window.__game && document.getElementById('btn-play'));
  await play(page);
  const fsave = await page.evaluate(() => window.__game.state.data.focus);
  ok(fsave && fsave.levels && fsave.results['focus-gem-meadow']?.won === true && fsave.bursts >= 1 && Array.isArray(fsave.history.freeze), `save keeps the focus block (levels ${JSON.stringify(fsave && fsave.levels)})`);
  ok(await page.evaluate(() => window.__game.state.hasStar('focus-gem-meadow')) && await fp(page, "level('gem')") === fsave.levels.gem, 'challenge star + adaptivity level persisted after reload');
  ok(await page.evaluate(() => { const s = window.__game.world.findPickup('focus-two-cove'); return s.revealed && !s.collected; }), 'earned-but-not-collected star still waiting after reload');
  ok(errors.length === 0, `no console errors${errors.length ? ':\n    ' + errors.join('\n    ') : ''}`);
  await context.close();
}

async function layoutPass(browser, name, viewport) {
  console.log(`Focus-play layout pass: ${name} (${viewport.width}x${viewport.height}, touch)`);
  const { context, page, errors } = await openPage(browser, { viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  await play(page);
  await fp(page, 'debugSetMeter(60)');
  await page.waitForTimeout(1300); // dock check runs once a second
  const ov = await page.evaluate(() => {
    const hit = (a, b) => a.width && b.width && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    const m = document.getElementById('focus-meter').getBoundingClientRect();
    const els = [...document.querySelectorAll('#quest-card > div:not([hidden]), .hud-left > *, .hud-right > *, #touch-controls button, #touch-controls .tbtn')].filter(e => e.offsetParent);
    return { bad: els.filter(e => hit(m, e.getBoundingClientRect())).map(e => e.id || e.className), m: [m.left, m.top, m.width].map(Math.round) };
  });
  ok(ov.bad.length === 0 && ov.m[2] > 30, `meter does not overlap quest card / HUD chips / touch controls (at ${ov.m}) ${ov.bad.join(',')}`);
  ok(ov.m[0] >= 0 && ov.m[1] >= 0, 'meter is on screen');
  await page.screenshot({ path: shot(`meter-${name}`) });
  const fits = async what => page.evaluate(([w, h]) => {
    const el = [...document.querySelectorAll('#fp-card, #fp-freeze')].find(e => !e.hidden); if (!el) return 'none';
    const r = el.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= w && r.bottom <= h ? 'ok' : `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`;
  }, [viewport.width, viewport.height]);
  for (const [type, zone] of [['gem', 'meadow'], ['two', 'cove'], ['spot', 'towers']]) {
    await nearPad(page, type, zone);
    await page.evaluate(([t, z]) => window.__game.plugins.focusplay.debugStart(t, z, { card: true }), [type, zone]);
    await page.waitForTimeout(450);
    const r = await fits(); ok(r === 'ok', `${type} rule card fits the ${name} screen (${r})`);
    if (type === 'gem') await page.screenshot({ path: shot(`rule-${name}`) });
    await fp(page, 'debugClose()');
  }
  await nearPad(page, 'gem', 'meadow');
  await fp(page, "debugStart('gem', 'meadow')");
  for (let i = 0; i < 20; i++) await fp(page, i < 8 ? 'debugHit()' : 'debugMiss()');
  await page.waitForSelector('#fp-retry', { timeout: 3000 }).catch(() => {});
  const rr = await fits(); ok(rr === 'ok', `"Try again / Easier" card fits the ${name} screen (${rr})`);
  const small = await page.evaluate(() => [...document.querySelectorAll('#fp-card .fp-btn')].filter(b => b.getBoundingClientRect().height < 44).length);
  ok(small === 0, 'card buttons are >= 44 px tall');
  await page.screenshot({ path: shot(`retry-${name}`) });
  await fp(page, 'debugClose()');
  await fp(page, 'debugFreeze()');
  await page.waitForTimeout(500);
  const fr = await fits(); ok(fr === 'ok', `Freeze! card fits the ${name} screen (${fr})`);
  await page.screenshot({ path: shot(`freeze-${name}`) });
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
  await layoutPass(browser, 'ipad', { width: 1080, height: 810 });
  await layoutPass(browser, 'phone', { width: 844, height: 390 });
} catch (err) {
  failures++; console.error('  ✘ test crashed:', err && err.stack || err);
} finally {
  await browser.close();
}
console.log(failures ? `\nFAILED (${failures} problem${failures > 1 ? 's' : ''})` : '\nALL FOCUS-PLAY CHECKS PASSED');
process.exit(failures ? 1 : 0);
