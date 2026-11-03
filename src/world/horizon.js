/*
 * Horizon: everything beyond the playable 200x200 m square, render-only (no colliders).
 *  - outer land: rolling foothills continuing the terrain outward (sea to the east, a deep valley
 *    north of the Sky Towers abyss, the plateau above the waterfall cliff to the west)
 *  - a cloud sea filling the abyss below the Sky Towers
 *  - 3 rings of low-poly mountains (near green, mid blue-green, far hazy blue), snow caps on tall ones
 * All merged into ONE vertex-coloured mesh (1 draw call, no shadows).
 */
import * as THREE from '../three.js';
import { rand } from './builder.js';
import { PAL } from './palette.js';
import { terrainHeight, groundColor, fbm, noise2, smooth, WATER_Y } from './terrain.js';

const col = h => new THREE.Color(h);
// baked light for the unlit horizon mesh: sun from +x/+z, high
const SUN = new THREE.Vector3(0.42, 0.82, 0.33).normalize();
function bake(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const L = Math.hypot(nx, ny, nz) || 1;
  nx /= L; ny /= L; nz /= L; if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
  return 0.62 + 0.42 * Math.max(0, nx * SUN.x + ny * SUN.y + nz * SUN.z);
}

export function outerHeight(x, z) {
  const ax = Math.abs(x), az = Math.abs(z);
  const cx = Math.max(-100, Math.min(100, x)), cz = Math.max(-100, Math.min(100, z));
  const d = Math.max(ax, az) - 100;
  let base = terrainHeight(cx, cz);
  if (base === null) base = -45;
  // plateau above the waterfall cliff
  if (x < -99) base = Math.max(base, 18.3 * (1 - smooth(46, 60, az)));
  const rise = Math.pow(smooth(0, 170, d), 1.6) * (16 + 30 * fbm(x * 0.012 + 3, z * 0.012 - 5)) + smooth(0, 30, d) * 1.5 * noise2(x * 0.08, z * 0.08);
  let h = base + rise;
  // deep valley continuing the Sky Towers abyss to the north (filled by the cloud sea)
  if (z < -36) {
    const dz = Math.max(0, -z - 100);
    const v = (1 - smooth(46 + dz * 0.9, 80 + dz * 1.6, ax)) * (1 - smooth(230, 330, -z));
    h += (-45 - h) * v;
  }
  // the sea to the east (its north shore stays clear of the abyss valley)
  const sea = smooth(44, 80, x) * Math.max(smooth(-106, -98, z), smooth(170, 240, x)) * (z > -40 || x > 60 ? 1 : smooth(60, 90, x));
  h += (-7 - h) * sea;
  return h;
}

function outerColor(x, z, h, d, out) {
  groundColor(Math.max(-100, Math.min(100, x)), Math.max(-100, Math.min(100, z)), h, out);
  if (h < WATER_Y - 0.5) return out.set(PAL.sandDeep);
  const g = out.clone ? out : out;
  // further out: darker meadow, then mountain-green on the high slopes
  const t = smooth(10, 90, d), hi = smooth(14, 40, h);
  const base = new THREE.Color(PAL.grass).lerp(col(PAL.grassLo), 0.35 + 0.4 * fbm(x * 0.03, z * 0.03));
  g.lerp(base, t);
  g.lerp(col(PAL.mtnNearHi), hi * 0.5);
  if (h < WATER_Y + 1.2 && x > 30) g.lerp(col(PAL.sand), 0.9);
  return g;
}

