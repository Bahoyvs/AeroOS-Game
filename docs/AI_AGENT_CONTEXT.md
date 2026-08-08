# AeroOS — AI Agent Context & Knowledge Base

Welcome, AI Agent! This document is a comprehensive, structured guide to **AeroOS — The Messenger Era**. It details the game design, system architecture, implementation status, and development guidelines so you can understand the codebase and begin working immediately.

---

## 1. Executive Summary: What is AeroOS?

**AeroOS — The Messenger Era** is a skeuomorphic, Frutiger Aero-themed idle simulation game set in a mock mid-2000s desktop operating system (inspired by Windows Vista/7 and MSN Messenger nostalgia).

### Core Gameplay Loop:
1. **Accumulate Buzz** (soft currency) passively from running chat bots, playing music, and seeding files, or actively by clicking the **Nudge** button (and maintaining a click streak).
2. **Spend Buzz** to install software and buy MSN-style chat buddies.
3. **Format C: (Prestige)**: When system memory is saturated or the computer becomes bloated (inducing audio distortion, UI hitching, and red-lining temperature widgets), run a "Format C:" system wipe.
4. **Acquire Dollars ($)** (hard currency) from the Format C: wipe based on lifetime Buzz.
5. **Upgrade Hardware**: Spend Dollars on permanent hardware components (CPU, RAM, GPU, HDD) and utilities (Auto-Defrag) to survive future bottlenecks and scale Buzz production exponentially.

---

## 2. Technical Stack & Architectural Rules

AeroOS has strict, load-bearing architectural constraints that must not be broken during development:

