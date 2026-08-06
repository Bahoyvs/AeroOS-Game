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

## Day 7 — Aero Studio, Pinball, IoT Botnet, Mini-Mod

**Goal:** the last of the software roster, something to do while idling, and an
end-game ceiling.

- [ ] Aero Studio: a long GPU-scaled render with the biggest single payout —
      the GPU track still has no consumer, so this is what makes it felt.

- [x] Galactic Pinball 3D (`src/apps/pinball.js`): the mini-game, paying Buzz and
      combo multipliers. Shipped as **WebGL rather than canvas or DOM** —
      PixiJS, behind a dynamic `import()` so nobody downloads a renderer for an
      app they have not installed.

      Two design decisions worth recording. The reward is a *click* buff, not
      Buzz: an idle game's active mini-game should hand the player a reason to
      go back to the button, and a lump sum does the opposite. And tokens
      (three an hour, wall clock, or one for ten minutes of production) are
      pacing rather than a paywall — the table is a thing to do while idling,
      and something available all the time is something to grind.

      The physics lives in `src/core/pinball.js` and the geometry in
      `src/data/pinball.js`, so a table nobody can see is still unit-testable in
      plain Node — `tests/pinball.test.js` asserts the drain, the bumper kick,
      the flipper's energy transfer and that the weakest plunge still clears the
      lane.
- [x] Shell pass: the taskbar, the gadget and every meter lost their borders in
      favour of a lit/shaded bevel (`--emboss`), and the Nudge button now docks
      in the thumb zone on phones instead of sitting in the top corner of a
      status widget. LemonWire was re-skinned as the 2005 client it is
      parodying — lime chrome, dead search box, dark filter rail, segmented
      progress bars. See ARCHITECTURE.md for the two cascade traps behind them.

- [ ] IoT Botnet unlocked by the top CPU tier: hijack smart plugs/fans/bridges for
      large passive Buzz (GDD 5).
- [ ] Mini-Mod widget mode: collapse the OS into a thin vertical sidebar (GDD 3).
- [ ] Performance pass: keep the render step under budget with the pinball canvas,
      many windows and 500 bots on a mid-range phone.

**Files:** `src/apps/pinball.js`, `src/core/botnet.js`, `src/ui/miniMod.js`
**DoD:** 60 fps on a mid-range phone with pinball running and the desktop full of windows.

---

## Day 8 — Monetization, audio, ship

**Goal:** the portal build (GDD 8). The first 60 seconds shipped on Day 3.

- [ ] Rewarded ad hooks behind one `src/monetization/ads.js` adapter (stub locally,
      SDK per portal): Trojan Scan (2× for 4 h) and Internet Cafe (2× offline Buzz).
- [ ] Interstitial on Format C:, hidden behind the loading screen.
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

## Backlog (post-week)

Cloud saves, achievements, buddy-list events with named characters, seasonal wallpapers,
leaderboards, localisation (the UI already keeps user-facing strings at call sites, and the
one Turkish-language surface is the Jira board, not the game).
