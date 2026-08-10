# One-week build plan

A week from empty repo to a portal-submittable build of **AeroOS — The Messenger Era**.
Each day is a Jira epic (AO-2 style) with its sub-tasks, the files it touches, and a
definition of done. Ship the day's DoD before starting the next day — the schedule assumes
every day ends on a build that runs.

Ticket IDs are the Jira board's, and only exist for days the board has scoped
(Days 1–6). Later days list the work without IDs — they get numbered when their
epic is created.

**Ground rules for every day**

- `npm run check` (tests + build) must pass before the day is closed.
- No day may leave the desktop unbootable; incomplete apps use the placeholder body.
- Balance constants go in `src/data/balance.js`, never inline in a mechanic.
- New persisted fields need a default in `createInitialState()` and a save test.

---

## Day 1 — Skeleton + core loop (AO-2) ✅ shipped

| Ticket | Task | Status |
| --- | --- | --- |
| AO-3 | Set up project scaffold (HTML/CSS/JS) | ✅ Vite + 7.css + ES modules, `npm run dev` |
| AO-4 | Build desktop window manager (drag, resize, focus, minimize) | ✅ `src/ui/windowManager.js`, PDA mode included |
| AO-5 | Implement Buzz currency, Nudge button, AeroChat bots | ✅ `src/core/economy.js`, `src/apps/aerochat.js` |
| AO-6 | Add localStorage save/load stub | ✅ `src/core/save.js` — versioned, migrating, offline earnings |

Also landed as the foundation the rest of the week builds on: fixed-timestep loop, event
bus, RAM accounting with out-of-memory refusal, bloat pressure, hardware shop and the
Format C: payout formula, taskbar with per-app RAM bars, balloon notifications, 54 unit tests.

**DoD:** desktop boots, AeroChat opens, Nudge pays Buzz, bots generate idle Buzz, progress
survives a reload, mobile renders as full-screen modals. ✅

---

## Day 2 — AeroChat (AO-7) ✅ shipped

| Ticket | Task | Status |
| --- | --- | --- |
| AO-8 | Build AeroChat buddy list UI | ✅ grouped Online/Away list, derived identities, rotating statuses |
| AO-9 | Implement buy-a-bot mechanic (passive Buzz generation) | ✅ ×1/×10/Max with live costs, buddy-count milestones |
| AO-10 | Add rotating status-message bonus events | ✅ claimable "hot" statuses backed by a typed buff system |

Built underneath these, because AO-10 needed it: `src/core/buffs.js` (typed, expiring,
stacking multipliers) and `src/core/statusEvents.js` (spawn/claim/lapse with injected
randomness). Both are the machinery RetroAmp, rewarded ads and every later timed bonus will
reuse — the Day 3 playlists are a table entry, not a new system.

Buddies are *derived* from their index rather than stored, so a 500-buddy list costs nothing
in the save file and identities stay stable across reloads.

**DoD:** the buddy list reads as a living MSN window, buying has a visible goal, and status
bonuses can be claimed, ignored or missed without ever punishing the player. ✅

---

## Day 3 — Tutorial gating + RetroAmp (AO-11) ✅ shipped

| Ticket | Task | Status |
| --- | --- | --- |
| AO-12 | Scripted tutorial unlock sequence (AeroChat only → bottleneck → RetroAmp) | ✅ five-step coach, hardware hidden until the first bottleneck |
| AO-13 | Build RetroAmp app with playlist selection UI | ✅ `src/apps/retroamp.js` — LCD display, visualiser, playlist deck |
| AO-14 | Two playlists (soft permanent + heavy 5-min burst) | ✅ SOFT SIGNALS ×1.15 forever, IRON OVERDRIVE ×3 for 5 min |

The two tickets turned out to be one mechanism: the heavy playlist's memory cost **is** the
tutorial's bottleneck. A stock machine runs AeroChat + RetroAmp at 96/128 MB, so loading
IRON OVERDRIVE is refused — and that refusal is what reveals My Computer and the CPU/RAM
readouts, exactly as GDD 7 describes. The player learns "I need better hardware" by being
stopped by it rather than by being told.

Playlist multipliers are **not** buffs: they derive from `state.retroamp`, so they survive a
reload, and the multiplier only pays while the window is open — otherwise closing RetroAmp
would hand back its 64 MB and keep the bonus for free.

**DoD:** a first-time player goes clean desktop → first Buzz → first buddy → RetroAmp →
playlist → memory wall in about a minute, and a returning save never re-enters the tour. ✅

