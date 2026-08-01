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
    icon: '💬',
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
    icon: '🎵',
    day: 2,
    ram: 64,
    install: { cost: 250, unlockAt: 150 },
    window: { width: 320, height: 240 },
    blurb: 'Playlists give global Buzz multipliers. Heavy metal costs RAM.',
  },
  {
    id: 'lemonwire',
    name: 'LemonWire',
    icon: '🍋',
    day: 4,
    ram: 96,
    install: { cost: 2000, unlockAt: 1200 },
    window: { width: 420, height: 320 },
    blurb: 'P2P downloads pay out big. Some of them bite.',
  },
  {
    id: 'shield99',
    name: 'Shield99',
    icon: '🛡️',
    day: 4,
    ram: 48,
    install: { cost: 3000, unlockAt: 2500 },
    window: { width: 320, height: 260 },
    blurb: 'Antivirus. First virus of a run is rescued for free.',
  },
  {
    id: 'aerostudio',
    name: 'Aero Studio',
    icon: '🎬',
    day: 5,
    ram: 192,
    install: { cost: 12000, unlockAt: 8000 },
    window: { width: 440, height: 300 },
    blurb: 'Long GPU-bound render, biggest single payout in the game.',
  },
  {
    id: 'aeroburn',
    name: 'AeroBurn',
    icon: '💿',
    day: 5,
    ram: 64,
    install: { cost: 20000, unlockAt: 15000 },
    window: { width: 340, height: 260 },
    blurb: 'Burn Buzz to a CD that survives Format C:.',
  },
  {
    id: 'pinball',
    name: 'Galactic Pinball 3D',
    icon: '🕹️',
    day: 6,
    ram: 128,
    install: { cost: 6000, unlockAt: 5000 },
    window: { width: 380, height: 460 },
    blurb: 'Active mini-game for combo multipliers between idle ticks.',
  },
];

/** Always-available system windows. Not part of the RAM budget. */
export const SYSTEM_APPS = [
  {
    id: 'system',
    name: 'My Computer',
    icon: '🖥️',
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
