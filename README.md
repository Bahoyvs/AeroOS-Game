# AeroOS — The Messenger Era

A maximalist idle/simulation game set on a mid-2000s desktop. Buy chat bots, watch your
Buzz climb, run out of RAM, and `Format C:` your way to better hardware.

Frutiger Aero look, built for the browser (CrazyGames / Poki), desktop **and** phone.

- **Design:** [`docs/GDD.md`](docs/GDD.md)
- **This week's plan:** [`docs/ROADMAP.md`](docs/ROADMAP.md)
- **How the code fits together:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload (`--host` is on, so a phone on the same Wi-Fi can open it) |
| `npm test` | Vitest unit tests — economy, saves, game actions |
| `npm run build` | Production bundle in `dist/` |
| `npm run preview` | Serve the built bundle |
| `npm run check` | Tests + build; run this before pushing |

No framework and no global tooling: Node 20+ and npm are enough.

## What works today (Days 1–3)

- **Desktop shell** — draggable, resizable, overlapping windows with focus, minimize and a
  Start menu; on phones the same windows become full-screen PDA modals with RAM bars under
  the taskbar icons.
- **Core loop** — Nudge for Buzz, buy AeroChat buddies, buddies generate passive Buzz while
  the window is open.
- **AeroChat** — a living buddy list: Online/Away groups, per-buddy display pictures and
  rotating status messages, ×1/×10/Max buying with live prices, and buddy-count milestones
  that permanently boost the run.
- **Status bonuses** — a buddy occasionally posts a "hot" status; click it in time for a
  timed multiplier or an instant Buzz burst. Ignoring one costs nothing.
- **Scripted onboarding** — the desktop opens clean with only AeroChat and walks a new
  player to their first buddy, RetroAmp and their first memory wall. Hardware stays hidden
  until that wall; a returning save skips the tour entirely.
- **RetroAmp** — a playlist deck that multiplies everything: SOFT SIGNALS is a small lift you
  leave running, IRON OVERDRIVE triples production for five minutes, eats 64 MB more than
  your machine has, and then cools down.
- **Memory budget** — every app costs RAM; opening one that does not fit is refused with an
  out-of-memory balloon instead of silently failing.
- **Bloat** — uptime and open apps degrade production and desaturate the desktop, building
  pressure toward a prestige.
- **Format C:** — wipes software, banks Dollars from lifetime Buzz, keeps hardware.
- **Hardware** — CPU/RAM/GPU/HDD tier tables wired to tick rate, memory, cooldowns and the
  offline-earnings cap.
- **Saves** — versioned localStorage with migrations, autosave, and offline Buzz capped by
  your HDD.

The rest of the software roster (LemonWire, Shield99, Aero Studio, AeroBurn,
Galactic Pinball) is declared with real RAM costs and prices, and opens a placeholder window
naming the day it lands. See the roadmap.

## Layout

```
index.html          shell markup
src/core/           simulation — no DOM in here, so it unit-tests in plain Node
src/data/           tuning tables: balance, app roster, hardware tiers
src/ui/             window manager, desktop, taskbar, notifications
src/apps/           one module per window body
src/styles/         tokens → desktop → window → apps → mobile
tests/              Vitest suites
docs/               GDD, roadmap, architecture
```

Balance numbers live in `src/data/balance.js`; changing the feel of the game should not
require touching a mechanic.

## Debugging

The dev build exposes `window.AeroOS`:

```js
AeroOS.game.state.buzz = 1e6      // fund a run
AeroOS.game.econ.buzzPerSecond(AeroOS.game.state)
AeroOS.launch('aerostudio')       // open any app
AeroOS.game.hardReset()           // wipe the save
```

## Deploying

`npm run build` emits a fully static `dist/` with relative asset paths, so it can be zipped
and uploaded to a portal or dropped in any subdirectory. Portal SDKs (ads, analytics) land
on Day 7 behind `src/monetization/ads.js` — keep them behind that adapter so the game still
runs when no SDK is present.
