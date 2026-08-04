# One-week build plan

A week from empty repo to a portal-submittable build of **AeroOS — The Messenger Era**.
Each day is a Jira epic (AO-2 style) with its sub-tasks, the files it touches, and a
definition of done. Ship the day's DoD before starting the next day — the schedule assumes
every day ends on a build that runs.

Ticket IDs are the Jira board's, and only exist for days the board has scoped
(Days 1–5). Later days list the work without IDs — they get numbered when their
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
| AO-21 | LemonWire P2P download sim with virus safety net (50% floor) | ✅ `src/apps/lemonwire.js`, `src/core/downloads.js` |
| AO-22 | Shield99 tray icon + free first-virus rescue | ✅ `src/apps/shield99.js`, tray status in the taskbar |
| AO-23 | Mobile: taskbar modal slide-up for apps | ✅ shipped Day 1; added swipe-down-to-dismiss |
| AO-24 | Mobile: RAM usage bars under taskbar icons | ✅ shipped Day 1; fixed bars vanishing on big machines |

LemonWire is the first mechanic that can go wrong, and the HDD track finally has
a second job: downloads occupy real disk space, so a full disk means deleting
something or buying a bigger drive. Files trade risk against reward — the
sketchy 3 MB `system32_SPEED_BOOST_2005.exe` pays like a 4 GB ISO and infects
three times out of four. Payouts are denominated in *seconds of current
production*, so a download is still worth doing ten prestiges later.

The safety net is the GDD's, exactly (GDD 6): real-time protection blocks an
infected file outright, otherwise the run's one free trial rescue catches it,
otherwise the machine is infected — production halved, LemonWire locked, and
**nothing already earned is taken away**. A second infection cannot stack below
that floor, and a Shield99 scan always cures it.

AO-23 and AO-24 were largely satisfied on Day 1, because PDA mode was built as a
first-class target rather than a fallback. What was actually missing: a
share-of-capacity RAM bar is invisible once the player owns 8 GB (32 MB reads as
0.4%), so bars keep a minimum width and carry the real numbers in their label;
and a full-screen modal had no gesture to dismiss it, so the title bar is now a
drag handle that slides the sheet away.

**DoD:** a virus can be caught, survived and cured, and the worst case is
provably a 50% floor — asserted in tests and measured in the browser. ✅

---

## Day 6 — Aero Studio + AeroBurn (long-cycle payoffs)

**Goal:** give the GPU and the prestige loop something to matter for.

- [ ] Aero Studio (`src/apps/aerostudio.js`): long render with a GPU-scaled cooldown
      (`cooldownMultiplier`), highest single payout in the game.
- [ ] Shared cooldown/progress-job helper so future timed apps reuse one implementation.
- [ ] AeroBurn (`src/apps/aeroburn.js`): burn Buzz to a CD that survives Format C:
      and grants next-run starting boosts (persist through `resetForPrestige`).
- [ ] Tests: CD carry-over survives prestige; GPU tiers measurably cut cooldowns.

**Files:** `src/apps/aerostudio.js`, `src/apps/aeroburn.js`, `src/core/jobs.js`, `src/core/state.js`
**DoD:** every hardware track (CPU/RAM/GPU/HDD) now changes something the player can feel.

---

## Day 7 — Active play: Pinball, IoT Botnet, Mini-Mod

**Goal:** something to do while idling, and an end-game ceiling.

- [ ] Galactic Pinball 3D (`src/apps/pinball.js`): canvas mini-game paying Buzz and
      combo multipliers.
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
- [ ] Audio pass (`src/core/audio.js`): clicks, HDD noise, startup chime, bloat
      distortion layer, synthwave BGM, with a mute toggle honouring `state.settings`.
- [ ] Ship build: `npm run build`, size budget check, `dist/` verified on a phone,
      CrazyGames/Poki SDK smoke test.

**Files:** `src/monetization/ads.js`, `src/core/audio.js`
**DoD:** ads are wired behind the adapter and `dist/` runs from a static host.

---

## Backlog (post-week)

Cloud saves, achievements, buddy-list events with named characters, seasonal wallpapers,
leaderboards, localisation (the UI already keeps user-facing strings at call sites, and the
one Turkish-language surface is the Jira board, not the game).
