/*
 * Hand-rolled collision world.  Shapes (all "collider" objects are plain JS objects):
 *   {kind:'box',  minX,minY,minZ,maxX,maxY,maxZ}          axis-aligned box
 *   {kind:'obb',  x,y,z, hx,hy,hz, yaw}                     box rotated about Y only
 *   {kind:'sphere', x,y,z, r}
 *   {kind:'cyl',  x,z, y0,y1, r}                            vertical cylinder
 * plus a single optional heightfield (terrain) with holes.
 * Optional collider flags: solid (default true), camera (default true: blocks the camera),
 * bounce (apex metres for mushrooms), noWallKick, owner, onStand(ctrl), dx/dy/dz (platform delta).
 * Static colliders live in a uniform grid (8 m cells); moving ones in a small dynamic list.
 */
export class Heightfield {
  constructor(x0, z0, cell, nx, nz) {
    this.x0 = x0; this.z0 = z0; this.cell = cell; this.nx = nx; this.nz = nz;
    this.h = new Float32Array((nx + 1) * (nz + 1));
    this.hole = new Uint8Array(nx * nz);
  }
  vi(i, j) { return j * (this.nx + 1) + i; }
  // returns false or fills o {h, nx, ny, nz}
  sample(x, z, o) {
    const fx0 = (x - this.x0) / this.cell, fz0 = (z - this.z0) / this.cell;
    const i = Math.floor(fx0), j = Math.floor(fz0);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return false;
    if (this.hole[j * this.nx + i]) return false;
    const fx = fx0 - i, fz = fz0 - j, H = this.h, c = this.cell;
    const ha = H[this.vi(i, j)], hb = H[this.vi(i + 1, j)], hc = H[this.vi(i, j + 1)], hd = H[this.vi(i + 1, j + 1)];
    let gx, gz;
    if (fx >= fz) { o.h = ha + (hb - ha) * fx + (hd - hb) * fz; gx = (hb - ha) / c; gz = (hd - hb) / c; }
    else { o.h = ha + (hc - ha) * fz + (hd - hc) * fx; gz = (hc - ha) / c; gx = (hd - hc) / c; }
    const L = Math.hypot(gx, 1, gz);
    o.nx = -gx / L; o.ny = 1 / L; o.nz = -gz / L;
    return true;
  }
}

function boxContact(x0, y0, z0, x1, y1, z1, x, y, z, r, o) {
  const px = x < x0 ? x0 : x > x1 ? x1 : x;
  const py = y < y0 ? y0 : y > y1 ? y1 : y;
  const pz = z < z0 ? z0 : z > z1 ? z1 : z;
  const dx = x - px, dy = y - py, dz = z - pz, d2 = dx * dx + dy * dy + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2);
    o.nx = dx / d; o.ny = dy / d; o.nz = dz / d; o.depth = r - d;
    return true;
  }
  // centre inside the box: push out through the nearest face (prefer up on ties)
  let m = y1 - y; o.nx = 0; o.ny = 1; o.nz = 0;
  if (x - x0 < m) { m = x - x0; o.nx = -1; o.ny = 0; o.nz = 0; }
  if (x1 - x < m) { m = x1 - x; o.nx = 1; o.ny = 0; o.nz = 0; }
  if (z - z0 < m) { m = z - z0; o.nx = 0; o.ny = 0; o.nz = -1; }
  if (z1 - z < m) { m = z1 - z; o.nx = 0; o.ny = 0; o.nz = 1; }
  if (y - y0 < m) { m = y - y0; o.nx = 0; o.ny = -1; o.nz = 0; }
  o.depth = m + r;
  return true;
}