// low-poly mountain: base ring, two jagged rings, apex.  Pushes coloured triangles.
function mountain(push, x, z, R, H, layer, snowy) {
  const k = 7 + Math.floor(rand() * 3), rot = rand() * 6.28;
  const ringR = [1, 0.62, 0.34, 0], ringH = [-30, 0.42, 0.7, 1];
  const off = [rand() - 0.5, rand() - 0.5];
  const rings = ringR.map((rr, ri) => {
    const pts = [];
    const n = ri === 3 ? 1 : k;
    for (let i = 0; i < n; i++) {
      const a = rot + (i / k) * Math.PI * 2 + (rand() - 0.5) * 0.35;
      const r = R * rr * (0.85 + rand() * 0.3);
      const y = ri === 0 ? -30 : H * (ringH[ri] + (rand() - 0.5) * 0.12 * (ri < 3 ? 1 : 0));
      const sh = R * 0.3 * Math.max(0, ringH[ri]);
      pts.push([x + Math.cos(a) * r + off[0] * sh, y, z + Math.sin(a) * r + off[1] * sh]);
    }
    return pts;
  });
  const C = layer === 0 ? [col(PAL.mtnNear), col(PAL.mtnNearHi), col(PAL.mtnNearRock)]
    : layer === 1 ? [col(PAL.mtnMid), col(PAL.mtnMidHi), col(PAL.mtnMid).lerp(col(PAL.mtnNearRock), 0.3)]
      : [col(PAL.mtnFar), col(PAL.mtnFarHi), col(PAL.mtnFar).lerp(col(PAL.mtnFarHi), 0.5)];
  const snow = col(PAL.snow), snowLo = col(PAL.snowShade);
  const tri = (a, b, c, band) => {
    // light from the sun side (+x,+z) baked a little into the face colour
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
    const lit = bake(a, b, c) * 1.02;
    let cc;
    if (band === 0) cc = C[0].clone();
    else if (band === 1) cc = (snowy ? C[2] : C[1]).clone().lerp(C[1], 0.3);
    else cc = snowy ? (lit > 0.95 ? snow.clone() : snowLo.clone()) : C[1].clone();
    cc.multiplyScalar(snowy && band === 2 ? Math.min(1.05, lit + 0.1) : lit);
    push(a, b, c, cc);
  };
  for (let ri = 0; ri < 3; ri++) {
    const A = rings[ri], B = rings[ri + 1];
    for (let i = 0; i < k; i++) {
      const a0 = A[i], a1 = A[(i + 1) % k];
      if (ri === 2) { tri(a0, B[0], a1, 2); continue; }
      const b0 = B[i], b1 = B[(i + 1) % k];
      tri(a0, b0, a1, ri); tri(a1, b0, b1, ri);
    }
  }
}

