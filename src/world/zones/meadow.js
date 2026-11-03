// Sunny Meadow (west): hilltop flag, 8 red coins, 3 Grumbles, secret star behind the waterfall.
import { HILL } from '../terrain.js';
import { PAL } from '../palette.js';
const ROCK = PAL.stone, ROCK2 = PAL.stoneMid, GRASS = PAL.grass, BARK = PAL.bark;
const LEAVES = [[PAL.leaf, PAL.leafHi], [PAL.leafHi, PAL.leafLime], [PAL.leafLo, PAL.leaf]];
const LEAF_SH = { under: 0.45 };
let treeN = 0;

// round cartoon tree: trunk (same collider as before) + 2-3 canopy blobs with a darker underside
export function tree(sb, g, x, z, s = 1) {
  const y = g(x, z);
  const [A, B] = LEAVES[treeN++ % LEAVES.length];
  sb.cyl(x, y - 0.3, z, 0.45 * s, 3.4 * s, BARK, { seg: 7, rTop: 0.32 * s, shade: { ao: 1.2 } });
  sb.sphere(x, y + 4.1 * s, z, 2.0 * s, A, { detail: 1, collide: false, sy: 0.9, shade: LEAF_SH });
  sb.sphere(x + 0.9 * s, y + 4.9 * s, z - 0.4 * s, 1.35 * s, B, { detail: 1, shade: LEAF_SH });
  if (treeN % 2) sb.sphere(x - 1.0 * s, y + 4.6 * s, z + 0.6 * s, 1.2 * s, B, { detail: 1, shade: LEAF_SH });
  else sb.sphere(x - 0.3 * s, y + 5.5 * s, z + 0.4 * s, 1.0 * s, PAL.leafLime, { detail: 1, shade: LEAF_SH });
}

