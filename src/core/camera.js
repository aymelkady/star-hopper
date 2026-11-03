/*
 * Third-person camera rig (DESIGN.md §2): ~6 m behind, ~2.5 m up, damped follow, auto-rotates
 * behind the direction of travel after 1 s without camera input, manual orbit (Q/E, arrows,
 * right stick, mouse/touch drag), raycast pull-in against world colliders, pitch clamp, invert-Y.
 * yaw: camera sits at focus + (sin(yaw), *, cos(yaw)) * dist, so yaw=0 looks toward -Z.
 *
 * All smoothing is frame-rate independent (render dt, k = 1 - exp(-rate*dt)) so it feels the same
 * at 30, 60 and 120 fps.  Close-quarters rules:
 *  - the pull-in never goes closer than CAM.minDist (2.4 m); when a wall is closer than that the
 *    camera rises (extra pitch) until it has room, and only if no pitch works does it go closer;
 *  - the camera stays >= CAM.groundClear above the ground under it;
 *  - "faders" (Pip, the bell, ...) registered with registerCamFader() fade out when the camera is
 *    too close to them (or, with occlude:true, when they hide Pip);
 *  - under a large prop (fader with large:true) the camera pulls back and up a little.
 */
import * as THREE from '../three.js';

const DEG = Math.PI / 180;
export const CAM = {
  dist: 6.5,                 // sqrt(6² + 2.5²)
  pitch: Math.atan2(2.5, 6), // default pitch (~22.6°)
  minPitch: -35 * DEG, maxPitch: 60 * DEG,
  orbitSpeed: 2.6,           // rad/s at full stick
  pitchSpeed: 1.6,
  mouseYaw: 0.006, mousePitch: 0.005,
  followXZ: 14,              // exponential damping rates (1/s)
  followYGround: 7, followYAir: 2.4,
  autoDelay: 1.0,            // seconds without camera input before auto-rotate
  autoRate: 2.2,             // 1/s at top speed (exponential toward "behind")
  pitchReturn: 0.9,          // 1/s, back to the default pitch 1 s after auto-rotate starts
  resetRate: 9,              // 1/s, R / Y "re-centre behind"
  focusHeight: 1.1,
  lookUpLift: 3.2,           // m of look-target lift per rad of negative pitch (look up from low)
  // close quarters
  pullInRadius: 0.3,
  minDist: 2.4,              // never pull in closer than this while raising can make room
  hardMinDist: 0.9,          // absolute floor when even the max raise is blocked
  pullOutRate: 3.5,          // 1/s ease back out after a pull-in (pull-in itself is instant)
  wallLiftStep: 0.12, wallLiftMax: 0.96, // rad: extra pitch searched when a wall is < minDist
  liftInRate: 22, liftOutRate: 2.5,
  groundClear: 0.6,          // min height above the ground under the camera
  // large props overhead (the Sky Towers bell)
  underPropMargin: 2.0,      // m around the prop's footprint that counts as "under"
  underPropBack: 1.5,        // m extra distance
  underPropMinPitch: 34 * DEG, // pitch floor while under it
  underPropRate: 4,
  fadeRate: 12,              // 1/s opacity smoothing
};

// ---------- faders ----------
// def: {name, object, start, end, min, mode:'point'|'box', point?(out) -> Vector3, occlude?, large?}
// Opacity is 1 at distance >= start, `min` at distance <= end.
const faders = [];
const _box = new THREE.Box3(), _v = new THREE.Vector3(), _hit = new THREE.Vector3(), _ray = new THREE.Ray();
export function registerCamFader(def) {
  const f = { start: 2.2, end: 1.2, min: 0.35, mode: 'box', ...def, opacity: 1, target: 1, mats: [] };
  const seen = new Set();
  f.object.traverse(o => {
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) if (!seen.has(m)) { seen.add(m); f.mats.push({ m, transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite }); }
  });
  const i = faders.findIndex(o => o.name === f.name);
  if (i >= 0) faders.splice(i, 1, f); else faders.push(f);
  return f;
}
function applyOpacity(f, a) {
  const was = f.opacity < 0.999, now = a < 0.999;
  f.opacity = a;
  for (const r of f.mats) {
    r.m.opacity = r.opacity * a;
    if (was !== now) { r.m.transparent = now || r.transparent; r.m.needsUpdate = true; }
  }
}

