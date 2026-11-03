/*
 * One procedural heightfield for the whole 200×200 m world (2 m cells) with a hole for the Sky
 * Towers abyss.  The same triangles are used for rendering and for collision.
 * Layout: Hub at the origin, Sunny Meadow to the west (-X), Splash Cove to the east (+X, sea
 * beyond x≈50), Sky Towers floating over the abyss to the north (-Z).
 */
import * as THREE from '../three.js';
import { Heightfield } from '../core/collision.js';
import { rand } from './builder.js';

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

function onPath(x, z) {
  for (const [x0, z0, x1, z1] of PATHS) {
    const dx = x1 - x0, dz = z1 - z0, L2 = dx * dx + dz * dz;
    const t = clamp01(((x - x0) * dx + (z - z0) * dz) / L2);
    if (Math.hypot(x - (x0 + dx * t), z - (z0 + dz * t)) < 2.2) return true;
  }
  return false;
}

function faceColor(cx, cz, h, c) {
  const zone = zoneAt(cx, cz);
  if (onPath(cx, cz) && h > WATER_Y + 0.2) return c.setHex(0xd8b273);
  if (zone === 'cove' || (cx > 20 && zone !== 'towers')) {
    if (h > -0.25) return c.setHex(0xf4dd98);
    if (h > -1.6) return c.setHex(0xdcc07c);
    return c.setHex(0xb59f72);
  }
  if (cz < -30 && Math.abs(cx) < 46) return c.setHex(0x9ccf6a);
  if (h < -0.5) return c.setHex(0xcbbd86);
  if (h > 8) return c.setHex(0xa9e06c);
  if (h > 3.5) return c.setHex(0x8fd65c);
  return c.setHex(zone === 'hub' ? 0x86d45c : 0x72c44c);
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

  const pos = [], cols = [], color = new THREE.Color();
  const V = (i, j) => [x0 + i * cell, hf.h[hf.vi(i, j)], z0 + j * cell];
  const tri = (p, q, r, cc) => {
    pos.push(...p, ...q, ...r);
    const k = 1 + (rand() - 0.5) * 0.1;
    for (let t = 0; t < 3; t++) cols.push(cc.r * k, cc.g * k, cc.b * k);
  };
  const isHole = (i, j) => i < 0 || j < 0 || i >= n || j >= n ? false : !!hf.hole[j * n + i];
  const rock = new THREE.Color(0x8e8199), rock2 = new THREE.Color(0x7a6e88);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (isHole(i, j)) continue;
    const A = V(i, j), B = V(i + 1, j), C = V(i, j + 1), D = V(i + 1, j + 1);
    // triangle split must match Heightfield.sample: (a,b,d) when fx>=fz, (a,d,c) otherwise
    faceColor((A[0] + B[0] + D[0]) / 3, (A[2] + B[2] + D[2]) / 3, (A[1] + B[1] + D[1]) / 3, color); tri(A, D, B, color);
    faceColor((A[0] + C[0] + D[0]) / 3, (A[2] + C[2] + D[2]) / 3, (A[1] + C[1] + D[1]) / 3, color); tri(A, C, D, color);
    // cliff skirts along hole edges
    const skirt = (P, Q) => {
      const P2 = [P[0], -45, P[2]], Q2 = [Q[0], -45, Q[2]];
      const cc = rand() < 0.5 ? rock : rock2;
      tri(P, Q2, Q, cc); tri(P, P2, Q2, cc);
    };
    if (isHole(i, j - 1)) skirt(B, A);
    if (isHole(i, j + 1)) skirt(C, D);
    if (isHole(i - 1, j)) skirt(A, C);
    if (isHole(i + 1, j)) skirt(D, B);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material);
  mesh.receiveShadow = true; mesh.name = 'terrain';
  return mesh;
}
