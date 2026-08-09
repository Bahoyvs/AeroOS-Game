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
    │   ├── sweeper.js        the minefield, plus tokens and the combo
    │   ├── shield99.js       threat spawns, quarantine loot, virus safety net, scans
    │   ├── ads.js            rewarded-ad pacing: daily allowances, cooldowns, reward sizing
    │   ├── defrag.js         Auto-Defrag: the online pass, and the offline bloat ceiling
    │   ├── cosmetics.js      tint/wallpaper selection; unlocks are derived, never stored
    │   ├── aeroburn.js       CD burning; the discs that outlive a prestige
    │   ├── tutorial.js       scripted onboarding steps + the hardware reveal
    │   ├── goals.js          the objective after the tour — derived, never stored
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
    │   ├── cosmetics.js      window tints, wallpapers, and what unlocks each
    │   └── hardware.js       CPU/RAM/GPU/HDD/Mainboard tier tables
    ├── assets/               the only shipped art: built by art/optimize-*.mjs
    ├── ui/                   presentation — reads state, calls actions
    │   ├── windowManager.js  drag/resize/focus/minimize, PDA full-screen mode
    │   ├── theme.js          stamps data-tint / data-wallpaper on <html>
    │   ├── desktop.js        icons + Aero gadget (Buzz, meters, Nudge)
    │   ├── taskbar.js        Start menu, task buttons with RAM bars, tray
    │   ├── notify.js         balloon notifications
    │   ├── tutorial.js       the coach panel: the tour, then the goal tracker
    │   ├── spotlight.js      dim + ring + arrow on the control the step is about
    │   ├── bsod.js           Format C: stop screen, POST wipe, confirm dialog
    │   ├── audio.js          synthesised SFX + BGM, heat distortion, portal mute
    │   ├── ads.js            the only module that calls the portal ad SDK
    │   ├── welcomeBack.js    the offline-earnings report
    │   └── dom.js            element/throttle/bar helpers
    ├── apps/                 one module per window body
    │   ├── registry.js       id → implementation, placeholder fallback
    │   ├── aerochat.js       core idle engine
    │   ├── retroamp.js       playlist deck (global multipliers)
    │   ├── lemonwire.js      seed slots, disk usage, the connection shop
    │   ├── shield99.js       antivirus window, quarantine, the taskbar tray icon
    │   ├── aeroburn.js       disc burner and shelf
    │   ├── aerosweeper.js    the minefield, and the nerve it takes to sweep it
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
  a bin that emptied itself overnight would cost nothing. And so is Auto-Defrag's pass: it
  is a job on a machine somebody is watching, taxing production they can see.
- **Wall clock** (`Date.now()` timestamps) — buffs in `core/buffs.js`, autosave, offline
  earnings, and every ad timer (Shield99's cooldown, and the allowances and cooldowns in
  `core/ads.js`). A 60-second buff should be over when you come back an hour later, and so
  should a 90-second ad cooldown; a *daily* allowance the player can only reach by leaving
  the tab open until midnight is not a daily allowance.

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

## Ads are a system, not a call site

Monetization is split three ways, along exactly the same seam as Shield99's quarantine:

```
ui/ads.js       the SDK: is an ad possible, show one, resolve watched / not watched
core/ads.js     pacing + pricing: daily allowance, cooldown, what an offer is worth
core/game.js    applying it: a buff, a Buzz grant, a token, render progress
```

`src/core/**` never sees the SDK, so every reward stays testable in plain Node
(`tests/ads.test.js`), and `src/ui/ads.js` is the only file in the project that names
`SDK.ad` or `SDK.banner`. A placement is added by putting numbers in `ADS`
(`src/data/balance.js`), a `case` in `rewardFor`, a branch in `game.claimAdReward`, and a
button that calls `ads.claim(id)`.

Rules the whole thing depends on:

