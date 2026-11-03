/*
 * Keyboard + gamepad -> abstract actions.  Call input.update() once per physics step and read
 * input.actions.  Button edges (pressed/released) are latched from DOM events so a quick tap
 * between two steps is never lost.
 *
 * actions = {
 *   move:{x,y}            -1..1, y = forward (W / up / left stick up)
 *   jump:{pressed,held,released}     Space / gamepad A
 *   longJump:{pressed,held}          Shift / gamepad B
 *   pound:{pressed,held}             E (in the air), X, C, Ctrl / gamepad X
 *   crouch:{held}         touch only: swipe down on the ground, held until lift
 *   camera:{x,y}          -1..1 orbit rate: Q/E, arrow keys (when WASD moves), right stick
 *   pause:{pressed}       Esc / P / gamepad Start / two-finger tap
 *   focus:{pressed}       F / gamepad Back(View)
 *   camReset:{pressed}    R / gamepad Y / right-stick click
 *   nav:{up,down,left,right,confirm,back}  gamepad menu navigation edges
 *   device: 'keyboard' | 'gamepad' | 'touch'   last device used
 * }
 * Mouse drag on the canvas orbits the camera: input.takeMouse() returns and clears {dx,dy}.
 */
const DEAD = 0.2; // radial stick dead-zone

