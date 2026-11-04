/*
 * Pip's kinematic controller: the whole moveset from DESIGN.md §2.
 * Collision shape = two stacked spheres (feet sphere + head sphere) swept in sub-steps against
 * CollisionWorld.  `position` is the FEET point.  Every feel number lives in TUNING.
 *
 * Crouch: actions.crouch.held (touch: swipe down on the ground, held) or the pound button held on
 * the ground (keyboard Ctrl / C / X, gamepad X).  Crouched Pip walks at 45 % speed, a running crouch
 * slides down to that speed, the capsule shrinks to 0.8 m (and only grows back with headroom).
 * Crouch + jump: moving > 4 m/s = long jump, standing still = backflip (6.3 m apex, one spin).
 * Emits player:crouch {on} whenever the crouch state changes.
 *
 * Two movement modes (settings.moveMode, DESIGN.md §5.5):
 *   'simple' (default, Roblox-like, numbers in SIMPLE): constant walk speed reached / lost within
 *            ~0.03 s, instant facing, step-up over ≤ 0.45 m ledges, one fixed-height jump (no
 *            early-release cut, no timed combo) + one air double jump that tops out 8.5 m above the
 *            take-off ground, touch-only auto-jump onto 0.45–1.6 m ledges.
 *   'pro'    the original Mario-64-like moveset below (accel/skid, variable height, 1-2-3 combo).
 * Shared by both: coyote time, jump buffer, wall kick, long jump, ground pound, crouch, backflip.
 */
import * as THREE from '../three.js';

export const TUNING = {
  radius: 0.45, height: 1.3,        // collision spheres at y=r and y=height-r
  crouchHeight: 0.8,                // capsule height while crouched (head sphere sinks onto the feet one)
  // --- running ---
  topSpeed: 9,                      // m/s (brief)
  runAccel: 40,                     // m/s² (brief) -> 0 to top speed in ~0.22 s
  friction: 55,                     // m/s² when stick released: stops in ~0.16 s (snappy)
  turnInPlaceSpeed: 2,              // below this the facing snaps instantly to the stick
  turnRateFast: 11, turnRateSlow: 22, // rad/s facing turn rate at top speed / at 2 m/s
  skidAngle: 2.4, skidDecel: 70,    // > ~137° reversal at speed = quick skid-turn
  uphillSlow: 0.35,                 // top speed loss on the steepest walkable slope
  walkableNY: 0.64,                 // cos(50°): steeper surfaces are walls / slides
  stepSnap: 0.4,                    // stick to the ground when walking down slopes/steps
  // --- air ---
  airAccel: 26, airDrag: 3, airSteer: 2.2, airTurnRate: 10,
  gravityUp: 50, gravityDown: 72, maxFall: 42, // heavier fall = less floaty, still 5 m apex
  jumpCut: 0.45,                    // releasing jump early multiplies upward speed (variable height)
  jumpApex: [5.0, 6.3, 8.5],        // metres, tiers 1..3 (brief)
  comboWindow: 0.3, comboMinSpeed: 4,
  // --- special moves ---
  longJumpApex: 2.2, longJumpSpeed: 16, longJumpGravity: 0.6, longJumpMinSpeed: 3, // ≈1.7× distance
  poundHang: 0.18, poundSpeed: 32, poundLag: 0.25, poundRadius: 2,
  wallKickWindow: 0.2, wallKickApex: 4.5, wallKickPush: 9, wallKickLock: 0.22,
  // --- crouch (DESIGN.md §5.1 swipe-down on the ground; Ctrl / C on keyboard) ---
  crouchSpeed: 0.45,                // × topSpeed while crouched
  crouchSlideDecel: 12,             // m/s² when crouching at run speed (keeps a long-jump window)
  crouchLongJumpMinSpeed: 4,        // crouch + jump faster than this = long jump
  backflipMaxSpeed: 1.5,            // crouch + jump slower than this = backflip
  backflipApex: 6.3, backflipBack: 2.5, // apex m, backward drift m/s
  // --- helper mode (R6) ---
  coyote: 0.15, buffer: 0.15,
  // --- damage / respawn ---
  killY: -20, maxBonks: 3, hurtInvuln: 1.2, knockback: 8, knockApex: 1.2,
};
const T = TUNING;
// Simple mode (DESIGN.md §5.5). Anything not listed here comes from TUNING.
export const SIMPLE = {
  walkSpeed: 8.5,                   // m/s, constant (Roblox WalkSpeed-like)
  accel: 260, decel: 260,           // m/s²: 0 -> 8.5 m/s in 0.033 s (2 steps), stop in 2 steps
  stickGain: 1.5,                   // analog stick: 2/3 deflection already = full speed
  airAccel: 45, airDecel: 16,       // some air inertia (0 -> 8.5 m/s in ~0.19 s)
  jumpApex: 5.0,                    // m, fixed (hold / release do not change it)
  airJumpTotal: 8.5,                // m above the take-off ground at the double jump's apex
  airJumpMin: 1.8, airJumpMax: 6.3, // m of extra rise the air jump may add from where it fires
  airJumpGroundGuard: 0.35,         // falling this close above ground: buffer the press for landing instead
  stepUp: 0.45,                     // m: walk up ledges this high without slowing
  autoJumpMin: 0.45, autoJumpMax: 1.6, autoJumpHold: 0.12, autoJumpCooldown: 0.6, autoJumpProbe: 0.3,
  autoJumpMinInput: 0.3,
};
const S = SIMPLE;
// + g*dt/2 compensates semi-implicit Euler at 60 Hz so the apex matches the tuned height exactly
const jumpV = (apex, g = T.gravityUp) => Math.sqrt(2 * g * apex) + g / 120;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

