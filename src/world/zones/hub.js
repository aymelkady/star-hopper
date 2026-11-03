// Treehouse Hub: big tree with a treehouse deck, signposts to the three zones, fence at the abyss.
// Gameplay colliders are unchanged; the look is richer wood, a layered leaf canopy, rope railings
// and bunting.
import { PAL } from '../palette.js';
const BARK = PAL.bark, BARK2 = PAL.barkLo, WOOD = PAL.wood, PLANK = PAL.woodHi, POST = PAL.woodLo;
const LEAF_SH = { under: 0.42 };

// sagging rope between two points (thin boxes along a catenary-ish curve)
export function rope(sb, THREE, a, b, sag = 0.35, color = PAL.rope, r = 0.05, n = 6) {
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const p = t => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t];
    const p0 = p(t0), p1 = p(t1);
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2], L = Math.hypot(dx, dy, dz);
    const g = new THREE.CylinderGeometry(r, r, L, 4); g.rotateZ(Math.PI / 2);
    const yaw = Math.atan2(-dz, dx), pitch = Math.atan2(dy, Math.hypot(dx, dz));
    g.rotateZ(pitch); g.rotateY(yaw);
    sb.geo(g, (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2, color, { jitter: 0.02 });
  }
}
// string of triangular pennants hanging from a sagging rope
export function bunting(sb, THREE, a, b, sag = 0.5, colors = [PAL.flagRed, PAL.flowerYellow, PAL.towerBlue, PAL.flagGreen, PAL.flowerPink]) {
  rope(sb, THREE, a, b, sag, PAL.rope, 0.03, 8);
  const L = Math.hypot(b[0] - a[0], b[2] - a[2]), n = Math.max(3, Math.floor(L / 0.9)), yaw = Math.atan2(-(b[2] - a[2]), b[0] - a[0]);
  for (let i = 1; i < n; i++) {
    const t = i / n, x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t, y = a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t);
    const g = new THREE.ConeGeometry(0.26, 0.55, 3); g.rotateX(Math.PI); g.scale(1, 1, 0.12);
    sb.geo(g, x, y - 0.28, z, colors[i % colors.length], { yaw, jitter: 0.02 });
  }
}

