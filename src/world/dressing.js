/*
 * Ground dressing (decorative only, no colliders):
 *  - ~800 instanced grass tufts (3 blades, dark base -> bright tip, per-instance tint)
 *  - ~400 instanced flowers in 4 colours (petals instanced-coloured + shared centre/stem mesh)
 *  - bushes and small warm rocks merged into one static mesh
 * Everything avoids paths, beaches, props and pickups.
 */
import * as THREE from '../three.js';
import { StaticBuilder, rand } from './builder.js';
import { PAL, TUFT_TINTS } from './palette.js';
import { zoneAt, terrainHeight, pathDist, sandAmount } from './terrain.js';

function merge(parts) { // [{geo, color}] -> vertex-coloured BufferGeometry
  let n = 0; const gs = parts.map(p => { const g = p.geo.index ? p.geo.toNonIndexed() : p.geo; n += g.attributes.position.count; return [g, p]; });
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
  const c = new THREE.Color(), c2 = new THREE.Color();
  for (const [g, p] of gs) {
    const P = g.attributes.position.array, cnt = g.attributes.position.count;
    pos.set(P, o * 3);
    c.set(p.color); c2.set(p.tip ?? p.color);
    for (let v = 0; v < cnt; v++) {
      const t = p.tip !== undefined ? Math.min(1, Math.max(0, P[v * 3 + 1] / p.h)) : 0;
      const r = c.r + (c2.r - c.r) * t, gg = c.g + (c2.g - c.g) * t, b = c.b + (c2.b - c.b) * t;
      col[(o + v) * 3] = r; col[(o + v) * 3 + 1] = gg; col[(o + v) * 3 + 2] = b;
    }
    o += cnt;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals(); geo.computeBoundingSphere();
  return geo;
}

export function dressWorld({ scene, col, P, material, mobile }) {
  const pickups = [];
  for (const c of P.coins) pickups.push([c.x, c.z]);
  for (const s of P.stars) pickups.push([s.x, s.z]);
  for (const c of P.checkpoints) pickups.push([c.x, c.z]);
  for (const s of P.switches) pickups.push([s.x, s.z]);
  const nearPickup = (x, z, r) => { for (const [px, pz] of pickups) if ((px - x) * (px - x) + (pz - z) * (pz - z) < r * r) return true; return false; };
  const nearCollider = (x, z, r, h) => {
    for (const o of col.query(x - r, z - r, x + r, z + r)) {
      if (!o.solid || o.bMaxY < h - 0.2 || o.bMinY > h + 3) continue;
      if (x > o.bMinX - r && x < o.bMaxX + r && z > o.bMinZ - r && z < o.bMaxZ + r) return true;
    }
    return false;
  };
  // a grassy, open spot?
  const grassy = (x, z, pathR) => {
    const zone = zoneAt(x, z);
    if (zone === 'towers') return null;
    if (Math.hypot(x, z) < 5) return null;
    if (sandAmount(x, z) > 0.1) return null;
    const h = terrainHeight(x, z); if (h === null || h < -0.15) return null;
    if (pathDist(x, z) < pathR) return null;
    const g = col.groundHeight(x, z, h + 0.05); if (Math.abs(g - h) > 0.05) return null;
    return h;
  };

  // ---- grass tufts ----
  const blades = [];
  for (let k = 0; k < 3; k++) {
    const g = new THREE.ConeGeometry(0.09, 0.62, 3, 1, true); g.translate(0, 0.31, 0);
    g.rotateZ((k - 1) * 0.35); g.rotateY(k * 2.1); g.translate((k - 1) * 0.08, 0, (k % 2) * 0.06);
    blades.push({ geo: g, color: PAL.grassLo, tip: PAL.grassHi, h: 0.62 });
  }
  const NT = mobile ? 650 : 800;
  const tuftMat = material.clone(); tuftMat.name = 'grass-tufts'; tuftMat.flatShading = false;
  const tufts = new THREE.InstancedMesh(merge(blades), tuftMat, NT);
  // ---- flowers: petals (instance colour) + centre/stem (vertex colour) ----
  const petals = [];
  for (let k = 0; k < 5; k++) {
    const a = k * 1.2566, g = new THREE.OctahedronGeometry(0.1, 0);
    g.scale(1.3, 0.45, 0.8); g.rotateY(-a); g.translate(Math.cos(a) * 0.11, 0.42, Math.sin(a) * 0.11);
    petals.push({ geo: g, color: PAL.white });
  }
  const centre = new THREE.OctahedronGeometry(0.07, 0); centre.translate(0, 0.45, 0);
  const stem = new THREE.CylinderGeometry(0.018, 0.024, 0.42, 3, 1, true); stem.translate(0, 0.21, 0);
  const leafG = new THREE.OctahedronGeometry(0.07, 0); leafG.scale(1.6, 0.3, 0.7); leafG.translate(0.08, 0.14, 0);
  const NF = mobile ? 320 : 400;
  const petalMat = material.clone(); petalMat.name = 'flower-petals';
  const petalMesh = new THREE.InstancedMesh(merge(petals), petalMat, NF);
  const stemMat = material.clone(); stemMat.name = 'flower-stems';
  const stemMesh = new THREE.InstancedMesh(merge([{ geo: centre, color: PAL.flowerCentre }, { geo: stem, color: PAL.stem }, { geo: leafG, color: PAL.leafHi }]), stemMat, NF);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  const flowerCols = [PAL.flowerPink, PAL.flowerYellow, PAL.flowerWhite, PAL.flowerPurple];
  const tuftTints = TUFT_TINTS.map(h => new THREE.Color(h));
  let ti = 0, fi = 0, tries = 0;
  // flowers grow in little clumps
  while (fi < NF && tries++ < 20000) {
    const cx = (rand() * 2 - 1) * 96, cz = (rand() * 2 - 1) * 96;
    if (grassy(cx, cz, 3) === null) continue;
    const colr = flowerCols[Math.floor(rand() * 4)];
    const k = 3 + Math.floor(rand() * 5);
    for (let j = 0; j < k && fi < NF; j++) {
      const x = cx + (rand() - 0.5) * 2.4, z = cz + (rand() - 0.5) * 2.4;
      const h = grassy(x, z, 2.8); if (h === null) continue;
      q.setFromAxisAngle(up, rand() * 6.28); s.setScalar(0.85 + rand() * 0.5); p.set(x, h - 0.02, z); m.compose(p, q, s);
      petalMesh.setMatrixAt(fi, m); stemMesh.setMatrixAt(fi, m); petalMesh.setColorAt(fi, c.set(colr)); fi++;
    }
  }
  tries = 0;
  while (ti < NT && tries++ < 40000) {
    const x = (rand() * 2 - 1) * 97, z = (rand() * 2 - 1) * 97;
    let h = grassy(x, z, 2.4);
    // a few dune-grass tufts on the upper beach
    if (h === null && sandAmount(x, z) > 0.1 && zoneAt(x, z) !== 'towers' && rand() < 0.12) {
      const th = terrainHeight(x, z); if (th !== null && th > 0 && pathDist(x, z) > 2.4 && Math.abs(col.groundHeight(x, z, th + 0.05) - th) < 0.05) h = th;
    }
    if (h === null) continue;
    q.setFromAxisAngle(up, rand() * 6.28); s.set(0.8 + rand() * 0.6, 0.7 + rand() * 0.8, 0.8 + rand() * 0.6); p.set(x, h - 0.03, z); m.compose(p, q, s);
    tufts.setMatrixAt(ti, m); tufts.setColorAt(ti, tuftTints[ti % 4]); ti++;
  }
  tufts.count = ti; petalMesh.count = fi; stemMesh.count = fi;
  for (const im of [tufts, petalMesh, stemMesh]) { im.frustumCulled = false; im.castShadow = false; im.receiveShadow = true; scene.add(im); }
  tufts.name = 'grass-tufts'; petalMesh.name = 'flowers'; stemMesh.name = 'flower-stems';

  // ---- bushes + small warm rocks (merged, no colliders) ----
  const sb = new StaticBuilder(col, 'dressing');
  let nb = 0, nr = 0; tries = 0;
  const bushCols = [[PAL.bush, PAL.bushHi], [PAL.leaf, PAL.leafHi], [PAL.leafLo, PAL.leaf]];
  const occluders = [];
  while ((nb < 46 || nr < 40) && tries++ < 12000) {
    const x = (rand() * 2 - 1) * 95, z = (rand() * 2 - 1) * 95;
    const h = grassy(x, z, 3.6); if (h === null) continue;
    if (nearPickup(x, z, 2.6) || nearCollider(x, z, 1.8, h)) continue;
    if (nb < 46 && rand() < 0.55) {
      const [a, b] = bushCols[Math.floor(rand() * 3)], S = 0.7 + rand() * 0.6;
      sb.sphere(x, h + 0.45 * S, z, 0.85 * S, a, { detail: 1, sy: 0.8, shade: { under: 0.35 } });
      sb.sphere(x + 0.7 * S, h + 0.35 * S, z + 0.2 * S, 0.62 * S, b, { detail: 1, sy: 0.8, shade: { under: 0.35 } });
      sb.sphere(x - 0.55 * S, h + 0.32 * S, z - 0.3 * S, 0.55 * S, b, { detail: 1, sy: 0.8, shade: { under: 0.35 } });
      if (rand() < 0.5) for (let k = 0; k < 3; k++) sb.sphere(x + (rand() - 0.5) * 1.2 * S, h + 0.75 * S, z + 0.55 * S + rand() * 0.2, 0.09, rand() < 0.5 ? PAL.flowerPink : PAL.flowerWhite, { detail: 0, jitter: 0 });
      occluders.push([x, z, 1.8 * S, 0.3]); nb++;
    } else if (nr < 40) {
      const S = 0.35 + rand() * 0.5;
      sb.geo(new THREE.DodecahedronGeometry(S, 0), x, h + S * 0.25, z, [PAL.stone, PAL.sandstone4, PAL.sandstone][Math.floor(rand() * 3)], { sy: 0.65, yaw: rand() * 6, jitter: 0.1, shade: { top: rand() < 0.4 ? PAL.grassHi : undefined } });
      occluders.push([x, z, 1.0 * S + 0.6, 0.22]); nr++;
    }
  }
  const dress = sb.build(material); dress.castShadow = true; dress.receiveShadow = true;
  scene.add(dress);
  return { tufts, flowers: petalMesh, occluders, counts: { tufts: ti, flowers: fi, bushes: nb, rocks: nr } };
}
