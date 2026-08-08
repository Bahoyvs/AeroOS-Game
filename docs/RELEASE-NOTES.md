# Release notes

Newest first. Each entry is written to be handed to CrazyGames QA as-is.

---

## v0.2.0 — Personalisation, Mainboard, Auto-Defrag

**Package:** `aeroos-crazygames-build.zip` · 2,217,385 bytes · 21 files · `index.html` at archive root
**Type:** content + balance update. No SDK changes, no new permissions, no new third-party requests.

### Summary for QA

Three mid/late-game systems and the game's first real artwork. Everything new is reached
from **My Computer**, which is the window the desktop icon and the Start menu both open.

| # | What | Where |
|---|---|---|
| 1 | **Display Properties** — window tints and wallpapers, unlocked by progress | My Computer → *Display properties* |
| 2 | **Mainboard** — a fifth hardware track that increases the Format C: payout | My Computer → *Hardware shop*, last row |
| 3 | **Auto-Defrag** — a $25 utility that clears System Bloat automatically | My Computer → *Utilities* |
| 4 | **Photographic wallpapers** — four JPEGs replace the old CSS gradient | desktop background |

### Compliance

- **Initial download: 792 KB** (measured on the packaged build, first paint to interactive).
  Total package 2.2 MB zipped / 2.5 MB unpacked. Well inside the 50 MB initial and 20 MB
  mobile-homepage thresholds.
- **21 files**, against the 1500 limit.
- **All in-game asset paths are relative.** Verified by serving the extracted package from
  a nested subdirectory (`/some/deep/path/`) — the game boots and every request returns 200.
  The only absolute URL in `index.html` is the CrazyGames SDK itself.
- **No new network requests.** The four wallpapers ship inside the package; the thumbnails
  in the picker are inlined into the CSS as data URIs, so opening Display Properties makes
  no requests at all.
- **SDK integration is unchanged from v0.1.0** — same `init()`, `loadingStart/Stop`,
  `gameplayStart/Stop`, `happytime`, `reportGameCompletedPercentage`, `setGameContext`,
  and the same `SDK.data` save backend.
- **Ads remain off** (`ADS.enabled = false`, basic-launch build). No ad button renders
  anywhere and nothing new is gated behind one.
- **Existing saves load unchanged.** Save version is still **3**; every new field is
  additive and back-filled with a default, so a v0.1.0 save carries over with no migration
  and no loss. Saves made in v0.2.0 are also still readable by v0.1.0.

### 1. Display Properties

Two pickers — **Window colour** (4 tints) and **Wallpaper** (4 photographs) — plus the
existing Desktop animations control, which has not changed.

Locked entries are shown greyed with a padlock, and the tooltip states the requirement.
Selecting one applies instantly across the whole OS: windows, taskbar, Start menu and
meters all retint together.

| Cosmetic | Type | Unlocks at |
|---|---|---|
| Aqua Blue | tint | default |
| Toxic Green | tint | $1.00 spent on hardware/utilities |
| Midnight Aero | tint | 50,000 lifetime Buzz |
| Sunset Chrome | tint | $20.00 spent |
| Blue Lagoon | wallpaper | default |
| Green Hill | wallpaper | first Format C: |
| Moonlit Peak | wallpaper | $5.00 spent |
| Crimson Dunes | wallpaper | 5,000,000 lifetime Buzz |

An unlock fires a balloon with a **"Use it"** button that applies it in one click.

**Expected, not a bug:** an unlock can never be revoked. Every counter behind it
(lifetime Buzz, Format C: count, Dollars spent) survives a Format C: by design, so a
wipe never takes a cosmetic or a chosen theme away.

### 2. Mainboard (hardware track)

A fifth row in the hardware shop. Unlike the other four it does nothing for the current
run — it increases the Dollars a **Format C:** pays out.

| Tier | Cost | Effect |
|---|---|---|
| OEM Board (no jumpers) | — | starting board |
| Pentagon Overclock Kit | $2.50 | +10% Format C: payout |
| Dual-Core Bus Architecture | $10.00 | +20% |
| Quantum Interconnect 500 | $50.00 | +50% |

**Expected, not a bug:** buying a tier makes the *pending* payout jump immediately rather
than applying from that point on. The payout is a function of total lifetime Buzz, so
improving the board re-prices the player's whole history. This is the intended reward
moment. It cannot compound — the track is four tiers long, and the game still never pays
twice for the same Buzz (regression-tested).

