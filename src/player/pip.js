/*
 * Pip: a round little fox-bot built from primitives (sphere body, cone ears, capsule limbs, big
 * eyes, small tail, antenna).  Procedural poses driven by controller state + squash & stretch.
 * Poses: run, air, long jump, triple-jump front flip, backflip (crouch + jump standing still),
 * crouch (body squashed to 70 %, ears flat), ground pound.
 * Pip registers itself as a camera fader: when the camera gets closer than 2.2 m to Pip's body it
 * turns see-through (35 % at 1.2 m) so the player never gets a screen full of fur and tail.
 */
import * as THREE from '../three.js';
import { registerCamFader } from '../core/camera.js';

const POSE = { crouchY: 0.7, crouchRate: 16, earFlat: -1.25, backflipSpin: 8.2 };

let gradient = null;
export function toonGradient() {
  if (gradient) return gradient;
  const data = new Uint8Array([90, 170, 255]); // three tone bands
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false; gradient.needsUpdate = true;
  return gradient;
}
export const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra });

export function createPip() {
  const root = new THREE.Group();     // positioned at feet, yaw = facing
  const body = new THREE.Group();     // squash / flips / lean pivot (at body centre)
  body.position.y = 0.72;
  root.add(body);

  const orange = toon(0xff8a1f), cream = toon(0xfff1d6), dark = toon(0x2b2340), white = toon(0xffffff);
  const teal = toon(0x2ad1c9), glow = new THREE.MeshBasicMaterial({ color: 0x8ffcff });
  const mk = (geo, mat, x = 0, y = 0, z = 0, parent = body) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
  };

  const torso = mk(new THREE.SphereGeometry(0.5, 20, 14), orange);
  torso.scale.set(1, 0.95, 1);
  const belly = mk(new THREE.SphereGeometry(0.36, 16, 12), cream, 0, -0.08, 0.22);
  belly.scale.set(1, 1, 0.6);
  // face: big eyes with pupils + shine
  const eyes = [];
  for (const s of [-1, 1]) {
    const eye = mk(new THREE.SphereGeometry(0.15, 14, 10), white, s * 0.17, 0.12, 0.4);
    eye.scale.set(1, 1.2, 0.6); eyes.push(eye);
    const pupil = mk(new THREE.SphereGeometry(0.085, 12, 8), dark, s * 0.17, 0.12, 0.49);
    pupil.scale.set(1, 1.25, 0.5);
    mk(new THREE.SphereGeometry(0.03, 8, 6), white, s * 0.15, 0.17, 0.53);
  }
  const nose = mk(new THREE.SphereGeometry(0.055, 10, 8), dark, 0, 0.0, 0.5);
  nose.scale.set(1.3, 0.8, 0.8);
  // ears
  const ears = [];
  for (const s of [-1, 1]) {
    const ear = mk(new THREE.ConeGeometry(0.17, 0.42, 12), orange, s * 0.27, 0.48, -0.02);
    ear.rotation.z = -s * 0.35;
    const inner = mk(new THREE.ConeGeometry(0.09, 0.25, 10), cream, 0, -0.04, 0.07, ear);
    inner.rotation.x = 0.05;
    ears.push(ear);
  }
  // antenna (the "bot" part)
  const ant = mk(new THREE.CylinderGeometry(0.02, 0.02, 0.28, 6), dark, 0, 0.6, -0.08);
  mk(new THREE.SphereGeometry(0.065, 10, 8), glow, 0, 0.17, 0, ant);
  // tail
  const tailPivot = new THREE.Group(); tailPivot.position.set(0, -0.2, -0.45); body.add(tailPivot);
  const tail = mk(new THREE.ConeGeometry(0.16, 0.5, 10), orange, 0, 0.1, -0.15, tailPivot);
  tail.rotation.x = -2.2;
  mk(new THREE.SphereGeometry(0.1, 10, 8), cream, 0, -0.27, 0, tail);
  // limbs: capsules on pivots (shoulder / hip)
  const limb = (x, y, z, len, mat) => {
    const p = new THREE.Group(); p.position.set(x, y, z); body.add(p);
    const m = mk(new THREE.CapsuleGeometry(0.1, len, 4, 10), mat, 0, -len / 2 - 0.05, 0, p);
    return { p, m };
  };
  const armL = limb(-0.46, 0.0, 0.05, 0.22, orange), armR = limb(0.46, 0.0, 0.05, 0.22, orange);
  const legL = limb(-0.2, -0.38, 0.0, 0.18, teal), legR = limb(0.2, -0.38, 0.0, 0.18, teal);
  for (const l of [legL, legR]) { // feet
    const f = mk(new THREE.SphereGeometry(0.13, 12, 8), dark, 0, -0.3, 0.05, l.p); f.scale.set(1, 0.6, 1.4);
  }
  armL.p.rotation.z = 0.25; armR.p.rotation.z = -0.25;

  // blob shadow helps depth perception when jumping (cheap, always readable)
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2; blob.renderOrder = 1;

  registerCamFader({ name: 'pip', object: root, mode: 'point', start: 2.2, end: 1.2, min: 0.35,
    point: out => out.set(root.position.x, root.position.y + 0.72, root.position.z) });

  let sq = 1, sqV = 0, phase = 0, flip = 0, spin = 0, blink = 0, t = 0, crouch = 0;
  const _corr = new THREE.Vector3();
  const lerp = (a, b, k) => a + (b - a) * k;

  function update(dt, c, renderPos, groundY) {
    t += dt;
    root.position.copy(renderPos);
    // Moving platforms are placed at the physics-step position, Pip at the interpolated one: put
    // Pip back onto the platform's step position so the two never shimmer against each other.
    const gc = c.grounded && c.groundCol;
    if (gc && (gc.dx || gc.dy || gc.dz)) {
      const p0 = c.prevPosition, p1 = c.position;
      _corr.subVectors(p1, p0); const L2 = _corr.lengthSq();
      if (L2 > 1e-10) {
        const alpha = Math.max(0, Math.min(1, ((renderPos.x - p0.x) * _corr.x + (renderPos.y - p0.y) * _corr.y + (renderPos.z - p0.z) * _corr.z) / L2));
        root.position.x += (1 - alpha) * gc.dx; root.position.y += (1 - alpha) * gc.dy; root.position.z += (1 - alpha) * gc.dz;
      }
    }
    // smooth yaw
    const d = Math.atan2(Math.sin(c.facing - root.rotation.y), Math.cos(c.facing - root.rotation.y));
    root.rotation.y += d * Math.min(1, dt * 18);

    // squash & stretch spring (critically-ish damped)
    if (c.jumpImpulse) { sqV += 5 * c.jumpImpulse; c.jumpImpulse = 0; }
    if (c.landImpact) { sqV -= 7 * c.landImpact; c.landImpact = 0; }
    sqV += (-(sq - 1) * 180 - sqV * 14) * dt;
    sq = Math.max(0.6, Math.min(1.45, sq + sqV * dt));

    const hs = Math.hypot(c.velocity.x, c.velocity.z), run = Math.min(1, hs / 9);
    const air = !c.grounded && c.mode !== 'poundland';
    let lean = 0, armSwing = 0, legSwing = 0, armUp = 0, legTuck = 0, bob = 0;
    if (!air) {
      phase += dt * (4 + hs * 1.6);
      legSwing = Math.sin(phase) * 1.0 * run;
      armSwing = -Math.sin(phase) * 0.9 * run;
      bob = Math.abs(Math.sin(phase)) * 0.08 * run + Math.sin(t * 2.2) * 0.015 * (1 - run);
      lean = run * 0.18 + (c.skidding ? -0.45 : 0);
      flip = 0; spin = 0;
    } else {
      const rising = c.velocity.y > 0;
      armUp = rising ? 2.4 : 1.4; legTuck = rising ? 0.6 : 0.2;
      if (c.mode === 'longjump') { lean = 1.1; armUp = 2.8; legTuck = -0.6; }
      if (c.mode === 'jump' && c.tier === 3) flip = Math.min(Math.PI * 2, flip + dt * 11); // triple-jump front flip
      if (c.mode === 'jump' && c.backflip) { flip = Math.max(-Math.PI * 2, flip - dt * POSE.backflipSpin); armUp = 2.6; legTuck = 0.9; }
    }
    // crouch: squash to 70 %, ears flat, limbs tucked
    crouch += ((c.crouching && !air ? 1 : 0) - crouch) * (1 - Math.exp(-POSE.crouchRate * dt));
    if (crouch > 0.01) { legTuck += 0.5 * crouch; lean += 0.12 * crouch; bob *= 1 - crouch * 0.7; }
    if (c.mode === 'pound') { spin += dt * 30; legTuck = 1.2; armUp = 0.4; lean = 0; }
    if (c.mode === 'poundland') { armUp = 0.6; legTuck = 0.3; }

    const cy = 1 + (POSE.crouchY - 1) * crouch;  // body scale y 1 -> 0.7 while crouching
    body.position.y = 0.72 * sq * cy + bob;
    body.rotation.set(lean + flip, 0, 0);
    body.rotation.y = c.mode === 'pound' && spin < Math.PI * 2 ? spin : 0;
    const w = 1 / Math.sqrt(sq);
    body.scale.set(w * (1 + 0.12 * crouch), sq * cy, w * (1 + 0.12 * crouch));
    armL.p.rotation.x = lerp(armL.p.rotation.x, armSwing - armUp, 0.4);
    armR.p.rotation.x = lerp(armR.p.rotation.x, -armSwing - armUp, 0.4);
    armL.p.rotation.z = lerp(armL.p.rotation.z, 0.25 + armUp * 0.15, 0.3);
    armR.p.rotation.z = -armL.p.rotation.z;
    legL.p.rotation.x = lerp(legL.p.rotation.x, legSwing - legTuck, 0.45);
    legR.p.rotation.x = lerp(legR.p.rotation.x, -legSwing - legTuck, 0.45);
    tailPivot.rotation.y = Math.sin(t * (3 + hs)) * 0.5;
    tailPivot.rotation.x = air ? -0.4 : 0;
    ears[0].rotation.x = ears[1].rotation.x = (-run * 0.4 + (air ? -0.3 : 0)) * (1 - crouch) + POSE.earFlat * crouch;
    ant.rotation.x = -run * 0.5 + Math.sin(t * 6) * 0.05;
    // blink
    blink -= dt;
    const blinking = blink < 0.12 && blink > 0;
    if (blink < 0) blink = 2 + Math.random() * 3;
    for (const e of eyes) e.scale.y = blinking ? 0.15 : 1.2;
    // hurt flicker
    root.visible = !(c.invuln > 0 && Math.floor(t * 20) % 2 === 0);
    // blob shadow on the ground under Pip
    if (groundY > -1e8) {
      blob.visible = true; blob.position.set(renderPos.x, groundY + 0.03, renderPos.z);
      const h = Math.max(0, renderPos.y - groundY), s = Math.max(0.35, 1 - h * 0.06);
      blob.scale.set(s, s, s); blob.material.opacity = 0.3 * s;
    } else blob.visible = false;
  }
  return { root, blob, update };
}