---

## Day 4 — Format C: prestige system (AO-15) ✅ shipped

| Ticket | Task | Status |
| --- | --- | --- |
| AO-16 | Dollars currency + lifetime Buzz calculation | ✅ payout curve made legible: progress bar and "next $ at N Buzz" |
| AO-17 | BSOD / wipe animation for Format C: | ✅ confirm → stop screen → POST wipe → clean desktop, skippable |
| AO-18 | Hardware upgrade shop (CPU/RAM/GPU/HDD) | ✅ tier pips, current effect, and what the next purchase adds |
| AO-19 | Hardware stats as simplified flat-percentage effects | ✅ tiers contribute additive percentages instead of replacing a stat |

AO-19 was the structural one. A tier used to *replace* an absolute stat
(`tickRate: 2.1`, `capacity: 1024`), so a shop row could not say what a purchase
was worth without diffing two opaque multipliers. Tiers now contribute flat
percentages that accumulate, and every capacity is derived the same way from a
base machine — so "+25% production" in the shop is literally the number applied.
Tier indices are unchanged, so old saves keep their hardware.

Click power was deliberately re-tuned in the process: it ran 1× → 120× across the
CPU track, which cannot be expressed as a sane percentage. It is now roughly
double the production bonus per tier (1× → 9.4×).

The BSOD is a real beat, not a fade — the wipe happens *between* the stop screen
and the POST screen, so the reboot reports the machine the player is about to
get. It is skippable at every stage: an unskippable cutscene on a repeatable
action is a churn machine on a 30-minute-session platform.

**DoD:** a player can see what a Format C: is worth before committing, watch the
machine die and come back, and spend the proceeds on upgrades that state their
own effect. ✅

---

## Day 5 — LemonWire + Shield99 + mobile (AO-20) ✅ shipped

| Ticket | Task | Status |
| --- | --- | --- |
| AO-21 | LemonWire P2P sim with virus safety net (50% floor) | ✅ `src/apps/lemonwire.js`, `src/core/lemonwire.js` |
| AO-22 | Shield99 tray icon + free first-virus rescue | ✅ `src/apps/shield99.js`, `src/core/shield99.js`, tray status in the taskbar |
| AO-23 | Mobile: taskbar modal slide-up for apps | ✅ shipped Day 1; added swipe-down-to-dismiss |
| AO-24 | Mobile: RAM usage bars under taskbar icons | ✅ shipped Day 1; fixed bars vanishing on big machines |

LemonWire is the first mechanic that can go wrong, and the HDD track finally has
a second job: shared files occupy real disk space and the drive hands out seed
slots, so a full disk means giving something up or buying a bigger one.

**Reworked after playtesting (the seeding refactor).** LemonWire shipped as a
download manager: queue a transfer, watch a bar, collect a lump sum, repeat. The
bars were the app — the decision behind them took two seconds and the waiting
took minutes, so the window turned into a chore that had to be visited rather
than a system that ran. It is now a *seeder*: a file in a slot pays Buzz every
second it is shared, and the only question the app asks is which files get the
slots. Rare files (few seeders) beat popular ones, risky files pay more than
safe ones, and big ones charge the disk for the privilege. The connection
(dial-up → fibre) is the Buzz sink that multiplies every slot at once.

The safety net is still the GDD's, exactly (GDD 6) — but the threat is now the
*reward*. Seeding attracts one every few minutes, and what happens next is the
whole reason to spend 48 MB on Shield99: with it open the threat is caught and
sealed in **quarantine**, where opening it is the game's rewarded-ad placement
(worth ~15 minutes of current production, with a 25% non-ad fallback so an ad
blocker never locks anybody out). With nothing watching, the old net runs
instead: the run's one free trial rescue catches it, otherwise the machine is
infected — production halved, sharing suspended, and **nothing already earned is
taken away**. A second infection cannot stack below that floor, and a Shield99
scan always cures it.

AO-23 and AO-24 were largely satisfied on Day 1, because PDA mode was built as a
first-class target rather than a fallback. What was actually missing: a
share-of-capacity RAM bar is invisible once the player owns 8 GB (32 MB reads as
0.4%), so bars keep a minimum width and carry the real numbers in their label;
and a full-screen modal had no gesture to dismiss it, so the title bar is now a
drag handle that slides the sheet away.

**DoD:** a virus can be caught, survived and cured, and the worst case is
provably a 50% floor — asserted in tests and measured in the browser. ✅

