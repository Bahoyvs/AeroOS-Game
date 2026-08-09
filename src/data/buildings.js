/**
 * The building roster — the economy's twelve production steps.
 *
 * This is the v2 economy redesign's core table. Every economic app is a
 * *building*: a thing you own N of, where each unit pays `baseRate` Buzz/sec and
 * the Nth unit costs `ceil(baseCost × 1.15^(N-1))`. The growth factor is fixed
 * at 1.15 for all twelve on purpose (patch §2.1) — it is AeroChat's shipped,
 * play-verified curve, and one shared `unitCost()` is worth more than twelve
 * hand-tuned ones.
 *
 * Two properties of this table are load-bearing:
 *
 * - **Each step is ~12× the cost and ~10× the production of the one above it.**
 *   That gap is what gives every building its own "this is the one to buy right
 *   now" window instead of one dominant purchase for the whole game.
 * - **`unlockAt` is far below what a building costs.** A player sees GeoPage on
 *   the roster at 25k run Buzz and cannot afford a unit of it for hours. That is
 *   the visibility hook the economy audit found missing (v2 §6): the next thing
 *   is always on screen, and always out of reach.
 *
 * `category` is the window-footprint decision from patch §1.2. It is a
 * *rendering* fact, never an economic one — a Tray building produces exactly
 * like a Full Window one, it simply has no window to open. See `ui/tray.js`.
 *
 * AeroChat is the one building whose units do not live in `state.buildings`:
 * they are `state.chat.bots`, and they stay there (redesign decision #3). The
 * `unitsFrom` field is what lets `core/buildings.js` read it without a special
 * case at every call site.
 */

/** The fixed geometric price growth. Not per-building — see patch §2.1. */
export const UNIT_COST_GROWTH = 1.15;

