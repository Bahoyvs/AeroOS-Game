/**
 * The upgrade layer (v2 §4).
 *
 * Four patterns, all data-driven so the engine in `core/upgrades.js` has no
 * per-building branches:
 *
 * 1. **Tiered doubling** (§4.1) — six per building, each ×2 on *that building's*
 *    own production. Gated on Buzz **and** on owning enough units, which is what
 *    turns "the next upgrade" into a visible, unaffordable goal rather than a
 *    surprise. That double gate is the audit's missing visibility hook.
 * 2. **Cross-building, buddy-driven** (§4.2) — the Grandma pattern. Every
 *    building from RetroAmp down has exactly one upgrade that pays it a bonus
 *    scaled by how many AeroChat buddies you own, so the anchor resource keeps
 *    mattering at step twelve.
 * 3. **Synergy pairs** (§4.3) — five thematically matched couples. Each pair is
 *    one purchase that switches on *both* directions, asymmetrically: the major
 *    side gains more per partner unit than the minor side does.
 * 4. **The AeroChat exception** (§4.4) — Cursor's rule. AeroChat's late upgrades
 *    do not double it; they add flat Buzz/sec for every *other* building the
 *    player owns. That keeps the starter building relevant into the end game
 *    without letting it dominate the curve.
 *
 * Everything here multiplies its own building only. The global chain is the
 * hardware layer and the legacy layer, and nothing in this file touches it
 * (§4.5).
 */

import { BUILDINGS, getBuilding } from './buildings.js';

/**
 * Unit counts that unlock each tiered upgrade. Six gates, widening — the first
 * arrives while a building is still novel, the last is a long-term goal.
 */
export const TIER_UNIT_GATES = [10, 25, 50, 100, 150, 200];

/**
 * What each tier costs, as a multiple of the building's *unit* base cost. The
 * jumps are steep by design: an upgrade should cost meaningfully more than the
 * units that unlocked it, or it is never a decision.
 */
export const TIER_COST_MULTIPLIERS = [10, 100, 500, 5_000, 50_000, 500_000];

/** Every tiered upgrade doubles its building. Flat, predictable, stackable. */
export const TIER_MULTIPLIER = 2;

/**
 * Period-accurate names, six per building. Pure flavour — the engine reads the
 * index, never the string — but they are the only place the upgrade layer gets
 * to be funny, so they earn their bytes.
 */
const TIER_NAMES = {
  aerochat: [
    'Custom Emoticon Pack',
    'Winks & Nudges Add-on',
    'Display Picture Studio',
    'Buddy List Groups',
    'Offline Messaging',
    'Multi-Client Patch',
  ],
  retroamp: [
    'Classic Skin Pack',
    '10-Band Equalizer',
    'Gapless Playback',
    'Nullsoft Streaming Audio',
    'Milkdrop Visualiser',
    'Shoutcast Relay',
  ],
  lemonwire: [
    'Ultrapeer Status',
    'Swarmed Downloading',
    'Partial File Sharing',
    'Hash Verification',
    'Turbo-Charged Uploads',
    'PRO Licence Key',
  ],
  adbar: [
    'Search Hijack Module',
    'Pop-Under Rotation',
    'Browser Helper Object',
    'Bundled Installer Deal',
    'Homepage Lock',
    'Uninstall-Proof Service',
  ],
  shield99: [
    'Heuristic Engine',
    'Daily Definition Push',
    'Real-Time Shield',
    'Rootkit Sweeper',
    'Corporate Site Licence',
    'Threat Intelligence Cloud',
  ],
  vidchat: [
    'Webcam Driver Bundle',
    'Half-Duplex Audio',
    'Picture-in-Picture Mode',
    'Motion Compensation',
    'Group Call Beta',
    'Broadband Codec',
  ],
  registrydoctor: [
    'Deep Scan Engine',
    'One-Click Optimiser',
    'Startup Manager',
    'Driver Update Bundle',
    'Lifetime Licence Upsell',
    'Reseller Programme',
  ],
  aerostudio: [
    'Hardware Transform Path',
    'Batch Render Queue',
    'Multi-Pass Compositing',
    'Distributed Render Farm',
    'Realtime Preview Codec',
    'Broadcast Master Suite',
  ],
  aeroburn: [
    'Buffer Underrun Protection',
    '52× Write Speed',
    'Dual-Layer Support',
    'Disc-at-Once Mastering',
    'LightScribe Labelling',
    'Robotic Disc Changer',
  ],
  geopage: [
    'Animated GIF Library',
    'Guestbook CGI',
    'MIDI Autoplay',
    'Webring Membership',
    'Banner Exchange Deal',
    'Custom Domain Redirect',
  ],
  iotbotnet: [
    'Default Credential List',
    'Telnet Scanner',
    'Persistence Payload',
    'Peer-to-Peer C2',
    'Firmware Flasher',
    'Rental Marketplace',
  ],
  cloudmainframe: [
    'Virtual Machine Images',
    'Elastic Autoscaling',
    'Regional Failover',
    'Reserved Instance Pricing',
    'Bare-Metal Tenancy',
    'Sovereign Availability Zone',
  ],
};

