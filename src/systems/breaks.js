/*
 * Break timer (R8, A6).  Counts play time only while game.mode === 'playing' (never on the title,
 * in the pause menu or on a break card).  Length = settings.breakMinutes (10/15/20/30, 0 = off).
 *  - HUD ring (SVG): bottom-left.  Compact HUD (body.hud-compact, DESIGN.md §5.4): a 32 px ring with
 *    no text until the 5-minute warning (data-level amber / red), then it shows the minutes.
 *  - 5 min / 1 min left: toast + ui:warn {minutes} + ring colour green -> amber -> red.
 *  - 0: save('break'), pause, full-screen Stretch Break card (locked: Esc cannot skip it) with a
 *    60 s ring and 3 movement prompts (different set each break).  Before 60 s: only "Save & stop".
 *    After: "Play again" (timer restarts) + "Save & stop".  Emits break:start / break:end.
 * Debug API (window.__game.plugins.breaks): remaining(), debugSetRemaining(s), debugFinishStretch(),
 *   onBreak, stretchLeft()
 */
export const NAME = 'breaks';
const STRETCH_S = 60;
const PROMPTS = ['⭐ 10 star jumps', '🙆 Touch your toes 5 times', '🪟 Walk to the window and back', '👐 Shake out your arms',
  '🌬️ 5 big breaths', '🦩 Stand on one leg, count 10', '🔄 Roll your shoulders 5 times', '🐸 5 frog hops', '🙌 Reach up high 3 times'];
const WARN = [{ s: 300, minutes: 5, text: '5 minutes left. Finish this star!' }, { s: 60, minutes: 1, text: '1 minute left!' }];
const C = 2 * Math.PI * 26; // ring circumference (r = 26 in a 64 viewBox)
const GUARD_MS = 1000;       // the card ignores Enter / Space / gamepad A this long (a held jump key must not dismiss it)

const ringSvg = (cls, label) => `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true">
  <circle class="rb" cx="32" cy="32" r="26"/><circle class="rf" cx="32" cy="32" r="26" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="0" transform="rotate(-90 32 32)"/>
  </svg><span class="ring-num"></span>${label ? `<span class="ring-lbl">${label}</span>` : ''}`;

