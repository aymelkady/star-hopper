/*
 * Two Things (dual task, divided attention) on the Splash Cove log ride.  A lantern on a tall post
 * in the water switches yellow <-> green.  While riding, jump (tap) only while it is GREEN.
 * 10 green phases per run; a green tapped = hit, a green missed = miss, a tap on yellow = "oops".
 * Score = greens tapped - yellow taps (never below 0); >= 8 / 10 earns the star.
 * Level 1..5: green lasts 1.8 s -> 1.0 s, yellow waits 1.5-3 s (spec) either way.
 * def: { pad:[x,z], padMaxY, lantern:[x,z], after }
 */
const GREENS = 10;
const lerp = (a, b, t) => a + (b - a) * t;
const C = { off: [0x8a6a3e, 0x000000], green: [0x3fdc6a, 0x1a9a3a], yellow: [0xffd23a, 0x9a7000] };

export function createTwo(kit, def) {
  const { THREE, scene, events, P, PAL } = kit;
  const padY = kit.ground(def.pad[0], def.pad[1], def.padMaxY ?? 5);
  // ---- lantern post standing in the sea next to the ride (no collider: it is off the route) ----
  const [lx, lz] = def.lantern, base = -4.5, HEAD = 6.8; // head at y = 2.3: eye level from the logs
  const post = P.vcMesh(b => {
    b.cyl(0, 0, 0, 0.32, HEAD - 0.85, PAL.woodLo, { collide: false, seg: 7 });
    b.cyl(0, 3.9, 0, 0.6, 0.35, PAL.wood, { collide: false, seg: 8 });           // float ring at the waterline
    b.box(0, HEAD - 0.85, 0, 1.7, 0.2, 1.7, PAL.lanternFrame, { collide: false });
    b.box(0, HEAD + 0.85, 0, 1.7, 0.2, 1.7, PAL.lanternFrame, { collide: false });
    b.cone(0, HEAD + 0.95, 0, 1.4, 0.8, PAL.roofRed, { seg: 4, yaw: Math.PI / 4 });
    b.sphere(0, HEAD + 1.85, 0, 0.16, PAL.gold, { detail: 0 });
    for (const [dx, dz] of [[-0.72, -0.72], [0.72, -0.72], [-0.72, 0.72], [0.72, 0.72]]) b.cyl(dx, HEAD - 0.8, dz, 0.07, 1.6, PAL.lanternFrame, { collide: false, seg: 4 });
  });
  post.position.set(lx, base, lz); scene.add(post);
  const headMat = kit.named(new THREE.MeshLambertMaterial({ color: C.off[0], emissive: C.off[1] }), 'two-lantern');
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.6, 1.5), headMat);
  head.position.y = HEAD; post.add(head);
  const glowMat = kit.named(new THREE.SpriteMaterial({ map: kit.glowTexture(), color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), 'two-glow');
  const glow = new THREE.Sprite(glowMat); glow.scale.setScalar(6); glow.position.y = HEAD; glow.visible = false; post.add(glow);

  let done = false, phase = 'idle', light = 'off', t = 0, dur = 0, greens = 0, hits = 0, wrong = 0, tapped = false, greenTime = 1.8, unsub = null;
  function setLight(c) {
    light = c; headMat.color.setHex(C[c][0]); headMat.emissive.setHex(C[c][1]);
    glow.visible = c !== 'off'; glowMat.color.setHex(c === 'green' ? 0x7dff9a : 0xffe070);
  }
  const chip = () => kit.chip(`${light === 'green' ? '🟢' : '🟡'} ${Math.max(0, hits - wrong)} / ${GREENS}`); // mirrors the lantern
  function toYellow() { setLight('yellow'); t = 0; dur = 1.5 + Math.random() * 1.5; chip(); }
  function toGreen() { setLight('green'); t = 0; dur = greenTime; tapped = false; chip(); }
  function tap() {
    if (phase !== 'run') return;
    if (light === 'green') { if (tapped) return; tapped = true; hits++; kit.hit(hits - 1, Math.round(t * 1000), at()); }
    else { wrong++; kit.miss('early', at()); }
    chip();
  }
  const at = () => ({ x: lx, y: base + HEAD, z: lz });
  function endGreen() { greens++; if (!tapped) kit.miss('timeout', at()); chip(); }

  return {
    type: 'two', zone: 'cove', starId: 'focus-two-cove', name: 'Two Things on the log ride', after: def.after,
    label: ['🏮', 'Two Things'], rule: { icon: '🏮', text: 'Jump when lantern is green', hint: '🟢 jump · 🟡 wait' },
    pad: { x: def.pad[0], y: padY, z: def.pad[1] }, leaveR: 70, color: 0xff9a3c, padMaxY: def.padMaxY,
    get running() { return phase !== 'idle'; },
    begin(level) {
      greenTime = lerp(1.8, 1.0, (level - 1) / 4);
      greens = hits = wrong = 0; done = false; phase = 'run'; toYellow(); dur = 1.2; chip();
      unsub = events.on('player:jump', tap);
    },
    update(dt) {
      if (phase !== 'run') return null;
      if (done) return this.finish();
      t += dt;
      if (light === 'green') {
        glow.scale.setScalar(6 + Math.sin(t * 12) * 0.5);
        if (t >= dur) { endGreen(); if (greens >= GREENS) return this.finish(); toYellow(); }
      } else if (t >= dur) toGreen();
      return null;
    },
    finish() {
      phase = 'idle'; setLight('off'); if (unsub) unsub(); unsub = null;
      const score = Math.max(0, hits - wrong);
      return { hits: score, total: GREENS, won: score >= 8 };
    },
    tap,
    respond(correct) { // debug / tests: one correct tap on a green, or one miss
      if (phase !== 'run') return false;
      if (correct) { if (light !== 'green') toGreen(); tap(); endGreen(); }
      else if (light === 'green') endGreen(); else tap();
      if (greens >= GREENS) done = true; else if (light === 'green') toYellow();
      return true;
    },
    get light() { return light; },
    cancel() { phase = 'idle'; setLight('off'); if (unsub) unsub(); unsub = null; },
  };
}