- **`ADS.enabled` is the master switch, and it is checked in one place.**
  `ui/ads.js`'s `available()` folds it in, so switching the system off cannot
  leave a stray button behind — and `game.extractQuarantine()` reads the same
  flag to pay Shield99's loot in full, because "nothing is gated behind an ad"
  has to survive the ads being turned off. It is `false` for the basic-launch
  build.
- **A reward is granted on `adFinished` and nowhere else.** `ads.rewarded()` resolves
  `false` on `adError`, and `claim()` re-checks `game.adOffer()` *after* the video —
  a minute passed, and the render the player was boosting may have finished.
- **Nothing is gated behind an ad.** Every placement is a bonus on a mechanic that already
  works. The single exception is the quarantine lootbox, which keeps its
  `SHIELD99.manualRewardFraction` path — an ad blocker must never remove a mechanic.
- **If an ad cannot run, no button is rendered.** `ads.available` folds in "no SDK"
  (off-portal) and `hasAdblock()`, and every offer asks it first. A button that cannot do
  anything is worse than no button.
- **Allowances are wall-clock, and survive a Format C:.** They are a real-world budget, not
  run progress — a cap the player can clear by prestiging is not a cap (`resetForPrestige`
  carries `state.ads` across the wipe).
- **The portal paces interstitials; we only protect the first session.** CrazyGames enforces
  one midgame ad per three minutes with its own safeguards, and its guide asks games not to
  stack a second cooldown on top. `midgameAllowed()` therefore checks only what the portal
  cannot know: tutorial done, enough playtime, enough session, and no rewarded ad in the
  last `afterRewardedSeconds`.
- **An interstitial announces itself.** An idle game has no level boundary to hide a break
  behind, so `midgame()` puts a three-second countdown over the desktop that also swallows
  clicks. Without it the ad lands mid-Nudge and reads as a click trap. The Format C:
  sequence passes `{ silent: true }` — the stop screen already is the pause.
- **The payout boost is a bonus, not an advance.** `pendingPrestigeDollars` is the gap
  between what lifetime Buzz has ever been worth and what has been paid out, so folding a
  +50% into `dollarsEarnedTotal` would borrow it straight back from the next wipe.
  `resetForPrestige(..., { bonusDollars })` pays it into the wallet only.

## Buildings, upgrades and Legacy (economy v2)

The economy is three layers, and the boundary between them is the whole design.

**Buildings** (`src/data/buildings.js`, `src/core/buildings.js`). Twelve steps,
each ~12× the cost and ~10× the output of the one above it. A unit costs
`ceil(baseCost × 1.15^owned)` and the growth factor is *fixed for all twelve* —
one `unitCost()` rather than twelve tuning knobs. AeroChat is the only special
case: its units are `state.chat.bots` and stay there, resolved through the
roster's `unitsFrom` so nothing else needs an `if`.

**Two rules that are easy to break by accident:**

- **Production does not depend on a window being open.** That was the shipped
  behaviour and it is deliberately gone. A building is a thing you own, not a
  thing you babysit. What an open window buys is *active participation* —
  status bonuses, playlists, seed slots, scans — and those pay through the buff
  system, which is where anything temporary belongs.
- **A building's upgrades multiply only that building.** The global chain is
  hardware and Legacy, nothing else. Twelve buildings' worth of upgrades
  compounding globally is a number nobody can read or balance.

**Upgrades** (`src/data/upgrades.js`, `src/core/upgrades.js`). Four patterns:
tiered doubling (six per building), one buddy-scaled cross-building bonus each,
five synergy pairs that pay both directions asymmetrically, and AeroChat's
exception — flat Buzz/sec per *distinct building owned* rather than another
doubling of the cheapest thing in the game.

Every upgrade has a **double gate**: Buzz *and* a unit count. That is not
difficulty, it is the visibility hook the economy audit found missing — the unit
requirement is printed while it is unmet, and tiered upgrades reveal exactly one
rung ahead, so there is always one visible goal per building and never a wall of
twelve.

