/*
 * Procedural WebAudio for Star Hopper: every sound is synthesized (oscillators, envelopes, noise
 * bursts); there are no audio files.  All melodies are original (pentatonic / major-scale
 * patterns generated per zone) and no sound imitates any Nintendo coin / 1-up / jingle (A9).
 *
 * Graph:  sfxBus ─┐
 *                 ├─> master (masterVolume) -> compressor -> destination
 *  zone tracks -> musicFilter (low-pass) -> musicDuck (focus/pause -6 dB) -> musicBus ─┘
 *
 * The AudioContext is created ONLY inside a user gesture (`input:firstGesture`, plus a one-time
 * pointerdown/keydown/touchend fallback on window).  Before that, `ctx` is null and play() is a
 * no-op.  iOS: resumed on visibilitychange (visible) and on every pointerdown while the context
 * is 'suspended' or 'interrupted'.  Never throws when WebAudio is missing.
 *
 * Plugin object (also window.__game.audio): { ctx, unlocked, play(name, opts), setMusic(zone),
 *   mute(bool), debugList(), names }
 */
export const NAME = 'audio';

const MUSIC_BASE = Math.pow(10, -18 / 20); // -18 dB default music mix
const DUCK = Math.pow(10, -6 / 20);        // -6 dB for focus mode / pause / break
const MAX_VOICES = 40;
const vol01 = v => { const n = Number(v); if (!isFinite(n)) return 1; return Math.max(0, Math.min(1, n > 1 ? n / 100 : n)); };
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const jitter = (amt = 0.05) => 1 + (Math.random() * 2 - 1) * amt;

// ---------------------------------------------------------------------------------------------
// Zone music definitions (original).  Chords are major-scale degrees (0 = I), 4 bars per loop.
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const PENTA = [0, 2, 4, 7, 9];
const ZONES = {
  hub:    { root: 60, bpm: 96,  prog: [0, 5, 3, 4], arp: 'triangle', bass: 'sine',     cutoff: 1900, pattern: [0, 1, 2, 1, 0, 2, 1, 2], mel: 0.22, swing: 0 },
  meadow: { root: 67, bpm: 106, prog: [0, 3, 5, 4], arp: 'square',   bass: 'triangle', cutoff: 1500, pattern: [0, 2, 1, 2, 0, 2, 1, 3], mel: 0.28, swing: 0.04 },
  cove:   { root: 65, bpm: 92,  prog: [0, 2, 3, 0], arp: 'sine',     bass: 'triangle', cutoff: 1700, pattern: [0, 1, 2, 3, 2, 1, 0, 1], mel: 0.2,  swing: 0.08 },
  towers: { root: 62, bpm: 100, prog: [0, 6, 3, 0], arp: 'triangle', bass: 'sine',     cutoff: 2200, pattern: [0, 2, 3, 1, 0, 2, 3, 2], mel: 0.25, swing: 0, mixo: true },
};

