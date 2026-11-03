/*
 * World: lights, sky, terrain, water, boundaries, then the hub + 3 zones (zones/*.js), props
 * and all star definitions.  One continuous scene ~200×200 m.
 */
import * as THREE from '../three.js';
import { CollisionWorld } from '../core/collision.js';
import { StaticBuilder, rand, setSeed } from './builder.js';
import { createSky } from './sky.js';
import { buildTerrain, zoneAt, ZONE_NAMES, WATER_Y, WORLD_HALF, terrainHeight, PATHS } from './terrain.js';
import { createProps } from './props.js';
import * as extra from './props-extra.js';
import * as hub from './zones/hub.js';
import * as meadow from './zones/meadow.js';
import * as cove from './zones/cove.js';
import * as towers from './zones/towers.js';

// Suggested order for the placeholder objective (mixed zones, gentle difficulty ramp).
export const STAR_ORDER = ['meadow-1', 'meadow-2', 'meadow-3', 'cove-1', 'meadow-4', 'cove-2', 'cove-3',
  'towers-1', 'towers-2', 'towers-3', 'towers-4', 'cove-4', 'bonus-meadow', 'bonus-cove', 'bonus-towers'];

export function createWorld({ scene, events, state, mobile = false }) {
  setSeed(20261103);
  const col = new CollisionWorld(8);
  const staticMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });

  // --- lights: one shadowed sun + hemisphere fill ---
  const hemi = new THREE.HemisphereLight(0xd6f0ff, 0x7a9a5a, 1.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d8, 2.4);
  sun.castShadow = true;
  const sm = mobile ? 1024 : 2048;
  sun.shadow.mapSize.set(sm, sm);
  const sc = sun.shadow.camera; sc.left = -32; sc.right = 32; sc.top = 32; sc.bottom = -32; sc.near = 1; sc.far = 160;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
  scene.add(sun); scene.add(sun.target);
  const SUN_OFF = new THREE.Vector3(28, 55, 22);
  scene.fog = new THREE.Fog(0xd8f2ff, 90, 300);

  const sky = createSky(scene);
  scene.add(buildTerrain(col, terrainMat));

  // --- water (sea east of the cove + meadow pool) ---
  const waterMat = new THREE.MeshLambertMaterial({ color: 0x35b4ec, transparent: true, opacity: 0.8, emissive: 0x0a3a60, depthWrite: false });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(500, 700, 1, 1), waterMat);
  sea.rotation.x = -Math.PI / 2; sea.position.set(44 + 250, WATER_Y, 0); scene.add(sea);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(7.5, 20), waterMat);
  pool.rotation.x = -Math.PI / 2; pool.position.set(-84, -0.35, 2); scene.add(pool);

  // --- invisible boundary walls (kids cannot run off the map edge) ---
  const W = WORLD_HALF - 1;
  for (const [x, z, sx, sz] of [[-W - 1, 0, 2, 220], [W + 1, 0, 2, 220], [0, -W - 1, 220, 2], [0, W + 1, 220, 2]])
    col.add({ kind: 'box', minX: x - sx / 2, maxX: x + sx / 2, minY: -60, maxY: 80, minZ: z - sz / 2, maxZ: z + sz / 2, camera: false, noWallKick: true });

  const P = createProps({ scene, col, events, state });
  const ctx = { THREE, col, P, extra, rand, scene, events, state, staticMat, ground: (x, z, m) => col.groundHeight(x, z, m) };
  const results = {};
  for (const [name, mod] of [['hub', hub], ['meadow', meadow], ['cove', cove], ['towers', towers]]) {
    const sb = new StaticBuilder(col, name);
    ctx.sb = sb;
    results[name] = mod.build(ctx) || {};
    scene.add(sb.build(staticMat));
  }
  scatterGrass(scene, col);
  P.finalize();

  const world = {
    col, props: P, scene, sun, hemi, sky, zones: results,
    spawn: results.hub.spawn || { x: 0, y: 0.1, z: 14, facing: Math.PI },
    zoneAt, zoneName: z => ZONE_NAMES[z] || z, STAR_ORDER,
    stars: P.stars,
    windAt: p => extra.windAt(P, p),
    onPound: (pos, r) => P.onPound(pos, r),
    hazardAt(p) { return p.x > 44 && p.y < WATER_Y - 1.0 ? 'water' : null; },
    update(dt, ctrl, respawn) { P.update(dt, ctrl, respawn); },
    animate(dt, t, focusPos, playerPos) {
      P.animate(dt, t);
      sky.update(dt, focusPos, P.still);
      if (!P.still) waterMat.emissiveIntensity = 0.8 + Math.sin(t * 1.3) * 0.2;
      // shadow camera follows the player, snapped to texels to avoid shimmering
      const step = 64 / sm;
      const tx = Math.round(playerPos.x / step) * step, tz = Math.round(playerPos.z / step) * step;
      sun.target.position.set(tx, playerPos.y, tz);
      sun.position.set(tx + SUN_OFF.x, playerPos.y + SUN_OFF.y, tz + SUN_OFF.z);
    },
    // ---- save integration ----
    applySave(save) {
      const has = id => save.coinIds.includes(id);
      for (const c of P.coins) {
        c.magnet = false; c.popT = 0;
        if (c.home) { c.x = c.home[0]; c.y = c.home[1]; c.z = c.home[2]; } else c.home = [c.x, c.y, c.z];
        if (c.type === 'redcoin') c.alive = !(save.redCoins[c.starId] || []).includes(c.index) && !has(c.id);
        else c.alive = !c.hidden && !has(c.id);
      }
      for (const e of P.entities) if (e.type === 'grumble') { e.alive = true; e.mesh.visible = true; e.mesh.scale.set(1, 1, 1); e.drops.forEach(d => { d.hidden = true; d.alive = false; }); e.x = e.a[0]; e.z = e.a[1]; e.y = P.ground(e.x, e.z); }
      for (const s of P.stars) {
        s.collected = save.stars.includes(s.id); s.revealT = 0;
        s.revealed = !s.hidden || s.collected;
        s.mesh.material = s.collected ? P.ghostMaterial : P.starMaterial; s.glow.visible = !s.collected;
        if (s.task === 'redcoins' && (save.redCoins[s.id] || []).length >= 8) s.revealed = true;
        if (s.bonus && (save.coins[s.zone] || 0) >= 100) s.revealed = true;
        s.mesh.visible = s.revealed;
      }
      for (const r of Object.values(results)) if (r.apply) r.apply(save);
      for (const cp of P.checkpoints) { cp.active = false; cp.flagMat.color.setHex(0x4f7de0); }
      P.activeCheckpoint = null;
      const cp = save.checkpoint && P.checkpoints.find(c => c.id === save.checkpoint.id);
      if (cp) P.activateCheckpoint(cp, true);
    },
    respawnPoint() {
      const cp = P.activeCheckpoint;
      if (cp) return { x: cp.x + Math.sin(cp.facing) * 1.5, y: cp.y + 0.1, z: cp.z + Math.cos(cp.facing) * 1.5, facing: cp.facing };
      return world.spawn;
    },
    // ---- objectives helpers (placeholder until systems/objectives.js) ----
    nextStar() { for (const id of STAR_ORDER) { const s = P.starById.get(id); if (s && !s.collected) return s; } return null; },
    objectiveTarget(star, from) {
      if (!star) return null;
      if (star.revealed && !star.collected) return { x: star.x, y: star.y, z: star.z };
      if (star.target) { const t = star.target(from); if (t) return t; }
      return { x: star.x, y: star.y, z: star.z };
    },
    listPickups() {
      const out = [];
      for (const c of P.coins) if (c.alive) out.push({ id: c.id, type: c.type, x: +c.x.toFixed(2), y: +c.y.toFixed(2), z: +c.z.toFixed(2), zone: c.zone });
      for (const s of P.stars) out.push({ id: s.id, type: 'star', x: s.x, y: s.y, z: s.z, zone: s.zone, name: s.name, revealed: s.revealed, collected: s.collected });
      return out;
    },
    findPickup(id) { return P.coinById.get(id) || P.starById.get(id) || null; },
    coinCounts() { const o = {}; for (const c of P.coins) o[c.zone] = (o[c.zone] || 0) + c.value; return o; },
    setStill(v) { P.still = !!v; },
  };
  return world;
}

