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
  // §5.4: the desktop keeps the full HUD (no compact mode, every chip + the break-ring text on screen)
  const desk = await page.evaluate(() => ({
    compact: document.body.classList.contains('hud-compact'),
    chips: ['hud-stars', 'hud-coins', 'hud-zone', 'break-ring'].filter(id => { const e = document.getElementById(id); return !(e && e.offsetParent && getComputedStyle(e).opacity === '1'); }),
    ring: !!document.querySelector('#break-ring .ring-num').offsetParent,
  }));
  ok(!desk.compact && desk.chips.length === 0 && desk.ring, `desktop 1280x720: full HUD (no hud-compact, chips visible${desk.chips.length ? ', missing ' + desk.chips : ''}, ring text ${desk.ring})`);
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
  await page.evaluate(() => window.__game.plugins.objectives.debugHoldTimers(true));
  await page.evaluate(s => window.__game.teleport(s.x, s.y - 0.9, s.z), star);
  await page.waitForFunction(() => window.__game.log.some(e => e.type === 'pickup:star'), null, { timeout: 5000 }).catch(() => {});
  ok(await logHas(page, 'pickup:star'), 'standing on the hilltop star -> pickup:star');
  ok(await logHas(page, 'ui:celebrate', tStar), 'ui:celebrate emitted for the star');
  const celeText = await page.evaluate(() => window.__game.plugins.objectives.lastCelebration);
  const celeDom = await page.textContent('#quest-card .qc-cele-big').catch(() => '');
  ok(/Star 1 \/ 20/.test(celeText) && celeDom === celeText, `celebration card shown ("${celeText}")`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(root, 'test/shots/celebrate.png') });
  await page.evaluate(() => window.__game.plugins.objectives.debugHoldTimers(false));
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
  // regression: in the first second a keyboard / gamepad activation (click with detail 0, what
  // Enter / Space / menus.nav confirm produce) is ignored, and nothing is auto-focused
  const guard = await page.evaluate(() => new Promise(res => {
    window.__game.plugins.breaks.debugSetRemaining(1);
    const t1 = performance.now();
    const k = () => {
      const b = document.getElementById('btn-break-stop');
      if (!b) { if (performance.now() - t1 < 8000) requestAnimationFrame(k); else res(null); return; }
      const focused = document.activeElement && document.activeElement.id;
      b.click();                                    // synthetic activation, detail 0 (like Enter / pad A)
      res({ focused, ms: Math.round(performance.now() - t1), still: !!document.querySelector('#overlay .stretch'), mode: window.__game.game.mode });
    };
    k();
  }));
  await page.keyboard.press('Enter');               // nothing focused: a stray Enter does nothing
  await page.waitForTimeout(100);
  ok(guard && guard.focused !== 'btn-break-stop' && guard.still && guard.mode === 'paused' && await page.isVisible('#overlay .stretch'),
    `stretch card: nothing auto-focused, Enter / A in the first 1 s ignored (${JSON.stringify(guard)})`);
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