/**
 * The Grandma pattern (§4.2). `perBuddies` widens as the roster deepens, so
 * buddies are worth most to the buildings nearest them — the anchor's influence
 * fades with distance instead of scaling every step equally.
 */
const CROSS_TUNING = {
  retroamp: { perBuddies: 10, bonus: 0.02, name: 'Buddy Playlist Swap' },
  lemonwire: { perBuddies: 15, bonus: 0.02, name: 'Buddy Swarm Seeding' },
  adbar: { perBuddies: 20, bonus: 0.02, name: 'Referral Impressions' },
  shield99: { perBuddies: 30, bonus: 0.02, name: 'Buddy Licence Bundle' },
  vidchat: { perBuddies: 40, bonus: 0.02, name: 'Group Video Invites' },
  registrydoctor: { perBuddies: 55, bonus: 0.02, name: 'Word-of-Mouth Scans' },
  aerostudio: { perBuddies: 70, bonus: 0.02, name: 'Crowdsourced Render Credits' },
  aeroburn: { perBuddies: 90, bonus: 0.02, name: 'Mix CD Trading Circle' },
  geopage: { perBuddies: 120, bonus: 0.02, name: 'Buddy Webring' },
  iotbotnet: { perBuddies: 160, bonus: 0.02, name: 'Buddy Device Harvest' },
  cloudmainframe: { perBuddies: 200, bonus: 0.02, name: 'Social Login Federation' },
};

/** Cross upgrades cost this multiple of the building's unit base cost. */
const CROSS_COST_MULTIPLIER = 250;

/**
 * Synergy couples (§4.3). `major` gains `majorPerUnit` for every unit of
 * `minor`; `minor` gains the smaller `minorPerUnit` for every unit of `major`.
 * One purchase switches on both directions.
 */
export const SYNERGY_PAIRS = [
  {
    id: 'lemonwire+shield99',
    major: 'lemonwire',
    minor: 'shield99',
    name: 'Shared Folder Amnesty',
    blurb: 'The antivirus stops quarantining your own uploads. Throughput doubles.',
  },
  {
    id: 'retroamp+vidchat',
    major: 'retroamp',
    minor: 'vidchat',
    name: 'Now Playing Status',
    blurb: 'Your track title rides along on every video call.',
  },
  {
    id: 'aeroburn+registrydoctor',
    major: 'aeroburn',
    minor: 'registrydoctor',
    name: 'Rescue Disc Edition',
    blurb: 'Every burner ships a copy of the optimiser nobody needed.',
  },
  {
    id: 'geopage+adbar',
    major: 'geopage',
    minor: 'adbar',
    name: 'Banner Exchange Network',
    blurb: 'Your homepage carries their toolbar. Their toolbar links your homepage.',
  },
  {
    id: 'iotbotnet+cloudmainframe',
    major: 'iotbotnet',
    minor: 'cloudmainframe',
    name: 'Elastic Command & Control',
    blurb: 'The botnet rents the mainframe. The mainframe bills the botnet.',
  },
];

/** How much each side of a synergy pair gains per unit of its partner. */
export const SYNERGY_MAJOR_PER_UNIT = 0.0005; // +0.05% per partner unit
export const SYNERGY_MINOR_PER_UNIT = 0.0002; // +0.02% per partner unit

/** Synergy upgrades are priced off the *major* partner's unit base cost. */
const SYNERGY_COST_MULTIPLIER = 400;

/**
 * The AeroChat exception (§4.4). These replace tiers 4-6 of AeroChat's ladder:
 * instead of doubling a building that is already the cheapest in the game, they
 * pay flat Buzz/sec for every *distinct* building the player owns a unit of.
 */
