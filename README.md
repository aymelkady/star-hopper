# Star Hopper

An original 3D collect-a-thon platformer that runs in the browser, made for 10-year-olds
(designed with ADHD-friendly rules: one clear goal, instant feedback, failure is free).
You play **Pip**, a round little fox-bot, hopping around a Treehouse Hub and three zones
(Sunny Meadow, Splash Cove and Sky Towers) to find **20 stars** (15 platforming stars plus 5 optional focus-training challenge stars).
Everything is procedural geometry, so there is nothing to download and no loading screens.
Works on desktop (keyboard or gamepad), iPad (Safari) and Android (Chrome) with touch controls.

## Controls

| Action | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Move | `W A S D` (or arrow keys) | Left stick / d-pad | Drag on the left half |
| Jump (hold = higher, 3 in a row = triple jump) | `Space` | A | Tap the right half |
| Long jump (while running) | `Shift` + `Space` | B | Swipe sideways |
| Ground pound (in the air) | `E`, `X`, `C` or `Ctrl` | X | Swipe down |
| Crouch (on the ground; crouch + jump = long jump or backflip) | hold `C`, `X` or `Ctrl` | hold X | Swipe down and hold |
| Camera | `Q` / `E`, arrow keys (when WASD moves), mouse drag | Right stick | Slow drag on the right half |
| Camera behind Pip | `R` | Y | |
| Focus mode | `F` | View / Back | Eye button (top right) |
| Pause / Settings | `Esc` or `P` | Start | Pause button (top right) or two-finger tap |
| Skip current goal | `Tab` | Pause menu → Skip goal | **Skip ›** on the quest card |

Wall kick: touch a wall in the air and press Jump.

## Run it

```bash
npm install          # only installs esbuild (three.js is vendored in vendor/)
npm run dev          # http://localhost:8080  (ES modules straight from src/)
```

Or just open `dist/star-hopper.html` (one self-contained file, works from `file://`, no network).

## Build and test

```bash
npm run build        # -> dist/star-hopper.html (JS + CSS inlined, < 1 MB)
npm test             # headless Playwright smoke test (desktop + iPad + phone touch passes)
node test/shots.mjs  # screenshots of title / hub / meadow / cove / towers into test/shots/
```

The smoke test fails on any console error. Test hooks live on `window.__game`
(`ready`, `player`, `state`, `events`, `log`, `teleport(x,y,z)`, `collect(id)`, `listPickups()`, `setTimeScale(n)`).
Plugin debug hooks: `__game.plugins.objectives.{current(), order(), quest(), skip()}`,
`__game.plugins.breaks.{remaining(), debugSetRemaining(s), debugFinishStretch()}`, `__game.plugins.focus.{isOn(), toggle()}`.

## Code map

- `src/main.js` boot + fixed 60 Hz loop, lifecycle (title, play, pause, respawn), test hooks
- `src/core/` event bus, input (keyboard, gamepad, touch), save slots, collision world, camera
- `src/player/` Pip mesh + animation, controller (all movement numbers are in `TUNING`)
- `src/world/` terrain, sky, props, zones (`zones/hub|meadow|cove|towers.js`)
- `src/ui/` HUD, menus, quest card, settings (DOM, not canvas)
- `src/systems/` objectives (quest card, beacon, Today's Quest), break timer, focus mode, fx

## Parent guide

_Canonical copy: [docs/PARENT-GUIDE.md](docs/PARENT-GUIDE.md)._

**What it is.** A short-session 3D platformer. Your child plays Pip, a little fox-bot, and collects
20 stars across three small worlds (5 of them are optional focus-training challenges). There is no violence, no reading beyond a few words, no
accounts, no ads, no internet connection after the page loads. Progress saves in the browser
on this device.

**Why it is built the way it is.** Kids with ADHD tend to do best when the next goal is obvious,
progress is visible, feedback is instant, and stopping is predictable. So the game always shows
exactly one goal with an arrow to it, celebrates every pickup, never punishes failure (no lives,
no game-over), and has a built-in break timer.

### Set it up once (2 minutes)
1. Open the game, press **Play**, pick a save slot (there are three, one per child).
2. Press **Esc** (or the ❚❚ button) → **⚙ Settings**. Settings are also on the title screen (⚙).
   The **Parents** part of the screen has:
   - **Session length**: 10 / 15 / 20 / 30 minutes. The timer ring in the corner shows time left.
     The game warns at 5 min and 1 min, then shows a 60-second stretch-break screen.
   - **Helper mode** (on by default): more forgiving jumps and a coin magnet. Turn off for
     kids who want "Pro mode".
   - **Focus mode** (F key): dims everything except Pip, the path, and the current goal.
     Try it if your child gets pulled toward side details.
   - **Sound / music** sliders, **Reduce motion**, **Camera speed**, **Invert camera**, and
     **Buzz** (vibration on tablets/phones).
3. Agree on the rule out loud: *"When the stretch screen shows, we stop or we take the break."*

### Using it well
- **Today's Quest.** Each session suggests 3 stars. That is a natural stopping point. Ask
  "did you finish your quest?" instead of "time's up".
- **Transitions.** The 5-minute and 1-minute warnings are on screen and in sound. Repeat them
  out loud once; do not add more warnings than that.
- **Frustration.** Falling costs nothing (back at the last flag in one second, coins kept).
  If a star is too hard, tap **Skip ›** on the quest card (or press **Tab**, or Pause → Skip goal)
  and the game picks the next one. Nothing is locked.
- **Movement.** The stretch-break screen suggests three quick movements. Hyperactive kids
  often come back more settled after actually doing them.
- **Focus challenges.** Five optional stars are short attention games (Gem Rush: grab blue, skip
  red; Freeze!: stand still for 2 seconds; Two Things: jump only on green; Spot It: find the
  marked crates; Echo Chimes: repeat the tune). They adapt to your child and can always be
  skipped. The sun next to the quest card is the **Focus Meter**: it fills while your child
  works toward the goal and triggers a "Focus Burst" bonus when full. Details in
  [docs/FOCUS-TRAINING.md](docs/FOCUS-TRAINING.md). The random Freeze! game can be turned off
  in Settings → Parents.
- **Save & stop** is in the pause menu. It always saves. Closing the tab also keeps progress.

### Controls
| Action | Touch (iPad / Android) | Keyboard | Gamepad |
|---|---|---|---|
| Move | Drag on the left side | W A S D or arrows | Left stick |
| Jump (tap again on landing for higher jumps) | Tap the right side | Space | A |
| Long jump (while running) | Swipe sideways | Shift + Space | B |
| Ground pound (in the air) | Swipe down | E | X |
| Crouch (crouch + jump = backflip) | Swipe down and hold | hold C or Ctrl | hold X |
| Camera | Slow drag on the right side | Q / E, or drag mouse | Right stick |
| Focus mode | Eye icon | F | Back / View |
| Pause / Settings | ❚❚ icon or two-finger tap | Esc | Start |
| Skip current goal | Quest card → Skip | Tab | Pause menu → Skip goal |

### Honest limits
- This is a game, not a treatment. It borrows design ideas from the research on attention and
  games, but it has not been clinically tested.
- Recommended total screen-game time for this age is still a family decision; most guidance
  points to under an hour on school days. The timer helps you keep to whatever you choose.
- Works on iPad (Safari), Android tablets and phones (Chrome), Chromebooks and laptops. On a tablet,
  turn it sideways and use **Add to Home Screen** for a full-screen app with no browser bars.
