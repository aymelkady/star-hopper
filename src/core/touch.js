/*
 * Touch layer (iPad / Android) — GESTURE-ONLY, no gameplay buttons (DESIGN.md §5.1).
 * Produces the same abstract inputs as keyboard/gamepad; input.js merges touch.state +
 * touch.takeLatch() into input.actions every physics step.
 *
 *   Left half : invisible dynamic stick (faint ring + dot fades in where the thumb lands).
 *               Once grabbed it keeps steering even if the thumb drifts onto the right half.
 *   Right half: per-pointer gesture recogniser
 *       tap          (lift < 180 ms, < 12 px)        -> jump (edge latched until consumed)
 *       swipe up     (≥ 40 px, ≥ 600 px/s)           -> jump (controller applies coyote/buffer)
 *       swipe down   (≥ 40 px, ≥ 600 px/s)           -> ground pound in the air / crouch held on ground
 *       swipe side   (|dx| ≥ 40 px, ≥ 600 px/s)      -> long jump while running (> 4 m/s), else ignored
 *       slow drag                                    -> camera orbit until lift
 *   Anywhere : two-finger tap (2 downs ≤ 120 ms apart, both up ≤ 250 ms, < 12 px) -> pause
 *   Mouse on a hybrid device: plain drag-orbit (unchanged behaviour).
 *
 * Decision: at 100 ms after touch-down OR as soon as travel ≥ 40 px, whichever comes first.
 * Once a pointer's gesture is decided it never changes until lift.
 *
 * DOM: #touch-controls > #gs-stick, .gs-fx pool.  CSS is injected (<style id="gs-style">).
 * Exports GESTURE_HELP for the Controls card; touch.showTutorial() opens the "How to move" overlay.
 * The first-play tutorial is NOT auto-shown here: systems/objectives.js owns the start-of-session
 * flow and calls touch.showTutorial({ firstPlay: true }) (tutorial first, then Today's Quest).
 * touch.onTutorialDismissed(fn) -> fn({ seen }) whenever the overlay closes (seen = tapped away).
 */