const AEROCHAT_PER_BUILDING = [
  { at: 3, flat: 5, name: 'Buddy List Sync' },
  { at: 4, flat: 25, name: 'Presence Federation' },
  { at: 5, flat: 100, name: 'Universal Contact Card' },
];

function tieredUpgrades() {
  const out = [];
  for (const building of BUILDINGS) {
    const names = TIER_NAMES[building.id] ?? [];
    for (let i = 0; i < TIER_UNIT_GATES.length; i += 1) {
      // AeroChat's last three rungs are the Cursor exception, not doublings.
      const exception = building.id === 'aerochat'
        ? AEROCHAT_PER_BUILDING.find((e) => e.at === i)
        : null;

      out.push({
        id: `${building.id}.t${i + 1}`,
        buildingId: building.id,
        kind: 'tiered',
        tier: i + 1,
        name: exception?.name ?? names[i] ?? `${building.name} Upgrade ${i + 1}`,
        requiresUnits: TIER_UNIT_GATES[i],
        cost: Math.ceil(building.baseCost * TIER_COST_MULTIPLIERS[i]),
        effect: exception
          ? { kind: 'perBuilding', flat: exception.flat }
          : { kind: 'double', multiplier: TIER_MULTIPLIER },
      });
    }
  }
  return out;
}

function crossUpgrades() {
  return Object.entries(CROSS_TUNING).map(([buildingId, tuning]) => {
    const building = getBuilding(buildingId);
    return {
      id: `${buildingId}.buddies`,
      buildingId,
      kind: 'cross',
      name: tuning.name,
      // Deliberately gated lower than the tiered ladder: this is the upgrade
      // that teaches the player buddies still matter, so it must be reachable.
      requiresUnits: 5,
      cost: Math.ceil(building.baseCost * CROSS_COST_MULTIPLIER),
      effect: { kind: 'perBuddies', per: tuning.perBuddies, bonus: tuning.bonus },
    };
  });
}

function synergyUpgrades() {
  return SYNERGY_PAIRS.map((pair) => ({
    id: pair.id,
    buildingId: pair.major,
    kind: 'synergy',
    name: pair.name,
    blurb: pair.blurb,
    // Both partners must be genuinely in play, or a synergy is just a discount
    // on a building you already own.
    requiresUnits: 15,
    requiresPartnerUnits: 15,
    partnerId: pair.minor,
    cost: Math.ceil(getBuilding(pair.major).baseCost * SYNERGY_COST_MULTIPLIER),
    effect: {
      kind: 'synergy',
      major: pair.major,
      minor: pair.minor,
      majorPerUnit: SYNERGY_MAJOR_PER_UNIT,
      minorPerUnit: SYNERGY_MINOR_PER_UNIT,
    },
  }));
}

export const UPGRADES = [...tieredUpgrades(), ...crossUpgrades(), ...synergyUpgrades()];

export const UPGRADE_IDS = UPGRADES.map((u) => u.id);

const UPGRADES_BY_ID = new Map(UPGRADES.map((u) => [u.id, u]));

/** Upgrades grouped by the building whose panel lists them. */
const UPGRADES_BY_BUILDING = new Map();
for (const upgrade of UPGRADES) {
  if (!UPGRADES_BY_BUILDING.has(upgrade.buildingId)) {
    UPGRADES_BY_BUILDING.set(upgrade.buildingId, []);
  }
  UPGRADES_BY_BUILDING.get(upgrade.buildingId).push(upgrade);
}

export function getUpgrade(id) {
  return UPGRADES_BY_ID.get(id) ?? null;
}

export function hasUpgrade(id) {
  return UPGRADES_BY_ID.has(id);
}

export function upgradesFor(buildingId) {
  return UPGRADES_BY_BUILDING.get(buildingId) ?? [];
}

/**
 * Every upgrade that changes a given building's output — including the synergy
 * pairs it is only the *minor* half of, which are filed under their major
 * partner. `core/upgrades.js` needs both views; the panels only need the one
 * above.
 */
export function upgradesAffecting(buildingId) {
  return UPGRADES.filter(
    (u) =>
      u.buildingId === buildingId ||
      (u.effect.kind === 'synergy' && u.effect.minor === buildingId),
  );
}