### Follow-up — the risk/reward overhaul ✅

The shipped version priced risk but did not *pace* it: every file downloaded at
the same speed, so `system32_SPEED_BOOST_2005.exe` — 3 MB, 302 "seeders", 75%
infection — finished before anything else and paid the same. Risk was a coin
flip you took for free.

Three changes make the choice real:

1. **Speed is per file, not per queue.** Seeders help up to ×2 (`seedersPerSpeedUnit`),
   risk throttles in bands (`riskSpeedTiers`), and above `fakeSwarmAtRisk` the
   advertised swarm is ignored outright — 302 peers on a malware stub are bots.
   The extreme band runs at ×0.002, so the 3 MB file takes ~25 seconds.
2. **Payout scales inversely to speed**, so waiting 200× longer earns 200× more.
   Pure inversion cancels exactly, though — it paid every file the *same* Buzz
   per second of waiting, leaving risk as downside with no upside. So
   `riskPayoutBonus` adds a premium on top; the danger curve now rises
   monotonically from ×2.9 to ×5.7 of current production per second of transfer.
3. **Deleting is not instant.** A deleted file goes to a Recycle Bin that holds
   its disk space for `trashSeconds` (5 minutes) and cannot be re-downloaded
   while it sits there. Disk pressure is now a decision with a cost rather than
   a button you press between transfers.

**DoD:** the most dangerous file in the list is the slowest and the richest per
second spent, and freeing space costs five minutes. ✅

---

## Day 6 — Juice + audio + offline (AO-25) ✅ shipped

| Ticket | Task | Status |
| --- | --- | --- |
| AO-26 | Source/generate SFX and BGM, integrate into game | ✅ `src/ui/audio.js` — everything synthesised, plus a tray mute |
| AO-27 | Prestige-tension escalation (system lag, red heat widgets, distortion audio) | ✅ heat gauge, dragging window transitions, desktop hitches, distortion bus |
| AO-28 | Offline earnings calculation | ✅ calculation shipped Day 1; now reported in a dialog that explains the HDD cap |
| AO-29 | AeroBurn CD system (1–2 CD types, survive prestige wipe) | ✅ MIX and OVERCLOCK discs, carried through Format C: |

**Audio ships as code, not assets.** Every sound is synthesised with WebAudio —
mechanical clicks, HDD chatter, a startup chime, the BSOD fall, a CD-writer
spin-up — and the BGM is a scheduled arpeggio rather than a loop file. That
keeps the bundle tiny, sidesteps the portal CSP entirely, and makes AO-27's
"distortion audio" a knob instead of a second set of files: a waveshaper on the
master bus whose curve follows system heat. The context only starts on a real
gesture (autoplay policy) and the tray has a mute.

**Heat is bloat with a face on it.** Players cannot read a 0..1 float, but they
understand 91°C. Heat rises with bloat and with what they keep open, and drives
one escalation across the whole shell: gauge colour, window transitions
dragging from 180 ms to 620 ms, occasional desktop hitches, and audio
distortion — all from `econ.heatRatio`.

**AO-28 was mostly done and honestly reported as such.** The calculation has
existed since Day 1, capped by HDD tier and unit-tested. What it lacked was a
moment: a balloon that fades in four seconds could not explain why 26 hours away
paid only 2 hours of Buzz. The dialog now shows away-vs-counted, and the
rewarded "2× offline Buzz" ad from GDD 8 has a seam waiting (`onDouble`).

**AeroBurn** discs are the only soft-currency asset that outlives a wipe. One
design fix fell out of testing: the burner itself now survives Format C: too,
because otherwise the discs were unreachable until the player re-earned its
install cost — precisely when the "starting boost for the next run" is meant to
help.

**DoD:** the machine sounds and feels worse as it bloats, offline time is
explained rather than announced, and a disc burned before a wipe pays out
after it. ✅

---

## Day 7 — Aero Studio, AeroSweeper, IoT Botnet, Mini-Mod

**Goal:** the last of the software roster, something to do while idling, and an
end-game ceiling.

- [ ] Aero Studio: a long GPU-scaled render with the biggest single payout —
      the GPU track still has no consumer, so this is what makes it felt.

