/*
 * World: lights, sky, terrain, water, boundaries, then the hub + 3 zones (zones/*.js), props
 * and all star definitions.  One continuous scene ~200×200 m.
 */
import * as THREE from '../three.js';
import { CollisionWorld } from '../core/collision.js';
import { StaticBuilder, rand, setSeed } from './builder.js';
import { createSky } from './sky.js';
import { buildTerrain, paintTerrain, zoneAt, ZONE_NAMES, WATER_Y, WORLD_HALF } from './terrain.js';
import { buildHorizon, buildCloudSea } from './horizon.js';
import { createWater } from './water.js';
import { dressWorld } from './dressing.js';
import { PAL } from './palette.js';
import { vcMaterial, named } from './materials.js';

// Light rig tuned for the flat/toon look (punchy colours, no tone mapping).
// (three r155+ lights are not scaled by PI: lit faces get ~(key + hemi + ambient) / PI x albedo)
export const LIGHT = { key: 1.7, hemi: 1.2, back: 0.5, ambient: 0.9 };
import { createProps } from './props.js';
import * as extra from './props-extra.js';
import * as hub from './zones/hub.js';
import * as meadow from './zones/meadow.js';
import * as cove from './zones/cove.js';
import * as towers from './zones/towers.js';

// Suggested order for the placeholder objective (mixed zones, gentle difficulty ramp).
export const STAR_ORDER = ['meadow-1', 'meadow-2', 'meadow-3', 'cove-1', 'meadow-4', 'cove-2', 'cove-3',
  'towers-1', 'towers-2', 'towers-3', 'towers-4', 'cove-4', 'bonus-meadow', 'bonus-cove', 'bonus-towers'];

// Where each zone's path leaves the Treehouse Hub (wayfinding target while Pip is in another zone).
export const ZONE_ENTRANCES = { meadow: { x: -27, z: 4 }, cove: { x: 27, z: 2 }, towers: { x: 0, z: -28 } };

export function createWorld({ scene, events, state, mobile = false }) {
  setSeed(20261103);
  const col = new CollisionWorld(8);
  const staticMat = named(vcMaterial(), 'static-vc');
  const terrainMat = named(vcMaterial({ side: THREE.DoubleSide }), 'terrain');
  const horizonMat = named(new THREE.MeshBasicMaterial({ vertexColors: true }), 'horizon'); // baked shading

  // --- lights: warm shadowed key + cool hemisphere fill + soft cool back/rim light ---
  const hemi = new THREE.HemisphereLight(PAL.hemiSky, PAL.hemiGround, LIGHT.hemi);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PAL.keyLight, LIGHT.key);
  sun.castShadow = true;
  const sm = mobile ? 1024 : 2048;
  sun.shadow.mapSize.set(sm, sm);
  const sc = sun.shadow.camera; sc.left = -32; sc.right = 32; sc.top = 32; sc.bottom = -32; sc.near = 1; sc.far = 160;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04; sun.shadow.radius = 3;
  scene.add(sun); scene.add(sun.target);
  const back = new THREE.DirectionalLight(PAL.backLight, LIGHT.back);
  back.position.set(-30, 25, -40); scene.add(back);
  const fill = new THREE.AmbientLight(PAL.ambient, LIGHT.ambient); // warm lift so shade never reads grey
  scene.add(fill);
  const SUN_OFF = new THREE.Vector3(28, 55, 22);
  scene.fog = new THREE.Fog(PAL.skyHorizon, 150, 620);
  scene.background = new THREE.Color(PAL.skyHorizon);

  const sky = createSky(scene);
  const terrain = buildTerrain(col, terrainMat);
  scene.add(terrain);
  scene.add(buildHorizon(horizonMat));
  const cloudSeaMat = named(new THREE.MeshBasicMaterial({ vertexColors: true }), 'cloud-sea');
  scene.add(buildCloudSea(cloudSeaMat));

  // --- water (sea east of the cove + meadow pool): one mesh, waves in the vertex shader ---
  const water = createWater();
  scene.add(water.mesh);
  const waterMat = water.material;

  // --- invisible boundary walls (kids cannot run off the map edge) ---
  const W = WORLD_HALF - 1;
  for (const [x, z, sx, sz] of [[-W - 1, 0, 2, 220], [W + 1, 0, 2, 220], [0, -W - 1, 220, 2], [0, W + 1, 220, 2]])
    col.add({ kind: 'box', minX: x - sx / 2, maxX: x + sx / 2, minY: -60, maxY: 80, minZ: z - sz / 2, maxZ: z + sz / 2, camera: false, noWallKick: true });

  const P = createProps({ scene, col, events, state });
  P.ambient = []; // (dt) => void, run from the tick event unless the world is still
  const ctx = { THREE, col, P, extra, rand, scene, events, state, staticMat, PAL, mobile, ground: (x, z, m) => col.groundHeight(x, z, m) };
  const results = {};
  const occluders = [];
  for (const [name, mod] of [['hub', hub], ['meadow', meadow], ['cove', cove], ['towers', towers]]) {
    const sb = new StaticBuilder(col, name);
    ctx.sb = sb; ctx.occlude = (x, z, r, k = 0.35) => occluders.push([x, z, r, k]);
    results[name] = mod.build(ctx) || {};
    scene.add(sb.build(staticMat));
  }
  // the sea spills over the east lip of the Sky Towers abyss into the cloud sea
  extra.waterfall(P, 43.9, -18, -68, 64, 17.2, Math.PI / 2);
  const dressing = dressWorld({ scene, col, P, material: staticMat, mobile });
  paintTerrain(terrain, col, occluders.concat(dressing.occluders));
  P.finalize();

  // ambient animation (clouds, water, waterfall) from the shared tick event; frozen in focus mode
  events.on('tick', ({ dt }) => {
    if (P.still || !(dt > 0)) return;
    sky.drift(dt); water.update(dt);
    for (const f of P.ambient) f(dt);
  });

  const world = {
    col, props: P, scene, sun, hemi, back, fill, sky, water, waterMat, zones: results, dressing,
    spawn: results.hub.spawn || { x: 0, y: 0.1, z: 14, facing: Math.PI },
    zoneAt, zoneName: z => ZONE_NAMES[z] || z, STAR_ORDER,
    stars: P.stars,
    windAt: p => extra.windAt(P, p),
    onPound: (pos, r) => P.onPound(pos, r),
    hazardAt(p) { return p.x > 44 && p.y < WATER_Y - 1.0 ? 'water' : null; },
    update(dt, ctrl, respawn) { P.update(dt, ctrl, respawn); },
    animate(dt, t, focusPos, playerPos) {
      P.animate(dt, t);
      sky.follow(focusPos);
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
      for (const cp of P.checkpoints) { cp.active = false; cp.flagMat.color.setHex(PAL.flagBlue); }
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
    zoneEntrances: ZONE_ENTRANCES,
    zoneEntrance(zone) {
      const e = ZONE_ENTRANCES[zone]; if (!e) return null;
      return { x: e.x, y: col.groundHeight(e.x, e.z, 40) + 0.2, z: e.z };
    },
  };
  return world;
}
