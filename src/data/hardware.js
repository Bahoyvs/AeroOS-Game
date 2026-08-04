/**
 * Permanent hardware, bought with Dollars ($) after a "Format C:" prestige.
 * GDD section 5. Tier 0 is the machine the player boots with on a fresh save.
 *
 * Every track is a flat list of tiers; `state.hardware.<track>` is an index
 * into that list, so adding a tier is append-only and save-compatible.
 *
 * AO-19: a tier does not *replace* a stat, it contributes a flat percentage
 * that adds to everything below it. Owning tiers 0..n gives 1 + Σ bonuses, so
 * a shop row can say exactly what the next purchase is worth ("+70% production")
 * instead of making the player diff two opaque multipliers. Capacities (memory,
 * storage, offline hours) are derived the same way from a base value, so the
 * whole shop speaks one language.
 */

/** Tier 0 machine: the absolutes every percentage is measured against. */
export const HARDWARE_BASE = {
  production: 1,
  click: 1,
  cooldown: 1,
  ramMB: 128,
  storageGB: 20,
  offlineHours: 2,
};

/** Cooldowns can never be reduced to nothing, however deep the GPU tree goes. */
export const MIN_COOLDOWN = 0.15;

export const CPU_TIERS = [
  { name: 'Celedon 400', cost: 0, production: 0, click: 0 },
  { name: 'Pentagon II 733', cost: 12, production: 0.25, click: 0.5 },
  { name: 'Pentagon III 1.0', cost: 60, production: 0.35, click: 0.7 },
  { name: 'Athlete XP 2400+', cost: 320, production: 0.5, click: 1.0 },
  { name: 'Pentagon IV HT 3.2', cost: 1800, production: 0.7, click: 1.4 },
  { name: 'Core Duet E6600', cost: 11000, production: 1.0, click: 2.0 },
  // End-game tier unlocks the IoT Botnet (GDD 5). Botnet itself lands Day 7.
  { name: 'Core Quadra Q6600', cost: 75000, production: 1.4, click: 2.8, unlocksBotnet: true },
];

export const RAM_TIERS = [
  { name: '128 MB SDRAM', cost: 0, capacity: 0 },
  { name: '256 MB SDRAM', cost: 10, capacity: 1 },
  { name: '512 MB DDR', cost: 55, capacity: 2 },
  { name: '1 GB DDR', cost: 300, capacity: 4 },
  { name: '2 GB DDR2', cost: 1700, capacity: 8 },
  { name: '4 GB DDR2', cost: 10000, capacity: 16 },
  { name: '8 GB DDR2 (dual channel)', cost: 68000, capacity: 32 },
];

export const GPU_TIERS = [
  { name: 'Integrated Xtreme Graphics', cost: 0, cooldown: 0 },
  { name: 'GeForged MX 440', cost: 14, cooldown: 0.1 },
  { name: 'Radium 9600 Pro', cost: 70, cooldown: 0.12 },
  { name: 'GeForged 6800 GT', cost: 380, cooldown: 0.14 },
  { name: 'Radium X1900 XT', cost: 2100, cooldown: 0.14 },
  { name: 'GeForged 8800 GTX', cost: 13000, cooldown: 0.14 },
];

export const HDD_TIERS = [
  { name: '20 GB IDE', cost: 0, storage: 0, offline: 0 },
  { name: '40 GB IDE', cost: 16, storage: 1, offline: 1 },
  { name: '80 GB IDE', cost: 85, storage: 2, offline: 2 },
  { name: '250 GB SATA', cost: 450, storage: 8.5, offline: 8 },
  { name: '500 GB SATA', cost: 2600, storage: 12.5, offline: 6 },
  { name: '1 TB SATA', cost: 16000, storage: 25, offline: 6 },
];

export const HARDWARE = {
  cpu: {
    label: 'CPU',
    tiers: CPU_TIERS,
    blurb: 'Global tick rate and click power.',
    affects: 'Buzz per second · Nudge payout',
  },
  ram: {
    label: 'RAM',
    tiers: RAM_TIERS,
    blurb: 'How many apps you can run at once.',
    affects: 'Memory budget',
  },
  gpu: {
    label: 'GPU',
    tiers: GPU_TIERS,
    blurb: 'Cuts cooldowns on heavy apps.',
    affects: 'Aero Studio renders',
  },
  hdd: {
    label: 'HDD',
    tiers: HDD_TIERS,
    blurb: 'P2P capacity and offline earnings cap.',
    affects: 'Offline Buzz · LemonWire downloads',
  },
};

export const HARDWARE_TRACKS = Object.keys(HARDWARE);

/** Current tier object for a track, clamped to the tier list. */
export function tierOf(track, index) {
  const tiers = HARDWARE[track].tiers;
  return tiers[Math.min(Math.max(index | 0, 0), tiers.length - 1)];
}

/** Next tier for a track, or null when maxed. */
export function nextTierOf(track, index) {
  return HARDWARE[track].tiers[index + 1] ?? null;
}

/**
 * Total of one bonus field across every tier the player owns (0..index).
 * This is what makes the percentages additive rather than replacing.
 */
export function sumBonus(track, index, field) {
  const tiers = HARDWARE[track].tiers;
  const owned = Math.min(Math.max(index | 0, 0), tiers.length - 1);
  let total = 0;
  for (let i = 0; i <= owned; i += 1) total += tiers[i][field] ?? 0;
  return total;
}