Hardware-shop prices now all read with two decimals (`$12.00`), because this track is
priced in cents.

### 3. Auto-Defrag

A one-off $25 purchase under **Utilities**. Permanent — it survives Format C: like hardware.

- **While playing:** when System Bloat reaches 85%, a defrag pass starts automatically,
  clears bloat to 0% over roughly 85 seconds, and costs 5% production while it runs. The
  Aero gadget shows a progress bar and an animated block grid for the duration, and
  balloons announce the start and the finish.
- **While away:** bloat accrued offline is capped at 50% instead of reaching 100%. The
  welcome-back dialog says so. It caps what an absence *adds* — it will not reduce bloat
  the player had already built up before closing the tab.
- Without the purchase, bloat behaves exactly as it did in v0.1.0.

### 4. Wallpapers

The desktop background is now a photograph rather than a CSS gradient. Two knock-on
changes were needed and are worth a look during review:

- **Desktop icon labels** carry a stronger halo. Two of the wallpapers put near-white
  cloud directly under the icon column, where the old gradient never got brighter than
  about 55% luminance.
- **The Aero gadget** now uses the taskbar's slab instead of plain translucent glass, for
  the same reason — it is the other piece of chrome sitting directly on the wallpaper,
  with no window frame behind its text.

Please check icon and gadget legibility on **Green Hill** and **Moonlit Peak**
specifically; those are the two bright ones.

Returning players whose save names one of the retired gradient wallpapers fall back to
Blue Lagoon automatically.

### Suggested test pass

1. **Fresh save** — clear site data, load, complete the tutorial. Confirm the desktop opens
   on Blue Lagoon and the first screen is unchanged from v0.1.0.
2. **Display Properties** — open My Computer, scroll to *Display properties*. Switch tint
   and wallpaper; confirm windows, taskbar and Start menu all retint, and that locked rows
   state their requirement.
3. **Auto-Defrag** — buy it, drive bloat to 85%, confirm the pass runs, the gadget shows
   progress, and production drops ~5% only while it runs.
4. **Mainboard** — buy a tier and confirm the *Format C:* panel's "$X waiting" figure rises
   by the advertised percentage.
5. **Format C:** — run one and confirm Dollars, hardware, Auto-Defrag and the chosen
   cosmetics all survive, and that Green Hill unlocks.
6. **Upgrade path** — load a v0.1.0 save and confirm progress is intact, with the new
   panels present and everything unlocked correctly for that save's totals.
7. **PDA / mobile (800×450 and phone widths)** — confirm the two pickers wrap to two
   columns with no clipped names, and that the defrag strip in the gadget does not
   overlap the window below it.

#### Reaching gated content quickly

The production build exposes `window.AeroOS` for exactly this. From the browser console:

```js
AeroOS.game.state.dollars = 500          // fund the hardware shop and Auto-Defrag
AeroOS.game.state.lifetimeBuzz = 6e6     // unlock every Buzz-gated cosmetic
AeroOS.game.state.dollarsSpentTotal = 30 // unlock every spend-gated cosmetic
AeroOS.game.state.bloat = 0.86           // arm an Auto-Defrag pass (once owned)
AeroOS.game.save()
```

> Note for the developer, not for QA: `window.AeroOS` is present in production builds, so
> it is also a player-facing cheat surface. It is left in deliberately for this review —
> say the word and it can be gated behind the dev build before full launch.

### Not changed in this release

Onboarding and the tutorial, AeroChat, RetroAmp, LemonWire, Shield99, AeroBurn,
AeroSweeper, Aero Studio, offline earnings, the ad system, audio, sitelock, and the save
format version.

---

## Rebuilding this package

```bash
npm run check
```

Then replace the package folder wholesale — do not copy `dist/` over the top of it, or the
previous release's hashed asset files ride along in the zip:

```bash
rm -rf aeroos-crazygames-build && cp -r dist aeroos-crazygames-build
```

Zip so that **`index.html` sits at the root of the archive** and entry paths use forward
slashes. Windows PowerShell's `Compress-Archive` writes backslash separators, which some
extractors read as literal filenames rather than folders — the game then 404s on its own
assets. `art/package-build.ps1` does it correctly.

Wallpaper art is a build step of its own and only needs re-running when the source images
change:

```bash
node art/optimize-wallpapers.mjs
```
