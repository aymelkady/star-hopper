// Sky Towers (north, over the abyss): bell climb, triple-jump gap, red-coin spiral, 4 chimes.
import { nearest } from './meadow.js';
import { PAL } from '../palette.js';
import { rope, bunting } from './hub.js';
// painted stone: cream + blue with gold caps (never grey)
const STONE = PAL.towerCream, STONE2 = PAL.towerBlue, TOP = PAL.gold, ROCK = PAL.earthLo, GOLD = PAL.gold, CRYSTAL = PAL.crystal;
const PENNANTS = [PAL.flagRed, PAL.flowerYellow, PAL.towersAccent, PAL.towerBlue, PAL.flagGreen];

export function build({ THREE, sb, P, extra }) {
  const star = (id, name, x, y, z, opts = {}) => P.star({ id, zone: 'towers', name, x, y, z, ...opts });
  let pn = 0;
  const pillar = (x, z, top, r, color = STONE) => {
    const band = color === STONE ? STONE2 : STONE;
    sb.cyl(x, top - 30, z, r, 30, color, { seg: 9, rTop: r });
    sb.cyl(x, top - 0.25, z, r + 0.15, 0.3, PAL.towerCream2, { seg: 9, collide: false, shade: { top: STONE } });
    sb.cyl(x, top - 0.55, z, r + 0.28, 0.32, GOLD, { seg: 9, collide: false, jitter: 0.03 });
    // painted bands + a hanging banner on the side facing the plaza
    sb.cyl(x, top - 1.4, z, r + 0.05, 0.5, band, { seg: 9, collide: false, jitter: 0.02 });
    sb.cyl(x, top - 3.2, z, r + 0.05, 0.25, GOLD, { seg: 9, collide: false, jitter: 0.02 });
    sb.cyl(x, top - 8, z, r + 0.05, 1.2, band, { seg: 9, collide: false, jitter: 0.02 });
    const a = Math.atan2(-54 - z, 0 - x);
    const bx = x + Math.cos(a) * (r + 0.08), bz = z + Math.sin(a) * (r + 0.08);
    sb.geo(new THREE.BoxGeometry(0.06, 2.4, 1.1), bx, top - 2.2, bz, PENNANTS[pn++ % PENNANTS.length], { yaw: -a, jitter: 0 });
    sb.geo(new THREE.ConeGeometry(0.55, 0.6, 3), bx, top - 3.7, bz, PENNANTS[(pn - 1) % PENNANTS.length], { yaw: -a + Math.PI / 2, pitch: Math.PI, sz: 0.1, jitter: 0 });
  };
  const island = (x, z, top, r) => { // floating island: grassy top, earth underside, gold rim
    sb.cyl(x, top - 1.5, z, r, 1.5, PAL.earth, { seg: 10, shade: { top: PAL.grass } });
    sb.geo(new THREE.ConeGeometry(r * 0.95, r * 1.6, 8), x, top - 1.5 - r * 0.8, z, ROCK, { pitch: Math.PI });
    sb.cyl(x, top - 0.2, z, r + 0.1, 0.25, PAL.grass, { seg: 10, collide: false, shade: { top: PAL.grassHi } });
    sb.cyl(x, top - 0.55, z, r + 0.12, 0.2, GOLD, { seg: 10, collide: false, jitter: 0.02 });
    for (let k = 0; k < 3; k++) { const a = k * 2.1 + x; sb.geo(new THREE.ConeGeometry(0.18 * r, 0.5 * r, 5), x + Math.cos(a) * r * 0.5, top - 1.5 - r * 1.2, z + Math.sin(a) * r * 0.5, PAL.earthLo, { pitch: Math.PI }); }
  };

  // ---- rope bridge from the hub + central plaza (same colliders as the old plank bridge) ----
  sb.colliderBox(0, -0.3, -40.5, 5, 0.6, 13);
  for (let z = -46.75; z <= -34.25; z += 0.5) sb.box(0, -0.12 - 0.04 * Math.sin((z + 34) * 0.25), z, 4.8, 0.24, 0.42, (Math.round(z * 2) % 3) ? PAL.woodHi : PAL.wood, { collide: false, jitter: 0.05 });
  for (const s of [-1, 1]) sb.box(s * 2.25, -0.32, -40.5, 0.3, 0.3, 13, PAL.woodLo, { collide: false });
  for (const s of [-1, 1]) {
    sb.colliderBox(s * 2.4, 0.5, -40.5, 0.2, 0.6, 13, { camera: false });
    for (const z of [-34.3, -40.5, -46.7]) { sb.cyl(s * 2.4, -0.3, z, 0.14, 1.4, PAL.woodLo, { collide: false, seg: 6 }); sb.sphere(s * 2.4, 1.15, z, 0.15, GOLD, { detail: 0 }); }
    rope(sb, THREE, [s * 2.4, 0.95, -34.3], [s * 2.4, 0.95, -40.5], 0.25); rope(sb, THREE, [s * 2.4, 0.95, -40.5], [s * 2.4, 0.95, -46.7], 0.25);
    rope(sb, THREE, [s * 2.4, 0.45, -34.3], [s * 2.4, 0.45, -46.7], 0.3);
  }
  island(0, -54, 0, 8);
  P.checkpoint('towers-cp1', 0, -49, { facing: Math.PI });
  P.coinLine(0, -37, 0, -46, 5, 1, { abs: 0 });
  P.coinRing(0, -54, 5.5, 10, 1, { abs: 0 });
  extra.sign(P, -3, -47.5, '← Jump x3 gap', { bg: '#efe4ff', fg: '#4a2a8a', yaw: 0 });
  extra.sign(P, 4.5, -48, 'Bell climb →', { bg: '#fff4d6', fg: '#6a4a00', yaw: 0 });

  // ---- elevator to a sky nook ----
  P.platform({ id: 'elevator', size: [3, 0.5, 3], path: [[5, -0.25, -42.5], [5, 13.75, -42.5]], speed: 3, pause: 1.2, color: PAL.elevator });
  island(5, -38.5, 14, 2.2);
  for (let y = 2; y <= 12; y += 2) P.coin(5, y + 1, -42.5, { zone: 'towers' });
  P.coinRing(5, -38.5, 1.4, 6, 1, { abs: 14, zone: 'towers' });

  // ---- bell climb (star 1): rising pillars, windy plank, bell tower ----
  const steps = [[11, -57, 2.5], [17, -63, 5], [21, -70, 7.5], [22, -78, 10.5], [19, -86, 13.5], [9, -91, 13.5]];
  steps.forEach(([x, z, top]) => { pillar(x, z, top, 2.2, top > 9 ? STONE2 : STONE); P.coinRing(x, z, 1.1, 3, 1, { abs: top }); });
  const pdx = 9 - 19, pdz = -91 - -86, plen = Math.hypot(pdx, pdz);
  sb.slab(14, 13.5, -88.5, 2.2, 0.4, plen, PAL.woodHi, { yaw: Math.atan2(pdx, pdz), shade: { under: 0.35 } });
  extra.wind(P, { min: [8, 13, -93], max: [20, 18, -84], force: [2.2, -4.4] });
  P.coinLine(17, -87, 11, -90, 4, 1, { abs: 13.5 });
  pillar(1, -94, 17.5, 3.5, STONE2);
  extra.bell(P, 1, 17.5, -95);
  star('towers-1', 'Climb to the bell', 1, 19.2, -92.4, { task: 'reach' });
  P.coinRing(1, -94, 2.6, 8, 1, { abs: 17.5 });
  P.checkpoint('towers-cp2', 22, -78, { y: 10.5, facing: Math.PI });

  // ---- triple-jump gap (star 2): runway -> 3 m gap -> ledge 7 m up (too high for 1 or 2 jumps) ----
  // runway x -6..-26.6 with three yellow "jump here" stripes spaced like a held 1st and 2nd jump
  sb.slab(-16.3, 0, -54, 20.6, 1, 6, STONE);
  for (const x of [-8, -15.3, -23.6]) sb.slab(x, 0.03, -54, 0.6, 0.06, 5.6, PAL.stripe, { collide: false, jitter: 0 });
  for (const z of [-56.9, -51.1]) sb.slab(-16.3, 0.02, z, 20.4, 0.05, 0.3, STONE2, { collide: false, jitter: 0 });
  sb.slab(-33.6, 7, -54, 11, 14, 9, STONE2, { flags: { noWallKick: true }, shade: { ao: 4 } });
  for (const y of [2, 4.5]) sb.slab(-33.6, y, -54, 11.1, 0.4, 9.1, y > 3 ? GOLD : STONE, { collide: false, jitter: 0.02 });
  sb.slab(-33.6, 7.05, -54, 11.2, 0.3, 9.2, STONE, { collide: false });
  sb.slab(-33.6, 6.75, -54, 11.5, 0.3, 9.5, GOLD, { collide: false });
  star('towers-2', 'Triple-jump the gap', -35, 8.6, -54, { task: 'reach' });
  P.coinLine(-8, -54, -25, -54, 8, 1, { abs: 0 });
  P.coinRing(-34.5, -54, 2.8, 6, 1, { abs: 7 });

  // ---- red coins up the spiral (star 3) ----
  const S = [[-16, -62, 0.5, 2.5], [-21, -68, 1.0, 2.5], [-24, -73.2, 1.3, 2.0]];
  S.forEach(([x, z, top, r]) => { island(x, z, top, r); P.coinRing(x, z, 1.1, 3, 1, { abs: top }); });
  P.checkpoint('towers-cp3', -21, -68, { y: 1.0, facing: Math.PI });
  const cx = -26, cz = -82, R = 6, a0 = Math.atan2(-73.2 - cz, -24 - cx);
  sb.cyl(cx, -30, cz, 3.5, 52.5, STONE, { seg: 10 });
  sb.cyl(cx, 22.3, cz, 3.7, 0.3, PAL.towerCream2, { seg: 10, collide: false, shade: { top: STONE } });
  sb.cyl(cx, 22.0, cz, 3.85, 0.3, GOLD, { seg: 10, collide: false });
  for (let k = 0; k < 5; k++) sb.cyl(cx, -6 + k * 5.6, cz, 3.56, 1.2, k % 2 ? GOLD : STONE2, { seg: 10, collide: false, jitter: 0.02 });
  const spiralStar = star('towers-3', 'Red coins up the spiral', cx, 24.1, cz, { hidden: true, task: 'redcoins' });
  const redSteps = [2, 5, 8, 11, 14, 16, 18, 20];
  for (let k = 0; k < 22; k++) {
    const a = a0 - k * 0.5, x = cx + Math.cos(a) * R, z = cz + Math.sin(a) * R, top = 1.5 + k * 1.0;
    sb.slab(x, top, z, 2.6, 0.5, 2.4, k % 2 ? STONE2 : STONE, { yaw: -a });
    const ri = redSteps.indexOf(k);
    if (ri >= 0) P.redCoin('towers-3', ri, x, top + 1.1, z); else if (k % 3 === 0) P.coinAt(x, z, 1, { abs: top, zone: 'towers' });
  }
  spiralStar.target = from => nearest(P.coins.filter(c => c.starId === 'towers-3' && c.alive), from);

  // ---- chimes (star 4): ring 1-2-3-4 in order ----
  sb.slab(0, 0, -64, 3, 0.6, 4.6, PAL.woodHi, { shade: { under: 0.35 } });
  island(0, -71, 0, 6.5);
  const chimeStar = star('towers-4', 'Ring all 4 chimes in a row', 0, 1.7, -66.8, { hidden: true, task: 'chimes' });
  const ch = extra.chimes(P, [[-2, -73], [3.5, -72], [-4.5, -69.5], [2, -75.5]], () => P.revealStar(chimeStar, 'Ding ding ding ding!'));
  chimeStar.target = () => ch.target();
  P.coinLine(-5, -66.5, 5, -66.5, 5, 1, { abs: 0 });

  // ---- bonus star + crystals for decoration ----
  star('bonus-towers', '100 coins in Sky Towers', -4, 1.6, -58, { hidden: true, bonus: true, task: 'bonus' });
  for (const [x, y, z, s] of [[12, -6, -45, 2], [-14, -4, -44, 1.6], [30, 4, -60, 2.4], [-36, 12, -70, 1.8], [10, 8, -100, 2.6], [-8, 18, -96, 1.5], [32, 20, -92, 2]]) {
    sb.geo(new THREE.OctahedronGeometry(s, 0), x, y, z, CRYSTAL, { sy: 1.8, yaw: x });
    sb.geo(new THREE.OctahedronGeometry(s * 0.5, 0), x + s, y - s, z, GOLD, { sy: 1.6 });
  }
  return {
    apply(save) {
      if (save.stars.includes('towers-4')) ch.complete();
      else { ch.done = false; ch.next = 0; for (const it of ch.items) { it.lit = false; it.mat.emissive.setHex(0); } }
    },
  };
}