**Legacy** (`src/core/legacy.js`). The permanent multiplier, fed by
`state.allTimeBuzz` — its own accumulator, deliberately *not* Dollars. Dollars
are spent in a shop; a permanent multiplier that shares a currency with a shop
puts one number in charge of two competing purchases. The curve is cubic
(`floor((allTimeBuzz / divisor)^1/3)`), so the reward is linear in the level
while the level is cubic in the Buzz.

There is no per-run activation step. An earlier draft made the player re-buy the
bonus after each wipe — a ritual the first time and a chore the fiftieth. It
applies automatically and the POST screen reports it. **Legacy Slots** carry one
chosen upgrade through a Format C: each; `resetForPrestige` is the only place an
upgrade is ever granted without being paid for, and it re-grants only what was
both slotted *and* actually owned.

### Showing the working

`econ.getProductionBreakdown(state, id)` returns a building's output itemised by
source, and the UI prints those parts rather than recomputing them. This is a
hard rule, not a convenience: **no multiplier may act invisibly.** A synergy the
player cannot see does not exist for them, so a purchase that helps another
building also emits `SYNERGY_APPLIED` and the shell says so out loud.

## Retention systems: breach, mini-games, achievements

Three systems layered on the economy, all DOM-free in `core/` and drawn in `ui/`.

**Darknet Breach** (`src/core/breach.js`, `src/ui/breach.js`). A ratio the player
builds — risky buildings over Shield99 licences — escalating through three
phases. Four properties make it a risk system rather than a punishment: the
player causes it, escalation is slow while recovery is 3× faster (so buying the
counterweight visibly works), every phase can be answered, and it can be bought
off permanently with Incognito Mode. It runs on `dt`, not the wall clock: a
player who closes the tab for a week must not return to a machine that was
robbed in their absence.

Nothing in it can touch `lifetimeBuzz`, `allTimeBuzz` or `dollarsEarnedTotal`. A
crisis may cost a wallet; it may never cost permanent progress.

**Mini-games** (`src/core/minigames.js`, `src/ui/minigames.js`). Five of the
twelve buildings, unlocked by that building's tier-3 upgrade. Every one funnels
through a single `applyMinigameReward()`, which is what guarantees the two
economic rules hold: never a permanent multiplier, and never raw Buzz — only a
timed buff scoped to the building it was played in. Each game reports a
normalised 0..1 score and knows nothing else about the economy.

**Achievements** (`src/core/achievements.js`). Predicates over ordinary state,
never stored flags — same rule as cosmetics and goals, so a threshold can be
re-tuned without a migration and a badge can never get stuck. Only the unlock
timestamp is persisted.

The portal side is narrow on purpose (`src/ui/crazygames.js`): CrazyGames has no
achievement API, so the list is entirely ours and only two real hooks are used —
`happytime()` on exactly three curated moments, and
`reportGameCompletedPercentage()` behind a five-point step gate. Leaderboards are
documented and deliberately not wired: they are invite-only.

## The Aero charter is a test

`docs`-level design rules rot. `tests/aeroCharter.test.js` runs the banned-element
list from the GDD against the source: no pill buttons, no Material elevation, no
thin fonts, no font stack without Segoe UI/Tahoma, no hamburger, no iOS toggle,
no raw `prefers-reduced-motion` query that ignores `data-motion`, and the dark
theme must stay an unlock rather than the default.

Emoji are handled as a **ratchet**: the apps that predate the charter use them
throughout, and redrawing ~29 glyphs is a real art task. So no *new* file may
introduce emoji, the debt list may only shrink, and the test fails if the list
goes stale in either direction.

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

### The Mainboard is a fifth track, not a special case

Every other track makes a run produce faster. The Mainboard makes a run *worth more*:
it divides `PRESTIGE.divisor` down, so the same lifetime Buzz banks more Dollars. It is
the answer to the mid-game wall the square root creates — past a point every doubling of
the payout costs four times the Buzz, and no amount of production outruns that.