export function buildHorizon(material) {
  const pos = [], cols = [];
  const push = (a, b, c, cc) => { pos.push(...a, ...b, ...c); for (let i = 0; i < 3; i++) cols.push(cc.r, cc.g, cc.b); };

  // ---- outer land (10 m cells near, skipping the playable square) ----
  const E = 520, cell = 10, n = (E * 2) / cell;
  const H = new Float32Array((n + 1) * (n + 1));
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = -E + i * cell, z = -E + j * cell;
    H[j * (n + 1) + i] = outerHeight(x, z) - (Math.max(Math.abs(x), Math.abs(z)) <= 100 ? 0.35 : 0);
  }
  const cc = new THREE.Color(), cc2 = new THREE.Color();
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -E + i * cell, z = -E + j * cell;
    if (x >= -100 && x + cell <= 100 && z >= -100 && z + cell <= 100) continue;
    const P = (ii, jj) => [-E + ii * cell, H[jj * (n + 1) + ii], -E + jj * cell];
    const a = P(i, j), b = P(i + 1, j), c = P(i, j + 1), d = P(i + 1, j + 1);
    for (const [p, q, r] of [[a, d, b], [a, c, d]]) {
      const mx = (p[0] + q[0] + r[0]) / 3, my = (p[1] + q[1] + r[1]) / 3, mz = (p[2] + q[2] + r[2]) / 3;
      if (my < -8 && mx > 40) continue; // under the sea: never visible
      outerColor(mx, mz, my, Math.max(Math.abs(mx), Math.abs(mz)) - 100, cc);
      cc.multiplyScalar((0.96 + rand() * 0.08) * bake(p, q, r));
      push(p, q, r, cc);
    }
  }

  const mStart = pos.length;
  // ---- mountains: 3 rings (near / mid / far), sea gap to the east ----
  const layers = [
    { r: [175, 205], h: [36, 62], R: [45, 66], n: 28, gap: 1.0, snowAt: 999 },
    { r: [225, 265], h: [70, 115], R: [60, 90], n: 22, gap: 0.62, snowAt: 92 },
    { r: [305, 350], h: [105, 170], R: [70, 110], n: 20, gap: 0, snowAt: 120 },
  ];
  layers.forEach((L, li) => {
    L.minIn = li === 0 ? 128 : 150;
    for (let i = 0; i < L.n; i++) {
      const a = (i / L.n) * Math.PI * 2 + rand() * 0.2;
      const ex = Math.cos(a), ez = Math.sin(a);
      let hScale = 1;
      if (ex > 0.35) { // east = sea: near ring skipped, the rest low and far like distant islands
        if (L.gap && ex > 1 - L.gap * 0.8) continue;
        hScale = 0.5;
      }
      let r = L.r[0] + rand() * (L.r[1] - L.r[0]);
      if (ez < -0.55) r += [110, 90, 50][li]; // north: rise out of the cloud sea, well beyond the towers
      const Hh = (L.h[0] + rand() * (L.h[1] - L.h[0])) * hScale;
      const R = Math.min(L.R[0] + rand() * (L.R[1] - L.R[0]), (r - L.minIn) / 1.15);
      mountain(push, ex * r, ez * r, R, Hh, li, Hh > L.snowAt);
    }
  });

  // misty mountain feet: low vertices fade toward the haze colour
  const haze = new THREE.Color(PAL.skyHorizon);
  for (let i = mStart; i < pos.length; i += 3) {
    const t = smooth(14, -16, pos[i + 1]) * 0.8;
    if (t > 0) { cols[i] += (haze.r - cols[i]) * t; cols[i + 1] += (haze.g - cols[i + 1]) * t; cols[i + 2] += (haze.b - cols[i + 2]) * t; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals(); g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material);
  mesh.name = 'horizon'; mesh.castShadow = false; mesh.receiveShadow = false; mesh.frustumCulled = false;
  return mesh;
}

// Soft lumpy cloud sea filling the abyss below the Sky Towers (unlit, baked shading).
export function buildCloudSea(material) {
  const pos = [], cols = [];
  const cs = 7, x0 = -200, x1 = 200, z0 = -34, z1 = -440;
  const cy = (x, z) => -17 + 3 * fbm(x * 0.04, z * 0.04) + 1.2 * noise2(x * 0.18, z * 0.18);
  const white = new THREE.Color(PAL.cloud), shade = new THREE.Color(PAL.cloudShade), c = new THREE.Color();
  for (let z = z0; z > z1; z -= cs) for (let x = x0; x < x1; x += cs) {
    // only where the ground is below the cloud tops (the abyss + the valley beyond)
    const lowest = Math.min(outerHeight(x, z), outerHeight(x + cs, z), outerHeight(x, z - cs), outerHeight(x + cs, z - cs));
    if (lowest > -12) continue;
    const a = [x, cy(x, z), z], b = [x + cs, cy(x + cs, z), z], cc = [x, cy(x, z - cs), z - cs], d = [x + cs, cy(x + cs, z - cs), z - cs];
    for (const [p, q, r] of [[a, b, d], [a, d, cc]]) {
      const my = (p[1] + q[1] + r[1]) / 3;
      c.copy(shade).lerp(white, smooth(-17.2, -14.6, my));
      pos.push(...p, ...q, ...r); for (let k = 0; k < 3; k++) cols.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals(); g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material);
  mesh.name = 'cloud-sea'; mesh.frustumCulled = false;
  return mesh;
}
