// Treehouse Hub: big tree with a treehouse deck, signposts to the three zones, fence at the abyss.
const BARK = 0x8a5a34, BARK2 = 0x6e4626, LEAF = 0x4fb848, LEAF2 = 0x6fd05a, WOOD = 0xc48a52, PLANK = 0xe0a868;

export function build({ sb, P, extra }) {
  // tree
  sb.cyl(0, -0.5, 0, 3.2, 16, BARK, { seg: 10, rTop: 2.4 });
  for (let i = 0; i < 6; i++) { const a = i * 1.047 + 0.3; sb.box(Math.cos(a) * 3.3, 0.35, Math.sin(a) * 3.3, 2.2, 0.9, 0.9, BARK2, { yaw: -a, camera: false }); }
  sb.sphere(0, 18, 0, 7.5, LEAF, { sy: 0.7, detail: 1 });
  sb.sphere(4.5, 16, 2, 4.5, LEAF2, { sy: 0.75, detail: 1 });
  sb.sphere(-4.5, 16.5, -1.5, 4.8, LEAF2, { sy: 0.75, detail: 1 });
  sb.sphere(0.5, 21.5, -1, 4.5, LEAF2, { sy: 0.8, detail: 1 });
  // treehouse deck (ring of planks at y=7) + little hut + railings
  for (const [x, z, sx, sz] of [[0, -4.5, 12, 3], [0, 4.5, 12, 3], [-4.5, 0, 3, 6], [4.5, 0, 3, 6]]) sb.slab(x, 7, z, sx, 0.5, sz, PLANK);
  sb.box(-6, 7.5, 0, 0.25, 1, 12, WOOD, { camera: false });
  sb.box(0, 7.5, -6, 12, 1, 0.25, WOOD, { camera: false });
  sb.box(-1.5, 7.5, 6, 9, 1, 0.25, WOOD, { camera: false });
  sb.box(-3.5, 9, -3.5, 4, 3.5, 0.3, 0xd9534f, { collide: false });
  sb.box(-3.5, 11.3, -3.2, 4.6, 0.3, 1.6, 0x9c3a36, { collide: false, });
  // staircase up the +x side
  for (let k = 1; k <= 6; k++) sb.slab(7.6, 1.1 * k, 6 - 1.8 * k, 2.2, 0.4, 1.8, k % 2 ? PLANK : WOOD);
  for (let k = 1; k <= 6; k++) sb.cyl(7.6, -0.2, 6 - 1.8 * k, 0.12, 1.1 * k - 0.2, BARK2, { collide: false, seg: 5 });
  // stumps & logs to hop on
  sb.cyl(-13, -0.2, 13, 1.2, 1.4, BARK, { seg: 9 });
  sb.cyl(10, -0.2, 11, 1.0, 2.2, BARK, { seg: 9 });
  sb.cyl(-12, -0.2, -6, 1.4, 1.0, BARK, { seg: 9 });
  // fence along the abyss edge (gap for the bridge)
  for (const side of [-1, 1]) {
    sb.box(side * 23.5, 0.9, -35, 41, 0.25, 0.25, WOOD, { camera: false });
    sb.box(side * 23.5, 0.45, -35, 41, 0.9, 0.12, WOOD, { collide: false });
    for (let x = 3.5; x <= 44; x += 4) sb.cyl(side * x, -0.3, -35, 0.15, 1.4, BARK2, { collide: false, seg: 5 });
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