export const IS_TOUCH = typeof window !== 'undefined' &&
  (('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0);

export const GESTURE = {
  STICK_MAX: 60,        // px: full stick deflection
  STICK_DEAD: 8,        // px: stick dead zone
  STICK_RING: 96,       // px: visual ring diameter
  DECIDE_MS: 100,       // decide swipe vs drag this long after touch-down…
  SWIPE_DIST: 40,       // …or as soon as the finger has travelled this far
  SWIPE_SPEED: 600,     // px/s: peak speed (60 ms window) needed for a swipe
  FLICK_WAIT_MS: 220,   // a fast finger still short of 40 px at 100 ms may finish its swipe until here
  TAP_MS: 180,          // tap: lifted within…
  TAP_SLOP: 12,         // …and moved less than this
  TAP_HOLD_MS: 450,     // a tap/swipe jump holds "jump" this long (full-height jump, not a short hop)
  TWO_DOWN_MS: 120,     // two-finger tap: second finger within…
  TWO_UP_MS: 250,       // …and both fingers up within this of the first touch-down
  LONG_MIN_SPEED: 4,    // m/s: side swipe only long-jumps when Pip runs faster than this
  STREAK_MS: 150,
};
const G = GESTURE;

/** Controls-card rows for touch (≤ 4 words per field). Rendered by the UI. */
export const GESTURE_HELP = [
  { icon: '👈', title: 'Move', text: 'Drag left side' },
  { icon: '👆', title: 'Jump', text: 'Tap right side' },
  { icon: '⭐', title: 'Double jump', text: 'Tap again on landing' },
  { icon: '👇', title: 'Ground pound', text: 'Swipe down in air' },
  { icon: '👉', title: 'Long jump', text: 'Run, then swipe sideways' },
  { icon: '🔄', title: 'Look around', text: 'Slow drag right side' },
  { icon: '✌️', title: 'Pause', text: 'Two-finger tap' },
];

const TUTORIAL = [
  { cls: 'gs-a-drag', caption: 'Drag left: move' },
  { cls: 'gs-a-tap', caption: 'Tap right: jump' },
  { cls: 'gs-a-down', caption: 'Swipe down: pound' },
  { cls: 'gs-a-side', caption: 'Swipe side: long jump' },
];

const CSS = `
#touch-controls { position: fixed; inset: 0; z-index: 9; touch-action: none; -webkit-user-select: none; user-select: none; }
#touch-controls[hidden] { display: none; }
#gs-stick { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; opacity: 0; transition: opacity .18s ease-out; }
#gs-stick.on { opacity: .4; transition-duration: .06s; }
#gs-stick .gs-ring { position: absolute; width: ${G.STICK_RING}px; height: ${G.STICK_RING}px; left: -${G.STICK_RING / 2}px; top: -${G.STICK_RING / 2}px;
  border-radius: 50%; border: 3px solid #fff; background: rgba(255,255,255,.12); box-sizing: border-box; }
#gs-stick .gs-dot { position: absolute; left: 0; top: 0; width: 40px; height: 40px; border-radius: 50%; background: #fff; transform: translate(-50%,-50%); }
.gs-fx { position: absolute; left: 0; top: 0; pointer-events: none; opacity: 0; will-change: transform, opacity; }
.gs-streak { width: 140px; height: 12px; margin: -6px 0 0 0; border-radius: 6px; transform-origin: 0 50%;
  background: linear-gradient(90deg, rgba(255,255,255,0), #fff 70%, #fff); box-shadow: 0 0 8px rgba(255,255,255,.8); }
.gs-ring-fx { width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%; border: 4px solid #fff; box-sizing: border-box; }
#gs-tutorial { position: fixed; inset: 0; z-index: 200; display: grid; place-items: center; background: rgba(20,14,40,.94);
  font-family: var(--font, system-ui, sans-serif); color: #fff; touch-action: none; -webkit-user-select: none; user-select: none;
  animation: gs-fade .25s ease-out; padding: 16px; box-sizing: border-box; }
#gs-tutorial[hidden] { display: none; }
#gs-tutorial h2 { margin: 0 0 14px; font-size: 34px; text-align: center; text-shadow: 0 3px 0 rgba(0,0,0,.35); }
.gs-cards { display: flex; gap: 16px; flex-wrap: wrap; justify-content: center; max-width: 980px; }
.gs-card { width: 220px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.gs-pad { position: relative; width: 180px; height: 120px; border-radius: 18px; border: 3px solid rgba(255,255,255,.75); background: rgba(255,255,255,.1); overflow: hidden; }
.gs-pad::after { content: ''; position: absolute; left: 50%; top: 10px; bottom: 10px; border-left: 2px dashed rgba(255,255,255,.35); }
.gs-hand { position: absolute; font-size: 46px; line-height: 1; left: 50%; top: 50%; transform: translate(-50%,-30%); filter: drop-shadow(0 3px 0 rgba(0,0,0,.35)); }
.gs-cap { font-size: 23px; line-height: 1.15; font-weight: 800; text-align: center; text-shadow: 0 2px 0 rgba(0,0,0,.4); }
.gs-cap b { color: #ffd84a; font-weight: 900; }
.gs-hint { margin-top: 18px; font-size: 22px; text-align: center; opacity: 0; transition: opacity .3s; }
#gs-tutorial.ready .gs-hint { opacity: .9; animation: gs-pulse 1.2s ease-in-out infinite; }
.gs-a-drag .gs-hand { left: 25%; animation: gs-drag 1.8s ease-in-out infinite; }
.gs-a-tap .gs-hand { left: 75%; animation: gs-tap 1.1s ease-in-out infinite; }
.gs-a-down .gs-hand { left: 75%; animation: gs-down 1.3s ease-in infinite; }
.gs-a-side .gs-hand { left: 75%; animation: gs-side 1.3s ease-in infinite; }
@keyframes gs-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes gs-pulse { 50% { opacity: .45; } }
@keyframes gs-drag { 0%,100% { transform: translate(-90%,-30%); } 50% { transform: translate(-10%,-60%); } }
@keyframes gs-tap { 0%,60%,100% { transform: translate(-50%,-30%) scale(1); } 30% { transform: translate(-50%,-20%) scale(.82); } }
@keyframes gs-down { 0% { transform: translate(-50%,-90%); opacity: 0; } 15% { opacity: 1; } 70% { transform: translate(-50%,10%); opacity: 1; } 100% { transform: translate(-50%,10%); opacity: 0; } }
@keyframes gs-side { 0% { transform: translate(-110%,-30%); opacity: 0; } 15% { opacity: 1; } 70% { transform: translate(10%,-30%); opacity: 1; } 100% { transform: translate(10%,-30%); opacity: 0; } }
html.reduce-motion .gs-hand { animation-duration: 3.6s !important; }
@media (prefers-reduced-motion: reduce) { .gs-hand { animation-duration: 3.6s !important; } }
@media (max-height: 430px), (max-width: 960px) { .gs-cards { gap: 10px; } .gs-card { width: 180px; } .gs-pad { width: 150px; height: 92px; } .gs-cap { font-size: 19px; } #gs-tutorial h2 { font-size: 26px; margin-bottom: 8px; } .gs-hint { margin-top: 10px; } }
`;

// iPad Safari ignores user-scalable=no: block pinch-zoom (gesturestart) and double-tap zoom (two
// touchends < 300 ms apart on anything that is not a control).  Pointer events (the gesture layer)
// were already dispatched by then, so taps / jumps / swipes are unaffected.
const DOUBLE_TAP_MS = 300;
let zoomGuards = false;
export function installZoomGuards(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc || zoomGuards) return; zoomGuards = true;
  const stop = e => { if (e.cancelable !== false) e.preventDefault(); };
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) doc.addEventListener(t, stop, { passive: false });
  let lastEnd = -1e9;
  doc.addEventListener('touchend', e => {
    const t = e.timeStamp || performance.now();
    const ctl = e.target && e.target.closest && e.target.closest('button, input, select, textarea, a, label, [role=button]');
    if (!ctl && t - lastEnd < DOUBLE_TAP_MS && e.cancelable) e.preventDefault();
    lastEnd = t;
  }, { passive: false });
}

