/*
 * Save / load.  Three slots in localStorage under `starhopper.save.<1|2|3>`, global settings in
 * `starhopper.settings`.  Auto-saves on star, checkpoint and settings changes; emits save:written.
 *
 * Save data shape (version 1):
 *   { version, slot, created, updated, stars:[ids], redCoins:{starId:[indices]},
 *     coins:{hub,meadow,cove,towers}, coinIds:[ids], checkpoint:{id,x,y,z,zone}|null,
 *     playTime (s), lastZone, settings:{...snapshot},
 *     focus:{levels:{type:1..5}, history:{type:[{hit,rt}]}, bursts, results:{starId:{won,fails,attempts,best}}} }
 */
export const SLOT_COUNT = 3;
const SAVE_KEY = n => `starhopper.save.${n}`;
const SETTINGS_KEY = 'starhopper.settings';

export const DEFAULT_SETTINGS = {
  moveMode: 'simple',     // 'simple' (Roblox-like, default) | 'pro' (timed combo moveset) - DESIGN.md §5.5
  autoJump: true,         // simple mode, touch only: walk into a 0.45-1.6 m ledge = jump
  helperMode: true,       // coyote time, jump buffer, coin magnet ("Pro mode" = false)
  invertY: false,
  cameraSpeed: 1,
  pointerLock: false,
  masterVolume: 0.8,
  musicVolume: 0.5,
  sfxVolume: 0.8,
  breakMinutes: 20,
  focusMode: false,
  reduceMotion: false,
  haptics: true,          // touch-button vibration (navigator.vibrate)
  freezeEnabled: true,    // focus-play: the random "Freeze!" game (systems/focusplay.js)
};

function store() {
  try { const ls = window.localStorage; ls.getItem('x'); return ls; } catch (_) { return null; }
}
function readJSON(key) {
  const ls = store(); if (!ls) return null;
  try { const s = ls.getItem(key); return s ? JSON.parse(s) : null; } catch (_) { return null; }
}
function writeJSON(key, v) {
  const ls = store(); if (!ls) return false;
  try { ls.setItem(key, JSON.stringify(v)); return true; } catch (_) { return false; }
}

export function freshSave(slot, settings) {
  const now = Date.now();
  return {
    version: 1, slot, created: now, updated: now,
    stars: [], redCoins: {}, coins: { hub: 0, meadow: 0, cove: 0, towers: 0 }, coinIds: [],
    checkpoint: null, playTime: 0, lastZone: 'hub', settings: { ...settings },
    // focus-play (systems/focusplay.js): adaptivity levels 1..5 per challenge type, last 10
    // responses per type, lifetime Focus Bursts, per-challenge-star results
    focus: { levels: {}, history: {}, bursts: 0, results: {} },
  };
}

// A save is usable only if it has the shape the game reads unguarded; anything else (hand-edited,
// truncated, an old format) is treated as an empty slot instead of breaking the title / boot.
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
export function validSave(d) {
  return isObj(d) && d.version === 1 && Array.isArray(d.stars) && d.stars.every(x => typeof x === 'string');
}
function sanitize(d, slot, settings) {
  const base = freshSave(slot, settings), out = { ...base, ...d, slot };
  if (!isObj(out.redCoins)) out.redCoins = {};
  for (const k of Object.keys(out.redCoins)) if (!Array.isArray(out.redCoins[k])) out.redCoins[k] = [];
  if (!isObj(out.coins)) out.coins = { ...base.coins };
  for (const k of Object.keys(base.coins)) if (!(Number(out.coins[k]) >= 0)) out.coins[k] = 0;
  if (!Array.isArray(out.coinIds)) out.coinIds = [];
  if (!isObj(out.settings)) out.settings = { ...settings };
  if (!isObj(out.focus)) out.focus = base.focus;
  if (!(Number(out.playTime) >= 0)) out.playTime = 0;
  if (out.checkpoint && !(isObj(out.checkpoint) && [out.checkpoint.x, out.checkpoint.y, out.checkpoint.z].every(Number.isFinite))) out.checkpoint = null;
  if (out.todayQuest && !(isObj(out.todayQuest) && Array.isArray(out.todayQuest.stars))) out.todayQuest = null;
  return out;
}

