/**
 * Software roster (GDD section 6).
 *
 * Every app is declared here even when its behaviour ships on a later day, so
 * the desktop, taskbar, RAM accounting and save format are stable from Day 1.
 * `day` is the roadmap day the real mechanic is scheduled for (docs/ROADMAP.md);
 * apps past the current day render the placeholder body from
 * src/apps/placeholder.js instead of a half-working mechanic.
 */

export const APPS = [
  {
    id: 'aerochat',
    name: 'AeroChat',
    icon: 'icons/aerochat.png',
    day: 1,
    ram: 32,
    // Core idle engine: bots are bought with Buzz and generate Buzz.
    install: { cost: 0, unlockAt: 0 },
    window: { width: 340, height: 420 },
    blurb: 'Buddy list. Buy bots, they chat, chatter becomes Buzz.',
  },
  {
    id: 'retroamp',
    name: 'RetroAmp',
    icon: 'icons/retroamp.png',
    day: 3,
    ram: 64,
    // Cheap and unlocked early on purpose: the scripted tutorial (GDD 7) hands
    // the player RetroAmp right after their first buddy.
    //
    // 28, not 50. A buddy is 10 Buzz and the tour asks for RetroAmp immediately
    // afterwards, so at 50 the third step of the onboarding was a stretch of
    // nudging with nothing else to do in it — the flattest part of the first
    // minute, and the first place a new session has a reason to stop.
    install: { cost: 28, unlockAt: 20 },
    window: { width: 340, height: 330 },
    blurb: 'Playlists give global Buzz multipliers. Heavy metal costs RAM.',
  },
  {
    id: 'lemonwire',
    name: 'LemonWire',
    icon: 'icons/lemonwire.png',
    day: 5,
    ram: 96,
    install: { cost: 2000, unlockAt: 1200 },
    // Tall enough that the seed slots and the swarm are visible at once — the
    // whole app is the comparison between the two.
    window: { width: 430, height: 500 },
    blurb: 'Seed files for passive Buzz. Some of them bite.',
  },
  {
    id: 'shield99',
    name: 'Shield99',
    icon: 'icons/shield99.png',
    day: 5,
    ram: 48,
    install: { cost: 3000, unlockAt: 2500 },
    // The quarantine list is the app now, so the window opens tall enough to
    // show a catch without scrolling for it.
    window: { width: 360, height: 520 },
    blurb: 'Antivirus. Catches threats and seals them as loot.',
  },
  {
    id: 'aerostudio',
    name: 'Aero Studio',
    icon: 'icons/aerostudio.png',
    day: 7,
    ram: 192,
    install: { cost: 12000, unlockAt: 8000 },
    window: { width: 720, height: 520 },
    blurb: 'Long GPU-bound render, biggest single payout in the game.',
  },
  {
    id: 'aeroburn',
    name: 'AeroBurn',
    icon: 'icons/aeroburn.png',
    day: 6,
    ram: 64,
    install: { cost: 12000, unlockAt: 9000 },
    window: { width: 340, height: 260 },
    blurb: 'Burn Buzz to a CD that survives Format C:.',
  },
  {
    id: 'aerosweeper',
    name: 'AeroSweeper',
    icon: 'icons/aerosweeper.png',
    day: 7,
    ram: 64,
    install: { cost: 6000, unlockAt: 5000 },
    // Square board plus the HUD above it and the one big button below.
    window: { width: 340, height: 560 },
    blurb: 'Push your luck. Every safe square multiplies the Nudge button.',
  },

  /**
   * The v2 roster's three new *Full Window* buildings (patch §1.2). The other
   * three newcomers — AdBar, IoT Botnet and Cloud Mainframe — are deliberately
   * absent: they are Tray buildings, they never open a window, and they are
   * rendered by `src/ui/tray.js` instead. That is the whole point of the
   * category, so giving them an entry here would quietly undo it.
   *
   * Install costs are a small gate on top of the unit price, exactly as they
   * were for the shipped six. What actually paces these apps is the unit curve.
   */
  {
    id: 'vidchat',
    name: 'VidChat',
    icon: 'icons/vidchat.svg',
    day: 9,
    ram: 128,
    install: { cost: 250_000, unlockAt: 4_000 },
    window: { width: 400, height: 470 },
    blurb: 'Webcam calls at fifteen frames a second. Every one of them pays.',
  },
  {
    id: 'registrydoctor',
    name: 'Registry Doctor',
    icon: 'icons/registrydoctor.svg',
    day: 9,
    ram: 96,
    install: { cost: 3_000_000, unlockAt: 6_500 },
    window: { width: 420, height: 480 },
    blurb: 'Found 4,197 problems on this computer. Fixing them is not free.',
  },
  {
    id: 'geopage',
    name: 'GeoPage',
    icon: 'icons/geopage.svg',
    day: 9,
    ram: 112,
    /**
     * Deliberately outside the onboarding coach (`core/goals.js`).
     *
     * The goal chain ends on a hand-off precisely because a queue whose final
     * card is orders of magnitude past every card before it stops reading as a
     * queue — see the note on `CLOSING_GOAL`. GeoPage's install price is four
     * orders of magnitude past Aero Studio's, so pointing the coach at it would
     * reintroduce exactly the bug that note describes. The building roster is
     * what surfaces it, which is the job v2 §6 gives the roster.
     */
    beyondCoach: true,
    install: { cost: 5_000_000_000, unlockAt: 25_000 },
    window: { width: 430, height: 490 },
    blurb: 'Personal homepages. Under construction, forever.',
  },
];

/** Always-available system windows. Not part of the RAM budget. */
export const SYSTEM_APPS = [
  {
    id: 'system',
    name: 'My Computer',
    icon: 'icons/system.png',
    day: 1,
    ram: 0,
    system: true,
    // Revealed by the first memory bottleneck, per the scripted tour (GDD 7).
    hiddenUntilHardware: true,
    window: { width: 380, height: 400 },
    blurb: 'Hardware, Buzz rate, and the Format C: button.',
  },
  /**
   * The achievements window (GDD §D.3) is a system app, not a purchase: it is
   * a view onto progress the player already has, and charging RAM for looking
   * at your own trophies would be a strange thing to model.
   */
  {
    id: 'achievements',
    name: 'Achievements',
    icon: 'icons/achievements.svg',
    day: 9,
    ram: 0,
    system: true,
    window: { width: 460, height: 520 },
    blurb: 'Every badge, earned and unearned.',
  },
];

export const ALL_APPS = [...SYSTEM_APPS, ...APPS];

const BY_ID = new Map(ALL_APPS.map((app) => [app.id, app]));

export function getApp(id) {
  const app = BY_ID.get(id);
  if (!app) throw new Error(`Unknown app id: ${id}`);
  return app;
}

/** Is this id still on the roster? Old saves may name an app we have retired. */
export function hasApp(id) {
  return BY_ID.has(id);
}