export function init(ctx) {
  const { events, state } = ctx;
  const S = () => state.settings || {};
  const log = [];
  const pushLog = name => { log.push(name); if (log.length > 120) log.shift(); };

  let ac = null, unlocked = false, failed = false, muted = false;
  let master, comp, sfxBus, musicBus, musicDuck, musicFilter, noiseBuf = null;
  let voices = 0;
  let zone = null;             // desired music zone (null = no music)
  let tracks = [];             // active music tracks (2 while crossfading)
  let playing = false;         // game in play (music allowed)
  const duck = { focus: false, pause: false, brk: false };

  // ---------- context lifecycle ----------
  function create() {
    if (ac || failed) return ac;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { failed = true; return null; }
      ac = new AC({ latencyHint: 'interactive' });
      comp = ac.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
      master = ac.createGain(); master.connect(comp); comp.connect(ac.destination);
      sfxBus = ac.createGain(); sfxBus.connect(master);
      musicBus = ac.createGain(); musicBus.connect(master);
      musicDuck = ac.createGain(); musicDuck.connect(musicBus);
      musicFilter = ac.createBiquadFilter(); musicFilter.type = 'lowpass'; musicFilter.frequency.value = 1800; musicFilter.Q.value = 0.5;
      musicFilter.connect(musicDuck);
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      applyVolumes(true);
      // iOS unlock: play one silent sample inside the gesture
      const b = ac.createBuffer(1, 1, 22050), s = ac.createBufferSource(); s.buffer = b; s.connect(ac.destination); s.start(0);
    } catch (err) {
      console.warn('[audio] WebAudio unavailable:', err && err.message);
      failed = true; ac = null;
    }
    return ac;
  }
  function resume() {
    if (!ac) return;
    try { if (ac.state === 'suspended' || ac.state === 'interrupted') { const p = ac.resume(); if (p && p.catch) p.catch(() => {}); } } catch (_) { /* ignore */ }
  }
  function unlock() {
    if (!create()) return;
    resume();
    if (!unlocked) { unlocked = true; refreshMusic(); }
  }
  events.on('input:firstGesture', unlock);
  const fallback = () => { unlock(); if (unlocked) for (const t of ['pointerdown', 'keydown', 'touchend']) window.removeEventListener(t, fallback, true); };
  for (const t of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(t, fallback, { capture: true, passive: true });
  window.addEventListener('pointerdown', () => { if (ac) resume(); }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!ac) return;
    try {
      if (document.hidden) { const p = ac.suspend(); if (p && p.catch) p.catch(() => {}); }
      else resume();
    } catch (_) { /* ignore */ }
  });

  // ---------- volumes ----------
  function setParam(p, v, tc = 0.05) { try { p.setTargetAtTime(v, ac.currentTime, tc); } catch (_) { p.value = v; } }
  function musicLevel() { return vol01(S().musicVolume ?? 0.5); }
  function applyVolumes(immediate) {
    if (!ac) return;
    const s = S(), tc = immediate ? 0.001 : 0.05;
    setParam(master.gain, muted ? 0 : vol01(s.masterVolume ?? 0.8), tc);
    setParam(sfxBus.gain, vol01(s.sfxVolume ?? 0.8), tc);
    setParam(musicBus.gain, musicLevel() * MUSIC_BASE, tc);
    setParam(musicDuck.gain, (duck.focus || duck.pause || duck.brk) ? DUCK : 1, immediate ? 0.001 : 0.25);
  }
  events.on('settings:changed', ({ key } = {}) => {
    applyVolumes(false);
    if (!key || key === 'musicVolume') refreshMusic();
  });

  // ---------- synthesis helpers ----------
  function voice(dur) {
    if (voices >= MAX_VOICES) return false;
    voices++; setTimeout(() => { voices--; }, (dur + 0.1) * 1000);
    return true;
  }
  // tone: oscillator with attack/decay envelope, optional glide + vibrato + filter
  function tone(o) {
    const t = ac.currentTime + (o.t || 0), a = o.a ?? 0.005, d = o.d ?? 0.15, v = o.v ?? 0.25;
    if (!voice(a + d + (o.t || 0))) return;
    const osc = ac.createOscillator(), g = ac.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.glide ?? (a + d)));
    if (o.detune) osc.detune.value = o.detune;
    let lfo = null;
    if (o.vib) {
      lfo = ac.createOscillator(); const lg = ac.createGain();
      lfo.frequency.value = o.vib; lg.gain.value = o.vibDepth || o.f * 0.04;
      lfo.connect(lg); lg.connect(osc.frequency); lfo.start(t); lfo.stop(t + a + d + 0.05);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    let out = osc;
    if (o.lp) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; osc.connect(f); out = f; }
    out.connect(g); g.connect(o.dest || sfxBus);
    osc.start(t); osc.stop(t + a + d + 0.05);
  }
  // noise burst through a filter, optional filter sweep
  function noise(o) {
    const t = ac.currentTime + (o.t || 0), a = o.a ?? 0.003, d = o.d ?? 0.1, v = o.v ?? 0.2;
    if (!voice(a + d + (o.t || 0))) return;
    const src = ac.createBufferSource(); src.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = o.ft || 'lowpass'; f.Q.value = o.q ?? 0.8;
    f.frequency.setValueAtTime(o.f || 1000, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + a + d);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    src.connect(f); f.connect(g); g.connect(o.dest || sfxBus);
    src.start(t, Math.random() * 0.5); src.stop(t + a + d + 0.05);
  }
  // soft bell: inharmonic partials with long decay
  function bell(f, t = 0, v = 0.18, d = 0.9) {
    tone({ f, t, a: 0.004, d, v, type: 'sine' });
    tone({ f: f * 2.76, t, a: 0.002, d: d * 0.45, v: v * 0.35, type: 'sine' });
    tone({ f: f * 5.4, t, a: 0.002, d: d * 0.2, v: v * 0.15, type: 'sine' });
  }
  function shimmer(t0, n, v = 0.05, lo = 1800, hi = 4200, span = 0.6) {
    for (let i = 0; i < n; i++) tone({ f: lo + Math.random() * (hi - lo), t: t0 + Math.random() * span, a: 0.003, d: 0.18, v, type: 'sine' });
  }

  // C-major pentatonic ladder (C5 up) for coin streaks; C-major scale for red coins / chimes
  const COIN_LADDER = [72, 74, 76, 79, 81, 84, 86, 88, 91].map(mtof);
  const SCALE8 = [72, 74, 76, 77, 79, 81, 83, 84].map(mtof);
  let coinStreak = 0, lastCoinT = -9;

  const SFX = {
    jump(o = {}) {
      const tier = Math.max(1, Math.min(3, o.tier || 1)), r = jitter();
      const base = [300, 370, 450][tier - 1] * r;
      tone({ f: base, f2: base * 1.8, type: 'triangle', a: 0.004, d: 0.13 + tier * 0.02, v: 0.22, lp: 3000 });
      tone({ f: base * 2, f2: base * 3.4, type: 'sine', a: 0.004, d: 0.1, v: 0.06 });
      if (tier === 3) { tone({ f: base * 3, t: 0.07, type: 'sine', a: 0.003, d: 0.2, v: 0.08 }); shimmer(0.05, 3, 0.03); }
    },
    land(o = {}) {
      const k = Math.min(1, Math.max(0, (o.fallSpeed || 0) / 35)), r = jitter();
      noise({ f: 380 * r, ft: 'lowpass', d: 0.06 + k * 0.06, v: 0.06 + k * 0.22 });
      tone({ f: 130 * r, f2: 60, type: 'sine', a: 0.003, d: 0.08 + k * 0.06, v: 0.08 + k * 0.2 });
    },
    longjump() {
      const r = jitter();
      noise({ f: 500 * r, f2: 2600 * r, ft: 'bandpass', q: 1.2, a: 0.04, d: 0.32, v: 0.22 });
      tone({ f: 260 * r, f2: 420 * r, type: 'triangle', a: 0.01, d: 0.18, v: 0.1 });
    },
    poundstart() {
      const r = jitter();
      tone({ f: 420 * r, f2: 980 * r, type: 'triangle', a: 0.005, d: 0.2, v: 0.14, vib: 28, vibDepth: 90 });
      noise({ f: 1500, f2: 3500, ft: 'bandpass', q: 2, a: 0.02, d: 0.18, v: 0.07 });
    },
    pound() {
      const r = jitter();
      tone({ f: 150 * r, f2: 38, type: 'sine', a: 0.003, d: 0.38, v: 0.5 });
      tone({ f: 90 * r, f2: 45, type: 'triangle', a: 0.003, d: 0.25, v: 0.2 });
      noise({ f: 900, f2: 120, ft: 'lowpass', a: 0.002, d: 0.35, v: 0.35 });
    },
    wallkick() {
      const r = jitter();
      noise({ f: 2400 * r, ft: 'highpass', d: 0.035, v: 0.14 });
      tone({ f: 480 * r, f2: 760 * r, type: 'triangle', a: 0.003, d: 0.1, v: 0.16 });
    },
    bounce() {
      const r = jitter();
      tone({ f: 200 * r, f2: 560 * r, glide: 0.18, type: 'sine', a: 0.004, d: 0.3, v: 0.28, vib: 13, vibDepth: 25 });
      tone({ f: 400 * r, f2: 1100 * r, glide: 0.18, type: 'triangle', a: 0.004, d: 0.18, v: 0.06 });
    },
    coin() {
      const now = performance.now() / 1000;
      coinStreak = now - lastCoinT < 1 ? Math.min(COIN_LADDER.length - 1, coinStreak + 1) : 0;
      lastCoinT = now;
      const f = COIN_LADDER[coinStreak] * jitter(0.02);
      // bright two-note blip: note, then a major third above (sine/triangle, not a square-wave jingle)
      tone({ f, type: 'triangle', a: 0.003, d: 0.07, v: 0.16 });
      tone({ f: f * 1.26, t: 0.045, type: 'triangle', a: 0.003, d: 0.16, v: 0.15 });
      tone({ f: f * 2.52, t: 0.045, type: 'sine', a: 0.002, d: 0.12, v: 0.04 });
    },
    redcoin(o = {}) {
      const i = Math.max(1, Math.min(8, o.index || 1)), f = SCALE8[i - 1];
      tone({ f, type: 'triangle', a: 0.004, d: 0.4, v: 0.18 });
      tone({ f: f * 1.003, type: 'sine', a: 0.004, d: 0.45, v: 0.1, detune: 7 });
      tone({ f: f * 2, type: 'sine', a: 0.003, d: 0.25, v: 0.06 });
      bell(f * 1.5, 0.06, 0.06, 0.5);
    },
    star() {
      // original rising wide arpeggio (G4 - D5 - B5), last note held + sparkle shimmer
      const n = [67, 74, 83].map(mtof);
      n.forEach((f, i) => {
        const last = i === n.length - 1;
        tone({ f, t: i * 0.11, type: 'triangle', a: 0.005, d: last ? 0.9 : 0.22, v: 0.2 });
        tone({ f: f * 2, t: i * 0.11, type: 'sine', a: 0.005, d: last ? 0.7 : 0.16, v: 0.06 });
      });
      tone({ f: mtof(55), t: 0.22, type: 'sine', a: 0.02, d: 0.9, v: 0.14 });
      shimmer(0.25, 10, 0.04, 2000, 4500, 0.8);
    },
    quest() {
      const n = [60, 64, 67, 72, 76].map(mtof);
      n.forEach((f, i) => tone({ f, t: i * 0.09, type: 'triangle', a: 0.005, d: 0.2, v: 0.17 }));
      for (const m of [60, 64, 67, 72]) tone({ f: mtof(m), t: 0.5, type: 'triangle', a: 0.02, d: 1.2, v: 0.09 });
      tone({ f: mtof(48), t: 0.5, type: 'sine', a: 0.02, d: 1.2, v: 0.16 });
      shimmer(0.5, 16, 0.035, 2000, 5000, 1.1);
    },
    coin100() {
      [72, 76, 79, 84, 88].forEach((m, i) => tone({ f: mtof(m), t: i * 0.06, type: 'triangle', a: 0.003, d: 0.14, v: 0.13 }));
      shimmer(0.3, 8, 0.035);
    },
    checkpoint() { bell(mtof(88), 0, 0.14, 0.8); bell(mtof(95), 0.12, 0.11, 1.0); },
    switch() {
      const r = jitter();
      noise({ f: 3500 * r, ft: 'highpass', d: 0.018, v: 0.18 });
      tone({ f: 190 * r, f2: 85, type: 'sine', t: 0.03, a: 0.003, d: 0.14, v: 0.3 });
    },
    lantern() {
      noise({ f: 300, f2: 1600, ft: 'lowpass', a: 0.06, d: 0.3, v: 0.12 });
      tone({ f: mtof(69), t: 0.08, type: 'sine', a: 0.08, d: 0.6, v: 0.09 });
      tone({ f: mtof(76), t: 0.08, type: 'sine', a: 0.08, d: 0.6, v: 0.07 });
    },
    chime(o = {}) {
      const i = Math.max(0, (o.index | 0)) % PENTA.length;
      const f = mtof(76 + PENTA[i]);
      if (o.correct === false) { tone({ f: f * 0.75, type: 'sine', a: 0.01, d: 0.4, v: 0.1 }); return; }
      bell(f, 0, 0.17, 1.1);
    },
    bell() { const f = mtof(64) * jitter(0.02); bell(f, 0, 0.26, 1.8); bell(f * 2, 0.01, 0.08, 1.2); },
    pop() {
      const r = jitter();
      tone({ f: 900 * r, f2: 220, type: 'sine', a: 0.002, d: 0.09, v: 0.28 });
      noise({ f: 2500, ft: 'highpass', d: 0.03, v: 0.1 });
      tone({ f: mtof(84) * r, t: 0.06, type: 'triangle', a: 0.003, d: 0.15, v: 0.08 });
    },
    hurt() {
      // soft "bonk": rounded, low-passed, short - never harsh
      const r = jitter();
      tone({ f: 330 * r, f2: 170 * r, type: 'sine', a: 0.004, d: 0.2, v: 0.22, lp: 1200 });
      tone({ f: 220 * r, f2: 150 * r, type: 'triangle', a: 0.004, d: 0.12, v: 0.08, lp: 900 });
    },
    respawn() {
      noise({ f: 400, f2: 1800, ft: 'bandpass', q: 1, a: 0.22, d: 0.2, v: 0.1 });
      tone({ f: mtof(67), f2: mtof(79), type: 'sine', a: 0.2, d: 0.3, v: 0.09 });
    },
    warn() { tone({ f: mtof(74), type: 'sine', a: 0.02, d: 0.35, v: 0.12 }); tone({ f: mtof(79), t: 0.32, type: 'sine', a: 0.02, d: 0.45, v: 0.12 }); },
    breakstart() { [79, 76, 72, 67].forEach((m, i) => tone({ f: mtof(m), t: i * 0.32, type: 'sine', a: 0.03, d: 0.8, v: 0.11 })); },
    breakend() { [67, 72, 76].forEach((m, i) => tone({ f: mtof(m), t: i * 0.14, type: 'sine', a: 0.01, d: 0.4, v: 0.1 })); },
    click() { tone({ f: 1250 * jitter(), type: 'triangle', a: 0.002, d: 0.035, v: 0.09 }); noise({ f: 4000, ft: 'highpass', d: 0.01, v: 0.04 }); },
    toast() { tone({ f: mtof(84), type: 'sine', a: 0.004, d: 0.12, v: 0.08 }); tone({ f: mtof(88), t: 0.06, type: 'sine', a: 0.004, d: 0.16, v: 0.07 }); },
    race() { tone({ f: mtof(81), type: 'triangle', a: 0.003, d: 0.08, v: 0.08 }); },
  };

  function play(name, opts) {
    if (!ac || !unlocked || !SFX[name]) return false;
    resume();
    try { SFX[name](opts); } catch (err) { console.warn('[audio] sfx failed', name, err && err.message); return false; }
    pushLog(name);
    return true;
  }

  // ---------- game event wiring ----------
  let lastRedId = null;
  const on = (type, fn) => events.on(type, p => fn(p || {}));
  on('player:jump', p => play('jump', { tier: p.tier }));
  on('player:land', p => { if ((p.fallSpeed || 0) > 3) play('land', p); });
  on('player:longjump', () => play('longjump'));
  on('player:poundstart', () => play('poundstart'));
  on('player:groundpound', () => play('pound'));
  on('player:wallkick', () => play('wallkick'));
  on('player:bounce', () => play('bounce'));
  on('pickup:redcoin', p => { lastRedId = p.id; play('redcoin', p); });
  on('pickup:coin', p => { if (p.id !== lastRedId) play('coin'); });
  on('pickup:star', () => play('star'));
  on('checkpoint:reached', () => play('checkpoint'));
  on('switch:pressed', () => play('switch'));
  on('lantern:lit', () => play('lantern'));
  on('chime:ring', p => play('chime', p));
  on('bell:ring', () => play('bell'));
  on('enemy:popped', () => play('pop'));
  on('player:hurt', () => play('hurt'));
  on('player:respawn', () => play('respawn'));
  on('race:tick', p => { if (p.remaining <= 5 && p.remaining > 0) play('race'); });
  on('ui:warn', () => play('warn'));
  on('ui:toast', () => play('toast'));
  on('ui:celebrate', p => { // kind 'star' never plays here: pickup:star already played the jingle
    if (p.kind === 'quest') play('quest');
    else if (p.kind === 'coin100') play('coin100');
  });
  on('break:start', () => { duck.brk = true; applyVolumes(false); play('breakstart'); });
  on('break:end', () => { duck.brk = false; applyVolumes(false); play('breakend'); });
  on('focus:changed', p => { duck.focus = !!p.on; applyVolumes(false); });
  on('game:pause', () => { duck.pause = true; applyVolumes(false); });
  on('game:resume', () => { duck.pause = false; applyVolumes(false); });
  on('game:start', () => { playing = true; duck.pause = false; applyVolumes(false); });
  on('game:stop', () => { playing = false; duck.pause = false; setMusic(null); });
  on('zone:enter', p => { playing = true; setMusic(p.zone); });
  // UI click sound for menu buttons (event delegation; never touches the UI agent's DOM)
  document.addEventListener('click', e => {
    const t = e.target && e.target.closest ? e.target.closest('#overlay button') : null;
    if (t) play('click');
  }, true);

  // ---------- music ----------
  function makeRng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; }; }
  function chordNotes(cfg, deg) {
    // triad on a scale degree (towers uses a flattened 7th for a mixolydian lift)
    const sc = cfg.mixo ? [0, 2, 4, 5, 7, 9, 10] : MAJOR;
    const n = i => { const k = deg + i; return cfg.root + sc[k % 7] + 12 * Math.floor(k / 7); };
    return [n(0), n(2), n(4), n(7)];
  }
  function startTrack(z) {
    const cfg = ZONES[z] || ZONES.hub;
    const g = ac.createGain(); g.gain.value = 0.0001; g.connect(musicFilter);
    g.gain.setTargetAtTime(1, ac.currentTime, 1.5 / 4);
    musicFilter.frequency.setTargetAtTime(cfg.cutoff, ac.currentTime, 0.4);
    const tr = { zone: z, cfg, gain: g, step: 0, next: ac.currentTime + 0.08, stepDur: 60 / cfg.bpm / 2, rng: makeRng(z.length * 977 + 13), lastMel: 2, dying: 0 };
    tracks.push(tr);
    return tr;
  }
  function fadeOut(tr) {
    if (tr.dying) return;
    tr.dying = ac.currentTime + 1.6;
    tr.gain.gain.cancelScheduledValues(ac.currentTime);
    tr.gain.gain.setTargetAtTime(0.0001, ac.currentTime, 1.5 / 4);
  }
  function setMusic(z) {
    zone = z || null;
    refreshMusic();
  }
  function refreshMusic() {
    if (!ac || !unlocked) return;
    const want = playing && zone && musicLevel() > 0 && !muted ? zone : null;
    const live = tracks.find(t => !t.dying);
    if (live && live.zone === want) return;
    if (live) fadeOut(live);
    if (want) startTrack(want);
  }
  function note(tr, f, t, d, v, type, a = 0.01) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    o.connect(g); g.connect(tr.gain); o.start(t); o.stop(t + a + d + 0.05);
  }
  function scheduleStep(tr, t) {
    const cfg = tr.cfg, s = tr.step % 32, bar = s >> 3, beat = s & 7;
    const ch = chordNotes(cfg, cfg.prog[bar]);
    const sw = (beat & 1) ? cfg.swing : 0, tt = t + sw;
    // bass: root on 1, fifth on 3 (half-note feel)
    if (beat === 0) note(tr, mtof(ch[0] - 24), tt, tr.stepDur * 3.5, 0.32, cfg.bass, 0.02);
    if (beat === 4) note(tr, mtof(ch[2] - 24), tt, tr.stepDur * 3, 0.24, cfg.bass, 0.02);
    // arpeggio on every 8th
    const ai = cfg.pattern[beat];
    note(tr, mtof(ch[ai]), tt, tr.stepDur * 1.6, cfg.arp === 'square' ? 0.05 : 0.09, cfg.arp, 0.008);
    // occasional melody notes from the pentatonic scale, mostly stepwise
    if ((beat === 0 || beat === 3 || beat === 6) && tr.rng() < cfg.mel + (beat === 0 ? 0.15 : 0)) {
      const mv = tr.rng() < 0.7 ? (tr.rng() < 0.5 ? -1 : 1) : (tr.rng() < 0.5 ? -2 : 2);
      tr.lastMel = Math.max(0, Math.min(9, tr.lastMel + mv));
      const m = cfg.root + 12 + PENTA[tr.lastMel % 5] + 12 * Math.floor(tr.lastMel / 5);
      note(tr, mtof(m), tt, tr.stepDur * (beat === 6 ? 1.5 : 3), 0.11, 'sine', 0.02);
    }
    // every 4 bars re-seed the melody so the loop breathes without being random noise
    if (s === 31) tr.rng = makeRng((tr.rng() * 1e6) | 0);
    tr.step++;
  }
  events.on('tick', () => {
    if (!ac || !tracks.length || ac.state !== 'running') return;
    const now = ac.currentTime, ahead = now + 0.3;
    for (let i = tracks.length - 1; i >= 0; i--) {
      const tr = tracks[i];
      if (tr.dying && now > tr.dying) { try { tr.gain.disconnect(); } catch (_) { /* ignore */ } tracks.splice(i, 1); continue; }
      if (tr.next < now - 0.1) tr.next = now + 0.05; // after a hitch / resume: never burst-schedule
      let n = 0;
      while (tr.next < ahead && n++ < 8) { scheduleStep(tr, tr.next); tr.next += tr.stepDur; }
    }
  });

  function mute(b) { muted = !!b; applyVolumes(false); refreshMusic(); return muted; }

  const api = {
    get ctx() { return ac; },
    get unlocked() { return unlocked; },
    get state() { return ac ? ac.state : 'none'; },
    get musicZone() { return (tracks.find(t => !t.dying) || {}).zone || null; },
    get musicTracks() { return tracks.length; },
    play, setMusic, mute,
    debugList: () => log.slice(),
    names: Object.keys(SFX),
  };
  const expose = () => { if (window.__game && window.__game.audio !== api) window.__game.audio = api; };
  Promise.resolve().then(expose);
  events.once('tick', expose);
  return api;
}
