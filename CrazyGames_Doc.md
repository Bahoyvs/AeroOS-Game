# AeroOS: The Messenger Era — CrazyGames Publishing Todo

Source docs: `docs.crazygames.com` (requirements, SDK, monetization guides) cross-referenced with the AeroOS GDD.
Platform target: CrazyGames (also cross-compatible with Poki per GDD, but this checklist is CrazyGames-specific).

---

## 0. Launch Strategy

- [ ] Decide Basic Launch vs. direct Full Launch. Default path is **Basic Launch first** (7–21 days, no SDK/monetization required) to validate retention/playtime before investing in full SDK integration.
- [ ] Track internal targets against CrazyGames' Basic Launch benchmarks before requesting Full Launch:
  - [ ] Average play time ≥ ~10 minutes (idle/sim genre historically runs 14–17 min average on the platform — AeroOS's layered systems (AeroChat, RetroAmp, LemonWire, Aero Studio) should support this).
  - [ ] Day 1 retention ≥ 10–15%.
  - [ ] Conversion (players reaching 1 minute of play) ≥ 80%, which depends on load time and onboarding clarity.
- [ ] Plan the Full Implementation milestone (SDK + ads + account integration) as a post-Basic-Launch update once metrics look healthy.

---

## 1. Technical Requirements

- [ ] Keep **initial download size ≤ 50MB** (≤ 20MB if targeting mobile homepage placement — worth pursuing given the PDA/mobile mode described in the GDD).
- [ ] Keep **total file size ≤ 250MB** and **file count ≤ 1500**. Watch out for the icon packs (Tango, FamFamFam Silk) and AI-generated wallpapers bloating asset count/size — sprite-sheet or compress wallpapers, and subset icon packs to only what's used.
- [ ] Use only **relative paths** for all in-game asset references (no absolute paths).
- [ ] Defer non-critical assets: load only the AeroChat icon + first-bot assets needed for the hard-scripted 60-second tutorial first; stream in RetroAmp, LemonWire, Aero Studio, Shield99, AeroBurn, and Galactic Pinball 3D assets in the background afterward.
- [ ] Confirm smooth performance on Chrome, Edge, and a 4GB RAM Chromebook profile — important given this is a UI/DOM-heavy game (7.css, many draggable windows) that could stress low-end devices.
- [ ] Add the CSS lock to prevent mobile long-press/magnifier/selection popups on draggable windows and taskbar icons:
```css
  user-select: none;
  -webkit-user-select: none;
```
- [ ] Verify audio resume behavior on iOS: the AudioContext used for HDD clicks/dial-up chimes/BGM must be resumed on a `touchend`/`click` gesture after backgrounding, since Aero's layered SFX/BGM system risks staying silently "stuck" on iOS.
- [ ] Confirm desktop windows remain playable/legible at the required CrazyGames iframe sizes (e.g., 907×510, 1216×684, 1920×1080, 1366×768, etc.) — test that draggable/resizable Aero windows don't clip or overlap unreadably at smaller iframe sizes.
- [ ] Confirm the Mobile (PDA) view and Mini-Mod (sidebar widget) both render correctly at mobile iframe sizes (800×450) and don't rely on dragging (already disabled per GDD on mobile — good).
- [ ] Implement a Sitelock check (hostname validation against `crazygames.*` domains) to protect the DOM/CSS-driven UI codebase from being copied, plus consider light obfuscation of core economy/tick logic.
- [ ] No custom in-game fullscreen button (CrazyGames handles fullscreen automatically) — confirm no Aero-style "maximize" button is wired to browser fullscreen APIs.
- [ ] Avoid rebinding Escape or Ctrl/Cmd+W (these have reserved browser behavior); make sure no OS-skeuomorphic "close window" shortcuts conflict with these.

---

## 2. SDK Integration (Full Implementation)

- [ ] Load `crazygames-sdk-v3.js` in `<head>` and call `await CrazyGames.SDK.init()` during the boot/dial-up startup chime sequence (fits narratively — treat the SDK init as part of the "startup" moment).
- [ ] **Game module**
  - [ ] Fire `gameplayStart()` the moment the player reaches the clean desktop with the AeroChat icon (end of loading, start of the hard-scripted tutorial) — this is also the point CrazyGames measures for initial download size.
  - [ ] Fire `gameplayStop()` whenever the player is in a non-interactive state (e.g., Format C: reset loading screen, Mini-Mod idle-only background state if it counts as paused).
  - [ ] Call `loadingStart()` / `loadingStop()` around the boot animation.
  - [ ] Hook `settings.muteAudio` so the HDD clicks / dial-up chimes / synthwave BGM respect SDK-driven mute (must override any in-game audio toggle).
  - [ ] Call `happytime()` sparingly on genuinely big moments (e.g., first successful "Format C:" prestige, unlocking the IoT Botnet) — not on routine bot purchases.
  - [ ] Implement `reportGameCompletedPercentage()`. Since AeroOS is an idle/prestige game with no fixed end, define your own completion milestone (e.g., % progress toward first Format C:, or number of hardware tiers unlocked) and report consistently.
  - [ ] Use `setGameContext()` / `clearGameContext()` to attach current hardware tier, Buzz/Dollar totals, and active software list so player bug reports are reproducible.
- [ ] **Data module** (progress save)
  - [ ] Use `CrazyGames.SDK.data` (localStorage-equivalent API) to persist: current Buzz, lifetime Buzz, Dollars, owned hardware tiers, bought bots/software, AeroBurn "CD" bonuses, and settings — instead of a custom backend, to get automatic cross-device cloud sync for logged-in users.
  - [ ] Select the "Yes, using the Data Module" option in the submission flow, or the module will be disabled.
  - [ ] Respect the 1MB data cap — keep saved state compact (avoid storing full chat logs/status message history, just counters and unlocked-flags).
  - [ ] Retrieve-before-write pattern to avoid clobbering progress across tabs/devices.
- [ ] **User module / Account integration**
  - [ ] Since AeroOS has no real user-facing login system of its own, treat it as "no in-game account" — rely fully on the Data module for guest + logged-in progress sync (no need to build a custom account system).
  - [ ] Do not implement any external login (Google/Facebook/email) — only "Login with CrazyGames" is allowed, and only as a secondary, non-blocking CTA (e.g., a small icon near the taskbar clock), never the main flow.
- [ ] **Ad module** — see Section 4 below.
- [ ] Test everything through the Developer Portal Preview tool before submission; use `?useLocalSdk=true` locally to force demo ads/banners during development.

---

## 3. Gameplay & Onboarding Requirements

- [ ] Confirm new players land **directly in gameplay** (the clean desktop + AeroChat icon), with at most 1 click before interactive gameplay begins (Full Implementation requirement) — matches the GDD's hard-scripted 60-second tutorial intent well.
- [ ] Keep the tutorial's UI legible with no dev-only text; ensure buttons (e.g., "Add Bot") are clearly labeled, not delayed or artificially sized to nudge ad clicks.
- [ ] Ensure English localization is present at minimum; if adding translations, pull locale from CrazyGames System Info and fall back to English.
- [ ] Confirm the whole game is PEGI 12 compliant — review MSN-era nostalgia references, fake "virus"/"Trojan Scan" popups, and mock antivirus (Shield99) framing so nothing reads as an actual malware scare tactic or real brand parody that could be flagged.
- [ ] No cross-promotion of other games/platforms in menus (Discord/dev site links are fine only if not the primary CTA).
- [ ] Physics/timers (tick rate, RetroAmp cooldowns, Aero Studio render timers) must behave consistently regardless of monitor refresh rate — audit any `requestAnimationFrame`-driven timers for frame-rate dependence, since idle games are especially prone to tick-rate drift bugs.
- [ ] Adapt key bindings (if any keyboard shortcuts are added for desktop, e.g. window snapping) to the user's keyboard layout rather than hardcoding QWERTY.

---

## 4. Monetization / Ads Plan

The GDD's three monetization hooks map directly onto CrazyGames ad types. Confirm and adjust each against CrazyGames' rules:

### Rewarded Ad #1 — "The Trojan Scan" (System overclock / 2x production for 4 hours)
- [ ] Implement as a **rewarded ad** (`requestAd("rewarded", callbacks)`), not a forced/midgame ad — this is a bonus, so it must be fully optional.
- [ ] Make it visually clear this is optional and ad-gated: label the button "Watch Ad for 2x Production (4h)" with a video icon, not just "Run Deep Scan."
- [ ] Since it currently reads as a "fake popup," ensure the popup design doesn't mimic a real OS/security warning too convincingly — avoid anything resembling a deceptive/real malware alert (both for CrazyGames' anti-deceptive-trigger rule and general good practice).
- [ ] Do not auto-trigger this popup mid-active-gameplay (e.g., while the player is mid-drag on a window); trigger it at a natural break (idle desktop moment, after closing a window, returning to desktop).
- [ ] Pause game simulation and mute BGM/SFX on `adStarted`; resume + unmute on `adFinished`/`adError`.
- [ ] Only grant the 2x/4h boost on `adFinished` — never on `adError`/unfilled.
- [ ] Add a cooldown/limit (e.g., a handful of times per day) and reflect it in the UI (grayed out button + timer) rather than letting players spam it.
- [ ] Provide a non-ad fallback path for AdBlock users (e.g., a Dollars- or Buzz-based purchase of the same boost) so the feature isn't fully blocked for them.