export function sphereVsCollider(c, x, y, z, r, o) {
  switch (c.kind) {
    case 'box': return boxContact(c.minX, c.minY, c.minZ, c.maxX, c.maxY, c.maxZ, x, y, z, r, o);
    case 'obb': {
      const dx = x - c.x, dz = z - c.z, cs = c._c, sn = c._s;
      const lx = cs * dx - sn * dz, lz = sn * dx + cs * dz;
      if (!boxContact(-c.hx, c.y - c.hy, -c.hz, c.hx, c.y + c.hy, c.hz, lx, y, lz, r, o)) return false;
      const nx = o.nx, nz = o.nz;
      o.nx = cs * nx + sn * nz; o.nz = -sn * nx + cs * nz;
      return true;
    }
    case 'sphere': {
      const dx = x - c.x, dy = y - c.y, dz = z - c.z, d2 = dx * dx + dy * dy + dz * dz, R = r + c.r;
      if (d2 >= R * R) return false;
      const d = Math.sqrt(d2) || 1e-6;
      o.nx = dx / d; o.ny = d2 > 1e-10 ? dy / d : 1; o.nz = dz / d; o.depth = R - d;
      return true;
    }
    case 'cyl': {
      const dx = x - c.x, dz = z - c.z, q = Math.hypot(dx, dz);
      const py = y < c.y0 ? c.y0 : y > c.y1 ? c.y1 : y;
      const inY = y >= c.y0 && y <= c.y1;
      if (q <= c.r && inY) { // inside
        const side = c.r - q, top = c.y1 - y, bot = y - c.y0;
        if (top <= side && top <= bot) { o.nx = 0; o.ny = 1; o.nz = 0; o.depth = top + r; }
        else if (bot <= side) { o.nx = 0; o.ny = -1; o.nz = 0; o.depth = bot + r; }
        else { const k = q > 1e-6 ? 1 / q : 0; o.nx = dx * k || 1; o.ny = 0; o.nz = dz * k; o.depth = side + r; }
        return true;
      }
      let px, pz;
      if (q > c.r) { px = c.x + dx / q * c.r; pz = c.z + dz / q * c.r; } else { px = x; pz = z; }
      const ex = x - px, ey = y - py, ez = z - pz, d2 = ex * ex + ey * ey + ez * ez;
      if (d2 >= r * r) return false;
      const d = Math.sqrt(d2) || 1e-6;
      o.nx = ex / d; o.ny = ey / d; o.nz = ez / d; o.depth = r - d;
      return true;
    }
  }
  return false;
}

export function computeBounds(c) {
  switch (c.kind) {
    case 'box': c.bMinX = c.minX; c.bMaxX = c.maxX; c.bMinY = c.minY; c.bMaxY = c.maxY; c.bMinZ = c.minZ; c.bMaxZ = c.maxZ; break;
    case 'obb': {
      c._c = Math.cos(c.yaw || 0); c._s = Math.sin(c.yaw || 0);
      const ex = Math.abs(c._c) * c.hx + Math.abs(c._s) * c.hz, ez = Math.abs(c._s) * c.hx + Math.abs(c._c) * c.hz;
      c.bMinX = c.x - ex; c.bMaxX = c.x + ex; c.bMinZ = c.z - ez; c.bMaxZ = c.z + ez; c.bMinY = c.y - c.hy; c.bMaxY = c.y + c.hy; break;
    }
    case 'sphere': c.bMinX = c.x - c.r; c.bMaxX = c.x + c.r; c.bMinY = c.y - c.r; c.bMaxY = c.y + c.r; c.bMinZ = c.z - c.r; c.bMaxZ = c.z + c.r; break;
    case 'cyl': c.bMinX = c.x - c.r; c.bMaxX = c.x + c.r; c.bMinZ = c.z - c.r; c.bMaxZ = c.z + c.r; c.bMinY = c.y0; c.bMaxY = c.y1; break;
  }
  return c;
}

const tmp = { nx: 0, ny: 0, nz: 0, depth: 0 };
const hs = { h: 0, nx: 0, ny: 1, nz: 0 };