export function createTouch(root = document.body) {
  installZoomGuards();
  // jumpHeld/longHeld/poundHeld kept for input.js compatibility; crouchHeld = swipe-down on the ground
  const state = { mx: 0, my: 0, jumpHeld: false, longHeld: false, poundHeld: false, crouchHeld: false, camDx: 0, camDy: 0, active: false };
  const latch = { jump: false, longJump: false, pound: false, pause: false };
  let ctx = { airborne: false };      // set by input.js every physics step
  let bound = null;                   // optional {player, state} via touch.attach()
  let jumpHoldUntil = 0;
  const now = () => performance.now();
  // Event time: the platform timestamp (same origin as performance.now()) so a janky frame never
  // stretches a quick tap into a "hold"; falls back to performance.now() when it looks foreign.
  const tsOf = e => { const n = now(), ts = e && e.timeStamp; return ts > 0 && ts <= n + 5 ? ts : n; };
  const game = () => bound || (typeof window !== 'undefined' && window.__game) || null;
  const settings = () => { const g = game(); return (g && g.state && g.state.settings) || {}; };

  // ---- DOM: drop any legacy button DOM, inject our own ----
  for (const id of ['touch-jump', 'touch-long', 'touch-pound', 'touch-stick']) document.getElementById(id)?.remove();
  document.querySelectorAll('#touch-controls .touch-buttons').forEach(n => n.remove());
  if (!document.getElementById('gs-style')) {
    const st = document.createElement('style'); st.id = 'gs-style'; st.textContent = CSS; document.head.appendChild(st);
  }
  let el = document.getElementById('touch-controls');
  if (!el) { el = document.createElement('div'); el.id = 'touch-controls'; root.appendChild(el); }
  el.innerHTML = '<div id="gs-stick"><div class="gs-ring"></div><div class="gs-dot"></div></div>';
  el.hidden = !IS_TOUCH;
  const stickEl = el.querySelector('#gs-stick'), dot = stickEl.querySelector('.gs-dot');
  const mkPool = cls => Array.from({ length: 4 }, () => { const d = document.createElement('div'); d.className = `gs-fx ${cls}`; el.appendChild(d); return d; });
  const streaks = mkPool('gs-streak'), rings = mkPool('gs-ring-fx');
  let streakI = 0, ringI = 0;

  // ---- feedback ----
  const buzz = () => { if (settings().haptics === false) return; try { navigator.vibrate?.(8); } catch (_) { /* not allowed */ } };
  function animate(node, frames, ms) {
    if (node.getAnimations) node.getAnimations().forEach(a => a.cancel());
    if (node.animate) node.animate(frames, { duration: ms, easing: 'ease-out', fill: 'forwards' });
    else { node.style.transform = frames[frames.length - 1].transform; node.style.opacity = '0'; }
  }
  function streak(x, y, ang) {
    const s = streaks[streakI++ % streaks.length];
    const r = `rotate(${ang}rad)`;
    s.dataset.dir = ang.toFixed(2); s.dataset.t = String(now() | 0);
    animate(s, [
      { transform: `translate(${x}px,${y}px) ${r} translateX(-10px) scaleX(.4)`, opacity: 0.95 },
      { transform: `translate(${x}px,${y}px) ${r} translateX(50px) scaleX(1)`, opacity: 0 },
    ], G.STREAK_MS);
  }
  function tapRing(x, y) {
    const s = rings[ringI++ % rings.length];
    animate(s, [
      { transform: `translate(${x}px,${y}px) scale(.35)`, opacity: 0.95 },
      { transform: `translate(${x}px,${y}px) scale(1.5)`, opacity: 0 },
    ], 220);
  }

  // ---- context helpers ----
  function airborne() {
    const g = game(), p = g && g.player;
    return p ? !p.grounded : !!ctx.airborne;
  }
  function runSpeed() {
    const g = game(), p = g && g.player;
    return p ? Math.hypot(p.velocity.x, p.velocity.z) : Infinity; // unknown -> let the controller decide
  }

  // ---- actions ----
  function fireJump(p) {
    latch.jump = true; jumpHoldUntil = now() + G.TAP_HOLD_MS; state.jumpHeld = true; state.active = true;
    if (p.kind === 'tap') tapRing(p.x, p.y); else streak(p.x0, p.y0, Math.atan2(p.y - p.y0, p.x - p.x0));
    buzz();
  }
  function decideSwipe(p) {
    const dx = p.x - p.x0, dy = p.y - p.y0, ax = Math.abs(dx);
    let dir;
    if (dy >= G.SWIPE_DIST && dy >= ax) dir = 'down';
    else if (dy <= -G.SWIPE_DIST && -dy >= 1.6 * ax) dir = 'up';
    else if (ax >= G.SWIPE_DIST) dir = 'side';
    else if (dy <= -G.SWIPE_DIST) dir = 'up';
    else dir = 'down';
    p.dir = dir;
    if (dir === 'up') { p.kind = 'swipe'; fireJump(p); return; }
    if (dir === 'down') {
      p.kind = 'swipe';
      if (airborne()) { latch.pound = true; state.poundHeld = true; p.pound = true; }
      else { state.crouchHeld = true; p.crouch = true; }
      streak(p.x0, p.y0, Math.atan2(dy, dx)); buzz(); state.active = true;
      return;
    }
    // side / diagonal-forward: long jump only while grounded and running
    if (!airborne() && runSpeed() > G.LONG_MIN_SPEED) {
      p.kind = 'swipe'; latch.longJump = true; state.longHeld = true; p.long = true;
      streak(p.x0, p.y0, Math.atan2(dy, dx)); buzz(); state.active = true;
    } else p.kind = 'ignore'; // standing still: nothing, and no camera orbit either
  }
  function startOrbit(p) {
    p.kind = 'orbit';
    state.camDx += p.x - p.x0; state.camDy += p.y - p.y0; // catch up the motion made while deciding
    p.lx = p.x; p.ly = p.y;
  }
  function peakSpeed(p, s) {
    // px/s: max of the average since touch-down and the speed over the latest ~60 ms of `s`
    const last = s[s.length - 1];
    const dtAll = Math.max(1, last.t - p.t0);
    let best = Math.hypot(last.x - p.x0, last.y - p.y0) / dtAll * 1000;
    let j = s.length - 1;
    while (j > 0 && last.t - s[j - 1].t <= 60) j--;
    if (j < s.length - 1) {
      const a = s[j], dt = Math.max(8, last.t - a.t);
      best = Math.max(best, Math.hypot(last.x - a.x, last.y - a.y) / dt * 1000);
    }
    return best;
  }

  // ---- pointer bookkeeping ----
  const ptrs = new Map();   // pointerId -> record
  let stickId = null, sx = 0, sy = 0;
  let group = null;         // two-finger-tap candidate: {ids:Set, t0, lifted:Set, deferred:[]}

  function travel(p) { return Math.hypot(p.x - p.x0, p.y - p.y0); }
  function dissolveGroup() {
    if (!group) return;
    const g = group; group = null; clearTimeout(g.timer);
    for (const id of g.ids) { const p = ptrs.get(id); if (p) p.multi = false; }
    for (const p of g.deferred) fireJump(p);  // a real tap that just looked like half a two-finger tap
  }
  function checkGroup(t) {
    if (!group) return;
    if (t - group.t0 > G.TWO_UP_MS) { dissolveGroup(); return; }
    for (const id of group.ids) {
      const p = ptrs.get(id);
      if (p && p.maxTravel >= G.TAP_SLOP) { dissolveGroup(); return; }
    }
  }

  // Decide a right-half pointer. Event-driven (move / lift), all times are event timestamps.
  function evaluate(p, t, lifted) {
    if (p.kind !== 'pending' && p.kind !== 'hold' && p.kind !== 'flick') return;
    const age = t - p.t0, d = travel(p);
    if (p.kind === 'pending' && age > G.DECIDE_MS) {
      // first event past 100 ms: rebuild what the finger was doing AT 100 ms
      const early = p.samples.filter(q => q.t - p.t0 <= G.DECIDE_MS);
      const tr = early.reduce((m, q) => Math.max(m, Math.hypot(q.x - p.x0, q.y - p.y0)), 0);
      if (tr < G.TAP_SLOP) p.kind = 'hold';                                      // still a tap candidate
      else if (early.length > 1 && peakSpeed(p, early) >= G.SWIPE_SPEED) p.kind = 'flick'; // fast, may still finish a swipe
      else { startOrbit(p); return; }
    }
    if (d >= G.SWIPE_DIST) {
      const inTime = p.kind === 'pending' || (p.kind === 'hold' && age <= G.TAP_MS) || (p.kind === 'flick' && age <= G.FLICK_WAIT_MS);
      if (inTime && peakSpeed(p, p.samples) >= G.SWIPE_SPEED) decideSwipe(p); else startOrbit(p);
      return;
    }
    if (lifted) {
      if (age <= G.TAP_MS && p.maxTravel < G.TAP_SLOP) {
        p.kind = 'tap';
        if (p.multi && group) { group.deferred.push(p); groupDeadline(); } else fireJump(p);
      } else startOrbit(p);
      return;
    }
    // a still finger past the tap window stays undecided (an orbit with no motion = nothing) until it moves
    if (p.kind === 'hold' && p.maxTravel >= G.TAP_SLOP) startOrbit(p);
    else if (p.kind === 'flick' && age > G.FLICK_WAIT_MS) startOrbit(p);
  }
  // Group deadline. Only needed when one finger already lifted as a tap and its partner is still
  // down and still: after the 250 ms window that tap is a real jump. The clock follows the event
  // timestamps (last event time + real time since), and we wait one frame so a lift already queued
  // for this frame is processed first.
  let lastEvTs = 0, lastEvReal = 0;
  const evClock = () => lastEvTs + (now() - lastEvReal);
  const stamp = t => { lastEvTs = t; lastEvReal = now(); };
  function groupDeadline() {
    const g = group; if (!g) return;
    clearTimeout(g.timer);
    g.timer = setTimeout(() => {
      const go = () => { if (group === g && g.deferred.length && evClock() - g.t0 > G.TWO_UP_MS) dissolveGroup(); else if (group === g) groupDeadline(); };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(go, 0)); else go();
    }, Math.max(16, G.TWO_UP_MS - (evClock() - g.t0) + 5));
  }

  const capture = e => { try { el.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ } };

  function setStick(dx, dy) {
    const L = Math.hypot(dx, dy);
    if (L > G.STICK_MAX) { dx *= G.STICK_MAX / L; dy *= G.STICK_MAX / L; }
    dot.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const m = L <= G.STICK_DEAD ? 0 : Math.min(1, (L - G.STICK_DEAD) / (G.STICK_MAX - G.STICK_DEAD));
    state.mx = L > 0 ? (dx / Math.min(L, G.STICK_MAX)) * m : 0;
    state.my = L > 0 ? (-dy / Math.min(L, G.STICK_MAX)) * m : 0;
  }

  el.addEventListener('pointerdown', e => {
    e.preventDefault(); capture(e); state.active = true;
    const t = tsOf(e); stamp(t);
    const p = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: t, samples: [{ x: e.clientX, y: e.clientY, t }],
      maxTravel: 0, kind: 'pending', multi: false, lx: e.clientX, ly: e.clientY };
    if (e.pointerType === 'mouse') { p.kind = 'orbit'; ptrs.set(p.id, p); return; } // hybrid device: mouse drag orbits
    const leftHalf = e.clientX < window.innerWidth / 2;
    if (leftHalf && stickId === null) {
      p.kind = 'stick'; stickId = p.id; sx = e.clientX; sy = e.clientY;
      stickEl.style.left = sx + 'px'; stickEl.style.top = sy + 'px';
      dot.style.transform = 'translate(-50%,-50%)';
      stickEl.classList.add('on');
    }
    ptrs.set(p.id, p);
    // two-finger tap candidate: another still finger went down ≤ 120 ms ago
    for (const q of ptrs.values()) {
      if (q === p || group || p.kind === 'orbit') break;
      if (q.kind !== 'pending' && q.kind !== 'hold' && q.kind !== 'stick') continue;
      if (t - q.t0 <= G.TWO_DOWN_MS && q.maxTravel < G.TAP_SLOP) {
        group = { ids: new Set([q.id, p.id]), t0: q.t0, lifted: new Set(), deferred: [] };
        p.multi = q.multi = true;
        break;
      }
    }
  });

  el.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    e.preventDefault();
    const t = tsOf(e); stamp(t);
    if (p.kind !== 'stick' && p.kind !== 'orbit' && e.getCoalescedEvents) {
      for (const c of e.getCoalescedEvents().slice(0, -1)) {   // intermediate samples (janky frames)
        const ct = tsOf(c); if (ct < p.samples[p.samples.length - 1].t) continue;
        p.samples.push({ x: c.clientX, y: c.clientY, t: ct });
        p.maxTravel = Math.max(p.maxTravel, Math.hypot(c.clientX - p.x0, c.clientY - p.y0));
      }
    }
    p.x = e.clientX; p.y = e.clientY;
    p.maxTravel = Math.max(p.maxTravel, travel(p));
    if (p.kind === 'stick') { setStick(p.x - sx, p.y - sy); checkGroup(t); return; }
    if (p.kind === 'orbit') {
      state.camDx += p.x - p.lx; state.camDy += p.y - p.ly; p.lx = p.x; p.ly = p.y; return;
    }
    p.samples.push({ x: p.x, y: p.y, t });
    if (p.samples.length > 64) p.samples.splice(1, p.samples.length - 64); // keep first + recent
    evaluate(p, t, false);
    checkGroup(t);
  });

  function lift(e, cancelled) {
    const p = ptrs.get(e.pointerId); if (!p) return;
    const t = tsOf(e); stamp(t);
    if (!cancelled && p.kind !== 'stick' && p.kind !== 'orbit') {
      p.x = e.clientX; p.y = e.clientY; p.maxTravel = Math.max(p.maxTravel, travel(p));
      p.samples.push({ x: p.x, y: p.y, t });
      evaluate(p, t, true);
    }
    if (p.kind === 'stick') { stickId = null; state.mx = state.my = 0; stickEl.classList.remove('on'); }
    if (p.crouch) state.crouchHeld = false;
    if (p.pound) state.poundHeld = false;
    if (p.long) state.longHeld = false;
    ptrs.delete(p.id);
    if (group && group.ids.has(p.id)) {
      checkGroup(t);
      if (group) {
        if (cancelled || p.maxTravel >= G.TAP_SLOP) dissolveGroup();
        else {
          group.lifted.add(p.id);
          if (group.lifted.size === group.ids.size) {        // both fingers up in time, both still
            clearTimeout(group.timer); group = null;
            latch.pause = true; buzz();
            tapRing(p.x, p.y);
          }
        }
      }
    }
  }
  el.addEventListener('pointerup', e => lift(e, false));
  el.addEventListener('pointercancel', e => lift(e, true));
  el.addEventListener('contextmenu', e => e.preventDefault());

  function resetAll() {
    ptrs.clear(); if (group) clearTimeout(group.timer); group = null; stickId = null;
    state.mx = state.my = 0; state.crouchHeld = state.poundHeld = state.longHeld = false;
    stickEl.classList.remove('on');
  }

  // ---- first-play tutorial ----
  let tut = null, tutAuto = false;
  const dismissFns = new Set();
  function showTutorial(auto = false) {
    if (!tut) {
      tut = document.createElement('div');
      tut.id = 'gs-tutorial';
      tut.setAttribute('role', 'dialog'); tut.setAttribute('aria-label', 'How to move');
      tut.innerHTML = `<div><h2>How to move</h2><div class="gs-cards">${TUTORIAL.map(c =>
        `<div class="gs-card ${c.cls}"><div class="gs-pad"><span class="gs-hand" aria-hidden="true">👆</span></div><div class="gs-cap">${c.caption.replace(': ', ':<br> <b>')}</b></div></div>`).join('')
      }</div><div class="gs-hint">Tap to play!</div></div>`;
      const stop = e => { e.preventDefault(); e.stopPropagation(); };
      tut.addEventListener('pointerdown', stop);
      tut.addEventListener('pointermove', stop);
      tut.addEventListener('pointerup', e => { stop(e); if (now() - tut._t0 >= 1500) hideTutorial(true); });
      document.body.appendChild(tut);
    }
    tutAuto = auto;
    tut._t0 = now(); tut.hidden = false; tut.classList.remove('ready');
    clearTimeout(tut._rt); tut._rt = setTimeout(() => tut && tut.classList.add('ready'), 1500);
    resetAll();
    return tut;
  }
  function hideTutorial(seen) {
    if (!tut || tut.hidden) return;
    tut.hidden = true; tutAuto = false;
    if (seen) {
      const g = game();
      try {
        if (g && g.state && g.state.setSetting) { if (!g.state.settings.gestureTutorialSeen) g.state.setSetting('gestureTutorialSeen', true); }
      } catch (_) { /* storage blocked */ }
    }
    for (const fn of [...dismissFns]) { try { fn({ seen: !!seen }); } catch (err) { console.error('[touch] tutorial listener failed', err); } }
  }

  return {
    el, state, latch, GESTURE_HELP,
    /** Optional explicit wiring (else window.__game is used lazily). */
    attach(b) { bound = b; },
    setContext(c) { ctx = c || ctx; },
    takeLatch() {
      const r = { ...latch };
      latch.jump = latch.longJump = latch.pound = latch.pause = false;
      state.jumpHeld = now() < jumpHoldUntil;
      return r;
    },
    takeCamera() { const r = { dx: state.camDx, dy: state.camDy }; state.camDx = state.camDy = 0; return r; },
    show(v) {
      el.hidden = !(v && IS_TOUCH);
      if (!v) { resetAll(); if (tutAuto) hideTutorial(false); return; } // pause / stop closes a first-play tutorial unseen
    },
    /** opts.firstPlay: closes (unseen) when the touch layer hides, e.g. on pause; objectives re-opens it */
    showTutorial: (opts = {}) => showTutorial(!!(opts && opts.firstPlay)),
    onTutorialDismissed(fn) { dismissFns.add(fn); return () => dismissFns.delete(fn); },
    hideTutorial: () => hideTutorial(true),
    /** test/debug snapshot of the recogniser */
    debug() { return { pointers: [...ptrs.values()].map(p => ({ id: p.id, kind: p.kind, dir: p.dir, multi: p.multi })), group: group ? [...group.ids] : null, stickId, latch: { ...latch } }; },
    get tutorialOpen() { return !!(tut && !tut.hidden); },
  };
}
