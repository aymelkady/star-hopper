/*
 * Water: the sea east of the cove + the meadow waterfall pool in ONE mesh.  Vertex colours give
 * depth (deep blue -> turquoise shallows -> a lighter foam ring at the shore); gentle waves are
 * displaced in the vertex shader (uTime), flat shading makes the facets sparkle.
 */
import * as THREE from '../three.js';
import { PAL } from './palette.js';
import { terrainHeight, smooth, WATER_Y } from './terrain.js';
import { outerHeight } from './horizon.js';

export const POOL = { x: -84, z: 2, r: 7.5, y: -0.35 };

export function createWater() {
  const pos = [], cols = [];
  const deep = new THREE.Color(PAL.waterDeep), mid = new THREE.Color(PAL.water), shallow = new THREE.Color(PAL.waterShallow), foam = new THREE.Color(PAL.foam);
  const c = new THREE.Color();
  const ground = (x, z) => (Math.abs(x) <= 100 && Math.abs(z) <= 100 ? (terrainHeight(x, z) ?? -45) : outerHeight(x, z));
  const colorAt = (depth) => {
    if (depth < 0.32) return c.copy(foam);
    if (depth < 0.9) return c.copy(shallow).lerp(foam, smooth(0.9, 0.32, depth) * 0.7);
    if (depth < 3.5) return c.copy(mid).lerp(shallow, smooth(3.5, 0.9, depth));
    return c.copy(deep).lerp(mid, smooth(9, 3.5, depth));
  };
  const quad = (x, z, s, y, depthFn) => {
    const P = [[x, z], [x + s, z], [x, z + s], [x + s, z + s]].map(([px, pz]) => [px, y, pz, depthFn(px, pz)]);
    for (const [a, b, d] of [[0, 2, 3], [0, 3, 1]]) for (const k of [a, b, d]) {
      const p = P[k]; pos.push(p[0], p[1], p[2]); colorAt(p[3]); cols.push(c.r, c.g, c.b);
    }
  };
  // near sea: fine grid so the shore foam follows the coastline
  const seaDepth = (x, z) => WATER_Y - ground(x, z);
  for (let x = 36; x < 220; x += 2.5) for (let z = -140; z < 140; z += 2.5) {
    // skip quads fully on dry land
    if (seaDepth(x, z) < -0.6 && seaDepth(x + 2.5, z) < -0.6 && seaDepth(x, z + 2.5) < -0.6 && seaDepth(x + 2.5, z + 2.5) < -0.6) continue;
    quad(x, z, 2.5, WATER_Y, seaDepth);
  }
  // far sea: big quads (deep colour) out past the fog
  const big = (x0, z0, x1, z1) => {
    const s = 80;
    for (let x = x0; x < x1; x += s) for (let z = z0; z < z1; z += s) quad(x, z, s, WATER_Y, () => 20);
  };
  big(220, -940, 940, 940); big(36, 140, 220, 940); big(36, -940, 220, -140);
  // meadow pool (circle)
  const poolDepth = (x, z) => POOL.y - (terrainHeight(x, z) ?? -5);
  const segs = 28, rings = 4;
  for (let r = 0; r < rings; r++) for (let s = 0; s < segs; s++) {
    const r0 = (r / rings) * POOL.r, r1 = ((r + 1) / rings) * POOL.r, a0 = (s / segs) * Math.PI * 2, a1 = ((s + 1) / segs) * Math.PI * 2;
    const p = (rr, a) => { const x = POOL.x + Math.cos(a) * rr, z = POOL.z + Math.sin(a) * rr; return [x, POOL.y, z, rr > POOL.r * 0.9 ? 0.1 : poolDepth(x, z) + 0.4]; };
    const A = p(r0, a0), B = p(r1, a0), C2 = p(r1, a1), D = p(r0, a1);
    for (const t of [[A, C2, B], [A, D, C2]]) for (const q of t) { pos.push(q[0], q[1], q[2]); colorAt(q[3]); cols.push(c.r, c.g, c.b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals(); g.computeBoundingSphere();

  const uniforms = { uTime: { value: 0 } };
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: PAL.waterDeep, emissiveIntensity: 0.22 });
  mat.name = 'water';
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        vec4 wp = modelMatrix * vec4(transformed, 1.0);
        float fade = 1.0 - smoothstep(160.0, 260.0, length(wp.xz));
        transformed.y += fade * (0.09 * sin(wp.x * 0.42 + uTime * 1.4) + 0.07 * sin(wp.z * 0.33 - uTime * 1.1) + 0.04 * sin((wp.x + wp.z) * 0.9 + uTime * 2.3));
      }`);
  };
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'water'; mesh.receiveShadow = true; mesh.frustumCulled = false;
  return { mesh, material: mat, update(dt) { uniforms.uTime.value += dt; } };
}
