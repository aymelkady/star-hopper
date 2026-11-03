/*
 * Objectives (R1/R2/R3, A3/A4): the ONE source of truth for the current goal.
 *  - Order: Today's Quest stars first, then world.STAR_ORDER (uncollected), with gentle gating
 *    (cove waits for 2 stars, towers for 5, unless nothing else is left) and skipped stars last.
 *  - Quest card (#quest-card), 3D beacon + arrow (systems/beacon.js), distance chip.
 *  - Zone wayfinding: target = zone entrance while Pip is in the hub / another zone.
 *  - pickup:star -> ui:celebrate + 2.5 s celebration card -> advance -> objective:changed.
 *  - Today's Quest (3 stars, date-stamped in save data.todayQuest) + "Great session!" card.
 * Returned API (window.__game.plugins.objectives): current(), skip(), order(), quest(), target(),
 *   introsShown, lastCelebration, debugHoldTimers(bool)
 */
import { createBeacon } from './beacon.js';
import { createQuestCard } from '../ui/quest-card.js';

export const NAME = 'objectives';
let TOTAL = 15; /* focus-play: recounted on game:start (15 + 5 challenge stars) */ const CELEBRATE_S = 2.5, INTRO_S = 3;

// [icon, ≤6-word text, counter total | null]
const LABELS = {
  'meadow-1': ['⭐', 'Reach the hilltop flag'], 'meadow-2': ['🔴', 'Red coins', 8], 'meadow-3': ['💥', 'Bonk Grumbles', 3],
  'meadow-4': ['💧', 'Find the waterfall secret'], 'cove-1': ['🪵', 'Cross the log ride'], 'cove-2': ['🏮', 'Lanterns', 5],
  'cove-3': ['🔴', 'Rock red coins', 8], 'cove-4': ['👻', 'Race the ghost'], 'towers-1': ['🔔', 'Climb to the bell'],
  'towers-2': ['🦘', 'Triple-jump the gap'], 'towers-3': ['🔴', 'Spiral red coins', 8], 'towers-4': ['🎐', 'Ring the chimes', 4],
  'bonus-meadow': ['🪙', 'Meadow coins', 100], 'bonus-cove': ['🪙', 'Cove coins', 100], 'bonus-towers': ['🪙', 'Tower coins', 100],
};
const SHORT_ZONE = { meadow: 'Meadow', cove: 'Cove', towers: 'Towers', hub: 'Hub' };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function init(ctx) {
  const { THREE, scene, events, state, world, ctrl, pip, game, api, menus, hud } = ctx;
  const ORDER = world.STAR_ORDER;
  const byId = world.props.starById; // focus-play: live map (challenge stars register after this plugin)
  const beacon = createBeacon(THREE, scene);
  const card = createQuestCard({ onSkip: () => skip(), onIntroTap: () => endIntro() });
  card.show(false);

  let current = null, celebrateT = 0, introT = 0, still = false, active = false, introsShown = 0, lastCelebration = '', hold = false;
  let quest = null;             // { date, stars:[ids], celebrated }
  const skipRank = new Map(); let skipN = 0;
  let route = { target: null, via: null };

  const have = id => state.hasStar(id);
  const count = () => (state.data ? state.data.stars.length : 0);
  const gated = s => (s.zone === 'cove' && count() < 2) || (s.zone === 'towers' && count() < 5);

  // ---- ordering ----
  function order(withQuest = true) {
    const qs = withQuest && quest ? quest.stars : [];
    return ORDER.map((id, i) => ({ s: byId.get(id), i })).filter(o => o.s && !o.s.collected)
      .map(o => ({ ...o, k: [skipRank.get(o.s.id) || 0, gated(o.s) ? 1 : 0, qs.includes(o.s.id) ? 0 : 1, o.i] }))
      .sort((a, b) => { for (let j = 0; j < 4; j++) if (a.k[j] !== b.k[j]) return a.k[j] - b.k[j]; return 0; })
      .map(o => o.s);
  }

  // ---- labels + sub-progress ----
  function progressOf(s) {
    const P = world.props;
    if (s.revealed && !s.collected && s.hidden) return { n: 1, of: 1 };
    switch (s.task) {
      case 'redcoins': return { n: state.redCoinsFor(s.id).length, of: 8 };
      case 'grumbles': { const g = P.entities.filter(e => e.group === s.id); return { n: g.filter(e => !e.alive).length, of: g.length || 3 }; }
      case 'switches': { const sw = P.switches.filter(w => w.zone === s.zone); return { n: sw.filter(w => w.pressed).length, of: sw.length || 5 }; }
      case 'chimes': { const c = P.entities.find(e => e.type === 'chimes'); return { n: c ? c.next : 0, of: 4 }; }
      case 'bonus': return { n: Math.min(100, (state.data && state.data.coins[s.zone]) || 0), of: 100 };
      default: return null;
    }
  }
  function labelOf(s) {
    const [icon, text, of] = LABELS[s.id] || s.label || ['⭐', s.name]; // focus-play: s.label = [icon, text]
    if (s.hidden && s.revealed && !s.collected) return { icon: '⭐', text: 'Grab the star!', progress: 1 };
    const p = progressOf(s);
    if (p && of) return { icon, text: `${text} ${p.n} / ${p.of}`, progress: p.n / p.of };
    return { icon, text, progress: null };
  }
  const shortText = s => (LABELS[s.id] || s.label || ['', s.name])[1];

  // ---- routing (zone wayfinding) ----
  function computeRoute(s) {
    const p = ctrl.position, here = world.zoneAt(p.x, p.z);
    if (!s) return { target: null, via: null };
    if (s.zone !== here && s.zone !== 'hub') {
      if (here === 'hub') return { target: world.zoneEntrance(s.zone), via: s.zone };
      const e = world.zoneEntrances[here];                     // head back toward the hub first
      if (e) { const k = 18 / Math.hypot(e.x, e.z); return { target: { x: e.x * k, y: world.col.groundHeight(e.x * k, e.z * k, 40) + 0.2, z: e.z * k }, via: 'hub' }; }
    }
    return { target: world.objectiveTarget(s, p), via: null };
  }

  // ---- current objective ----
  function advance(force = false) {
    const next = order()[0] || null;
    if (!force && next === current) { refreshCard(); return; }
    current = next; game.objective = next ? next.id : null;
    route = computeRoute(current);
    const target = current ? world.objectiveTarget(current, ctrl.position) : null;
    events.emit('objective:changed', current
      ? { starId: current.id, name: current.name, zone: current.zone, target }
      : { starId: null, name: 'All stars found!', zone: null, target: null });
    refreshCard();
  }
  function refreshCard() {
    if (card.mode !== 'objective') return;
    if (!current) { card.setObjective({ icon: '🏆', text: `All ${TOTAL} stars! Wow!`, skippable: false }); card.setDistance(''); card.setQuestDots(0, 0, -1); return; }
    card.setObjective({ ...labelOf(current), skippable: order().length > 1 });
    if (quest) {
      const done = quest.stars.filter(have).length;
      card.setQuestDots(done, quest.stars.length, quest.stars.indexOf(current.id));
    } else card.setQuestDots(0, 0, -1);
  }
  function skip() {
    if (!active || game.mode !== 'playing' || card.mode !== 'objective' || !current) return false;
    if (order().length <= 1) { hud.toast('Last star! You can do it!'); return false; }
    const from = current.id;
    skipRank.set(from, ++skipN);
    advance();
    events.emit('objective:skipped', { starId: from, next: current && current.id });
    hud.toast('New goal!', 1200);
    return true;
  }

  // ---- Today's Quest ----
  function loadQuest() {
    const d = state.data; if (!d) { quest = null; return; }
    const q = d.todayQuest;
    if (q && q.date === today() && Array.isArray(q.stars)) { quest = q; return; }
    const picks = [];                    // focus-play: at most one challenge star per quest
    for (const s of order(false)) { if (picks.length >= 3) break; if (s.focus && picks.some(id => byId.get(id).focus)) continue; picks.push(s.id); }
    quest = picks.length ? { date: today(), stars: picks, celebrated: false } : null;
    d.todayQuest = quest;
    state.save('quest');
  }
  function showIntro() {
    if (!quest || quest.celebrated) return;
    const cur = current && current.id;
    card.intro(quest.stars.map(id => ({ text: shortText(byId.get(id)), done: have(id), current: id === cur })));
    introT = INTRO_S; introsShown++;
  }
  function endIntro() { if (card.mode !== 'intro') return; introT = 0; card.objective(); refreshCard(); }
  function questJustDone() {
    if (!quest || quest.celebrated || !quest.stars.every(have)) return false;
    quest.celebrated = true; state.data.todayQuest = quest; state.save('quest');
    return true;
  }
  function showGreatSession() {
    if (!active || !quest) return;
    if (game.mode !== 'playing') { events.once('game:resume', showGreatSession); return; } // e.g. a stretch break is up
    events.emit('ui:celebrate', { kind: 'quest', count: count(), total: TOTAL });
    api.pause();
    menus.showCard(`<div class="menu great" role="dialog" aria-label="Great session">
      <div class="great-burst" aria-hidden="true">🎉</div>
      <h2>Great session!</h2>
      <p class="great-stars">${quest.stars.map(() => '⭐').join(' ')}</p>
      <button id="btn-keep-going" class="btn big" data-autofocus>▶ Keep going</button>
      <button id="btn-quest-stop" class="btn primary">💾 Save &amp; stop</button>
    </div>`, { dim: true, locked: true, screen: 'great', onBack: null });
    document.getElementById('btn-keep-going').addEventListener('click', () => { menus.hide(); api.resume(); });
    document.getElementById('btn-quest-stop').addEventListener('click', () => api.saveAndStop());
  }

  // ---- events ----
  events.on('game:start', () => {
    active = true; skipRank.clear(); skipN = 0; celebrateT = 0; TOTAL = world.stars.length; // focus-play
    loadQuest(); card.objective(); card.show(true);
    advance(true); showIntro();
  });
  events.on('game:stop', () => { active = false; current = null; game.objective = null; card.show(false); beacon.hide(); celebrateT = introT = 0; });
  events.on('pickup:star', p => {
    if (!active) return;
    const n = count();
    events.emit('ui:celebrate', { kind: 'star', id: p.id, name: p.name, count: n, total: TOTAL });
    lastCelebration = `⭐ Star ${n} / ${TOTAL}! Nice!`;
    card.celebrate(lastCelebration, p.name);
    celebrateT = CELEBRATE_S; introT = 0;
  });
  events.on('star:revealed', p => { if (active && current && p.id === current.id) advance(true); else refreshCard(); });
  for (const t of ['pickup:redcoin', 'enemy:popped', 'lantern:lit', 'chime:ring', 'pickup:coin']) events.on(t, () => { if (active) refreshCard(); });
  events.on('focus:changed', p => { still = !!p.on; beacon.setFocus(still); });

  window.addEventListener('keydown', e => {
    if (e.code !== 'Tab' || game.mode !== 'playing' || !active) return;
    const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault(); skip();
  });
  menus.addPauseButton({ id: 'btn-skip-goal', label: '⏭ Skip goal', onClick: () => { menus.hide(); api.resume(); skip(); } });

  let routeT = 0, lastNow = performance.now();
  events.on('tick', ({ dt }) => {
    const now = performance.now(), rdt = Math.min(1, (now - lastNow) / 1000); lastNow = now; // UI timers use wall-clock time
    if (!active) return;
    if (celebrateT > 0 && !hold) {
      celebrateT -= rdt;
      if (celebrateT <= 0) { card.objective(); advance(); if (questJustDone()) showGreatSession(); }
    }
    if (introT > 0 && !hold) { introT -= rdt; if (introT <= 0) endIntro(); }
    routeT -= dt;
    if (routeT <= 0) { routeT = 0.1; route = computeRoute(current); }
    const pp = pip.root.position;
    const d = beacon.update(dt, celebrateT > 0 ? null : route.target, pp, still || state.settings.reduceMotion, ctx.camera.position);
    if (card.mode === 'objective' && current) {
      const m = Number.isFinite(d) ? Math.max(0, Math.round(d)) : null;
      card.setDistance(m === null ? '' : route.via ? `➜ ${SHORT_ZONE[route.via]} ${m} m` : `${m} m`);
    }
  });

  return {
    current: () => current && current.id,
    order: () => order().map(s => s.id),
    quest: () => quest && { ...quest, stars: [...quest.stars] },
    target: () => route.target,
    skip,
    beacon,
    get celebrating() { return celebrateT > 0; },
    get introsShown() { return introsShown; },
    get lastCelebration() { return lastCelebration; },
    debugHoldTimers(v) { hold = !!v; }, // tests: freeze the celebration / intro cards for screenshots
  };
}