### Rewarded Ad #2 — "Internet Cafe Bonus" (2x offline Buzz on return)
- [ ] This is the platform's single highest-converting idle-game ad pattern ("welcome back" / offline-earnings doubler) — prioritize this placement first.
- [ ] Trigger only on session return (after computing accumulated offline Buzz), never mid-session.
- [ ] Clearly show the base offline earnings first, then offer "Watch Ad to 2x" as an explicit, skippable upsell (with a plain "Collect" alternative button of equal visual weight).
- [ ] Scale the reward with the offline HDD-tier cap (2h–24h per GDD) so it stays meaningful at all hardware tiers.

### Interstitial Ad — Format C: reset loading screen
- [ ] Implement as a **midgame ad** (`requestAd("midgame", callbacks)`), requested right as the "Format C:" nostalgic OS reboot/loading screen begins.
- [ ] Because this is tied to a deliberate, deep-progression system reset (not a level transition), treat it as a "major transition" — acceptable placement per CrazyGames' guidance for RPG/idle-style deep-economy games (use midgame ads sparingly, only at major transitions).
- [ ] Do not stack this with a rewarded ad request in the same moment; let the SDK's automatic pacing (max 1 midgame ad per 3 minutes) handle frequency — don't build a custom cooldown on top.
- [ ] Ensure the game (tick simulation) is fully paused/blocked behind a spinner during the ad request/display, and mute audio during playback.
- [ ] Handle `adError`/unfilled gracefully — the Format C: reset and reward payout must still complete normally if no ad is available.

