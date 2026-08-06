# Game Design Document: AeroOS — The Messenger Era

> Transcribed from `GDD_ AeroOS_ The Messenger Era.pdf` so the design lives next to the
> code. The PDF remains the authored source; if the two disagree, the PDF wins —
> update this file when it does.

**Genre:** Idle / Simulation / Management
**Platform:** Web browser (HTML5, mobile & desktop) — CrazyGames / Poki
**Theme:** Mid-2000s desktop OS, Frutiger Aero, MSN Messenger nostalgia, skeuomorphism

## 1. Vision & core experience

AeroOS is a maximalist idle simulation that puts the player in front of a mid-2000s
operating system. The goal is to build the largest digital social network and maximise
data production. Players balance social interactions against their computer's hardware
capabilities. To run more software and talk to more bots simultaneously, they must
"Format C:" the system, earn hard currency, and upgrade physical PC components.

## 2. Visual & audio design

### Art direction & UI tech stack

The game uses the Frutiger Aero aesthetic. To avoid an asset-creation bottleneck the UI
is built dynamically with CSS.

- **Core framework:** [7.css](https://khang-nd.github.io/7.css) for the Windows 7 / Aero
  glass look — frosted borders, drop shadows, glossy buttons — with no heavy image assets.
- **Iconography:** open-source sets such as the Tango Desktop Project and FamFamFam Silk.
- **Wallpapers:** AI-generated glossy wallpapers with water drops and bright green/blue palettes.

### Audio design

- **SFX:** deep tactile mechanical clicks, authentic HDD read/write noise, dial-up and
  startup chimes. As the system bloats, audio distortion is layered in to build tension
  before a prestige.
- **BGM:** light retro synthwave loops. Intense rendering moments use driving 16th-note
  arpeggios with heavy sidechain compression; idle moments use atmospheric, melancholic
  indie tones.

## 3. UI/UX architecture

- **Desktop view:** a true OS experience — windows are freely draggable, resizable and can overlap.
- **Mobile view (PDA style):** optimised for edge-to-edge displays. Dragging is disabled.
  The bottom taskbar is the main navigation hub; tapping an app slides it up as a
  full-screen modal. **RAM bars** sit under the taskbar icons so mobile players can
  monitor background RAM usage.
- **Mini-Mod (widget mode):** a compact mode that shrinks the OS into a thin vertical
  sidebar (like Rainmeter or the Vista sidebar) so players can watch idle progress while
  the game runs in the background.

## 4. Currency & economy

| Currency | Type | Description & use |
| --- | --- | --- |
| **Buzz** | Soft | Generated every second by open apps and by manually clicking the Nudge button. Resets on prestige. Spent on software and chat bots. |
| **Dollars ($)** | Hard | Earned only during a "Format C:" reset, based on total lifetime Buzz. Spent strictly on permanent hardware upgrades. |

## 5. Hardware upgrades (Format C: prestige)

When the OS becomes bloated — window trails, slow animations, loud fan SFX — the player
runs "Format C:". All software is wiped, but Dollars are awarded for permanent hardware:

- **CPU:** sets the global tick rate and click power. End-game CPUs unlock the **IoT
  Botnet**, letting players hijack local smart plugs, fans and gateway bridges for massive
  passive Buzz.
- **RAM:** dictates multitasking capacity. Every app has a RAM cost; exceeding the limit
  crashes the system.
- **GPU:** reduces cooldowns on heavy, high-reward apps such as video renderers.
- **HDD:** sets maximum P2P download capacity and extends the offline-earnings cap
  (e.g. 20 GB → 250 GB SATA extends offline accumulation from 2 to 24 hours).

## 6. Software roster & mechanics

- **AeroChat** — the core idle engine. Players buy chat bots that generate passive Buzz.
  Buddy lists show dynamic status messages (e.g. *"Baho_007 is playing Star Wars
  Battlefront II"*) that grant small bonuses.
- **RetroAmp** — global Buzz multipliers based on the loaded playlist. An indie
  "SOFT SIGNALS" playlist gives a permanent small multiplier; heavy metal gives a massive
  short-burst multiplier but costs a lot of RAM.
- **LemonWire** — P2P sharing. Files placed in seed slots pay passive Buzz for as long as
  they are shared; rare and risky files pay most, and the connection tier multiplies every
  slot. *Safety net:* a virus no longer ruins a run — it caps production drops at a soft
  floor of 50%, or only suspends LemonWire itself.
- **Aero Studio** — video rendering, GPU-dependent. Long cooldown, highest single payout.
- **Shield99** — antivirus protecting against LemonWire's threats. Kept open, it catches
  them and seals them in a quarantine the player opens for loot (rewarded ad, with a
  reduced non-ad path). Kept closed, the free trial rescue covers the first one only.
- **AeroBurn** — burns excess Buzz onto a "CD" that survives the prestige wipe, granting
  starting boosts for the next run.
- **Galactic Pinball 3D** — active mini-game window for generating Buzz and combo
  multipliers while waiting on idle tasks.

## 7. Onboarding & game pacing

Aimed at a platform with a ~30-minute average session, so early churn must stay low.

- **Hard-scripted tutorial (first 60 seconds):** the game starts on a clean desktop with
  only the AeroChat icon. The player clicks to add their first bot. RetroAmp unlocks next.
  Hardware stats (CPU, RAM) stay hidden until the first system bottleneck.
- **Prestige tension:** the need to prestige is communicated through intense audio-visual
  feedback (system lag, heat widgets turning red), not just maths — reframing the BSOD from
  a punishment into psychological relief.

## 8. Monetization strategy

- **Rewarded ad — "The Trojan Scan":** a fake popup appears: *"System slowdown detected!
  Run Shield99 Deep Scan? (Watch Ad)"*. Completing the scan acts as an overclock, doubling
  production for 4 hours.
- **Rewarded ad — "Internet Cafe Bonus":** on returning online: *"Your buddies logged in
  from the Internet Cafe! Watch a sponsor video to 2X your offline Buzz."*
- **Interstitial ad:** triggers only during a "Format C:" reset, hidden behind the
  nostalgic OS loading screen to align with a natural gameplay pause.