export function build({ THREE, sb, P, extra, occlude }) {
  // ---- tree ----
  sb.cyl(0, -0.5, 0, 3.2, 16, BARK, { seg: 10, rTop: 2.4, jitter: 0.12, shade: { ao: 3 } });
  for (let i = 0; i < 6; i++) { const a = i * 1.047 + 0.3; sb.box(Math.cos(a) * 3.3, 0.35, Math.sin(a) * 3.3, 2.2, 0.9, 0.9, BARK2, { yaw: -a, camera: false }); }
  // bark knots + branches into the canopy (decor)
  for (const [a, y] of [[0.8, 4.5], [2.9, 3.2], [4.6, 5.5]]) sb.sphere(Math.cos(a) * 2.95, y, Math.sin(a) * 2.95, 0.45, BARK2, { detail: 0, sz: 0.6 });
  for (const [a, L] of [[0.4, 5], [2.4, 4.6], [4.2, 5.2]]) sb.geo(new THREE.CylinderGeometry(0.35, 0.7, L, 6), Math.cos(a) * 3.2, 13.6, Math.sin(a) * 3.2, BARK, { yaw: -a, roll: -1.0 });
  // layered canopy: big dark core, lighter blobs on top, lime highlights
  sb.sphere(0, 18, 0, 7.5, PAL.leaf, { sy: 0.7, detail: 1, shade: LEAF_SH });
  sb.sphere(4.5, 16, 2, 4.5, PAL.leafHi, { sy: 0.75, detail: 1, shade: LEAF_SH });
  sb.sphere(-4.5, 16.5, -1.5, 4.8, PAL.leafHi, { sy: 0.75, detail: 1, shade: LEAF_SH });
  sb.sphere(0.5, 21.5, -1, 4.5, PAL.leafHi, { sy: 0.8, detail: 1, shade: LEAF_SH });
  sb.sphere(-1.5, 16, 5, 4.2, PAL.leaf, { sy: 0.72, detail: 1, shade: LEAF_SH });
  sb.sphere(2, 16.8, -5, 4.4, PAL.leaf, { sy: 0.72, detail: 1, shade: LEAF_SH });
  sb.sphere(3.2, 20.2, 2.4, 3.2, PAL.leafLime, { sy: 0.8, detail: 1, shade: LEAF_SH });
  sb.sphere(-3.6, 20, 1.5, 2.8, PAL.leafLime, { sy: 0.8, detail: 1, shade: LEAF_SH });
  for (let i = 0; i < 9; i++) { const a = i * 0.7, r = 5 + (i % 3); sb.sphere(Math.cos(a) * r, 17.5 + (i % 2) * 2.5, Math.sin(a) * r, 0.35, i % 2 ? PAL.flagRed : PAL.mushOrange, { detail: 0 }); } // fruit
  occlude(0, 0, 9, 0.25);

  // ---- treehouse deck (ring of planks at y=7) + hut + rope railings ----
  for (const [x, z, sx, sz] of [[0, -4.5, 12, 3], [0, 4.5, 12, 3], [-4.5, 0, 3, 6], [4.5, 0, 3, 6]]) {
    sb.slab(x, 7, z, sx, 0.5, sz, PLANK, { shade: { under: 0.35 } });
    // plank seams
    const along = sx > sz;
    for (let k = -Math.floor((along ? sx : sz) / 2) + 0.75; k < (along ? sx : sz) / 2; k += 1.5)
      sb.box(along ? x + k : x, 7.005, along ? z : z + k, along ? 0.06 : sx - 0.1, 0.02, along ? sz - 0.1 : 0.06, POST, { collide: false, jitter: 0 });
  }
  // support beams under the deck
  for (const [x, z] of [[-5.6, -5.6], [5.6, -5.6], [-5.6, 5.6], [5.6, 5.6]]) sb.cyl(x, 0, z, 0.22, 6.5, POST, { collide: false, seg: 6, shade: { ao: 1.5 } });
  sb.box(-6, 7.5, 0, 0.25, 1, 12, WOOD, { camera: false });
  sb.box(0, 7.5, -6, 12, 1, 0.25, WOOD, { camera: false });
  sb.box(-1.5, 7.5, 6, 9, 1, 0.25, WOOD, { camera: false });
  for (const [x, z] of [[-6, -6], [-6, 0], [-6, 6], [0, -6], [6, -6], [-1.5, 6], [3, 6]]) { sb.cyl(x, 7, z, 0.16, 1.35, POST, { collide: false, seg: 6 }); sb.sphere(x, 8.42, z, 0.16, PAL.gold, { detail: 0 }); }
  rope(sb, THREE, [-6, 8.3, -6], [-6, 8.3, 0]); rope(sb, THREE, [-6, 8.3, 0], [-6, 8.3, 6]);
  rope(sb, THREE, [-6, 8.3, -6], [0, 8.3, -6]); rope(sb, THREE, [0, 8.3, -6], [6, 8.3, -6]);
  rope(sb, THREE, [-1.5, 8.3, 6], [3, 8.3, 6]);
  // hut: cream walls, red pitched roof, door and window
  sb.box(-3.5, 9, -3.5, 4, 3.5, 0.3, PAL.hutWall, { collide: false });
  sb.box(-3.5, 8.3, -3.33, 1.1, 2.1, 0.06, POST, { collide: false, jitter: 0 });
  sb.sphere(-3.1, 8.3, -3.28, 0.08, PAL.gold, { detail: 0 });
  sb.box(-4.9, 9.6, -3.33, 0.9, 0.9, 0.05, PAL.skyLow, { collide: false, jitter: 0 });
  sb.box(-4.9, 9.6, -3.3, 0.08, 0.95, 0.06, POST, { collide: false, jitter: 0 }); sb.box(-4.9, 9.6, -3.3, 0.95, 0.08, 0.06, POST, { collide: false, jitter: 0 });
  sb.box(-2.15, 9.6, -3.33, 0.9, 0.9, 0.05, PAL.skyLow, { collide: false, jitter: 0 });
  { const roof = new THREE.CylinderGeometry(1.6, 1.6, 4.8, 3, 1); roof.rotateZ(Math.PI / 2); sb.geo(roof, -3.5, 11.35, -3.5, PAL.roofRed, { sy: 0.7, sz: 0.75, shade: { under: 0.4 } }); }
  sb.cyl(-1.4, 11.6, -3.5, 0.05, 2.2, POST, { collide: false, seg: 4 });
  sb.geo(new THREE.BoxGeometry(1, 0.6, 0.04), -0.88, 13.4, -3.5, PAL.hubAccent, { jitter: 0 });
  // bunting from the deck corners to the stair top
  bunting(sb, THREE, [-6, 9.4, 6], [-6, 9.4, -6], 0.7);
  bunting(sb, THREE, [-6, 9.4, -6], [6, 9.4, -6], 0.7);

  // ---- staircase up the +x side ----
  for (let k = 1; k <= 6; k++) sb.slab(7.6, 1.1 * k, 6 - 1.8 * k, 2.2, 0.4, 1.8, k % 2 ? PLANK : WOOD, { shade: { under: 0.3 } });
  for (let k = 1; k <= 6; k++) sb.cyl(7.6, -0.2, 6 - 1.8 * k, 0.12, 1.1 * k - 0.2, BARK2, { collide: false, seg: 5 });
  rope(sb, THREE, [8.75, 2.2, 4.2], [8.75, 7.8, -4.8], 0.3);

  // ---- stumps & logs to hop on (ring tops) ----
  for (const [x, z, r, h] of [[-13, 13, 1.2, 1.4], [10, 11, 1.0, 2.2], [-12, -6, 1.4, 1.0]]) {
    sb.cyl(x, -0.2, z, r, h, BARK, { seg: 9, shade: { ao: 0.8 } });
    sb.cyl(x, h - 0.2, z, r * 0.86, 0.03, PAL.logCore, { seg: 9, collide: false, jitter: 0 });
    sb.cyl(x, h - 0.19, z, r * 0.45, 0.03, PAL.woodHi, { seg: 9, collide: false, jitter: 0 });
  }
  // ---- fence along the abyss edge (gap for the bridge) ----
  for (const side of [-1, 1]) {
    sb.box(side * 23.5, 0.9, -35, 41, 0.25, 0.25, WOOD, { camera: false });
    sb.box(side * 23.5, 0.45, -35, 41, 0.9, 0.12, PLANK, { collide: false });
    for (let x = 3.5; x <= 44; x += 4) { sb.cyl(side * x, -0.3, -35, 0.15, 1.4, BARK2, { collide: false, seg: 5 }); }
    for (let x = 3.5; x < 40; x += 8) bunting(sb, THREE, [side * x, 1.1, -35], [side * (x + 8), 1.1, -35], 0.25);
  }
  // flower planters by the signs
  for (const [x, z] of [[-10.6, 9.6], [10.6, 8.6]]) {
    sb.box(x, 0.25, z, 1.4, 0.5, 0.8, WOOD, { collide: false });
    for (let k = 0; k < 4; k++) sb.sphere(x - 0.45 + k * 0.3, 0.62, z + (k % 2) * 0.15, 0.17, [PAL.flowerPink, PAL.flowerYellow, PAL.flowerPurple, PAL.flowerWhite][k], { detail: 0 });
  }

  // signposts (face +z toward the spawn)
  extra.sign(P, -9, 9, '← Sunny Meadow', { bg: '#e8ffd8', fg: '#1f5a14', yaw: 0.25 });
  extra.sign(P, 9, 8, 'Splash Cove →', { bg: '#d8f2ff', fg: '#0f4a7a', yaw: -0.25 });
  extra.sign(P, 5, -12, '↑ Sky Towers', { bg: '#efe4ff', fg: '#4a2a8a', yaw: 0 });

  // coins: ring round the tree, on the deck, trails toward each zone
  P.coinRing(0, 0, 6, 10, 1);
  P.coinRing(0, 0, 4.6, 8, 1, { abs: 7 });
  P.coinLine(7.6, 2.4, 7.6, -3, 3, 1.0, { maxY: 6 });
  P.coinLine(-8, 4, -20, 4, 4, 1);
  P.coinLine(8, 2, 20, 2, 4, 1);
  P.coinLine(0, -8, 0, -22, 4, 1);

  P.checkpoint('hub', -4.5, 9, { facing: Math.PI });
  return { spawn: { x: 0, y: 0.1, z: 14, facing: Math.PI } };
}
