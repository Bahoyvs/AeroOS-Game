# One-week build plan

Seven days from empty repo to a portal-submittable build of **AeroOS — The Messenger Era**.
Each day is a Jira epic (AO-2 style) with its sub-tasks, the files it touches, and a
definition of done. Ship the day's DoD before starting the next day — the schedule assumes
every day ends on a build that runs.

Ticket IDs for Days 1–2 match the Jira board. Later days are this plan's own numbering and
should be re-mapped as those epics are created — the work is the contract, not the ID.

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
reuse — a Day 3 playlist buff is now a table entry, not a new system.

Buddies are *derived* from their index rather than stored, so a 500-buddy list costs nothing
in the save file and identities stay stable across reloads.

**DoD:** the buddy list reads as a living MSN window, buying has a visible goal, and status
bonuses can be claimed, ignored or missed without ever punishing the player. ✅

---

## Day 3 — RetroAmp and prestige pressure

**Goal:** a second multiplier source, then make bloat *felt* so Format C: reads as relief
rather than punishment (GDD 7).

- [ ] AO-11 — RetroAmp (`src/apps/retroamp.js`): playlist selection driving buffs — a
      permanent small multiplier ("SOFT SIGNALS") and a big short-burst one that costs extra
      RAM. Playlists are a table on top of `core/buffs.js`; no new timing code.
- [ ] AO-12 — RAM crash: exceeding capacity triggers a BSOD sequence rather than a refusal —
      forced reboot, brief production pause, no lost progress.
- [ ] AO-13 — Bloat presentation: window trails, animation slowdown, heat widget going red,
      taskbar clock drift. Hooks exist (`body.is-bloated` / `.is-critical`).
- [ ] AO-14 — Format C: sequence: confirmation → nostalgic loading screen → clean desktop
      (this screen is where the Day 7 interstitial ad slots in).
- [ ] AO-15 — Offline-earnings modal ("Welcome back") replacing the current balloon, with the
      HDD cap explained and a 2× slot reserved for the rewarded ad.

**Files:** `src/apps/retroamp.js`, `src/ui/bsod.js`, `src/ui/bootScreen.js`, `src/core/game.js`
**DoD:** two multiplier sources are live, and a player can be pushed into a crash and a
prestige that both feel authored.

---

## Day 4 — LemonWire + Shield99 (risk layer)

**Goal:** the first mechanic that can go wrong, with the GDD's safety net intact.

- [ ] AO-16 — LemonWire (`src/apps/lemonwire.js`): queued downloads, HDD-capped size,
      completion pays a large Buzz lump.
- [ ] AO-17 — Virus events: production floor capped at 50% *or* LemonWire locked — never a
      ruined run (GDD 6).
- [ ] AO-18 — Shield99 (`src/apps/shield99.js`): removes viruses, free trial rescue on the
      first virus of a run.
- [ ] AO-19 — Tests for the virus floor, the rescue-once rule and HDD capacity limits.

**Files:** `src/apps/lemonwire.js`, `src/apps/shield99.js`, `src/data/balance.js`, `tests/`
**DoD:** a virus can be caught, survived and cured; the worst case is provably a 50% floor.

---

## Day 5 — Aero Studio + AeroBurn (long-cycle payoffs)

**Goal:** give the GPU and the prestige loop something to matter for.

- [ ] AO-20 — Aero Studio (`src/apps/aerostudio.js`): long render with a GPU-scaled cooldown
      (`cooldownMultiplier`), highest single payout in the game.
- [ ] AO-21 — Shared cooldown/progress-job helper so future timed apps reuse one implementation.
- [ ] AO-22 — AeroBurn (`src/apps/aeroburn.js`): burn Buzz to a CD that survives Format C:
      and grants next-run starting boosts (persist through `resetForPrestige`).
- [ ] AO-23 — Tests: CD carry-over survives prestige; GPU tiers measurably cut cooldowns.

**Files:** `src/apps/aerostudio.js`, `src/apps/aeroburn.js`, `src/core/jobs.js`, `src/core/state.js`
**DoD:** every hardware track (CPU/RAM/GPU/HDD) now changes something the player can feel.

---

## Day 6 — Active play: Pinball, IoT Botnet, Mini-Mod

**Goal:** something to do while idling, and an end-game ceiling.

- [ ] AO-24 — Galactic Pinball 3D (`src/apps/pinball.js`): canvas mini-game paying Buzz and
      combo multipliers.
- [ ] AO-25 — IoT Botnet unlocked by the top CPU tier: hijack smart plugs/fans/bridges for
      large passive Buzz (GDD 5).
- [ ] AO-26 — Mini-Mod widget mode: collapse the OS into a thin vertical sidebar (GDD 3).
- [ ] AO-27 — Performance pass: keep the render step under budget with the pinball canvas,
      many windows and 500 bots on a mid-range phone.

**Files:** `src/apps/pinball.js`, `src/core/botnet.js`, `src/ui/miniMod.js`
**DoD:** 60 fps on a mid-range phone with pinball running and the desktop full of windows.

---

## Day 7 — Onboarding, monetization, audio, ship

**Goal:** the first 60 seconds and the portal build (GDD 7 & 8).

- [ ] AO-28 — Hard-scripted tutorial: clean desktop with only AeroChat → first bot →
      RetroAmp unlock; CPU/RAM stay hidden until the first bottleneck.
- [ ] AO-29 — Rewarded ad hooks behind one `src/monetization/ads.js` adapter (stub locally,
      SDK per portal): Trojan Scan (2× for 4 h) and Internet Cafe (2× offline Buzz).
- [ ] AO-30 — Interstitial on Format C:, hidden behind the loading screen.
- [ ] AO-31 — Audio pass (`src/ui/audio.js`): clicks, HDD noise, startup chime, bloat
      distortion layer, synthwave BGM, with a mute toggle honouring `state.settings`.
      The routing (AudioContext, master gain, `sfxOn()`/`bgmOn()`) already exists and
      already honours the CrazyGames mute — what is missing is the sound design.
- [ ] AO-32 — Ship build: `npm run build`, size budget check, `dist/` verified on a phone,
      CrazyGames/Poki SDK smoke test.

**Files:** `src/core/tutorial.js`, `src/monetization/ads.js`, `src/ui/audio.js`
**DoD:** a first-time player is producing Buzz within 60 seconds, ads are wired behind the
adapter, and `dist/` runs from a static host.

---

## Backlog (post-week)

Cloud saves, achievements, buddy-list events with named characters, seasonal wallpapers,
leaderboards, localisation (the UI already keeps user-facing strings at call sites, and the
one Turkish-language surface is the Jira board, not the game).
