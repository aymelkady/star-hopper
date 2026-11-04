// Movement-mode test (plain node + playwright), DESIGN.md §5.5.  Drives Pip's controller with
// synthetic actions in fixed 1/60 s physics steps (the main loop is paused with setTimeScale(0)),
// so every number is deterministic.  Simple: instant speed-up / stop, fixed 5 m jump, air double
// jump to 8.5 m, the towers-2 gap with tap + air-tap, step-up, touch auto-jump.  Pro: the old
// 1-2-3 combo still chains by timing and the jump height still depends on the hold.
// Exits 1 on any failed check or ANY console error / page error.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distFile = join(root, 'dist/star-hopper.html');
if (!existsSync(distFile)) { console.error('dist/star-hopper.html missing: run `npm run build` first'); process.exit(1); }
const SWIFTSHADER = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ✔' : '  ✘'} ${msg}`); if (!cond) failures++; };

async function launch() {
  let browser = await chromium.launch();
  const probe = await browser.newPage();
  const gl = await probe.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
  await probe.close();
  if (!gl) { await browser.close(); console.log('(no WebGL in default headless: relaunching with SwiftShader)'); browser = await chromium.launch({ args: SWIFTSHADER }); }
  return browser;
}

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 960, height: 600 } });
const page = await context.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));

