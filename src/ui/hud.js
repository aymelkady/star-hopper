/*
 * Minimal HUD (placeholder look; the UI agent restyles it).  DOM lives in index.html:
 * #hud, #hud-stars, #hud-coins, #hud-redcoins, #hud-timer, #hud-zone, #btn-pause, #btn-focus,
 * #quest-card (filled by systems/objectives.js), #break-ring (systems/breaks.js), #toast, #fade,
 * #rotate-hint (portrait phones/tablets: shown for 3 s when play starts or the device turns).
 * API: hud.show(v), hud.toast(text, ms), hud.refresh(), hud.setZone(zone)
 */
const RED_STAR = { meadow: 'meadow-2', cove: 'cove-3', towers: 'towers-3' };

export function createHud({ events, state, world, totalStars = 15 }) {
  const $ = id => document.getElementById(id);
  const el = { hud: $('hud'), stars: $('hud-stars'), coins: $('hud-coins'), red: $('hud-redcoins'), timer: $('hud-timer'), zone: $('hud-zone'), toast: $('toast') };
  const val = e => e.querySelector('.val');
  let zone = 'hub';
  const pulse = e => { e.classList.remove('pulse'); void e.offsetWidth; e.classList.add('pulse'); };

  function refresh() {
    const d = state.data;
    if (!d) return;
    val(el.stars).textContent = `${d.stars.length} / ${totalStars}`;
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

  events.on('pickup:coin', () => { refresh(); pulse(el.coins); });
  events.on('pickup:redcoin', () => { refresh(); pulse(el.red); });
  events.on('pickup:star', p => { refresh(); pulse(el.stars); toast(`★ ${p.name}!`, 2400); });
  events.on('zone:enter', p => { zone = p.zone; refresh(); pulse(el.zone); });
  events.on('game:start', () => refresh());
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
    el, refresh, toast,
    setZone(z) { zone = z; refresh(); },
    show(v) { el.hud.hidden = !v; if (v) refresh(); },
  };
}
