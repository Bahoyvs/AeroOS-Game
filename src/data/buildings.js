/**
 * The twelve buildings (GDD v2 §1).
 *
 * A building is an independent producer: units are bought with Buzz and pay Buzz,
 * priced by one shared curve (`BUILDING.costGrowth`) and boosted by one shared
 * milestone table (`BUILDING.milestones`). There is deliberately no per-building
 * differentiation in the *maths* — the differentiation is entirely in how each
 * window dresses the same two numbers up (GDD §3.1, the `w32-buy` rule).
 *
 * The two ladders are geometric and were chosen together:
 *
 *   baseCost       = 10  × 12^(n-1)
 *   baseProduction = 0.5 × 10^(n-1)
 *
 * so every building costs 12× the one before it and pays 10×. Cost outruns
 * production by 20% per rung, which is what stops a newly unlocked building
 * being an instant upgrade over everything already owned — you buy into it
 * because the milestone table is ahead of you, not because the first unit pays
 * for itself. They are written out rather than generated: these are the numbers
 * a designer tunes, and §14.1 has them down for simulation calibration.
 *
 * `unlockAt` is `runBuzz`, matching how app installs already gate
 * (`econ.isAppUnlocked`) — it resets with Format C:, so a new run re-walks the
 * roster instead of opening twelve windows on the first tick.
 *
 * `minigame` is the active mini-game the building opens at `BUILDING.minigameAt`
 * units (GDD §6). Seven buildings have no entry, and that is the design, not a
 * gap: phase 1 stays plain, and phase 4 stops offering the player games.
 *
 * `synergy` is flavour only (GDD §2.4): tooltip text, never a factor in any
 * formula. Nothing reads it except the UI.
 */

