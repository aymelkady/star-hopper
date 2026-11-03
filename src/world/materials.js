/*
 * Shared world materials.  One look everywhere: flat-shaded, vertex-coloured, with a procedural
 * 3-step toon ramp (STYLE = 'toon') or plain Lambert (STYLE = 'lambert').  Picked by screenshot.
 */
import * as THREE from '../three.js';
import { PAL } from './palette.js';

export const STYLE = 'toon';

let ramp = null;
// 3-step gradient map built procedurally (shadow / mid / lit), soft enough for terrain slopes.
export function toonRamp() {
  if (ramp) return ramp;
  const data = new Uint8Array([120, 190, 255]);
  ramp = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.generateMipmaps = false; ramp.needsUpdate = true;
  return ramp;
}

// Material for merged vertex-coloured meshes.
export function vcMaterial(extra = {}) {
  const m = STYLE === 'toon'
    ? new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp(), ...extra })
    : new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...extra });
  if (STYLE === 'toon' && extra.flatShading !== false) m.flatShading = true;
  return m;
}
// Solid-colour material (props whose colour changes at runtime).
export function solid(color, extra = {}) {
  const m = STYLE === 'toon'
    ? new THREE.MeshToonMaterial({ color, gradientMap: toonRamp(), ...extra })
    : new THREE.MeshLambertMaterial({ color, ...extra });
  return m;
}
export const named = (m, name) => { m.name = name; return m; };
export { PAL };