export const BUILDINGS = [
  {
    id: 'aerochat',
    name: 'AeroChat',
    order: 1,
    unitLabel: 'buddy',
    unitLabelPlural: 'buddies',
    baseCost: 10,
    baseRate: 0.5,
    unlockAt: 0,
    maxPerRun: 500,
    category: 'window',
    /** Units live in `state.chat.bots`, not `state.buildings.aerochat.units`. */
    unitsFrom: 'chat.bots',
    blurb: 'Buddies chatter. Chatter is Buzz.',
  },
  {
    id: 'retroamp',
    name: 'RetroAmp',
    order: 2,
    unitLabel: 'playlist',
    unitLabelPlural: 'playlists',
    baseCost: 120,
    baseRate: 5,
    unlockAt: 20,
    maxPerRun: 400,
    category: 'window',
    blurb: 'Seeded playlists keep paying long after the window is shut.',
  },
  {
    id: 'lemonwire',
    name: 'LemonWire',
    order: 3,
    unitLabel: 'node',
    unitLabelPlural: 'nodes',
    baseCost: 1_440,
    baseRate: 50,
    unlockAt: 1_200,
    maxPerRun: 350,
    category: 'window',
    blurb: 'Every node on the swarm is another upload nobody asked for.',
  },
  {
    id: 'adbar',
    name: 'AdBar',
    order: 4,
    unitLabel: 'toolbar',
    unitLabelPlural: 'toolbars',
    baseCost: 17_280,
    baseRate: 500,
    unlockAt: 1_800,
    maxPerRun: 300,
    category: 'tray',
    blurb: 'Paid per install. Installs itself.',
  },
  {
    id: 'shield99',
    name: 'Shield99',
    order: 5,
    unitLabel: 'licence',
    unitLabelPlural: 'licences',
    baseCost: 207_360,
    baseRate: 5_000,
    unlockAt: 2_500,
    maxPerRun: 250,
    category: 'window',
    blurb: 'Subscription revenue from a threat you are also selling.',
  },
  {
    id: 'vidchat',
    name: 'VidChat',
    order: 6,
    unitLabel: 'channel',
    unitLabelPlural: 'channels',
    baseCost: 2_488_320,
    baseRate: 50_000,
    unlockAt: 4_000,
    maxPerRun: 200,
    category: 'window',
    blurb: 'Fifteen frames a second, and every one of them is worth money.',
  },
  {
    id: 'registrydoctor',
    name: 'Registry Doctor',
    order: 7,
    unitLabel: 'licence',
    unitLabelPlural: 'licences',
    baseCost: 29_859_840,
    baseRate: 500_000,
    unlockAt: 6_500,
    maxPerRun: 175,
    category: 'window',
    blurb: 'Found 4,197 problems. Fixing them costs $39.95.',
  },
  {
    id: 'aerostudio',
    name: 'Aero Studio',
    order: 8,
    unitLabel: 'render node',
    unitLabelPlural: 'render nodes',
    baseCost: 358_318_080,
    baseRate: 5_000_000,
    unlockAt: 8_000,
    maxPerRun: 150,
    category: 'window',
    blurb: 'A render farm in a bedroom. The fans never stop.',
  },
  {
    id: 'aeroburn',
    name: 'AeroBurn',
    order: 9,
    unitLabel: 'burner',
    unitLabelPlural: 'burners',
    baseCost: 4_299_816_960,
    baseRate: 50_000_000,
    unlockAt: 9_000,
    maxPerRun: 125,
    category: 'window',
    blurb: 'A tower of drives, all writing at 52×.',
  },
  {
    id: 'geopage',
    name: 'GeoPage',
    order: 10,
    unitLabel: 'homepage',
    unitLabelPlural: 'homepages',
    baseCost: 51_597_803_520,
    baseRate: 500_000_000,
    unlockAt: 25_000,
    maxPerRun: 100,
    category: 'window',
    blurb: 'Under construction since 1998. The counter still turns.',
  },
  {
    id: 'iotbotnet',
    name: 'IoT Botnet',
    order: 11,
    unitLabel: 'device',
    unitLabelPlural: 'devices',
    baseCost: 619_173_642_240,
    baseRate: 5_000_000_000,
    unlockAt: 300_000,
    maxPerRun: 75,
    category: 'tray',
    /**
     * The one building with a two-key lock (v2 §7). The CPU tier flag has been
     * sitting unused in `data/hardware.js` since Day 4 — this is what fills it.
     */
    requiresCpuTier: 6,
    blurb: 'Smart plugs, smart fans, smart doorbells. None of them are smart.',
  },
  {
    id: 'cloudmainframe',
    name: 'Cloud Mainframe',
    order: 12,
    unitLabel: 'rack',
    unitLabelPlural: 'racks',
    baseCost: 7_430_083_706_880,
    baseRate: 50_000_000_000,
    unlockAt: 5_000_000,
    maxPerRun: 50,
    category: 'tray',
    blurb: 'The desktop era ends here, and it ends in somebody else’s building.',
  },
];

export const BUILDING_IDS = BUILDINGS.map((b) => b.id);

const BY_ID = new Map(BUILDINGS.map((b) => [b.id, b]));

export function getBuilding(id) {
  const building = BY_ID.get(id);
  if (!building) throw new Error(`Unknown building id: ${id}`);
  return building;
}

export function isBuilding(id) {
  return BY_ID.has(id);
}

/** Buildings that never open a window — they live in the system tray. */
export const TRAY_BUILDINGS = BUILDINGS.filter((b) => b.category === 'tray').map((b) => b.id);

/**
 * The bulk-buy steps offered in the UI (patch §2.2).
 *
 * Deliberately stepped rather than a free-text quantity: at 1.15 growth the
 * maths already makes a runaway purchase impossible, so this is purely
 * accident-prevention — nobody should be able to empty their wallet with one
 * mistimed tap on a phone.
 */
export const BUY_STEPS = [1, 10, 100, 'max'];