It is written in **payout percentages, not divisors**, and that is the load-bearing part.
Dollars go as the square root of Buzz, so `prestigeDivisor()` is `divisor / payout²`; a
row that advertised "divisor: 600" would be a number no player can price, where "+20%
Format C: payout" is exactly what lands. It keeps the same contract as every other track.

Two consequences:

- **The gain is retroactive.** `lifetimeDollarValue()` re-prices the whole history, so
  buying a tier makes the pending payout jump on the spot rather than starting to pay
  from the next Buzz onward. That is the moment the purchase is *for*. It cannot run away
  with the economy — the track is four tiers long, and `pendingPrestigeDollars` is still
  the gap between value and what has been paid, so nothing is ever paid twice.
- **`buzzForDollars` takes a divisor, not a state.** It stays a piece of maths; callers
  that have a machine pass `prestigeDivisor(state)`, and the progress bar keeps filling.

## Auto-Defrag: one system, two clocks

Bloat is the pressure loop, and it only works on a player who is *present*. An overnight
absence used to guarantee a desktop found at 100%, so the first move of a session was a
Format C: whether or not the run was ready for one. `core/defrag.js` is the purchasable
fix, and it is deliberately a scheduler rather than a stat — it does nothing until bloat
is already bad, and it costs production while it works.

It splits along the same seam as everything else timed here:

- **Online**, `updateDefrag(state, dt)` is a simulation-time job: it engages at
  `DEFRAG.startAt`, drains bloat, and disengages at zero. Wall clock would let a
  backgrounded tab defragment a machine nobody is using.
- **Offline**, there is no pass to watch and no production to tax, so `offlineBloat()` is
  a *ceiling* on what the absence may accrue — `max(current, offlineCap)`, never a flat
  `offlineCap`. It limits what being away can add; it cannot hand back bloat the player
  had already run up before they closed the tab, or parking a filthy machine overnight
  would be a free defrag.

It is bought with Dollars, so it carries through `resetForPrestige` like hardware does —
a bloat fix that has to be re-earned every run is another chore, not a fix. The live pass
does not carry through: there is no disk left to defragment.

## Cosmetics: chosen state, derived unlocks

Display Properties stores exactly one id per kind (`state.cosmetics.tint` /
`.wallpaper`) and nothing else. **Which cosmetics are unlocked is derived every time it is
asked**, from `lifetimeBuzz`, `prestigeCount` and `dollarsSpentTotal` — the same argument
`core/goals.js` makes: no unlock list to migrate, no cosmetic that can get stuck locked,
and re-tuning a threshold takes effect on the next frame.

That is only safe because **every counter it reads survives a Format C:**. An unlock can
therefore never be revoked, which is what lets the choice be stored while the permission
is not. `selectedCosmetic()` still falls back to the default for an id it cannot honour
(a retired cosmetic, a hand-edited save) — the desktop has to be drawable from any state.

`ui/theme.js` is the only writer of `data-tint` / `data-wallpaper` on `<html>`, exactly as
`ui/motion.js` is the only writer of `data-motion`, and `styles/themes.css` is the only
reader. A tint overrides *tokens* rather than components, which is why themes.css is
imported straight after tokens.css — see the cascade note on `.glass`. Two things it has
to reach beyond `.glass`: `--wallpaper`, which `body` paints, and `--chrome-lit` /
`--chrome-deep`, the taskbar slab — without those, picking Toxic Green tints every window
and leaves a blue taskbar under them.

### The wallpapers are the only real art in the build

Tints are still pure CSS. Wallpapers are photographs, and that costs bytes on the one
asset that blocks the first frame — so three things are deliberate:

