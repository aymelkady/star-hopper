/*
 * Tiny pub/sub bus shared by every system.  API: on(type, fn) -> unsubscribe fn,
 * off(type, fn), once(type, fn), emit(type, payload).  on('*', fn) receives (type, payload).
 * events.log keeps the last 200 events (except 'tick') as {t, type, payload} for tests/debug.
 *
 * EVENTS EMITTED BY THE CORE (payloads in braces):
 *   game:start        {slot}                      a save slot was opened and play began
 *   game:pause        {}                          pause menu opened (also on tab hidden)
 *   game:resume       {}
 *   game:stop         {slot}                      "Save & stop" -> back to title
 *   player:jump       {tier, x,y,z}               tier 1..3 (3 = triple jump)
 *   player:land       {fallSpeed, tier, x,y,z}
 *   player:longjump   {x,y,z}
 *   player:groundpound{x,y,z, radius}            on impact (shockwave)
 *   player:poundstart {x,y,z}                     spin at the start of a ground pound
 *   player:wallkick   {x,y,z}
 *   player:bounce     {x,y,z, apex}               mushroom / enemy stomp bounce
 *   player:hurt       {bonks, max, x,y,z}
 *   player:respawn    {reason:'fall'|'water'|'bonk'|'manual', checkpoint}
 *   pickup:coin       {id, value, total, zone, zoneCoins}
 *   pickup:redcoin    {id, starId, index, count, total}   total is always 8
 *   pickup:star       {id, zone, name, bonus}
 *   star:revealed     {id, zone, name, x,y,z}     a hidden star popped out (task done)
 *   checkpoint:reached{id, zone, x,y,z}
 *   switch:pressed    {id, zone}
 *   lantern:lit       {id, count, total}
 *   chime:ring        {index, correct, next}
 *   bell:ring         {}
 *   race:start        {target}                    ghost race started (seconds)
 *   race:tick         {remaining}                 once per second during a race
 *   race:end          {won, time}
 *   enemy:popped      {id, zone, x,y,z, count, total}
 *   zone:enter        {zone, name}               'hub'|'meadow'|'cove'|'towers'
 *   settings:changed  {key, value, settings}
 *   save:written      {slot, reason}
 *   input:focus       {}                          F / gamepad Back pressed (focus mode toggle)
 *   ui:toast          {text}                      ask the HUD to show a short popup
 *   tick              {dt, t}                     once per rendered frame (dt in s, unscaled)
 *
 * UI / SYSTEMS EVENTS (emitted by systems/* and ui/*; audio + fx subscribe):
 *   objective:changed {starId, name, zone, target:{x,y,z}|null}   the ONE current goal changed
 *                                                 (systems/objectives.js is the only emitter;
 *                                                 starId null = all stars found)
 *   objective:skipped {starId, next}              player skipped a goal (Skip ›, Tab, pause menu)
 *   ui:celebrate      {kind:'star', id, name, count, total}  star celebration card (2.5 s)
 *                     {kind:'quest', count, total}           Today's Quest done ("Great session!")
 *   ui:warn           {minutes, text}             break timer: minutes = 5 or 1 left
 *   break:start       {minutes, prompts:[...]}    stretch-break card shown (game paused + saved)
 *   break:end         {action:'play'|'stop'}      stretch break finished
 *   focus:changed     {on}                        focus mode effective state (lower music when on)
 *   settings:changed  (see above) keys set by ui/settings.js: breakMinutes, helperMode, focusMode,
 *                     reduceMotion, cameraSpeed, invertY, masterVolume ("Sound"), musicVolume, haptics
 */
export function createEvents() {
  const map = new Map();
  const log = [];
  const t0 = performance.now();

  function on(type, fn) {
    if (!map.has(type)) map.set(type, new Set());
    map.get(type).add(fn);
    return () => off(type, fn);
  }
  function off(type, fn) {
    const s = map.get(type);
    if (s) s.delete(fn);
  }
  function once(type, fn) {
    const wrap = (p, t) => { off(type, wrap); fn(p, t); };
    return on(type, wrap);
  }
  function call(fn, a, b) {
    try { fn(a, b); } catch (err) { console.error('[events] listener failed for', a, err); }
  }
  function emit(type, payload = {}) {
    if (type !== 'tick') {
      log.push({ t: Math.round(performance.now() - t0), type, payload });
      if (log.length > 200) log.shift();
    }
    const s = map.get(type);
    if (s) for (const fn of [...s]) call(fn, payload, type);
    const all = map.get('*');
    if (all) for (const fn of [...all]) call(fn, type, payload);
  }
  return { on, off, once, emit, log };
}
