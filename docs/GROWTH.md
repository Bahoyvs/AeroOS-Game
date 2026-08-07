# Growth plan — fixing the funnel

Written against the first day of CrazyGames analytics. The numbers said something
specific, and it was not "the game is bad":

| Metric | Value | Band |
| --- | --- | --- |
| Impressions | 24,000 | normal first day |
| CTR | 1.6% | bottom of mid-range |
| **Gameplay conversion** | **25.13%** | **bottom 20%** |
| Avg playtime | 3m27s | bottom 20% |
| Avg loading time | 3.1s | fine |
| Gameplay crash rate | 0.00% | fine |
| Rating | 9.1 (11 votes) | excellent |

A 9.1 rating with a 25% gameplay conversion is not a quality problem. It is a
**threshold** problem: everyone who gets inside loves it, and three out of four
people never get inside. So the work is ordered by where players are lost, not by
what would be most fun to build.

---

## 1. The funnel, and what was actually wrong at each step

### 1.1 Load → gameplay (the 25%)

Loading time is 3.1s and the crash rate is zero, so the loss is not technical
failure — it is everything that happens between "the page responded" and "the
player did something".

Four concrete causes were found in the code:

**a. Three blocking network round-trips before the first pixel.** `boot()` awaited
`SDK.init()`, then `SDK.user.getUser()`, then `ads.init()` (which calls
`hasAdblock()`) — sequentially — before the desktop was built. None of those are
needed to draw a desktop or to accept a click. On a slow connection, or with the
portal SDK degraded, the reported 3.1s "loading" is followed by an arbitrary
amount of *additional* dead time that the portal does not measure and the player
reads as a hang.
→ Fixed: the desktop is built and interactive first; the SDK is awaited under a
timeout, and the username and ad-blocker probe resolve in the background and are
applied when they land.

**b. The SDK lifecycle was reported in the wrong order.** `gameplayStart()` was
called ~100 lines before `loadingStop()`. The portal's own funnel is built from
these calls, so a game that announces gameplay while it still claims to be
loading is partly *mis-measuring* its own conversion.
→ Fixed: `loadingStart()` → `loadingStop()` → `gameplayStart()`, with a guard so
neither is sent twice and `gameplayStart()` is not re-sent while an ad is up.

**c. The licence gate could silently blank the game.** Any hostname that is not
`localhost`, `*crazygames.*` or `*poki.*` replaced `document.body` with a single
line of plain text. An empty hostname — which is what a `srcdoc`/blob iframe
reports — failed the test, as would any partner or regional domain the portal
distributes to. Every such load is a load with zero gameplay.
→ Fixed: the allowlist now covers the portal's own hosts and embedded contexts
(including ancestor-origin checks for iframes), and a refusal renders a readable
card with a link instead of wiping the page.

**d. The first screen asked a question instead of giving an instruction.** A
first-time player landed on a full skeuomorphic desktop with a window already
open, an icon column, a taskbar, and a gadget in the corner whose NUDGE button is
the only thing that matters. The coach was a small panel in the *opposite*
corner that described the objective in prose and pointed at nothing.
→ Fixed: see §2.

### 1.2 Gameplay → retention (the 3m27s)

Three minutes is roughly "I clicked the button, I bought a buddy, nothing else
obviously happened, I left". The early ladder was real but invisible:

- Nothing on screen answered "what am I working towards?" once the five-step
  tutorial finished. The coach hid itself and the desktop went quiet.
- Clicking hard felt identical to clicking slowly, so the one *active* verb in
  the first two minutes had no feedback loop of its own.
- Ads are disabled for the basic launch, but `ads.available` still reported true,
  so the gadget rendered "Overclock ×2" and "Free Buzz" buttons that answered
  every press with *"Ads are temporarily disabled"*. Two dead buttons in the
  first minute, on the single most-looked-at widget in the game.

→ Fixed: a persistent goal tracker, a Nudge streak, and no button that cannot do
what it says (§3).

### 1.3 Impression → click (the 1.6% CTR)

Out of the code's reach, but not out of the repo's: `art/thumbnail.svg` is a
high-contrast 16:9 source built to the portal's guidance — one readable idea,
huge type, saturated Aero blue/green, and the NUDGE button as the subject rather
than a screenshot of the whole desktop. `npm run thumbnail` renders it to
`art/thumbnail.png` at 1920×1080 for upload.

