import { ALL_APPS } from '../data/apps.js';

/**
 * Bump SAVE_VERSION whenever the shape below changes in a way that old saves
 * cannot satisfy, and add a migration in src/core/save.js.
 */
export const SAVE_VERSION = 1;

/** Apps the player boots with on a fresh install. */
const PREINSTALLED = new Set(['system', 'aerochat']);

export function createInitialState(now = Date.now()) {
  const apps = {};
  for (const app of ALL_APPS) {
    apps[app.id] = {
      installed: app.system === true || PREINSTALLED.has(app.id),
      open: false,
      minimized: false,
    };
  }

  return {
    version: SAVE_VERSION,

    // Currencies (GDD 4)
    buzz: 0,
    lifetimeBuzz: 0, // never reset; drives Format C: payout
    runBuzz: 0, // reset on prestige; drives unlocks within a run
    dollars: 0,
    dollarsEarnedTotal: 0, // never reset; prestige pays out the difference

    // Progression
    prestigeCount: 0,
    hardware: { cpu: 0, ram: 0, gpu: 0, hdd: 0 },

    // Software
    apps,
    chat: {
      bots: 0,
      // Rotating status-message event: { index, bonusId, secondsLeft } or null.
      // Both counters are in simulation seconds, not wall-clock time.
      event: null,
      nextEventIn: 0, // rolled on the first tick with AeroChat open
    },

    retroamp: {
      playlist: null, // id of the loaded playlist, or null
      endsAt: 0, // wall clock; only used by timed playlists
      cooldownUntil: {}, // playlist id -> timestamp it can be loaded again
      startedAt: 0,
    },

    // Timed bonuses from status events and rewarded ads. Playlist multipliers
    // are NOT buffs: they are derived from `retroamp` so they survive a reload.
    buffs: [],

    // Pressure loop (GDD 7)
    bloat: 0,

    // Session bookkeeping
    stats: { nudges: 0, playtimeSeconds: 0, bonusesClaimed: 0, bonusesMissed: 0 },
    lastSeen: now,
    startedAt: now,

    settings: { sfx: true, bgm: true, reducedMotion: false },

    // Scripted onboarding (GDD 7). `hardwareRevealed` gates My Computer and the
    // CPU/RAM readouts until the player hits their first memory bottleneck.
    tutorial: { step: 0, done: false, hardwareRevealed: false },
  };
}

/**
 * Reset for "Format C:" — software is wiped, hardware and Dollars persist.
 * Pure: returns a new state, never mutates the argument.
 */
export function resetForPrestige(state, dollarsEarned, now = Date.now()) {
  const fresh = createInitialState(now);
  return {
    ...fresh,
    dollars: state.dollars + dollarsEarned,
    dollarsEarnedTotal: state.dollarsEarnedTotal + dollarsEarned,
    lifetimeBuzz: state.lifetimeBuzz,
    prestigeCount: state.prestigeCount + 1,
    hardware: { ...state.hardware },
    stats: { ...state.stats },
    settings: { ...state.settings },
    tutorial: { ...state.tutorial, done: true },
    startedAt: state.startedAt,
  };
}