try {
  await page.goto(pathToFileURL(distFile).href);
  await page.waitForFunction(() => window.__game && document.getElementById('btn-play'), null, { timeout: 20000 });
  ok(await page.evaluate(() => window.__game.state.settings.moveMode) === 'simple', 'fresh settings: moveMode defaults to simple');
  ok(await page.evaluate(() => window.__game.state.settings.autoJump) === true, 'fresh settings: autoJump defaults to on');
  await page.click('#btn-play'); await page.click('#slot-1');
  await page.waitForFunction(() => window.__game.ready === true, null, { timeout: 15000 });

  // ---- in-page harness ----
  await page.evaluate(() => {
    const g = window.__game, c = g.player, w = g.world, h = 1 / 60;
    g.setTimeScale(0);                       // main loop stops stepping physics; we step by hand
    g.plugins.objectives.debugHoldTimers && g.plugins.objectives.debugHoldTimers(true);
    if (g.plugins.focusplay && g.plugins.focusplay.freeze) try { g.plugins.focusplay.freeze.stop(); } catch (_) { /* optional */ }
    const ev = [];
    g.events.on('*', (type, p) => { if (type !== 'tick') ev.push({ type, p, n: H.n }); });
    const A = (o = {}) => ({
      move: { x: o.mx || 0, y: o.my || 0 }, jump: { pressed: !!o.jp, held: !!(o.jh || o.jp), released: false },
      longJump: { pressed: false, held: false }, pound: { pressed: false, held: false }, crouch: { held: false },
      device: o.device || 'keyboard',
    });
    const H = window.__mv = {
      n: 0, ev, A,
      step(o, yaw = Math.PI / 2) { H.n++; w.props.updatePlatforms(h); c.step(h, A(o), yaw); w.update(h, c, () => {}); },
      hs: () => Math.hypot(c.velocity.x, c.velocity.z),
      // teleport + settle onto the ground (facing -X: camera yaw π/2 makes "forward" = -X)
      unfreeze() { // a plugin may start a respawn fade (e.g. after the drop test): main loop is paused, so clear it here
        if (g.game.respawn) { g.game.respawn = null; document.getElementById('fade').classList.remove('on'); }
        c.frozen = false;
      },
      place(x, y, z) { H.unfreeze(); c.teleport(x, y, z, -Math.PI / 2); for (let i = 0; i < 40; i++) H.step({}); return c.grounded; },
      mode: m => g.state.setSetting('moveMode', m),
      since: (type, n) => ev.filter(e => e.type === type && e.n >= n),
    };
  });

  const RUN = { x: -9, y: 0.05, z: -54 }; // towers-2 runway (flat, x -6..-26.6, top y = 0)

  // ================= Simple =================
  console.log('Simple mode');
  const accel = await page.evaluate(r => {
    const H = window.__mv, c = window.__game.player;
    H.place(r.x, r.y, r.z);
    const up = []; for (let i = 0; i < 6; i++) { H.step({ my: 1 }); up.push(+H.hs().toFixed(2)); }
    const facing = c.facing;
    const down = []; for (let i = 0; i < 6; i++) { H.step({}); down.push(+H.hs().toFixed(2)); }
    return { up, down, facing, max: window.__game.TUNING && 8.5 };
  }, RUN);
  const stepsTo95 = accel.up.findIndex(v => v >= 0.95 * 8.5) + 1;
  const stepsToStop = accel.down.findIndex(v => v < 0.3) + 1;
  ok(stepsTo95 > 0 && stepsTo95 <= 4, `speed ≥ 95 % of 8.5 m/s within 4 steps (${stepsTo95} steps = ${(stepsTo95 / 60 * 1000).toFixed(0)} ms; ${accel.up.join(', ')})`);
  ok(Math.max(...accel.up) <= 8.5 + 1e-6, `constant walk speed, no overshoot (max ${Math.max(...accel.up)} m/s)`);
  ok(stepsToStop > 0 && stepsToStop <= 4, `speed < 0.3 m/s within 4 steps of release (${stepsToStop} steps; ${accel.down.join(', ')})`);
  ok(Math.abs(Math.atan2(Math.sin(accel.facing + Math.PI / 2), Math.cos(accel.facing + Math.PI / 2))) < 1e-3, `facing snaps to the input direction on the first step (${accel.facing.toFixed(3)})`);

  const turn = await page.evaluate(r => {
    const H = window.__mv, c = window.__game.player;
    H.place(r.x, r.y, r.z);
    for (let i = 0; i < 10; i++) H.step({ my: 1 });
    const out = []; for (let i = 0; i < 4; i++) { H.step({ my: -1 }); out.push(+c.velocity.x.toFixed(2)); }
    return { out, skid: c.skidding };
  }, RUN);
  ok(turn.out.at(-1) > 8 && !turn.skid, `instant reversal, no skid (vx over 4 steps: ${turn.out.join(', ')})`);

  const apex = await page.evaluate(r => {
    const H = window.__mv, c = window.__game.player;
    const jump = holdSteps => {
      H.place(r.x, r.y, r.z); const y0 = c.position.y; let top = y0;
      H.step({ jp: true }); for (let i = 1; i < 120; i++) { H.step({ jh: i < holdSteps }); top = Math.max(top, c.position.y); if (c.grounded && i > 5) break; }
      return +(top - y0).toFixed(3);
    };
    return { tap: jump(1), short: jump(4), hold: jump(60) };
  }, RUN);
  ok([apex.tap, apex.short, apex.hold].every(a => Math.abs(a - 5.0) <= 0.2), `tap-jump apex 5.0 ± 0.2 m regardless of hold (1 step ${apex.tap}, 4 steps ${apex.short}, 1 s ${apex.hold})`);

  const dbl = await page.evaluate(r => {
    const H = window.__mv, c = window.__game.player;
    const run = when => { // when: 'apex' | steps after take-off
      H.place(r.x, r.y, r.z); const y0 = c.position.y; let top = y0, fired = false, n0 = H.n;
      H.step({ jp: true });
      for (let i = 1; i < 200; i++) {
        const press = !fired && (when === 'apex' ? c.velocity.y <= 0 : i === when);
        if (press) fired = true;
        H.step({ jp: press });
        top = Math.max(top, c.position.y); if (c.grounded && i > 5) break;
      }
      const j = H.since('player:jump', n0);
      return { apex: +(top - y0).toFixed(3), jumps: j.length, air: j.filter(e => e.p.air).length };
    };
    const third = (() => { // a third press in the air does nothing (one double jump per take-off)
      H.place(r.x, r.y, r.z); const n0 = H.n; H.step({ jp: true });
      for (let i = 1; i < 200; i++) { H.step({ jp: i === 15 || i === 30 }); if (c.grounded && i > 5) break; }
      return H.since('player:jump', n0).length;
    })();
    return { atApex: run('apex'), early: run(8), late: run(40), third };
  }, RUN);
  ok(Math.abs(dbl.atApex.apex - 8.5) <= 0.3 && dbl.atApex.air === 1, `tap + air-tap at the apex: ${dbl.atApex.apex} m (8.5 ± 0.3)`);
  ok(Math.abs(dbl.early.apex - 8.5) <= 0.3, `tap + early air-tap (8 steps in): ${dbl.early.apex} m (8.5 ± 0.3)`);
  ok(dbl.late.apex >= 6.5, `tap + late air-tap while falling still rises (${dbl.late.apex} m)`);
  ok(dbl.third === 2, `only one air jump per take-off (${dbl.third} jumps for 3 presses)`);

  const gap = await page.evaluate(() => {
    const H = window.__mv, g = window.__game, c = g.player;
    H.place(-12, 0.05, -54);
    const n0 = H.n; let state = 0, maxY = 0, tJump = null, tAir = null;
    for (let i = 0; i < 600; i++) {
      let jp = false;
      if (state === 0 && c.position.x <= -20.5) { jp = true; state = 1; tJump = +c.position.x.toFixed(2); }
      else if (state === 1 && !c.grounded && c.velocity.y <= 0.5) { jp = true; state = 2; tAir = +c.position.x.toFixed(2); }
      H.step({ my: 1, jp });
      maxY = Math.max(maxY, c.position.y);
      if (g.state.hasStar('towers-2')) break;
      if (c.position.y < -5) break;
    }
    return { jumpAt: tJump, airAt: tAir, y: +c.position.y.toFixed(2), x: +c.position.x.toFixed(2), maxY: +maxY.toFixed(2), star: g.state.hasStar('towers-2'),
      pickup: H.since('pickup:star', n0).some(e => e.p && (e.p.id === 'towers-2' || e.p.starId === 'towers-2')), steps: H.n - n0 };
  });
  ok(gap.star && gap.y > 6.8, `towers-2 "Triple-jump the gap" crossed with tap + air-tap (jump at x ${gap.jumpAt}, air-tap at x ${gap.airAt}, peak ${gap.maxY} m, star ${gap.star} at x ${gap.x} y ${gap.y}, ${gap.steps} steps)`);

  // towers-1 climb in Simple: every pillar of the climb up to the bell
  const climb = await page.evaluate(() => {
    const H = window.__mv, c = window.__game.player;
    const hop = (x0, z0, x1, z1, top0, top1, r1, r0) => {
      H.unfreeze(); c.teleport(x0, top0 + 0.05, z0); for (let i = 0; i < 30; i++) H.step({});
      const yaw = Math.atan2(-(x1 - x0), -(z1 - z0)); let jumped = false, airj = false;
      const needAir = top1 - top0 > 3.5;
      for (let i = 0; i < 300; i++) {
        const d = Math.hypot(x1 - c.position.x, z1 - c.position.z);
        let jp = false;
        if (!jumped && c.grounded && (d <= r1 + 2.4 || Math.hypot(c.position.x - x0, c.position.z - z0) >= r0 - 0.6)) { jumped = true; jp = true; }
        else if (needAir && jumped && !airj && !c.grounded && c.velocity.y <= 0) { airj = true; jp = true; }
        H.step({ my: d > 1.2 ? 1 : 0, jp }, yaw);
        if (jumped && c.grounded && i > 10) break;
      }
      return Math.abs(c.position.y - top1) < 0.3 ? 1 : +c.position.y.toFixed(1);
    };
    const steps = [[0, -49, 0, 8], [11, -57, 2.5, 2.2], [17, -63, 5, 2.2], [21, -70, 7.5, 2.2], [22, -78, 10.5, 2.2], [19, -86, 13.5, 2.2], [9, -91, 13.5, 2.2], [1, -94, 17.5, 3.5]];
    const res = [];
    for (let k = 1; k < steps.length; k++) res.push(hop(steps[k - 1][0], steps[k - 1][1], steps[k][0], steps[k][1], steps[k - 1][2], steps[k][2], steps[k][3], steps[k - 1][3]));
    return res;
  });
  ok(climb.every(v => v === 1), `towers bell climb: every pillar up to the bell reachable in Simple (${climb.map(v => (v === 1 ? '✓' : '✗' + v)).join(' ')})`);

  // step-up over a 0.4 m ledge without slowing; auto-jump onto a 1.0 m step (touch only)
  const steps = await page.evaluate(r => {
    const H = window.__mv, g = window.__game, c = g.player, col = g.world.col;
    const box = (x0, x1, top) => col.add({ kind: 'box', minX: x0, maxX: x1, minY: -0.5, maxY: top, minZ: -57, maxZ: -51 });
    const out = {};
    let b = box(-16, -14, 0.4);
    H.place(r.x, r.y, r.z); let minHs = 99, maxY = 0;
    for (let i = 0; i < 60; i++) { H.step({ my: 1 }); if (i > 4) minHs = Math.min(minHs, H.hs()); maxY = Math.max(maxY, c.position.y); if (c.position.x < -15) break; }
    out.step = { minHs: +minHs.toFixed(2), y: +c.position.y.toFixed(2), grounded: c.grounded, maxY: +maxY.toFixed(2) };
    col.remove(b);
    b = box(-24, -14, 1.0);
    const tryWalk = device => {
      H.place(r.x, r.y, r.z); const n0 = H.n; let firstAt = null;
      for (let i = 0; i < 150; i++) { H.step({ my: 1, device }); if (firstAt === null && H.since('player:autojump', n0).length) firstAt = +c.position.x.toFixed(2); if (c.position.x < -20 && c.grounded) break; }
      return { auto: H.since('player:autojump', n0).length, jumps: H.since('player:jump', n0).length, firstAt, y: +c.position.y.toFixed(2), x: +c.position.x.toFixed(2) };
    };
    out.touch = tryWalk('touch');
    out.keyboard = tryWalk('keyboard');
    g.state.setSetting('autoJump', false); out.off = tryWalk('touch'); g.state.setSetting('autoJump', true);
    col.remove(b);
    // toward a drop (runway side edge at z -57 over the abyss): no auto-jump before Pip falls
    H.unfreeze(); c.teleport(-12, 0.05, -54, Math.PI); for (let i = 0; i < 30; i++) H.step({});
    let n0 = H.n, fell = false;
    for (let i = 0; i < 120; i++) { H.step({ my: 1, device: 'touch' }, 0); if (!c.grounded && c.position.y < -0.5) { fell = true; break; } }
    out.drop = { auto: H.since('player:autojump', n0).length, jumps: H.since('player:jump', n0).length, fell };
    // toward the 7 m ledge wall at the runway end (too tall): no auto-jump
    H.place(-24, 0.05, -54); n0 = H.n;
    for (let i = 0; i < 90; i++) H.step({ my: 1, device: 'touch' });
    out.wall = { auto: H.since('player:autojump', n0).length, x: +c.position.x.toFixed(2), y: +c.position.y.toFixed(2) };
    return out;
  }, RUN);
  ok(steps.step.minHs >= 8.0 && Math.abs(steps.step.y - 0.4) < 0.05 && steps.step.grounded, `step-up: walks onto a 0.4 m ledge without slowing (min speed ${steps.step.minHs} m/s, y ${steps.step.y})`);
  ok(steps.touch.auto === 1 && Math.abs(steps.touch.y - 1.0) < 0.06, `auto-jump: touch walking into a 1.0 m step jumps once (at x ${steps.touch.firstAt}) and lands on it (y ${steps.touch.y})`);
  ok(steps.keyboard.auto === 0 && steps.keyboard.y < 0.1, `auto-jump is touch only: keyboard walk stays below (${JSON.stringify(steps.keyboard)})`);
  ok(steps.off.auto === 0, `auto-jump setting Off: no auto-jump (${JSON.stringify(steps.off)})`);
  ok(steps.drop.auto === 0 && steps.drop.jumps === 0 && steps.drop.fell, `auto-jump never fires toward a drop (${JSON.stringify(steps.drop)})`);
  ok(steps.wall.auto === 0, `auto-jump ignores walls taller than 1.6 m (${JSON.stringify(steps.wall)})`);

  // moving platform carry still works in Simple (the elevator)
  const carry = await page.evaluate(() => {
    const H = window.__mv, g = window.__game, c = g.player;
    const pl = g.world.props.platforms.find(p => p.id === 'elevator'); if (!pl) return null;
    const el = pl.col;
    const cx = (el.minX + el.maxX) / 2, cz = (el.minZ + el.maxZ) / 2;
    H.unfreeze(); c.teleport(cx, el.maxY + 0.05, cz); for (let i = 0; i < 20; i++) H.step({});
    const y0 = c.position.y, top0 = el.maxY;
    for (let i = 0; i < 120; i++) H.step({});
    return { frozen: c.frozen, mode: c.mode, gm: g.game.mode, dy: +(c.position.y - y0).toFixed(2), dTop: +(el.maxY - top0).toFixed(2), gap: +(c.position.y - el.maxY).toFixed(2) };
  });
  ok(carry && Math.abs(carry.dy - carry.dTop) < 0.15 && Math.abs(carry.gap) < 0.1, `moving platform carries Pip in Simple (${JSON.stringify(carry)})`);

  // Pro mode: no air jump
  const proAir = await page.evaluate(r => {
    const H = window.__mv, c = window.__game.player;
    H.mode('pro');
    H.place(r.x, r.y, r.z); const n0 = H.n; H.step({ jp: true });
    for (let i = 1; i < 200; i++) { H.step({ jp: i === 20, jh: true }); if (c.grounded && i > 5) break; }
    return H.since('player:jump', n0).length;
  }, RUN);
  ok(proAir === 1, `Pro: a press in the air is not a jump (${proAir} jump)`);

  // ================= Pro =================
  console.log('Pro mode');
  const pro = await page.evaluate(() => {
    const H = window.__mv, g = window.__game, c = g.player, col = g.world.col;
    H.mode('pro');
    const s = g.world.spawn;
    H.unfreeze(); c.teleport(s.x, s.y, s.z); for (let i = 0; i < 40; i++) H.step({});
    const p = c.position; let yaw = null;
    for (let k = 0; k < 16 && yaw === null; k++) { // clear flat 30 m runway (as in gestures.spec)
      const a = k * Math.PI / 8, dx = Math.sin(a), dz = Math.cos(a); let flat = true; const arr = [];
      for (let d = 1; d <= 30 && flat; d += 1) {
        const x = p.x + dx * d, z = p.z + dz * d;
        col.sphereContacts(x, p.y + 1.2, z, 0.7, arr);
        flat = !arr.some(q => q.depth > 1e-4) && Math.abs(col.groundHeight(x, z, p.y + 1) - p.y) < 0.25;
      }
      if (flat) yaw = a + Math.PI; // camera behind -> forward = direction a
    }
    if (yaw === null) return null;
    // apex: full hold vs. a short tap
    const jumpH = hold => { c.teleport(s.x, s.y, s.z); for (let i = 0; i < 40; i++) H.step({}, yaw); const y0 = c.position.y; let top = y0;
      H.step({ jp: true }, yaw); for (let i = 1; i < 120; i++) { H.step({ jh: i < hold }, yaw); top = Math.max(top, c.position.y); if (c.grounded && i > 5) break; } return +(top - y0).toFixed(2); };
    const full = jumpH(60), short = jumpH(3);
    // combo: run, jump, re-jump on each landing (within the 0.3 s window)
    c.teleport(s.x, s.y, s.z); for (let i = 0; i < 40; i++) H.step({}, yaw);
    const n0 = H.n; let jumps = 0;
    for (let i = 0; i < 400 && jumps < 3; i++) {
      const jp = i > 25 && c.grounded && c.mode === 'ground';
      if (jp) jumps++;
      H.step({ my: 1, jp, jh: true }, yaw);
    }
    for (let i = 0; i < 120 && !c.grounded; i++) H.step({ my: 1, jh: true }, yaw);
    // late re-jump (0.5 s after landing) resets to tier 1
    for (let i = 0; i < 30; i++) H.step({}, yaw);
    const n1 = H.n; H.step({ jp: true }, yaw);
    return { tiers: H.since('player:jump', n0).filter(e => e.n < n1).map(e => e.p.tier), late: H.since('player:jump', n1).map(e => e.p.tier), full, short };
  });
  ok(pro && pro.tiers.join() === '1,2,3', `Pro: jump on each landing chains tiers 1,2,3 (${pro && pro.tiers.join(',')})`);
  ok(pro && pro.late.join() === '1', `Pro: a jump after the combo window is tier 1 again (${pro && pro.late.join(',')})`);
  ok(pro && Math.abs(pro.full - 5.0) <= 0.2 && pro.short < 3.5, `Pro: variable height kept (held ${pro && pro.full} m, short tap ${pro && pro.short} m)`);
  await page.evaluate(() => { window.__mv.mode('simple'); window.__game.setTimeScale(1); });
  await page.waitForTimeout(300);
} catch (err) {
  failures++; console.error('  ✘ test crashed:', err && err.stack || err);
} finally {
  ok(errors.length === 0, `no console errors${errors.length ? ':\n    ' + errors.join('\n    ') : ''}`);
  await browser.close();
}
console.log(failures ? `\nFAILED (${failures} problem${failures > 1 ? 's' : ''})` : '\nALL MOVEMENT CHECKS PASSED');
process.exit(failures ? 1 : 0);