// Instanced grass tufts + flowers on grassy ground (2 draw calls).
function scatterGrass(scene, col) {
  const tuft = new THREE.ConeGeometry(0.16, 0.55, 3); tuft.translate(0, 0.25, 0);
  const grass = new THREE.InstancedMesh(tuft, new THREE.MeshLambertMaterial({ color: 0x5fb842, flatShading: true }), 900);
  const flowerGeo = new THREE.IcosahedronGeometry(0.14, 0); flowerGeo.translate(0, 0.25, 0);
  const flowers = new THREE.InstancedMesh(flowerGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), 260);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  const palette = [0xff6b9a, 0xffe14a, 0xffffff, 0xb48cff, 0xff8a3c];
  let gi = 0, fi = 0, tries = 0;
  while ((gi < 900 || fi < 260) && tries++ < 20000) {
    const x = (rand() * 2 - 1) * 96, z = (rand() * 2 - 1) * 96;
    const zone = zoneAt(x, z);
    if (zone === 'cove' || zone === 'towers' || x > 20) continue;
    if (Math.hypot(x, z) < 5) continue;
    const h = terrainHeight(x, z); if (h === null || h < -0.2) continue;
    const g = col.groundHeight(x, z, h + 0.05); if (Math.abs(g - h) > 0.05) continue; // not under props
    let path = false; for (const [x0, z0, x1, z1] of PATHS) { const dx = x1 - x0, dz = z1 - z0, t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz))); if (Math.hypot(x - x0 - dx * t, z - z0 - dz * t) < 2.6) path = true; }
    if (path) continue;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28);
    p.set(x, h, z);
    if (gi < 900) { s.setScalar(0.7 + rand() * 0.8); m.compose(p, q, s); grass.setMatrixAt(gi++, m); }
    else if (fi < 260) { s.setScalar(1); m.compose(p, q, s); flowers.setMatrixAt(fi, m); flowers.setColorAt(fi++, c.setHex(palette[Math.floor(rand() * palette.length)])); }
  }
  grass.count = gi; flowers.count = fi;
  grass.receiveShadow = true; grass.frustumCulled = false; flowers.frustumCulled = false;
  scene.add(grass); scene.add(flowers);
}