- **They are built, not committed as shot.** `art/wallpapers-src/` holds the originals;
  `node art/optimize-wallpapers.mjs` fits them to 1920×1200, re-encodes at q0.82 as WebP
  and emits a 192px thumbnail beside each. That is 8.1 MB of source down to 0.85 MB
  shipped. WebP rather than JPEG for the last third of that: same photograph, same
  apparent quality, and no browser that can run this game lacks the decoder. It drives
  whatever Chromium is on the machine rather than adding an image toolchain — see
  `art/lib/chromium.mjs`, which `art/optimize-icons.mjs` shares.
- **The icons are built the same way.** `node art/optimize-icons.mjs` re-exports
  `public/icons/*.png` at 96px — 3× the largest size any of them is drawn at, where they
  used to ship as 256px exports — and writes the buddy sprite as WebP. 823 kB of art down
  to 180 kB, none of it visible to the player.
- **The thumbnail is not a nicety.** Display Properties shows every wallpaper at once, so
  without it, opening My Computer downloads the full set — more bytes than the rest of
  the game together, to fill four chips eighteen pixels wide. They come in under Vite's
  `assetsInlineLimit`, so they end up inlined in the CSS and cost no requests at all.
- **They live in `src/assets/`, not `public/`.** `vite.config.js` sets `base: './'` so the
  build can be dropped into a portal subdirectory; an asset Vite processes gets a hashed,
  correctly-relative URL, where a `public/` file has to be referenced by an absolute path.

Naming a wallpaper happens in exactly two places, and `tests/cosmetics.test.js` asserts
they agree: the id in `data/cosmetics.js` (which is the file stem) and the
`--wall-<id>` / `--thumb-<id>` pair in `themes.css`.

Two things the photographs broke that the gradient had been quietly guaranteeing, both
fixed in `desktop.css`: **desktop icons** now carry a three-layer halo rather than one
soft shadow (two wallpapers put near-white cloud directly under the icon column, where
the gradient never passed ~55% luminance), and the **gadget** now paints the taskbar's
`--chrome-lit`/`--chrome-deep` slab instead of plain `.glass`. It is the other piece of
chrome sitting *directly* on the wallpaper — every window has 7.css's opaque frame behind
its text and the gadget does not — so near-white text on a sheet of translucent white
stopped working the moment a wallpaper was brighter than the glass.

## Onboarding: the tour, then the tracker

Two modules, one panel, and a hard line between what is scripted and what is
derived:

- **`core/tutorial.js`** is the five-step script. Each step completes on
  something the player *did*, never on a timer, and its `cta` is the four-word
  imperative the spotlight puts on screen. A step that costs Buzz also declares
  `cost`, and `stepGate()` reports the shortfall: an objective the player cannot
  afford is shown as a goal with a bar and the arrow goes back to the Nudge
  button, rather than pointing at a control that will not respond. The gate
  changes what is *pointed at*, never what completes the step.
- **`core/goals.js`** takes over when the script runs out. A goal is a predicate
  plus a progress fraction over ordinary state — nothing about it is persisted,
  so there is no migration, no goal that can get stuck completed, and no second
  definition of "is LemonWire unlocked" to drift away from `data/apps.js`.
- **`ui/tutorial.js`** renders whichever of the two is live, and **`ui/spotlight.js`**
  is only ever attached to the scripted half.

The spotlight is a dim layer with a ring, an arrow and a label, and three of its
properties are load-bearing rather than cosmetic:

- **It cannot block input.** The whole layer is `pointer-events: none` and the
  "hole" is a `box-shadow` spread, not a real cut-out — there is nothing in it
  that can swallow the click it is asking for.
- **It resolves targets every update.** They are functions returning elements,
  not stored coordinates, so dragging a window or rotating a phone keeps the
  ring in the right place, and a target that goes away hides the layer instead
  of pointing at bare desktop.
- **It only points at things that are actually on top.** Existing in the DOM is
  not enough — in PDA mode a desktop icon, a background window's controls and a
  minimised app all keep perfectly good rects while being completely buried, so
  targets are checked with `elementFromPoint` and each step falls through a
  chain of candidates. That is why the last step finds the desktop icon on a
  desktop and the Start menu's My Computer row on a phone.
