/*
 * Sky: gradient dome (deep blue top -> warm pale horizon), a sun disc with a soft glow sprite and
 * 13 puffy low-poly clouds (3 InstancedMeshes, 3-5 merged blobs each) drifting slowly.
 * Animation runs from world's tick handler and stops when the world is still (focus mode).
 */
import * as THREE from '../three.js';
import { rand } from './builder.js';
import { PAL } from './palette.js';

export const SKY = { top: PAL.skyTop, mid: PAL.skyMid, low: PAL.skyLow, horizon: PAL.skyHorizon };
// direction the sun disc sits in (same azimuth as the shadow-casting key light)
export const SUN_DIR = new THREE.Vector3(28, 0, 22).normalize().multiplyScalar(Math.cos(0.5)).setY(Math.sin(0.5));

function glowTexture() {
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d');
  if (c) {
    const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,253,240,1)'); g.addColorStop(0.16, 'rgba(255,248,220,1)');
    g.addColorStop(0.2, 'rgba(255,226,150,0.75)'); g.addColorStop(0.45, 'rgba(255,214,130,0.28)'); g.addColorStop(1, 'rgba(255,214,130,0)');
    c.fillStyle = g; c.fillRect(0, 0, S, S);
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// one cloud = 3-5 merged squashed blobs, vertex colours baked: sunny top, cool blue underside
function cloudGeometry(nBlobs) {
  const parts = [], top = new THREE.Color(PAL.cloud), under = new THREE.Color(PAL.cloudShade), c = new THREE.Color();
  for (let j = 0; j < nBlobs; j++) {
    const r = j === Math.floor(nBlobs / 2) ? 7 + rand() * 2 : 4.5 + rand() * 2.5;
    const g = new THREE.IcosahedronGeometry(r, 1).toNonIndexed();
    g.scale(1.15, 0.62, 0.95);
    g.translate((j - (nBlobs - 1) / 2) * 6.5 + rand() * 2, r * 0.18 + rand() * 1.5, (rand() - 0.5) * 5);
    parts.push(g);
  }
  let n = 0; for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
  for (const g of parts) {
    const P = g.attributes.position.array;
    pos.set(P, o * 3);
    for (let v = 0; v < g.attributes.position.count; v += 3) {
      a.fromArray(P, v * 3); b.fromArray(P, v * 3 + 3); d.fromArray(P, v * 3 + 6);
      const ny = b.sub(a).cross(d.sub(a)).normalize().y;
      const y = (P[v * 3 + 1] + P[v * 3 + 4] + P[v * 3 + 7]) / 3;
      c.copy(under).lerp(top, Math.min(1, Math.max(0, 0.55 + ny * 0.45 + y * 0.03)));
      for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (o + v + k) * 3);
    }
    o += g.attributes.position.count; g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals(); geo.computeBoundingSphere();
  return geo;
}

export function createSky(scene) {
  const geo = new THREE.SphereGeometry(450, 32, 24);
  const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3);
  const top = new THREE.Color(SKY.top), mid = new THREE.Color(SKY.mid), low = new THREE.Color(SKY.low), hor = new THREE.Color(SKY.horizon), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i) / 450;
    if (h > 0.35) c.copy(mid).lerp(top, Math.min(1, (h - 0.35) / 0.5));
    else if (h > 0.1) c.copy(low).lerp(mid, (h - 0.1) / 0.25);
    else if (h > -0.02) c.copy(hor).lerp(low, Math.max(0, (h + 0.02) / 0.12));
    else c.copy(hor);
    cols.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const domeMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  domeMat.name = 'sky-dome';
  const dome = new THREE.Mesh(geo, domeMat);
  dome.renderOrder = -2; dome.frustumCulled = false; dome.name = 'sky-dome';
  scene.add(dome);

  // sun disc + glow (one sprite, procedural canvas texture)
  const sunMat = new THREE.SpriteMaterial({ map: glowTexture(), color: PAL.sun, fog: false, depthWrite: false, transparent: true });
  sunMat.name = 'sun';
  const sun = new THREE.Sprite(sunMat); sun.scale.setScalar(150); sun.renderOrder = -1; sun.name = 'sun';
  scene.add(sun);

  // clouds: 3 shapes x 4-5 instances
  const cloudMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
  cloudMat.name = 'cloud';
  const clouds = [], meshes = [];
  const counts = [5, 4, 4];
  let idx = 0; const total = counts.reduce((a, b) => a + b, 0);
  counts.forEach((cnt, k) => {
    const im = new THREE.InstancedMesh(cloudGeometry(3 + k), cloudMat, cnt);
    im.frustumCulled = false; im.name = 'clouds'; im.castShadow = false; im.receiveShadow = false;
    for (let i = 0; i < cnt; i++, idx++) {
      const a = (idx / total) * Math.PI * 2 + rand() * 0.3, r = 120 + rand() * 150;
      clouds.push({ im, i, x: Math.cos(a) * r, y: 62 + rand() * 40, z: Math.sin(a) * r, s: 0.9 + rand() * 0.7, yaw: rand() * 6.28, speed: 1.2 + rand() * 1.4 });
    }
    scene.add(im); meshes.push(im);
  });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const placeClouds = () => {
    for (const cl of clouds) { q.setFromAxisAngle(up, cl.yaw); sv.setScalar(cl.s); pv.set(cl.x, cl.y, cl.z); m4.compose(pv, q, sv); cl.im.setMatrixAt(cl.i, m4); }
    for (const im of meshes) im.instanceMatrix.needsUpdate = true;
  };
  placeClouds();

  return {
    dome, sun, cloudMeshes: meshes,
    // follow the camera every frame (cheap, no allocations)
    follow(cam) {
      dome.position.copy(cam);
      sun.position.set(cam.x + SUN_DIR.x * 400, cam.y + SUN_DIR.y * 400, cam.z + SUN_DIR.z * 400);
    },
    // drift (driven by the tick event; skipped when still)
    drift(dt) {
      for (const cl of clouds) { cl.x += cl.speed * dt; if (cl.x > 320) cl.x = -320; }
      placeClouds();
    },
  };
}
