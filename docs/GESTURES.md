# Star Hopper touch gestures

Touch has two layouts, picked in **Settings → 🎮 Controls** (`settings.moveMode`):

- **Simple** (default, DESIGN.md §5.5): a **visible joystick** and one round **⬆ Jump** button, the way Roblox does it. All the gestures below still work on the right side *outside* the button.
- **Pro** (DESIGN.md §5.1): **no gameplay buttons**, everything is a gesture. Only the small pause and focus icons stay in the top-right corner.

Keyboard and gamepad mappings are the same in both; only the jump rules differ (Simple: fixed jump + double jump in the air; Pro: hold for higher, timed double / triple jump on landing).

## Simple layout

| Control | Where | What happens |
|---|---|---|
| Joystick | Left 45 % of the screen | Appears where the thumb lands: 110 px ring, 50 px knob, 55 % opacity. A faint ring rests bottom-left as a hint. 2/3 deflection = full speed. |
| ⬆ Jump button | Bottom right (88 px, 16 px above the safe area, 55 % opacity) | **Jump** (fixed 5 m). Press again in the air = **double jump** (8.5 m total). Lights up while pressed. |
| Tap | Right side, outside the button | **Jump** too (same as the button). |
| Swipe down / sideways, slow drag, two-finger tap | Right side, outside the button | Ground pound / long jump / camera / pause, exactly as in the table below. |
| Auto-jump | — | Walking into a ledge 0.45–1.6 m high for 0.12 s jumps by itself (at most once every 0.6 s). Never toward a drop or while riding a moving platform. Settings → **Auto-jump** turns it off. |

Simple first-play tutorial (3 cards): **Drag left: move**, **Tap ⬆: jump**, **Tap ⬆ again in air: double jump**.

## Pro gesture table (the right-side gestures also apply in Simple)

## Gesture table

| Gesture | Where | What happens |
|---|---|---|
| Touch + drag | Left half | **Move.** An invisible stick appears where your thumb lands: a faint ring + dot (40 % opacity) that fades out when you lift. Keeps working if your thumb drifts onto the right half. |
| Tap (lift within 180 ms, moved < 12 px) | Right half | **Jump.** Pro: tap again just as Pip lands (within the combo window) for a **double**, then a **triple** jump, exactly like Space. Simple: a tap in the air is the double jump. |
| Swipe up (≥ 40 px, ≥ 600 px/s) | Right half | **Jump** (same as a tap). In the air: nothing in Pro (buffered for landing), double jump in Simple. |
| Swipe down (≥ 40 px, ≥ 600 px/s) | Right half | **Ground pound** in the air. On the ground: **crouch** while the finger stays down. |
| Swipe sideways or diagonally up (≥ 40 px sideways, ≥ 600 px/s) | Right half | **Long jump**, but only while Pip is running (> 4 m/s). Standing still: ignored, and the camera doesn't move either. |
| Slow drag (slower than a swipe) | Right half | **Look around** (camera orbit) until you lift. |
| Two-finger tap (2nd finger within 120 ms, both lifted within 250 ms, < 12 px) | Anywhere | **Pause.** |
| Hold the left thumb still, then tap right | Both | **Jump in place** (the stick has an 8 px dead zone). |
| Mouse drag (hybrid devices) | Anywhere | Camera orbit, as before. |

## How the recogniser decides

Each right-half finger is decided once and stays that gesture until it lifts.

- The decision happens **100 ms after touch-down, or as soon as the finger has moved 40 px**, whichever comes first.
- At 100 ms a finger that has moved less than 12 px is still a tap candidate. If it lifts by 180 ms it is a tap. If it starts moving it becomes a camera drag. A fast flick that starts inside the tap window still counts as a swipe.
- At 100 ms a finger that is moving fast (≥ 600 px/s) but hasn't reached 40 px yet gets until 220 ms to finish its swipe. Anything slower is a camera drag.
- Speed is the higher of (a) the average speed since touch-down and (b) the speed over the last 60 ms.
- Direction: mostly down → down; within about 32° of straight up → up; otherwise (sideways or diagonal) → side.
- All timing uses the touch events' own timestamps, so a slow frame never turns a quick tap into a hold.
- A tap or swipe-up jump holds "jump" for 450 ms, so a tap gives a full-height jump, not a short hop.
- The jump is latched until the next physics step reads it, so a tap is never lost between steps.

## Feedback

- Swipes: a 150 ms white streak in the swipe direction at the touch point.
- Taps: a small expanding ring.
- Every recognised gesture gives a short buzz (`navigator.vibrate(8)`) unless **Buzz** is off in Settings.

## First-play tutorial

On the first touch game start, a translucent "How to move" overlay shows animated hands. Simple shows the 3 cards above; Pro shows four:

- **Drag left: move**
- **Tap right: jump**
- **Swipe down: pound**
- **Swipe side: long jump**

A tap dismisses it once it has been up for 1.5 s. It is remembered in settings (`gestureTutorialSeen`). The Controls card can show it again with `touch.showTutorial()`.

## For the Controls card / parent guide

`src/core/touch.js` exports `GESTURE_HELP_SIMPLE` (also exported as `GESTURE_HELP`, the default), `GESTURE_HELP_PRO` and `gestureHelp(mode)`; `touch.GESTURE_HELP` returns the rows for the current mode. Each row is `{ icon, title, text }` (≤ 4 words each).

Simple:

| Icon | Title | Text |
|---|---|---|
| 🕹️ | Move | Drag left side |
| ⬆ | Jump | Tap ⬆ button |
| ⭐ | Double jump | Tap ⬆ in air |
| 🦘 | Auto-jump | Walk into ledges |
| 👇 | Ground pound | Swipe down in air |
| 👉 | Long jump | Run, then swipe sideways |
| 🔄 | Look around | Drag right side |
| ✌️ | Pause | Two-finger tap |

Pro:

| Icon | Title | Text |
|---|---|---|
| 👈 | Move | Drag left side |
| 👆 | Jump | Tap right side |
| ⭐ | Double jump | Tap again on landing |
| 👇 | Ground pound | Swipe down in air |
| 👉 | Long jump | Run, then swipe sideways |
| 🔄 | Look around | Slow drag right side |
| ✌️ | Pause | Two-finger tap |

All the thresholds are in `GESTURE` in `src/core/touch.js` (Simple layout sizes: `SIMPLE_*`, `JUMP_BTN*`).
