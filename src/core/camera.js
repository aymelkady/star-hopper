/*
 * Third-person camera rig (DESIGN.md §2): ~6 m behind, ~2.5 m up, damped follow, auto-rotates
 * behind the direction of travel after 1 s without camera input, manual orbit (Q/E, arrows,
 * right stick, mouse/touch drag), raycast pull-in against world colliders, pitch clamp, invert-Y.
 * yaw: camera sits at focus + (sin(yaw), *, cos(yaw)) * dist, so yaw=0 looks toward -Z.
 */
import * as THREE from '../three.js';

export const CAM = {
  dist: 6.5,                 // sqrt(6² + 2.5²)
  pitch: Math.atan2(2.5, 6), // default pitch (~22.6°)
  minPitch: -0.2, maxPitch: 1.15,
  orbitSpeed: 2.6,           // rad/s at full stick
  pitchSpeed: 1.6,
  mouseYaw: 0.006, mousePitch: 0.005,
  followXZ: 12,              // damping rates (1/s)
  followYGround: 6, followYAir: 2.2,
  autoDelay: 1.0,            // seconds without camera input before auto-rotate
  autoRate: 2.0,             // rad/s-ish at top speed
  pitchReturn: 0.8,
  focusHeight: 1.1,
  pullInRadius: 0.3, minDist: 1.4, pullOutRate: 3,
};

export function createCameraRig(camera, col, getSettings) {
  const focus = new THREE.Vector3();
  const look = new THREE.Vector3();
  const rig = {
    yaw: 0, pitch: CAM.pitch, dist: CAM.dist, curDist: CAM.dist,
    idle: 9, focus, mode: 'follow', // 'follow' | 'orbit' (title screen)
  };
  let groundY = 0;

  rig.snap = (pos, facing) => {
    rig.yaw = (facing ?? 0) + Math.PI; // behind Pip
    rig.pitch = CAM.pitch; focus.set(pos.x, pos.y + CAM.focusHeight, pos.z); groundY = pos.y;
    rig.curDist = rig.dist; rig.idle = 9;
    place(1e9);
  };
  rig.resetBehind = facing => { rig.targetYaw = facing + Math.PI; };

  function place(dt) {
    const cp = Math.cos(rig.pitch), sp = Math.sin(rig.pitch);
    const dx = Math.sin(rig.yaw) * cp, dy = sp, dz = Math.cos(rig.yaw) * cp;
    // pull-in: cast from focus toward the desired spot
    const t = col ? col.castSphere(focus.x, focus.y, focus.z,
      focus.x + dx * rig.dist, focus.y + dy * rig.dist, focus.z + dz * rig.dist, CAM.pullInRadius) : 1;
    const want = Math.max(CAM.minDist, rig.dist * t);
    if (want < rig.curDist) rig.curDist = want;                      // snap in instantly
    else rig.curDist += (want - rig.curDist) * Math.min(1, dt * CAM.pullOutRate); // ease back out
    camera.position.set(focus.x + dx * rig.curDist, focus.y + dy * rig.curDist, focus.z + dz * rig.curDist);
    look.set(focus.x, focus.y + 0.2, focus.z);
    camera.lookAt(look);
  }

  // Called once per rendered frame.
  rig.update = (dt, ctrl, renderPos, camIn, mouse) => {
    const s = getSettings();
    const inv = s.invertY ? -1 : 1, spd = s.cameraSpeed || 1;
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
    rig.pitch = Math.max(CAM.minPitch, Math.min(CAM.maxPitch, rig.pitch));

    // follow target: snappy in XZ, calm in Y while airborne (no bobbing on every hop)
    const kx = 1 - Math.exp(-CAM.followXZ * dt);
    focus.x += (renderPos.x - focus.x) * kx;
    focus.z += (renderPos.z - focus.z) * kx;
    if (ctrl.grounded) groundY = renderPos.y;
    let ty = groundY + CAM.focusHeight;
    if (!ctrl.grounded) {
      // follow upward only when Pip climbs well above, downward when falling below the last ground
      if (renderPos.y > groundY + 3) ty = renderPos.y - 3 + CAM.focusHeight;
      if (renderPos.y < groundY) ty = renderPos.y + CAM.focusHeight;
    }
    const ky = 1 - Math.exp(-(ctrl.grounded ? CAM.followYGround : CAM.followYAir) * dt);
    focus.y += (ty - focus.y) * ky;
    if (Math.abs(renderPos.y + CAM.focusHeight - focus.y) > 6) focus.y = renderPos.y + CAM.focusHeight - Math.sign(renderPos.y + CAM.focusHeight - focus.y) * 6;

    // explicit re-centre (R / Y button)
    if (rig.targetYaw !== undefined) {
      const d = Math.atan2(Math.sin(rig.targetYaw - rig.yaw), Math.cos(rig.targetYaw - rig.yaw));
      rig.yaw += d * Math.min(1, dt * 8);
      if (Math.abs(d) < 0.01) rig.targetYaw = undefined;
    } else if (rig.idle > CAM.autoDelay) {
      // auto-rotate behind movement (helper mode makes it a bit stronger)
      const vx = ctrl.velocity.x, vz = ctrl.velocity.z, hs = Math.hypot(vx, vz);
      if (hs > 1) {
        const desired = Math.atan2(-vx, -vz);
        const d = Math.atan2(Math.sin(desired - rig.yaw), Math.cos(desired - rig.yaw));
        if (Math.abs(d) < 2.6) { // running straight at the camera: leave it alone
          const k = CAM.autoRate * (s.helperMode !== false ? 1 : 0.6) * Math.min(1, hs / 9);
          rig.yaw += d * Math.min(1, k * dt);
        }
      }
      if (rig.idle > CAM.autoDelay + 1) rig.pitch += (CAM.pitch - rig.pitch) * Math.min(1, CAM.pitchReturn * dt);
    }
    place(dt);
  };

  // Title-screen slow orbit around a point
  rig.orbit = (dt, cx, cy, cz, radius, height) => {
    rig.yaw += dt * 0.08;
    camera.position.set(cx + Math.sin(rig.yaw) * radius, cy + height, cz + Math.cos(rig.yaw) * radius);
    camera.lookAt(cx, cy + 4, cz);
  };
  return rig;
}
