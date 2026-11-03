/*
 * Title (Continue + 3 save tiles) -> Play -> slot picker, pause menu, controls card.  Renders into
 * #overlay.  Stable ids: #btn-play, #btn-continue, #title-slot-1..3, #slot-1..#slot-3,
 * #slot-clear-1..3, #btn-back, #btn-resume, #btn-controls, #btn-save-stop.
 * Keyboard: Tab/Enter/Space; gamepad: d-pad + A/B via nav().
 * Extension points for plugins:
 *   menus.addPauseButton({id,label,onClick})   extra button in the pause menu
 *   menus.addTitleButton({id,label,onClick})   small extra button on the title screen
 *   menus.showCard(html, {dim, onBack, locked, screen})  any custom screen; locked = the game must
 *                                              not resume from it (Esc / pause button ignored)
 */
const fmtTime = s => { const m = Math.floor(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

export const PIP_ICON = `<svg class="pip-ico" viewBox="0 0 40 40" aria-hidden="true"><path d="M8 14 L11 2 L18 10 Z M32 14 L29 2 L22 10 Z" fill="#ff8a1f" stroke="#1d1530" stroke-width="2" stroke-linejoin="round"/><circle cx="20" cy="22" r="15" fill="#ff8a1f" stroke="#1d1530" stroke-width="2.5"/><ellipse cx="20" cy="28" rx="9" ry="6" fill="#fff1d6"/><circle cx="14.5" cy="20" r="4" fill="#fff"/><circle cx="25.5" cy="20" r="4" fill="#fff"/><circle cx="15" cy="20.5" r="2.2" fill="#2b2340"/><circle cx="25" cy="20.5" r="2.2" fill="#2b2340"/><circle cx="20" cy="26" r="1.6" fill="#2b2340"/></svg>`;

// Exact mapping, kept in sync with docs/PARENT-GUIDE.md and README.md.
const CONTROLS = [
  // [label, touch, keyboard, gamepad]
  ['🏃 Move', 'Left thumb: stick', '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / arrows', 'Left stick'],
  ['⬆ Jump', 'Green <b>Jump</b>', '<kbd>Space</kbd>', 'A'],
  ['➜ Long jump', 'Red <b>Long</b>', '<kbd>Shift</kbd> + <kbd>Space</kbd>', 'B'],
  ['⬇ Pound', 'Blue <b>Pound</b> (in air)', '<kbd>E</kbd> / <kbd>X</kbd> in air', 'X'],
  ['🎥 Camera', 'Drag right side', '<kbd>Q</kbd> <kbd>E</kbd> / mouse drag', 'Right stick'],
  ['👁 Focus', 'Eye button', '<kbd>F</kbd>', 'Back'],
  ['❚❚ Pause', 'Pause button', '<kbd>Esc</kbd>', 'Start'],
  ['⏭ Skip goal', 'Quest card: Skip', '<kbd>Tab</kbd>', 'Pause menu'],
];

export function createMenus({ state, onPlay, onResume, onSaveStop, isTouch }) {
  const root = document.getElementById('overlay');
  let screen = null, back = null, locked = false;
  const extraPause = [], extraTitle = [];

  function render(html, { dim = false, onBack = null } = {}) {
    root.innerHTML = html; root.classList.toggle('dim', dim); back = onBack;
    const first = root.querySelector('[data-autofocus]') || root.querySelector('button');
    if (first) try { first.focus({ preventScroll: true }); } catch (_) { first.focus(); }
  }
  const on = (id, fn) => { const b = document.getElementById(id); if (b) b.addEventListener('click', fn); };
  const addButtons = (boxId, list, cls) => {
    const box = document.getElementById(boxId); if (!box) return;
    for (const b of list) {
      const el = document.createElement('button'); el.id = b.id; el.className = cls; el.textContent = b.label; if (b.aria) el.setAttribute('aria-label', b.aria);
      el.addEventListener('click', b.onClick); box.appendChild(el);
    }
  };

  function showTitle(notice = '') {
    screen = 'title'; locked = false;
    const slots = state.listSlots();
    const played = slots.filter(s => !s.empty).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const cont = played[0];
    render(`<div class="menu title" role="dialog" aria-label="Title">
      <div class="title-head">
        <h1>Star Hopper</h1>
        <p class="tag">★ Hop, bop and find stars! ★</p>
        ${notice ? `<p class="notice">${notice}</p>` : ''}
      </div>
      <div class="title-body">
        ${cont ? `<button id="btn-continue" class="btn big" data-autofocus>▶ Continue <span class="meta">Save ${cont.slot} · ★ ${cont.stars}</span></button>` : ''}
        <div class="slot-tiles">${slots.map(s => `<button id="title-slot-${s.slot}" class="tile ${s.empty ? 'empty' : ''}" aria-label="Save ${s.slot}${s.empty ? ', new game' : `, ${s.stars} stars`}">
          ${PIP_ICON}<span class="tile-name">Save ${s.slot}</span><span class="tile-meta">${s.empty ? '✚ New' : `<b class="star">★</b> ${s.stars}`}</span></button>`).join('')}</div>
        <div class="title-row">
          <button id="btn-play" class="btn ${cont ? '' : 'big'}" ${cont ? '' : 'data-autofocus'}>${cont ? '📂 Saves' : '▶ Play'}</button>
          <button id="btn-controls" class="btn">🎮 Controls</button>
          <span id="title-extra" class="title-extra"></span>
        </div>
      </div>
    </div>`);
    if (cont) on('btn-continue', () => onPlay(cont.slot));
    for (const s of slots) on(`title-slot-${s.slot}`, () => onPlay(s.slot));
    on('btn-play', showSlots);
    on('btn-controls', () => showControls(showTitle));
    addButtons('title-extra', extraTitle, 'btn icon-only');
  }

  function showSlots() {
    screen = 'slots';
    const slots = state.listSlots();
    render(`<div class="menu" role="dialog" aria-label="Pick a save">
      <h2>Pick a save</h2>
      ${slots.map(s => `<div class="slot-row">
        <button id="slot-${s.slot}" class="btn slot ${s.empty ? '' : 'primary'}" data-slot="${s.slot}" ${s.slot === 1 ? 'data-autofocus' : ''}>
          ${PIP_ICON}<span class="slot-text"><span>Save ${s.slot}</span><span class="meta">${s.empty ? '✚ New game' : `★ ${s.stars} · ${fmtTime(s.playTime)}`}</span></span>
        </button>
        ${s.empty ? '' : `<button id="slot-clear-${s.slot}" class="btn small" aria-label="Clear save ${s.slot}">🗑 Clear</button>`}
      </div>`).join('')}
      <button id="btn-back" class="btn">◀ Back</button>
    </div>`, { onBack: showTitle });
    for (const s of slots) {
      on(`slot-${s.slot}`, () => onPlay(s.slot));
      on(`slot-clear-${s.slot}`, e => {
        const b = e.currentTarget;
        if (b.dataset.sure) { state.clearSlot(s.slot); showSlots(); }
        else { b.dataset.sure = '1'; b.textContent = 'Sure?'; }
      });
    }
    on('btn-back', showTitle);
  }

  function showPause() {
    screen = 'pause'; locked = false;
    render(`<div class="menu pause" role="dialog" aria-label="Paused">
      <h2>❚❚ Paused</h2>
      <button id="btn-resume" class="btn big" data-autofocus>▶ Keep playing</button>
      <div id="pause-extra" class="pause-grid"><button id="btn-controls" class="btn">🎮 Controls</button></div>
      <button id="btn-save-stop" class="btn primary">💾 Save &amp; stop</button>
    </div>`, { dim: true, onBack: onResume });
    on('btn-resume', onResume);
    on('btn-controls', () => showControls(showPause));
    on('btn-save-stop', onSaveStop);
    addButtons('pause-extra', extraPause, 'btn');
  }

  function showControls(ret) {
    const fromTitle = screen === 'title';
    screen = 'controls';
    const cols = isTouch ? ['👆 Touch'] : ['⌨ Keyboard', '🎮 Gamepad'];
    const cells = r => (isTouch ? [r[1]] : [r[2], r[3]]).map(c => `<span>${c}</span>`).join('');
    render(`<div class="menu controls" role="dialog" aria-label="Controls">
      <h2>🎮 Controls</h2>
      <div class="controls-grid ${isTouch ? 'touch' : ''}">
        <span class="h"></span>${cols.map(c => `<span class="h">${c}</span>`).join('')}
        ${CONTROLS.map(r => `<span class="act">${r[0]}</span>${cells(r)}`).join('')}
      </div>
      <button id="btn-back" class="btn" data-autofocus>◀ Back</button>
    </div>`, { dim: !fromTitle, onBack: ret });
    on('btn-back', ret);
  }

  function showCard(html, { dim = true, onBack = null, locked: lock = false, screen: name = 'card' } = {}) {
    screen = name; locked = !!lock;
    render(html, { dim, onBack });
    return root;
  }

  function hide() { screen = null; locked = false; root.innerHTML = ''; root.classList.remove('dim'); back = null; if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }

  // gamepad navigation (keyboard uses native Tab/Enter)
  function nav(n) {
    if (!screen) return;
    const btns = [...root.querySelectorAll('button, input')].filter(b => !b.disabled);
    if (!btns.length) return;
    let i = btns.indexOf(document.activeElement);
    if (n.down || n.right) i = (i + 1) % btns.length;
    else if (n.up || n.left) i = (i - 1 + btns.length) % btns.length;
    else if (n.confirm && i >= 0) { btns[i].click(); return; }
    else if (n.back && back) { back(); return; }
    else return;
    btns[Math.max(0, i)].focus();
  }

  return {
    showTitle, showSlots, showPause, showControls, showCard, hide, nav,
    get screen() { return screen; },
    get locked() { return locked; },
    addPauseButton(b) { extraPause.push(b); },
    addTitleButton(b) { extraTitle.push(b); },
  };
}
