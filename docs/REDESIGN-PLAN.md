# Master Redesign — Implementation Plan

The design is in `aeroos-gdd-v2.md` (the single design reference). This file is the
*engineering* plan: what changes in which file, in which order, and what has to be true
before each phase can start. Read `ARCHITECTURE.md` first — nothing here suspends its
rules.

Phase numbering matches GDD §12.

---

## Where the redesign meets the existing code

The GDD asks for a Cookie-Clicker building model. The codebase already has exactly one
building, spelled out longhand: `state.chat.bots`, `CHAT_BOT.baseCost`,
`econ.botCost()`, `econ.chatMilestoneMultiplier()`. Phase 0 is therefore not "add a new
system next to the old one" — it is **generalising the AeroChat one into twelve**, and
deleting the longhand. Anything else leaves two economies to keep in sync.

Three existing mechanics are *not* buildings and stay where they are:

| Mechanic | Why it stays outside the building model |
| --- | --- |
| AeroSweeper | GDD §1: standalone active mini-game, never in the production formula. A negative test guards this (§13). |
| Hardware / Dollars | GDD §2.7: a second, Dollar-priced currency layer. Untouched except that CPU now scales the 12-building sum. |
| LemonWire seeding | A *second* producer inside a building that will also have units. See "Known overlap" below. |

### Known overlap, deliberately deferred

`LemonWire` is building #5 *and* still owns the seed-slot producer
(`econ.seedBuzzPerSecond`). Until Phase 2 gives LemonWire its unit UI, its unit count is
0 and the two cannot double-count. Phase 2 resolves it by making the seed slots the
*visual* layer of the unit count (`w32-buy` → `[Search]`/`[Download]`), and deleting
`seedBuzzPerSecond` from `baseBuzzPerSecond`. Same story, smaller, for RetroAmp: it is
building #2 *and* a global multiplier via playlists. The playlist multiplier is a
different axis from unit production, so those two coexist permanently.

### Deviation from the GDD, and why

