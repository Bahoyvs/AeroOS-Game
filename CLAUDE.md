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
- Buildings produce whether or not their window is open. An open window buys *active
  participation* (playlists, seed slots, scans), and that pays through the buff system.
- A building upgrade multiplies its own building only. The global chain is hardware and
  Legacy — adding to it needs a very good reason.
- Anything a building's output depends on has to appear in `getProductionBreakdown()`.
  A multiplier the player cannot see does not exist for them.
- Mini-game rewards go through `applyMinigameReward()`: a timed, building-scoped buff.
  Never a permanent multiplier and never raw Buzz.
- The Darknet Breach may take Buzz. It may never touch `lifetimeBuzz`, `allTimeBuzz` or
  `dollarsEarnedTotal`.
- The Vista/7 visual charter is enforced by `tests/aeroCharter.test.js`, not by review.
  New files must be emoji-free; the debt list in that test may only shrink.
- Build panels from Win32 parts, not cards: `<fieldset><legend>` group boxes, sunken white
  list views, `.instruction-primary` headlines, 7.css `.window`/`.title-bar` for dialogs.
  A translucent rounded rectangle floating on the wallpaper is the thing being avoided.
- **No shared purchase UI.** Economy maths is central (`ui/buildingView.js` is headless);
  how an app sells its units and upgrades is bespoke and must fit that app's software
  metaphor — contacts in AeroChat, render blades in Aero Studio. An app that draws its own
  exports `ownsBuildingUI = true`; the generic panel is a fallback for the ten not yet done.
- Common controls (menu bar, tab strip, spinner, split button, dialog) live in `ui/win32.js`
  and know nothing about the game. That is the OS's widget set, not a shop.
- 7.css uses `button::after` for its hover wash at `opacity: 0; z-index: -1`. A CSS glyph
  drawn in that pseudo-element is invisible until you restate both.
- No uppercase letter-spaced micro-labels. The markup already says "Hardware shop"; CSS
  must not shout it. Tracking is fine on a large display string, never on a caption.
- 7.css styles bare `button`, including `:focus` at specificity (0,1,1). A control with a
  semantic colour needs its focus/hover states written out, or it turns Aero blue on click.
- Two clocks, deliberately: things that should keep running while the tab is closed (buffs,
  offline earnings, autosave) use `Date.now()`; things that should only advance while the
  player is watching (status events) take `dt`. Pick one on purpose — see ARCHITECTURE.md.
- Randomness is injected (`createGame({ rng })`), never called directly in a mechanic.
- Windows use `role="region"`. 7.css hides `.window[role=dialog]` — do not "fix" that back.
- Bars go through `setBar()`, which writes `--fill`; CSS scales or clips it. A fill's
  transition must never be longer than the interval its caller updates on, or it restarts
  forever and never arrives — see ARCHITECTURE.md.
- Reduced motion is resolved in `ui/motion.js` onto `<html data-motion>`. Do not add a raw
  `@media (prefers-reduced-motion)` rule; it would ignore the player's own setting.
- The PDA breakpoint is duplicated in `src/ui/windowManager.js` (`mobileQuery`) and
  `src/styles/mobile.css`. Change both together.

## Before pushing

```bash
npm run check   # vitest + production build
```

Test the phone layout too — PDA mode is a first-class target, not a fallback.
