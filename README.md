# Star Hopper

An original 3D collect-a-thon platformer that runs in the browser, made for 10-year-olds
(designed with ADHD-friendly rules: one clear goal, instant feedback, failure is free).
You play **Pip**, a round little fox-bot, hopping around a Treehouse Hub and three zones
(Sunny Meadow, Splash Cove and Sky Towers) to find **15 stars**.
Everything is procedural geometry, so there is nothing to download and no loading screens.
Works on desktop (keyboard or gamepad), iPad (Safari) and Android (Chrome) with touch controls.

## Controls

| Action | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Move | `W A S D` (or arrow keys) | Left stick / d-pad | Left thumb: the stick appears where you touch |
| Jump (hold = higher, 3 in a row = triple jump) | `Space` | A | Green **Jump** button |
| Long jump (while running) | `Shift` + `Space` | B | Red **Long** button |
| Ground pound (in the air) | `E`, `X`, `C` or `Ctrl` | X | Blue **Pound** button |
| Camera | `Q` / `E`, arrow keys (when WASD moves), mouse drag | Right stick | Drag on the right half |
| Camera behind Pip | `R` | Y | |
| Focus mode | `F` | View / Back | Eye button (top right) |
| Pause | `Esc` or `P` | Start | Pause button (top right) |

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

## Code map

- `src/main.js` boot + fixed 60 Hz loop, lifecycle (title, play, pause, respawn), test hooks
- `src/core/` event bus, input (keyboard, gamepad, touch), save slots, collision world, camera
- `src/player/` Pip mesh + animation, controller (all movement numbers are in `TUNING`)
- `src/world/` terrain, sky, props, zones (`zones/hub|meadow|cove|towers.js`)
- `src/ui/` HUD and menus (DOM, not canvas)

## Parent guide
