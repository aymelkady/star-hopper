# Star Hopper — design brief

An original, browser-based 3D collect-a-thon platformer in the spirit of *Super Mario 64*,
built for 10-year-olds with ADHD. No Nintendo characters, names, music or assets are used.
Everything is procedural geometry + WebAudio so there are no downloads and no loading screens.

## 1. Who it is for, and what that changes

Evidence used (abstract-level, Nov 2026):
- Children with ADHD stay engaged when the next goal is always obvious, progress is visible,
  feedback is immediate, and difficulty keeps rising in small steps. Open-ended wandering and
  long text kill engagement. (2025 systematic reviews of serious games for ADHD; Xbox
  Accessibility Guideline 109 "Objective clarity"; XAG 114 "time to read".)
- Parents are advised to use visual timers, give countdown warnings before stopping, and let the
  child save before time is up. Shorter, more frequent sessions work better than long ones.
  (CHADD column; parent guidance 2021-2025.)
- Frustration is the #1 reported side effect of attention-training games (EndeavorRx trials),
  so failure must be cheap and recovery instant.

Design consequences (these are hard requirements, not nice-to-haves):

| # | Requirement | Implementation |
|---|-------------|----------------|
| R1 | **Exactly one current objective** visible at all times | Top-centre quest card: icon + ≤6 words. A glowing beacon column + a 3D arrow near the player point to it. |
| R2 | **Visible progress at three scales** | Coins → next bonus star (ring fills), stars in this zone (x/4), total stars (x/12). |
| R3 | **Short loops** | Each star is 1–3 minutes. Hub → zone → star → celebration → next objective, no load screens. |
| R4 | **Immediate, generous feedback** | Every pickup: sound + particles + HUD pulse within one frame. Star: 2.5 s celebration, then auto-advance objective. |
| R5 | **Failure is free** | No lives, no game-over, no score loss. Fall = fade, respawn at last checkpoint in <1 s, coins kept. Enemies bounce you back; 3 bonks = respawn at checkpoint. |
| R6 | **Helper mode on by default** | Coyote time 0.15 s, jump buffer 0.15 s, coin magnet 2.5 m, ledge forgiveness, camera auto-follow. Can be turned off in Settings ("Pro mode"). |
| R7 | **Focus mode (toggle F)** | Dims everything except player, path and current objective; disables background animation and ambient particles; lowers music. |
| R8 | **Break timer** | Visual ring in the corner. Default 20 min; parent-settable 10/15/20/30. Soft warnings at 5 min and 1 min ("2 more stars then break?" style), then a full-screen "Stretch break" card with 3 movement prompts and a 60 s ring. Auto-saves first. Child can always "Save & stop". |
| R9 | **Readable UI** | Min 20 px text, high contrast, icon + text, no paragraphs ever, pause anytime, nothing times out while reading. |
| R10 | **Low button count** | Move + Jump + Action + Camera. Gamepad supported. Controls card accessible from pause. |
| R11 | **No dark patterns** | No streaks, no daily-login nags, no countdown pressure except the optional "Ghost race" stars. |
| R12 | **Persistence** | Auto-save to localStorage on every star/checkpoint/settings change. Three save slots. |

## 2. Game content

**Hero:** Pip, a round little fox-bot (sphere body, cone ears, capsule limbs, big eyes). Squash-and-stretch on jump/land.
**World:** one continuous scene, ~200×200 m. A central **Treehouse Hub** with three paths:

| Zone | Theme | Stars (4 each) | Teaches |
|------|-------|----------------|---------|
| Sunny Meadow | grass, hills, bouncy mushrooms | 1 Reach the hilltop flag · 2 Collect 8 red coins · 3 Bonk the 3 Grumbles · 4 Secret: behind the waterfall | run, jump, double jump, ground pound |
| Splash Cove | beach, floating logs, moving platforms | 1 Cross the log ride · 2 Light 5 lanterns (ground pound switches) · 3 Red coins on the rocks · 4 Race the Ghost (optional timer) | long jump, moving platforms, timing |
| Sky Towers | tall pillars, wind, narrow paths | 1 Climb to the bell · 2 Triple-jump the gap · 3 Red coins up the spiral · 4 Ring all 4 chimes in a row | triple jump, precision, sequencing |

Plus **3 bonus stars**: 100 coins in any zone (counter resets per zone). Total: 15 stars. Stars never "lock" a zone; zone 2 and 3 are suggested after 2 and 5 stars (gentle gating via "recommended" highlight, never a wall).

**Today's Quest:** on start, the game proposes 3 stars (next uncollected, mixed zones). Finishing all 3 gives a big confetti moment and the message "Great session! Stop here or keep going?" This gives a natural end point.

