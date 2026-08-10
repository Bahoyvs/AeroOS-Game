import { LEMONWIRE, SAVE } from '../data/balance.js';
import { hasApp } from '../data/apps.js';
import { BUILDINGS, hasBuilding } from '../data/buildings.js';
import { hasFile } from '../data/files.js';
import { SAVE_VERSION, createInitialState } from './state.js';

/**
 * Persistence. Every function takes an explicit storage object (anything with
 * getItem/setItem/removeItem) so saves can be unit-tested without a browser
 * and so a future cloud-save backend can drop in unchanged.
 */

/** In-memory stand-in used by tests and by browsers with storage disabled. */
export function createMemoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
}

/**
 * CrazyGames refuses a stored value over 1 MB. A refused write is a silently
 * lost save, so we check the payload ourselves and keep the last good one.
 */
export const MAX_SAVE_BYTES = 1_000_000;

const byteLength = (raw) =>
  typeof TextEncoder === 'function' ? new TextEncoder().encode(raw).length : raw.length;

/**
 * A storage backend is only trustworthy if a write round-trips. Private mode,
 * a blocked third-party iframe and an uninitialised portal SDK all throw here,
 * which is where we want to find out — not at the first autosave.
 */
function probeStorage(storage) {
  if (!storage) return null;
  try {
    const probe = '__aeroos_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

/**
 * Portal storage, then localStorage, then memory.
 *
 * `CrazyGames.SDK.data` is a localStorage-shaped API backed by the player's
 * portal account, so it drops straight into this seam — but it only exists once
 * `SDK.init()` has resolved, which `main.js` awaits before creating the game.
 * Anywhere else (local dev, itch, a plain static host) the chain falls through
 * to localStorage, so development is never blocked on the portal.
 */
export function defaultStorage() {
  const portal = probeStorage(globalThis.CrazyGames?.SDK?.data);
  if (portal) return portal;

  const local = probeStorage(globalThis.localStorage);
  if (local) return local;

  console.warn('[save] no persistent storage available; progress will not persist');
  return createMemoryStorage();
}

/**
 * Fill in anything a save predates. Recursive so newly added nested keys (a new
 * app, a new settings flag) appear with their default instead of undefined.
 */
const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function withDefaults(loaded, defaults) {
  if (loaded === undefined) return defaults;
  // Only merge when both sides are objects. A field whose default is `null` or
  // a primitive (chat.event, say) is taken from the save verbatim — merging
  // into a non-object would throw and cost the player their progress.
  if (!isPlainObject(loaded) || !isPlainObject(defaults)) return loaded;

  const out = { ...defaults };
  for (const [key, value] of Object.entries(loaded)) {
    out[key] = key in defaults ? withDefaults(value, defaults[key]) : value;
  }
  return out;
}

/**
 * Version migrations. Each entry upgrades a save from version N to N+1 and is
 * applied in order, so a very old save walks the whole chain.
 */
const MIGRATIONS = {
  // 1 -> 2: settings.reducedMotion (boolean) became settings.motion, a
  // three-state preference, so the player can also force motion back *on* when
  // it is the OS suppressing it.
  1: (data) => {
    const { reducedMotion, ...settings } = data.settings ?? {};
    return {
      ...data,
      settings: { ...settings, motion: reducedMotion === true ? 'reduced' : 'auto' },
      version: 2,
    };
  },

  // 2 -> 3: LemonWire stopped being a download manager. `queue` (in-flight
  // transfers) and `library` (finished files sitting on the disk) both became
  // `activeSeeds` — a file the player owned is a file they can share, so the
  // fair reading of an old save is "everything you had is now seeding", capped
  // at the slots the machine actually has. The Recycle Bin carries over
  // untouched; it means the same thing it always did.
  2: (data) => {
    const old = data.lemonwire ?? {};
    const owned = [
      ...(old.library ?? []),
      ...(old.queue ?? []).map((job) => job?.fileId),
    ].filter((id) => typeof id === 'string' && hasFile(id));

    const slots = LEMONWIRE.baseSeedSlots + Math.floor((data.hardware?.hdd ?? 0) / LEMONWIRE.hddTiersPerSlot);
    const seeded = [...new Set(owned)].slice(0, Math.min(slots, LEMONWIRE.maxSeedSlots));
    const now = data.lastSeen ?? Date.now();

    return {
      ...data,
      lemonwire: {
        activeSeeds: seeded.map((fileId, index) => ({
          id: index + 1,
          fileId,
          startedAt: now,
          uploadedMB: 0,
        })),
        maxSeedSlots: LEMONWIRE.baseSeedSlots,
        connection: 0,
        trash: (old.trash ?? []).filter((item) => hasFile(item?.fileId)),
        nextId: seeded.length + 1,
      },
      version: 3,
    };
  },

  /**
   * 3 -> 4: the Master Redesign (GDD v2). One migration, not the four the
   * intermediate design drafts described — none of those ever shipped, so there
   * is no save in the wild that needs the chain.
   *
   * Three things happen here:
   *
   * 1. AeroChat stops being a special case. `chat.bots` becomes
   *    `buildings.aerochat.units`, and eleven siblings appear alongside it.
   * 2. `allTimeBuzz` is seeded from `lifetimeBuzz`. A player who has already
   *    earned ten million Buzz starts the Legacy layer where their history says
   *    they should, not at zero — the two counters only diverge from here on,
   *    when Format C: settles one and not the other.
   * 3. Shield99, AeroBurn and Aero Studio are retired, and what was spent on
   *    them is refunded (GDD §11).
   *
   * On the refund: the GDD's draft reads `app.units ?? app.bots`, but none of
   * these three ever had a unit count — they were one-off installs with their
   * own sub-economies, so that expression is 0 for every save in existence and
   * the "your investment was refunded" screen would show a zero. What players
   * actually spent is refunded instead: the install price of each one they
   * bought, Aero Studio's per-upgrade spend, and the Buzz still sitting on
   * AeroBurn discs they never played. Erring generous is deliberate — this is
   * compensation for progress being taken away, and the alternative to a
   * slightly large number is a player who feels robbed.
   */
  3: (data) => {
    const { shield99, aeroburn, aerostudio, ...rest } = data;

    let refund = 0;
    for (const [id, cost] of Object.entries(RETIRED_INSTALL_COSTS)) {
      if (data.apps?.[id]?.installed) refund += cost;
    }
    for (const [id, tier] of Object.entries(aerostudio?.upgrades ?? {})) {
      refund += aerostudioUpgradeSpend(id, tier);
    }
    // Discs are a store of Buzz the player put in and has not taken out; the
    // one in the drive counts too, because it is Buzz already spent.
    for (const disc of aeroburn?.discs ?? []) refund += disc?.spent ?? 0;
    refund += aeroburn?.burning?.spent ?? 0;

    const buildings = {};
    for (const building of BUILDINGS) {
      buildings[building.id] = {
        units: building.id === 'aerochat' ? Math.max(0, Math.floor(data.chat?.bots ?? 0)) : 0,
      };
    }

    const { bots, ...chat } = data.chat ?? {};

    return {
      ...rest,
      buzz: (data.buzz ?? 0) + refund,
      // Read once by the diegetic "System Updating…" screen (GDD §11), then
      // cleared — it is a message, not a balance.
      sunsetRefund: refund,
      allTimeBuzz: data.lifetimeBuzz ?? 0,
      legacy: { level: 0 },
      buildings,
      chat,
      achievements: { unlocked: {} },
      event: {
        feedRatioHistory: [],
        overflowPhase: 0,
        ghostNotifications: [],
        airplaneModeOwned: false,
      },
      crazyGames: { lastReportedCompletion: 0 },
      version: 4,
    };
  },
};

/**
 * What the three retired apps cost to install, frozen at the moment they were
 * retired (they were 3,000 / 12,000 / 12,000 Buzz in `data/apps.js`).
 *
 * These have to be literals, and the reason is worth stating plainly because it
 * bit once already: the obvious spelling is `getApp(id).install.cost`, and the
 * moment Phase 1 takes these three off the roster that lookup starts throwing —
 * or, guarded with `hasApp`, quietly returns zero. A refund that silently pays
 * nothing is the exact failure the GDD's own draft formula had, and it would
 * have been reintroduced here by the removal that this refund exists to
 * compensate for.
 */
const RETIRED_INSTALL_COSTS = {
  shield99: 3_000,
  aeroburn: 12_000,
  aerostudio: 12_000,
};

/**
 * Aero Studio's upgrade prices, frozen for the same reason.
 *
 * A copy, not an import, and it must stay one: the migration has to price what
 * a player *actually paid* years from now, and the module these came from no
 * longer exists to be read. A live constant would also be a live liability —
 * retuning a table for a shop nobody can open would silently change what old
 * saves are refunded.
 */
const RETIRED_AEROSTUDIO_UPGRADES = {
  sidechainCompression: { baseCost: 75_000, costGrowth: 1.5 },
  arpeggiator: { baseCost: 250_000, costGrowth: 1.8 },
  environmentalFx: { baseCost: 1_000_000, costGrowth: 2.2 },
};

/**
 * What a player put into one Aero Studio upgrade track to reach `tier`, priced
 * off the same curve the shop charged from (`ceil(base × growth^owned)`).
 */
function aerostudioUpgradeSpend(id, tier) {
  const upgrade = RETIRED_AEROSTUDIO_UPGRADES[id];
  const owned = Math.max(0, Math.floor(tier ?? 0));
  if (!upgrade || owned === 0) return 0;
  let total = 0;
  for (let i = 0; i < owned; i += 1) {
    total += Math.ceil(upgrade.baseCost * upgrade.costGrowth ** i);
  }
  return total;
}

export function migrate(data) {
  let current = data;
  while (current.version < SAVE_VERSION) {
    const step = MIGRATIONS[current.version];
    if (!step) {
      // No path forward: stamp the current version and let withDefaults patch
      // the gaps rather than throwing away the player's progress.
      current = { ...current, version: SAVE_VERSION };
      break;
    }
    current = step(current);
  }
  return current;
}

export function serialize(state) {
  return JSON.stringify({ ...state, lastSeen: Date.now() });
}

export function deserialize(raw, now = Date.now()) {
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('[save] corrupt save data; starting a fresh desktop');
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const state = withDefaults(migrate(parsed), createInitialState(now));

  /**
   * Drop apps the roster no longer has. `withDefaults` keeps unknown keys on
   * purpose — that is what makes a save forward-compatible — but `state.apps`
   * is the one place where an unknown key is a live grenade: `ramUsed()` walks
   * it and calls `getApp(id)`, which throws for an id nobody declares any more.
   * A retired app must cost the player a stale entry, not their save.
   */
  for (const id of Object.keys(state.apps)) {
    if (!hasApp(id)) delete state.apps[id];
  }

  /**
   * The same tidy-up for the building roster. Nothing walks `state.buildings`
   * by key today — production iterates the roster — so a stale entry is inert
   * rather than fatal. It is still dead weight in a save with a 1 MB ceiling,
   * and the first piece of code that does iterate the map would inherit the
   * `state.apps` bug rather than find it already fixed.
   */
  for (const id of Object.keys(state.buildings ?? {})) {
    if (!hasBuilding(id)) delete state.buildings[id];
  }

  // Windows never survive a reload as "open with no window on screen".
  for (const app of Object.values(state.apps)) app.minimized = false;
  return state;
}

export function saveGame(state, storage = defaultStorage()) {
  try {
    const remoteRaw = storage.getItem(SAVE.key);
    if (remoteRaw) {
      try {
        const remoteParsed = JSON.parse(remoteRaw);
        if (remoteParsed && remoteParsed.lastSeen && state.lastSeen && remoteParsed.lastSeen > state.lastSeen) {
          console.warn('[save] remote save is newer than local state; skipping write to avoid clobbering');
          return false;
        }
      } catch (e) {
        // ignore parse errors of remote data here, let overwrite proceed
      }
    }

    const raw = serialize(state);
    const bytes = byteLength(raw);
    if (bytes > MAX_SAVE_BYTES) {
      // Refusing the write leaves the previous save intact, which is strictly
      // better than a half-written or rejected one. A save this large is a bug
      // (something unbounded is being persisted), not a player problem.
      console.warn(
        `[save] payload is ${bytes} bytes, over the ${MAX_SAVE_BYTES}-byte limit; write skipped`,
      );
      return false;
    }
    storage.setItem(SAVE.key, raw);
    return true;
  } catch (err) {
    console.error('[save] write failed', err);
    return false;
  }
}

/**
 * Returns the stored state plus how long the player was away, or null when
 * there is no save. Offline Buzz is applied by the caller (src/core/game.js)
 * so this module stays free of balance concerns.
 */
export function loadGame(storage = defaultStorage(), now = Date.now()) {
  const state = deserialize(storage.getItem(SAVE.key), now);
  if (!state) return null;
  const elapsedSeconds = Math.max(0, (now - (state.lastSeen ?? now)) / 1000);
  return { state, elapsedSeconds };
}

export function clearSave(storage = defaultStorage()) {
  storage.removeItem(SAVE.key);
}

export function hasSave(storage = defaultStorage()) {
  return storage.getItem(SAVE.key) !== null;
}
