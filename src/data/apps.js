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
    id: 'chainmail',
    name: 'ChainMail',
    icon: 'icons/chainmail.svg',
    day: 2,
    ram: 48,
    /**
     * Installing an app and unlocking its building are two different gates, and
     * the gap between them is deliberate: the app arrives first and opens on a
     * "connecting…" panel, so a building announces itself before it is buyable
     * rather than appearing fully formed in the Start menu.
     */
    install: { cost: 250, unlockAt: 100 },
    // Three panes — folder tree, message list, preview — like the real thing.
    window: { width: 470, height: 430 },
    blurb: 'Forward to ten people or nothing good will happen.',
  },
  {
    id: 'aeroboards',
    name: 'AeroBoards',
    icon: 'icons/aeroboards.svg',
    day: 2,
    ram: 80,
    install: { cost: 2000, unlockAt: 800 },
    window: { width: 500, height: 470 },
    blurb: 'Forums. 1,204 replies, none of them on topic.',
  },
  {
    id: 'geopage',
    name: 'GeoPage',
    icon: 'icons/geopage.svg',
    day: 2,
    ram: 112,
    install: { cost: 30000, unlockAt: 18000 },
    // Tall enough for the page preview and the View Source pane together.
    window: { width: 460, height: 500 },
    blurb: 'Under construction. Forever. With a MIDI.',
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
    blurb: 'Share files with the swarm. Some of them bite.',
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
    window: { width: 380, height: 400 },
    blurb: 'Hardware, Buzz rate, and the Format C: button.',
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
