// Splash Cove (east): log ride, 5 lanterns, red coins on the rocks, ghost race along the pier.
import { nearest } from './meadow.js';
import { PAL } from '../palette.js';
const WOOD = PAL.wood, WOOD2 = PAL.woodLo, SAND = PAL.sand, PALM = PAL.bark, PALM2 = PAL.wood;
const k2 = x => (x > 35 ? PAL.towerBlue : PAL.flowerPink);
const ROCKS = [PAL.sandstone, PAL.sandstone2, PAL.sandstone4, PAL.sandstone3];

function palm(sb, THREE, g, x, z, lean = 0.25, yaw = 0) {
  const y = g(x, z);
  let px = x, py = y - 0.2, pz = z;
  for (let i = 0; i < 5; i++) { // trunk segments leaning outward (same colliders as before)
    const dx = Math.sin(yaw) * lean * i * 0.35, dz = Math.cos(yaw) * lean * i * 0.35;
    sb.cyl(px + dx, py, pz + dz, 0.32 - i * 0.03, 1.3, i % 2 ? PALM2 : PALM, { seg: 6, collide: i < 2 });
    if (i < 4) sb.cyl(px + dx, py + 1.15, pz + dz, 0.36 - i * 0.03, 0.12, PAL.barkLo, { seg: 6, collide: false, jitter: 0 });
    py += 1.2;
    if (i === 4) { px += dx; pz += dz; }
  }
  // two layers of drooping fronds
  for (let k = 0; k < 7; k++) {
    const a = k * 0.8976 + yaw;
    sb.geo(new THREE.ConeGeometry(0.55, 3.4, 4), px + Math.cos(a) * 1.4, py + 0.05, pz + Math.sin(a) * 1.4, k % 2 ? PAL.palmLeaf : PAL.palmLeafHi, { yaw: -a, roll: Math.PI / 2 - 0.45, sz: 0.28 });
  }
  for (let k = 0; k < 4; k++) {
    const a = k * 1.571 + yaw + 0.4;
    sb.geo(new THREE.ConeGeometry(0.4, 2.2, 4), px + Math.cos(a) * 0.9, py + 0.45, pz + Math.sin(a) * 0.9, PAL.leafLime, { yaw: -a, roll: Math.PI / 2 - 0.1, sz: 0.28 });
  }
  for (let k = 0; k < 3; k++) sb.sphere(px + Math.cos(k * 2.1) * 0.35, py - 0.2, pz + Math.sin(k * 2.1) * 0.35, 0.26, PAL.barkLo, { detail: 0 }); // coconuts
}

// layered sandstone sea stack: collider = the original cylinder; bands + green top are decor
function stack(sb, x, z, r, y0, top, i, opts = {}) {
  sb.cyl(x, y0, z, r, top - y0, ROCKS[i % 4], { seg: 7, rTop: r * 0.85, ...opts });
  const H = top - y0;
  for (let k = 1; k * 1.3 < H - 0.6; k++) {
    const y = y0 + k * 1.3, t = (y - y0) / H, rr = r + (r * 0.85 - r) * t;
    sb.cyl(x, y, z, rr + 0.06, 0.5, ROCKS[(i + k) % 4], { seg: 7, collide: false, jitter: 0.03 });
  }
  sb.cyl(x, top - 0.12, z, r * 0.85 + 0.05, 0.14, PAL.grass, { seg: 7, collide: false, jitter: 0.04 });
}