export class CollisionWorld {
  constructor(cell = 8) {
    this.cell = cell; this.grid = new Map(); this.dynamic = []; this.hf = null; this.stamp = 1; this.count = 0;
    this._q = [];
  }
  _key(ix, iz) { return (ix + 512) * 4096 + (iz + 512); }
  add(c) {
    if (c.solid === undefined) c.solid = true;
    if (c.camera === undefined) c.camera = true;
    computeBounds(c); c._stamp = 0;
    const s = this.cell;
    for (let ix = Math.floor(c.bMinX / s); ix <= Math.floor(c.bMaxX / s); ix++)
      for (let iz = Math.floor(c.bMinZ / s); iz <= Math.floor(c.bMaxZ / s); iz++) {
        const k = this._key(ix, iz);
        let a = this.grid.get(k); if (!a) this.grid.set(k, a = []);
        a.push(c);
      }
    this.count++;
    return c;
  }
  addDynamic(c) {
    if (c.solid === undefined) c.solid = true;
    if (c.camera === undefined) c.camera = false;
    computeBounds(c); c._stamp = 0; c.dx = c.dx || 0; c.dy = c.dy || 0; c.dz = c.dz || 0;
    this.dynamic.push(c); return c;
  }
  remove(c) {
    c.solid = false; c.camera = false; // cheap removal: stays in grid but never collides
    const i = this.dynamic.indexOf(c); if (i >= 0) this.dynamic.splice(i, 1);
  }
  query(minX, minZ, maxX, maxZ) {
    const out = this._q; out.length = 0; const st = ++this.stamp, s = this.cell;
    for (let ix = Math.floor(minX / s); ix <= Math.floor(maxX / s); ix++)
      for (let iz = Math.floor(minZ / s); iz <= Math.floor(maxZ / s); iz++) {
        const a = this.grid.get(this._key(ix, iz)); if (!a) continue;
        for (const c of a) if (c._stamp !== st) { c._stamp = st; out.push(c); }
      }
    for (const c of this.dynamic) out.push(c);
    return out;
  }
  // All contacts for a sphere.  Pushes {nx,ny,nz,depth,col} objects (col null = terrain) into out.
  sphereContacts(x, y, z, r, out, filter = 'solid') {
    out.length = 0;
    const list = this.query(x - r, z - r, x + r, z + r);
    for (const c of list) {
      if (!c[filter]) continue;
      if (x + r < c.bMinX || x - r > c.bMaxX || z + r < c.bMinZ || z - r > c.bMaxZ || y + r < c.bMinY || y - r > c.bMaxY) continue;
      if (sphereVsCollider(c, x, y, z, r, tmp)) out.push({ nx: tmp.nx, ny: tmp.ny, nz: tmp.nz, depth: tmp.depth, col: c });
    }
    const t = this.terrainContact(x, y, z, r);
    if (t) out.push(t);
    return out;
  }
  terrainContact(x, y, z, r) {
    const hf = this.hf; if (!hf) return null;
    let best = null;
    const test = (sx, sz) => {
      if (!hf.sample(sx, sz, hs)) return;
      if (y < hs.h - 2.5) return; // far below the surface (under a cliff) -> ignore
      const dist = (y - hs.h) * hs.ny;
      if (dist < r && (!best || r - dist > best.depth)) best = { nx: hs.nx, ny: hs.ny, nz: hs.nz, depth: r - dist, col: null };
    };
    test(x, z);
    if (!best) { const k = r * 0.7; test(x + k, z); test(x - k, z); test(x, z + k); test(x, z - k); if (best) { best.nx = 0; best.ny = 1; best.nz = 0; } }
    return best;
  }
  // Highest walkable top at (x,z) at or below maxY (used for placing props). -Infinity if none.
  groundHeight(x, z, maxY = 1e9) {
    let best = -Infinity;
    if (this.hf && this.hf.sample(x, z, hs) && hs.h <= maxY + 0.01) best = hs.h;
    for (const c of this.query(x, z, x, z)) {
      if (!c.solid) continue;
      let top = -Infinity;
      if (c.kind === 'box') { if (x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ) top = c.maxY; }
      else if (c.kind === 'obb') {
        const dx = x - c.x, dz = z - c.z, lx = c._c * dx - c._s * dz, lz = c._s * dx + c._c * dz;
        if (Math.abs(lx) <= c.hx && Math.abs(lz) <= c.hz) top = c.y + c.hy;
      } else if (c.kind === 'cyl') { if (Math.hypot(x - c.x, z - c.z) <= c.r) top = c.y1; }
      else if (c.kind === 'sphere') { const d = Math.hypot(x - c.x, z - c.z); if (d < c.r) top = c.y + Math.sqrt(c.r * c.r - d * d); }
      if (top <= maxY + 0.01 && top > best) best = top;
    }
    return best;
  }
  // Fraction 0..1 of the segment a->b a sphere of radius r can travel before touching a camera blocker.
  castSphere(ax, ay, az, bx, by, bz, r) {
    const L = Math.hypot(bx - ax, by - ay, bz - az); if (L < 1e-4) return 1;
    const steps = Math.max(2, Math.ceil(L / 0.25)), arr = [];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
      this.sphereContacts(x, y, z, r, arr, 'camera');
      if (arr.length) return Math.max(0, (i - 1) / steps);
    }
    return 1;
  }
}
