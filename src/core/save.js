import { LEMONWIRE, SAVE } from '../data/balance.js';
import { hasApp } from '../data/apps.js';
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
};

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
