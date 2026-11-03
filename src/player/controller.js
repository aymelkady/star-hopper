/*
 * Pip's kinematic controller: the whole moveset from DESIGN.md §2.
 * Collision shape = two stacked spheres (feet sphere + head sphere) swept in sub-steps against
 * CollisionWorld.  `position` is the FEET point.  Every feel number lives in TUNING.
 */
import * as THREE from '../three.js';

export const TUNING = {
  radius: 0.45, height: 1.3,        // collision spheres at y=r and y=height-r
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
  // --- helper mode (R6) ---
  coyote: 0.15, buffer: 0.15,
  // --- damage / respawn ---
  killY: -20, maxBonks: 3, hurtInvuln: 1.2, knockback: 8, knockApex: 1.2,
};
const T = TUNING;
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
    world: null,        // set by main: {windAt(pos), onPound(pos,r)}
  };
  const ev = (type, extra = {}) => events.emit(type, { x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), z: +pos.z.toFixed(2), ...extra });

  function doJump(tier) {
    c.tier = tier; c.mode = 'jump'; c.cut = false;
    vel.y = jumpV(T.jumpApex[tier - 1]);
    c.grounded = false; c.jumpedSinceGround = true; c.sinceJumpPress = 9; c.jumpImpulse = 1;
    ev('player:jump', { tier });
  }
  function doLongJump() {
    const f = c.facing;
    const sp = Math.max(T.longJumpSpeed, Math.hypot(vel.x, vel.z));
    vel.x = Math.sin(f) * sp; vel.z = Math.cos(f) * sp;
    vel.y = jumpV(T.longJumpApex, T.gravityUp * T.longJumpGravity);
    c.mode = 'longjump'; c.tier = 0; c.cut = true; c.grounded = false; c.jumpedSinceGround = true; c.sinceJumpPress = 9;
    c.jumpImpulse = 0.6; c.lastJumpTier = 0;
    ev('player:longjump');
  }

  function groundMove(dt, dx, dz, mag) {
    const hs = Math.hypot(vel.x, vel.z);
    if (mag > 0.05) {
      const target = Math.atan2(dx, dz);
      const gn = c.groundNormal, uphill = Math.max(0, -(gn.x * dx + gn.z * dz)) / 0.77;
      const top = T.topSpeed * mag * (1 - T.uphillSlow * Math.min(1, uphill));
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
      speed = speed < top ? Math.min(top, speed + T.runAccel * dt) : Math.max(top, speed - T.friction * dt);
      vel.x = Math.sin(c.facing) * speed; vel.z = Math.cos(c.facing) * speed;
    } else {
      c.skidding = false;
      const speed = Math.max(0, hs - T.friction * dt), k = hs > 1e-4 ? speed / hs : 0;
      vel.x *= k; vel.z *= k;
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
        const oy = k === 0 ? T.radius : T.height - T.radius;
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
  function snapDown() {
    const base = pos.y;
    for (let d = 0.04; d <= T.stepSnap + 1e-6; d += 0.04) {
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

  function step(dt, a, camYaw) {
    c.time += dt; prev.copy(pos);
    if (c.frozen) return;
    const helper = state.settings.helperMode !== false;
    c.sinceGround += dt; c.sinceJumpPress += dt; c.wallTimer -= dt; c.invuln -= dt; c.airLock -= dt;
    if (a.jump.pressed) c.sinceJumpPress = 0;

    // moving-platform carry: inherit the platform's delta from this step
    const gc = c.groundCol;
    if (c.grounded && gc && (gc.dx || gc.dy || gc.dz)) { pos.x += gc.dx; pos.y += gc.dy; pos.z += gc.dz; }

    // stick -> world direction relative to camera yaw (camera sits at +sin/+cos of yaw)
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    let ix = rx * a.move.x + fx * a.move.y, iz = rz * a.move.x + fz * a.move.y;
    const mag = Math.min(1, Math.hypot(ix, iz));
    if (mag > 1e-4) { const L = Math.hypot(ix, iz); ix /= L; iz /= L; }

    if (c.mode === 'poundland') {
      vel.x = vel.z = 0; c.lag -= dt;
      if (c.lag <= 0) c.mode = 'ground';
    } else if (c.mode === 'pound') {
      // spin in place, then drop fast
    } else if (c.grounded) groundMove(dt, ix, iz, mag);
    else airMove(dt, ix, iz, mag);

    // --- jump family ---
    const wantJump = c.sinceJumpPress <= (helper ? T.buffer : 0);
    const coyoteOk = !c.grounded && helper && c.mode === 'fall' && c.sinceGround < T.coyote && !c.jumpedSinceGround;
    const hs = Math.hypot(vel.x, vel.z);
    if (c.mode !== 'poundland' && c.mode !== 'pound') {
      if ((c.grounded || coyoteOk) && (wantJump || (a.longJump.pressed && c.grounded && hs > T.longJumpMinSpeed))) {
        if ((a.longJump.held || a.longJump.pressed) && hs > T.longJumpMinSpeed) doLongJump();
        else {
          const combo = c.lastJumpTier > 0 && c.lastJumpTier < 3 && (c.time - c.lastLandTime) <= T.comboWindow && hs > T.comboMinSpeed;
          doJump(combo ? c.lastJumpTier + 1 : 1);
        }
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
    moveAndCollide(dt);

    if (c.grounded) {
      c.sinceGround = 0; c.jumpedSinceGround = false;
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
    if (facing !== undefined) c.facing = facing;
  };
  // Enemy side-touch. Returns true when the bonk limit is reached (caller respawns).
  c.hurt = (fromX, fromZ) => {
    if (c.invuln > 0 || c.mode === 'pound' || c.frozen) return false;
    c.bonks++;
    let dx = pos.x - fromX, dz = pos.z - fromZ; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    vel.x = dx * T.knockback; vel.z = dz * T.knockback; vel.y = jumpV(T.knockApex);
    c.mode = 'fall'; c.grounded = false; c.airLock = 0.35; c.invuln = T.hurtInvuln;
    ev('player:hurt', { bonks: c.bonks, max: T.maxBonks });
    return c.bonks >= T.maxBonks;
  };
  c.bounceUp = apex => {
    vel.y = jumpV(apex); c.mode = 'jump'; c.cut = false; c.tier = 1; c.grounded = false; c.jumpImpulse = 0.8;
    ev('player:bounce', { apex });
  };
  c.isPounding = () => c.mode === 'pound';
  return c;
}
