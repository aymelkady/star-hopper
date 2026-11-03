/*
 * Focus-play DOM (systems/focusplay.js drives it; styles under `/* focus-play *\/` in style.css).
 *  - Focus Meter: a small sun docked to the LEFT edge of #quest-card (outside it).  The gold ring
 *    fills 0..100; .dim while it drains (never red, never a message); .flash on a hit; .full glow.
 *    If the card is so wide that the sun would touch a HUD chip, it docks under the card instead.
 *  - #fp-layer (pointer-events: none except buttons): rule card, 3-2-1 count, result card,
 *    Freeze! card with a 2 s ring, and a small challenge progress chip (bottom centre; in the
 *    compact HUD it takes the quest card's slot: same top / height, at least the card's width).
 * Every line is <= 6 words and >= 20 px.  Buttons are >= 56 px tall and stop pointer events so
 * the touch layer underneath never sees them (no accidental jumps).
 */
const RING_C = 2 * Math.PI * 42;

export function createFocusUI() {
  const qc = document.getElementById('quest-card');
  const meter = document.createElement('span');
  meter.id = 'focus-meter'; meter.className = 'fm';
  meter.setAttribute('role', 'img'); meter.setAttribute('aria-label', 'Focus sun 0 %');
  meter.innerHTML = '<span class="fm-ring"></span><span class="fm-sun" aria-hidden="true"></span>';
  if (qc) qc.appendChild(meter);

  const layer = document.createElement('div');
  layer.id = 'fp-layer';
  layer.innerHTML = `
    <div class="fp-card" id="fp-card" hidden role="dialog" aria-live="polite"></div>
    <div class="fp-count" id="fp-count" hidden aria-live="assertive"></div>
    <div class="fp-freeze" id="fp-freeze" hidden role="status">
      <div class="fz-ico" aria-hidden="true">❄️</div>
      <div class="fz-text"><div class="fz-big"></div><div class="fz-sub"></div></div>
      <svg class="fz-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="42" class="bg"/><circle cx="50" cy="50" r="42" class="fg"/></svg>
    </div>
    <div class="fp-chip" id="fp-chip" hidden></div>`;
  document.body.appendChild(layer);
  const $ = id => layer.querySelector('#' + id);
  const card = $('fp-card'), count = $('fp-count'), frz = $('fp-freeze'), chip = $('fp-chip');
  const ring = frz.querySelector('.fg');
  ring.style.strokeDasharray = `${RING_C}`;
  let lastV = -1, flashT = 0, cardKind = null, buttons = [];

  const retrigger = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
  const stop = e => e.stopPropagation();

  function setMeter(v, draining) {
    const r = Math.round(v);
    if (r !== lastV) { lastV = r; meter.style.setProperty('--v', String(r)); meter.setAttribute('aria-label', `Focus sun ${r} %`); }
    meter.classList.toggle('dim', !!draining);
    meter.classList.toggle('full', r >= 90);
  }
  function flash() { retrigger(meter, 'flash'); clearTimeout(flashT); flashT = setTimeout(() => meter.classList.remove('flash'), 400); }

  // dock under the card when the left side would collide with a HUD chip
  function dock() {
    if (!qc || qc.hidden) return;
    meter.classList.remove('below');
    const m = meter.getBoundingClientRect();
    const hit = [...document.querySelectorAll('.hud-left > *')].some(e => {
      if (!e.offsetParent) return false; const b = e.getBoundingClientRect();
      return !(m.right <= b.left || b.right <= m.left || m.bottom <= b.top || b.bottom <= m.top);
    });
    if (hit || m.left < 0) meter.classList.add('below');
  }

  // card({icon, lines:[big, sub?], hint?, buttons:[{id,label,primary,onClick}], kind})
  function showCard({ icon = '', lines = [], hint = '', buttons: btns = [], kind = 'rule' }) {
    cardKind = kind; buttons = btns;
    card.className = `fp-card fp-${kind}`;
    card.innerHTML = `${icon ? `<div class="fp-ico" aria-hidden="true">${icon}</div>` : ''}
      <div class="fp-lines">${lines.map((l, i) => `<div class="${i ? 'fp-sub' : 'fp-big'}">${l}</div>`).join('')}
      ${hint ? `<div class="fp-hint">${hint}</div>` : ''}</div>
      <div class="fp-btns">${btns.map(b => `<button id="${b.id}" class="fp-btn${b.primary ? ' primary' : ''}">${b.label}</button>`).join('')}</div>`;
    for (const b of btns) {
      const el = card.querySelector('#' + b.id);
      el.addEventListener('pointerdown', stop); el.addEventListener('touchstart', stop, { passive: true });
      el.addEventListener('click', e => { e.stopPropagation(); el.blur(); b.onClick(); });
    }
    card.hidden = false;
  }
  function hideCard() { card.hidden = true; card.innerHTML = ''; cardKind = null; buttons = []; }
  function pressPrimary() { const b = buttons.find(x => x.primary) || buttons[0]; if (b && !card.hidden) { b.onClick(); return true; } return false; }

  function showCount(n) {
    if (n === null) { count.hidden = true; return; }
    count.hidden = false; count.textContent = n; retrigger(count, 'pop');
  }
  function freeze(kind, progress = 0) { // kind: null | 'ready' | 'hold' | 'ok' | 'oops'
    if (!kind) { frz.hidden = true; return; }
    frz.hidden = false; frz.dataset.kind = kind;
    const big = frz.querySelector('.fz-big'), sub = frz.querySelector('.fz-sub');
    const T = { ready: ['Freeze!', 'Stand still'], hold: ['Freeze!', 'Stand still'], ok: ['Great freeze!', '+5 coins 🪙'], oops: ['Whoops!', 'Next time 🙂'] }[kind];
    if (big.textContent !== T[0]) big.textContent = T[0];
    if (sub.textContent !== T[1]) sub.textContent = T[1];
    ring.style.strokeDashoffset = `${RING_C * (1 - Math.max(0, Math.min(1, progress)))}`;
  }
  function setChip(text) {
    if (!text) { chip.hidden = true; chip.style.minWidth = ''; return; }
    if (chip.textContent !== text) { chip.textContent = text; retrigger(chip, 'pop'); }
    if (chip.hidden) { // compact HUD: occupy the (now blank) quest card's box so nothing jumps
      const card = qc && document.body.classList.contains('hud-compact') && qc.querySelector(':scope > div:not([hidden])');
      chip.style.minWidth = card ? `${Math.round(card.getBoundingClientRect().width)}px` : '';
    }
    chip.hidden = false;
  }

  return {
    meter, layer, card, dock, setMeter, flash, showCard, hideCard, pressPrimary, showCount, freeze, setChip,
    get cardKind() { return cardKind; },
    get cardOpen() { return !card.hidden; },
  };
}
