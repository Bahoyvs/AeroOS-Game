# Architecture

No framework, no build magic beyond Vite: plain ES modules, one direction of data flow,
and a hard line between *simulation* and *presentation*.

```
index.html
└── src/main.js               boot: wires simulation ↔ shell, starts the loop
    ├── core/                 simulation — no DOM access anywhere in here
    │   ├── game.js           the only mutable state; actions emit events
    │   ├── state.js          save shape + prestige reset
    │   ├── economy.js        every derived number (pure functions)
    │   ├── loop.js           fixed-timestep tick + rAF render
    │   ├── save.js           localStorage, migrations, offline elapsed time
    │   ├── events.js         tiny event bus
    │   └── format.js         number/time formatting
    ├── data/                 tuning — designers edit these, not the code
    │   ├── balance.js        rates, costs, caps, thresholds
    │   ├── apps.js           software roster (RAM cost, price, roadmap day)
    │   └── hardware.js       CPU/RAM/GPU/HDD tier tables
    ├── ui/                   presentation — reads state, calls actions
    │   ├── windowManager.js  drag/resize/focus/minimize, PDA full-screen mode
    │   ├── desktop.js        icons + Aero gadget (Buzz, meters, Nudge)
    │   ├── taskbar.js        Start menu, task buttons with RAM bars, tray
    │   ├── notify.js         balloon notifications
    │   └── dom.js            element/throttle/bar helpers
    ├── apps/                 one module per window body
    │   ├── registry.js       id → implementation, placeholder fallback
    │   ├── aerochat.js       core idle engine
    │   ├── system.js         hardware shop + Format C:
    │   └── placeholder.js    "scheduled for Day N" stub
    └── styles/               tokens → desktop → window → apps → mobile
```

## Data flow

```
input → game.<action>() → state mutation → bus.emit(EVENT)
                                              ↓
                        loop.onRender() → ui.update() reads state
```

- **UI never mutates state.** It calls an action and re-reads. Actions return
  `{ ok, reason }` so callers can explain a refusal without duplicating the rule.
- **`core/` never touches the DOM.** That is what makes the whole simulation testable in
  plain Node — no jsdom, no test-only harness.
- **Derived values live in `economy.js`.** If the UI is computing a game number, it belongs
  in economy instead.

## The loop

`createGameLoop` advances the simulation in fixed `TICK_MS` (100 ms) steps and renders once
per animation frame. Production maths is therefore frame-rate independent, and a
backgrounded tab is clamped to `maxCatchUpMs` rather than replaying hours in one frame —
long absences are the job of offline earnings, not catch-up ticks.

## State & saves

`createInitialState()` is the single definition of the save shape. On load, a stored save is
migrated (`MIGRATIONS`) and then deep-merged over a fresh state, so **adding a field is
backwards compatible by construction** — old saves get the default instead of `undefined`.

Rules for changing the save:

1. Add the field with a default in `createInitialState()`.
2. Only bump `SAVE_VERSION` + add a migration if an *existing* field changes meaning.
3. Add a save test covering an old payload.

Storage is injected everywhere (`createMemoryStorage()` in tests, `localStorage` in the
browser, a shim when storage is blocked), which is also the seam a cloud save would use.

## Windows

`windowManager.js` owns geometry and focus; app modules own only their body. A body module
exports `mount(body, ctx) → cleanup?` and is registered in `apps/registry.js`. Anything not
registered falls back to the placeholder, so an app can be declared in `data/apps.js` — with
real RAM cost, price and taskbar behaviour — days before its mechanic exists.

Two integration details worth knowing:

- Windows use `role="region"`, **not** `role="dialog"`: 7.css styles `.window[role=dialog]`
  as a `:target`-driven modal and keeps it `visibility: hidden`.
- The PDA breakpoint lives in two places that must agree: `mobileQuery` in
  `windowManager.js` and the `max-width: 820px` block in `styles/mobile.css`.

## Adding an app

1. Declare it in `src/data/apps.js` (RAM cost, install price, unlock threshold, roadmap day).
2. Write `src/apps/<id>.js` exporting `mount(body, { game, app })`.
3. Register it in `src/apps/registry.js`.
4. Put its numbers in `src/data/balance.js` and its formulas in `src/core/economy.js`.
5. Add tests for the formulas — they are pure, so they need no DOM.

## Testing

`npm test` runs Vitest over `tests/` in a plain Node environment: economy formulas, save
round-trips and migrations, and game actions (buying, RAM limits, prestige, offline gains).
Anything requiring a real browser is verified manually against `npm run dev` for now; a
Playwright smoke test is a reasonable Day 6–7 addition.
