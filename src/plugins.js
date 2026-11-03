/*
 * Plugin entry point.  main.js calls initPlugins(ctx) once at boot, after every core object
 * exists but before the title screen is shown.  Each plugin exports init(ctx) and wires itself
 * up through ctx.events; nothing in the core imports a plugin directly.
 *
 * ctx = { THREE, scene, camera, renderer, webgl, events, state, world, ctrl, pip, rig, hud, menus,
 *         game, input, touch, isTouch, api: { pause, resume, saveAndStop, startGame, beginRespawn } }
 */
import * as objectives from './systems/objectives.js';
import * as breaks from './systems/breaks.js';
import * as focus from './systems/focus.js';
import * as settings from './ui/settings.js';
import * as fx from './systems/fx.js';
import * as audio from './audio/audio.js';
import * as focusplay from './systems/focusplay.js'; // focus-play (after objectives: it reads its API lazily)

const PLUGINS = [objectives, breaks, focus, settings, fx, audio, focusplay];

export function initPlugins(ctx) {
  const out = {};
  for (const p of PLUGINS) {
    try { out[p.NAME || 'plugin'] = p.init ? p.init(ctx) : null; }
    catch (err) { console.error('[star-hopper] plugin failed:', p.NAME, err); }
  }
  return out;
}
