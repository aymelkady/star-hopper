/*
 * One procedural heightfield for the whole 200×200 m world (2 m cells) with a hole for the Sky
 * Towers abyss.  The same triangles are used for rendering and for collision.
 * Layout: Hub at the origin, Sunny Meadow to the west (-X), Splash Cove to the east (+X, sea
 * beyond x≈50), Sky Towers floating over the abyss to the north (-Z).
 */
import * as THREE from '../three.js';
import { Heightfield } from '../core/collision.js';
import { rand } from './builder.js';
import { PAL } from './palette.js';

export const WORLD_HALF = 100;
export const WATER_Y = -0.8;
export const ZONE_NAMES = { hub: 'Treehouse Hub', meadow: 'Sunny Meadow', cove: 'Splash Cove', towers: 'Sky Towers' };
export const PATHS = [ // dirt paths painted on the terrain: [x0,z0,x1,z1]
  [-6, 4, -36, 4], [-36, 4, -56, -6], [-56, -6, -62, -16],
  [6, 2, 38, 2], [38, 2, 44, 16],
  [0, -6, 0, -36],
];

const clamp01 = t => t < 0 ? 0 : t > 1 ? 1 : t;
export const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const bump = (x, z, cx, cz, R, H) => { const d = Math.hypot(x - cx, z - cz); return d < R ? H * 0.5 * (1 + Math.cos(Math.PI * d / R)) : 0; };

export function zoneAt(x, z) {
  if (Math.hypot(x, z) < 26) return 'hub';
  if (z < -32 && Math.abs(x) < 44) return 'towers';
  return x < 0 ? 'meadow' : 'cove';
}
export const shoreX = z => 50 + 5 * Math.sin(z * 0.05);
export const HILL = { x: -68, z: -22, r: 24, h: 12 };

export function terrainHeight(x, z) {
  if (z < -36 && Math.abs(x) < 44) return null; // Sky Towers abyss
  const away = smooth(24, 34, Math.hypot(x, z));
  const wm = smooth(-6, -20, x), wc = smooth(6, 20, x);
  let meadow = 0.55 * Math.sin(x * 0.15) * Math.cos(z * 0.12) + 0.35 * Math.sin((x + z) * 0.07) + 0.35;
  meadow += bump(x, z, HILL.x, HILL.z, HILL.r, HILL.h) + bump(x, z, -50, 34, 12, 3) + bump(x, z, -86, -40, 14, 5);
  meadow -= bump(x, z, -84, 2, 8, 1.6);           // waterfall pool
  const sx = shoreX(z);
  let cove = -5.2 * smooth(sx - 5, sx + 12, x) + 0.25 * Math.sin(z * 0.2) * (1 - smooth(sx - 5, sx, x));
  let h = (wm * meadow + wc * cove) * away;
  // a soft ledge before the abyss so the hub edge reads as a cliff top
  if (z < -28 && Math.abs(x) < 44) h = Math.max(h, 0);
  return h;
}

// distance from (x,z) to the nearest dirt path centre line
export function pathDist(x, z) {
  let best = 1e9;
  for (const [x0, z0, x1, z1] of PATHS) {
    const dx = x1 - x0, dz = z1 - z0, L2 = dx * dx + dz * dz;
    const t = clamp01(((x - x0) * dx + (z - z0) * dz) / L2);
    const d = Math.hypot(x - (x0 + dx * t), z - (z0 + dz * t));
    if (d < best) best = d;
  }
  return best;
}
// 0 = grass, 1 = beach sand (cove side of the world)
export function sandAmount(x, z) {
  if (z < -30 && Math.abs(x) < 46) return 0;
  return smooth(15, 23, x);
}