### Additional monetization opportunities worth adding (from CrazyGames idle/clicker genre guidance)
- [ ] Consider **in-game banner ads** on menu-heavy, low-motion screens the player lingers on — e.g., the hardware upgrade shop, AeroChat buddy list management, or the Format C: summary screen (only where visible ≥ ~5s on average, max 2 banners per screen, never during active play, never overlapping game UI).
- [ ] Consider a rewarded "auto-clicker boost" placement tied to the Nudge button (e.g., temporary auto-Nudge for 10 minutes) — a proven idle-genre pattern.
- [ ] Consider daily-capped rewarded ads for small Dollars bonuses outside of Format C:, to give free players a taste of hardware progression (with diminishing or capped returns to protect economy balance).
- [ ] Keep ad-driven currency injections from breaking the Buzz/Dollars economy — cap rewarded-ad Buzz/Dollars gains relative to current hardware tier and upgrade costs so they don't trivialize progression or undercut the appeal of grinding.

### General ad compliance checklist
- [ ] No ad ever interrupts active dragging/resizing of a window or active typing/clicking in AeroChat.
- [ ] No chaining of multiple ads for a single reward.
- [ ] No ad-request buttons visible during "active gameplay" screens (e.g., don't show a rewarded button while the LemonWire download progress bar or Aero Studio render is the focused, active interaction).
- [ ] Confirm the game remains fully playable (all core loops functional, no dead rewarded-ad buttons) when an AdBlocker is detected — never gate baseline play behind ads, only bonus features.
- [ ] All monetization is disabled automatically during Basic Launch — verify the game doesn't soft-lock or show broken ad UI when ad calls are stubbed out in that phase.

---

## 5. Store Assets (Game Covers)

- [ ] **Landscape cover** — 1920×1080 (16:9).
- [ ] **Portrait cover** — 800×1200 (2:3).
- [ ] **Square cover** — 800×800 (1:1).
  - All three should share consistent art direction: lean into the Frutiger Aero look (glossy water-drop wallpaper, MSN-era buddy icons, green/blue palette) rather than a literal screenshot.
  - Feature the AeroOS logo/title in a period-appropriate glossy/bevel font.
  - No borders, no "Play Now"/store-logo text, no copyrighted OS logos or trademarked messenger branding (avoid literal Windows/MSN logos — keep it an homage, not a copy, both for originality requirements and IP safety).
- [ ] **Preview video** (15–20s max, ≤50MB, no sound, no black bars, static cover as first frame):
  - [ ] Landscape 1920×1080 and portrait cuts (both mandatory).
  - [ ] Show the visually best moments: bloated late-game desktop with many overlapping bot windows, the Format C: reset transition, RetroAmp visualizer during a metal-track burst multiplier, and the Mini-Mod sidebar mode.
- [ ] Write the store game description and controls metadata (mouse-only desktop, touch on mobile) for the submission form.
- [ ] Plan a cover-refresh cadence tied to future content updates (e.g., new hardware tiers, seasonal wallpaper packs) rather than updating too frequently.

---

## 6. QA / Pre-Submission Checklist

- [ ] Run the game through the CrazyGames Developer Portal **Preview tool** end-to-end (desktop + mobile + Mini-Mod) before formal submission.
- [ ] Verify legibility at all required iframe sizes listed in Section 1.
- [ ] Confirm mouse, keyboard, and touch all work for their respective supported views (desktop = mouse/keyboard with drag; mobile = touch, no drag).
- [ ] Load-test with the full late-game asset set (many bot windows, RetroAmp visualizer, Aero Studio renders) on a simulated 4GB RAM Chromebook profile — this genre's DOM/CSS-heavy "maximalist" UI is a real risk area for low-end performance.
- [ ] Confirm offline-earnings cap logic (2h base → 24h at top HDD tier) computes correctly across session gaps and after SDK data sync from another device.
- [ ] Confirm Format C: fully wipes Buzz/software state but preserves Dollars, hardware tiers, and AeroBurn "CD" bonuses exactly as designed, and that this persists correctly through the Data module.
- [ ] Regression-test all three ad hooks (Trojan Scan, Internet Cafe Bonus, Format C: interstitial) for: pause/mute on start, resume/unmute on finish or error, correct reward-only-on-success behavior, and AdBlock fallback behavior.
- [ ] Confirm no dead/non-functional rewarded-ad buttons remain visible when ads are disabled (Basic Launch) or unfilled.
- [ ] Final legal/content pass: no real trademarked OS/messenger logos, PEGI 12 tone check on the "virus"/"antivirus" mechanics, and add a short in-game Privacy Policy/Terms notice if any data beyond SDK-provided events is collected.

---

## 7. Post-Launch

- [ ] Monitor Developer Dashboard metrics (players, average playtime, gameplay conversion, retention, revenue) daily during Basic Launch.
- [ ] Compare against idle/simulation genre benchmarks (~14–17 min average session, ~7–7.5% Day 1 retention as platform reference points) to gauge Full Launch readiness.
- [ ] Consider integrating ByteBrew (CrazyGames analytics partner) for deeper funnel/drop-off tracking once past the 50k-plays technical-support threshold.
- [ ] Iterate on ad placement/frequency post-launch based on ads-per-active-user and retention drop-off data, rather than reducing SDK-controlled frequency directly.