- **It gets out of the coach's way.** The coach, the Start button and the PDA
  Nudge dock all live in the bottom-left, so the cue flips to the other side of
  its target when it would land on the coach, and only slides sideways (losing
  its arrow) when neither side is clear. Burying "Skip the tour" is the one
  thing an onboarding layer must never do.

The coach also **publishes its measured height** as `--coach-height`, exactly
as the gadget publishes `--gadget-height`, and PDA-mode windows reserve it in
their bottom inset. This is not cosmetic: a full-screen sheet running under the
coach put it straight over AeroChat's buy row and AeroSweeper's cash-out — so
the tutorial was covering the very control it was pointing at.

A brand-new save also opens on a **bare** desktop: `main.js` holds AeroChat back
until the first Nudge, so the first screen is one lit button, and the window
arrives as the payoff for pressing it.

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

## Chrome without borders

Depth in this shell comes from light, not outlines: `--emboss` (a lit top edge
and a shaded bottom one) for raised surfaces, `--emboss-well` for recessed ones.
A 1px border on a translucent panel stacks against every neighbour's, which is
how a taskbar full of buttons turns into a grid of hard lines.

`.glass` lives in `tokens.css` rather than `index.css` for a cascade reason
worth knowing: `@import` rules are placed *before* everything else in a
stylesheet, so a utility class authored in `index.css` outranked every component
that tried to override it at equal specificity. The taskbar's blue gradient, its
square corners and the coach's cyan rule were all written and none of them
rendered.

## The Nudge dock

On a phone the gadget is pinned to the top of the screen, which is the worst
possible home for the button a clicker is built around. Under the PDA
breakpoint the Nudge button leaves the gadget's grid and docks above the
taskbar, and the window stack, the balloons and the coach all reserve
`--nudge-dock-height` so nothing lands under it.

Two things that look like details and are not: the button is centred with
`left`/`right` insets rather than `translateX(-50%)`, because `nudge-shake`
animates `transform` and would throw a centred button half its width sideways on
every tap; and the gadget drops its `backdrop-filter` in PDA mode, because a
filtered element becomes the containing block for `position: fixed` descendants
— with it on, the dock pinned itself to the bottom of the *gadget*, off the top
of the screen.

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

## The one app you can lose

AeroSweeper is the only window with a *stake*. Every other app in the OS is a
place to spend and wait; this one asks the player to decide when to stop, and
gets its tension from the fact that they can be wrong.

Four consequences the code depends on:

- **The board is not in `game.state`.** A round lasts a minute and means nothing
  once it is banked. `game.startSweeperRound()` spends the token and *returns* a
  round; the app module holds it, and what gets written back is one number,
  through `game.endSweeperRound(tiles, { hitMine, cleared })`.
- **The round carries the injected `rng`.** The mine layout is not decided until
  the first click — that is what makes the opening move safe — so the round
  needs randomness after `createGame()` has handed it out. It gets the game's
  `rng`, not `Math.random`, like every other mechanic here.
- **Closing the window cashes out.** The token is already spent, and losing a
  swept board to a mis-tapped close button is the kind of thing that stops
  someone opening the app at all. The cleanup function banks the round.
- **The reward is an existing system.** The combo is an ordinary `click` buff,
  so it expires on the wall clock, shows up in the buff list, and is already
  inside `clickPower()`. The only bespoke part is that the Nudge button goes red
  while it runs — `econ.sweeperCombo()` exists so the gadget can ask.

The penalty is deliberately soft: a mine **halves** the banked multiplier rather
than taking it. The entire round is an argument for opening one more square, and
a penalty that erases the session teaches the player to stop after the first
click instead — which is the one outcome that makes the app pointless.

Apps also receive `audio` in their mount context for exactly this app: a flood
fill turns over thirty squares in one click, which is far too fast and too
transient to route through the event bus.

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