// smooth value noise in [0,1]
function hash(i, j) { let h = (i * 374761393 + j * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
export function noise2(x, z) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export const fbm = (x, z) => noise2(x, z) * 0.6 + noise2(x * 2.3 + 17, z * 2.3 - 9) * 0.3 + noise2(x * 5.1 - 3, z * 5.1 + 7) * 0.1;

const C = {};
for (const k of ['grass', 'grassHi', 'grassLo', 'grassHub', 'grassTop', 'earth', 'earthHi', 'sand', 'sandWet', 'sandDeep', 'leafLo'])
  C[k] = new THREE.Color(PAL[k]);
const _g = new THREE.Color(), _e = new THREE.Color();

// Colour of the ground at a grid vertex (before ambient occlusion).
export function groundColor(x, z, h, out) {
  // grass: two-tone noise (base -> highlight), hollows + low ground toward shadow green
  const n = fbm(x * 0.09, z * 0.09) * 0.75 + noise2(x * 0.31 + 40, z * 0.31) * 0.25;
  _g.copy(C.grass).lerp(C.grassHi, smooth(0.52, 0.76, n) * 0.8);
  _g.lerp(C.grassLo, smooth(0.4, 0.18, n) * 0.6);
  if (h > 4) _g.lerp(C.grassTop, smooth(4, 11, h) * 0.35);
  // dirt paths with a soft edge and a lighter centre
  const pd = pathDist(x, z);
  if (pd < 3 && h > WATER_Y + 0.2) {
    _e.copy(C.earth).lerp(C.earthHi, smooth(1.4, 0.2, pd) * 0.6);
    _e.multiplyScalar(0.94 + noise2(x * 0.6, z * 0.6) * 0.12);
    _g.lerp(_e, smooth(2.7, 1.7, pd));
  }
  // underwater (meadow pool) = wet sand
  if (h < -0.45 && x < 0) _g.lerp(C.sandWet, smooth(-0.45, -0.9, h));
  // beach
  const sa = sandAmount(x, z);
  if (sa > 0) {
    let s;
    if (h > -0.25) s = _e.copy(C.sand).lerp(C.grassHi, 0).multiplyScalar(0.97 + noise2(x * 0.3, z * 0.3) * 0.06);
    else if (h > -1.6) s = _e.copy(C.sand).lerp(C.sandWet, smooth(-0.25, -1.0, h));
    else s = _e.copy(C.sandWet).lerp(C.sandDeep, smooth(-1.6, -3.5, h));
    _g.lerp(s, sa);
  }
  return out.copy(_g);
}

export function buildTerrain(col, material) {
  const cell = 2, n = (WORLD_HALF * 2) / cell, x0 = -WORLD_HALF, z0 = -WORLD_HALF;
  const hf = new Heightfield(x0, z0, cell, n, n);
  const raw = new Array((n + 1) * (n + 1));
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const h = terrainHeight(x0 + i * cell, z0 + j * cell);
    raw[hf.vi(i, j)] = h; hf.h[hf.vi(i, j)] = h ?? -40;
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = raw[hf.vi(i, j)], b = raw[hf.vi(i + 1, j)], c = raw[hf.vi(i, j + 1)], d = raw[hf.vi(i + 1, j + 1)];
    hf.hole[j * n + i] = (a === null || b === null || c === null || d === null) ? 1 : 0;
  }
  col.hf = hf;

  const pos = [], cols = [], gidx = [], jit = [];
  const V = (i, j) => [x0 + i * cell, hf.h[hf.vi(i, j)], z0 + j * cell, hf.vi(i, j)];
  const tri = (p, q, r) => {
    pos.push(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2]);
    const k = 1 + (rand() - 0.5) * 0.06;
    gidx.push(p[3], q[3], r[3]); jit.push(k, k, k); cols.push(0, 0, 0, 0, 0, 0, 0, 0, 0);
  };
  const isHole = (i, j) => i < 0 || j < 0 || i >= n || j >= n ? false : !!hf.hole[j * n + i];
  // layered sandstone cliff skirts along the abyss: grass lip, then bands
  const bands = [PAL.sandstone, PAL.sandstone2, PAL.sandstone4, PAL.sandstone3, PAL.sandstone2, PAL.sandstone].map(h => new THREE.Color(h));
  const lip = new THREE.Color(PAL.grassLo), cc = new THREE.Color();
  const depths = [0, 0.8, 1.2]; for (let d = 3.5; d < 46; d += 2.6 + (depths.length % 3) * 0.6) depths.push(d);
  const skirt = (P, Q) => {
    for (let k = 0; k < depths.length - 1; k++) {
      const a = depths[k], b = depths[k + 1];
      const P1 = [P[0], Math.max(-45, P[1] - a), P[2], -1], Q1 = [Q[0], Math.max(-45, Q[1] - a), Q[2], -1];
      const P2 = [P[0], Math.max(-45, P[1] - b), P[2], -1], Q2 = [Q[0], Math.max(-45, Q[1] - b), Q[2], -1];
      if (k === 0) cc.copy(lip); else if (k === 1) cc.set(PAL.earthLo); else cc.copy(bands[k % bands.length]);
      cc.multiplyScalar(1 - Math.min(0.35, a / 120) + (rand() - 0.5) * 0.05);
      const o = cols.length;
      tri(P1, Q2, Q1); tri(P1, P2, Q2);
      for (let v = o; v < cols.length; v += 3) { cols[v] = cc.r; cols[v + 1] = cc.g; cols[v + 2] = cc.b; }
    }
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (isHole(i, j)) continue;
    const A = V(i, j), B = V(i + 1, j), C2 = V(i, j + 1), D = V(i + 1, j + 1);
    // triangle split must match Heightfield.sample: (a,b,d) when fx>=fz, (a,d,c) otherwise
    tri(A, D, B); tri(A, C2, D);
    if (isHole(i, j - 1)) skirt(B, A);
    if (isHole(i, j + 1)) skirt(C2, D);
    if (isHole(i - 1, j)) skirt(A, C2);
    if (isHole(i + 1, j)) skirt(D, B);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material);
  mesh.receiveShadow = true; mesh.name = 'terrain';
  mesh.userData = { gidx: Int32Array.from(gidx), jit: Float32Array.from(jit), hf, n, cell, x0, z0 };
  paintTerrain(mesh, null);
  return mesh;
}

