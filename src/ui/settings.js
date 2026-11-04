/*
 * Settings screen (R6 / R9 / R12, A7).  Reachable from the pause menu (#btn-settings) and the title
 * screen (#btn-settings-title).  Big segmented controls + sliders, icon + ≤3 words, ≥44 px targets.
 * Every change -> state.setSetting(key, value) (persisted, emits settings:changed).
 * Keys: moveMode ('simple' | 'pro', first row), autoJump (touch only), breakMinutes (0 = off), helperMode, focusMode, reduceMotion, cameraSpeed (0.6/1/1.5),
 *       invertY, masterVolume ("Sound", 0..1), musicVolume (0..1), haptics (touch only).
 * Also applies html.reduce-motion (core/touch.js reads settings.haptics itself).
 * API: open(returnTo)
 */
export const NAME = 'settings';

const SEG = (key, icon, label, opts) => ({ type: 'seg', key, icon, label, opts });
const SLIDE = (key, icon, label) => ({ type: 'slide', key, icon, label });
const ROWS = isTouch => [
  { type: 'head', label: '🎮 Play' },
  SEG('moveMode', '🎮', 'Controls', [['simple', 'Simple'], ['pro', 'Pro']]),
  ...(isTouch ? [SEG('autoJump', '🦘', 'Auto-jump', [[true, 'On'], [false, 'Off']])] : []),
  SEG('helperMode', '🛟', 'Helper mode', [[true, 'On'], [false, 'Off']]),
  SEG('focusMode', '👁', 'Focus mode', [[false, 'Off'], [true, 'On']]),
  SEG('reduceMotion', '🌀', 'Reduce motion', [[false, 'Off'], [true, 'On']]),
  SEG('cameraSpeed', '🎥', 'Camera speed', [[0.6, 'Slow'], [1, 'Normal'], [1.5, 'Fast']]),
  SEG('invertY', '↕️', 'Invert camera', [[false, 'Off'], [true, 'On']]),
  { type: 'head', label: '🔊 Sound' },
  SLIDE('masterVolume', '🔊', 'Sound'),
  SLIDE('musicVolume', '🎵', 'Music'),
  ...(isTouch ? [SEG('haptics', '📳', 'Buzz', [[true, 'On'], [false, 'Off']])] : []),
  { type: 'head', label: '👪 Parents' },
  SEG('breakMinutes', '⏱', 'Session length', [[10, '10'], [15, '15'], [20, '20'], [30, '30'], [0, 'Off']]),
  SEG('freezeEnabled', '❄️', 'Freeze! game', [[true, 'On'], [false, 'Off']]),
];

const same = (a, b) => (typeof a === 'number' || typeof b === 'number') ? Math.abs(Number(a) - Number(b)) < 1e-6 : a === b;

export function init(ctx) {
  const { state, menus, events, isTouch } = ctx;

  // reduce motion: CSS hook (no bouncing UI) - prefers-reduced-motion is handled in style.css too
  const applyMotion = () => document.documentElement.classList.toggle('reduce-motion', !!state.settings.reduceMotion);
  applyMotion();
  events.on('settings:changed', p => { if (p.key === 'reduceMotion') applyMotion(); });


  const id = k => `set-${k}`;
  function rowHtml(r) {
    if (r.type === 'head') return `<h3 class="set-head">${r.label}</h3>`;
    const v = state.settings[r.key];
    if (r.type === 'seg') {
      return `<div class="set-row"><span class="set-label"><span aria-hidden="true">${r.icon}</span> ${r.label}</span>
        <div class="seg" role="radiogroup" aria-label="${r.label}" id="${id(r.key)}">${r.opts.map(([val, txt]) =>
          `<button class="seg-btn ${same(v, val) ? 'on' : ''}" role="radio" aria-checked="${same(v, val)}" data-v='${JSON.stringify(val)}'>${txt}</button>`).join('')}</div></div>`;
    }
    const pct = Math.round((Number(v) || 0) * 100);
    return `<div class="set-row"><span class="set-label"><span aria-hidden="true">${r.icon}</span> ${r.label}</span>
      <div class="slide"><input type="range" min="0" max="100" step="5" value="${pct}" id="${id(r.key)}" aria-label="${r.label}"><output>${pct}</output></div></div>`;
  }

  // column 1 = "Play", column 2 = "Sound" + "Parents" (stacked into one column on narrow screens)
  const columns = rows => { const i = rows.findIndex((r, j) => j > 0 && r.type === 'head'); return [rows.slice(0, i), rows.slice(i)]; };

  function open(ret) {
    const fromTitle = ret === menus.showTitle;
    const rows = ROWS(isTouch);
    menus.showCard(`<div class="menu settings" role="dialog" aria-label="Settings">
      <div class="set-top"><button id="btn-settings-back" class="btn" data-autofocus>◀ Back</button><h2>⚙ Settings</h2></div>
      <div class="set-list">${columns(rows).map(c => `<div class="set-col">${c.map(rowHtml).join('')}</div>`).join('')}</div>
    </div>`, { dim: !fromTitle, onBack: ret, screen: 'settings' });
    document.getElementById('btn-settings-back').addEventListener('click', () => ret());
    for (const r of rows) {
      if (r.type === 'seg') {
        const box = document.getElementById(id(r.key));
        box.addEventListener('click', e => {
          const b = e.target.closest('.seg-btn'); if (!b) return;
          const val = JSON.parse(b.dataset.v);
          for (const o of box.children) { const sel = o === b; o.classList.toggle('on', sel); o.setAttribute('aria-checked', String(sel)); }
          state.setSetting(r.key, val);
        });
      } else if (r.type === 'slide') {
        const inp = document.getElementById(id(r.key)), out = inp.nextElementSibling;
        inp.addEventListener('input', () => { out.textContent = inp.value; state.setSetting(r.key, Number(inp.value) / 100); });
        inp.addEventListener('pointerdown', e => e.stopPropagation());
      }
    }
  }

  menus.addPauseButton({ id: 'btn-settings', label: '⚙ Settings', onClick: () => open(menus.showPause) });
  menus.addTitleButton({ id: 'btn-settings-title', label: '⚙', aria: 'Settings', onClick: () => open(menus.showTitle) });

  return { open, rows: () => ROWS(isTouch).filter(r => r.key).map(r => r.key) };
}
