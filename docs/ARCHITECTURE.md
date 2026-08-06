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
    │   ├── buffs.js          typed, expiring, stacking multipliers
    │   ├── statusEvents.js   rotating status-message bonuses (spawn/claim/lapse)
    │   ├── lemonwire.js      seed slots, the connection, the Recycle Bin
    │   ├── shield99.js       threat spawns, quarantine loot, virus safety net, scans
    │   ├── aeroburn.js       CD burning; the discs that outlive a prestige
    │   ├── tutorial.js       scripted onboarding steps + the hardware reveal
    │   ├── save.js           storage backends, migrations, offline elapsed time
    │   ├── events.js         tiny event bus
    │   └── format.js         number/time formatting
    ├── data/                 tuning — designers edit these, not the code
    │   ├── balance.js        rates, costs, caps, thresholds, the Shield99 loot table
    │   ├── apps.js           software roster (RAM cost, price, roadmap day)
    │   ├── buddies.js        derived buddy identities (never stored)
    │   ├── playlists.js      RetroAmp playlists (multiplier, RAM, burn-out)
    │   ├── files.js          LemonWire's shared files (size, risk, seeders)
    │   ├── cds.js            AeroBurn disc types
    │   └── hardware.js       CPU/RAM/GPU/HDD tier tables
    ├── ui/                   presentation — reads state, calls actions
    │   ├── windowManager.js  drag/resize/focus/minimize, PDA full-screen mode
    │   ├── desktop.js        icons + Aero gadget (Buzz, meters, Nudge)
    │   ├── taskbar.js        Start menu, task buttons with RAM bars, tray
    │   ├── notify.js         balloon notifications
    │   ├── tutorial.js       the onboarding coach panel
    │   ├── bsod.js           Format C: stop screen, POST wipe, confirm dialog
    │   ├── audio.js          synthesised SFX + BGM, heat distortion, portal mute
    │   ├── welcomeBack.js    the offline-earnings report
    │   └── dom.js            element/throttle/bar helpers
    ├── apps/                 one module per window body
    │   ├── registry.js       id → implementation, placeholder fallback
    │   ├── aerochat.js       core idle engine
    │   ├── retroamp.js       playlist deck (global multipliers)
    │   ├── lemonwire.js      seed slots, disk usage, the connection shop
    │   ├── shield99.js       antivirus window, quarantine, the taskbar tray icon
    │   ├── aeroburn.js       disc burner and shelf
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

## Two clocks, on purpose

Timed systems pick their clock according to what should happen while the player is away:

- **Simulation time** (accumulated `dt`, only advances while the loop runs) — status-message
  events in `core/statusEvents.js`. A claim window must not burn down in a background tab,
  and a throttled tab must not silently miss bonuses. Shield99's threat spawns are here for
  the same reason: a lootbox that arrived while nobody was looking is not a reward. So is
  LemonWire's Recycle Bin — the cost of freeing a slot is time spent *at the machine*, and
  a bin that emptied itself overnight would cost nothing.
- **Wall clock** (`Date.now()` timestamps) — buffs in `core/buffs.js`, autosave, offline
  earnings, and Shield99's rewarded-ad cooldown. A 60-second buff should be over when you
  come back an hour later, and so should a 90-second ad cooldown.

Both are testable: simulation-time systems take `dt`, wall-clock systems take an optional
`now`, and randomness is injected (`createGame({ rng })`). No test needs fake timers except
the ones deliberately exercising wall-clock expiry.

## Multipliers: buffs vs. derived state

Two ways to multiply production, and the choice is about persistence:

- **Buffs** (`core/buffs.js`) are timed and stored as a list with wall-clock expiry — status
  bonuses, and the rewarded-ad payouts from Shield99's quarantine. They are meant to run out.
- **Derived multipliers** are computed from durable state: buddy milestones from
  `chat.bots`, the playlist from `retroamp.playlist`. They survive a reload because there is
  nothing to expire — a permanent playlist stored as an `Infinity` buff would not, since
  `JSON.stringify(Infinity)` is `null`.

If a bonus should still be there after a refresh, derive it. If it should tick away whether
or not the player is watching, make it a buff.

## Seeding and quarantine: one loop across two apps

LemonWire and Shield99 are a single mechanic wearing two windows, and neither is worth
much alone:

```
seed slots (LemonWire)  →  passive Buzz, and a threat every few minutes
                                       ↓
                    Shield99 open?  ──yes──→  sealed in quarantine  →  rewarded ad → loot
                                       └─no──→  free rescue, then a capped infection
```

Three consequences the code depends on:

- **Income is production, not a payout.** A seed's Buzz goes through
  `economy.seedBuzzPerSecond()` into `baseBuzzPerSecond()`, so it picks up every global
  multiplier, feeds offline earnings, and needs no event of its own. `core/lemonwire.js`
  only does bookkeeping (slots, the disk, the upload counters).