// Regressions from the fresh-eyes audit (desktop): malformed save, respawn fade vs Save & stop,
// "Great session!" leaking into another save, Skip on a Today's Quest star, ghost race vs Save & stop.
async function regressionPass(browser) {
  console.log('Regression pass (desktop)');
  const { context, page, errors } = await openPage(browser, { viewport: { width: 1280, height: 720 } });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const tapIntro = () => ev(() => { const el = document.querySelector('#quest-card .qc-intro'); if (el && !el.hidden) el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
  const start = async slot => { await ev(s => window.__game.start(s), slot); await page.waitForFunction(() => window.__game.ready === true); await page.waitForTimeout(150); await tapIntro(); await page.waitForTimeout(100); };

  // malformed save in slot 2 -> title still shows, slot 2 reads as empty, playable
  await ev(() => { for (const s of [1, 2, 3]) window.__game.state.clearSlot(s); localStorage.setItem('starhopper.save.2', JSON.stringify({ version: 1 })); });
  await page.reload();
  await page.waitForFunction(() => window.__game && document.getElementById('btn-play'), null, { timeout: 20000 });
  ok(await page.isVisible('#btn-play') && await page.isVisible('#title-slot-2'), 'malformed save: title screen still shows');
  ok(await ev(() => document.getElementById('title-slot-2').classList.contains('empty') && window.__game.state.listSlots()[1].empty === true), 'malformed save: slot 2 shows as empty');
  await page.click('#btn-play');
  ok(/New game/.test(await page.textContent('#slot-2')), 'malformed save: slot picker offers "New game" for slot 2');
  await page.click('#slot-2');
  await page.waitForFunction(() => window.__game.ready === true, null, { timeout: 15000 });
  ok(await ev(() => window.__game.state.data.stars.length === 0 && window.__game.game.mode === 'playing'), 'malformed save: slot 2 starts as a fresh game');
  await ev(() => { window.__game.saveAndStop(); for (const s of [1, 2, 3]) window.__game.state.clearSlot(s); window.__game.state.setSetting('gestureTutorialSeen', true); });

  // Save & stop during the respawn fade -> next session is not stuck behind a white screen
  await start(1);
  await ev(() => { const g = window.__game; g.respawn(); g.saveAndStop(); g.start(1); });
  await page.waitForTimeout(150); await tapIntro();
  await page.waitForTimeout(500);
  const fade = await ev(() => ({ on: document.getElementById('fade').classList.contains('on'), frozen: window.__game.player.frozen, respawn: !!window.__game.game.respawn }));
  ok(!fade.on && !fade.frozen && !fade.respawn, `respawn -> Save & stop -> start: no #fade.on, Pip not frozen (${JSON.stringify(fade)})`);
  const p0 = await pos(page);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(700); await page.keyboard.up('KeyW');
  ok(dist(p0, await pos(page)) > 1, 'Pip can move after that');

  // Skip on a Today's Quest star: swapped with the next non-quest star, not sent to the end
  const sk = await ev(() => {
    const ob = window.__game.plugins.objectives, q0 = ob.quest().stars, cur = ob.current(), next = ob.order().find(id => !q0.includes(id));
    const okSkip = ob.skip();
    const q1 = ob.quest().stars, order = ob.order();
    return { okSkip, wasQuest: q0.includes(cur), pos: order.indexOf(cur), q1, joined: q1.includes(next), stillIn: q1.includes(cur), saved: JSON.stringify(window.__game.state.data.todayQuest.stars) === JSON.stringify(q1) };
  });
  ok(sk.okSkip && sk.wasQuest && sk.pos >= 0 && sk.pos <= 3, `skipped quest star stays within the first 4 of order() (position ${sk.pos})`);
  ok(sk.q1.length === 3 && sk.joined && !sk.stillIn && sk.saved, `quest still has 3 stars (next non-quest star swapped in: ${sk.q1.join(',')})`);
  await page.waitForTimeout(1300); // let the "New goal!" toast go

  // ghost race running at Save & stop: the next session gets no "Try again?" toast
  const race = await ev(async () => {
    const g = window.__game, r = g.world.props.entities.find(e => e.type === 'race'), sp = r.startPad;
    g.teleport(sp.x, sp.y + 0.3, sp.z);
    const wait = (f, ms) => new Promise(res => { const t1 = performance.now(); const k = () => (f() || performance.now() - t1 > ms ? res(f()) : setTimeout(k, 50)); k(); });
    const running = await wait(() => r.running, 3000);
    const t0 = g.log.at(-1)?.t ?? 0;
    g.saveAndStop(); g.start(1);
    await new Promise(res => setTimeout(res, 300));
    return { running, still: r.running, tryAgain: g.log.some(e => e.t >= t0 && e.type === 'ui:toast' && /Try again/.test(e.payload.text)), timer: !document.getElementById('hud-timer').hidden };
  });
  await tapIntro();
  ok(race.running && !race.still && !race.tryAgain && !race.timer, `race cancelled by Save & stop / load: no "Try again?" toast, timer hidden (${JSON.stringify(race)})`);

  // reveal toasts are short (<= 5 words)
  const rv = await ev(() => {
    const g = window.__game, t0 = g.log.at(-1)?.t ?? 0;
    g.world.props.giftCoins(100, 'meadow');
    return g.log.filter(e => e.t >= t0 && e.type === 'ui:toast').map(e => e.payload.text);
  });
  const longT = rv.filter(x => x.split(/\s+/).filter(w => /\w/.test(w)).length > 5);
  ok(rv.some(x => /Bonus star/.test(x)) && longT.length === 0, `reveal toasts <= 5 words (${rv.join(' | ')})`);
  await ev(() => { window.__game.saveAndStop(); for (const s of [1, 2, 3]) window.__game.state.clearSlot(s); });

  // "Great session!" pending at Save & stop must not show in another save; it shows once back in its own
  await start(2);
  await ev(async () => {
    const g = window.__game, q = g.plugins.objectives.quest();
    for (const id of q.stars) { const s = g.world.findPickup(id); s.revealed = true; g.collect(id); }
    g.pause();                                        // paused during the celebration
    await new Promise(r => setTimeout(r, 3200));      // the 2.5 s celebration ends while paused
    g.saveAndStop();
  });
  await start(3);                                     // a different, fresh save
  await ev(() => { window.__game.pause(); window.__game.resume(); });
  await page.waitForTimeout(400);
  ok(await ev(() => window.__game.menus.screen !== 'great' && !document.getElementById('btn-keep-going') && window.__game.game.mode === 'playing'), 'no "Great session!" card in a different save after Save & stop');
  await ev(() => window.__game.saveAndStop());
  await start(2);
  await page.waitForSelector('#btn-keep-going', { timeout: 4000 }).catch(() => {});
  ok(await page.isVisible('#btn-keep-going'), 'back in the original save: "Great session!" shows');
  await page.click('#btn-keep-going');
  await ev(() => { window.__game.pause(); window.__game.resume(); });
  await page.waitForTimeout(400);
  ok(await ev(() => window.__game.menus.screen !== 'great' && window.__game.game.mode === 'playing' && window.__game.state.data.todayQuest.celebrated === true), '...and only once (celebrated saved when shown)');
  await ev(() => { window.__game.saveAndStop(); for (const s of [1, 2, 3]) window.__game.state.clearSlot(s); });

  ok(errors.length === 0, `no console errors${errors.length ? ':\n    ' + errors.join('\n    ') : ''}`);
  await context.close();
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
  const ring = await page.evaluate(() => { const r = document.getElementById('break-ring'), b = r.getBoundingClientRect(); return { vis: !!r.offsetParent, x: b.left, y: b.bottom, w: b.width, h: b.height, txt: !!r.querySelector('.ring-num').offsetParent }; });
  ok(ring.vis && ring.x < 40 && ring.y > viewport.height - 40 && ring.w <= 34 && ring.h <= 34 && !ring.txt, `compact HUD: break ring is a ${Math.round(ring.w)} px ring bottom-left with no text (${JSON.stringify(ring)})`);
  const qbb = await page.locator('#quest-card').boundingBox();
  ok(qbb && qbb.x >= 0 && qbb.x + qbb.width <= viewport.width && qbb.y >= 0, `quest card fits the screen (${qbb ? Math.round(qbb.width) : 0} px wide)`);
  await page.screenshot({ path: join(root, `test/shots/quest-${name}.png`) });
}

// §5.4 compact HUD: union of all visible HUD boxes <= 12 % of the screen, nothing in the central
// 60 % of the width below the top 60 px, nothing in the bottom 45 % except the break ring.
const hudBoxes = (page, controls = false) => page.evaluate(controls => {
  const vis = e => { // rendered, not transparent (opacity through the ancestors), not visibility:hidden
    if (!e.getClientRects().length) return false;
    const cs = getComputedStyle(e); if (cs.visibility !== 'visible') return false;
    for (let n = e; n && n !== document.body; n = n.parentElement) if (+getComputedStyle(n).opacity < 0.05) return false;
    return true;
  };
  const skip = new Set(['hud', 'fp-layer']);
  const els = [...document.querySelectorAll(controls ? '#gs-jump, #gs-stick .gs-ring' : '#hud *, #quest-card, #quest-card *, #toast, #fp-layer *, #rotate-hint')]
    .filter(e => !skip.has(e.id) && !e.classList.contains('hud-left') && !e.classList.contains('hud-right') && !(e.closest('svg') && e.tagName !== 'svg') && vis(e));
  return els.map(e => { const r = e.getBoundingClientRect(); return { id: e.id || e.className.baseVal || e.className || e.tagName, l: r.left, t: r.top, r: r.right, b: r.bottom, ring: !!e.closest('#break-ring'),
    control: !!e.closest('#touch-controls') }; })
    .filter(b => b.r > b.l && b.b > b.t);
}, controls);
function unionArea(boxes, W, H) { // exact area of a union of rectangles (coordinate compression)
  const cl = b => ({ l: Math.max(0, b.l), t: Math.max(0, b.t), r: Math.min(W, b.r), b: Math.min(H, b.b) });
  const bs = boxes.map(cl).filter(b => b.r > b.l && b.b > b.t);
  const xs = [...new Set(bs.flatMap(b => [b.l, b.r]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i], x1 = xs[i + 1], iv = bs.filter(b => b.l <= x0 && b.r >= x1).map(b => [b.t, b.b]).sort((a, b) => a[0] - b[0]);
    let len = 0, cs = -1, ce = -1;
    for (const [a, c] of iv) { if (a > ce) { if (ce > cs) len += ce - cs; cs = a; ce = c; } else ce = Math.max(ce, c); }
    if (ce > cs) len += ce - cs;
    area += len * (x1 - x0);
  }
  return area;
}
const footprints = {};
async function hudFootprint(page, name, viewport) {
  const W = viewport.width, H = viewport.height;
  ok(await page.evaluate(() => document.body.classList.contains('hud-compact')), `${name}: compact HUD active (body.hud-compact)`);
  // at rest: >= 2.5 s after start with nothing changing (any peek / toast has faded)
  await page.waitForFunction(() => !document.querySelector('#hud .peek') && !document.querySelector('#toast.show') && document.querySelector('#quest-card').className === 'qc-objective', null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  const boxes = await hudBoxes(page);
  const area = unionArea(boxes, W, H), pct = 100 * area / (W * H);
  footprints[name] = +pct.toFixed(2);
  ok(pct <= 12, `${name}: HUD footprint at rest ${pct.toFixed(2)} % of the screen (<= 12 %)`);
  const centre = boxes.filter(b => b.r > W * 0.2 && b.l < W * 0.8 && b.b > 60);
  ok(centre.length === 0, `${name}: nothing in x 20-80 % below the top 60 px${centre.length ? ' (' + centre.map(b => `${b.id}@${Math.round(b.l)},${Math.round(b.t)}`).join(' ') + ')' : ''}`);
  const low = boxes.filter(b => b.b > H * 0.55 && !b.ring);
  ok(low.length === 0, `${name}: nothing in the bottom 45 % except the break ring${low.length ? ' (' + low.map(b => b.id).join(' ') + ')' : ''}`);
  // §5.5 Simple layout: the Jump button + the stick's resting ring are the only other things allowed
  // in the bottom 45 %; they sit in the outer 20 % columns, never on the break ring or the quest card
  const ctl = await hudBoxes(page, true), simpleMode = await page.evaluate(() => window.__game.state.settings.moveMode !== 'pro');
  if (simpleMode) {
    const ids = ctl.map(b => b.id).sort().join(',');
    ok(ctl.length === 2 && /gs-jump/.test(ids) && /gs-ring/.test(ids), `${name}: Simple controls at rest = Jump button + stick ring (${ids})`);
    const ringBox = boxes.find(b => b.ring && b.id === 'break-ring') || boxes.find(b => b.ring);
    const hit = (a, b) => a && b && !(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t);
    const qc = boxes.filter(b => /quest-card|qc-/.test(String(b.id)));
    ok(ctl.every(b => b.t >= H * 0.55 - 1 && (b.r <= W * 0.2 + 1 || b.l >= W * 0.8 - 1)), `${name}: Jump button + stick ring sit in the bottom 45 %, outer columns (${ctl.map(b => `${b.id}@${Math.round(b.l)},${Math.round(b.t)}-${Math.round(b.r)},${Math.round(b.b)}`).join(' ')})`);
    ok(ctl.every(b => !hit(b, ringBox)) && ctl.every(b => !qc.some(q => hit(b, q))), `${name}: Jump button / stick ring overlap neither the break ring nor the quest card`);
    const ctlPct = 100 * unionArea(ctl, W, H) / (W * H);
    ok(ctlPct <= 8, `${name}: Simple controls at rest cover ${ctlPct.toFixed(2)} % of the screen (<= 8 %)`);
    footprints[name + '+controls'] = +(100 * unionArea([...boxes, ...ctl], W, H) / (W * H)).toFixed(2);
  } else ok(ctl.length === 0, `${name}: Pro layout has no on-screen controls at rest (${ctl.map(b => b.id)})`);
  const persistent = await page.evaluate(() => [...document.querySelectorAll('.hud-left > *')].filter(e => e.offsetParent && getComputedStyle(e).opacity !== '0').map(e => e.id));
  ok(persistent.join() === 'hud-stars', `${name}: only the star chip stays on the left (${persistent.join(',')})`);
  const sizes = await page.evaluate(() => {
    const r = id => document.getElementById(id).getBoundingClientRect();
    const skip = r('btn-skip'), fm = r('focus-meter'), qc = document.querySelector('#quest-card > .qc-obj').getBoundingClientRect();
    return { btn: [r('btn-pause').width, r('btn-focus').width], op: getComputedStyle(document.getElementById('btn-pause')).opacity,
      skip: [skip.width, skip.height], fm: fm.width, fmGap: qc.left - fm.right, fmMid: Math.abs((fm.top + fm.bottom) / 2 - (qc.top + qc.bottom) / 2),
      qcW: qc.width, qcH: qc.height, font: parseFloat(getComputedStyle(document.querySelector('#quest-card .qc-text')).fontSize) };
  });
  ok(sizes.btn.every(w => w === 44) && sizes.op === '0.7', `${name}: pause + focus icons 44 px at 70 % opacity (${sizes.btn}, ${sizes.op})`);
  ok(sizes.skip[0] >= 44 && sizes.skip[1] >= 44, `${name}: Skip chevron tap target >= 44 px (${sizes.skip.map(Math.round)})`);
  ok(sizes.fm <= 34 && sizes.fmGap >= 0 && sizes.fmGap <= 6 && sizes.fmMid <= 2, `${name}: focus sun ${sizes.fm} px attached to the card's left edge (gap ${sizes.fmGap.toFixed(1)} px)`);
  ok(sizes.qcH <= 48 && sizes.font >= 20, `${name}: quest card is one line (${Math.round(sizes.qcH)} px tall, ${sizes.font} px text)`);
  if (H <= 500) ok(sizes.qcW <= W * 0.6 + 1 && sizes.font === 20, `${name}: phone card <= 60 % wide (${Math.round(sizes.qcW)} px) with 20 px text`);
  // a change peeks for 2.5 s, then fades: collect a coin, then enter a zone
  await page.evaluate(() => { const c = window.__game.listPickups().find(p => p.type === 'coin'); window.__game.collect(c.id); });
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => { const e = document.getElementById('hud-coins'); return e.classList.contains('peek') && !!e.offsetParent; }), `${name}: coin chip slides in on a pickup`);
  await page.evaluate(() => window.__game.events.emit('zone:enter', { zone: 'hub', name: 'Treehouse Hub' }));
  await page.waitForTimeout(400);
  const zb = await page.evaluate(() => { const z = document.getElementById('hud-zone'), q = document.querySelector('#quest-card > .qc-obj').getBoundingClientRect(), b = z.getBoundingClientRect();
    return { vis: z.classList.contains('peek') && z.getClientRects().length > 0, below: b.top >= q.bottom, cx: Math.abs((b.left + b.right) / 2 - innerWidth / 2), h: b.height }; });
  ok(zb.vis && zb.below && zb.cx < 2 && zb.h <= 40, `${name}: zone name is a one-line banner under the quest card (${JSON.stringify(zb)})`);
  await page.waitForTimeout(2500);
  ok(await page.evaluate(() => !document.querySelector('#hud .peek') && !document.getElementById('hud-coins').offsetParent && !document.getElementById('hud-zone').getClientRects().length), `${name}: coin chip + zone banner gone after 2.5 s`);
  await page.screenshot({ path: join(root, `test/shots/hud-${name}.png`) });
}

async function touchPass(browser, name, viewport) {
  console.log(`Touch pass: ${name} (${viewport.width}x${viewport.height}, Simple layout: stick + Jump button + gestures)`);
  const { context, page, errors } = await openPage(browser, { viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const sleep = ms => page.waitForTimeout(ms);
  await page.tap('#btn-play');
  ok(await logHas(page, 'input:firstGesture'), 'first tap emitted input:firstGesture');
  await page.tap('#slot-1');
  await page.waitForFunction(() => window.__game.ready === true, null, { timeout: 15000 });
  ok(await page.isVisible('#touch-controls'), '#touch-controls visible');
  const gone = await page.evaluate(() => ['#touch-jump', '#touch-long', '#touch-pound'].filter(s => document.querySelector(s)));
  ok(gone.length === 0, `old Jump / Long / Pound buttons removed (${gone.join(',') || 'none left'})`);
  ok(await page.evaluate(() => window.__game.state.settings.moveMode) === 'simple', 'new player: moveMode is Simple by default');
  const jb = await page.evaluate(() => { const b = document.getElementById('gs-jump'), r = b.getBoundingClientRect(), cs = getComputedStyle(b);
    return { vis: !!b.offsetParent && cs.display !== 'none', w: r.width, h: r.height, op: +cs.opacity, right: innerWidth - r.right, bottom: innerHeight - r.bottom, txt: b.textContent }; });
  ok(jb.vis && jb.w === 88 && jb.h === 88 && Math.abs(jb.op - 0.55) < 0.01 && jb.bottom >= 16 && jb.txt === '⬆', `Simple: round Jump button visible bottom-right (${JSON.stringify(jb)})`);

  // CDP touch with explicit timestamps from a virtual clock (advanced by wait()): the gesture
  // recogniser reads event.timeStamp, so a slow software-GL frame can't stretch a tap into a hold.
  const cdp = await context.newCDPSession(page);
  const active = new Map();
  let vt = Date.now();
  const wait = async ms => { vt += ms; await sleep(ms); };
  const send = type => cdp.send('Input.dispatchTouchEvent', { type, timestamp: vt / 1000, touchPoints: [...active.values()].map(p => ({ ...p, radiusX: 4, radiusY: 4, force: 1 })) });
  const down = async (id, x, y) => { const n = Date.now(); if (!active.size || n - vt > 3000) vt = Math.max(vt, n); active.set(id, { id, x, y }); await send('touchStart'); };
  const move = async (id, x, y) => { active.set(id, { id, x, y }); await send('touchMove'); };
  const up = async (...ids) => { for (const id of ids) active.delete(id); await send('touchEnd'); };
  const stroke = async (id, x, y, dx, dy, ms, steps) => {
    await down(id, x, y);
    for (let i = 1; i <= steps; i++) { await wait(ms / steps); await move(id, x + dx * i / steps, y + dy * i / steps); }
    await up(id);
  };
  const grounded = () => page.waitForFunction(() => window.__game.player.grounded && window.__game.player.mode === 'ground', null, { timeout: 5000 }).catch(() => {});

  // first touch play: the "How to move" overlay; dismissed by a tap after 1.5 s
  ok(await page.isVisible('#gs-tutorial'), 'first touch play shows the gesture tutorial');
  const caps = await page.$$eval('#gs-tutorial .gs-cap', n => n.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  ok(caps.length === 3 && /move/.test(caps[0]) && /⬆/.test(caps[1]) && /double jump/.test(caps[2]), `Simple tutorial: 3 cards (${caps.join(' | ')})`);
  await wait(1600);
  await down(9, viewport.width / 2, viewport.height / 2); await wait(40); await up(9);
  await wait(150);
  ok(!await page.isVisible('#gs-tutorial'), 'tutorial dismissed by a tap');
  await questCardLayout(page, name, viewport);
  await hudFootprint(page, name, viewport);
  await grounded(); await wait(200);

  // drag left = move
  const L = { x: viewport.width * 0.2, y: viewport.height * 0.65 }, R = { x: viewport.width * 0.72, y: viewport.height * 0.55 };
  const p0 = await pos(page);
  await down(1, L.x, L.y);
  for (let i = 1; i <= 6; i++) { await move(1, L.x, L.y - i * 12); await wait(16); }
  const stick = await page.evaluate(() => { const s = document.getElementById('gs-stick'), r = s.querySelector('.gs-ring').getBoundingClientRect(), k = s.querySelector('.gs-dot').getBoundingClientRect();
    return { on: s.classList.contains('on'), op: +getComputedStyle(s).opacity, ring: Math.round(r.width), knob: Math.round(k.width), cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 }; });
  ok(stick.on && stick.op > 0.5 && stick.ring === 110 && stick.knob === 50 && Math.abs(stick.cx - L.x) < 2 && Math.abs(stick.cy - L.y) < 2, `Simple: stick ring visible while dragging, where the thumb landed (${JSON.stringify(stick)})`);
  await page.waitForFunction(p => Math.hypot(window.__game.player.position.x - p.x, window.__game.player.position.z - p.z) >= 6, p0, { timeout: 8000 }).catch(() => {});
  await page.screenshot({ path: join(root, `test/shots/simple-${name}.png`) });
  await up(1); await wait(300);
  const p1 = await pos(page);
  ok(dist(p0, p1) >= 5, `drag on the left half moved Pip (${dist(p0, p1).toFixed(2)} m)`);
  await grounded();

  // tap right = jump
  let t = await nowT(page);
  await down(2, R.x, R.y); await wait(50); await up(2);
  await page.waitForFunction(s => window.__game.log.some(e => e.type === 'player:jump' && e.t >= s), t, { timeout: 4000 }).catch(() => {});
  ok(await logHas(page, 'player:jump', t), 'tap on the right half -> player:jump');
  await grounded(); await wait(200);

  // Jump button tap = jump (pressed state while the finger is down)
  const JB = await page.evaluate(() => { const r = document.getElementById('gs-jump').getBoundingClientRect(); return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; });
  t = await nowT(page);
  await down(6, JB.x, JB.y); await wait(30);
  const pressed = await page.evaluate(() => document.getElementById('gs-jump').classList.contains('pressed'));
  await wait(30); await up(6);
  await page.waitForFunction(s => window.__game.log.some(e => e.type === 'player:jump' && e.t >= s), t, { timeout: 4000 }).catch(() => {});
  ok(pressed && await logHas(page, 'player:jump', t), `Jump button tap -> player:jump (pressed state ${pressed})`);
  ok(await page.evaluate(() => !document.getElementById('gs-jump').classList.contains('pressed')), 'Jump button pressed state clears on lift');
  // second tap on the button while airborne = air double jump
  await page.waitForFunction(() => !window.__game.player.grounded && window.__game.player.velocity.y < 2, null, { timeout: 3000 }).catch(() => {});
  t = await nowT(page);
  await down(6, JB.x, JB.y); await wait(40); await up(6);
  await page.waitForFunction(s => window.__game.log.some(e => e.type === 'player:airjump' && e.t >= s), t, { timeout: 3000 }).catch(() => {});
  ok(await logHas(page, 'player:airjump', t), 'Jump button again in the air -> air double jump');
  await grounded();

  // swipe down in the air = ground pound
  // (slow time while airborne so the fall outlasts the swipe on a slow software-GL machine)
  // (from the open spawn lawn: Simple's faster run + jumps can leave Pip under a tree canopy)
  await page.evaluate(() => { const g = window.__game, sp = g.world.respawnPoint(); g.player.teleport(sp.x, sp.y, sp.z, 0); g.camera.snap(g.player.position, 0); });
  await grounded(); await wait(100);
  await page.evaluate(() => { const g = window.__game, p = g.player.position; g.setTimeScale(0.15); g.player.teleport(p.x, p.y + 7, p.z); g.player.sinceGround = 9; });
  await wait(60);
  t = await nowT(page);
  await stroke(2, R.x, R.y - 80, 0, 130, 60, 4);
  await page.waitForFunction(s => window.__game.log.some(e => e.type === 'player:poundstart' && e.t >= s), t, { timeout: 6000 }).catch(() => {});
  await page.evaluate(() => window.__game.setTimeScale(1));
  await page.waitForFunction(s => window.__game.log.some(e => e.type === 'player:groundpound' && e.t >= s), t, { timeout: 6000 }).catch(() => {});
  const gpDbg = await page.evaluate(s => JSON.stringify({ ev: window.__game.log.filter(e => e.t >= s && /^player|^input/.test(e.type)).map(e => e.type), p: window.__game.player.mode, y: +window.__game.player.position.y.toFixed(2), t: window.__game.touch.debug() }), t);
  ok(await logHas(page, 'player:groundpound', t), `swipe down while airborne -> player:groundpound${await logHas(page, 'player:groundpound', t) ? '' : ' ' + gpDbg}`);
  await grounded(); await wait(300);

  // swipe sideways while running = long jump (from the spawn, facing its open lawn)
  await page.evaluate(() => { const g = window.__game, sp = g.world.respawnPoint(); g.player.teleport(sp.x, sp.y, sp.z, 0); g.camera.snap(g.player.position, 0); });
  await grounded(); await wait(150);
  await down(1, L.x, L.y);
  for (let i = 1; i <= 6; i++) { await move(1, L.x, L.y - i * 12); await wait(16); }
  await page.waitForFunction(() => Math.hypot(window.__game.player.velocity.x, window.__game.player.velocity.z) > 6, null, { timeout: 5000 }).catch(() => {});
  t = await nowT(page);
  await stroke(2, R.x - 60, R.y, 140, 0, 60, 4);
  await wait(150);
  await up(1);
  await page.waitForFunction(s => window.__game.log.some(e => e.type === 'player:longjump' && e.t >= s), t, { timeout: 4000 }).catch(() => {});
  ok(await logHas(page, 'player:longjump', t), 'swipe sideways while running -> player:longjump');
  await grounded(); await wait(200);

  // slow drag on the right half = camera orbit
  const yaw0 = await page.evaluate(() => window.__game.camera.yaw);
  t = await nowT(page);
  await stroke(3, R.x, R.y, -180, 0, 900, 18);
  await wait(100);
  const yaw1 = await page.evaluate(() => window.__game.camera.yaw);
  ok(Math.abs(yaw1 - yaw0) > 0.2, `slow drag orbits the camera (Δyaw ${(yaw1 - yaw0).toFixed(2)})`);
  ok(!await logHas(page, 'player:jump', t) && !await logHas(page, 'player:longjump', t), 'slow drag fires no jump');
  await page.screenshot({ path: join(root, `test/shots/${name}.png`) });

  // Skip › on touch: first tap only arms it ("Skip? ✓"), a second tap within 2 s skips
  const g0 = await page.evaluate(() => window.__game.plugins.objectives.current());
  await page.tap('#btn-skip', { force: true }); // force: skip the actionability wait (2 s arm window vs. slow software GL)
  const armed = await page.evaluate(() => ({ cur: window.__game.plugins.objectives.current(), txt: document.getElementById('btn-skip').textContent }));
  ok(armed.cur === g0 && armed.txt === 'Skip? ✓', `touch Skip: first tap arms it ("${armed.txt}", goal unchanged)`);
  await page.tap('#btn-skip', { force: true }); // force: skip the actionability wait (2 s arm window vs. slow software GL)
  await wait(100);
  ok(await page.evaluate(g => window.__game.plugins.objectives.current() !== g && document.getElementById('btn-skip').textContent === 'Skip ›', g0), 'touch Skip: second tap within 2 s skips');

  // no pinch / double-tap zoom: gesturestart and a quick 2nd touchend off-controls are cancelled
  const zoom = await page.evaluate(() => {
    const c = document.getElementById('game');
    const gs = new Event('gesturestart', { cancelable: true, bubbles: true }); c.dispatchEvent(gs);
    const te = () => { const e = new TouchEvent('touchend', { cancelable: true, bubbles: true }); c.dispatchEvent(e); return e.defaultPrevented; };
    const first = te(), second = te();
    const b = document.getElementById('btn-pause'); const e1 = new TouchEvent('touchend', { cancelable: true, bubbles: true }); b.dispatchEvent(e1);
    const e2 = new TouchEvent('touchend', { cancelable: true, bubbles: true }); b.dispatchEvent(e2);
    return { gesture: gs.defaultPrevented, first, second, button: e2.defaultPrevented, css: getComputedStyle(document.body).touchAction };
  });
  ok(zoom.gesture && !zoom.first && zoom.second && !zoom.button && zoom.css === 'none', `zoom guards: gesturestart blocked, double-tap blocked off-controls, buttons untouched (${JSON.stringify(zoom)})`);

  // two-finger tap = pause
  t = await nowT(page);
  await down(4, R.x, R.y); await wait(30); await down(5, R.x + 90, R.y + 20);
  await wait(80); await up(4, 5);
  await page.waitForFunction(s => window.__game.log.some(e => e.type === 'game:pause' && e.t >= s), t, { timeout: 4000 }).catch(() => {});
  ok(await logHas(page, 'game:pause', t), 'two-finger tap -> game:pause');
  if (name === 'ipad') {
    // menu taps still work with the zoom guards: Settings button + a slider (tap near its right end)
    await page.tap('#btn-settings');
    ok(await page.isVisible('#overlay .settings'), 'iPad: tap opens Settings from the pause menu');
    const sl = await page.locator('#overlay .settings input[type=range]').first();
    const id = await sl.getAttribute('id'), v0 = Number(await sl.inputValue());
    const bb = await sl.boundingBox();
    const tx = v0 > 50 ? bb.x + 6 : bb.x + bb.width - 6;
    await down(7, tx, bb.y + bb.height / 2); await wait(60); await up(7);
    await wait(150);
    const v1 = Number(await page.inputValue(`#${id}`));
    ok(v1 !== v0, `iPad: tapping a Settings slider moves it (${id} ${v0} -> ${v1})`);
    await page.tap('#btn-settings-back');
    ok(await page.isVisible('#btn-resume'), 'iPad: tap on Back returns to the pause menu');
  }
  // Pro layout: gesture-only, no Jump button, half-screen stick zone
  await page.evaluate(() => window.__game.state.setSetting('moveMode', 'pro'));
  await page.waitForTimeout(100);
  const proUi = await page.evaluate(() => ({ btn: getComputedStyle(document.getElementById('gs-jump')).display, simple: window.__game.touch.simple, cls: document.getElementById('touch-controls').classList.contains('simple') }));
  ok(proUi.btn === 'none' && proUi.simple === false && !proUi.cls, `Pro: Jump button hidden, gesture-only layout (${JSON.stringify(proUi)})`);
  await page.evaluate(() => window.__game.state.setSetting('moveMode', 'simple'));
  await page.waitForTimeout(100);
  ok(await page.evaluate(() => getComputedStyle(document.getElementById('gs-jump')).display !== 'none'), 'back to Simple: Jump button shows again');
  if (name === 'phone') { // §5.4: a running challenge's chip takes the quest card's exact slot (nothing jumps)
    await page.evaluate(() => { if (window.__game.game.mode !== 'playing') window.__game.resume(); });
    await page.waitForTimeout(200);
    const slot = await page.evaluate(() => new Promise(res => {
      const g = window.__game, fp = g.plugins.focusplay, box = e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round); };
      const card = box(document.querySelector('#quest-card > .qc-obj'));
      const c = fp.challenges().find(x => x.starId === 'focus-gem-meadow');
      g.teleport(c.pad.x, c.pad.y + 0.5, c.pad.z); fp.debugStart('gem', 'meadow');
      setTimeout(() => { const chip = box(document.getElementById('fp-chip')); fp.debugClose(); res({ card, chip }); }, 600);
    }));
    const same = slot.chip.every((v, i) => Math.abs(v - slot.card[i]) <= 2);
    ok(same, `phone: challenge chip sits in the quest card's slot (card ${slot.card}, chip ${slot.chip})`);
  }
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
  if (!process.env.ONLY_TOUCH) { await desktopPass(browser);
  await regressionPass(browser); }
  await touchPass(browser, 'ipad', { width: 1080, height: 810 });
  await touchPass(browser, 'phone', { width: 844, height: 390 });
} catch (err) {
  failures++; console.error('  ✘ test crashed:', err && err.stack || err);
} finally {
  await browser.close();
}
if (Object.keys(footprints).length) console.log('HUD footprint at rest (% of screen):', JSON.stringify(footprints));
console.log(failures ? `\nFAILED (${failures} problem${failures > 1 ? 's' : ''})` : '\nALL SMOKE CHECKS PASSED');
process.exit(failures ? 1 : 0);
