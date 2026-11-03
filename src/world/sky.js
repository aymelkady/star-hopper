// Gradient sky dome (inverted sphere, vertex colours) + slowly drifting flat cloud blobs.
import * as THREE from '../three.js';
import { StaticBuilder, rand } from './builder.js';

export const SKY = { top: 0x3d8ef0, mid: 0x9fd8ff, horizon: 0xd8f2ff, bottom: 0xbfe6ff };

export function createSky(scene) {
  const geo = new THREE.SphereGeometry(450, 32, 20);
  const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3);
  const top = new THREE.Color(SKY.top), mid = new THREE.Color(SKY.mid), hor = new THREE.Color(SKY.horizon), bot = new THREE.Color(SKY.bottom), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i) / 450;
    if (h > 0.25) c.copy(mid).lerp(top, Math.min(1, (h - 0.25) / 0.6));
    else if (h > 0) c.copy(hor).lerp(mid, h / 0.25);
    else c.copy(hor).lerp(bot, Math.min(1, -h / 0.3));
    cols.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.renderOrder = -1; dome.frustumCulled = false;
  scene.add(dome);

  // clouds: each cloud is one merged mesh of a few squashed blobs
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xdde8f5, emissiveIntensity: 0.55, flatShading: true });
  const clouds = [];
  for (let i = 0; i < 9; i++) {
    const b = new StaticBuilder(null, 'cloud');
    const n = 3 + Math.floor(rand() * 3);
    for (let j = 0; j < n; j++) b.sphere((j - n / 2) * 4 + rand() * 2, rand() * 1.5, rand() * 3, 3 + rand() * 2.5, 0xffffff, { sy: 0.45, detail: 1, jitter: 0.03 });
    const m = b.build(mat); m.castShadow = false; m.receiveShadow = false;
    const a = (i / 9) * Math.PI * 2 + rand();
    m.position.set(Math.cos(a) * (90 + rand() * 80), 45 + rand() * 25, Math.sin(a) * (90 + rand() * 80));
    m.userData.speed = 0.6 + rand() * 0.8;
    scene.add(m); clouds.push(m);
  }
  return {
    dome,
    update(dt, focusPos, still) {
      dome.position.copy(focusPos);
      if (still) return;
      for (const m of clouds) { m.position.x += m.userData.speed * dt; if (m.position.x > 200) m.position.x = -200; }
    },
  };
}
