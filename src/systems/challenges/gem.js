/*
 * Gem Rush (Go / No-Go, response inhibition).  20 gems pop up one at a time along a winding path
 * ahead of the start pad: blue diamond = grab it, red spiky gem = leave it.  Each gem stays for
 * popTime (1.6 s at level 1 -> 0.9 s at level 5); decoys are 20 % -> 40 %.
 * Correct = blue touched or red left alone.  Red touched = gentle "oops", blue timed out = miss.
 * Never any loss: the score only counts up.  >= 80 % (16 / 20) earns the course's star.
 * def: { zone, pad:[x,z], path:[[x,z],...], lateral, after }
 */
const N = 20, GAP = 0.35, TOUCH = 1.25, RT_FLOOR = 0.12;
const lerp = (a, b, t) => a + (b - a) * t;

export function createGem(kit, def) {
  const { THREE, scene } = kit;
  const zoneName = { meadow: 'Meadow', cove: 'Cove', towers: 'Towers' }[def.zone];
  // ---- path sampled by arc length (verified against the collision world at build time) ----
  const pts = def.path, seg = [];
  let L = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); L += d; }
  function at(s) {
    let i = 0; while (i < seg.length - 1 && s > seg[i]) { s -= seg[i]; i++; }
    const t = Math.min(1, s / seg[i]), a = pts[i], b = pts[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1], k = 1 / Math.hypot(dx, dz);
    return { x: a[0] + dx * t, z: a[1] + dz * t, nx: -dz * k, nz: dx * k };
  }
  const padY = kit.ground(def.pad[0], def.pad[1]);
  const slots = [];
  for (let i = 0; i < N; i++) {
    const p = at(0.6 + (i / (N - 1)) * (L - 1.2));
    const side = [1, -1, 0][(i * 7 + 1) % 3], lat = def.lateral ?? 1.4;
    let x = p.x + p.nx * lat * side, z = p.z + p.nz * lat * side;
    if (!kit.clear(x, z, padY)) { x = p.x; z = p.z; }   // something solid there: use the path centre
    const alt = { x: p.x - p.nx * lat * (side || 1), z: p.z - p.nz * lat * (side || 1) };
    slots.push({ x, z, y: kit.ground(x, z, padY + 3) + 1.0, alt });
  }

  // ---- meshes: 2 gems (reused) + a shrinking timer ring = 3 draw calls, only while running ----
  const blue = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), kit.toon(0x3aa8ff, { emissive: 0x0d4aa0, emissiveIntensity: 0.7 }, 'gem-blue'));
  blue.scale.set(1, 1.35, 1);
  const red = new THREE.Mesh(new THREE.TetrahedronGeometry(0.7, 0), kit.toon(0xff4050, { emissive: 0x7a0818, emissiveIntensity: 0.6 }, 'gem-red'));
  const ringGeo = new THREE.RingGeometry(0.8, 1.0, 28); ringGeo.rotateX(-Math.PI / 2);
  const ringMat = kit.named(new THREE.MeshBasicMaterial({ color: 0xfff6c8, transparent: true, opacity: 0.85, depthWrite: false }), 'gem-ring');
  const ring = new THREE.Mesh(ringGeo, ringMat);
  for (const m of [blue, red, ring]) { m.visible = false; m.castShadow = m !== ring; scene.add(m); }

  let trials = [], i = 0, phase = 'idle', t = 0, popTime = 1.6, score = 0, cur = null, spin = 0;

  function plan(level) {
    const k = (level - 1) / 4, reds = Math.round(N * lerp(0.2, 0.4, k));
    popTime = lerp(1.6, 0.9, k);
    const arr = Array.from({ length: N }, (_, j) => j < reds);
    for (let tries = 0; tries < 50; tries++) {          // shuffle; first 2 always blue; max 2 reds in a row
      for (let j = N - 1; j > 0; j--) { const r = (Math.random() * (j + 1)) | 0; [arr[j], arr[r]] = [arr[r], arr[j]]; }
      if (!arr[0] && !arr[1] && !arr.some((v, j) => v && arr[j + 1] && arr[j + 2])) break;
    }
    if (arr[0] || arr[1]) { arr.sort((a, b) => a - b); }   // fallback: blues first (still valid)
    return arr.map(r => ({ red: r }));
  }
  function show() {
    const s = slots[i]; cur = { ...s, red: trials[i].red, t: 0 };
    if (cur.red && Math.hypot(kit.pip().x - cur.x, kit.pip().z - cur.z) < 1.9) { cur.x = s.alt.x; cur.z = s.alt.z; cur.y = kit.ground(cur.x, cur.z, padY + 3) + 1.0; } // never spawn a decoy on Pip
    const m = cur.red ? red : blue;
    (cur.red ? blue : red).visible = false;
    m.visible = true; m.position.set(cur.x, cur.y, cur.z); m.scale.setScalar(0.01); // pops in (update grows it)
    ring.visible = true; ring.position.set(cur.x, cur.y - 0.95, cur.z); ring.scale.setScalar(1);
    phase = 'show'; t = 0;
  }
  function resolve(correct, reason) {
    const rt = Math.round(cur.t * 1000);
    if (correct) { score++; kit.hit(i, cur.red ? null : rt, { x: cur.x, y: cur.y, z: cur.z, quiet: cur.red }); }
    else kit.miss(reason, { x: cur.x, y: cur.y, z: cur.z });
    blue.visible = red.visible = ring.visible = false; cur = null;
    i++; phase = 'gap'; t = 0;
    kit.chip(`💎 ${score} / ${N}`);
  }

  return {
    type: 'gem', zone: def.zone, starId: `focus-gem-${def.zone}`, name: `Gem Rush in ${zoneName}`, after: def.after,
    label: ['💎', 'Gem Rush'], rule: { icon: '💎', text: 'Grab blue, skip red', hint: '🔷 yes · 🔺 no' },
    pad: { x: def.pad[0], y: padY, z: def.pad[1] }, leaveR: L + 14, color: 0x3a7bff,
    get running() { return phase !== 'idle'; },
    get showing() { return cur ? { red: cur.red, x: cur.x, y: cur.y, z: cur.z } : null; },
    begin(level) { trials = plan(level); i = 0; score = 0; phase = 'gap'; t = GAP; kit.chip(`💎 0 / ${N}`); },
    update(dt) {
      if (phase === 'idle') return null;
      spin += dt;
      if (phase === 'gap') {
        t += dt;
        if (i >= N) { phase = 'idle'; return { hits: score, total: N, won: score >= Math.ceil(N * 0.8) }; }
        if (t >= GAP) show();
        return null;
      }
      cur.t += dt;
      const m = cur.red ? red : blue, grow = Math.min(1, cur.t / 0.15), left = 1 - cur.t / popTime;
      const s = grow * (left < 0.25 ? 0.6 + 0.4 * (left / 0.25) : 1);
      m.scale.set(s, s * (cur.red ? 1 : 1.35), s); m.rotation.y = spin * 3;
      m.position.y = cur.y + Math.sin(spin * 5) * 0.08;
      ring.scale.setScalar(Math.max(0.05, left));
      const p = kit.pip();
      if (cur.t > RT_FLOOR && Math.hypot(p.x - cur.x, p.z - cur.z) < TOUCH && Math.abs(p.y + 0.65 - cur.y) < 1.6) resolve(!cur.red, 'decoy');
      else if (cur.t >= popTime) resolve(!!cur.red, 'timeout');
      return null;
    },
    respond(correct) { // debug / tests: answer the current gem (spawns it first if we are in a gap)
      if (phase === 'idle') return false;
      if (phase === 'gap') { if (i >= N) return false; show(); }
      cur.t = Math.max(cur.t, 0.4);
      if (correct) resolve(true, null); else resolve(false, cur.red ? 'decoy' : 'timeout');
      return true;
    },
    cancel() { phase = 'idle'; cur = null; blue.visible = red.visible = ring.visible = false; },
    debugSlots: () => slots.map(s => ({ x: +s.x.toFixed(2), y: +s.y.toFixed(2), z: +s.z.toFixed(2) })),
  };
}