### 2.1 Code Seams & Directory Map
* **Core Simulation (`src/core/`)**: Holds all game state, progression logic, timers, and calculations. **CRITICAL:** Files under `src/core/` must never reference `window`, `document`, DOM events, or browser APIs (like `AudioContext`). They must remain testable in a plain Node.js environment.
* **Tuning Data (`src/data/`)**: Pure data balance sheets (costs, multipliers, playlist rosters, hardware levels). Design rules live here, not in code.
* **UI Presentation (`src/ui/`)**: Renders taskbars, drag-and-resize window frames, notification bubbles, and overlays. It reads state and triggers actions.
* **App Window Bodies (`src/apps/`)**: One file per application window body (e.g., AeroChat, RetroAmp). Registered in [src/apps/registry.js](file:///d:/Games/Web/AeroOS-Game/src/apps/registry.js).
* **Styles (`src/styles/` & components)**: Vanilla CSS using a custom emboss-bevel design system (`--emboss` / `--emboss-well`) with frosted-glass (`.glass`) elements styled via [7.css](https://khang-nd.github.io/7.css).

### 2.2 Data Flow & State Mutation
The codebase operates under a unidirectional data flow:
```
input (UI click) ──> game.<action>() ──> state mutation ──> bus.emit(EVENT)
                                                                │
                            loop.onRender() <── ui.update() <───┘
```
* **No UI Mutations**: The presentation layer never writes to `game.state` directly. It calls an action on `game` (e.g., `game.buyBuddy()`), which returns `{ ok, reason, ... }` to specify if the action succeeded or why it was refused.
* **Pure Derived Values**: Economy calculations and production numbers belong in [src/core/economy.js](file:///d:/Games/Web/AeroOS-Game/src/core/economy.js) as pure functions. If the UI needs to compute a game number, it must request it from `economy.js`.

### 2.3 The Clocks
The game utilizes a dual-clock approach to handle background/offline play correctly:
1. **Simulation Time (`dt` accumulation)**: Used for status-message events, Shield99 threat spawns, LemonWire Recycle Bin cooldowns, and defragmentation. These must not run out when the tab is backgrounded or closed.
2. **Wall Clock (`Date.now()` timestamps)**: Used for buffs, autosaves, ad cooldowns, and offline earnings. These must expire even if the player is away.

### 2.4 State, Saves & Backwards Compatibility
* [src/core/state.js](file:///d:/Games/Web/AeroOS-Game/src/core/state.js) via `createInitialState()` is the single source of truth for the save shape.
* Stored saves are migrated dynamically using `MIGRATIONS` and deep-merged over a fresh state. Adding a field is backwards compatible by default; you only need to increment `SAVE_VERSION` and add a migration if an *existing* field changes its type or meaning.
* Save storage defaults to the first working backend in this order: **CrazyGames SDK cloud data** ──> **browser localStorage** ──> **MemoryStorage** (in-memory test mock / private browser windows).

### 2.5 Performance & Assets
* **Synthesised Audio**: Sound effects, startup chimes, and retro synthwave background loops are generated programmatically in [src/ui/audio.js](file:///d:/Games/Web/AeroOS-Game/src/ui/audio.js) using the WebAudio API. No static MP3/WAV assets are shipped, keeping initial download lightweight (~792 KB).
* **Relative URLs**: All built assets in `dist/` must use relative paths (Vite's `base: './'`) to ensure the game can boot when hosted in deep portal subdirectories.
* **Wallpapers**: Original photographs are optimized from `art/wallpapers-src/` to `src/assets/` via `npm run wallpapers` (shrinking 8MB of source down to 1.2MB of highly compressed 1920x1200 Web/JPEG formats with CSS-inlined thumbnails).

---

## 3. Feature & App Implementation Matrix

| System / App | Purpose | Status | Notes & Location |
| :--- | :--- | :--- | :--- |
| **AeroChat** | Core idle engine. MSN-style chat list. Buddies generate passive Buzz. | **Complete** | [aerochat.js](file:///d:/Games/Web/AeroOS-Game/src/apps/aerochat.js) / [core/statusEvents.js](file:///d:/Games/Web/AeroOS-Game/src/core/statusEvents.js). Claims hot status bonuses. |
| **RetroAmp** | Winamp parody. Plays playlists (like *Soft Signals* or *P2P Downloader*) for global multipliers. | **Complete** | [retroamp.js](file:///d:/Games/Web/AeroOS-Game/src/apps/retroamp.js). Multipliers are derived, not buffered (they cost RAM while active). |
| **Format C:** | The prestige mechanic. BSOD, POST sequence, and Dollars payout. | **Complete** | [bsod.js](file:///d:/Games/Web/AeroOS-Game/src/ui/bsod.js). Payout calculated retroactively on Format C:. |
| **Hardware Shop** | Upgrade CPU (ticks & click streak), RAM (limits app multi-tasking), GPU (render speeds), and HDD (offline hours cap). | **Complete** | [system.js](file:///d:/Games/Web/AeroOS-Game/src/apps/system.js). Upgrades give flat additive percentages to stay safe against rebalancing. |
| **Mainboard** | Fifth hardware track. Reduces the prestige divisor to boost Dollar payouts. | **Complete** | [data/hardware.js](file:///d:/Games/Web/AeroOS-Game/src/data/hardware.js). Retroactive valuation, pricing in cents. |
| **LemonWire** | P2P seeding simulation. Active shared files earn passive Buzz based on size and risk. | **Complete** | [lemonwire.js](file:///d:/Games/Web/AeroOS-Game/src/apps/lemonwire.js). Features a 5-min Recycle Bin lock. Risk spawns security threats. |
| **Shield99** | Antivirus app. Catches LemonWire threats, puts them in quarantine, and cures infections (50% Buzz penalty). | **Complete** | [shield99.js](file:///d:/Games/Web/AeroOS-Game/src/apps/shield99.js). Real-time protection only active when the app is open. |
| **AeroBurn** | Burn Buzz onto CDs (MIX & OVERCLOCK tracks) that survive a Format C: wipe to give early-game run boosts. | **Complete** | [aeroburn.js](file:///d:/Games/Web/AeroOS-Game/src/apps/aeroburn.js). The burner hardware app itself survives Format C:. |
| **AeroSweeper** | Active Minesweeper mini-game. Safe squares add to click combo multipliers; mines halve it (soft penalty). | **Complete** | [aerosweeper.js](file:///d:/Games/Web/AeroOS-Game/src/apps/aerosweeper.js). Combo multipliers act as a temporary click buff. |
| **Aero Studio** | GPU-scaled video render project engine. High wait times for massive single Buzz rewards. | **Complete** | [aerostudio.js](file:///d:/Games/Web/AeroOS-Game/src/apps/aerostudio.js). Placed on Day 7; provides rendering progress skips via ads. |
| **Auto-Defrag** | $25.00 utility that auto-clears system bloat at 85% and caps offline bloat at 50%. | **Complete** | [defrag.js](file:///d:/Games/Web/AeroOS-Game/src/core/defrag.js). Clears bloat over 85 seconds, taxing 5% production while running. |
| **Display Properties** | Change desktop tint colors and AI-optimized wallpapers. | **Complete** | [theme.js](file:///d:/Games/Web/AeroOS-Game/src/ui/theme.js). Unlocks are derived from lifetime stats and survive prestige. |
| **Spotlight Tutorial** | Coach panel guiding users through Nudges, buddy purchase, RetroAmp bottleneck, and My Computer. | **Complete** | [spotlight.js](file:///d:/Games/Web/AeroOS-Game/src/ui/spotlight.js) / [goals.js](file:///d:/Games/Web/AeroOS-Game/src/core/goals.js). Spotlights resolve element positions dynamically. |
| **CrazyGames SDK** | Integrates CrazyGames v3 SDK for loading, gameplay status, data saves, and site-mute. | **Complete** | [main.js](file:///d:/Games/Web/AeroOS-Game/src/main.js). Interstitial ads occur on Format C: / render milestones. |
| **Monetization Switch**| Master toggle `ADS.enabled = false` in balance parameters. | **Stubbed** | [data/balance.js](file:///d:/Games/Web/AeroOS-Game/src/data/balance.js). Ad slots render fallbacks (e.g. 100% quarantine loot when off). |
| **IoT Botnet** | Hijack smart plugs and internet bridges for large passive Buzz gains. | **Not Started**| Scheduled for Day 7 backlog. CPU level 7 ('Core Quadra Q6600') contains an `unlocksBotnet` flag hook. |
| **Mini-Mod** | Sidebar mode widget to compress the OS into a sidebar. | **Not Started**| Vista-style sidebar panel scheduled for Day 7 backlog. |

---

## 4. Developer Recipes & Checklists

### 4.1 Running & Verifying Code
Always run checks before concluding your work session:
* **Run Tests**: `npm run test` or `vitest run`
* **Production Build Check**: `npm run build`
* **All-in-One Check**: `npm run check` (Runs tests and performs Vite compilation)

### 4.2 How to Add a New App
To add a new desktop app (e.g. `MyCoolApp`):
1. **Roster Configuration**: Add application parameters (install cost, RAM cost, unlocking thresholds) inside [src/data/apps.js](file:///d:/Games/Web/AeroOS-Game/src/data/apps.js).
2. **Implement App Entry**: Create `src/apps/mycoolapp.js` exporting:
   ```javascript
   export function mount(body, { game, app, ads }) {
     body.classList.add('app-mycoolapp');
     body.innerHTML = `<div>Welcome to My Cool App!</div>`;
     
     const update = () => { /* Read game state, update DOM */ };
     const ticket = game.bus.on(game.events.TICK, update);
     
     return () => {
       ticket(); // Cleanup listeners
     };
   }
   ```
3. **Register App**: Wire it up in the module list inside [src/apps/registry.js](file:///d:/Games/Web/AeroOS-Game/src/apps/registry.js).
4. **Logic Integration**: Define balance values in [src/data/balance.js](file:///d:/Games/Web/AeroOS-Game/src/data/balance.js) and calculation equations in [src/core/economy.js](file:///d:/Games/Web/AeroOS-Game/src/core/economy.js).
5. **Verify**: Add unit tests under the `tests/` directory verifying the logic behaves as expected.

### 4.3 How to Modify the Game State
To add new persisted properties:
1. Update `createInitialState()` in [src/core/state.js](file:///d:/Games/Web/AeroOS-Game/src/core/state.js) to specify the default field values. Old saves will automatically deep-merge and pick up these defaults.
2. If changing the type or semantic meaning of an existing field, increment `SAVE_VERSION` inside `state.js` and add a migration handler to the `MIGRATIONS` array.
3. Write a test in [tests/save.test.js](file:///d:/Games/Web/AeroOS-Game/tests/save.test.js) asserting that a legacy save payload resolves correctly.

### 4.4 How to Interface with Ads & Monetization
* All SDK monetization calls go through the adapter [src/ui/ads.js](file:///d:/Games/Web/AeroOS-Game/src/ui/ads.js).
* Cooldowns, pacing rates, and rewards are simulated cleanly in [src/core/ads.js](file:///d:/Games/Web/AeroOS-Game/src/core/ads.js) using the simulation/wall clocks.
* Test ad logic in plain Node using [tests/ads.test.js](file:///d:/Games/Web/AeroOS-Game/tests/ads.test.js).
* Use the master flag `ADS.enabled = false` in [src/data/balance.js](file:///d:/Games/Web/AeroOS-Game/src/data/balance.js) to toggle portal ads on/off. When disabled, standard ad buttons will automatically disappear, and gated loops will fall back to default non-ad payouts (or full payouts in the case of Shield99 Quarantine).

---

## 5. Helpful Console Debugging Cheats
For manual browser testing, the production build exposes the `window.AeroOS` namespace. From the developer console:

```javascript
// Add Prestige Dollars
AeroOS.game.state.dollars = 500;

// Set Lifetime Buzz for cosmetic unlocks
AeroOS.game.state.lifetimeBuzz = 6e6;

// Set Total Spent for cosmetic unlocks
AeroOS.game.state.dollarsSpentTotal = 50;

// Instantly force System Bloat for defragmentation testing
AeroOS.game.state.bloat = 0.86;

// Commit state to save storage
AeroOS.game.save();
```
