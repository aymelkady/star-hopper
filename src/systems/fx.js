/*
 * Immediate visual feedback (DESIGN.md R4).  Everything is preallocated and GPU-cheap:
 *   - ONE THREE.Points (600 slots: 570 event particles + 30 ambient pollen motes), additive,
 *     vertex colours, per-particle size with distance attenuation, gravity + drag   -> 1 draw call
 *   - ONE InstancedMesh of 220 confetti boxes (tumbling, fluttering)                -> 1 draw call
 *   - ONE ground shockwave ring mesh (ground pound / bounce)                        -> 1 draw call
 *   - a few DOM nodes of our own (floating "+1" labels, white star flash, red hurt vignette),
 *     styled by an injected <style> tag
 * Squash & stretch is applied to pip.root.scale (pip.js animates body.scale, so the two multiply).
 * Camera shake wraps renderer.render: the offset is added just for the draw and removed after,
 * so the camera rig never sees it.
 * Respects state.settings.reduceMotion (fewer particles, no shake / slow-mo / flash / squash
 * overshoot) and focus:changed {on} (ambient pollen + coin glints off, event particles kept).
 *
 * window.__game.fx = { burst, count(), setReduceMotion, stats(), confetti(opts), rain(sec) }
 */
export const NAME = 'fx';

const CAP = 600, AMBIENT = 30, EVENT_CAP = CAP - AMBIENT;
const CONFETTI_CAP = 220, LABEL_CAP = 6;
const CONFETTI_COLORS = [0xff5a7a, 0xffd84a, 0x4fd1ff, 0x7dff8a, 0xb88cff, 0xff9a3c];

