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
| R10 | **Low button count** | Move + Jump + Action + Camera. Touch (iPad/Android), keyboard and gamepad all supported. Controls card accessible from pause. |
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
- Target platforms, all first-class: **iPad (Safari 17+), Android phones/tablets (Chrome)**, Chromebook, desktop Chrome/Edge/Firefox. Input: touch, keyboard, gamepad.
- Mobile rules: `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">`, `touch-action:none` on the canvas and HUD, no pointer lock, no hover-only UI, safe-area insets respected, landscape encouraged (portrait shows a friendly "turn your tablet" card but still works). Pixel ratio capped at 1.5 on mobile and shadow map 1024 on mobile; target 60 fps on a 2020 iPad / mid-range Android, never below 30. AudioContext created/resumed only inside the first touch/click handler (iOS requirement). All controls reachable with two thumbs: left virtual joystick (dynamic origin where the thumb lands), right side buttons Jump / Pound / Long-jump, camera by dragging anywhere on the right half that is not a button. Buttons ≥ 64 px, 12 px apart, semi-transparent, with haptic `navigator.vibrate(10)` where available. Works as an installable web app (manifest + icons inline as data URLs, `apple-mobile-web-app-capable`).
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
A8b Touch: on an iPad-sized and a phone-sized viewport (Playwright device emulation, hasTouch) the virtual joystick moves Pip, the Jump button jumps, the camera drag orbits, buttons never overlap the HUD or the quest card, and the first tap unlocks audio with no console errors.
A9 No Nintendo IP: no "Mario", "Peach", "Bowser", "Goomba", "Power Star", mushroom-kingdom music, or 1-up sounds.
A10 README contains a one-page parent guide.

## 5. Revision 2 (user feedback, 2026-11-03)

### 5.1 Touch is gesture-only (replaces the on-screen Jump / Long / Pound buttons)
No gameplay buttons on screen. Only the two small system icons (pause, focus) stay top-right.

| Gesture | Where | Action |
|---|---|---|
| Touch + drag | left half | Move (invisible dynamic stick; a faint ring + dot fades in while touching, 40% opacity) |
| Tap (< 180 ms, < 12 px travel) | right half | Jump. Tap again on landing within the combo window = double / triple |
| Swipe up (≥ 40 px in < 220 ms) | right half | Jump (same as tap; in the air it does nothing, no accidental doubles) |
| Swipe down | right half, in the air | Ground pound. On the ground: crouch while held |
| Swipe sideways or diagonal-forward while running | right half | Long jump |
| Slow drag (speed below swipe threshold) | right half | Camera orbit |
| Two-finger tap | anywhere | Pause |
| Touch and hold with the left thumb still, then tap right | — | Jump in place (works because the stick is dead-zoned) |

Rules: swipe vs. drag is decided by velocity at 100 ms after touch-down; once decided it stays that gesture until lift. Every gesture gives instant feedback (a short white streak in the swipe direction, 150 ms). A one-time "How to move" overlay (3 animated hand icons, ≤4 words each) shows on first touch play and is in the Controls card afterwards. Desktop keyboard and gamepad mappings are unchanged.

### 5.2 Graphics bar ("no grey areas, no pale grass")
- **Palette:** grass is saturated spring green with two-tone vertex-colour variation (base `#58c832`, highlight `#8fe85a`, shadow `#2f9a2a`), earth `#b97a46`, sand `#f3d58a`, stone is warm (`#c9b8a8` light / `#8c7466` shadow), never neutral grey. Sky-tower pillars are painted blue/cream with gold caps; cove cliffs are layered sandstone with green tops.
- **Horizon:** a ring of low-poly mountains (3 layers, parallax-tinted toward the sky colour with distance), snow caps, a sun disc with a soft glow sprite, 10–14 drifting puffy clouds, distance fog tinted to the sky.
- **Ground dressing:** flowers (instanced, 4 colours), grass tufts (instanced, already there, recolour), bushes, round trees with 2–3 canopy blobs, rocks with warm colours, a waterfall with animated UV scroll, water plane with gentle vertex waves + fresnel-ish tint.
- **Light:** warm key light (`#fff2d0`), cool hemisphere (`#bfe4ff` sky / `#6a8f3c` ground), soft shadows, slight rim via a back-light at low intensity. Fake AO: darken vertex colours at the base of walls and under props.
- **Style:** toon-ish flat shading, consistent chunky proportions, no untextured default-grey material anywhere. A colour audit must list every material in the scene and its hex.
- Budget unchanged: < 300 draw calls desktop, < 200 mobile, 60 fps on a 2020 iPad.

### 5.3 Focus training as gameplay (not just focus-friendly UI)
Inspired by the mechanics of attention-training games (target/non-target discrimination, dual tasking, adaptive difficulty) but kept playful and never clinical. All optional stars; all adaptive; all under 90 seconds.

| Challenge | What the kid does | Skill |
|---|---|---|
| **Gem Rush** (Go / No-Go) | Blue gems pop up along a path; grab blue, ignore red. Red touched = gentle "oops" buzz, no loss. Score ≥ 80 % → star. Ratio of red decoys and pop speed adapt to the last 10 responses. | Response inhibition |
| **Freeze!** | While exploring, a whistle + a snowflake icon: stand still for 2 s. Success → coin shower. Random 2–3 times per session. Opt-out in settings. | Impulse control |
| **Echo Chimes** (already in Towers) | Repeat a growing chime sequence (3 → 6). | Working memory |
| **Two Things** (dual task) | Ride the log while tapping only when the lantern turns green. | Divided attention |
| **Spot It** | Among 12 look-alike boxes, find the 3 with a tiny star mark; a soft ping speeds up as you look at the right one (camera-based). | Sustained attention / visual search |

**Focus Meter:** a small sun icon next to the quest card fills while the kid is making progress toward the current objective (moving toward target, collecting objective items, finishing challenges) and slowly drains while wandering with no progress for > 25 s. Full meter = "Focus Burst": 10 s golden trail + coins worth double + a cheerful jingle, then resets. Never shames: the meter only drains, it never shows red or a failure message. Streaks of bursts are celebrated with a toast ("3 bursts today!"), not tracked across days.

Adaptivity: a tiny per-save model (rolling accuracy + reaction time) sets challenge speed in 5 steps. After two failed attempts of any challenge the game offers "Easier" automatically. Every challenge start says the single rule in ≤5 words with an icon, waits for a tap, then counts "3-2-1".

### 5.4 Phone HUD declutter (user feedback: "screen is congested on mobile, stats block the gameplay")
On touch devices (and any viewport ≤ 900 px wide or ≤ 500 px tall):
- **Always visible:** the quest card (compact: one line, icon + ≤5 words, progress bar as a 3 px underline, distance chip inside the card, Skip as a small chevron) and the star count as a single small chip. Nothing else is permanently on screen.
- **Appears only on change, then fades (2.5 s):** coins, red coins, lantern/chime counters, zone name (shown as a one-line banner when entering a zone), Focus Meter value (the sun stays as a tiny 28 px icon on the card; the fill is visible on the icon itself).
- **Break ring:** 32 px, bottom-left on phones, no text until the 5-minute warning; then it shows the minutes.
- **Pause and focus icons:** 44 px, top-right, 70 % opacity, fully opaque on touch.
- **Challenge chip:** replaces the quest card content while a challenge runs (no second card).
- **Total HUD footprint on an 844×390 phone:** ≤ 12 % of the screen area, nothing in the central 60 % of the width below the top 60 px, nothing in the bottom 45 % except the small break ring. A test asserts these boxes.
- Desktop keeps the full HUD.