export function createCameraRig(camera, col, getSettings) {
  const focus = new THREE.Vector3();
  const look = new THREE.Vector3();
  const pipPos = new THREE.Vector3();
  const rig = {
    yaw: 0, pitch: CAM.pitch, dist: CAM.dist, curDist: CAM.dist,
    idle: 9, focus, mode: 'follow', // 'follow' | 'orbit' (title screen)
    lift: 0, under: 0, lastBlocked: 1e9, groundClamped: false, actualPitch: CAM.pitch,
    faders, camera,
  };
  let groundY = 0;
  const expK = (rate, dt) => 1 - Math.exp(-rate * dt);
  const clampPitch = p => Math.max(CAM.minPitch, Math.min(CAM.maxPitch, p));

  rig.snap = (pos, facing) => {
    rig.yaw = (facing ?? 0) + Math.PI; // behind Pip
    rig.pitch = CAM.pitch; focus.set(pos.x, pos.y + CAM.focusHeight, pos.z); groundY = pos.y;
    pipPos.copy(pos);
    rig.curDist = rig.dist; rig.idle = 9; rig.lift = 0; rig.under = 0; rig.targetYaw = undefined;
    place(1e9, true);
  };
  rig.resetBehind = facing => { rig.targetYaw = facing + Math.PI; };
  rig.fader = name => faders.find(f => f.name === name) || null;
  rig.distToFocus = () => camera.position.distanceTo(focus);

  // Desired camera spot for (pitch, dist), lifted to ground clearance; returns the free distance a
  // sphere can travel from the focus toward it (dist * castFraction).
  const spot = new THREE.Vector3();
  function aim(pitch, dist, out) {
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    out.set(focus.x + Math.sin(rig.yaw) * cp * dist, focus.y + sp * dist, focus.z + Math.cos(rig.yaw) * cp * dist);
    if (col) {
      const g = col.groundHeight(out.x, out.z, out.y + CAM.groundClear);
      if (out.y < g + CAM.groundClear) out.y = g + CAM.groundClear;
    }
    return out;
  }
  function freeDist(pitch, dist) {
    aim(pitch, dist, spot);
    const L = spot.distanceTo(focus);
    if (!col) return L;
    return L * col.castSphere(focus.x, focus.y, focus.z, spot.x, spot.y, spot.z, CAM.pullInRadius);
  }

  // Is Pip standing under (or right beside) a large registered prop?
  function underLargeProp() {
    for (const f of faders) {
      if (!f.large) continue;
      _box.setFromObject(f.object);
      const m = CAM.underPropMargin;
      if (pipPos.x > _box.min.x - m && pipPos.x < _box.max.x + m && pipPos.z > _box.min.z - m && pipPos.z < _box.max.z + m &&
        _box.max.y > pipPos.y + 1.2 && _box.min.y < pipPos.y + 7) return true;
    }
    return false;
  }

  function place(dt, instant = false) {
    // under a large prop: pull back and up a little (smoothed)
    const u = underLargeProp() ? 1 : 0;
    rig.under = instant ? u : rig.under + (u - rig.under) * expK(CAM.underPropRate, dt);
    let basePitch = rig.pitch;
    if (rig.under > 0.001) basePitch = Math.max(basePitch, basePitch + (CAM.underPropMinPitch - basePitch) * rig.under);
    const baseDist = rig.dist + CAM.underPropBack * rig.under;

    // wall closer than minDist -> search for a higher pitch with room (raise instead of pulling in)
    let targetLift = 0;
    const free0 = freeDist(basePitch, baseDist);
    if (free0 < Math.min(CAM.minDist, baseDist - 0.05)) {
      let best = 0, bestFree = free0;
      targetLift = CAM.wallLiftMax;
      for (let l = CAM.wallLiftStep; l <= CAM.wallLiftMax + 1e-6; l += CAM.wallLiftStep) {
        const p = Math.min(basePitch + l, CAM.maxPitch + 0.35);
        const fr = freeDist(p, baseDist);
        if (fr >= CAM.minDist) { targetLift = l; best = -1; break; }
        if (fr > bestFree) { bestFree = fr; best = l; }
      }
      if (best >= 0) targetLift = best; // nothing had room: take the roomiest
    }
    if (instant) rig.lift = targetLift;
    else rig.lift += (targetLift - rig.lift) * expK(targetLift > rig.lift ? CAM.liftInRate : CAM.liftOutRate, dt);
    const pitch = Math.min(basePitch + rig.lift, CAM.maxPitch + 0.35);
    rig.actualPitch = pitch;

    const free = freeDist(pitch, baseDist); // also leaves `spot` = ground-clamped desired spot
    const full = spot.distanceTo(focus);
    const want = Math.min(full, Math.max(CAM.hardMinDist, free));
    if (instant || want < rig.curDist) rig.curDist = want;                  // snap in instantly
    else rig.curDist += (want - rig.curDist) * expK(CAM.pullOutRate, dt);   // ease back out
    if (want < full - 0.05) rig.lastBlocked = 0; else rig.lastBlocked += dt;

    // place along focus -> spot at curDist
    _v.subVectors(spot, focus);
    const L = _v.length() || 1;
    camera.position.copy(focus).addScaledVector(_v, rig.curDist / L);
    rig.groundClamped = false;
    if (col) { // safety: never below ground + clearance at the final spot
      const g = col.groundHeight(camera.position.x, camera.position.z, camera.position.y + CAM.groundClear);
      if (camera.position.y < g + CAM.groundClear) { camera.position.y = g + CAM.groundClear; rig.groundClamped = true; }
    }
    look.set(focus.x, focus.y + 0.2 + Math.max(0, -rig.pitch) * CAM.lookUpLift, focus.z);
    camera.lookAt(look);
    updateFaders(instant ? 1e9 : dt);
  }

  function updateFaders(dt) {
    const cam = camera.position;
    for (const f of faders) {
      if (!f.object.parent) continue;
      let d;
      if (f.mode === 'point' && f.point) d = cam.distanceTo(f.point(_v));
      else { _box.setFromObject(f.object); d = _box.distanceToPoint(cam); }
      let t = f.start <= f.end ? (d <= f.end ? 0 : 1) : Math.max(0, Math.min(1, (d - f.end) / (f.start - f.end)));
      if (f.occlude && t > 0) {
        if (f.mode !== 'box') _box.setFromObject(f.object);
        _v.set(focus.x, focus.y - 0.3, focus.z).sub(cam);
        const L = _v.length();
        _ray.set(cam, _v.divideScalar(L || 1));
        const hit = _ray.intersectBox(_box, _hit);
        if (hit && cam.distanceTo(hit) < L - 0.2) t = 0;
      }
      f.target = f.min + (1 - f.min) * t;
      const a = f.opacity + (f.target - f.opacity) * expK(CAM.fadeRate, dt);
      if (Math.abs(a - f.opacity) > 1e-4 || (a === 1) !== (f.opacity === 1)) applyOpacity(f, Math.abs(a - 1) < 2e-3 ? 1 : a);
    }
  }

  // Called once per rendered frame.
  rig.update = (dt, ctrl, renderPos, camIn, mouse) => {
    const s = getSettings();
    const inv = s.invertY ? -1 : 1, spd = s.cameraSpeed || 1;
    pipPos.copy(renderPos);
    let manual = false;
    if (Math.abs(camIn.x) > 0.05 || Math.abs(camIn.y) > 0.05) {
      rig.yaw += camIn.x * CAM.orbitSpeed * spd * dt;
      rig.pitch += camIn.y * CAM.pitchSpeed * spd * dt * inv;
      manual = true;
    }
    if (mouse && (mouse.dx || mouse.dy)) {
      rig.yaw -= mouse.dx * CAM.mouseYaw * spd;
      rig.pitch += mouse.dy * CAM.mousePitch * spd * inv;
      manual = true;
    }
    if (manual) { rig.idle = 0; rig.targetYaw = undefined; } else rig.idle += dt;
    rig.pitch = clampPitch(rig.pitch);

    // follow target: snappy in XZ, calm in Y while airborne (no bobbing on every hop).
    // renderPos is the interpolated physics position, so moving platforms stay smooth.
    const kx = expK(CAM.followXZ, dt);
    focus.x += (renderPos.x - focus.x) * kx;
    focus.z += (renderPos.z - focus.z) * kx;
    if (ctrl.grounded) groundY = renderPos.y;
    let ty = groundY + CAM.focusHeight;
    if (!ctrl.grounded) {
      // follow upward only when Pip climbs well above, downward when falling below the last ground
      if (renderPos.y > groundY + 3) ty = renderPos.y - 3 + CAM.focusHeight;
      if (renderPos.y < groundY) ty = renderPos.y + CAM.focusHeight;
    }
    focus.y += (ty - focus.y) * expK(ctrl.grounded ? CAM.followYGround : CAM.followYAir, dt);
    const dy = renderPos.y + CAM.focusHeight - focus.y;
    if (Math.abs(dy) > 6) focus.y = renderPos.y + CAM.focusHeight - Math.sign(dy) * 6;

    // explicit re-centre (R / Y button)
    if (rig.targetYaw !== undefined) {
      const d = Math.atan2(Math.sin(rig.targetYaw - rig.yaw), Math.cos(rig.targetYaw - rig.yaw));
      rig.yaw += d * expK(CAM.resetRate, dt);
      if (Math.abs(d) < 0.01) rig.targetYaw = undefined;
    } else if (rig.idle > CAM.autoDelay) {
      // auto-rotate behind movement (helper mode makes it a bit stronger)
      const vx = ctrl.velocity.x, vz = ctrl.velocity.z, hs = Math.hypot(vx, vz);
      if (hs > 1) {
        const desired = Math.atan2(-vx, -vz);
        const d = Math.atan2(Math.sin(desired - rig.yaw), Math.cos(desired - rig.yaw));
        if (Math.abs(d) < 2.6) { // running straight at the camera: leave it alone
          const k = CAM.autoRate * (s.helperMode !== false ? 1 : 0.6) * Math.min(1, hs / 9);
          rig.yaw += d * expK(k, dt);
        }
      }
      if (rig.idle > CAM.autoDelay + 1) rig.pitch += (CAM.pitch - rig.pitch) * expK(CAM.pitchReturn, dt);
    }
    place(dt);
  };

  // Title-screen slow orbit around a point
  rig.orbit = (dt, cx, cy, cz, radius, height) => {
    rig.yaw += dt * 0.08;
    camera.position.set(cx + Math.sin(rig.yaw) * radius, cy + height, cz + Math.cos(rig.yaw) * radius);
    camera.lookAt(cx, cy + 4, cz);
    updateFaders(dt);
  };
  return rig;
}
