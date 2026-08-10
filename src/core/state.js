import { ALL_APPS } from '../data/apps.js';
import { LEMONWIRE, SWEEPER } from '../data/balance.js';
import { BUILDINGS } from '../data/buildings.js';
import { DEFAULT_COSMETICS } from '../data/cosmetics.js';
import { carryDiscsThroughPrestige } from './aeroburn.js';

/**
 * Bump SAVE_VERSION whenever the shape below changes in a way that old saves
 * cannot satisfy, and add a migration in src/core/save.js.
 */
export const SAVE_VERSION = 4;

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

  /**
   * One entry per building (GDD v2 §1), and nothing in it but the unit count —
   * there is no `upgrades` field because there are no manual upgrades to buy.
   * The milestone multiplier, the mini-game gate and the unlock are all derived
   * from `units` and `runBuzz`, so they cannot desync from what they describe.
   */
  const buildings = {};
  for (const building of BUILDINGS) buildings[building.id] = { units: 0 };

  return {
    version: SAVE_VERSION,
    username: null, // set on boot from CrazyGames or randomly if guest

    // Currencies (GDD 4)
    buzz: 0,
    lifetimeBuzz: 0, // never reset; drives Format C: payout
    /**
     * ...and this one is never reset *or* settled. `lifetimeBuzz` is a ledger
     * the Mainboard re-prices and Format C: pays against; Legacy Level needs a
     * monument instead, so it gets its own accumulator (GDD §2.6).
     */
    allTimeBuzz: 0,
    runBuzz: 0, // reset on prestige; drives unlocks within a run
    dollars: 0,
    dollarsEarnedTotal: 0, // never reset; prestige pays out the difference
    // ...and never reset either: what has been *spent* on hardware and
    // utilities, which is what the pricier cosmetics unlock against. Earnings
    // are not a good proxy for it — a hoarder is not a customer.
    dollarsSpentTotal: 0,

    // Progression
    hardware: { cpu: 0, ram: 0, gpu: 0, hdd: 0, mobo: 0 },
    prestigeCount: 0,

    /**
     * Legacy Level (GDD §2.6). Derived from `allTimeBuzz` on every read — this
     * is stored only so the Format C: sequence can show what changed. If the
     * two ever disagree, `allTimeBuzz` is right (core/legacy.js).
     */
    legacy: { level: 0 },

    // Software
    apps,
    buildings,
    chat: {
      // Rotating status-message event: { index, bonusId, secondsLeft } or null.
      // Both counters are in simulation seconds, not wall-clock time. The buddy
      // *count* is not here any more — AeroChat is building #1, and its units
      // live in `buildings.aerochat` with the other eleven.
      event: null,
      nextEventIn: 0, // rolled on the first tick with AeroChat open
    },

    /**
     * Achievements (GDD §8.2). First-party: an id -> unlock timestamp map, so a
     * newly added achievement simply is not in it yet and needs no migration.
     */
    achievements: { unlocked: {} },

    /**
     * The Buffer Overflow crisis system (GDD §7). Named `event` to match the
     * documented save schema. `airplaneModeOwned` is the Dollar-priced opt-out,
     * so it survives Format C: the way every other Dollar purchase does.
     */
    event: {
      feedRatioHistory: [],
      overflowPhase: 0,
      ghostNotifications: [],
      airplaneModeOwned: false,
    },

    /**
     * What has already been reported to the portal, so `reportGameCompletedPercentage`
     * is called on change rather than on every tick (GDD §8.3).
     */
    crazyGames: { lastReportedCompletion: 0 },

    // LemonWire seeds instead of downloading: a file in a slot pays Buzz for as
    // long as it is shared. `maxSeedSlots` is the *base* count — the effective
    // number is that plus what the HDD tier adds (econ.seedSlots).
    lemonwire: {
      activeSeeds: [], // [{ id, fileId, startedAt, uploadedMB }]
      maxSeedSlots: LEMONWIRE.baseSeedSlots,
      connection: 0, // index into LEMONWIRE.connections; the bandwidth multiplier
      trash: [], // [{ fileId, secondsLeft }] — stopped, but still on the disk
      nextId: 1,
    },

    // AeroBurn (AO-29). Discs survive Format C: — see resetForPrestige.
    aeroburn: {
      discs: [], // [{ typeId, spent }]
      burning: null, // { typeId, secondsLeft, total, spent }
      burned: 0,
    },

    /**
     * Two slices, because they are two different things:
     *
     * `security` is the *machine's* condition — infected or not, the run's free
     * rescue, a scan in progress. It exists whether or not Shield99 is even
     * installed, which is precisely when it matters most.
     */
    security: {
      infection: null, // null or { at }
      rescuesUsed: 0, // the free trial rescue, one per run
      scan: null,
    },

    /** ...and `shield99` is the app's own data: its catch, and its ad pacing. */
    shield99: {
      quarantine: [], // [{ id, threatId, at }] — sealed, waiting to be opened
      nextThreatIn: 0, // simulation seconds; rolled on the first tick while seeding
      adCooldownUntil: 0, // wall clock — it should burn down while the tab is shut
      filesCleaned: 0,
      nextId: 1,
    },

    /**
     * AeroSweeper (Day 7). Only the pacing is persisted: tokens and the clock
     * that refills them. The board is not state — it lasts a minute and means
     * nothing once it is banked — and the combo a round pays out is an ordinary
     * click buff, so it lives in `buffs` with everything else timed.
     */
    sweeper: {
      tokens: SWEEPER.maxTokens,
      nextTokenAt: 0, // wall clock; 0 means "full, nothing pending"
      bestTiles: 0,
      rounds: 0,
      sweeps: 0, // boards cleared outright
    },

    retroamp: {
      playlist: null, // id of the loaded playlist, or null
      endsAt: 0, // wall clock; only used by timed playlists
      cooldownUntil: {}, // playlist id -> timestamp it can be loaded again
      startedAt: 0,
    },

    /**
     * Ad bookkeeping (GDD 8). Only pacing lives here — what an offer is worth
     * is derived in `core/ads.js` from the player's current production, so
     * rebalancing a reward never needs a migration.
     *
     * `day` is the UTC day the `watched` counters belong to; a save loaded on a
     * later day reads as "nothing watched yet" without anything having to run
     * while the tab was closed. `lastAt` is deliberately *not* cleared by the
     * rollover — a cooldown is a wall-clock timer, not a daily allowance.
     */
    ads: {
      day: 0,
      watched: {}, // placement id -> watches today
      lastAt: {}, // placement id -> wall clock of the last completed watch
      totalWatched: 0,
      // A rewarded payout bought before a Format C:, spent by the next one.
      formatBoost: false,
    },

    /**
     * The Nudge streak (see CLICK.streak). Persisted so it is not silently
     * reset by an autosave reload mid-session, but it expires on the wall clock
     * like every other real-time timer — a save reloaded tomorrow reads as a
     * streak of zero without anything having to run while the tab was closed.
     */
    click: { count: 0, lastAt: 0 },

    // Timed bonuses from status events and rewarded ads. Playlist multipliers
    // are NOT buffs: they are derived from `retroamp` so they survive a reload.
    buffs: [],

    // Pressure loop (GDD 7)
    bloat: 0,

    /**
     * Auto-Defrag. A Dollar-priced utility, so it outlives the wipe like
     * hardware does — `active` does not, because a pass is a thing happening on
     * a machine that is about to be formatted. `startedFrom` is only the
     * denominator of the progress bar; see core/defrag.js.
     */
    defrag: { owned: false, active: false, startedFrom: 0, passes: 0 },

    /**
     * Personalisation. One id per kind and nothing else: which cosmetics are
     * *unlocked* is derived from lifetime counters every time it is asked
     * (core/cosmetics.js), so there is no unlock list to migrate. `seen` exists
     * only so a newly available cosmetic can be announced exactly once.
     */
    cosmetics: { ...DEFAULT_COSMETICS, seen: [] },

    // Session bookkeeping
    stats: {
      nudges: 0,
      playtimeSeconds: 0,
      bonusesClaimed: 0,
      bonusesMissed: 0,
      threatsBlocked: 0,
    },
    lastSeen: now,
    startedAt: now,

    // `motion` is three-state on purpose. 'auto' follows the OS, which is the
    // correct default — but an OS-level "turn off animations" is a machine-wide
    // setting a lot of people set once and forget, and it silently reduces this
    // game to a spreadsheet. 'full' lets them opt back in without touching
    // Windows; 'reduced' lets them opt out without touching Windows either.
    settings: { sfx: true, bgm: true, motion: 'auto' },

    // Scripted onboarding (GDD 7). `hardwareRevealed` gates My Computer and the
    // CPU/RAM readouts until the player hits their first memory bottleneck.
    // `goalsDismissed` is the far end of the same thread: the player has
    // acknowledged the hand-off card at the end of the goal chain
    // (`core/goals.js`) and the coach stops taking up room. Default false, so a
    // save from before this existed simply sees the card once.
    tutorial: { step: 0, done: false, hardwareRevealed: false, goalsDismissed: false },

    // Aero Studio (Day 7). Mega-project render center.
    aerostudio: {
      isRendering: false,
      currentProject: null,
      progress: 0,
      pendingReward: null, // { projectName, payout } | null
      upgrades: {
        sidechainCompression: 0,
        arpeggiator: 0,
        environmentalFx: 0,
      },
    },
  };
}