export function build({ THREE, sb, P, extra, ground: g }) {
  const star = (id, name, x, z, lift, { y, ...opts } = {}) => P.star({ id, zone: 'cove', name, x, y: (y ?? g(x, z)) + lift, z, ...opts });

  // ---- log ride (star 1): dock -> 3 moving log rafts -> islet ----
  sb.slab(49, 0.4, -24, 12, 1.4, 4.2, WOOD);
  for (let x = 44; x <= 54; x += 3.3) for (const z of [-26, -22]) sb.cyl(x, -4, z, 0.2, 4.2, WOOD2, { collide: false, seg: 5 });
  P.platform({ id: 'log-a', look: 'log', size: [3, 1, 4], path: [[60.5, -0.3, -24], [70, -0.3, -24]], speed: 2.6, pause: 0.7 });
  P.platform({ id: 'log-b', look: 'log', size: [3, 1, 4], path: [[75, -0.3, -24.5], [75, -0.3, -33.5]], speed: 2.2, pause: 0.7 });
  P.platform({ id: 'log-c', look: 'log', size: [3, 1, 4], path: [[79.5, -0.3, -34], [88.5, -0.3, -34]], speed: 2.8, pause: 0.7 });
  sb.cyl(94, -6, -34, 4.2, 7, SAND, { seg: 10, shade: { ao: 6 } });
  palm(sb, THREE, g, 95.6, -35.6, 0.3, 2.2);
  star('cove-1', 'Cross the log ride', 93, -33, 1.6).task = 'reach';
  P.coinLine(44, -24, 54, -24, 4, 1, { abs: 1.1 });
  P.coinLine(62, -24, 69, -24, 4, 1.2, { abs: 0.2 });
  P.coinLine(75, -26.5, 75, -32, 3, 1.2, { abs: 0.2 });
  P.coinLine(81, -34, 87, -34, 3, 1.2, { abs: 0.2 });
  P.coinRing(94, -34, 2.6, 6, 1, { abs: 1 });

  // ---- lanterns (star 2): ground-pound the 5 switches ----
  const lanternStar = star('cove-2', 'Light 5 lanterns', 38, 16, 1.6, { hidden: true, task: 'switches' });
  const lanterns = [];
  const spots = [[34, -14], [42, 6], [36, 28], [44, 40], [28, -26]];
  spots.forEach(([x, z], i) => {
    const ln = P.lantern(`cove-lantern-${i + 1}`, x + 2.4, z);
    lanterns.push(ln);
    P.groundSwitch(`cove-switch-${i + 1}`, x, z, (sw, silent) => {
      ln.light();
      const lit = lanterns.filter(l => l.lit).length;
      if (!silent) {
        P.events.emit('lantern:lit', { id: ln.id, count: lit, total: 5 });
        if (lit >= 5) P.revealStar(lanternStar, 'All 5 lanterns lit!');
        else P.events.emit('ui:toast', { text: `Lantern ${lit} / 5` });
      }
    });
    P.coinRing(x, z, 2.4, 6, 1);
  });
  lanternStar.target = from => nearest(P.switches.filter(s => s.zone === 'cove' && !s.pressed), from);

  // ---- red coins on the rocks (star 3) ----
  const rocks = [[56, 14, 0.8, 2], [61, 19, 1.6, 1.8], [66, 14, 2.4, 1.8], [71, 20, 1.8, 1.8], [76, 26, 3.0, 1.8], [73, 32, 2.2, 1.8], [78, 38, 3.6, 1.8], [84, 44, 4.4, 2]];
  const rockStar = star('cove-3', 'Red coins on the rocks', 90, 51, 1.6, { y: 5.2, hidden: true, task: 'redcoins' });
  rocks.forEach(([x, z, top, r], i) => {
    stack(sb, x, z, r, -6, top, i);
    P.redCoin('cove-3', i, x, top + 1.1, z);
  });
  sb.cyl(90, -6, 51, 3.8, 11.2, PAL.sandstone, { seg: 8, rTop: 3.4 });
  for (let k = 1; k < 8; k++) sb.cyl(90, -6 + k * 1.4, 51, 3.8 - k * 0.05 + 0.06, 0.55, ROCKS[k % 4], { seg: 8, collide: false, jitter: 0.03 });
  sb.cyl(90, 5.08, 51, 3.45, 0.14, PAL.grass, { seg: 8, collide: false });
  P.coinRing(90, 51, 2.3, 8, 1, { abs: 5.2 });
  rockStar.target = from => nearest(P.coins.filter(c => c.starId === 'cove-3' && c.alive), from);

  // ---- ghost race (star 4): start pad on the beach -> end of the pier ----
  for (const [x0, x1] of [[46, 58], [60, 70], [72, 86]]) {
    sb.slab((x0 + x1) / 2, 0.6, 70, x1 - x0, 0.5, 3.6, WOOD);
    for (let x = x0 + 1; x < x1; x += 3) for (const z of [68.4, 71.6]) sb.cyl(x, -5, z, 0.18, 5.4, WOOD2, { collide: false, seg: 5 });
  }
  sb.slab(41, 0.4, 61, 3, 0.4, 3, SAND, { collide: false });
  const raceStar = star('cove-4', 'Race the Ghost', 82, 70, 2.0, { y: 0.6, hidden: true, task: 'race' });
  const race = extra.ghostRace(P, { start: [34, 46], finish: [82, 70], path: [[40, 62], [47, 70]], target: 30, ghostTime: 24, onWin: () => P.revealStar(raceStar, 'You beat the ghost!') });
  raceStar.target = () => race.running ? { x: 82, y: 1.6, z: 70 } : { x: 34, y: g(34, 46) + 1, z: 46 };
  extra.sign(P, 31, 44, 'Ghost race →', { bg: '#e6f0ff', fg: '#1d3a7a', yaw: 0.9 });
  P.coinLine(36, 50, 45, 67, 7, 1);
  P.coinLine(47, 70, 85, 70, 14, 1, { abs: 0.6 });

  // ---- bonus star + decoration ----
  star('bonus-cove', '100 coins in Splash Cove', 34, 0, 1.6, { hidden: true, bonus: true, task: 'bonus' });
  for (const [x, z, l, y] of [[32, 20, 0.25, 1], [44, -6, 0.3, 2.5], [30, 36, 0.25, 0.4], [40, 56, 0.3, 2], [36, -22, 0.2, 3.5], [46, 26, 0.3, 1.8]]) palm(sb, THREE, g, x, z, l, y);
  for (const [x, z, c] of [[38, -4, PAL.umbrellaRed], [33, 33, PAL.umbrellaBlue]]) {
    const y = g(x, z);
    sb.cyl(x, y - 0.2, z, 0.08, 2.6, PAL.white, { seg: 5, collide: false });
    sb.cone(x, y + 2.2, z, 1.8, 0.8, c, { seg: 8, shade: { under: 0.35 } });
    for (let k = 0; k < 4; k++) sb.geo(new THREE.ConeGeometry(1.84, 0.84, 8, 1, true, k * Math.PI / 2, Math.PI / 4), x, y + 2.61, z, PAL.white, { jitter: 0 });
    sb.box(x + 1.4, y + 0.06, z + 0.4, 1.0, 0.04, 1.9, k2(x), { collide: false, jitter: 0, yaw: 0.3 }); // beach towel
  }
  for (const [x, z] of [[47, -14], [41, 22], [46, 46]]) sb.slab(x, g(x, z) + 1, z, 1.2, 1.2, 1.2, PAL.wood, { yaw: x });
  // sea shells + starfish on the sand
  for (const [x, z, c] of [[35, 8, PAL.flowerPink], [43, 12, PAL.mushOrange], [30, 26, PAL.flowerWhite], [39, 38, PAL.flowerPink], [44, -10, PAL.mushOrange], [36, 54, PAL.flowerWhite], [42, 30, PAL.flowerYellow]]) {
    const y = g(x, z);
    for (let k = 0; k < 5; k++) { const a = k * 1.2566 + x; sb.geo(new THREE.ConeGeometry(0.09, 0.32, 3), x + Math.cos(a) * 0.14, y + 0.04, z + Math.sin(a) * 0.14, c, { yaw: -a, roll: Math.PI / 2, sy: 1, sz: 0.4, jitter: 0 }); }
  }
  // distant layered sandstone sea stacks + arches (decor, out in the sea)
  for (const [x, z, r, h] of [[118, -70, 9, 26], [132, -20, 7, 18], [126, 40, 10, 30], [112, 88, 8, 20], [150, 10, 6, 14], [104, -116, 9, 22], [54, -108, 11, 16], [74, -112, 10, 24], [92, -106, 8, 12], [138, -112, 12, 30], [52, -126, 9, 30], [64, -150, 12, 38]]) {
    const y0 = z < -100 ? -40 : -8, n = Math.ceil((h - y0) / 2.4), topY = y0 + n * 2.4;
    for (let k = 0; k < n; k++) sb.cyl(x, y0 + k * 2.4, z, r * (1 - k * 0.012), 2.4, ROCKS[k % 4], { seg: 8, collide: false, jitter: 0.04 });
    sb.cyl(x, topY - 0.3, z, r * (1 - n * 0.012) + 0.15, 0.6, PAL.grass, { seg: 8, collide: false });
    sb.sphere(x + r * 0.3, topY + 0.4, z, r * 0.45, PAL.bush, { detail: 1, sy: 0.6, shade: { under: 0.4 } });
  }

  // ---- more coins ----
  P.coinLine(31, -8, 46, -14, 6, 1);
  P.coinLine(32, 2, 32, 40, 8, 1);
  P.coinRing(40, 30, 4, 8, 1);

  // ---- checkpoints ----
  P.checkpoint('cove-cp1', 32, -2, { facing: Math.PI / 2 });
  P.checkpoint('cove-cp2', 40, -22, { facing: Math.PI / 2 });
  P.checkpoint('cove-cp3', 38, 50, { facing: Math.PI / 2 });

  return {
    apply(save) {
      const done = save.stars.includes('cove-2');
      for (const sw of P.switches) if (sw.zone === 'cove') {
        sw.pressed = false; sw.btn.scale.y = 1; sw.btn.position.y = 0.45; sw.btnMat.color.setHex(PAL.switchRed);
      }
      for (const l of lanterns) l.unlight();
      if (done) for (const sw of P.switches) if (sw.zone === 'cove') P.pressSwitch(sw, true);
      race.cancel();
    },
  };
}