export function init(ctx) {
  const { THREE, scene, camera, renderer, events, state, ctrl, pip, game } = ctx;
  const S = () => state.settings || {};
  let reduceMotion = !!S().reduceMotion, rmOverride = null;
  let focusOn = false;
  const rm = () => (rmOverride !== null ? rmOverride : reduceMotion);
  const stats = { bursts: 0, spawned: 0, shakes: 0, lastShake: 0, slowmos: 0, flashes: 0, vignettes: 0, labels: 0, rings: 0, stretchPeak: 0, confettiSpawned: 0 };

  // =============================================================================================
  // Particles: struct-of-arrays, no per-frame allocation
  const pos = new Float32Array(CAP * 3), col = new Float32Array(CAP * 3);
  const size = new Float32Array(CAP), alpha = new Float32Array(CAP);
  const vel = new Float32Array(CAP * 3), life = new Float32Array(CAP), maxLife = new Float32Array(CAP);
  const baseSize = new Float32Array(CAP), grav = new Float32Array(CAP), drag = new Float32Array(CAP);
  let cursor = 0, live = 0;

  const geo = new THREE.BufferGeometry();
  const aPos = new THREE.BufferAttribute(pos, 3), aCol = new THREE.BufferAttribute(col, 3);
  const aSize = new THREE.BufferAttribute(size, 1), aAlpha = new THREE.BufferAttribute(alpha, 1);
  for (const a of [aPos, aCol, aSize, aAlpha]) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', aPos); geo.setAttribute('aColor', aCol);
  geo.setAttribute('aSize', aSize); geo.setAttribute('aAlpha', aAlpha);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 600 } },
    vertexShader: `
      attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
      uniform float uScale; varying vec3 vC; varying float vA;
      void main() {
        vC = aColor; vA = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aAlpha > 0.0 ? clamp(aSize * uScale / max(0.2, -mv.z), 1.0, 72.0) : 0.0;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vC; varying float vA;
      void main() {
        vec2 d = gl_PointCoord - 0.5; float r = length(d);
        if (r > 0.5) discard;
        float core = smoothstep(0.5, 0.0, r);
        gl_FragColor = vec4(vC * (0.6 + core * 0.5), min(1.0, core * 1.4) * vA);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; points.renderOrder = 5; points.name = 'fx-particles';
  scene.add(points);

  function setColor(i, hex) {
    col[i * 3] = ((hex >> 16) & 255) / 255; col[i * 3 + 1] = ((hex >> 8) & 255) / 255; col[i * 3 + 2] = (hex & 255) / 255;
  }
  function slot() {
    for (let n = 0; n < EVENT_CAP; n++) {
      const i = cursor; cursor = (cursor + 1) % EVENT_CAP;
      if (life[i] <= 0) return i;
    }
    const i = cursor; cursor = (cursor + 1) % EVENT_CAP; return i; // full: recycle the oldest-ish
  }
  // burst({x,y,z, count, color (hex or [hex]), speed, spread (0 = straight up .. 1 = sphere),
  //        life, gravity, size, drag, up, shape: 'sphere'|'ring'|'column'})
  function burst(o = {}) {
    let count = Math.max(0, o.count ?? 12) | 0;
    if (rm()) count = Math.ceil(count * 0.4);
    const x = o.x || 0, y = o.y || 0, z = o.z || 0;
    const speed = o.speed ?? 4, spread = o.spread ?? 1, L = o.life ?? 0.7, g = o.gravity ?? -9;
    const sz = o.size ?? 0.18, dr = o.drag ?? 1.5, up = o.up ?? 0, shape = o.shape || 'sphere';
    const colors = o.color ?? 0xffffff, multi = Array.isArray(colors);
    for (let k = 0; k < count; k++) {
      const i = slot(), j = i * 3;
      let vx, vy, vz;
      if (shape === 'ring') {
        const a = (k / count) * Math.PI * 2 + Math.random() * 0.2;
        vx = Math.cos(a) * speed; vz = Math.sin(a) * speed; vy = up + Math.random() * 0.4;
        pos[j] = x + Math.cos(a) * 0.2; pos[j + 1] = y; pos[j + 2] = z + Math.sin(a) * 0.2;
      } else if (shape === 'column') {
        const a = Math.random() * Math.PI * 2, r = Math.random() * (o.radius ?? 0.5);
        pos[j] = x + Math.cos(a) * r; pos[j + 1] = y + Math.random() * (o.height ?? 0.4); pos[j + 2] = z + Math.sin(a) * r;
        vx = Math.cos(a) * 0.3; vz = Math.sin(a) * 0.3; vy = speed * (0.5 + Math.random() * 0.8);
      } else {
        // random direction in a cone around +Y (spread 1 = full sphere)
        const cy = 1 - Math.random() * 2 * spread, s = Math.sqrt(Math.max(0, 1 - cy * cy)), a = Math.random() * Math.PI * 2;
        const m = speed * (0.45 + Math.random() * 0.55);
        vx = Math.cos(a) * s * m; vz = Math.sin(a) * s * m; vy = cy * m + up;
        pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;
      }
      vel[j] = vx; vel[j + 1] = vy; vel[j + 2] = vz;
      const l = L * (0.7 + Math.random() * 0.6);
      life[i] = maxLife[i] = l;
      baseSize[i] = sz * (0.7 + Math.random() * 0.6); size[i] = baseSize[i]; alpha[i] = 1;
      grav[i] = g; drag[i] = dr;
      setColor(i, multi ? colors[(Math.random() * colors.length) | 0] : colors);
    }
    stats.bursts++; stats.spawned += count;
    aCol.needsUpdate = true;
    return count;
  }

  // ---------- ambient pollen (reserved slots EVENT_CAP..CAP-1) ----------
  let ambientOn = false;
  function ambientWanted() { return !focusOn && !rm() && game.mode === 'playing'; }
  function respawnMote(i, fresh) {
    const p = ctrl.position, j = i * 3, a = Math.random() * Math.PI * 2, r = 1.5 + Math.random() * 7;
    pos[j] = p.x + Math.cos(a) * r; pos[j + 1] = p.y + 0.4 + Math.random() * 2.8; pos[j + 2] = p.z + Math.sin(a) * r;
    vel[j] = (Math.random() - 0.5) * 0.4; vel[j + 1] = (Math.random() - 0.3) * 0.15; vel[j + 2] = (Math.random() - 0.5) * 0.4;
    maxLife[i] = 4 + Math.random() * 4; life[i] = fresh ? maxLife[i] * Math.random() : maxLife[i];
    baseSize[i] = 0.05 + Math.random() * 0.05;
    setColor(i, Math.random() < 0.6 ? 0xfff3b0 : 0xd8ffd0);
    aCol.needsUpdate = true;
  }
  function updateAmbient(dt, t) {
    const want = ambientWanted();
    if (want !== ambientOn) {
      ambientOn = want;
      for (let i = EVENT_CAP; i < CAP; i++) { if (want) respawnMote(i, true); else { alpha[i] = 0; life[i] = 0; } }
    }
    if (!ambientOn) return;
    const p = ctrl.position;
    for (let i = EVENT_CAP; i < CAP; i++) {
      const j = i * 3;
      life[i] -= dt;
      const dx = pos[j] - p.x, dz = pos[j + 2] - p.z;
      if (life[i] <= 0 || dx * dx + dz * dz > 110) { respawnMote(i, false); continue; }
      pos[j] += (vel[j] + Math.sin(t * 0.9 + i) * 0.12) * dt;
      pos[j + 1] += (vel[j + 1] + Math.sin(t * 1.3 + i * 1.7) * 0.08) * dt;
      pos[j + 2] += (vel[j + 2] + Math.cos(t * 0.8 + i) * 0.12) * dt;
      const u = life[i] / maxLife[i];
      alpha[i] = Math.min(1, Math.min(u, 1 - u) * 4) * 0.7;
      size[i] = baseSize[i];
    }
  }

  function updateParticles(dt) {
    let n = 0;
    for (let i = 0; i < EVENT_CAP; i++) {
      if (life[i] <= 0) { if (alpha[i] !== 0) alpha[i] = 0; continue; }
      life[i] -= dt;
      if (life[i] <= 0) { alpha[i] = 0; continue; }
      n++;
      const j = i * 3, k = Math.max(0, 1 - drag[i] * dt);
      vel[j] *= k; vel[j + 1] = vel[j + 1] * k + grav[i] * dt; vel[j + 2] *= k;
      pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
      const u = life[i] / maxLife[i];           // 1 -> 0
      alpha[i] = u < 0.35 ? u / 0.35 : 1;
      size[i] = baseSize[i] * (0.6 + 0.4 * u);
    }
    live = n;
  }

  // =============================================================================================
  // Confetti (InstancedMesh of thin boxes)
  const cGeo = new THREE.BoxGeometry(0.2, 0.025, 0.13);
  const cMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x333333 });
  const confetti = new THREE.InstancedMesh(cGeo, cMat, CONFETTI_CAP);
  confetti.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  confetti.frustumCulled = false; confetti.castShadow = false; confetti.receiveShadow = false; confetti.name = 'fx-confetti';
  const cPos = new Float32Array(CONFETTI_CAP * 3), cVel = new Float32Array(CONFETTI_CAP * 3);
  const cRot = new Float32Array(CONFETTI_CAP * 3), cSpin = new Float32Array(CONFETTI_CAP * 3);
  const cLife = new Float32Array(CONFETTI_CAP), cMax = new Float32Array(CONFETTI_CAP);
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
  _s.setScalar(0);
  for (let i = 0; i < CONFETTI_CAP; i++) { _m.makeScale(0, 0, 0); confetti.setMatrixAt(i, _m); confetti.setColorAt(i, _c.setHex(CONFETTI_COLORS[i % CONFETTI_COLORS.length])); }
  confetti.instanceColor.needsUpdate = true;
  confetti.visible = false;
  scene.add(confetti);
  let cCursor = 0, cLive = 0;

  // confetti({x,y,z, count, speed, up, spread, life, area}) - area>0 spawns in a horizontal box (rain)
  function spawnConfetti(o = {}) {
    let count = Math.max(0, o.count ?? 30) | 0;
    if (rm()) count = Math.ceil(count * 0.5);
    const speed = o.speed ?? 5, up = o.up ?? 4, L = o.life ?? 2.4, area = o.area || 0;
    for (let k = 0; k < count; k++) {
      let i = -1;
      for (let n = 0; n < CONFETTI_CAP; n++) { const c = (cCursor + n) % CONFETTI_CAP; if (cLife[c] <= 0) { i = c; break; } }
      if (i < 0) i = cCursor;
      cCursor = (i + 1) % CONFETTI_CAP;
      const j = i * 3, a = Math.random() * Math.PI * 2, r = Math.random();
      cPos[j] = (o.x || 0) + (area ? (Math.random() - 0.5) * area : 0);
      cPos[j + 1] = (o.y || 0) + (area ? Math.random() * 1.5 : 0);
      cPos[j + 2] = (o.z || 0) + (area ? (Math.random() - 0.5) * area : 0);
      cVel[j] = Math.cos(a) * speed * r; cVel[j + 1] = up * (0.6 + Math.random() * 0.6); cVel[j + 2] = Math.sin(a) * speed * r;
      for (let q = 0; q < 3; q++) { cRot[j + q] = Math.random() * 6.28; cSpin[j + q] = (Math.random() - 0.5) * 14; }
      cLife[i] = cMax[i] = L * (0.75 + Math.random() * 0.5);
      confetti.setColorAt(i, _c.setHex(CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0]));
    }
    confetti.instanceColor.needsUpdate = true;
    confetti.visible = true; stats.confettiSpawned += count;
    return count;
  }
  function updateConfetti(dt, t) {
    if (!confetti.visible) return;
    let n = 0;
    for (let i = 0; i < CONFETTI_CAP; i++) {
      if (cLife[i] <= 0) continue;
      cLife[i] -= dt;
      if (cLife[i] <= 0) { _m.makeScale(0, 0, 0); confetti.setMatrixAt(i, _m); continue; }
      n++;
      const j = i * 3, k = Math.max(0, 1 - 2.2 * dt);
      cVel[j] = cVel[j] * k + Math.sin(t * 5 + i) * 1.5 * dt;
      cVel[j + 2] = cVel[j + 2] * k + Math.cos(t * 4.3 + i) * 1.5 * dt;
      cVel[j + 1] = Math.max(-2.2, cVel[j + 1] * Math.max(0, 1 - 1.2 * dt) - 7 * dt); // flutter: low terminal speed
      cPos[j] += cVel[j] * dt; cPos[j + 1] += cVel[j + 1] * dt; cPos[j + 2] += cVel[j + 2] * dt;
      cRot[j] += cSpin[j] * dt; cRot[j + 1] += cSpin[j + 1] * dt; cRot[j + 2] += cSpin[j + 2] * dt;
      const sc = Math.min(1, cLife[i] / 0.4);
      _e.set(cRot[j], cRot[j + 1], cRot[j + 2]); _q.setFromEuler(_e);
      _v.set(cPos[j], cPos[j + 1], cPos[j + 2]); _s.setScalar(sc);
      _m.compose(_v, _q, _s); confetti.setMatrixAt(i, _m);
    }
    confetti.instanceMatrix.needsUpdate = true;
    cLive = n;
    if (!n) confetti.visible = false;
  }

  // =============================================================================================
  // Ground shockwave ring
  const ringGeo = new THREE.RingGeometry(0.7, 1, 48); ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xfff4c8, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.visible = false; ring.renderOrder = 4; ring.frustumCulled = false; ring.name = 'fx-ring';
  scene.add(ring);
  const ringS = { t: 0, dur: 0.4, r0: 0.3, r1: 3, op: 0.85 };
  function shockwave(x, y, z, radius = 2, color = 0xfff4c8, dur = 0.5) {
    ring.position.set(x, y + 0.06, z); ringMat.color.setHex(color);
    ringS.t = dur; ringS.dur = dur; ringS.r0 = 0.3; ringS.r1 = radius * 1.6; ringS.op = 0.85;
    ring.visible = true; stats.rings++;
  }
  function updateRing(dt) {
    if (!ring.visible) return;
    ringS.t -= dt;
    if (ringS.t <= 0) { ring.visible = false; return; }
    const u = 1 - ringS.t / ringS.dur, e = 1 - (1 - u) * (1 - u) * (1 - u);
    ring.scale.setScalar(ringS.r0 + (ringS.r1 - ringS.r0) * e);
    ringMat.opacity = ringS.op * (1 - u);
  }

  // =============================================================================================
  // DOM: injected CSS + our own nodes (labels, flash, vignette)
  const css = document.createElement('style');
  css.id = 'fx-style';
  css.textContent = `
    #fx-layer { position: fixed; inset: 0; pointer-events: none; z-index: 13; overflow: hidden; contain: strict; }
    .fx-label { position: absolute; left: 0; top: 0; font: 800 26px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
      color: #ffe45a; text-shadow: 0 2px 0 #6a4a00, 0 0 6px rgba(0,0,0,.35); will-change: transform, opacity; opacity: 0; white-space: nowrap; }
    .fx-label.red { color: #ff6b7a; text-shadow: 0 2px 0 #6a0010, 0 0 6px rgba(0,0,0,.35); }
    #fx-flash { position: fixed; inset: 0; pointer-events: none; z-index: 14; opacity: 0;
      background: radial-gradient(circle at 50% 50%, rgba(255,255,255,1) 0%, rgba(255,255,240,.8) 35%, rgba(255,255,255,0) 75%); }
    #fx-flash.on { animation: fx-flash .4s ease-out forwards; }
    @keyframes fx-flash { 0% { opacity: .3; } 100% { opacity: 0; } }
    #fx-vignette { position: fixed; inset: 0; pointer-events: none; z-index: 14; opacity: 0;
      background: radial-gradient(ellipse at 50% 50%, rgba(255,70,70,0) 55%, rgba(255,60,60,.55) 100%); }
    #fx-vignette.on { animation: fx-vig .3s ease-out forwards; }
    @keyframes fx-vig { 0% { opacity: .75; } 100% { opacity: 0; } }
  `;
  document.head.appendChild(css);
  const layer = document.createElement('div'); layer.id = 'fx-layer'; layer.setAttribute('aria-hidden', 'true');
  const flash = document.createElement('div'); flash.id = 'fx-flash'; flash.setAttribute('aria-hidden', 'true');
  const vignette = document.createElement('div'); vignette.id = 'fx-vignette'; vignette.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer); document.body.appendChild(flash); document.body.appendChild(vignette);
  const retrigger = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

  const labels = [];
  for (let i = 0; i < LABEL_CAP; i++) {
    const el = document.createElement('div'); el.className = 'fx-label'; layer.appendChild(el);
    labels.push({ el, t: 0, x: 0, y: 0, z: 0, shown: false });
  }
  let labelCursor = 0;
  function floatLabel(text, x, y, z, red) {
    let L = labels.find(l => l.t <= 0);
    if (!L) { L = labels[labelCursor]; labelCursor = (labelCursor + 1) % LABEL_CAP; }
    L.t = 0.8; L.x = x; L.y = y + 0.6; L.z = z;
    L.el.textContent = text; L.el.classList.toggle('red', !!red);
    stats.labels++;
  }
  const _p = new THREE.Vector3();
  function updateLabels(dt) {
    const w = window.innerWidth, h = window.innerHeight;
    for (const L of labels) {
      if (L.t <= 0) { if (L.shown) { L.el.style.opacity = '0'; L.shown = false; } continue; }
      L.t -= dt;
      const u = 1 - Math.max(0, L.t) / 0.8;
      _p.set(L.x, L.y + u * 1.4, L.z).project(camera);
      if (_p.z > 1 || L.t <= 0) { L.el.style.opacity = '0'; L.shown = false; continue; }
      const sx = (_p.x * 0.5 + 0.5) * w, sy = (-_p.y * 0.5 + 0.5) * h;
      L.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -50%) scale(${(1 + (u < 0.15 ? (0.15 - u) * 3 : 0)).toFixed(2)})`;
      L.el.style.opacity = (u > 0.6 ? (1 - u) / 0.4 : 1).toFixed(2);
      L.shown = true;
    }
  }

  // =============================================================================================
  // Camera shake (render wrapper) + slow-mo + squash/stretch + haptics
  const shake = { t: 0, dur: 0.15, amp: 0.08 }, off = new THREE.Vector3();
  function doShake(dur = 0.15, amp = 0.08) {
    if (rm()) return false;
    shake.t = dur; shake.dur = dur; shake.amp = amp; stats.shakes++;
    return true;
  }
  if (renderer && typeof renderer.render === 'function') {
    const orig = renderer.render.bind(renderer);
    renderer.render = (sc, cam) => {
      if (shake.t > 0 && cam === camera) {
        const a = shake.amp * (shake.t / shake.dur);
        off.set((Math.random() * 2 - 1) * a, (Math.random() * 2 - 1) * a, (Math.random() * 2 - 1) * a * 0.5);
        stats.lastShake = off.length();
        camera.position.add(off);
        try { orig(sc, cam); } finally { camera.position.sub(off); }
      } else orig(sc, cam);
    };
  }

  let slowT = 0;
  function slowMo() {
    if (rm()) return false;
    game.timeScale = 0.35; slowT = 0.3; stats.slowmos++;
    return true;
  }

  // squash & stretch on pip.root.scale (pip.js scales the inner body, so effects multiply)
  const sq = { t: 0, dur: 0.2, kind: 'none', amt: 1 };
  function stretch() { stats.stretchPeak = 0; sq.kind = 'stretch'; sq.t = sq.dur = 0.2; sq.amt = 1; applySquash(); }
  function squash(amt = 1) { sq.kind = 'squash'; sq.t = sq.dur = 0.25; sq.amt = amt; applySquash(); }
  function applySquash() {
    if (!pip || !pip.root) return;
    if (sq.t <= 0) { pip.root.scale.set(1, 1, 1); sq.kind = 'none'; return; }
    const u = 1 - sq.t / sq.dur; let y;
    if (sq.kind === 'stretch') { const e = (1 - u) * (1 - u); y = 1 + 0.25 * e; pip.root.scale.set(1 - 0.15 * e, y, 1 - 0.15 * e); stats.stretchPeak = Math.max(stats.stretchPeak, y); return; }
    // squash to 0.7 then spring back with a tiny overshoot (none in reduce-motion)
    const A = 0.3 * sq.amt;
    y = 1 - A * (1 - u) * (1 - u) * Math.cos(u * Math.PI * 1.3);
    if (rm() && y > 1) y = 1;
    const xz = 1 / Math.sqrt(y);
    pip.root.scale.set(xz, y, xz);
  }

  const touchDevice = !!ctx.isTouch || ('ontouchstart' in window);
  function buzz(ms) {
    if (!touchDevice || S().haptics === false) return;
    try { navigator.vibrate?.(ms); } catch (_) { /* ignore */ }
  }

  // =============================================================================================
  // Event hooks
  const P = () => ctrl.position;
  const findPickup = id => (ctx.world && ctx.world.findPickup ? ctx.world.findPickup(id) : null);
  const on = (type, fn) => events.on(type, p => fn(p || {}));
  let lastRedId = null, trailT = 0, trailA = 0, rainT = 0, rainAcc = 0;

  on('pickup:coin', p => {
    if (p.id === lastRedId) return;
    const c = findPickup(p.id) || P();
    burst({ x: c.x, y: c.y, z: c.z, count: 8, color: [0xffe14a, 0xfff3a0, 0xffc020], speed: 4.5, life: 0.45, gravity: -6, size: 0.2, up: 1 });
    floatLabel(`+${Math.max(1, Math.round(p.value) || 1)}`, c.x, c.y, c.z, false); // Freeze! gift +5, burst coins +2
    buzz(10);
  });
  on('pickup:redcoin', p => {
    lastRedId = p.id;
    const c = findPickup(p.id) || P();
    burst({ x: c.x, y: c.y, z: c.z, count: 18, color: [0xff3f4f, 0xff8a95], shape: 'ring', speed: 5, life: 0.5, gravity: 0, drag: 3, size: 0.22 });
    burst({ x: c.x, y: c.y, z: c.z, count: 6, color: 0xffd0d5, speed: 2.5, life: 0.4, gravity: -4, size: 0.16 });
    floatLabel('+2', c.x, c.y, c.z, true);
    buzz(12);
  });
  on('pickup:star', p => {
    const s = findPickup(p.id) || P();
    burst({ x: s.x, y: s.y, z: s.z, count: 60, color: [0xffd84a, 0xfff2a0, 0xffb020, 0xffffff], spread: 0.35, speed: 9, up: 3, life: 1.3, gravity: -11, drag: 0.8, size: 0.28 });
    spawnConfetti({ x: s.x, y: s.y + 0.5, z: s.z, count: 56, speed: 5.5, up: 7, life: 2.6 });
    if (!rm()) { retrigger(flash, 'on'); stats.flashes++; }
    slowMo();
    buzz(30);
  });
  on('star:revealed', p => burst({ x: p.x, y: p.y, z: p.z, count: 30, color: [0xffffff, 0xffe680], speed: 5, life: 0.8, gravity: -2, size: 0.22 }));
  on('checkpoint:reached', p => {
    burst({ x: p.x, y: p.y, z: p.z, count: 34, shape: 'column', radius: 0.6, height: 0.5, color: [0x2fd35a, 0x9dffb0, 0xe0ffe6], speed: 3.5, life: 1.1, gravity: 0.6, drag: 0.6, size: 0.18 });
  });
  on('player:groundpound', p => {
    shockwave(p.x, p.y, p.z, p.radius || 2);
    burst({ x: p.x, y: p.y + 0.1, z: p.z, count: 22, shape: 'ring', color: [0xd8c8a8, 0xbfae90, 0xf0e6d0], speed: 5.5, up: 1.2, life: 0.55, gravity: -3, drag: 3, size: 0.32 });
    doShake(0.15, 0.08);
    squash(1);
    buzz(20);
  });
  on('player:land', p => {
    if ((p.fallSpeed || 0) > 12) burst({ x: p.x, y: p.y + 0.05, z: p.z, count: 10, shape: 'ring', color: [0xe8dcc4, 0xcfc0a0], speed: 2.6, up: 0.6, life: 0.4, gravity: -2, drag: 4, size: 0.26 });
    if (sq.kind !== 'squash' || sq.t <= 0) squash(Math.max(0.35, Math.min(1, (p.fallSpeed || 0) / 22)));
  });
  on('player:jump', p => {
    stretch();
    if (p.tier === 3) { trailT = 0.45; trailA = 0; }
  });
  on('player:longjump', () => stretch());
  on('player:wallkick', p => {
    burst({ x: p.x, y: p.y + 0.7, z: p.z, count: 10, color: [0xffffff, 0xfff0a0], speed: 5, life: 0.3, gravity: -4, size: 0.15 });
    stretch();
  });
  on('player:bounce', p => {
    shockwave(p.x, p.y, p.z, 1, 0xffb0e8, 0.3);
    burst({ x: p.x, y: p.y, z: p.z, count: 10, shape: 'ring', color: [0xff9ad8, 0xffffff], speed: 3.5, life: 0.35, gravity: 0, drag: 3, size: 0.18 });
    stretch();
  });
  on('enemy:popped', p => {
    spawnConfetti({ x: p.x, y: p.y + 0.6, z: p.z, count: 18, speed: 4, up: 5, life: 1.6 });
    burst({ x: p.x, y: p.y + 0.6, z: p.z, count: 14, color: [0xffffff, 0xb88cff, 0xffd84a], speed: 5, life: 0.4, gravity: -6, size: 0.2 });
  });
  on('player:hurt', () => { retrigger(vignette, 'on'); stats.vignettes++; squash(0.6); });
  on('player:respawn', () => {
    const q = P();
    burst({ x: q.x, y: q.y + 0.2, z: q.z, count: 20, shape: 'column', radius: 0.7, height: 1.2, color: [0xbfe8ff, 0xffffff], speed: 1.2, life: 0.8, gravity: 0.5, drag: 1, size: 0.16 });
  });
  on('switch:pressed', () => {
    const q = P();
    burst({ x: q.x, y: q.y + 0.05, z: q.z, count: 12, shape: 'ring', color: [0xd8c8a8, 0xbfae90], speed: 3, up: 0.6, life: 0.45, gravity: -2, drag: 3, size: 0.26 });
  });
  on('lantern:lit', () => { const q = P(); burst({ x: q.x, y: q.y + 1, z: q.z, count: 14, color: [0xffb040, 0xffe080], speed: 2.5, life: 0.8, gravity: 1.5, size: 0.18 }); });
  on('ui:celebrate', p => { if (p.kind === 'star' || p.kind === 'quest') rain(2); else if (p.kind === 'coin100') rain(1); });
  on('focus:changed', p => { focusOn = !!p.on; });
  on('settings:changed', p => { if (!p.key || p.key === 'reduceMotion') reduceMotion = !!S().reduceMotion; });
  on('game:stop', () => { shake.t = 0; if (slowT > 0) { slowT = 0; game.timeScale = 1; } sq.t = 0; applySquash(); });

  function rain(sec = 2) { rainT = Math.max(rainT, sec); rainAcc = 0; return true; }
  const _f = new THREE.Vector3();

  // coin glints: every ~2 s sparkle on the 3 nearest live coins
  let glintT = 1.5;
  const near = [null, null, null], nearD = [0, 0, 0];
  function glint() {
    const coins = ctx.world && ctx.world.props && ctx.world.props.coins; if (!coins) return;
    const p = P();
    near[0] = near[1] = near[2] = null; nearD[0] = nearD[1] = nearD[2] = 400; // within 20 m
    for (const c of coins) {
      if (!c.alive) continue;
      const dx = c.x - p.x, dy = c.y - p.y, dz = c.z - p.z, d = dx * dx + dy * dy + dz * dz;
      if (d >= nearD[2]) continue;
      let k = 2; while (k > 0 && d < nearD[k - 1]) { nearD[k] = nearD[k - 1]; near[k] = near[k - 1]; k--; }
      nearD[k] = d; near[k] = c;
    }
    for (const c of near) if (c) burst({ x: c.x + (Math.random() - 0.5) * 0.4, y: c.y + 0.3, z: c.z, count: 2, color: 0xffffff, speed: 0.6, life: 0.5, gravity: 0, drag: 2, size: 0.22 });
  }

  // =============================================================================================
  // per-frame update (tick is emitted after render with unscaled dt)
  events.on('tick', ({ dt = 0, t = 0 } = {}) => {
    // slow-mo timer runs in real time
    if (slowT > 0) { slowT -= dt; if (slowT <= 0 && Math.abs(game.timeScale - 0.35) < 1e-6) game.timeScale = 1; }
    if (shake.t > 0) shake.t -= dt;
    const paused = game.mode === 'paused';
    const sdt = paused ? 0 : dt * (game.timeScale > 0 ? game.timeScale : 0);
    if (sq.t > 0) { sq.t -= dt; applySquash(); }

    if (trailT > 0 && !paused) {
      trailT -= dt; trailA += dt * 22;
      const q = P();
      for (let k = 0; k < 2; k++) {
        const a = trailA + k * Math.PI;
        burst({ x: q.x + Math.cos(a) * 0.55, y: q.y + 0.7, z: q.z + Math.sin(a) * 0.55, count: 1, color: k ? 0x8ffcff : 0xfff2a0, speed: 0.2, life: 0.45, gravity: 0, drag: 2, size: 0.16 });
      }
    }
    if (rainT > 0 && !paused) {
      rainT -= dt; rainAcc += dt * (rm() ? 20 : 45);
      camera.getWorldDirection(_f);
      const cx = camera.position.x + _f.x * 5, cz = camera.position.z + _f.z * 5, cy = camera.position.y + 4.5;
      while (rainAcc >= 1) { rainAcc -= 1; spawnConfetti({ x: cx, y: cy, z: cz, count: 1, area: 9, speed: 0.5, up: 0, life: 3 }); }
    }
    if (!focusOn && !rm() && game.mode === 'playing') { glintT -= dt; if (glintT <= 0) { glintT = 1.8 + Math.random() * 0.6; glint(); } }

    updateParticles(sdt);
    updateAmbient(sdt, t);
    updateConfetti(sdt, t);
    updateRing(sdt);
    updateLabels(dt);
    aPos.needsUpdate = true; aSize.needsUpdate = true; aAlpha.needsUpdate = true;
    // pixel scale for size attenuation (metres -> pixels)
    const hpx = renderer && renderer.domElement ? renderer.domElement.height : window.innerHeight;
    mat.uniforms.uScale.value = (hpx * 0.5) / Math.tan((camera.fov * Math.PI) / 360);
  });

  const api = {
    burst,
    confetti: spawnConfetti,
    rain,
    shockwave,
    count: () => live + cLive,
    particles: () => live,
    confettiCount: () => cLive,
    setReduceMotion(b) { rmOverride = b === null || b === undefined ? null : !!b; return rm(); },
    get reduceMotion() { return rm(); },
    get focus() { return focusOn; },
    stats: () => ({ ...stats, particles: live, confetti: cLive, ambient: ambientOn ? AMBIENT : 0, shaking: shake.t > 0, slowmo: slowT > 0, timeScale: game.timeScale, pipScale: pip && pip.root ? pip.root.scale.y : 1 }),
    objects: { points, confetti, ring },
  };
  const expose = () => { if (window.__game && window.__game.fx !== api) window.__game.fx = api; };
  Promise.resolve().then(expose);
  events.once('tick', expose);
  return api;
}
