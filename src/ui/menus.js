/*
 * Title -> Play -> slot picker, pause menu, controls card.  Renders into #overlay.
 * Stable ids: #btn-play, #slot-1..#slot-3, #slot-clear-1..3, #btn-back, #btn-resume,
 * #btn-controls, #btn-save-stop.  Keyboard: Tab/Enter/Space; gamepad: d-pad + A/B via nav().
 * Other agents can add buttons with menus.addPauseButton({id,label,onClick}).
 */
const fmtTime = s => { const m = Math.floor(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

export function createMenus({ state, onPlay, onResume, onSaveStop, isTouch }) {
  const root = document.getElementById('overlay');
  let screen = null, back = null;
  const extraPause = [];

  function render(html, { dim = false, onBack = null } = {}) {
    root.innerHTML = html; root.classList.toggle('dim', dim); back = onBack;
    const first = root.querySelector('[data-autofocus]') || root.querySelector('button');
    if (first) try { first.focus({ preventScroll: true }); } catch (_) { first.focus(); }
  }
  const on = (id, fn) => { const b = document.getElementById(id); if (b) b.addEventListener('click', fn); };

  function showTitle(notice = '') {
    screen = 'title';
    render(`<div class="menu title" role="dialog" aria-label="Title">
      <h1>Star Hopper</h1>
      <p class="tag">★ Hop, bop and find stars! ★</p>
      ${notice ? `<p class="notice">${notice}</p>` : ''}
      <button id="btn-play" class="btn big" data-autofocus>▶ Play</button>
      <button id="btn-controls" class="btn">🎮 Controls</button>
    </div>`);
    on('btn-play', showSlots);
    on('btn-controls', () => showControls(showTitle));
  }

  function showSlots() {
    screen = 'slots';
    const slots = state.listSlots();
    render(`<div class="menu" role="dialog" aria-label="Pick a save">
      <h2>Pick a save</h2>
      ${slots.map(s => `<div class="slot-row">
        <button id="slot-${s.slot}" class="btn slot ${s.empty ? '' : 'primary'}" data-slot="${s.slot}" ${s.slot === 1 ? 'data-autofocus' : ''}>
          <span>Save ${s.slot}</span><span class="meta">${s.empty ? '✚ New game' : `★ ${s.stars} · ${fmtTime(s.playTime)}`}</span>
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
    screen = 'pause';
    render(`<div class="menu" role="dialog" aria-label="Paused">
      <h2>❚❚ Paused</h2>
      <button id="btn-resume" class="btn big" data-autofocus>▶ Keep playing</button>
      <button id="btn-controls" class="btn">🎮 Controls</button>
      <div id="pause-extra"></div>
      <button id="btn-save-stop" class="btn primary">💾 Save &amp; stop</button>
    </div>`, { dim: true, onBack: onResume });
    on('btn-resume', onResume);
    on('btn-controls', () => showControls(showPause));
    on('btn-save-stop', onSaveStop);
    const box = document.getElementById('pause-extra');
    for (const b of extraPause) {
      const el = document.createElement('button'); el.id = b.id; el.className = 'btn'; el.textContent = b.label;
      el.addEventListener('click', b.onClick); box.appendChild(el);
    }
  }

  function showControls(ret) {
    const fromTitle = screen === 'title';
    screen = 'controls';
    const touchRows = isTouch ? `<span class="h">Touch</span><span>Left thumb: move</span><span>Right: Jump / Long / Pound, drag to look</span>` : '';
    render(`<div class="menu" role="dialog" aria-label="Controls">
      <h2>🎮 Controls</h2>
      <div class="controls-grid">
        <span class="h"></span><span class="h">⌨ Keyboard</span><span class="h">🎮 Gamepad</span>
        <span>🏃 Move</span><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / arrows</span><span>Left stick</span>
        <span>⬆ Jump</span><span><kbd>Space</kbd></span><span>A</span>
        <span>➜ Long jump</span><span><kbd>Shift</kbd> + <kbd>Space</kbd></span><span>B</span>
        <span>⬇ Pound</span><span><kbd>E</kbd> / <kbd>X</kbd> in the air</span><span>X</span>
        <span>🎥 Camera</span><span><kbd>Q</kbd><kbd>E</kbd>, arrows, mouse drag</span><span>Right stick</span>
        <span>👁 Focus</span><span><kbd>F</kbd></span><span>View</span>
        <span>❚❚ Pause</span><span><kbd>Esc</kbd> / <kbd>P</kbd></span><span>Start</span>
        ${touchRows}
      </div>
      <button id="btn-back" class="btn" data-autofocus>◀ Back</button>
    </div>`, { dim: !fromTitle, onBack: ret });
    on('btn-back', ret);
  }

  function hide() { screen = null; root.innerHTML = ''; root.classList.remove('dim'); back = null; if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }

  // gamepad navigation (keyboard uses native Tab/Enter)
  function nav(n) {
    if (!screen) return;
    const btns = [...root.querySelectorAll('button')];
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
    showTitle, showSlots, showPause, showControls, hide, nav,
    get screen() { return screen; },
    addPauseButton(b) { extraPause.push(b); },
  };
}
