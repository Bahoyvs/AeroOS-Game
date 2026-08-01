/**
 * Permanent hardware, bought with Dollars ($) after a "Format C:" prestige.
 * GDD section 5. Tier 0 is the machine the player boots with on a fresh save.
 *
 * Every track is a flat list of tiers; `state.hardware.<track>` is an index
 * into that list, so adding a tier is append-only and save-compatible.
 */

export const CPU_TIERS = [
  { name: 'Celedon 400', cost: 0, tickRate: 1.0, clickPower: 1 },
  { name: 'Pentagon II 733', cost: 12, tickRate: 1.25, clickPower: 2 },
  { name: 'Pentagon III 1.0', cost: 60, tickRate: 1.6, clickPower: 4 },
  { name: 'Athlete XP 2400+', cost: 320, tickRate: 2.1, clickPower: 8 },
  { name: 'Pentagon IV HT 3.2', cost: 1800, tickRate: 2.8, clickPower: 18 },
  { name: 'Core Duet E6600', cost: 11000, tickRate: 3.8, clickPower: 45 },
  // End-game tier unlocks the IoT Botnet (GDD 5). Botnet itself lands Day 6.
  { name: 'Core Quadra Q6600', cost: 75000, tickRate: 5.2, clickPower: 120, unlocksBotnet: true },
];

export const RAM_TIERS = [
  { name: '128 MB SDRAM', cost: 0, capacity: 128 },
  { name: '256 MB SDRAM', cost: 10, capacity: 256 },
  { name: '512 MB DDR', cost: 55, capacity: 512 },
  { name: '1 GB DDR', cost: 300, capacity: 1024 },
  { name: '2 GB DDR2', cost: 1700, capacity: 2048 },
  { name: '4 GB DDR2', cost: 10000, capacity: 4096 },
  { name: '8 GB DDR2 (dual channel)', cost: 68000, capacity: 8192 },
];

export const GPU_TIERS = [
  { name: 'Integrated Xtreme Graphics', cost: 0, cooldownMultiplier: 1.0 },
  { name: 'GeForged MX 440', cost: 14, cooldownMultiplier: 0.9 },
  { name: 'Radium 9600 Pro', cost: 70, cooldownMultiplier: 0.78 },
  { name: 'GeForged 6800 GT', cost: 380, cooldownMultiplier: 0.64 },
  { name: 'Radium X1900 XT', cost: 2100, cooldownMultiplier: 0.5 },
  { name: 'GeForged 8800 GTX', cost: 13000, cooldownMultiplier: 0.36 },
];

export const HDD_TIERS = [
  // offlineHours feeds the offline-earnings cap (GDD 5).
  { name: '20 GB IDE', cost: 0, capacityGB: 20, offlineHours: 2 },
  { name: '40 GB IDE', cost: 16, capacityGB: 40, offlineHours: 4 },
  { name: '80 GB IDE', cost: 85, capacityGB: 80, offlineHours: 8 },
  { name: '250 GB SATA', cost: 450, capacityGB: 250, offlineHours: 24 },
  { name: '500 GB SATA', cost: 2600, capacityGB: 500, offlineHours: 36 },
  { name: '1 TB SATA', cost: 16000, capacityGB: 1000, offlineHours: 48 },
];

export const HARDWARE = {
  cpu: { label: 'CPU', tiers: CPU_TIERS, blurb: 'Global tick rate and click power.' },
  ram: { label: 'RAM', tiers: RAM_TIERS, blurb: 'How many apps you can run at once.' },
  gpu: { label: 'GPU', tiers: GPU_TIERS, blurb: 'Cuts cooldowns on heavy apps.' },
  hdd: { label: 'HDD', tiers: HDD_TIERS, blurb: 'P2P capacity and offline earnings cap.' },
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