- [x] AeroSweeper (`src/apps/aerosweeper.js`): the mini-game, paying Buzz and
      combo multipliers. **Minesweeper, not pinball.** A pinball table was built
      first and cut: a WebGL renderer and a hand-rolled physics solver is a lot
      of machinery to make a ball feel right in a window, and "feels slightly
      wrong" is the one outcome a mini-game cannot survive. A minefield is a
      grid of buttons and a flood fill — it is *exactly* what a browser is good
      at — and it takes a push-your-luck mechanic without being bent into one.

      Three design decisions worth recording:

      - The reward is a *click* buff, not Buzz. An idle game's active mini-game
        should hand the player a reason to go back to the button; a lump sum
        does the opposite.
      - The stake is always on screen. Every safe square is +0.1×, and the
        cash-out button shows what leaving now is worth — a push-your-luck round
        where the player cannot see what they are risking is just a button that
        sometimes disappoints.
      - **A mine halves the combo rather than taking it.** The whole round is an
        argument for opening one more square, and a punitive loss teaches the
        player to stop after the first click, which makes the app pointless.

      Tokens (one every two hours, wall clock, or one for fifteen minutes of
      production) are pacing rather than a paywall.

      The board lives in `src/core/sweeper.js` with no DOM, so
      `tests/sweeper.test.js` asserts the whole game in plain Node: that the
      first click and its neighbours are never mined, that the flood fill cannot
      uncover a mine, that a full sweep is detected, and that a mine leaves
      exactly half the multiplier.

- [x] Shell pass: the taskbar, the gadget and every meter lost their borders in
      favour of a lit/shaded bevel (`--emboss`), and the Nudge button now docks
      in the thumb zone on phones instead of sitting in the top corner of a
      status widget. LemonWire was re-skinned as the 2005 client it is
      parodying — lime chrome, dead search box, dark filter rail, segmented
      progress bars. See ARCHITECTURE.md for the two cascade traps behind them.

- [ ] IoT Botnet unlocked by the top CPU tier: hijack smart plugs/fans/bridges for
      large passive Buzz (GDD 5).
- [ ] Mini-Mod widget mode: collapse the OS into a thin vertical sidebar (GDD 3).
- [ ] Performance pass: keep the render step under budget with the sweeper board,
      many windows and 500 bots on a mid-range phone.

**Files:** `src/apps/aerosweeper.js`, `src/core/botnet.js`, `src/ui/miniMod.js`
**DoD:** 60 fps on a mid-range phone with a board open and the desktop full of windows.

---

## Day 8 — Monetization, audio, ship

**Goal:** the portal build (GDD 8). The first 60 seconds shipped on Day 3.

- [x] Rewarded ad hooks behind one adapter — `src/ui/ads.js` (not `monetization/`: the
      SDK is a browser API, and the same rule that keeps AudioContext out of `core/`
      applies here). The pacing and pricing half lives in `src/core/ads.js`, which knows
      nothing about the SDK and is unit-tested in plain Node.

      **Seven placements, not two.** The GDD scoped the Trojan Scan and the Internet Cafe;
      the platform's own clicker guide asks for rather more, and an idle game has the
      surfaces for it:

      | Placement | Where | What it pays |
      | --- | --- | --- |
      | Quarantine lootbox | Shield99 | the full payload (25% without an ad) |
      | Internet Cafe | welcome-back dialog | 2× offline Buzz |
      | Overclock | the gadget, always on screen | +100% to everything for 10 min |
      | Sponsor gift | the gadget | 30/15/7.5 min of production, diminishing daily |
      | Free token | AeroSweeper, when out of tokens | one board |
      | Skip ahead | Aero Studio, mid-render | +20% render progress |
      | Payout boost | the Format C: confirm dialog | +50% Dollars on that wipe |

      Every reward is priced in *seconds of current production* or as an existing buff, so
      an ad is worth the same share of a run at ten buddies and at five hundred. Daily
      allowances and cooldowns protect the economy instead of hiding the button, and they
      survive a Format C: — a cap you can clear by prestiging is not a cap.

- [x] Interstitial on Format C:, hidden behind the stop screen — plus the two other natural
      breaks a clicker actually has: a banked AeroSweeper round and a collected render. The
      SDK paces them (one per three minutes); we only gate the first session, since a
      player who meets an ad before they understand the loop does not come back. Outside
      the Format C: sequence a three-second countdown covers the desktop first and eats
      clicks, so a break never lands mid-Nudge.
- [x] Banner in the My Computer shop — a screen players read and plan on, per the banner
      guide, with the slot labelled, recessed and kept clear of every button. Re-requested
      no more often than the portal's refresh cooldown allows.
