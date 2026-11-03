/*
 * Objective beacon: a tall, soft, additive light column at the target + a chunky 3D arrow that
 * floats above Pip's head and yaws toward the target.  Exactly 2 draw calls (column + arrow).
 * The column geometry holds a core and a thin outer "halo" shell; the halo is black (= invisible
 * with additive blending) until setFocus(true) brightens it, so focus mode adds no draw call.
 */
const H = 70;             // column height (m)
const ARROW_HIDE = 4;     // hide the arrow when the target is closer than this (m)
const HEAD = 2.3;         // arrow height above Pip's feet (~1.3 m above the head)

function mergeIndexed(THREE, geos) {
  const pos = [], idx = []; let off = 0;
  for (const g of geos) {
    const p = g.attributes.position.array; for (let i = 0; i < p.length; i++) pos.push(p[i]);
    const ix = g.index ? g.index.array : [...Array(p.length / 3).keys()];
    for (let i = 0; i < ix.length; i++) idx.push(ix[i] + off);
    off += p.length / 3;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  return out;
}

export function createBeacon(THREE, scene) {
  // ---- column: core (0..coreCount) + halo shell ----
  const core = new THREE.CylinderGeometry(0.75, 0.95, H, 24, 8, true);
  const halo = new THREE.CylinderGeometry(1.3, 1.45, H, 24, 8, true);
  const coreCount = core.attributes.position.count;
  const colGeo = mergeIndexed(THREE, [core, halo]);
  const n = colGeo.attributes.position.count;
  const colors = new Float32Array(n * 3);
  colGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const gold = new THREE.Color(0xffd84a), white = new THREE.Color(0xfff6c8);
  const fadeAt = i => { const y = colGeo.attributes.position.getY(i); const t = (y + H / 2) / H; return Math.pow(1 - t, 1.2); };
  function paint(focus) {
    for (let i = 0; i < n; i++) {
      const f = fadeAt(i);
      const isHalo = i >= coreCount;
      const c = isHalo ? white : gold;
      const k = isHalo ? (focus ? 0.8 : 0) : 1.0;
      colors[i * 3] = c.r * f * k; colors[i * 3 + 1] = c.g * f * k; colors[i * 3 + 2] = c.b * f * k;
    }
    colGeo.attributes.color.needsUpdate = true;
  }
  paint(false);
  const colMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false });
  const column = new THREE.Mesh(colGeo, colMat);
  column.castShadow = false; column.receiveShadow = false; column.frustumCulled = false;
  column.renderOrder = 5; column.visible = false;
  scene.add(column);

  // ---- arrow: extruded arrow shape lying in XZ, pointing +Z ----
  const s = new THREE.Shape();
  s.moveTo(-0.22, -0.55); s.lineTo(0.22, -0.55); s.lineTo(0.22, 0.05); s.lineTo(0.5, 0.05);
  s.lineTo(0, 0.65); s.lineTo(-0.5, 0.05); s.lineTo(-0.22, 0.05); s.closePath();
  const aGeo = new THREE.ExtrudeGeometry(s, { depth: 0.26, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 1 });
  // rotateX(-90°) lays the shape flat with its tip toward -Z; rotateY(180°) turns the tip to +Z
  aGeo.translate(0, 0, -0.13); aGeo.rotateX(-Math.PI / 2); aGeo.rotateY(Math.PI);
  aGeo.computeVertexNormals();
  const an = aGeo.attributes.normal, ac = new Float32Array(an.count * 3);
  const top = new THREE.Color(0xffe45a), side = new THREE.Color(0xd9661a), tmp = new THREE.Color();
  for (let i = 0; i < an.count; i++) { tmp.copy(side).lerp(top, Math.max(0, an.getY(i))); ac[i * 3] = tmp.r; ac[i * 3 + 1] = tmp.g; ac[i * 3 + 2] = tmp.b; }
  aGeo.setAttribute('color', new THREE.BufferAttribute(ac, 3));
  const arrow = new THREE.Mesh(aGeo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  arrow.castShadow = false; arrow.renderOrder = 6; arrow.visible = false; arrow.scale.setScalar(0.9);
  scene.add(arrow);

  // the arrow plane is turned toward the camera (around its pointing axis) so its shape always reads
  const vD = new THREE.Vector3(), vN = new THREE.Vector3(), vX = new THREE.Vector3(), basis = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0);
  function orientArrow(camPos) {
    vD.set(Math.sin(yaw), 0, Math.cos(yaw));
    vN.copy(camPos).sub(arrow.position).normalize();
    vN.addScaledVector(vD, -vN.dot(vD));
    if (vN.lengthSq() < 0.04) vN.copy(UP);
    vN.normalize();
    if (vN.y < 0.35) { vN.y = 0.35; vN.addScaledVector(vD, -vN.dot(vD)).normalize(); } // never steeper than ~70°
    vX.crossVectors(vN, vD).normalize();
    basis.makeBasis(vX, vN, vD);
    arrow.quaternion.setFromRotationMatrix(basis);
  }
  let yaw = 0, t = 0, focus = false;
  return {
    column, arrow,
    setFocus(on) { if (on === focus) return; focus = on; paint(on); },
    hide() { column.visible = arrow.visible = false; },
    // target {x,y,z} | null, pipPos = rendered Pip position, still = no idle animation
    update(dt, target, pipPos, still, camPos) {
      t += dt;
      if (!target) { column.visible = arrow.visible = false; return Infinity; }
      column.visible = true;
      column.position.set(target.x, target.y - 1.2 + H / 2, target.z);
      if (camPos) { // keep a readable on-screen width when far away
        const k = Math.min(5, Math.max(1, Math.hypot(camPos.x - target.x, camPos.z - target.z) / 14));
        column.scale.set(k, 1, k);
      }
      colMat.opacity = still ? 1 : 0.85 + Math.sin(t * 2.4) * 0.15;
      const dx = target.x - pipPos.x, dz = target.z - pipPos.z, dy = target.y - pipPos.y;
      const flat = Math.hypot(dx, dz);
      arrow.visible = flat > ARROW_HIDE;
      if (arrow.visible) {
        const want = Math.atan2(dx, dz);
        let d = want - yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
        yaw += d * Math.min(1, dt * 10);
        arrow.position.set(pipPos.x, pipPos.y + HEAD + (still ? 0 : Math.sin(t * 3.2) * 0.12), pipPos.z);
        if (camPos) orientArrow(camPos); else arrow.rotation.set(0, yaw, 0);
      }
      return Math.hypot(flat, dy);
    },
  };
}