// (Re)paint terrain vertex colours.  With a collision world: fake ambient occlusion — darken the
// ground around the base of walls, trunks, pillars, rocks and under big props.
export function paintTerrain(mesh, col, extraOccluders = []) {
  const { gidx, jit, hf, n, cell, x0, z0 } = mesh.userData;
  const N = (n + 1) * (n + 1), gc = new Float32Array(N * 3), c = new THREE.Color();
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const vi = hf.vi(i, j), x = x0 + i * cell, z = z0 + j * cell, h = hf.h[vi];
    groundColor(x, z, h, c);
    let ao = 1;
    if (col) {
      const R = 3.2, list = col.query(x - R, z - R, x + R, z + R);
      for (const o of list) {
        if (!o.solid || o.platform || o.bMaxY < h + 0.25 || o.bMinY > h + 1.5) continue;
        const dx = Math.max(o.bMinX - x, 0, x - o.bMaxX), dz = Math.max(o.bMinZ - z, 0, z - o.bMaxZ);
        const tall = Math.min(1, (o.bMaxY - h) / 2.5);
        let d = Math.hypot(dx, dz);
        if (o.kind === 'cyl') d = Math.max(0, Math.hypot(x - o.x, z - o.z) - o.r);
        else if (o.kind === 'sphere') d = Math.max(0, Math.hypot(x - o.x, z - o.z) - o.r * 0.8);
        if (d < R) ao = Math.min(ao, 1 - 0.42 * tall * (1 - d / R) * (1 - d / R));
      }
      for (const [ox, oz, r, k] of extraOccluders) {
        const d = Math.hypot(x - ox, z - oz);
        if (d < r) ao = Math.min(ao, 1 - k * (1 - d / r) * (1 - d / r));
      }
    }
    gc[vi * 3] = c.r * ao; gc[vi * 3 + 1] = c.g * ao; gc[vi * 3 + 2] = c.b * ao;
  }
  const arr = mesh.geometry.attributes.color.array;
  for (let v = 0; v < gidx.length; v++) {
    const g = gidx[v]; if (g < 0) continue;
    const k = jit[v];
    arr[v * 3] = gc[g * 3] * k; arr[v * 3 + 1] = gc[g * 3 + 1] * k; arr[v * 3 + 2] = gc[g * 3 + 2] * k;
  }
  mesh.geometry.attributes.color.needsUpdate = true;
}