export function createInput(target = window, canvas = null, touch = null) {
  const keys = new Set();
  const latch = {};          // action -> pressed since last update
  let scheme = 'arrows';     // arrows move until WASD is used; then arrows orbit the camera
  let lastWasd = -1e9;
  let eUsedForPound = false;
  let ctx = { airborne: false };
  const mouse = { dx: 0, dy: 0, down: false, lx: 0, ly: 0 };
  let prevPad = {};
  let enabled = true;
  let pointerLock = false;

  const actions = {
    move: { x: 0, y: 0 },
    jump: { pressed: false, held: false, released: false },
    longJump: { pressed: false, held: false },
    pound: { pressed: false, held: false },
    crouch: { held: false },
    camera: { x: 0, y: 0 },
    pause: { pressed: false },
    focus: { pressed: false },
    camReset: { pressed: false },
    nav: { up: false, down: false, left: false, right: false, confirm: false, back: false },
    device: 'keyboard',
    any: false,
  };
  let prevJumpHeld = false;

  const WASD = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
  const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

  function isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }
  function onKeyDown(e) {
    if (isTyping(e)) return;
    const c = e.code;
    if (c === 'Space' || ARROWS.includes(c)) {
      // keep the page from scrolling, but let menus use Space/Enter on focused buttons
      const inMenu = document.activeElement && document.activeElement.tagName === 'BUTTON';
      if (!inMenu) e.preventDefault();
    }
    actions.device = 'keyboard';
    if (WASD.includes(c)) { scheme = 'wasd'; lastWasd = performance.now(); }
    if (ARROWS.includes(c) && performance.now() - lastWasd > 10000 && !WASD.some(k => keys.has(k))) scheme = 'arrows';
    if (e.repeat) return;
    keys.add(c);
    if (c === 'Space') latch.jump = true;
    if (c === 'ShiftLeft' || c === 'ShiftRight') latch.longJump = true;
    if (c === 'KeyX' || c === 'KeyC' || c === 'ControlLeft' || c === 'ControlRight') latch.pound = true;
    if (c === 'KeyE') latch.eKey = true;
    if (c === 'Escape' || c === 'KeyP') latch.pause = true;
    if (c === 'KeyF') latch.focus = true;
    if (c === 'KeyR') latch.camReset = true;
  }
  function onKeyUp(e) { keys.delete(e.code); if (e.code === 'KeyE') eUsedForPound = false; }
  function onBlur() { keys.clear(); mouse.down = false; }

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);
  if (canvas) {
    canvas.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') return;
      mouse.down = true; mouse.lx = e.clientX; mouse.ly = e.clientY;
      if (pointerLock && e.pointerType !== 'touch' && !('ontouchstart' in window) && canvas.requestPointerLock && document.pointerLockElement !== canvas) {
        try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (_) { /* optional */ }
      }
    });
    window.addEventListener('mouseup', () => { mouse.down = false; });
    window.addEventListener('mousemove', e => {
      if (document.pointerLockElement === canvas) { mouse.dx += e.movementX; mouse.dy += e.movementY; return; }
      if (!mouse.down) return;
      mouse.dx += e.clientX - mouse.lx; mouse.dy += e.clientY - mouse.ly;
      mouse.lx = e.clientX; mouse.ly = e.clientY;
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  function readPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }
  function stick(ax, ay) {
    const m = Math.hypot(ax, ay);
    if (m < DEAD) return [0, 0];
    const k = Math.min(1, (m - DEAD) / (1 - DEAD)) / m;
    return [ax * k, ay * k];
  }

  function update() {
    const k = c => keys.has(c);
    let mx = 0, my = 0, cx = 0, cy = 0;
    const arrowsMove = scheme === 'arrows';
    if (k('KeyA')) mx -= 1; if (k('KeyD')) mx += 1;
    if (k('KeyW')) my += 1; if (k('KeyS')) my -= 1;
    if (arrowsMove) {
      if (k('ArrowLeft')) mx -= 1; if (k('ArrowRight')) mx += 1;
      if (k('ArrowUp')) my += 1; if (k('ArrowDown')) my -= 1;
    } else {
      if (k('ArrowLeft')) cx -= 1; if (k('ArrowRight')) cx += 1;
      if (k('ArrowUp')) cy += 1; if (k('ArrowDown')) cy -= 1;
    }
    // E: ground pound when airborne, otherwise camera orbit (Q/E pair)
    let poundPressed = !!latch.pound;
    if (latch.eKey && ctx.airborne) { poundPressed = true; eUsedForPound = true; }
    if (k('KeyQ')) cx -= 1;
    if (k('KeyE') && !eUsedForPound) cx += 1;

    let jumpHeld = k('Space');
    let longHeld = k('ShiftLeft') || k('ShiftRight');
    let poundHeld = k('KeyX') || k('KeyC') || k('ControlLeft') || k('ControlRight') || (k('KeyE') && eUsedForPound);
    let jumpPressed = !!latch.jump, longPressed = !!latch.longJump;
    let pausePressed = !!latch.pause, focusPressed = !!latch.focus, resetPressed = !!latch.camReset;
    const nav = actions.nav;
    nav.up = nav.down = nav.left = nav.right = nav.confirm = nav.back = false;

    const pad = readPad();
    if (pad) {
      const b = i => !!(pad.buttons[i] && pad.buttons[i].pressed);
      const edge = i => b(i) && !prevPad[i];
      const [lx, ly] = stick(pad.axes[0] || 0, pad.axes[1] || 0);
      const [rx, ry] = stick(pad.axes[2] || 0, pad.axes[3] || 0);
      let dx = (b(15) ? 1 : 0) - (b(14) ? 1 : 0), dy = (b(12) ? 1 : 0) - (b(13) ? 1 : 0);
      const padMove = Math.abs(lx) + Math.abs(ly) + Math.abs(dx) + Math.abs(dy) > 0;
      if (padMove) { mx += lx + dx; my += -ly + dy; }
      cx += rx; cy += -ry;
      const anyBtn = pad.buttons.some(x => x && x.pressed);
      if (padMove || anyBtn || Math.abs(rx) + Math.abs(ry) > 0) actions.device = 'gamepad';
      jumpHeld = jumpHeld || b(0); longHeld = longHeld || b(1); poundHeld = poundHeld || b(2);
      jumpPressed = jumpPressed || edge(0); longPressed = longPressed || edge(1); poundPressed = poundPressed || edge(2);
      pausePressed = pausePressed || edge(9); focusPressed = focusPressed || edge(8);
      resetPressed = resetPressed || edge(3) || edge(11);
      // menu navigation edges (stick flicks count once)
      const sUp = ly < -0.6, sDown = ly > 0.6;
      nav.up = edge(12) || (sUp && !prevPad.sUp); nav.down = edge(13) || (sDown && !prevPad.sDown);
      nav.left = edge(14); nav.right = edge(15);
      nav.confirm = edge(0); nav.back = edge(1) || edge(9);
      prevPad = {};
      pad.buttons.forEach((x, i) => { prevPad[i] = !!(x && x.pressed); });
      prevPad.sUp = sUp; prevPad.sDown = sDown;
    } else prevPad = {};

    if (latch.padA) { jumpPressed = true; nav.confirm = true; actions.device = 'gamepad'; } // debugPadA(): one simulated A edge
    let crouchHeld = false;
    if (touch) {
      // gesture layer (touch.js): edges are latched there until this step consumes them
      if (touch.setContext) touch.setContext(ctx);
      const ts = touch.state, tl = touch.takeLatch();
      if (ts.mx || ts.my || tl.jump || tl.longJump || tl.pound || tl.pause || ts.crouchHeld) actions.device = 'touch';
      mx += ts.mx; my += ts.my;
      jumpHeld = jumpHeld || ts.jumpHeld; longHeld = longHeld || ts.longHeld; poundHeld = poundHeld || ts.poundHeld;
      jumpPressed = jumpPressed || tl.jump; longPressed = longPressed || tl.longJump; poundPressed = poundPressed || tl.pound;
      pausePressed = pausePressed || !!tl.pause;
      crouchHeld = !!ts.crouchHeld;
    }
    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    actions.move.x = enabled ? mx : 0; actions.move.y = enabled ? my : 0;
    actions.camera.x = enabled ? Math.max(-1, Math.min(1, cx)) : 0;
    actions.camera.y = enabled ? Math.max(-1, Math.min(1, cy)) : 0;
    actions.jump.pressed = enabled && jumpPressed;
    actions.jump.held = enabled && (jumpHeld || jumpPressed);
    actions.jump.released = enabled && prevJumpHeld && !jumpHeld;
    prevJumpHeld = jumpHeld && enabled;
    actions.longJump.pressed = enabled && longPressed; actions.longJump.held = enabled && longHeld;
    actions.pound.pressed = enabled && poundPressed; actions.pound.held = enabled && poundHeld;
    actions.crouch.held = enabled && crouchHeld;
    actions.pause.pressed = pausePressed;
    actions.focus.pressed = focusPressed;
    actions.camReset.pressed = enabled && resetPressed;
    actions.any = ml > 0 || jumpPressed || longPressed || poundPressed;
    for (const key in latch) latch[key] = false;
    return actions;
  }

  function takeMouse() {
    const r = { dx: mouse.dx, dy: mouse.dy };
    mouse.dx = 0; mouse.dy = 0;
    if (touch) { const t = touch.takeCamera(); r.dx += t.dx * 1.4; r.dy += t.dy * 1.4; }
    return enabled ? r : { dx: 0, dy: 0 };
  }

  return {
    actions, update, takeMouse,
    setContext(c) { ctx = c; },
    setEnabled(v) { enabled = v; if (!v) { for (const key in latch) if (key !== 'pause') latch[key] = false; } },
    setPointerLock(v) { pointerLock = !!v; },
    debugPadA() { latch.padA = true; return true; }, // tests: one gamepad A press (jump + nav.confirm edge)
    get scheme() { return scheme; },
    keys,
  };
}
