/*
 * Objective beacon: a narrow (0.5 m), soft, additive light column AT the target (hidden within 3 m)
 * + a small fixed-size (0.6 m) 3D arrow 1.5 m above Pip's head that yaws toward the target, hides
 * within 4 m / during celebrations, and fades out whenever it would sit between camera and Pip.  Exactly 2 draw calls (column + arrow).
 * The column geometry holds a core and a thin outer "halo" shell; the halo is black (= invisible
 * with additive blending) until setFocus(true) brightens it, so focus mode adds no draw call.
 */
const H = 26;             // column height (m)
const COL_HIDE = 3;       // hide the column when the target is closer than this to Pip (m)
const COL_MAX_SCALE = 3;  // far-away widening cap (core radius 0.5 m -> at most 1.5 m)
const ARROW_HIDE = 4;     // hide the arrow when the target is closer than this (m)
const PIP_HEAD = 1.1;     // top of Pip's head above its feet (m)
const ARROW_UP = 1.5;     // arrow height above the head; 1.0 m when the camera looks down on Pip
const ARROW_LEN = 0.6;    // fixed world length of the arrow (m), never scaled by distance

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
  const core = new THREE.CylinderGeometry(0.5, 0.5, H, 20, 12, true);
  const halo = new THREE.CylinderGeometry(0.75, 0.75, H, 20, 12, true);
  const coreCount = core.attributes.position.count;
  const colGeo = mergeIndexed(THREE, [core, halo]);
  const n = colGeo.attributes.position.count;
  const colors = new Float32Array(n * 3);
  colGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const gold = new THREE.Color(0xffd84a), white = new THREE.Color(0xfff6c8);
  // soft at the base, bright "lamp" band near the top, short fade-out at the very top
  const sstep = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  const fadeAt = i => { const y = colGeo.attributes.position.getY(i); const t = (y + H / 2) / H; return (0.4 + 0.6 * sstep(0.45, 0.85, t)) * (1 - sstep(0.93, 1, t)); };
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
  aGeo.computeBoundingBox();
  const len = aGeo.boundingBox.max.z - aGeo.boundingBox.min.z;
  aGeo.scale(ARROW_LEN / len, ARROW_LEN / len, ARROW_LEN / len);       // baked in: fixed world size
  const arrowMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 1 });
  const arrow = new THREE.Mesh(aGeo, arrowMat);
  arrow.castShadow = false; arrow.renderOrder = 6; arrow.visible = false; arrow.matrixAutoUpdate = true;
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
  // distance from point p to the segment a-b (camera -> Pip)
  const vA = new THREE.Vector3(), vB = new THREE.Vector3();
  function segDist(p, a, b) {
    vA.subVectors(b, a); vB.subVectors(p, a);
    const L2 = vA.lengthSq(); const k = L2 > 0 ? Math.min(1, Math.max(0, vB.dot(vA) / L2)) : 0;
    return vB.addScaledVector(vA, -k).length();
  }
  const pipHead = new THREE.Vector3();
  let yaw = 0, t = 0, focus = false;
  return {
    column, arrow,
    setFocus(on) { if (on === focus) return; focus = on; paint(on); },
    hide() { column.visible = arrow.visible = false; },
    // target {x,y,z} | null, pipPos = rendered Pip position, still = no idle animation
    update(dt, target, pipPos, still, camPos) {
      t += dt;
      if (!target) { column.visible = arrow.visible = false; return Infinity; }
      const dx = target.x - pipPos.x, dz = target.z - pipPos.z, dy = target.y - pipPos.y;
      const flat = Math.hypot(dx, dz);
      // column: always AT the target (never at Pip), hidden when Pip is basically there
      column.visible = Math.hypot(flat, dy) > COL_HIDE;
      column.position.set(target.x, target.y - 1.2 + H / 2, target.z);
      if (camPos) { // keep a readable on-screen width when far away, capped so it stays a marker
        const k = Math.min(COL_MAX_SCALE, Math.max(1, Math.hypot(camPos.x - target.x, camPos.z - target.z) / 20));
        column.scale.set(k, 1, k);
      }
      colMat.opacity = still ? 1 : 0.85 + Math.sin(t * 2.4) * 0.15;
      arrow.visible = flat > ARROW_HIDE;
      if (arrow.visible) {
        const want = Math.atan2(dx, dz);
        let d = want - yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
        yaw += d * Math.min(1, dt * 10);
        // camera looking down on Pip -> sit lower (1.0 m above the head)
        const lookingDown = camPos && (camPos.y - pipPos.y) > 0.8 * Math.hypot(camPos.x - pipPos.x, camPos.z - pipPos.z); // > ~40° down
        const up = lookingDown ? 1.0 : ARROW_UP;
        arrow.position.set(pipPos.x, pipPos.y + PIP_HEAD + up + (still ? 0 : Math.sin(t * 3.2) * 0.08), pipPos.z);
        if (camPos) orientArrow(camPos); else arrow.rotation.set(0, yaw, 0);
        // never block the view of Pip: fade out when the arrow sits on the camera -> Pip line
        let alpha = 1;
        if (camPos) {
          pipHead.set(pipPos.x, pipPos.y + PIP_HEAD * 0.6, pipPos.z);
          const sd = segDist(arrow.position, camPos, pipHead);
          alpha = Math.min(1, Math.max(0, (sd - 0.25) / 0.5));
        }
        arrowMat.opacity = alpha; arrowMat.depthWrite = alpha > 0.99;
        if (alpha <= 0.02) arrow.visible = false;
      }
      return Math.hypot(flat, dy);
    },
  };
}