/**
 * Reset for "Format C:" — software is wiped, hardware and Dollars persist.
 * Pure: returns a new state, never mutates the argument.
 *
 * `bonusDollars` is paid into the wallet *without* being counted against
 * lifetime earnings, which is what makes the rewarded "+50% payout" a bonus
 * rather than an advance: `pendingPrestigeDollars` is the gap between what
 * lifetime Buzz has ever been worth and what has already been paid, so folding
 * the bonus into `dollarsEarnedTotal` would quietly borrow it back from the
 * next Format C:.
 */
export function resetForPrestige(state, dollarsEarned, now = Date.now(), { bonusDollars = 0 } = {}) {
  const fresh = createInitialState(now);
  // Burned discs outlive the wipe — that is the entire point of AeroBurn.
  carryDiscsThroughPrestige(state, fresh);

  /**
   * ...and so does the burner itself, which is the one exception to "all
   * software is wiped". A CD drive is part of the machine, and without it the
   * discs would be unreachable until the player re-earned its install cost —
   * precisely when the "starting boost for the next run" (GDD 6) is meant to
   * be doing its job.
   */
  fresh.apps.aeroburn.installed = state.apps.aeroburn.installed;

  return {
    ...fresh,
    dollars: state.dollars + dollarsEarned + bonusDollars,
    dollarsEarnedTotal: state.dollarsEarnedTotal + dollarsEarned,
    dollarsSpentTotal: state.dollarsSpentTotal,
    username: state.username,
    /**
     * Both of these are bought with Dollars, so both survive the wipe for the
     * same reason hardware does: they were paid for out of the meta-currency,
     * not out of the run. Auto-Defrag drops its live pass on the way through —
     * there is no disk left to defragment.
     */
    defrag: { ...state.defrag, active: false, startedFrom: 0 },
    cosmetics: { ...state.cosmetics },
    /**
     * Daily ad allowances survive the wipe. They are a real-world budget, not
     * a run's progress — and a cap a player can clear by pressing Format C:
     * is not a cap. The pending payout boost is the exception: this reset is
     * what spends it.
     */
    ads: { ...state.ads, formatBoost: false },
    lifetimeBuzz: state.lifetimeBuzz,
    /**
     * The Legacy layer is the one thing a wipe may never touch (GDD §2.6) —
     * that is what makes it a legacy rather than a run bonus. The level itself
     * is re-derived by `applyLegacyLevel` right after this returns, so what
     * carries through is the accumulator; the stored level just follows it.
     */
    allTimeBuzz: state.allTimeBuzz ?? 0,
    legacy: { ...state.legacy },
    achievements: { ...state.achievements, unlocked: { ...state.achievements?.unlocked } },
    crazyGames: { ...state.crazyGames },
    /**
     * Airplane Mode (GDD §7.3) is bought with Dollars, so it outlives the wipe
     * for the same reason Auto-Defrag does. Everything else about the crisis
     * system is *this run's* pressure and starts again from nothing.
     */
    event: { ...fresh.event, airplaneModeOwned: state.event?.airplaneModeOwned === true },
    prestigeCount: state.prestigeCount + 1,
    hardware: { ...state.hardware },
    aeroburn: fresh.aeroburn,
    stats: { ...state.stats },
    settings: { ...state.settings },
    tutorial: { ...state.tutorial, done: true },
    startedAt: state.startedAt,
  };
}
