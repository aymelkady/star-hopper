/*
 * Freeze! (impulse control).  While exploring, 2-3 times per session at random 3-6 min gaps:
 * a whistle + a big snowflake card "Freeze! / Stand still".  After a 0.8 s "get ready" beat a 2 s
 * ring fills; if Pip's ground speed stays < 0.3 m/s the whole time -> coin shower (+5 coins).
 * If he moves -> "Whoops! / Next time" and nothing is lost.  settings.freezeEnabled is read live.
 * Never fires inside a challenge, during celebrations / respawns / races, or in the hub during the
 * first 60 s of a session.
 */
const READY = 0.8, HOLD = 2, SHOW_END = 1.4, STILL = 0.3, COINS = 5;
const GAP = () => 180 + Math.random() * 180;

export function createFreeze(kit) {
  const { events, state, ctrl, ui } = kit;
  let phase = 'idle', t = 0, left = 0, next = GAP(), playT = 0, startT = 0;

  function start() {
    phase = 'ready'; t = 0; startT = performance.now();
    events.emit('freeze:start', {});
    kit.sfx('warn');
    ui.freeze('ready', 0);
    return true;
  }
  function end(ok) {
    phase = 'show'; t = 0;
    const p = kit.pip();
    if (ok) {
      const zone = kit.zone();
      kit.P.giftCoins(COINS, zone);
      events.emit('freeze:success', { coins: COINS, zone });
      events.emit('ui:celebrate', { kind: 'coin100', reason: 'freeze' }); // coin jingle + confetti rain
      kit.burst({ x: p.x, y: p.y + 2.5, z: p.z, count: 40, color: [0xffe14a, 0xfff3a0, 0xffc020], speed: 5, up: 4, life: 0.9, gravity: -9, size: 0.26 });
      kit.record('freeze', true, Math.round(performance.now() - startT));
      kit.addMeter(8);
    } else {
      events.emit('freeze:fail', {});
      kit.sfx('hurt');
      kit.record('freeze', false, 0);
    }
    ui.freeze(ok ? 'ok' : 'oops', ok ? 1 : 0);
  }

  return {
    get active() { return phase !== 'idle'; },
    get phase() { return phase; },
    get next() { return next - playT; },
    session() { left = Math.random() < 0.5 ? 2 : 3; playT = 0; next = GAP(); phase = 'idle'; ui.freeze(null); },
    trigger() { if (!state.settings.freezeEnabled || phase !== 'idle') return false; return start(); },
    stop() { phase = 'idle'; ui.freeze(null); },
    // dt = game time (schedule), rdt = wall-clock time (the card + 2 s ring are real seconds for the child)
    update(dt, rdt, eligible) {
      playT += dt;
      if (phase === 'idle') {
        if (left > 0 && playT >= next && state.settings.freezeEnabled !== false && eligible(playT)) { left--; next = playT + GAP(); start(); }
        return;
      }
      if (!state.settings.freezeEnabled && phase !== 'show') { this.stop(); return; } // switched off mid-card
      t += rdt;
      const v = Math.hypot(ctrl.velocity.x, ctrl.velocity.z);
      if (phase === 'ready') { if (t >= READY) { phase = 'hold'; t = 0; } }
      else if (phase === 'hold') {
        ui.freeze('hold', t / HOLD);
        if (v >= STILL) end(false);
        else if (t >= HOLD) end(true);
      } else if (phase === 'show' && t >= SHOW_END) this.stop();
    },
  };
}