// Old / hand-edited settings: anything but 'pro' is Simple (the default).
function normalizeSettings(s) {
  if (s.moveMode !== 'pro') s.moveMode = 'simple';
  if (typeof s.autoJump !== 'boolean') s.autoJump = true;
  return s;
}

export function createState(events) {
  const st = {
    slot: 0,
    data: null,
    settings: normalizeSettings({ ...DEFAULT_SETTINGS, ...(readJSON(SETTINGS_KEY) || {}) }),
    _coinSet: new Set(),

    listSlots() {
      const out = [];
      for (let n = 1; n <= SLOT_COUNT; n++) {
        const d = readJSON(SAVE_KEY(n));
        out.push(validSave(d) ? { slot: n, empty: false, stars: d.stars.length, playTime: Number(d.playTime) || 0, updated: Number(d.updated) || 0 }
          : { slot: n, empty: true, stars: 0, playTime: 0 });
      }
      return out;
    },
    load(slot) {
      const d = readJSON(SAVE_KEY(slot));
      st.slot = slot;
      st.data = validSave(d) ? sanitize(d, slot, st.settings) : freshSave(slot, st.settings);
      st._coinSet = new Set(st.data.coinIds);
      return st.data;
    },
    reset(slot) { // last resort when a save loads but the world cannot apply it (main.js startGame)
      st.slot = slot; st.data = freshSave(slot, st.settings); st._coinSet = new Set();
      return st.data;
    },
    clearSlot(slot) {
      const ls = store(); if (ls) try { ls.removeItem(SAVE_KEY(slot)); } catch (_) { /* ignore */ }
    },
    save(reason = 'manual') {
      if (!st.data || !st.slot) return false;
      st.data.updated = Date.now();
      st.data.settings = { ...st.settings };
      st.data.coinIds = [...st._coinSet];
      const ok = writeJSON(SAVE_KEY(st.slot), st.data);
      if (ok) events.emit('save:written', { slot: st.slot, reason });
      return ok;
    },
    close() { st.slot = 0; st.data = null; st._coinSet = new Set(); },

    hasStar(id) { return !!st.data && st.data.stars.includes(id); },
    addStar(id) {
      if (!st.data || st.hasStar(id)) return false;
      st.data.stars.push(id);
      st.save('star');
      return true;
    },
    hasCoin(id) { return st._coinSet.has(id); },
    addCoin(id, zone, value = 1) {
      if (!st.data) return 0;
      st._coinSet.add(id);
      st.data.coins[zone] = (st.data.coins[zone] || 0) + value;
      return st.data.coins[zone];
    },
    totalCoins() {
      if (!st.data) return 0;
      return Object.values(st.data.coins).reduce((a, b) => a + b, 0);
    },
    redCoinsFor(starId) { return (st.data && st.data.redCoins[starId]) || []; },
    addRedCoin(starId, index) {
      if (!st.data) return 0;
      const arr = st.data.redCoins[starId] || (st.data.redCoins[starId] = []);
      if (!arr.includes(index)) arr.push(index);
      return arr.length;
    },
    setCheckpoint(cp) {
      if (!st.data) return;
      st.data.checkpoint = { id: cp.id, x: cp.x, y: cp.y, z: cp.z, zone: cp.zone };
      st.save('checkpoint');
    },
    setSetting(key, value) {
      st.settings[key] = value;
      writeJSON(SETTINGS_KEY, st.settings);
      events.emit('settings:changed', { key, value, settings: st.settings });
      if (st.data) st.save('settings'); else events.emit('save:written', { slot: 0, reason: 'settings' });
    },
  };
  return st;
}