- [x] Ad blockers are a supported configuration: `hasAdblock()` is resolved at boot and
      every offer asks `ads.available` before rendering, so a blocked player sees a game
      with no dead buttons rather than videos that never play.
- [x] Audio pass — shipped Day 6 as `src/ui/audio.js` (not `core/`: AudioContext is a
      browser API). Clicks, HDD noise, chime, heat-driven distortion, synthwave BGM.
- [x] CrazyGames v3 SDK: `SDK.data` as the save backend behind `defaultStorage()`, and
      the portal's mute overriding `state.settings` on the master gain.
- [ ] Ship build: `npm run build`, size budget check, `dist/` verified on a phone,
      CrazyGames/Poki SDK smoke test **on the portal** — the SDK integration is so far
      verified only against a mock, since sdk.crazygames.com is unreachable from CI.

**Files:** `src/monetization/ads.js`, `src/ui/audio.js`, `src/core/save.js`
**DoD:** ads are wired behind the adapter and `dist/` runs from a static host.

---

## Post-launch — the funnel pass

The first day of portal analytics said the game converts badly and rates
brilliantly (9.1 from 11 votes against a 25% gameplay conversion), which is a
threshold problem rather than a quality one. [`docs/GROWTH.md`](GROWTH.md) is
the full diagnosis and plan; what shipped:

- [x] **Boot is no longer three blocking round-trips.** The SDK handshake is
      bounded by a timeout, and the username and ad-blocker probe were moved off
      the critical path. The desktop is interactive without waiting on any of
      them.
- [x] **The portal lifecycle is reported in order.** `loadingStop()` now
      precedes `gameplayStart()`, and both go through one idempotent controller
      instead of four call sites.
- [x] **The licence gate stopped blanking the page.** Anchored host matching
      plus ancestor-origin checks for framed contexts, and a readable card
      instead of `document.body.innerHTML = '…'`.
- [x] **Spotlight onboarding** (`src/ui/spotlight.js`) — dim, ring, arrow and a
      four-word instruction on the control each scripted step is about. A fresh
      save now opens on a bare desktop with one lit button; AeroChat arrives as
      the reward for the first Nudge.
- [x] **The coach outlives the tour** (`src/core/goals.js`) — thirteen derived
      objectives with a progress bar, so there is always a bar filling.
- [x] **The Nudge streak** (`CLICK.streak`) — clicking fast finally looks
      different from clicking slowly.
- [x] **No dead ad buttons** — `ADS.enabled` gates the whole system in one
      place, and the quarantine pays in full while it is off.
- [x] **A thumbnail built for a 250px grid cell** — `art/thumbnail.svg`,
      rendered with `npm run thumbnail`.

**Still open:** re-enable ads (`ADS.enabled` plus the commented SDK calls in
`src/ui/ads.js`) once the basic launch is approved, and read the metrics again
after 3–7 days per GROWTH.md §5.

## Economy v2 + retention systems ✅ shipped

The economy redesign (`aeroos-economy-redesign-refactor-plan-v2.md` and its
UI/safety patch) and the depth/retention GDD, built together because the GDD's
four systems all hang off the building layer the redesign introduces.

**The building layer.** Twelve buildings replacing "six apps that happen to
produce", each a thing you own N of on one shared price curve. Six are new:
AdBar, VidChat, Registry Doctor, GeoPage, IoT Botnet and Cloud Mainframe — and
IoT Botnet finally fills the `unlocksBotnet` CPU flag that had been sitting
unused in `data/hardware.js` since Day 4.

The structural change is that **production no longer depends on an open window**.
That was the shipped behaviour and it made every building a chore to babysit.
Windows now buy active participation instead, which is what they were always
actually good at.

**Three window footprints, not one.** AdBar, IoT Botnet and Cloud Mainframe never
open a window — they are adware, a botnet and a rented datacentre, and they live
in the system tray. That is period-correct *and* it caps the render load exactly
where the roster gets deepest, which is the same problem from two directions.
A five-window ceiling backs it up: opening a sixth retires the least-recently
used one to the taskbar rather than refusing.

**Upgrades with a double gate.** Buzz *and* a unit count, with the unit
requirement printed while it is unmet. The economy audit's finding was that
nothing showed the player what was next; this makes "visible but out of reach"
the default state of the whole upgrade ladder rather than a hint bolted on top.

**Legacy** replaces the v1 idea of feeding a permanent multiplier from Dollars —
which would have put one currency in charge of both the shop and the forever
bonus. It runs off its own all-time accumulator on a cubic curve, applies
automatically (the POST screen reports it; there is no ritual to re-buy), and
Legacy Slots carry one chosen upgrade through each wipe.