export function init(ctx) {
  const { events, state, game, api, menus, isTouch, hud } = ctx;
  let elapsed = 0, prevRem = Infinity, onBreak = false, stretch = 0, promptI = 0, prompts = [], shownAt = 0;
  const guarded = () => performance.now() - shownAt < GUARD_MS;
  // keyboard / gamepad "clicks" (detail 0: Enter, Space, menus.nav confirm) are dropped during the guard
  const guardClick = fn => e => { if (e && e.detail === 0 && guarded()) { e.preventDefault(); return; } fn(); };

  // ---- HUD ring ----
  const ring = document.createElement('div');
  ring.id = 'break-ring'; ring.className = `chip break-ring desk${isTouch ? ' touch' : ''}`;
  ring.setAttribute('role', 'timer'); ring.setAttribute('aria-label', 'Time left');
  ring.innerHTML = ringSvg('ring', 'min');
  document.getElementById('hud').appendChild(ring); // bottom-left everywhere (the left column stays short)
  const rf = ring.querySelector('.rf'), num = ring.querySelector('.ring-num');
  let lastDraw = '';

  const total = () => Math.max(0, Number(state.settings.breakMinutes) || 0) * 60;
  const remaining = () => (total() ? Math.max(0, total() - elapsed) : Infinity);

  function draw() {
    const T = total();
    ring.hidden = !T;
    if (!T) return;
    const rem = remaining();
    const lvl = rem <= 60 ? 'red' : rem <= 300 ? 'amber' : 'green';
    const txt = rem <= 60 ? `${Math.ceil(rem)}` : `${Math.ceil(rem / 60)}`;
    const key = `${lvl}|${txt}|${Math.round((rem / T) * 200)}`;
    if (key === lastDraw) return; lastDraw = key;
    ring.dataset.level = lvl;
    rf.setAttribute('stroke-dashoffset', (C * (1 - rem / T)).toFixed(2));
    num.textContent = txt;
    ring.querySelector('.ring-lbl').textContent = rem <= 60 ? 'sec' : 'min';
    ring.setAttribute('aria-label', rem <= 60 ? `${txt} seconds left` : `${txt} minutes left`);
  }

  function reset() { elapsed = 0; prevRem = remaining(); lastDraw = ''; draw(); }

  // ---- stretch break card ----
  function startBreak() {
    if (onBreak) return;
    onBreak = true; stretch = STRETCH_S; promptI = 0;
    if (state.data) {
      const n = state.data.breakCount = (state.data.breakCount || 0) + 1;
      const start = ((n - 1) * 3) % PROMPTS.length;
      prompts = [0, 1, 2].map(i => PROMPTS[(start + i) % PROMPTS.length]);
    } else prompts = PROMPTS.slice(0, 3);
    state.save('break');
    api.pause();
    menus.showCard(`<div class="menu stretch" role="dialog" aria-label="Stretch break">
      <h2>🤸 Stretch break!</h2>
      <div class="stretch-body">
        <div class="stretch-ring">${ringSvg('ring big', 'sec')}</div>
        <ol class="stretch-list">${prompts.map((p, i) => `<li class="${i === 0 ? 'cur' : ''}">${p}</li>`).join('')}</ol>
      </div>
      <div class="stretch-btns">
        <button id="btn-break-play" class="btn big" hidden>▶ Play again</button>
        <button id="btn-break-stop" class="btn primary">💾 Save &amp; stop</button>
      </div>
    </div>`, { dim: true, locked: true, screen: 'stretch', onBack: null });
    shownAt = performance.now();
    // nothing is auto-focused (menus.render would focus the first button: Play again is hidden, so
    // focus stays off the buttons); a stray Enter / Space / A cannot press "Save & stop"
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    document.getElementById('btn-break-play').addEventListener('click', guardClick(() => endBreak('play')));
    document.getElementById('btn-break-stop').addEventListener('click', guardClick(() => endBreak('stop')));
    drawStretch();
    events.emit('break:start', { minutes: total() / 60, prompts: [...prompts] });
  }
  function drawStretch() {
    const card = document.querySelector('#overlay .stretch'); if (!card) return;
    const f = card.querySelector('.rf'), n = card.querySelector('.ring-num');
    f.setAttribute('stroke-dashoffset', stretch > 0 ? (C * (1 - stretch / STRETCH_S)).toFixed(2) : '0'); // full ring = done
    n.textContent = stretch > 0 ? `${Math.ceil(stretch)}` : '✔';
    card.querySelector('.ring-lbl').textContent = stretch > 0 ? 'sec' : 'done';
    const pi = Math.min(2, Math.floor((STRETCH_S - stretch) / (STRETCH_S / 3)));
    if (pi !== promptI) { promptI = pi; card.querySelectorAll('.stretch-list li').forEach((li, i) => li.classList.toggle('cur', i === pi)); }
    const play = document.getElementById('btn-break-play');
    if (stretch <= 0 && play.hidden) {
      play.hidden = false; card.classList.add('done');
      try { play.focus({ preventScroll: true }); } catch (_) { play.focus(); }
    }
  }
  function endBreak(action) {
    if (!onBreak) return;
    onBreak = false;
    events.emit('break:end', { action });
    if (action === 'play') { reset(); menus.hide(); api.resume(); } else api.saveAndStop();
  }

  // ---- loop ----
  let lastNow = performance.now();
  events.on('tick', () => {
    const now = performance.now(), dt = Math.min(1, (now - lastNow) / 1000); lastNow = now; // wall-clock, not frame-clamped
    if (onBreak) {
      if (stretch > 0) { stretch = Math.max(0, stretch - dt); drawStretch(); }
      return;
    }
    const tutorialUp = !!(ctx.touch && ctx.touch.tutorialOpen); // "How to move" overlay = a locked card
    if (game.mode !== 'playing' || !state.data || !total() || tutorialUp) { draw(); return; }
    elapsed += dt * (game.timeScale ?? 1);
    const rem = remaining();
    for (const w of WARN) if (prevRem > w.s && rem <= w.s && rem > 0) {
      hud.toast(w.text, 3200);
      events.emit('ui:warn', { minutes: w.minutes, text: w.text });
      ring.classList.remove('flash'); void ring.offsetWidth; ring.classList.add('flash');
    }
    prevRem = rem;
    draw();
    if (rem <= 0) startBreak();
  });
  events.on('game:start', reset);
  events.on('game:stop', () => { onBreak = false; reset(); });
  events.on('settings:changed', p => { if (p.key === 'breakMinutes') { prevRem = remaining(); lastDraw = ''; draw(); } });
  draw();

  return {
    remaining,
    get onBreak() { return onBreak; },
    stretchLeft: () => stretch,
    debugSetRemaining(s) {
      if (!total()) state.settings.breakMinutes = 20; // debug only: not persisted
      elapsed = Math.max(0, total() - Number(s)); prevRem = Number(s); lastDraw = ''; draw();
      return remaining();
    },
    debugFinishStretch() { stretch = 0; drawStretch(); },
  };
}