export const BUILDINGS = [
  {
    id: 'aerochat',
    name: 'AeroChat',
    phase: 1,
    reference: 'MSN Messenger 7.5',
    unit: 'buddy',
    units: 'buddies',
    unlockAt: 0,
    baseCost: 10,
    baseProduction: 0.5,
    blurb: 'Buddy list. They chat, chatter becomes Buzz.',
    synergy: 'Every conversation ends up forwarded somewhere.',
  },
  {
    id: 'retroamp',
    name: 'RetroAmp',
    phase: 1,
    reference: 'Winamp 2.x, classic skin',
    unit: 'track',
    units: 'tracks',
    unlockAt: 20,
    baseCost: 120,
    baseProduction: 5,
    blurb: 'It really whips the llama. Playlists multiply everything.',
    synergy: 'Half the buddy list is trading the same three MP3s.',
  },
  {
    id: 'chainmail',
    name: 'ChainMail',
    phase: 1,
    reference: 'Outlook Express / Hotmail',
    unit: 'contact',
    units: 'contacts',
    unlockAt: 150,
    baseCost: 1_440,
    baseProduction: 50,
    blurb: 'Forward to ten people or nothing good will happen.',
    synergy: 'Chain letters are what fill the boards.',
  },
  {
    id: 'aeroboards',
    name: 'AeroBoards',
    phase: 2,
    reference: 'vBulletin / phpBB in an IE6 frame',
    unit: 'member',
    units: 'members',
    unlockAt: 1_200,
    baseCost: 17_280,
    baseProduction: 500,
    blurb: 'Forums. 1,204 replies, none of them on topic.',
    minigame: {
      id: 'douse-the-flame-war',
      title: 'Douse the Flame War',
      blurb: 'Rein a runaway thread in with the right reply, before a mod locks it.',
    },
    synergy: 'Every thread ends in a link to something you should download.',
  },
  {
    id: 'lemonwire',
    name: 'LemonWire',
    phase: 2,
    reference: 'LimeWire 4',
    unit: 'peer',
    units: 'peers',
    unlockAt: 6_000,
    baseCost: 207_360,
    baseProduction: 5_000,
    blurb: 'Share files with the swarm. Some of them bite.',
    minigame: {
      id: 'bandwidth-tug',
      title: 'Bandwidth Tug-of-War',
      blurb: 'Balance the upload and download sliders against the swarm.',
    },
    synergy: 'Somebody has to host all those animated GIFs.',
  },
  {
    id: 'geopage',
    name: 'GeoPage',
    phase: 2,
    reference: 'Geocities / early MySpace editor',
    unit: 'page',
    units: 'pages',
    unlockAt: 25_000,
    baseCost: 2_488_320,
    baseProduction: 50_000,
    blurb: 'Under construction. Forever. With a MIDI.',
    synergy: 'A profile is a webcam away from being a broadcast.',
  },
  {
    id: 'vidchat',
    name: 'VidChat',
    phase: 3,
    reference: 'early Skype / Chatroulette',
    unit: 'stream',
    units: 'streams',
    unlockAt: 100_000,
    baseCost: 29_859_840,
    baseProduction: 500_000,
    blurb: 'Next partner. Next partner. Next partner.',
    minigame: {
      id: 'latency-sync',
      title: 'Latency Sync',
      blurb: 'Tap in time with a stream that keeps freezing.',
    },
    synergy: 'Watching strangers is one click from farming with them.',
  },
  {
    id: 'flashfarm',
    name: 'FlashFarm',
    phase: 3,
    reference: 'FarmVille-alike (satirical)',
    unit: 'plot',
    units: 'plots',
    unlockAt: 400_000,
    baseCost: 358_318_080,
    baseProduction: 5_000_000,
    blurb: 'Your crops are withering. Your friends can help. Ask them. Ask them.',
    minigame: {
      id: 'decline-gifts',
      title: 'Decline Gift Requests',
      blurb: 'Clear the un-closable balloons before they cover the screen.',
    },
    synergy: 'Somebody automated the gift requests. It was not a person.',
  },
  {
    id: 'botnet',
    name: 'BotNet',
    phase: 3,
    reference: 'mIRC / command line hybrid',
    unit: 'node',
    units: 'nodes',
    unlockAt: 1_500_000,
    baseCost: 4_299_816_960,
    baseProduction: 50_000_000,
    blurb: '> execute payload.exe',
    synergy: 'A network this large starts making its own decisions.',
  },
  {
    id: 'thealgorithm',
    name: 'The Algorithm',
    phase: 4,
    reference: 'corporate server rack',
    unit: 'core',
    units: 'cores',
    unlockAt: 6_000_000,
    baseCost: 51_597_803_520,
    baseProduction: 500_000_000,
    blurb: 'Allocate processing power. It knows what to do with it.',
    minigame: {
      id: 'tune-parameters',
      title: 'Tune the Parameters',
      blurb: 'Hold several sliders inside the target band at once.',
    },
    synergy: 'It has finished modelling the network. Now it models you.',
  },
  {
    id: 'mindsync',
    name: 'MindSync',
    phase: 4,
    reference: 'retro sci-fi',
    unit: 'frequency',
    units: 'frequencies',
    unlockAt: 25_000_000,
    baseCost: 619_173_642_240,
    baseProduction: 5_000_000_000,
    blurb: 'Tune the frequency. Hold still.',
    synergy: 'Every mind on the same waveform is one mind.',
  },
  {
    id: 'thehive',
    name: 'The Hive',
    phase: 4,
    reference: 'chrome-less desktop anchor',
    unit: 'offering',
    units: 'offerings',
    unlockAt: 100_000_000,
    baseCost: 7_430_083_706_880,
    baseProduction: 50_000_000_000,
    blurb: 'Feed.',
    synergy: null,
  },
];

export const BUILDING_IDS = BUILDINGS.map((b) => b.id);

const BY_ID = new Map(BUILDINGS.map((b) => [b.id, b]));

export function getBuilding(id) {
  const building = BY_ID.get(id);
  if (!building) throw new Error(`Unknown building id: ${id}`);
  return building;
}

/** Is this id still on the roster? Old saves may name a building we retired. */
export function hasBuilding(id) {
  return BY_ID.has(id);
}

/**
 * The two halves of GDD §7.1's `feedRatio`: how far into the addiction layer the
 * player has invested, against how much of the innocent early game they kept.
 * Declared here rather than in the event module so the split is a property of
 * the roster.
 *
 * Listed by hand, not derived from `phase`. VidChat is a phase-3 building the
 * GDD deliberately leaves *out* of the numerator — the feed is the automated
 * layer (farm, bots, algorithm, sync, hive), and a stranger on a webcam is
 * still a person. Deriving this from `phase >= 3` would quietly recruit it.
 */
export const FEED_BUILDING_IDS = ['flashfarm', 'botnet', 'thealgorithm', 'mindsync', 'thehive'];
export const ANCHOR_BUILDING_IDS = ['aerochat', 'retroamp', 'chainmail'];
