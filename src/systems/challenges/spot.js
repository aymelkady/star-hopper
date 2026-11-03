/*
 * Spot It (sustained attention / visual search) on "Crate Isle", a small floating island in the
 * Sky Towers reached by a plank from the hub ledge.  12 look-alike crates; 3 carry a tiny gold
 * star on ONE side.  Ground-pound a crate to open it: star crate = chime + hit, plain = soft thud.
 * A soft locator ping speeds up the closer the camera looks at a hidden star crate
 * (dot of camera forward and direction to the crate).  Find all 3 within 60 s -> star.
 * Level 1..5: the mark shrinks (1.3 -> 0.7) and the ping only helps when looking closer.
 * Draw calls: island + plank (1), crates (1 instanced), marks (1 instanced).
 * def: { center:[x,z], r, plank:[x,z0,z1], pad:[x,z], after }
 */
import { StaticBuilder } from '../../world/builder.js';
const COUNT = 3, TIME = 60;
const lerp = (a, b, t) => a + (b - a) * t;
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function createSpot(kit, def) {
  const { THREE, scene, col, P, PAL } = kit;
  const [cx, cz] = def.center, R = def.r, TOP = 0;
  // ---- island + plank bridge (static, with colliders) ----
  const sb = new StaticBuilder(col, 'focus-isle');
  sb.cyl(cx, TOP - 1.5, cz, R, 1.5, PAL.earth, { seg: 14, shade: { top: PAL.grass } });
  sb.geo(new THREE.ConeGeometry(R * 0.95, R * 1.6, 10), cx, TOP - 1.5 - R * 0.8, cz, PAL.earthLo, { pitch: Math.PI });
  sb.cyl(cx, TOP - 0.2, cz, R + 0.1, 0.25, PAL.grass, { seg: 14, collide: false, shade: { top: PAL.grassHi } });
  sb.cyl(cx, TOP - 0.55, cz, R + 0.12, 0.2, PAL.gold, { seg: 14, collide: false, jitter: 0.02 });
  const [px, pz0, pz1] = def.plank, pl = Math.abs(pz1 - pz0), pmz = (pz0 + pz1) / 2;
  sb.slab(px, 0.08, pmz, 2.8, 0.3, pl, PAL.woodHi, { shade: { under: 0.35 } });
  for (let z = Math.min(pz0, pz1) + 0.4; z < Math.max(pz0, pz1); z += 0.9) sb.box(px, 0.1, z, 2.9, 0.06, 0.12, PAL.woodLo, { collide: false, jitter: 0 });
  for (const s of [-1, 1]) {
    sb.colliderBox(px + s * 1.45, 0.6, pmz, 0.15, 0.7, pl, { camera: false });
    sb.box(px + s * 1.45, 0.8, pmz, 0.1, 0.1, pl, PAL.rope, { collide: false, jitter: 0 });
    for (const z of [pz0, pmz, pz1]) sb.cyl(px + s * 1.45, -0.1, z, 0.12, 1.0, PAL.woodLo, { collide: false, seg: 6 });
  }
  for (const [dx, dz] of [[0, -R * 0.9], [R * 0.9, 0]]) sb.sphere(cx + dx, TOP + 0.3, cz + dz, 0.65, PAL.bush, { detail: 1, sy: 0.75, shade: { under: 0.45 } });
  scene.add(sb.build(kit.vcMat));

  // ---- 12 crates (InstancedMesh) on a 4 x 3 grid ----
  const cb = new StaticBuilder(null, 'crate');
  cb.box(0, 0, 0, 1.2, 1.2, 1.2, PAL.wood, { collide: false, jitter: 0.04 });
  for (const s of [-1, 1]) for (const t of [-1, 1]) {
    cb.box(s * 0.56, 0, t * 0.56, 0.14, 1.24, 0.14, PAL.woodLo, { collide: false, jitter: 0 });
    cb.box(s * 0.56, t * 0.56, 0, 0.14, 0.14, 1.24, PAL.woodLo, { collide: false, jitter: 0 });
    cb.box(0, s * 0.56, t * 0.56, 1.24, 0.14, 0.14, PAL.woodLo, { collide: false, jitter: 0 });
  }
  const crateGeo = cb.build(kit.vcMat).geometry;
  const crates = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) {
    const x = cx - 4.35 + i * 2.9, z = cz + 2.9 - j * 2.9, y = TOP + 0.6;
    crates.push({ x, y, z, yaw: ((i * 3 + j * 5) % 4) * Math.PI / 2, marked: false, side: 0, open: false, pop: 0 });
    col.add({ kind: 'box', minX: x - 0.6, maxX: x + 0.6, minY: TOP, maxY: TOP + 1.2, minZ: z - 0.6, maxZ: z + 0.6 });
  }
  const crateMesh = new THREE.InstancedMesh(crateGeo, kit.vcMat, crates.length);
  crateMesh.castShadow = true; crateMesh.receiveShadow = true;
  const white = new THREE.Color(1, 1, 1), gold = new THREE.Color(1.5, 1.25, 0.45), dull = new THREE.Color(0.62, 0.6, 0.72);
  crates.forEach((c, k) => crateMesh.setColorAt(k, white));
  scene.add(crateMesh);
  // ---- star marks ----
  const shp = new THREE.Shape();
  for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2 + Math.PI / 2, r = k % 2 ? 0.07 : 0.17; k ? shp.lineTo(Math.cos(a) * r, Math.sin(a) * r) : shp.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  const markGeo = new THREE.ExtrudeGeometry(shp, { depth: 0.03, bevelEnabled: false });
  const markMesh = new THREE.InstancedMesh(markGeo, kit.toon(0xffd84a, { emissive: 0x8a5a00, emissiveIntensity: 0.6 }, 'spot-mark'), COUNT);
  markMesh.count = 0; markMesh.frustumCulled = false; scene.add(markMesh); // instances move: no stale bounds
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
  const fwd = new THREE.Vector3(), dir = new THREE.Vector3();
  let markScale = 1, phase = 'idle', t = 0, found = 0, lastFind = 0, pingT = 0, helpMin = 0.8;

  function draw() {
    crates.forEach((c, k) => {
      const sq = c.pop > 0 ? Math.sin(c.pop * Math.PI) * 0.18 : 0;
      _e.set(0, c.yaw, 0); _q.setFromEuler(_e); _p.set(c.x, c.y - sq * 0.4, c.z); _s.set(1 + sq, 1 - sq, 1 + sq);
      crateMesh.setMatrixAt(k, _m.compose(_p, _q, _s));
    });
    crateMesh.instanceMatrix.needsUpdate = true;
    let n = 0;
    for (const c of crates) {
      if (!c.marked) continue;
      const [sx, sz] = SIDES[c.side], gl = c.open ? 1.6 : 1;
      _e.set(0, Math.atan2(sx, sz), 0); _q.setFromEuler(_e);
      _p.set(c.x + sx * 0.615, c.y + 0.12, c.z + sz * 0.615); _s.setScalar(markScale * gl);
      markMesh.setMatrixAt(n++, _m.compose(_p, _q, _s));
    }
    markMesh.count = n; markMesh.instanceMatrix.needsUpdate = true;
  }
  function reset() {
    for (const [k, c] of crates.entries()) { c.marked = false; c.open = false; c.pop = 0; crateMesh.setColorAt(k, white); }
    crateMesh.instanceColor.needsUpdate = true; draw();
  }
  draw();
  function open(c, k) {
    c.open = true; c.pop = 1;
    const at = { x: c.x, y: c.y + 0.8, z: c.z };
    if (c.marked) { found++; crateMesh.setColorAt(k, gold); kit.hit(found - 1, Math.round((t - lastFind) * 1000), at); lastFind = t; }
    else { crateMesh.setColorAt(k, dull); kit.miss('plain', { ...at, quiet: true }); kit.sfx('land'); }
    crateMesh.instanceColor.needsUpdate = true;
    kit.chip(`🔍 ${found} / ${COUNT} · ${Math.max(0, Math.ceil(TIME - t))} s`);
  }
  // ground pound hook (props call entity.onPound for every pound impact)
  P.entities.push({
    type: 'focus-spot',
    onPound(pos) {
      if (phase !== 'run') return;
      let best = -1, bd = 1.7;
      crates.forEach((c, k) => { const d = Math.hypot(pos.x - c.x, pos.z - c.z); if (!c.open && d < bd && pos.y < c.y + 1.6) { bd = d; best = k; } });
      if (best >= 0) open(crates[best], best);
    },
    animate(dt) { let any = false; for (const c of crates) if (c.pop > 0) { c.pop = Math.max(0, c.pop - dt * 3); any = true; } if (any) draw(); },
  });

  return {
    type: 'spot', zone: 'towers', starId: 'focus-spot-towers', name: 'Spot It on Crate Isle', after: def.after,
    label: ['🔍', 'Spot It'], rule: { icon: '🔍', text: 'Pound the star crates', hint: '⭐ 3 crates · 60 s' },
    pad: { x: def.pad[0], y: kit.ground(def.pad[0], def.pad[1], 3), z: def.pad[1] }, leaveR: R + 8, color: 0x8a6cff,
    crates,
    get running() { return phase !== 'idle'; },
    begin(level) {
      reset();
      const k = (level - 1) / 4; markScale = lerp(1.3, 0.7, k); helpMin = lerp(0.75, 0.9, k);
      const idx = crates.map((_, j) => j).sort(() => Math.random() - 0.5).slice(0, COUNT);
      for (const j of idx) { crates[j].marked = true; crates[j].side = (Math.random() * 4) | 0; }
      draw(); phase = 'run'; t = 0; found = 0; lastFind = 0; pingT = 0.5;
      kit.chip(`🔍 0 / ${COUNT} · ${TIME} s`);
    },
    update(dt) {
      if (phase !== 'run') return null;
      t += dt;
      if (found >= COUNT || t >= TIME) { phase = 'idle'; return { hits: found, total: COUNT, won: found >= COUNT }; }
      if (((t - dt) | 0) !== (t | 0)) kit.chip(`🔍 ${found} / ${COUNT} · ${Math.max(0, Math.ceil(TIME - t))} s`);
      // locator ping: interval 1.6 s when looking away -> 0.22 s when looking right at a star crate
      kit.camera.getWorldDirection(fwd);
      let best = -1;
      for (const c of crates) if (c.marked && !c.open) { dir.set(c.x - kit.camera.position.x, c.y - kit.camera.position.y, c.z - kit.camera.position.z).normalize(); best = Math.max(best, fwd.dot(dir)); }
      const near = Math.max(0, Math.min(1, (best - helpMin) / (1 - helpMin)));
      pingT -= dt;
      if (pingT <= 0) { pingT = lerp(1.6, 0.22, near * near); kit.sfx('click'); kit.pinged = near; }
      return null;
    },
    respond(correct) { // debug: open the next star crate (correct) or a plain one (miss)
      if (phase !== 'run') return false;
      const k = crates.findIndex(c => !c.open && c.marked === !!correct);
      if (k < 0) return false;
      open(crates[k], k); return true;
    },
    cancel() { phase = 'idle'; },
  };
}