**GDD §10's refund formula refunds nothing.** `estimateInvested` reads `app?.units ??
app?.bots`, but Shield99, AeroBurn and Aero Studio never had a unit count — they were
one-off installs. Run as written, every live player is compensated `0` Buzz and the
"Your investment was refunded: [X] Buzz" screen shows a zero. Phase 1 instead refunds
what those three actually cost: install price (`apps.js`) for each one installed, plus
Aero Studio's per-upgrade spend, plus the Buzz still sitting on unplayed AeroBurn discs.
Everything else in §10 is implemented as specified.

---

## Phase 0 — formula skeleton *(this is the foundation; nothing else starts first)*

Precondition per GDD §12: the emergency hardware patch ships and stabilises separately.

**New files**

- `src/data/buildings.js` — the 12-building roster. `baseCost` is `10 × 12^(n-1)` and
  `baseProduction` is `0.5 × 10^(n-1)`; both written out literally because designers tune
  them, with the pattern in a comment.
- `src/core/buildings.js` — the mechanic: `unitCost`, `unitCostBulk`, `affordableUnits`,
  `milestoneMultiplier`, `nextMilestone`, `buildingProduction`,
  `totalBuildingProduction`, `isBuildingUnlocked`, `hasMinigame`. Same shape as
  `core/lemonwire.js` — a mechanic module that `economy.js` composes and re-exports, so
  the "formulas live in economy" rule is honoured through one front door.
- `src/core/legacy.js` — `legacyLevel`, `legacyMultiplier`, `legacyProgress`.

**Changed**

- `src/data/balance.js` — add `BUILDING` (cost growth, the milestone step table, the unit
  rail, the mini-game threshold) and `LEGACY` (divisor, per-level bonus). Delete
  `CHAT_BOT`; every field of it is now either a building-roster entry or a `BUILDING`
  constant.
- `src/core/state.js` — `SAVE_VERSION = 4`; add `buildings`, `allTimeBuzz`, `legacy`,
  `achievements`, `event`, `crazyGames`; `chat` keeps only `{ event, nextEventIn }`.
  `resetForPrestige` carries `allTimeBuzz`, `legacy`, `achievements`, `crazyGames` and
  the Dollar-bought Airplane Mode through the wipe.
- `src/core/save.js` — the single `3 → 4` migration (GDD §10), refund corrected as above.
- `src/core/economy.js` — `baseBuzzPerSecond` sums all twelve buildings;
  `globalMultiplier` gains `legacyMultiplier`; new `getProductionBreakdown(state, id)`
  (GDD §2.8) as the *only* accessor the UI uses; `bloatGain` counts total units rather
  than buddies.
- `src/core/game.js` — `buyUnits(buildingId, amount)` replaces `buyBots`; `grantBuzz`
  also accrues `allTimeBuzz`; `formatC` recomputes and stamps the legacy level.
- Callers: `core/goals.js`, `core/tutorial.js`, `core/statusEvents.js`,
  `apps/aerochat.js`, `main.js`.

**Two behaviour changes worth calling out to playtesters**

1. Buildings produce whether or not their window is open (GDD §5). AeroChat used to stop
   paying when closed. RAM still bounds how much can be *on screen*; it no longer bounds
   income.
2. AeroChat's milestone curve changes from additive (`+8%` per 25, ×2.6 at 500) to the
   shared step table (×32 at 500). The 500-buddy per-run cap goes with it — the top
   milestone tier is defined as "500+".

**Tests** (GDD §13): monotonicity per building, milestone step boundaries, legacy never
decreases and survives Format C:, `3 → 4` migration and refund arithmetic, AeroSweeper
isolation.

## Phase 1 — legacy building sunset

Migration and compensation ship in Phase 0's migration; Phase 1 is the *removal*:
`core/shield99.js`, `core/aeroburn.js`, `core/aerostudio.js`, their app modules, data
(`cds.js`, the threat table), their `EVENTS`, their ad placements (`renderBoost`), and
their branches in `globalMultiplier` (`infectionPenalty`, `renderPenalty`). The diegetic
"System Updating…" screen reuses `ui/bsod.js`. This is the only backwards-incompatible
step for live players, so it goes early and alone.

## Phase 2 — Faz 1–2 building content

AeroChat, RetroAmp, ChainMail, AeroBoards, LemonWire, GeoPage. Per building: an app
module under `src/apps/`, a roster entry in `data/apps.js`, a `w32-buy` control (GDD §4),
and a milestone celebration (2–3 s, no decision). Milestone celebrations want one shared
driver — a `MILESTONE` event payload plus a per-app handler — not six bespoke timers.
Resolves the LemonWire overlap above.

## Phase 3 — Faz 3 building content

VidChat, FlashFarm, BotNet.

## Phase 4 — Faz 4 building content

The Algorithm, MindSync (WebGL + the mobile CSS/SVG fallback), The Hive (chrome-less
desktop anchor — a new `windowManager` footprint category, and the accessibility
question left open in GDD §14.4 has to be answered before it ships).

## Phase 5 — mini-game engine

Five games behind one `applyMinigameReward(buildingId, result)` seam. Rewards are
building-scoped by rule; nothing here may touch `globalMultiplier`.

## Phase 6 — Buffer Overflow event system

`core/feedRatio.js` → three escalating phases → Airplane Mode purchase → cosmetic unlock.
Ghost notifications steal a percentage of `buzzPerSecond`, so they belong in the
multiplier chain, not in a bespoke subtraction.

## Phase 7 — achievements + CrazyGames SDK

First-party list and window, then the three sanctioned SDK calls. `happytime()` stays
curated (GDD §8.3). Every SDK call goes through `ui/` — core never touches the browser.

## Phase 8 — mobile + accessibility pass

PDA layouts for all twelve, Reduce Motion for The Hive, WebGL fallback verification,
44 px targets, real-device testing.

## Phase 9 — regression + balance

GDD §13 in full, plus the simulation calibration §14.1 defers to.

---

## Calibration findings

GDD §14.1 defers every number to simulation. Phase 0 ran the first pass — 400k ticks
(≈11 in-game hours) of optimal buying, nudging every tick. What it found:

**The cost/production ladders hold.** All twelve unlock in order, no building is ever a
strictly dominant purchase, and the per-building shares of total output sum to exactly 1.
The 12×/10× rung ratio does the job it was picked for.

**The Legacy divisor was wrong by eight orders of magnitude.** At the first-guess 50,000
the run reached **legacy level 183,799 — a ×1,839 multiplier**, larger than every other
factor in the chain put together. Raised to `1e13`, sized off the endgame: twelve
buildings at the top milestone make ~8e14 Buzz/sec, so finishing the content means
~1e20–1e21 all-time Buzz, which is level 215–464 (+215% to +464%). That is a prestige
layer; ×1,839 is a replacement for the game.

**One design question this leaves open.** A cube root with a linear reward cannot serve
both ends of a twenty-order-of-magnitude economy. Sizing the divisor for the endgame
pushes the *first* level into phase 3, so the first several Format C:s report "Legacy
Level 0" — which reads badly on a screen whose whole job is to announce the level.
Three ways out, all design calls rather than engineering ones:

1. Accept it. Legacy is a late-game layer and the §8.2 "first Legacy Level" achievement
   is a mid-game milestone, not an early one.
2. Raise `PRESTIGE.minLifetimeBuzz` so the first Format C: is itself a later event.
3. Add a second term to the reward curve — a flat bonus for the first few levels on top
   of the cubic one — so early prestiges pay something without inflating the endgame.

Nothing downstream is blocked on the answer; the constant is one line in `balance.js`.

---

## Rails that hold across every phase

- `src/core/**` never touches the DOM, so every phase above lands its maths first and its
  window second.
- No UI module computes a game number. If a window needs one, it comes from
  `getProductionBreakdown()` or another `economy.js` export.
- New persisted fields get a default in `createInitialState()`. `SAVE_VERSION` only moves
  when an existing field changes meaning — which is Phase 0, once.
- Every number in `data/`, never inline.