- **Risk buys frequency, and Shield99 decides what it is worth.** Seeding
  `system32_SPEED_BOOST_2005.exe` shortens the spawn timer either way; whether that reads
  as loot or as a halved production rate is exactly the 48 MB question.
- **The reward is resolved, then applied.** `shield99.rewardFor()` is pure and returns a
  descriptor (`buzz` / `buff` / `render`); `game.extractQuarantine()` is what actually pays
  it. That is what lets the same table serve the full rewarded-ad payout and the
  fractional non-ad fallback without a second balance sheet.

## Hardware: flat percentages, derived capacities

A hardware tier contributes a **flat percentage** to its track rather than
replacing a stat (`src/data/hardware.js`). Owning tiers 0..n gives `1 + Σ bonuses`,
and capacities (memory, storage, offline hours) are that same sum applied to a base
machine in `HARDWARE_BASE`. Two things fall out of this:

- The shop can state what a purchase is worth ("+25% production") and it is literally
  the number applied — `tests/hardware.test.js` asserts the advertised gain equals the
  measured one.
- Saves are unaffected by rebalancing: `state.hardware.<track>` is still a tier index,
  so the tables can be retuned without a migration.

## Long UI sequences

The Format C: animation (`ui/bsod.js`) is presentation, but it has to interleave with a
state change. The game emits `FORMAT_REQUESTED`; the shell runs the sequence and calls
`game.formatC()` *between* the stop screen and the reboot screen, so the POST report
describes the machine the player is about to get. Every stage is click-to-skip.

## Audio is generated, not shipped

`ui/audio.js` synthesises every sound with WebAudio: no files, no fetches, nothing for a
portal CSP to block, and a few KB of code instead of megabytes of MP3. It sits in `ui/`
rather than `core/` because AudioContext is a browser API and the simulation must stay
runnable in plain Node.

Two consequences worth keeping: the context is created on the first user gesture (autoplay
policy), so nothing warns on boot; and the "audio distorts as the system bloats" requirement
is a single waveshaper whose curve follows `econ.heatRatio` — the same number that drives the
heat gauge and the window sluggishness, so the escalation cannot drift out of sync.

Mute has two sources and **the portal wins**. `state.settings.sfx/.bgm` are the player's
toggles; CrazyGames can mute the whole game from the site chrome or before an ad. The portal
setting is folded into `sfxOn()`/`bgmOn()` so every existing gate honours it, *and* written
to the master gain, so sound already scheduled stops instead of playing out under an ad.

## State & saves

`createInitialState()` is the single definition of the save shape. On load, a stored save is
migrated (`MIGRATIONS`) and then deep-merged over a fresh state, so **adding a field is
backwards compatible by construction** — old saves get the default instead of `undefined`.

Rules for changing the save:

1. Add the field with a default in `createInitialState()`.
2. Only bump `SAVE_VERSION` + add a migration if an *existing* field changes meaning.
3. Add a save test covering an old payload.

Storage is injected everywhere, which is also the seam a cloud save would use.
`defaultStorage()` picks the first backend whose probe write round-trips:

1. `CrazyGames.SDK.data` — the portal's per-player storage, which only exists after
   `SDK.init()` resolves. That is why `boot()` is async and awaits it before `createGame()`.
2. `localStorage` — local dev and any non-portal host.
3. `createMemoryStorage()` — private mode, blocked iframes, and tests.

All three are localStorage-shaped and synchronous, so nothing above this layer knows which
one it got. Writes over `MAX_SAVE_BYTES` (1 MB, the portal's per-value cap) are refused
rather than attempted: a rejected write would lose the previous save too.

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

## Motion

Nothing in the stylesheet reads `prefers-reduced-motion` directly. `ui/motion.js` resolves
the OS preference against `state.settings.motion` (`auto` | `full` | `reduced`) and stamps
the answer on `<html data-motion>`; `tokens.css` keys its reduced-motion block off that
attribute, with a bare media query covering only the moment before boot stamps it.

The reason it is three-state rather than a straight media query: "show animations in
Windows" is a machine-wide switch a lot of players flip once and forget, and under a plain
`@media (prefers-reduced-motion: reduce)` rule it silently collapses every window
transition, meter and playhead in the game to 0.001 ms. That is indistinguishable from the
game being broken, and there is nothing on screen to say otherwise. My Computer's *Display*
panel is the way back.

## Progress bars

`setBar(fill, ratio)` writes the ratio to a `--fill` custom property and lets the
stylesheet choose how to draw it: `transform: scaleX(var(--fill))` for a plain bar (the
compositor can run that alone), `clip-path` for one whose striped child would be squashed
by a scale. Never `width` — that is a layout on every frame of the transition.

The rule that actually bites: **a fill's transition must not be longer than the interval
its caller updates on.** The gadget re-runs `setBar` every 100 ms; a 200 ms transition on
it is cancelled and restarted forever, never once reaching its target, which reads as a bar
that lags and stutters rather than one that moves. If you change a throttle, change the
matching transition.

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