export function createController({ col, events, state }) {
  const pos = new THREE.Vector3(), vel = new THREE.Vector3(), prev = new THREE.Vector3();
  const contacts = [];
  const c = {
    position: pos, velocity: vel, prevPosition: prev,
    facing: Math.PI, grounded: false, groundNormal: { x: 0, y: 1, z: 0 }, groundCol: null,
    mode: 'fall',       // ground | jump | fall | longjump | pound | poundland
    tier: 0, lastJumpTier: 0, lastLandTime: -1, cut: false, skidding: false,
    sinceGround: 9, sinceJumpPress: 9, jumpedSinceGround: false, airTime: 0,
    wallTimer: 0, wallN: { x: 0, z: 0 }, airLock: 0, poundTimer: 0, lag: 0,
    bonks: 0, invuln: 0, time: 0, frozen: false, landImpact: 0, jumpImpulse: 0,
    crouching: false, height: T.height, backflip: false,
    airJumped: false, jumpBaseY: 0, autoT: 0, lastAutoJump: -9, simple: true,
    world: null,        // set by main: {windAt(pos), onPound(pos,r)}
  };
  const ev = (type, extra = {}) => events.emit(type, { x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), z: +pos.z.toFixed(2), ...extra });

  function doJump(tier, extra) {
    c.tier = tier; c.mode = 'jump'; c.cut = c.simple; c.backflip = false; // simple: no early-release cut
    vel.y = jumpV(c.simple ? S.jumpApex : T.jumpApex[tier - 1]);
    c.jumpBaseY = pos.y;
    c.grounded = false; c.jumpedSinceGround = true; c.sinceJumpPress = 9; c.jumpImpulse = 1;
    ev('player:jump', { tier, ...extra });
  }
  // Simple mode: second press in the air. Rises to airJumpTotal above the take-off ground.
  function doAirJump() {
    const rise = Math.max(S.airJumpMin, Math.min(S.airJumpMax, c.jumpBaseY + S.airJumpTotal - pos.y));
    vel.y = jumpV(rise);
    c.mode = 'jump'; c.tier = 2; c.cut = true; c.backflip = false; c.airJumped = true; c.jumpedSinceGround = true;
    c.sinceJumpPress = 9; c.jumpImpulse = 1; c.airLock = 0;
    ev('player:jump', { tier: 2, air: true });
    ev('player:airjump');
  }
  function doLongJump() {
    const f = c.facing;
    const sp = Math.max(T.longJumpSpeed, Math.hypot(vel.x, vel.z));
    vel.x = Math.sin(f) * sp; vel.z = Math.cos(f) * sp;
    vel.y = jumpV(T.longJumpApex, T.gravityUp * T.longJumpGravity);
    c.mode = 'longjump'; c.tier = 0; c.cut = true; c.grounded = false; c.jumpedSinceGround = true; c.sinceJumpPress = 9;
    c.jumpImpulse = 0.6; c.lastJumpTier = 0; c.backflip = false;
    ev('player:longjump');
  }
  // crouch + jump standing still: fixed-height backflip (no variable cut), drifts slightly backward
  function doBackflip() {
    const f = c.facing;
    vel.x = -Math.sin(f) * T.backflipBack; vel.z = -Math.cos(f) * T.backflipBack;
    vel.y = jumpV(T.backflipApex);
    c.mode = 'jump'; c.tier = 0; c.cut = true; c.backflip = true; c.grounded = false; c.jumpedSinceGround = true;
    c.sinceJumpPress = 9; c.jumpImpulse = 1; c.lastJumpTier = 0;
    ev('player:jump', { tier: 2, backflip: true });
    ev('player:backflip');
  }
  function setCrouch(on) {
    if (c.crouching === on) return;
    c.crouching = on;
    ev('player:crouch', { on });
  }
  // Room for the full-height head sphere above the feet?
  function headroom() {
    col.sphereContacts(pos.x, pos.y + T.height - T.radius, pos.z, T.radius * 0.95, contacts);
    for (const ct of contacts) if (ct.depth > 1e-3 && ct.ny < T.walkableNY) return false;
    return true;
  }

  function groundMove(dt, dx, dz, mag) {
    const hs = Math.hypot(vel.x, vel.z);
    if (mag > 0.05) {
      const target = Math.atan2(dx, dz);
      const gn = c.groundNormal, uphill = Math.max(0, -(gn.x * dx + gn.z * dz)) / 0.77;
      let top = T.topSpeed * mag * (1 - T.uphillSlow * Math.min(1, uphill));
      let speed = hs;
      const diff = wrap(target - c.facing);
      if (c.skidding || (hs > 5 && Math.abs(diff) > T.skidAngle)) {
        c.skidding = true;                     // skid along the old direction, then flip
        speed = Math.max(0, hs - T.skidDecel * dt);
        if (speed < 1.5) { c.skidding = false; c.facing = target; }
        const k = hs > 1e-4 ? speed / hs : 0; vel.x *= k; vel.z *= k;
        return;
      }
      if (hs < T.turnInPlaceSpeed) c.facing = target;
      else {
        const t = Math.min(1, (hs - T.turnInPlaceSpeed) / (T.topSpeed - T.turnInPlaceSpeed));
        const rate = T.turnRateSlow + (T.turnRateFast - T.turnRateSlow) * t;
        c.facing = wrap(c.facing + Math.max(-rate * dt, Math.min(rate * dt, diff)));
      }
      if (c.crouching) top *= T.crouchSpeed;
      speed = speed < top ? Math.min(top, speed + T.runAccel * dt) : Math.max(top, speed - (c.crouching ? T.crouchSlideDecel : T.friction) * dt);
      vel.x = Math.sin(c.facing) * speed; vel.z = Math.cos(c.facing) * speed;
    } else {
      c.skidding = false;
      const speed = Math.max(0, hs - T.friction * dt), k = hs > 1e-4 ? speed / hs : 0;
      vel.x *= k; vel.z *= k;
    }
  }

  // Simple mode: approach (dir * walkSpeed) at a very high rate, instant facing, no skid / slope loss.
  function approach(tx, tz, rate, dt) {
    const ex = tx - vel.x, ez = tz - vel.z, L = Math.hypot(ex, ez), st = rate * dt;
    if (L <= st) { vel.x = tx; vel.z = tz; } else { vel.x += ex / L * st; vel.z += ez / L * st; }
  }
  function simpleGroundMove(dt, dx, dz, mag) {
    c.skidding = false;
    if (mag > 0.05) {
      c.facing = Math.atan2(dx, dz);
      const top = S.walkSpeed * Math.min(1, mag * S.stickGain) * (c.crouching ? T.crouchSpeed : 1);
      // crouching at run speed slides down (keeps the crouch + jump = long jump window, as in Pro)
      const slide = c.crouching && Math.hypot(vel.x, vel.z) > top + 0.05;
      approach(dx * top, dz * top, slide ? T.crouchSlideDecel : S.accel, dt);
    } else approach(0, 0, S.decel, dt);
  }
  function simpleAirMove(dt, dx, dz, mag) {
    if (c.airLock > 0) return;
    const hs = Math.hypot(vel.x, vel.z);
    if (mag > 0.05) {
      const target = Math.atan2(dx, dz);
      if (hs > S.walkSpeed + 0.5) {          // long-jump / wall-kick momentum: steer, don't brake
        c.facing = wrap(c.facing + Math.max(-T.airTurnRate * dt, Math.min(T.airTurnRate * dt, wrap(target - c.facing))));
        const cur = Math.atan2(vel.x, vel.z), d = wrap(target - cur);
        let sp = hs;
        if (Math.abs(d) > 2) sp = Math.max(0, hs - S.airAccel * dt);
        const na = cur + Math.max(-T.airSteer * dt, Math.min(T.airSteer * dt, d));
        vel.x = Math.sin(na) * sp; vel.z = Math.cos(na) * sp;
        return;
      }
      c.facing = target;
      const top = S.walkSpeed * Math.min(1, mag * S.stickGain);
      approach(dx * top, dz * top, S.airAccel, dt);
    } else if (hs > 1e-4) {
      const k = Math.max(0, hs - S.airDecel * dt) / hs; vel.x *= k; vel.z *= k;
    }
  }

  function airMove(dt, dx, dz, mag) {
    const hs = Math.hypot(vel.x, vel.z);
    if (c.airLock > 0) return;
    if (mag > 0.05) {
      const target = Math.atan2(dx, dz);
      c.facing = wrap(c.facing + Math.max(-T.airTurnRate * dt, Math.min(T.airTurnRate * dt, wrap(target - c.facing))));
      if (hs > T.topSpeed + 0.5) {            // long-jump momentum: steer, don't brake
        const cur = Math.atan2(vel.x, vel.z), d = wrap(target - cur);
        let sp = hs;
        if (Math.abs(d) > 2) sp = Math.max(0, hs - T.airAccel * dt);
        const na = cur + Math.max(-T.airSteer * dt, Math.min(T.airSteer * dt, d));
        vel.x = Math.sin(na) * sp; vel.z = Math.cos(na) * sp;
      } else {
        const tx = dx * T.topSpeed * mag, tz = dz * T.topSpeed * mag;
        const ex = tx - vel.x, ez = tz - vel.z, L = Math.hypot(ex, ez), st = T.airAccel * dt;
        if (L > 1e-5) { const k = Math.min(1, st / L); vel.x += ex * k; vel.z += ez * k; }
      }
    } else if (hs > 1e-4) {
      const k = Math.max(0, hs - T.airDrag * dt) / hs; vel.x *= k; vel.z *= k;
    }
  }

  function resolve(preVel) {
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      for (let k = 0; k < 2; k++) {
        const oy = k === 0 ? T.radius : Math.max(T.radius, c.height - T.radius);
        col.sphereContacts(pos.x, pos.y + oy, pos.z, T.radius, contacts);
        for (const ct of contacts) {
          if (ct.depth < 1e-5) continue;
          moved = true;
          if (k === 0 && ct.ny >= T.walkableNY) {
            pos.y += Math.min(ct.depth / ct.ny, ct.depth * 3); // vertical push: no sliding on slopes
            if (vel.y <= 0.01) {
              if (vel.y < 0) vel.y = 0;
              c.grounded = true; c.groundCol = ct.col;
              c.groundNormal.x = ct.nx; c.groundNormal.y = ct.ny; c.groundNormal.z = ct.nz;
            }
          } else {
            pos.x += ct.nx * ct.depth; pos.y += ct.ny * ct.depth; pos.z += ct.nz * ct.depth;
            const vn = vel.x * ct.nx + vel.y * ct.ny + vel.z * ct.nz;
            if (vn < 0) { vel.x -= ct.nx * vn; vel.y -= ct.ny * vn; vel.z -= ct.nz * vn; }
            if (ct.ny < -0.5 && vel.y > 0) vel.y = 0;
            if (Math.abs(ct.ny) < 0.35 && ct.col && !ct.col.noWallKick) {
              const nh = Math.hypot(ct.nx, ct.nz), pv = (preVel.x * ct.nx + preVel.z * ct.nz) / nh;
              if (pv < -1) { c.wallTimer = T.wallKickWindow; c.wallN.x = ct.nx / nh; c.wallN.z = ct.nz / nh; }
            }
          }
        }
      }
      if (!moved) break;
    }
  }

  function moveAndCollide(dt) {
    const wasG = c.grounded;
    c.grounded = false; c.groundCol = null;
    const pre = { x: vel.x, y: vel.y, z: vel.z };
    const dx = vel.x * dt, dy = vel.y * dt, dz = vel.z * dt;
    const n = Math.max(1, Math.min(12, Math.ceil(Math.hypot(dx, dy, dz) / (T.radius * 0.5))));
    for (let i = 0; i < n; i++) { pos.x += dx / n; pos.y += dy / n; pos.z += dz / n; resolve(pre); }
    if (!c.grounded && wasG && vel.y <= 0.01 && (c.mode === 'ground' || c.mode === 'poundland')) snapDown();
  }

  // Stick to the ground when walking down slopes/steps: probe downward for a walkable surface only
  // (walls are ignored here so ledges never shove Pip sideways).
  function snapDown(maxD = T.stepSnap) {
    const base = pos.y;
    for (let d = 0.04; d <= maxD + 1e-6; d += 0.04) {
      col.sphereContacts(pos.x, base - d + T.radius, pos.z, T.radius, contacts);
      let best = null;
      for (const ct of contacts) if (ct.ny >= T.walkableNY && ct.depth > 1e-6 && (!best || ct.depth / ct.ny > best.depth / best.ny)) best = ct;
      if (best) {
        pos.y = base - d + Math.min(best.depth / best.ny, d);
        c.grounded = true; c.groundCol = best.col; if (vel.y < 0) vel.y = 0;
        c.groundNormal.x = best.nx; c.groundNormal.y = best.ny; c.groundNormal.z = best.nz;
        return;
      }
    }
  }

  // Simple mode step-up: the move was blocked at the feet -> retry it from stepUp higher, then
  // settle down onto the ledge. Accepted only if Pip lands on walkable ground ≤ stepUp above and
  // got further than the blocked move did.
  const saved = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: false, gc: null, nx: 0, ny: 1, nz: 0, wt: 0 };
  const snapState = o => { o.x = pos.x; o.y = pos.y; o.z = pos.z; o.vx = vel.x; o.vy = vel.y; o.vz = vel.z; o.g = c.grounded; o.gc = c.groundCol;
    o.nx = c.groundNormal.x; o.ny = c.groundNormal.y; o.nz = c.groundNormal.z; o.wt = c.wallTimer; };
  const restore = o => { pos.set(o.x, o.y, o.z); vel.set(o.vx, o.vy, o.vz); c.grounded = o.g; c.groundCol = o.gc;
    c.groundNormal.x = o.nx; c.groundNormal.y = o.ny; c.groundNormal.z = o.nz; c.wallTimer = o.wt; };
  function free(x, y, z) {
    for (const oy of [T.radius, T.height - T.radius]) {
      col.sphereContacts(x, y + oy, z, T.radius * 0.98, contacts);
      for (const ct of contacts) if (ct.depth > 1e-3) return false;
    }
    return true;
  }
  function moveWithStepUp(dt) {
    const sx = pos.x, sy = pos.y, sz = pos.z, vx = vel.x, vz = vel.z, hs = Math.hypot(vx, vz), want = hs * dt;
    moveAndCollide(dt);
    const got = Math.hypot(pos.x - sx, pos.z - sz);
    if (want < 1e-3 || got > want * 0.7) return;
    const up = S.stepUp + 0.02;
    if (!free(sx, sy + up, sz)) return;
    snapState(saved);
    // trial: from stepUp higher, move at least 0.18 m (so the sphere gets over the ledge edge even
    // when the blocked steps before cost some speed), then settle down onto the ledge
    const L = Math.max(want, T.radius * 0.4), ux = vx / hs, uz = vz / hs;
    pos.set(sx, sy + up, sz); vel.set(vx, 0, vz);
    c.grounded = false; c.groundCol = null;
    const pre = { x: vx, y: 0, z: vz };
    const n = Math.max(1, Math.ceil(L / (T.radius * 0.5)));
    for (let i = 0; i < n; i++) { pos.x += ux * L / n; pos.z += uz * L / n; resolve(pre); }
    if (!c.grounded) snapDown(up + 0.04);
    if (!c.grounded || pos.y - sy < 0.03) {
      // the sphere is not over the edge yet: stand on the ledge top under its leading side
      let top = -Infinity;
      for (const k of [0.15, 0.3, 0.42]) top = Math.max(top, col.groundHeight(pos.x + ux * k, pos.z + uz * k, sy + up + 0.01));
      if (top - sy > 0.03 && top - sy <= up + 0.01) {
        pos.y = top; c.grounded = true; c.groundNormal.x = 0; c.groundNormal.y = 1; c.groundNormal.z = 0;
      }
    }
    const rise = pos.y - sy, got2 = Math.hypot(pos.x - sx, pos.z - sz);
    if (c.grounded && c.groundNormal.y >= T.walkableNY && rise > 0.03 && rise <= up + 0.01 && got2 > got + 0.005) {
      vel.y = 0; vel.x = vx; vel.z = vz;    // keep full walk speed
      c.stepUps = (c.stepUps || 0) + 1;
    } else restore(saved);
  }
  // Falling and about to land: a press now is buffered for the landing jump, not spent mid-air.
  function nearLanding() {
    if (vel.y > 0) return false;
    return col.groundHeight(pos.x, pos.z, pos.y + 0.05) > pos.y - S.airJumpGroundGuard;
  }
  // Touch auto-jump probe: a ledge 0.45–1.6 m above the feet right in front, with room on top.
  function ledgeAhead(ix, iz) {
    const d = T.radius + S.autoJumpProbe, px = pos.x + ix * d, pz = pos.z + iz * d;
    col.sphereContacts(px, pos.y + T.radius + 0.1, pz, T.radius * 0.6, contacts);
    let wall = false;
    for (const ct of contacts) if (ct.depth > 1e-3) { wall = true; break; }
    if (!wall) return false;                               // nothing in front at feet level (or a drop)
    const top = col.groundHeight(px, pz, pos.y + S.autoJumpMax + 0.05), h = top - pos.y;
    if (!(h >= S.autoJumpMin - 0.02 && h <= S.autoJumpMax + 0.02)) return false;
    return free(px, top + 0.03, pz);                        // room to stand on it
  }

  function step(dt, a, camYaw) {
    c.time += dt; prev.copy(pos);
    if (c.frozen) return;
    const helper = state.settings.helperMode !== false;
    c.simple = state.settings.moveMode !== 'pro';
    c.sinceGround += dt; c.sinceJumpPress += dt; c.wallTimer -= dt; c.invuln -= dt; c.airLock -= dt;
    if (a.jump.pressed) c.sinceJumpPress = 0;

    // moving-platform carry: inherit the platform's delta from this step
    const gc = c.groundCol;
    if (c.grounded && gc && (gc.dx || gc.dy || gc.dz)) { pos.x += gc.dx; pos.y += gc.dy; pos.z += gc.dz; }

    // stick -> world direction relative to camera yaw (camera sits at +sin/+cos of yaw)
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    let ix = rx * a.move.x + fx * a.move.y, iz = rz * a.move.x + fz * a.move.y;
    const mag = Math.min(1, Math.hypot(ix, iz));
    const groundedAtStart = c.grounded;
    if (mag > 1e-4) { const L = Math.hypot(ix, iz); ix /= L; iz /= L; }

    if (c.mode === 'poundland') {
      vel.x = vel.z = 0; c.lag -= dt;
      if (c.lag <= 0) c.mode = 'ground';
    } else if (c.mode === 'pound') {
      // spin in place, then drop fast
    } else if (c.grounded) {
      // crouch: touch swipe-down hold, or the pound button held while on the ground
      const want = !!((a.crouch && a.crouch.held) || (a.pound && a.pound.held)) && c.mode === 'ground';
      if (want) { setCrouch(true); c.height = T.crouchHeight; }
      else if (c.height < T.height) { if (headroom()) { c.height = T.height; setCrouch(false); } else setCrouch(true); }
      else setCrouch(false);
      if (c.simple) simpleGroundMove(dt, ix, iz, mag); else groundMove(dt, ix, iz, mag);
    } else if (c.simple) simpleAirMove(dt, ix, iz, mag); else airMove(dt, ix, iz, mag);
    if (!c.grounded || c.mode !== 'ground') {
      setCrouch(false);
      if (c.height < T.height && headroom()) c.height = T.height;
    }

    // --- jump family ---
    const wantJump = c.sinceJumpPress <= (helper ? T.buffer : 0);
    const coyoteOk = !c.grounded && helper && c.mode === 'fall' && c.sinceGround < T.coyote && !c.jumpedSinceGround;
    const hs = Math.hypot(vel.x, vel.z);
    if (c.mode !== 'poundland' && c.mode !== 'pound') {
      if ((c.grounded || coyoteOk) && (wantJump || (a.longJump.pressed && c.grounded && hs > T.longJumpMinSpeed))) {
        if (c.grounded && c.crouching && wantJump && hs > T.crouchLongJumpMinSpeed) doLongJump();
        else if (c.grounded && c.crouching && wantJump && hs < T.backflipMaxSpeed) doBackflip();
        else if ((a.longJump.held || a.longJump.pressed) && hs > T.longJumpMinSpeed) doLongJump();
        else if (c.simple) doJump(1);
        else {
          const combo = c.lastJumpTier > 0 && c.lastJumpTier < 3 && (c.time - c.lastLandTime) <= T.comboWindow && hs > T.comboMinSpeed;
          doJump(combo ? c.lastJumpTier + 1 : 1);
        }
      } else if (c.simple && !c.grounded && !c.airJumped && wantJump && c.mode !== 'longjump' && !nearLanding()) {
        doAirJump();
      } else if (!c.grounded && c.wallTimer > 0 && wantJump) {
        vel.x = c.wallN.x * T.wallKickPush; vel.z = c.wallN.z * T.wallKickPush; vel.y = jumpV(T.wallKickApex);
        c.facing = Math.atan2(c.wallN.x, c.wallN.z); c.mode = 'jump'; c.tier = 1; c.cut = false;
        c.wallTimer = 0; c.airLock = T.wallKickLock; c.sinceJumpPress = 9; c.jumpImpulse = 0.8;
        ev('player:wallkick');
      } else if (!c.grounded && a.pound.pressed) {
        c.mode = 'pound'; c.poundTimer = T.poundHang; vel.set(0, 0, 0);
        ev('player:poundstart');
      }
    }

    // --- touch auto-jump (simple mode): held toward a 0.45–1.6 m ledge for 0.12 s ---
    const gcol = c.groundCol, onMover = !!(gcol && col.dynamic && col.dynamic.includes(gcol));
    if (c.simple && c.grounded && c.mode === 'ground' && a.device === 'touch' && state.settings.autoJump !== false &&
      mag >= S.autoJumpMinInput && !c.crouching && !onMover && ledgeAhead(ix, iz)) {
      c.autoT += dt;
      if (c.autoT >= S.autoJumpHold && c.time - c.lastAutoJump >= S.autoJumpCooldown) {
        c.autoT = 0; c.lastAutoJump = c.time; doJump(1, { auto: true });
        ev('player:autojump');
      }
    } else c.autoT = 0;

    // --- gravity ---
    if (c.mode === 'pound') {
      c.poundTimer -= dt;
      if (c.poundTimer > 0) vel.set(0, 0, 0); else { vel.x = vel.z = 0; vel.y = -T.poundSpeed; }
    } else if (!c.grounded) {
      if ((c.mode === 'jump') && !c.cut && !a.jump.held && vel.y > 0) { vel.y *= T.jumpCut; c.cut = true; }
      let g = vel.y > 0 ? T.gravityUp : T.gravityDown;
      if (c.mode === 'longjump') g = T.gravityUp * T.longJumpGravity;
      vel.y = Math.max(-T.maxFall, vel.y - g * dt);
      c.airTime += dt;
    }
    if (c.world && c.world.windAt) {
      const w = c.world.windAt(pos);
      if (w) {
        if (c.grounded) { pos.x += w.x * 0.12 * dt; pos.z += w.z * 0.12 * dt; } // gentle drift on foot
        else { vel.x += w.x * dt; vel.z += w.z * dt; }
      }
    }

    const wasG = c.grounded, airVy = vel.y, prevMode = c.mode;
    if (c.simple && groundedAtStart && c.grounded && c.mode === 'ground' && mag > 0.05) moveWithStepUp(dt);
    else moveAndCollide(dt);

    if (c.grounded) {
      c.sinceGround = 0; c.jumpedSinceGround = false; c.backflip = false; c.airJumped = false; c.jumpBaseY = pos.y;
      const g2 = c.groundCol;
      if (g2 && g2.bounce && prevMode !== 'poundland') {        // mushroom
        vel.y = jumpV(g2.bounce); c.mode = 'jump'; c.cut = true; c.grounded = false; c.tier = 1;
        c.jumpImpulse = 1; c.lastJumpTier = 0;
        if (g2.onBounce) g2.onBounce();
        ev('player:bounce', { apex: g2.bounce });
        return;
      }
      if (g2 && g2.onStand) g2.onStand(c);
    }
    if (c.grounded && !wasG) {
      c.landImpact = Math.min(1, -airVy / 30);
      if (prevMode === 'pound') {
        c.mode = 'poundland'; c.lag = T.poundLag; c.lastJumpTier = 0; c.landImpact = 1;
        ev('player:groundpound', { radius: T.poundRadius });
        if (c.world && c.world.onPound) c.world.onPound(pos, T.poundRadius);
      } else {
        if (prevMode === 'jump') { c.lastLandTime = c.time; c.lastJumpTier = c.tier; } else c.lastJumpTier = 0;
        c.mode = 'ground';
      }
      c.airTime = 0; c.skidding = false;
      ev('player:land', { fallSpeed: +(-airVy).toFixed(1), tier: c.tier });
    } else if (!c.grounded && wasG && c.mode === 'ground') {
      c.mode = 'fall';
    }
  }

  c.step = step;
  c.teleport = (x, y, z, facing) => {
    pos.set(x, y, z); prev.copy(pos); vel.set(0, 0, 0);
    c.mode = 'fall'; c.grounded = false; c.groundCol = null; c.airLock = 0; c.lastJumpTier = 0;
    c.height = T.height; c.backflip = false; setCrouch(false);
    c.airJumped = false; c.jumpBaseY = y; c.autoT = 0;
    if (facing !== undefined) c.facing = facing;
  };
  // Enemy side-touch. Returns true when the bonk limit is reached (caller respawns).
  c.hurt = (fromX, fromZ) => {
    if (c.invuln > 0 || c.mode === 'pound' || c.frozen) return false;
    c.bonks++;
    let dx = pos.x - fromX, dz = pos.z - fromZ; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    vel.x = dx * T.knockback; vel.z = dz * T.knockback; vel.y = jumpV(T.knockApex);
    c.mode = 'fall'; c.grounded = false; c.airLock = 0.35; c.invuln = T.hurtInvuln; c.backflip = false;
    ev('player:hurt', { bonks: c.bonks, max: T.maxBonks });
    return c.bonks >= T.maxBonks;
  };
  c.bounceUp = apex => {
    vel.y = jumpV(apex); c.mode = 'jump'; c.cut = false; c.tier = 1; c.grounded = false; c.jumpImpulse = 0.8; c.backflip = false;
    ev('player:bounce', { apex });
  };
  c.isPounding = () => c.mode === 'pound';
  return c;
}
