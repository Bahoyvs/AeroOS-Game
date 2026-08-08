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
| `npm run package` | Check, then write the CrazyGames upload zip (Windows) |
| `npm run wallpapers` | Re-encode `art/wallpapers-src/` into the shipped art; only needed when the source images change |
| `npm run icons` | Re-export `public/icons/` and the buddy sprite at the size they are drawn; same, only when the art changes |

No framework and no global tooling: Node 20+ and npm are enough.

## What works today (Days 1–6)

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
- **LemonWire** — a P2P download sim where files take real disk space and trade risk for
  reward: dangerous files crawl in and pay a premium for the wait, a suspiciously popular
  malware stub is not actually well-seeded, and deleting only moves a file to a Recycle Bin
  that holds its space for five minutes. Downloads only run while the window is open.
- **Shield99** — a tray icon that shows whether you are covered, real-time protection while
  it is open, and one free rescue per run. A virus halves production and locks LemonWire
  until you scan — it never takes progress away.
- **Memory budget** — every app costs RAM; opening one that does not fit is refused with an
  out-of-memory balloon instead of silently failing.
- **Bloat** — uptime and open apps degrade production and desaturate the desktop, building
  pressure toward a prestige.
- **Format C:** — a confirmation, an authentic blue stop screen, a BIOS-style wipe that
  reports the machine you are about to get, and a clean desktop. Skippable at any point.
  Wipes software, banks Dollars from lifetime Buzz, keeps hardware.
- **Hardware shop** — CPU/RAM/GPU/HDD tracks where every tier states what it adds as a flat
  percentage, with tier pips and live affordability.
- **AeroBurn** — burn Buzz onto a disc that survives a Format C:. MIX stores value across
  the wipe, OVERCLOCK stores a production burst for the next run.
- **Heat and tension** — the machine gets visibly and audibly worse as it bloats: a heat
  gauge climbing to 94°C, window animations dragging, the desktop hitching, and the audio
  distorting.
- **Sound** — every effect and the soundtrack are synthesised in the browser, so there are
  no audio files to ship. Mute lives in the taskbar tray.
- **Saves** — versioned localStorage with migrations, autosave, and offline Buzz capped by
  your HDD, reported in a dialog that explains the cap when it bites.

The rest of the software roster (Aero Studio, Galactic Pinball) is declared with real RAM costs and prices, and opens a placeholder window
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

`npm run build` emits a fully static `dist/` with relative asset paths, so it can be dropped
in any subdirectory. `npm run package` then writes `aeroos-crazygames-build/` and the
matching zip, and refuses a build that would be rejected — see the header of
[`art/package-build.ps1`](art/package-build.ps1) for the two packaging mistakes it exists to
prevent.

Portal code stays behind one adapter each so the game still runs with no SDK present:
`src/ui/ads.js` is the only file that names `SDK.ad`/`SDK.banner`, and `defaultStorage()` in
`src/core/save.js` is the only place `SDK.data` is chosen. `ADS.enabled` in
`src/data/balance.js` is the master switch, and is `false` for the basic-launch build.

Per-release notes for the portal's QA team live in
[`docs/RELEASE-NOTES.md`](docs/RELEASE-NOTES.md).