**Enemies:** Grumble (slow patrol box with eyes). Touch from side = bounce back + brief stun of enemy. Jump on top or ground pound = pop (coins). No projectiles in v1.

**Moveset (Mario-64-like, original tuning):**
- Run: accel 40 m/s², top 9 m/s, turn-in-place under 2 m/s.
- Jump (Space / A): 3-tier combo if jumped within 0.3 s of landing with speed > 4 m/s: 5 → 6.3 → 8.5 m apex. Variable height (release early = shorter).
- Long jump (Shift+Space or crouch+jump while running / B): low arc, 1.7× horizontal distance.
- Ground pound (Space again in air? no — E / X in air): fast drop, hits switches, pops enemies, small shockwave.
- Wall kick: touching a wall in air + jump within 0.2 s.
- Coyote time + jump buffer per R6.

**Camera:** third-person follow, 6 m behind, 2.5 m up, smooth damped; auto-rotates toward movement direction after 1 s with no camera input; Q/E or right stick/mouse-drag to orbit; raycast pull-in when a wall is between camera and Pip; always framed so the beacon stays in a readable spot.

## 3. Architecture (what the coding agents build)

```
games/star-hopper/
  index.html            dev entry (ES modules, served over http)
  src/
    main.js             boot, game loop, scene, event wiring
    core/events.js      tiny pub/sub bus: on(type, fn), emit(type, payload)
    core/input.js       keyboard + gamepad → abstract actions {move:{x,y}, jump, action, cam:{x,y}, pause, focus}
    core/state.js       save/load (localStorage), settings, slots
    player/pip.js       mesh + animation (procedural)
    player/controller.js physics/moveset (kinematic capsule vs. world colliders)
    world/world.js      builds hub + zones from zone modules, registers colliders/triggers
    world/zones/*.js    meadow.js, cove.js, towers.js (each exports build(ctx) returning {stars, spawns, checkpoints})
    world/props.js      coin, redCoin, star, checkpoint, switch, platform (moving), mushroom, grumble
    systems/objectives.js quest card, beacon/arrow, today's quest, auto-advance
    systems/breaks.js   break timer + stretch screen
    systems/focus.js    focus mode
    systems/fx.js       particles, squash/stretch helpers, celebration
    audio/audio.js      WebAudio procedural SFX + simple looped music, master volume, music volume
    ui/hud.js, ui/menus.js, ui/settings.js  DOM overlay (not canvas)
    style.css
  vendor/three.module.js, three.core.js (r187, MIT)
  build.mjs             esbuild → dist/star-hopper.html (single self-contained file)
  test/smoke.spec.mjs   Playwright: loads dist, no console errors, moves, jumps, collects a coin and a star via test hooks
  README.md             how to play, parent guide, controls, dev commands
```

Rules for all agents:
- Vanilla JS ES modules, no framework, no TypeScript, no asset files. Three.js r187 from `vendor/`.
- Physics is hand-rolled: capsule vs. AABB/OBB boxes and spheres is enough. No cannon/ammo.
- `window.__game` exposes `{player, state, events, teleport(x,y,z), collect(id)}` for tests only.
- Everything must run at 60 fps on an integrated GPU: < 300 draw calls, merged static geometry, shadow map ≤ 2048, no post-processing.
- DOM UI, not canvas text. Font: system sans, min 20 px. Colours tested against WCAG AA.
- Target: Chrome/Edge/Firefox desktop + Chromebook. Keyboard + gamepad. Touch is out of scope for v1.
- No external network calls at runtime. No analytics.

## 4. Acceptance criteria (the audit checks these)

A1 `npm run build` produces `dist/star-hopper.html` < 4 MB that opens from file:// with zero console errors.
A2 Smoke test passes headless: start → new game → Pip moves and jumps → collects a coin → collects a star → quest card advances → save persists after reload.
A3 From a fresh start a 10-year-old can get the first star in under 2 minutes with only the on-screen hints (no README).
A4 At every moment during play exactly one quest card is visible and a beacon/arrow points to it.
A5 Falling off the world returns the player to the last checkpoint within 1 s with coins kept.
A6 Focus mode visibly reduces clutter; break timer warnings fire at 5 min and 1 min; stretch screen appears; Save & stop works.
A7 All settings persist across reload. Three save slots work.
A8 Gamepad: left stick move, A jump, B long jump, X ground pound, right stick camera, Start pause.
A9 No Nintendo IP: no "Mario", "Peach", "Bowser", "Goomba", "Power Star", mushroom-kingdom music, or 1-up sounds.
A10 README contains a one-page parent guide.