---

## 2. Onboarding: a spotlight, not a paragraph

The single highest-leverage change. `src/ui/spotlight.js` dims the desktop and
cuts a hole around the element the current tutorial step is about, with a
bouncing arrow and a four-word instruction attached to it.

Design rules it follows, all of which are load-bearing:

- **It never blocks input.** The whole layer is `pointer-events: none`; the
  "hole" is a `box-shadow` spread, not a modal. A player who ignores the coach
  and clicks something else is not trapped — that is the failure mode that made
  the old tutorial safe, and it is kept.
- **It follows the element, not a coordinate.** Targets are resolved by selector
  every frame the coach updates, so a dragged window, a phone rotation and PDA
  mode all keep the ring on the right thing. A target that goes away hides the
  spotlight instead of pointing at empty desktop.
- **The first screen has exactly one thing on it.** On a genuinely fresh save the
  game no longer auto-opens AeroChat. The player sees a desktop, a taskbar and
  one pulsing button with an arrow over it. AeroChat opens *as the reward* for
  the first Nudge, which is also the game's first "something happened" beat.
- **It stops when the tour does.** Skipping the tour, or finishing it, removes
  the layer permanently for that save.
- **It never points at a button the player cannot press.** Two steps ask them
  to spend — a buddy is 10 Buzz, RetroAmp is 50 — and the script advanced off a
  single Nudge, which pays 1. So the arrow used to land on "Add buddy" while
  the player held one Buzz, and again on the Start menu while they held eight,
  with nothing on screen explaining either. `stepGate()` turns an unaffordable
  objective into a goal with a bar: what it costs, what is banked, and the
  arrow back on the Nudge button reading "9 Buzz to go". The step itself is
  unchanged and nothing is skipped — only what the coach points at.

## 3. Retention: three additions

**Goal tracker (`src/core/goals.js`).** The coach panel no longer disappears when
the tutorial ends; it becomes "Next up" — one objective at a time, with a
progress bar, derived from state rather than stored. Buy a buddy → reach 10 →
install RetroAmp → first milestone → LemonWire → Shield99 → first Format C: →
first hardware → AeroSweeper → Aero Studio. There is always a bar filling
somewhere on screen, which is the entire retention mechanic of the genre.

**Nudge streak (`CLICK.streak`).** Clicks landing within 1.6s of each other build
a streak worth up to +100% on the Nudge payout, shown as a meter across the
button itself. It costs nothing to ignore, it makes the first thirty seconds
*feel* like a clicker, and because it is folded into `clickPower()` it is
already visible in the "+N" readout, the rate breakdown and the sweeper combo.

**No dead buttons.** `ADS.enabled` is now a single flag in `src/data/balance.js`.
While it is false the ad adapter reports `available === false`, so no rewarded
button renders anywhere — and, because "nothing is gated behind an ad" is an
architectural rule here, `game.extractQuarantine()` pays the *full* Shield99
loot instead of the 25% no-ad fraction. Flipping the flag back to `true` when the
launch phase ends restores both without touching a call site.

---

## 4. What was deliberately not done

- **Re-enabling ads.** They are commented out for the basic-launch submission.
  This work makes them a one-line switch; it does not throw it.
- **Rebalancing the mid-game.** The data is one day old and the loss is in the
  first three minutes. Re-tuning content that fewer than a quarter of players
  reach would be tuning against noise.
- **Changing the art direction.** The 9.1 rating is the strongest signal in the
  whole dataset and it belongs to the skeuomorphic desktop. The fix is to teach
  the desktop faster, not to sand it down.

## 5. How to tell if it worked

Watch, in this order, over the next 3–7 days:

1. **Gameplay conversion** — the target is the mid-range band (~45–55%). This is
   the number §1.1 exists to move; if it does not move, the remaining suspect is
   the thumbnail setting a false expectation, not the boot path.
2. **Avg playtime** — §3 should show up here before it shows up in retention.
3. **D1 retention** — first meaningful reading is tomorrow's data, not today's.
4. **CTR** — only after a thumbnail swap, and give it a full day of impressions
   before reading it.