export function build({ THREE, sb, P, extra, ground: g }) {
  const star = (id, name, x, z, lift, { y, ...opts } = {}) => P.star({ id, zone: 'meadow', name, x, y: (y ?? g(x, z)) + lift, z, ...opts });

  // ---- waterfall cliff (west edge) with a secret alcove behind the falling water ----
  // layered sandstone cliff with a grassy top (same collider boxes as before)
  sb.box(-95, 7, -24, 10, 22, 42, PAL.sandstone, { shade: { ao: 4 } });
  sb.box(-95, 7, 24, 10, 22, 42, PAL.sandstone2, { shade: { ao: 4 } });
  sb.box(-95, 11.5, 0, 10, 13, 6, PAL.sandstone);
  sb.box(-98.5, 0.5, 0, 3, 9, 6, PAL.sandstone3);
  const bandC = [PAL.sandstone2, PAL.sandstone4, PAL.sandstone3, PAL.sandstone4];
  for (let k = 0; k < 5; k++) {
    const y = 0.6 + k * 3.6, hgt = 0.9 + (k % 2) * 0.5;
    for (const zc of [-24, 24]) sb.box(-89.85, y, zc, 0.35, hgt, 41.6, bandC[k % 4], { collide: false, jitter: 0.04 });
    if (y > 5) sb.box(-89.85, y, 0, 0.35, hgt, 6, bandC[k % 4], { collide: false, jitter: 0.04 });
  }
  sb.slab(-95, 18.3, 0, 10.2, 0.4, 90, GRASS, { collide: false });
  sb.slab(-89.7, 18.15, 0, 0.8, 0.7, 90, PAL.grassLo, { collide: false }); // overhanging grass lip
  for (let z = -42; z <= 42; z += 7) if (Math.abs(z) > 5) sb.sphere(-91 - (z % 3), 18.6, z, 1.1 + (Math.abs(z) % 4) * 0.2, PAL.bush, { detail: 1, sy: 0.7, shade: LEAF_SH });
  sb.box(-89.6, 0.2, 0, 1, 1, 6.6, PAL.foam, { collide: false });
  extra.waterfall(P, -89.8, -0.4, 0, 6.6, 18.6, Math.PI / 2);
  for (let i = 0; i < 7; i++) sb.sphere(-88.6 + (i % 2) * 0.4, -0.1, -3 + i * 1.0, 0.75, PAL.foam, { detail: 1, sy: 0.5, jitter: 0.02 });
  sb.box(-89.6, 18.5, 0, 0.8, 0.35, 6.8, PAL.fall, { collide: false, jitter: 0 }); // lip where the water pours over
  const secret = star('meadow-4', 'Secret: behind the waterfall', -95.5, 0, 1.4, { y: g(-95.5, 0, 4) });
  secret.task = 'reach';

  // ---- hilltop flag (star 1) ----
  const top = g(HILL.x, HILL.z);
  sb.cyl(HILL.x + 1.6, top - 0.2, HILL.z, 0.12, 5, PAL.white, { seg: 6 });
  sb.sphere(HILL.x + 1.6, top + 4.9, HILL.z, 0.2, PAL.gold, { detail: 0 });
  sb.box(HILL.x + 2.5, top + 4.2, HILL.z, 1.8, 1.1, 0.08, PAL.flagRed, { collide: false });
  star('meadow-1', 'Reach the hilltop flag', HILL.x - 0.5, HILL.z, 1.5).task = 'reach';
  // rocks up the hill side as friendly steps + a spiral of coins
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9 + 0.6, r = 17 - i * 2;
    const x = HILL.x + Math.cos(a) * r, z = HILL.z + Math.sin(a) * r;
    sb.slab(x, g(x, z) + 0.8, z, 2.4, 2, 2.4, i % 2 ? ROCK : ROCK2, { yaw: a, shade: { top: PAL.grassHi, ao: 1.5 } });
  }
  for (let i = 0; i < 24; i++) {
    const a = i * 0.42 + 2.2, r = 21 - i * 0.78;
    P.coinAt(HILL.x + Math.cos(a) * r, HILL.z + Math.sin(a) * r, 1.1);
  }

  // ---- mushrooms + floating island ----
  P.mushroom(-46, -13, { apex: 9.5 });
  P.mushroom(-60, 14, { apex: 8, color: PAL.mushOrange });
  P.mushroom(-34, 30, { apex: 7, scale: 0.9, color: PAL.mushPurple });
  const islandTop = 9.2;
  sb.slab(-51, islandTop, -22, 6, 1.2, 6, PAL.earth, { shade: { top: GRASS } });
  sb.geo(new THREE.ConeGeometry(3.6, 4, 7), -51, islandTop - 3.2, -22, PAL.earthLo, { pitch: Math.PI });
  for (const [dx, dz] of [[-2.2, -2.2], [2.3, 1.8]]) sb.sphere(-51 + dx, islandTop + 0.35, -22 + dz, 0.7, PAL.bush, { detail: 1, sy: 0.75, shade: LEAF_SH });
  P.coinRing(-51, -22, 1.8, 6, 1, { abs: islandTop });

  // ---- red coins (star 2): 8 spots around the meadow ----
  sb.slab(-40, g(-40, 20) + 3.4, 20, 3, 4, 3, ROCK, { shade: { top: PAL.grassHi, ao: 2 } });                 // rock pillar
  sb.cyl(-88, g(-88, -40) - 0.3, -40, 1.3, 2.8, BARK, { seg: 9, shade: { ao: 1 } }); sb.cyl(-88, g(-88, -40) + 2.5, -40, 1.1, 0.03, PAL.logCore, { seg: 9, collide: false, jitter: 0 });   // tall stump
  sb.slab(-36, g(-36, -26) + 2, -26, 2, 2, 2, PAL.wood);             // crate stack
  sb.slab(-36.4, g(-36, -26) + 3.6, -26.2, 1.4, 1.4, 1.4, PAL.woodHi, { yaw: 0.4 });
  const reds = [
    [-51, -22, islandTop + 1], [-40, 20, g(-40, 20) + 4.4], [-63, 39, null], [-80, -14, null],
    [-80, 10, null], [-88, -40, g(-88, -40) + 3.5], [-60, 14, g(-60, 14) + 7], [-36, -26, g(-36, -26) + 4.6],
  ];
  const red = star('meadow-2', 'Collect 8 red coins', -52, 6, 1.6, { hidden: true, task: 'redcoins' });
  reds.forEach(([x, z, y], i) => P.redCoin('meadow-2', i, x, y ?? g(x, z) + 1.1, z));
  red.target = from => nearest(P.coins.filter(c => c.starId === 'meadow-2' && c.alive), from);

  // ---- Grumbles (star 3) ----
  const bonk = star('meadow-3', 'Bonk the 3 Grumbles', -60, 22, 1.6, { hidden: true, task: 'grumbles' });
  const onPop = (n, total) => {
    if (n >= total) P.revealStar(bonk, 'All Grumbles bonked!');
    else P.events.emit('ui:toast', { text: `Grumble ${n} / ${total}` });
  };
  for (const [id, a, b] of [['meadow-g1', [-44, 13], [-52, 21]], ['meadow-g2', [-66, 31], [-74, 25]], ['meadow-g3', [-74, -3], [-68, 7]]])
    extra.grumble(P, { id, zone: 'meadow', group: 'meadow-3', a, b, speed: 1.6, onPop });
  bonk.target = from => nearest(P.entities.filter(e => e.group === 'meadow-3' && e.alive), from);

  // ---- bonus star (100 coins) ----
  star('bonus-meadow', '100 coins in Sunny Meadow', -40, -8, 1.6, { hidden: true, bonus: true, task: 'bonus' });

  // ---- trees, rocks, flowers ----
  for (const [x, z, s] of [[-50, -36, 1.2], [-30, 33, 1], [-46, 38, 1.1], [-66, 42, 1.3], [-90, 26, 1.2], [-86, -20, 1],
    [-55, -42, 1.1], [-76, 44, 1], [-58, 26, 0.9], [-72, -48, 1.2], [-32, -18, 0.9], [-82, 32, 0.9]]) tree(sb, g, x, z, s);
  for (const [x, z, r] of [[-48, 2, 1.2], [-70, 18, 1.5], [-82, -6, 1.1], [-42, -34, 1.3]]) sb.sphere(x, g(x, z) + 0.2, z, r, ROCK, { detail: 0, collide: true, sy: 0.7, shade: { top: PAL.grassHi } });

  // ---- coins (≥100 in this zone with Grumble drops + red coins) ----
  P.coinLine(-27, 4, -36, 4, 4, 1);
  P.coinRing(-50, 6, 4, 8, 1);
  P.coinRing(-84, 2, 6, 10, 1.6);
  P.coinLine(-42, -30, -80, -46, 10, 1);
  P.coinLine(-36, 20, -70, 44, 10, 1);
  P.coinLine(-87, 0, -95, 0, 4, 1, { maxY: 4 });
  P.coinRing(-60, 22, 5, 8, 1);
  P.coinLine(-28, -12, -28, -34, 6, 1);
  P.coinRing(-80, -30, 4, 8, 1);
  P.coinLine(-86, 12, -86, 40, 6, 1);
  P.coinRing(-88, -40, 2.6, 6, 1, { abs: g(-88, -40) + 2.5 });
  P.coinLine(-56, -6, -62, -16, 4, 1);

  // ---- checkpoints ----
  P.checkpoint('meadow-cp1', -34, 7, { facing: -Math.PI / 2 });
  P.checkpoint('meadow-cp2', -54, -10, { facing: -Math.PI / 2 });
  P.checkpoint('meadow-cp3', -78, 16, { facing: -Math.PI / 2 });
  return {};
}

export function nearest(list, from) {
  let best = null, bd = Infinity;
  for (const o of list) { const d = from ? Math.hypot(o.x - from.x, o.z - from.z) : 0; if (d < bd) { bd = d; best = o; } }
  return best ? { x: best.x, y: best.y + 0.5, z: best.z } : null;
}
