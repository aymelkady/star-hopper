/*
 * Focus mode (R7).  Toggled by input:focus (F / gamepad Back / eye button) and by Settings;
 * persisted as settings.focusMode.  When on (and a game is running):
 *   world.setStill(true) (no background animation / ambient particles), denser fog + softer
 *   lights, a dark vignette (#focus-vignette, pointer-events:none), non-essential HUD chips hidden
 *   (body.focus-on; stars + quest card stay), beacon halo (objectives listens), #btn-focus.active.
 * Emits focus:changed {on} whenever the effective state changes (audio lowers the music).
 * API: isOn(), toggle(), set(on)
 */
export const NAME = 'focus';

export function init(ctx) {
  const { events, state, world, scene, hud } = ctx;
  const btn = document.getElementById('btn-focus');
  const vig = document.getElementById('focus-vignette');
  const base = { hemi: world.hemi.intensity, sun: world.sun.intensity, near: scene.fog ? scene.fog.near : 0, far: scene.fog ? scene.fog.far : 0, density: scene.fog ? scene.fog.density : 0 };
  let playing = false, on = null;

  function apply(want) {
    if (want === on) return;
    on = want;
    world.setStill(on);
    world.hemi.intensity = base.hemi * (on ? 0.72 : 1);
    world.sun.intensity = base.sun * (on ? 0.85 : 1);
    const fog = scene.fog;
    if (fog && fog.isFogExp2) fog.density = base.density * (on ? 2.2 : 1);
    else if (fog) { fog.near = on ? Math.min(30, base.near) : base.near; fog.far = on ? Math.min(140, base.far) : base.far; }
    if (vig) vig.classList.toggle('on', on);
    document.body.classList.toggle('focus-on', on);
    if (btn) { btn.classList.toggle('active', on); btn.setAttribute('aria-pressed', String(on)); }
    events.emit('focus:changed', { on });
  }
  const sync = () => apply(playing && !!state.settings.focusMode);
  const set = v => { if (!!state.settings.focusMode !== !!v) state.setSetting('focusMode', !!v); else sync(); };
  const toggle = () => set(!state.settings.focusMode);

  events.on('input:focus', () => {
    toggle();
    if (playing) hud.toast(state.settings.focusMode ? '👁 Focus mode on' : '👁 Focus mode off', 1200);
  });
  events.on('settings:changed', p => { if (p.key === 'focusMode') sync(); });
  events.on('game:start', () => { playing = true; sync(); });
  events.on('game:stop', () => { playing = false; sync(); });
  if (btn) btn.setAttribute('aria-pressed', 'false');
  on = false;

  return { isOn: () => !!on, toggle, set };
}
