/*
 * StaticBuilder: collects low-poly primitives with vertex colours, merges them into ONE mesh per
 * builder (one draw call) and registers matching colliders in the CollisionWorld.
 */
import * as THREE from '../three.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
const _c = new THREE.Color(), _t = new THREE.Color();
let seed = 1234567;
export function rand() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
export function setSeed(s) { seed = s; }

export class StaticBuilder {
  constructor(col, name = 'static') { this.col = col; this.name = name; this.parts = []; }

  // shade: { under: 0..1 (darken down-facing faces), ao: metres (darken the bottom of the part),
  //          top: hex (recolour up-facing faces, e.g. grass on a rock) }
  add(geo, matrix, color, jitter = 0.07, shade = null) {
    if (!matrix.elements.every(Number.isFinite)) { console.warn(`[builder:${this.name}] skipped non-finite part`, new Error().stack.split('\n')[3]); geo.dispose(); return this; }
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    this.parts.push({ g, color: new THREE.Color(color), jitter: jitter ?? 0.07, shade: shade || this.shade || null });
    geo.dispose();
    return this;
  }
  _mat(x, y, z, yaw = 0, sx = 1, sy = 1, sz = 1, pitch = 0, roll = 0) {
    _e.set(pitch, yaw, roll); _q.setFromEuler(_e); _s.set(sx, sy, sz); _p.set(x, y, z);
    return _m.compose(_p, _q, _s);
  }
  // Box by centre.  opts: yaw, collide(true), camera(true), flags{}
  box(x, y, z, sx, sy, sz, color, opts = {}) {
    const yaw = opts.yaw || 0;
    this.add(new THREE.BoxGeometry(sx, sy, sz), this._mat(x, y, z, yaw), color, opts.jitter, opts.shade);
    if (opts.collide === false) return null;
    const c = Math.abs(yaw) < 1e-6
      ? { kind: 'box', minX: x - sx / 2, maxX: x + sx / 2, minY: y - sy / 2, maxY: y + sy / 2, minZ: z - sz / 2, maxZ: z + sz / 2 }
      : { kind: 'obb', x, y, z, hx: sx / 2, hy: sy / 2, hz: sz / 2, yaw };
    if (opts.camera === false) c.camera = false;
    Object.assign(c, opts.flags || {});
    return this.col.add(c);
  }
  // Box by its TOP height (most platforms)
  slab(x, top, z, sx, sy, sz, color, opts) { return this.box(x, top - sy / 2, z, sx, sy, sz, color, opts); }
  // Vertical cylinder from y0 up by h.  opts: seg, rTop, collide, camera, flags
  cyl(x, y0, z, r, h, color, opts = {}) {
    const seg = opts.seg || 12, rTop = opts.rTop ?? r;
    this.add(new THREE.CylinderGeometry(rTop, r, h, seg, opts.hseg || 1), this._mat(x, y0 + h / 2, z, opts.yaw || 0), color, opts.jitter, opts.shade);
    if (opts.collide === false) return null;
    const c = { kind: 'cyl', x, z, y0, y1: y0 + h, r: Math.max(r, rTop) * (seg <= 8 ? 0.97 : 1) };
    if (opts.camera === false) c.camera = false;
    Object.assign(c, opts.flags || {});
    return this.col.add(c);
  }
  cone(x, y0, z, r, h, color, opts = {}) {
    this.add(new THREE.ConeGeometry(r, h, opts.seg || 8, 1), this._mat(x, y0 + h / 2, z, opts.yaw || 0), color, opts.jitter, opts.shade);
    if (opts.collide) return this.col.add({ kind: 'cyl', x, z, y0, y1: y0 + h * 0.6, r: r * 0.55 });
    return null;
  }
  sphere(x, y, z, r, color, opts = {}) {
    const sx = opts.sx || 1, sy = opts.sy || 1, sz = opts.sz || 1;
    this.add(new THREE.IcosahedronGeometry(r, opts.detail ?? 1), this._mat(x, y, z, opts.yaw || 0, sx, sy, sz), color, opts.jitter, opts.shade);
    if (opts.collide) return this.col.add({ kind: 'sphere', x, y, z, r: r * Math.min(sx, sy, sz) });
    return null;
  }
  // arbitrary geometry (no collider)
  geo(geo, x, y, z, color, { yaw = 0, pitch = 0, roll = 0, sx = 1, sy = 1, sz = 1, jitter, shade } = {}) {
    return this.add(geo, this._mat(x, y, z, yaw, sx, sy, sz, pitch, roll), color, jitter, shade);
  }
  // collider only (keeps gameplay boxes when the visual is replaced by nicer geometry)
  colliderBox(x, y, z, sx, sy, sz, flags = {}) {
    return this.col.add({ kind: 'box', minX: x - sx / 2, maxX: x + sx / 2, minY: y - sy / 2, maxY: y + sy / 2, minZ: z - sz / 2, maxZ: z + sz / 2, ...flags });
  }

  build(material) {
    let n = 0; for (const p of this.parts) n += p.g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let o = 0;
    for (const p of this.parts) {
      const P = p.g.attributes.position.array, N = p.g.attributes.normal.array, cnt = p.g.attributes.position.count;
      pos.set(P, o * 3); nor.set(N, o * 3);
      const sh = p.shade;
      let minY = Infinity, maxY = -Infinity;
      if (sh && sh.ao) for (let v = 0; v < cnt; v++) { const y = P[v * 3 + 1]; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      const topC = sh && sh.top !== undefined ? _t.set(sh.top) : null;
      for (let v = 0; v < cnt; v += 3) { // per-triangle brightness jitter = low-poly facets
        const k = 1 + (rand() - 0.5) * 2 * p.jitter;
        // face normal (y) from the averaged vertex normals
        const ny = (N[v * 3 + 1] + N[v * 3 + 4] + N[v * 3 + 7]) / 3;
        _c.copy(topC && ny > 0.55 ? topC : p.color).multiplyScalar(k);
        if (sh && sh.under && ny < -0.15) _c.multiplyScalar(1 - sh.under * Math.min(1, (-ny + 0.15)));
        for (let j = 0; j < 3 && v + j < cnt; j++) {
          const i = (o + v + j) * 3;
          let a = 1;
          if (sh && sh.ao) { const t = (P[(v + j) * 3 + 1] - minY) / Math.min(sh.ao, (maxY - minY) || 1); a = t >= 1 ? 1 : 0.62 + 0.38 * t * t * (3 - 2 * t); }
          col[i] = _c.r * a; col[i + 1] = _c.g * a; col[i + 2] = _c.b * a;
        }
      }
      o += cnt; p.g.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material);
    mesh.name = this.name; mesh.castShadow = true; mesh.receiveShadow = true;
    this.parts = [];
    return mesh;
  }
}
