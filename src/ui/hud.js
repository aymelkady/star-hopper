/*
 * Minimal HUD (placeholder look; the UI agent restyles it).  DOM lives in index.html:
 * #hud, #hud-stars, #hud-coins, #hud-redcoins, #hud-timer, #hud-zone, #btn-pause, #btn-focus,
 * #quest-card (filled by systems/objectives.js), #break-ring (systems/breaks.js), #toast, #fade,
 * #rotate-hint (portrait phones/tablets: shown for 3 s when play starts or the device turns).
 * API: hud.show(v), hud.toast(text, ms), hud.refresh(), hud.setZone(zone), hud.compact, hud.peek(el)
 *
 * Compact HUD (DESIGN.md §5.4): touch devices or any viewport <= 900 px wide / <= 500 px tall get
 * body.hud-compact (re-evaluated on resize).  CSS then shows only the quest card + the star chip
 * permanently; coins / red coins / lantern + chime counts / zone name "peek" (class .peek) for
 * 2.5 s when they change, then fade.  The current objective's own counter lives in the quest card
 * text ("Red coins 3 / 8"), so it does not peek.  Reduced motion: plain show / hide, no slide.
 */
import { IS_TOUCH } from '../core/touch.js';

const RED_STAR = { meadow: 'meadow-2', cove: 'cove-3', towers: 'towers-3' };
export const PEEK_MS = 2500;
export const isCompactViewport = () => IS_TOUCH || window.innerWidth <= 900 || window.innerHeight <= 500;

export function createHud({ events, state, world }) {
  const $ = id => document.getElementById(id);
  const el = { hud: $('hud'), stars: $('hud-stars'), coins: $('hud-coins'), red: $('hud-redcoins'), timer: $('hud-timer'), zone: $('hud-zone'), count: $('hud-count'), toast: $('toast') };
  const val = e => e.querySelector('.val');
  let zone = 'hub', objective = null;
  const pulse = e => { e.classList.remove('pulse'); void e.offsetWidth; e.classList.add('pulse'); };

  // ---- compact HUD (phones / tablets / small windows) ----
  let compact = false;
  function evalCompact() {
    const c = isCompactViewport();
    if (c === compact && document.body.classList.contains('hud-compact') === c) return;
    compact = c; document.body.classList.toggle('hud-compact', c);
    if (!c) for (const e of peekTimers.keys()) unpeek(e);
  }
  const peekTimers = new Map();
  function unpeek(e) { clearTimeout(peekTimers.get(e)); peekTimers.delete(e); e.classList.remove('peek'); }
  function peek(e) { // slide in, hold, fade out (CSS animation lasts PEEK_MS; reduce-motion: no animation)
    if (!compact || !e) return;
    e.classList.remove('peek'); void e.offsetWidth; e.classList.add('peek');
    clearTimeout(peekTimers.get(e));
    peekTimers.set(e, setTimeout(() => unpeek(e), PEEK_MS));
  }
  evalCompact();
  window.addEventListener('resize', evalCompact);
  window.addEventListener('orientationchange', () => setTimeout(evalCompact, 120));
  function showCount(icon, n, of) { // lantern / chime progress when that star is NOT the current goal
    if (!el.count) return;
    el.count.querySelector('.ico').textContent = icon; val(el.count).textContent = `${n} / ${of}`;
    peek(el.count);
  }

  function refresh() {
    const d = state.data;
    if (!d) return;
    val(el.stars).textContent = `${d.stars.length} / ${world.stars.length}`; // 15 + 5 challenge stars, live
    const zc = d.coins[zone] || 0;
    val(el.coins).textContent = zone === 'hub' ? `${state.totalCoins()}` : `${zc} / 100`;
    const rs = RED_STAR[zone];
    if (rs && !d.stars.includes(rs)) { el.red.hidden = false; val(el.red).textContent = `${state.redCoinsFor(rs).length} / 8`; }
    else el.red.hidden = true;
    el.zone.textContent = world.zoneName(zone);
  }

  const queue = []; let showing = false;
  function nextToast() {
    if (!queue.length) { showing = false; return; }
    showing = true;
    const { text, ms } = queue.shift();
    el.toast.textContent = text; el.toast.classList.add('show');
    setTimeout(() => { el.toast.classList.remove('show'); setTimeout(nextToast, 200); }, ms);
  }
  function toast(text, ms = 1600) {
    if (queue.length && queue[queue.length - 1].text === text) return;
    queue.push({ text, ms }); if (queue.length > 4) queue.shift();
    if (!showing) nextToast();
  }

  events.on('pickup:coin', () => { refresh(); pulse(el.coins); peek(el.coins); });
  events.on('pickup:redcoin', p => { refresh(); pulse(el.red); if (!p || p.starId !== objective) peek(el.red); });
  events.on('lantern:lit', p => { if (objective !== 'cove-2' && p) showCount('🏮', p.count, p.total); });
  events.on('chime:ring', p => { if (objective !== 'towers-4' && p && p.correct) showCount('🎐', p.next, 4); });
  events.on('objective:changed', p => { objective = p ? p.starId : null; });
  events.on('pickup:star', p => { refresh(); pulse(el.stars); toast(`★ ${p.name}!`, 2400); });
  events.on('zone:enter', p => { zone = p.zone; refresh(); pulse(el.zone); peek(el.zone); });
  events.on('game:start', () => refresh());
  events.on('game:stop', () => { for (const e of [...peekTimers.keys()]) unpeek(e); });
  events.on('ui:toast', p => toast(p.text));
  events.on('player:hurt', p => toast(p.bonks >= p.max ? 'Ouch! Back to the flag' : `Bonk! ${p.bonks} / ${p.max}`));
  events.on('race:start', p => { el.timer.hidden = false; val(el.timer).textContent = p.target; });
  events.on('race:tick', p => { val(el.timer).textContent = p.remaining; });
  events.on('race:end', () => { el.timer.hidden = true; });

  // portrait hint: friendly, never permanent (the game stays playable in portrait)
  const hint = $('rotate-hint'); let hintTimer = 0, playing = false;
  const portrait = () => window.matchMedia && window.matchMedia('(orientation: portrait) and (pointer: coarse)').matches;
  function maybeHint() {
    if (!hint || !playing || !portrait()) { if (hint) hint.classList.remove('show'); return; }
    hint.classList.add('show'); clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hint.classList.remove('show'), 3000);
  }
  events.on('game:start', () => { playing = true; maybeHint(); });
  events.on('game:stop', () => { playing = false; maybeHint(); });
  let wasPortrait = portrait();
  window.addEventListener('resize', () => { const p = portrait(); if (p !== wasPortrait) { wasPortrait = p; maybeHint(); } });

  return {
    el, refresh, toast, peek,
    get compact() { return compact; },
    setZone(z) { zone = z; refresh(); },
    show(v) { el.hud.hidden = !v; if (v) refresh(); },
  };
}
