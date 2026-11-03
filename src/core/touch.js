/*
 * Touch layer (iPad / Android).  Produces the same abstract inputs as keyboard/gamepad; input.js
 * merges touch.state into input.actions every physics step.
 *   Left half : dynamic-origin virtual joystick (appears where the thumb lands).
 *   Right half: Jump (A), Long jump (B), Pound (X) buttons bottom-right; dragging anywhere else
 *               on the right half orbits the camera.
 * Multi-touch via Pointer Events tracked by pointerId (+ setPointerCapture).
 * DOM: #touch-controls > #touch-stick(.base > .knob), #touch-jump, #touch-long, #touch-pound
 */
export const IS_TOUCH = typeof window !== 'undefined' &&
  (('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0);

const STICK_MAX = 60;   // px: full deflection
const STICK_DEAD = 8;   // px: dead zone (see README: 48 px is the visual ring radius)

export function createTouch(root = document.body) {
  const state = { mx: 0, my: 0, jumpHeld: false, longHeld: false, poundHeld: false, camDx: 0, camDy: 0, active: false };
  const latch = { jump: false, longJump: false, pound: false };
  const el = document.createElement('div');
  el.id = 'touch-controls';
  el.innerHTML = `
    <div id="touch-stick" class="stick" hidden><div class="base"></div><div class="knob"></div></div>
    <div class="touch-buttons">
      <button id="touch-pound" class="tbtn tb-x" aria-label="Ground pound"><span>⬇</span><small>Pound</small></button>
      <button id="touch-long" class="tbtn tb-b" aria-label="Long jump"><span>➜</span><small>Long</small></button>
      <button id="touch-jump" class="tbtn tb-a" aria-label="Jump"><span>⬆</span><small>Jump</small></button>
    </div>`;
  root.appendChild(el);
  el.hidden = !IS_TOUCH;
  const stickEl = el.querySelector('#touch-stick'), knob = stickEl.querySelector('.knob');
  let stickId = null, sx = 0, sy = 0;
  const camIds = new Map(); // pointerId -> {x,y}

  const capture = (t, e) => { try { t.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ } };
  const buzz = () => { try { navigator.vibrate?.(10); } catch (_) { /* not allowed */ } };

  function bindButton(id, held, lat) {
    const b = el.querySelector(id);
    const down = e => { e.preventDefault(); e.stopPropagation(); capture(b, e); state[held] = true; latch[lat] = true; b.classList.add('down'); buzz(); state.active = true; };
    const up = e => { e.preventDefault(); e.stopPropagation(); state[held] = false; b.classList.remove('down'); };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', () => { state[held] = false; b.classList.remove('down'); });
    b.addEventListener('contextmenu', e => e.preventDefault());
  }
  bindButton('#touch-jump', 'jumpHeld', 'jump');
  bindButton('#touch-long', 'longHeld', 'longJump');
  bindButton('#touch-pound', 'poundHeld', 'pound');

  el.addEventListener('pointerdown', e => {
    if (e.target.closest('.tbtn')) return;
    e.preventDefault(); capture(el, e); state.active = true;
    const leftHalf = e.clientX < window.innerWidth / 2;
    if (leftHalf && e.pointerType !== 'mouse' && stickId === null) {
      stickId = e.pointerId; sx = e.clientX; sy = e.clientY;
      stickEl.hidden = false; stickEl.style.left = sx + 'px'; stickEl.style.top = sy + 'px';
      knob.style.transform = 'translate(-50%,-50%)';
    } else camIds.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  el.addEventListener('pointermove', e => {
    if (e.pointerId === stickId) {
      e.preventDefault();
      let dx = e.clientX - sx, dy = e.clientY - sy;
      const L = Math.hypot(dx, dy);
      if (L > STICK_MAX) { dx *= STICK_MAX / L; dy *= STICK_MAX / L; }
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const m = L <= STICK_DEAD ? 0 : Math.min(1, (L - STICK_DEAD) / (STICK_MAX - STICK_DEAD));
      state.mx = L > 0 ? (dx / Math.min(L, STICK_MAX)) * m : 0;
      state.my = L > 0 ? (-dy / Math.min(L, STICK_MAX)) * m : 0;
    } else if (camIds.has(e.pointerId)) {
      e.preventDefault();
      const p = camIds.get(e.pointerId);
      state.camDx += e.clientX - p.x; state.camDy += e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
    }
  });
  const end = e => {
    if (e.pointerId === stickId) { stickId = null; state.mx = state.my = 0; stickEl.hidden = true; }
    camIds.delete(e.pointerId);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('contextmenu', e => e.preventDefault());

  return {
    el, state, latch,
    takeLatch() { const r = { ...latch }; latch.jump = latch.longJump = latch.pound = false; return r; },
    takeCamera() { const r = { dx: state.camDx, dy: state.camDy }; state.camDx = state.camDy = 0; return r; },
    show(v) { el.hidden = !(v && IS_TOUCH); if (!v) { stickId = null; state.mx = state.my = 0; stickEl.hidden = true; camIds.clear(); } },
  };
}
