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
  payout: 1,
};

/** Cooldowns can never be reduced to nothing, however deep the GPU tree goes. */
export const MIN_COOLDOWN = 0.15;

export const CPU_TIERS = [
  { name: 'Celedon 400', cost: 0, production: 0, click: 0 },
  { name: 'Pentagon II 733', cost: 3, production: 0.25, click: 0.5 },
  { name: 'Pentagon III 1.0', cost: 60, production: 0.35, click: 0.7 },
  { name: 'Athlete XP 2400+', cost: 320, production: 0.5, click: 1.0 },
  { name: 'Pentagon IV HT 3.2', cost: 1800, production: 0.7, click: 1.4 },
  { name: 'Core Duet E6600', cost: 11000, production: 1.0, click: 2.0 },
  // End-game tier unlocks the IoT Botnet (GDD 5). Botnet itself lands Day 7.
  { name: 'Core Quadra Q6600', cost: 75000, production: 1.4, click: 2.8, unlocksBotnet: true },
];

export const RAM_TIERS = [
  { name: '128 MB SDRAM', cost: 0, capacity: 0, production: 0 },
  { name: '256 MB SDRAM', cost: 10, capacity: 1, production: 0.06 },
  { name: '512 MB DDR', cost: 55, capacity: 2, production: 0.08 },
  { name: '1 GB DDR', cost: 300, capacity: 4, production: 0.11 },
  { name: '2 GB DDR2', cost: 1700, capacity: 8, production: 0.15 },
  { name: '4 GB DDR2', cost: 10000, capacity: 16, production: 0.2 },
  { name: '8 GB DDR2 (dual channel)', cost: 68000, capacity: 32, production: 0.28 },
];

export const GPU_TIERS = [
  { name: 'Integrated Xtreme Graphics', cost: 0, cooldown: 0, production: 0 },
  { name: 'GeForged MX 440', cost: 14, cooldown: 0.1, production: 0.06 },
  { name: 'Radium 9600 Pro', cost: 70, cooldown: 0.12, production: 0.08 },
  { name: 'GeForged 6800 GT', cost: 380, cooldown: 0.14, production: 0.11 },
  { name: 'Radium X1900 XT', cost: 2100, cooldown: 0.14, production: 0.15 },
  { name: 'GeForged 8800 GTX', cost: 13000, cooldown: 0.14, production: 0.2 },
];

export const HDD_TIERS = [
  { name: '20 GB IDE', cost: 0, storage: 0, offline: 0, production: 0 },
  { name: '40 GB IDE', cost: 16, storage: 1, offline: 1, production: 0.06 },
  { name: '80 GB IDE', cost: 85, storage: 2, offline: 2, production: 0.08 },
  { name: '250 GB SATA', cost: 450, storage: 8.5, offline: 8, production: 0.11 },
  { name: '500 GB SATA', cost: 2600, storage: 12.5, offline: 6, production: 0.15 },
  { name: '1 TB SATA', cost: 16000, storage: 25, offline: 6, production: 0.2 },
];

/**
 * The Mainboard track — the one upgrade that pays in Dollars rather than Buzz.
 *
 * Everything else on this page makes a run produce faster. This makes a run
 * *worth more*: `payout` is a flat percentage on the Dollars a Format C: banks,
 * and `econ.prestigeDivisor()` turns it back into the divisor the sqrt curve
 * actually uses (divisor / payout², because Dollars go as the square root).
 *
 * Stating it as the payout rather than as the divisor is the whole point. The
 * shop row can say "+20% Format C: payout" and that is literally the number
 * applied — the same contract every other track keeps (AO-19) — where "divisor:
 * 600" is a figure no player can price. For the record the tiers below land on
 * divisors of 1000, 826, 592 and 309.
 *
 * The gain is retroactive by construction: `lifetimeDollarValue` re-prices
 * *all* lifetime Buzz, so buying a tier makes a pending payout jump on the
 * spot. That is deliberate. It is the moment the mid-game wall comes down, and
 * it cannot run away with the economy because the track is four tiers long.
 *
 * It also carries a small `production` bonus like every other track (AO-19
 * economy patch) — a board is still hardware sitting in the run in front of
 * you, not only the next one, even though `payout` remains its main job.
 */
export const MOBO_TIERS = [
  { name: 'OEM Board (no jumpers)', cost: 0, payout: 0, production: 0 },
  { name: 'Pentagon Overclock Kit', cost: 2.5, payout: 0.1, production: 0.07 },
  { name: 'Dual-Core Bus Architecture', cost: 10, payout: 0.2, production: 0.1 },
  { name: 'Quantum Interconnect 500', cost: 50, payout: 0.5, production: 0.15 },
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
    blurb: 'How many apps you can run at once — and a little more Buzz besides.',
    affects: 'Memory budget · Buzz per second',
  },
  gpu: {
    label: 'GPU',
    tiers: GPU_TIERS,
    blurb: 'Cuts cooldowns on heavy apps, and a little more Buzz besides.',
    affects: 'Aero Studio renders · Buzz per second',
  },
  hdd: {
    label: 'HDD',
    tiers: HDD_TIERS,
    blurb: 'P2P capacity, seed slots, offline earnings cap, and a little more Buzz besides.',
    affects: 'Offline Buzz · LemonWire seed slots · Buzz per second',
  },
  // Every track earns a place on the shop page by moving Buzz/sec, this one
  // included — payout is still its main job, priced in the *next* run.
  mobo: {
    label: 'Mainboard',
    tiers: MOBO_TIERS,
    blurb: 'Turns the same lifetime Buzz into more Dollars — and a little more Buzz besides.',
    affects: 'Format C: payout · Buzz per second',
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
