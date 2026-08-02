# Working in this repo

AeroOS — a browser idle game. Vanilla ES modules + Vite + 7.css. No framework.

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before changing structure and
[`docs/ROADMAP.md`](docs/ROADMAP.md) before adding a feature — the week is planned, and
most "missing" apps are scheduled, not forgotten.

## Rules that matter here

- `src/core/**` must not touch the DOM. That is what keeps the simulation testable in plain
  Node. If you need `document` in core, the design is wrong.
- The UI never mutates state. Call an action on `game`, then re-read `game.state`.
- Game numbers belong in `src/core/economy.js` (formulas) and `src/data/balance.js`
  (constants) — not inline in a UI module.
- New persisted fields need a default in `createInitialState()`; only bump `SAVE_VERSION`
  when an existing field changes meaning, and add a migration when you do.
- Two clocks, deliberately: things that should keep running while the tab is closed (buffs,
  offline earnings, autosave) use `Date.now()`; things that should only advance while the
  player is watching (status events) take `dt`. Pick one on purpose — see ARCHITECTURE.md.
- Randomness is injected (`createGame({ rng })`), never called directly in a mechanic.
- Windows use `role="region"`. 7.css hides `.window[role=dialog]` — do not "fix" that back.
- The PDA breakpoint is duplicated in `src/ui/windowManager.js` (`mobileQuery`) and
  `src/styles/mobile.css`. Change both together.

## Before pushing

```bash
npm run check   # vitest + production build
```

Test the phone layout too — PDA mode is a first-class target, not a fallback.