**Darknet Breach** — a ratio the player builds, escalating over three phases,
recoverable 3× faster than it escalates, and permanently silenceable with
Incognito Mode for anyone who does not want a horror game. It can take Buzz; it
can never touch permanent progress. Surviving one the hard way unlocks the
"Salvaged System" tint, which is also the game's only dark theme — a cosmetic
unlock, per the charter, rather than a default.

**Five mini-games** on the five buildings whose themes fit, gated behind their
tier-3 upgrade, all funnelling through one `applyMinigameReward()` so no game can
quietly become the best Buzz-per-minute in the run. The phase-3 breach reuses
Shield99's Firewall Defence engine rather than adding a sixth.

**Achievements** are first-party because they have to be: CrazyGames has no
achievement API. Twenty-eight badges, derived from state rather than stored, with
only two real SDK hooks behind them — `happytime()` on three curated moments and
`reportGameCompletedPercentage()` behind a step gate. Four of the badges target
the D1/D7 gap GROWTH.md identified.

**The visual charter is a test.** `tests/aeroCharter.test.js` runs the GDD's
banned-element list against the source, so "no pills, no Material shadows, no
thin fonts, no dark default" is enforced rather than reviewed.

It caught the first cut of this work red-handed. The building and achievement
panels had shipped as translucent rounded cards with uppercase letter-spaced
micro-labels — the vocabulary of a modern analytics dashboard, and precisely
what §A.1 rejects. Both were rebuilt from the parts Windows actually used:
`<fieldset><legend>` group boxes, a blue task-dialog headline, sunken white list
views with banded rows, and Add/Remove-Programs-style rows carrying a tick and a
real button. Mini-games became genuine 7.css `.window`s with a proper title bar
instead of modal cards.

The uppercase micro-label was then added to the charter as its own check and
fixed across the *whole* app, not just the new code — fifteen selectors in
`apps.css`, `desktop.css` and `ads.css` were shouting text the markup already
wrote in sentence case.

**DoD:** `npm run check` green (544 tests + build), and the desktop, tray
popovers, mini-games, breach phases 1-3 and the achievements window verified in
a real browser at 1280×800 and 390×844. ✅

**Still open:** the emoji debt. The apps that predate the charter use ~29 of
them; the test holds the line at "no new files, list may only shrink", but
redrawing those glyphs as period-correct icon art is the remaining half of
GDD §G phase 6.

## Bespoke app UI — in progress

The shared purchase panel is being replaced app by app. `ui/buildingView.js` is
headless (economy in, plain object out) and `ui/win32.js` holds the common
controls — menu bar, pop-up menu, tab strip, spinner, split button, task pane,
status bar, dialog, category list. An app that draws its own economy UI exports
`ownsBuildingUI = true` and stops receiving the fallback.

**Done:** AeroChat (MSN Messenger 7.5 — contacts via the "I want to..." task
pane, upgrades in Tools > Options), Aero Studio (NLE/DAW — blades on a Render
Farm tab, plugins in an Effects Rack), Shield99 (Norton AntiVirus 2004 — left
nav, features with On/Off indicators, licences as a subscription).

**Remaining:** RetroAmp (Winamp 2.x), LemonWire (LimeWire 4/5), AeroBurn (Nero),
VidChat, Registry Doctor, GeoPage, and the three tray popovers (AdBar, IoT
Botnet, Cloud Mainframe).

Purchases use the shared `buyTile`: icon, name, the gain in Buzz/sec, a cart
glyph, the word BUY, the price, and an affordability sliver that fills as your
Buzz approaches the cost — so "can I afford this yet" is a glance, not a
subtraction. All maths moved into the shared tooltip, and each app carries a
`[?]` explaining what it does in the economy. The first pass had been
period-accurate and unreadable: it optimised for "is this what Norton looked
like" and never asked "can a player tell this is a purchase".

Each converted app also writes its own copy for upgrade descriptions. The
view-model's fallback is phrased in economy terms ("doubles this building's
output"), which is right for the model and wrong in every window — MSN never
said "building", and neither did Norton.

## Backlog (post-week)

Cloud saves, achievements, buddy-list events with named characters, seasonal wallpapers,
leaderboards, localisation (the UI already keeps user-facing strings at call sites, and the
one Turkish-language surface is the Jira board, not the game).
