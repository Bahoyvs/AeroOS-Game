# One-week build plan

A week from empty repo to a portal-submittable build of **AeroOS — The Messenger Era**.
Each day is a Jira epic (AO-2 style) with its sub-tasks, the files it touches, and a
definition of done. Ship the day's DoD before starting the next day — the schedule assumes
every day ends on a build that runs.

Ticket IDs for Days 1–3 match the Jira board. Later days are this plan's own numbering and
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

## Day 4 — Prestige pressure and the failure state

**Goal:** make bloat *felt* so Format C: reads as relief rather than punishment (GDD 7).
Deferred from the original Day 3 when the board scoped tutorial gating instead.

- [ ] RAM crash: exceeding capacity triggers a BSOD sequence rather than a refusal — forced
      reboot, brief production pause, no lost progress.
- [ ] Bloat presentation: window trails, animation slowdown, heat widget going red, taskbar
      clock drift. Hooks exist (`body.is-bloated` / `.is-critical`), and the AeroChat rate
      breakdown already names bloat as the culprit — this makes it visible before the maths.
- [ ] Format C: sequence: confirmation → nostalgic loading screen → clean desktop (this
      screen is where the Day 7 interstitial ad slots in).
- [ ] Offline-earnings modal ("Welcome back") replacing the current balloon, with the HDD cap
      explained and a 2× slot reserved for the rewarded ad.

**Files:** `src/ui/bsod.js`, `src/ui/bootScreen.js`, `src/styles/window.css`, `src/core/game.js`
**DoD:** a player can be pushed into a crash and a prestige, and both feel authored.

---

## Day 5 — LemonWire + Shield99 (risk layer)

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

## Day 6 — Aero Studio + AeroBurn (long-cycle payoffs)

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

## Day 7 — Active play: Pinball, IoT Botnet, Mini-Mod

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

## Day 8 — Monetization, audio, ship

**Goal:** the portal build (GDD 8). The first 60 seconds shipped on Day 3.

- [ ] AO-29 — Rewarded ad hooks behind one `src/monetization/ads.js` adapter (stub locally,
      SDK per portal): Trojan Scan (2× for 4 h) and Internet Cafe (2× offline Buzz).
- [ ] AO-30 — Interstitial on Format C:, hidden behind the loading screen.
- [ ] AO-31 — Audio pass (`src/core/audio.js`): clicks, HDD noise, startup chime, bloat
      distortion layer, synthwave BGM, with a mute toggle honouring `state.settings`.
- [ ] AO-32 — Ship build: `npm run build`, size budget check, `dist/` verified on a phone,
      CrazyGames/Poki SDK smoke test.

**Files:** `src/monetization/ads.js`, `src/core/audio.js`
**DoD:** ads are wired behind the adapter and `dist/` runs from a static host.

---

## Backlog (post-week)

Cloud saves, achievements, buddy-list events with named characters, seasonal wallpapers,
leaderboards, localisation (the UI already keeps user-facing strings at call sites, and the
one Turkish-language surface is the Jira board, not the game).
