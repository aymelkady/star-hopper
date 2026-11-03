// Splash Cove (east): log ride, 5 lanterns, red coins on the rocks, ghost race along the pier.
import { nearest } from './meadow.js';
const WOOD = 0xb07a48, WOOD2 = 0x8f5f36, SAND = 0xf0d79a, ROCK = 0x8f8aa0, ROCK2 = 0x7a7590, PALM = 0x9a6a3c, LEAF = 0x3fbf5a;

function palm(sb, THREE, g, x, z, lean = 0.25, yaw = 0) {
  const y = g(x, z);
  let px = x, py = y - 0.2, pz = z;
  for (let i = 0; i < 5; i++) { // trunk segments leaning outward
    const dx = Math.sin(yaw) * lean * i * 0.35, dz = Math.cos(yaw) * lean * i * 0.35;
    sb.cyl(px + dx, py, pz + dz, 0.32 - i * 0.03, 1.3, i % 2 ? PALM : 0x83572f, { seg: 6, collide: i < 2 });
    py += 1.2;
    if (i === 4) { px += dx; pz += dz; }
  }
  for (let k = 0; k < 6; k++) {
    const a = k * 1.047;
    sb.geo(new THREE.ConeGeometry(0.5, 3.2, 4), px + Math.cos(a) * 1.3, py + 0.1, pz + Math.sin(a) * 1.3, LEAF, { yaw: -a, roll: Math.PI / 2 - 0.35, sz: 0.3 });
  }
  sb.sphere(px, py - 0.1, pz, 0.45, 0x6b4a2a, { detail: 0 });
}

export function build({ THREE, sb, P, extra, ground: g }) {
  const star = (id, name, x, z, lift, { y, ...opts } = {}) => P.star({ id, zone: 'cove', name, x, y: (y ?? g(x, z)) + lift, z, ...opts });

  // ---- log ride (star 1): dock -> 3 moving log rafts -> islet ----
  sb.slab(49, 0.4, -24, 12, 1.4, 4.2, WOOD);
  for (let x = 44; x <= 54; x += 3.3) for (const z of [-26, -22]) sb.cyl(x, -4, z, 0.2, 4.2, WOOD2, { collide: false, seg: 5 });
  P.platform({ id: 'log-a', look: 'log', size: [3, 1, 4], path: [[60.5, -0.3, -24], [70, -0.3, -24]], speed: 2.6, pause: 0.7 });
  P.platform({ id: 'log-b', look: 'log', size: [3, 1, 4], path: [[75, -0.3, -24.5], [75, -0.3, -33.5]], speed: 2.2, pause: 0.7 });
  P.platform({ id: 'log-c', look: 'log', size: [3, 1, 4], path: [[79.5, -0.3, -34], [88.5, -0.3, -34]], speed: 2.8, pause: 0.7 });
  sb.cyl(94, -6, -34, 4.2, 7, SAND, { seg: 10 });
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
    sb.cyl(x, -6, z, r, top + 6, i % 2 ? ROCK : ROCK2, { seg: 7, rTop: r * 0.85 });
    P.redCoin('cove-3', i, x, top + 1.1, z);
  });
  sb.cyl(90, -6, 51, 3.8, 11.2, ROCK, { seg: 8, rTop: 3.4 });
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
  for (const [x, z, c] of [[38, -4, 0xff5a5a], [33, 33, 0x5ab8ff]]) {
    const y = g(x, z);
    sb.cyl(x, y - 0.2, z, 0.08, 2.6, 0xffffff, { seg: 5, collide: false });
    sb.cone(x, y + 2.2, z, 1.8, 0.8, c, { seg: 8 });
  }
  for (const [x, z] of [[47, -14], [41, 22], [46, 46]]) sb.slab(x, g(x, z) + 1, z, 1.2, 1.2, 1.2, 0xc48a52, { yaw: x });

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
        sw.pressed = false; sw.btn.scale.y = 1; sw.btn.position.y = 0.45; sw.btnMat.color.setHex(0xff5a3c);
      }
      for (const l of lanterns) { l.lit = false; l.mat.color.setHex(0x5a5560); l.mat.emissive.setHex(0); }
      if (done) for (const sw of P.switches) if (sw.zone === 'cove') P.pressSwitch(sw, true);
      race.cancel();
    },
  };
}
