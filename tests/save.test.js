import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_SAVE_BYTES,
  clearSave,
  createMemoryStorage,
  defaultStorage,
  deserialize,
  hasSave,
  loadGame,
  saveGame,
  serialize,
} from '../src/core/save.js';
import { SAVE_VERSION, createInitialState } from '../src/core/state.js';
import { LEMONWIRE, SAVE, SWEEPER } from '../src/data/balance.js';

describe('save round-trip', () => {
  it('restores currencies, hardware and bots', () => {
    const storage = createMemoryStorage();
    const state = createInitialState(0);
    state.buzz = 1234.5;
    state.lifetimeBuzz = 90_000;
    state.dollars = 7.25;
    state.hardware.ram = 2;
    state.buildings.aerochat.units = 17;

    expect(saveGame(state, storage)).toBe(true);
    const { state: loaded } = loadGame(storage, 0);

    expect(loaded.buzz).toBeCloseTo(1234.5);
    expect(loaded.lifetimeBuzz).toBe(90_000);
    expect(loaded.dollars).toBeCloseTo(7.25);
    expect(loaded.hardware.ram).toBe(2);
    expect(loaded.buildings.aerochat.units).toBe(17);
  });

  it('returns null when there is nothing stored', () => {
    expect(loadGame(createMemoryStorage(), 0)).toBeNull();
  });

  it('reports elapsed time since the save was written', () => {
    const storage = createMemoryStorage();
    const state = createInitialState(0);
    saveGame(state, storage);

    const written = JSON.parse(storage.getItem(SAVE.key)).lastSeen;
    const { elapsedSeconds } = loadGame(storage, written + 90_000);
    expect(elapsedSeconds).toBeCloseTo(90, 1);
  });

  it('never reports negative elapsed time when the clock moves backwards', () => {
    const storage = createMemoryStorage();
    saveGame(createInitialState(0), storage);
    const written = JSON.parse(storage.getItem(SAVE.key)).lastSeen;
    expect(loadGame(storage, written - 60_000).elapsedSeconds).toBe(0);
  });
});

describe('resilience', () => {
  it('survives corrupt JSON by starting fresh', () => {
    expect(deserialize('{not json', 0)).toBeNull();
  });

  it('survives a non-object payload', () => {
    expect(deserialize('42', 0)).toBeNull();
  });

  it('backfills keys added after the save was written', () => {
    // A save from before Aero Studio existed.
    const legacy = JSON.stringify({
      version: SAVE_VERSION,
      buzz: 10,
      apps: { aerochat: { installed: true, open: true } },
    });
    const loaded = deserialize(legacy, 0);

    expect(loaded.buzz).toBe(10);
    expect(loaded.apps.lemonwire.installed).toBe(false);
    expect(loaded.buildings.aerochat.units).toBe(0);
    expect(loaded.settings.sfx).toBe(true);
    // Including tracks and whole slices added since — a new hardware track and
    // a new utility must cost the player nothing but a default.
    expect(loaded.hardware).toEqual({ cpu: 0, ram: 0, gpu: 0, hdd: 0, mobo: 0 });
    expect(loaded.defrag).toEqual({ owned: false, active: false, startedFrom: 0, passes: 0 });
    expect(loaded.cosmetics.tint).toBe('aqua');
    expect(loaded.dollarsSpentTotal).toBe(0);
  });

  it('carries a v1 reducedMotion flag over to the three-state motion setting', () => {
    const optedOut = deserialize(
      JSON.stringify({ version: 1, buzz: 5, settings: { sfx: false, reducedMotion: true } }),
      0,
    );
    expect(optedOut.settings.motion).toBe('reduced');
    expect(optedOut.settings.reducedMotion).toBeUndefined();
    // Unrelated settings survive the rewrite.
    expect(optedOut.settings.sfx).toBe(false);
    expect(optedOut.buzz).toBe(5);

    const neverTouchedIt = deserialize(
      JSON.stringify({ version: 1, settings: { reducedMotion: false } }),
      0,
    );
    // 'auto', not 'full': a save that never opted out should still follow the OS.
    expect(neverTouchedIt.settings.motion).toBe('auto');
  });

  it('turns a v2 download library into seed slots', () => {
    // LemonWire stopped being a download manager: a file the player owned is a
    // file they can share, so an old save arrives already seeding.
    const loaded = deserialize(
      JSON.stringify({
        version: 2,
        hardware: { cpu: 0, ram: 0, gpu: 0, hdd: 0 },
        lemonwire: {
          library: ['wallpapers', 'anime'],
          queue: [{ id: 1, fileId: 'battlefront', downloadedGB: 2 }],
          trash: [{ fileId: 'skins', secondsLeft: 120 }],
          nextId: 2,
          completed: 4,
        },
      }),
      0,
    );

    expect(loaded.lemonwire.activeSeeds.map((seed) => seed.fileId)).toEqual([
      'wallpapers',
      'anime',
      'battlefront',
    ]);
    expect(loaded.lemonwire.activeSeeds.every((seed) => seed.uploadedMB === 0)).toBe(true);
    expect(loaded.lemonwire.connection).toBe(0);
    // The bin means what it always meant, so it carries over untouched.
    expect(loaded.lemonwire.trash).toEqual([{ fileId: 'skins', secondsLeft: 120 }]);
    expect(loaded.lemonwire.library).toBeUndefined();
    expect(loaded.lemonwire.queue).toBeUndefined();
  });

  it('never migrates a v2 save into more slots than the machine has', () => {
    const loaded = deserialize(
      JSON.stringify({
        version: 2,
        hardware: { cpu: 0, ram: 0, gpu: 0, hdd: 0 },
        lemonwire: {
          library: ['wallpapers', 'anime', 'skins', 'cam-movie', 'battlefront', 'gone-file'],
          queue: [],
          trash: [],
        },
      }),
      0,
    );

    expect(loaded.lemonwire.activeSeeds).toHaveLength(LEMONWIRE.baseSeedSlots);
    // A file the list no longer has cannot be seeded, and must not crash a load.
    expect(loaded.lemonwire.activeSeeds.map((seed) => seed.fileId)).not.toContain('gone-file');
  });

  /**
   * AeroSweeper was added without a version bump, which is only safe because
   * `withDefaults` backfills a missing slice. A save written before Day 7 must
   * come back with a full set of tokens rather than `undefined` — the app reads
   * `tokens` on its first frame.
   */
  it('hands a save written before Day 7 a working sweeper', () => {
    const loaded = deserialize(JSON.stringify({ version: SAVE_VERSION, buzz: 10 }), 0);
    expect(loaded.sweeper).toEqual({
      tokens: SWEEPER.maxTokens,
      nextTokenAt: 0,
      bestTiles: 0,
      rounds: 0,
      sweeps: 0,
    });
  });

  /**
   * A retired app is the one unknown key that cannot simply be carried: every
   * RAM calculation walks `state.apps` and looks each id up in the roster.
   */
  it('drops an app the roster no longer has, and keeps the rest of the save', () => {
    const loaded = deserialize(
      JSON.stringify({
        version: SAVE_VERSION,
        buzz: 4200,
        apps: {
          aerochat: { installed: true, open: true, minimized: false },
          pinball: { installed: true, open: true, minimized: false },
        },
      }),
      0,
    );

    expect(loaded.apps.pinball).toBeUndefined();
    expect(loaded.apps.aerochat.installed).toBe(true);
    expect(loaded.buzz).toBe(4200);
  });

  it('stamps unknown future-less versions rather than dropping progress', () => {
    const loaded = deserialize(JSON.stringify({ version: 0, buzz: 500 }), 0);
    expect(loaded.version).toBe(SAVE_VERSION);
    expect(loaded.buzz).toBe(500);
  });

  it('clears minimized flags so no window is restored off-screen', () => {
    const raw = serialize({
      ...createInitialState(0),
      apps: { aerochat: { installed: true, open: true, minimized: true } },
    });
    expect(deserialize(raw, 0).apps.aerochat.minimized).toBe(false);
  });

  it('loads a save whose field has an object where the default is null', () => {
    // chat.event defaults to null; a save taken mid-event carries an object.
    const state = createInitialState(0);
    state.chat.event = { index: 3, bonusId: 'battlefront', secondsLeft: 9 };
    const loaded = deserialize(serialize(state), 0);

    expect(loaded.chat.event).toEqual({ index: 3, bonusId: 'battlefront', secondsLeft: 9 });
  });

  it('replaces arrays wholesale rather than merging them', () => {
    const state = createInitialState(0);
    state.buffs = [{ id: 'x', kind: 'chat', magnitude: 0.5, expiresAt: 1000, label: 'x' }];
    expect(deserialize(serialize(state), 0).buffs).toHaveLength(1);
  });

  it('reports a failed write instead of throwing', () => {
    const broken = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };
    expect(saveGame(createInitialState(0), broken)).toBe(false);
  });
});

describe('storage helpers', () => {
  it('tracks and clears the save slot', () => {
    const storage = createMemoryStorage();
    expect(hasSave(storage)).toBe(false);
    saveGame(createInitialState(0), storage);
    expect(hasSave(storage)).toBe(true);
    clearSave(storage);
    expect(hasSave(storage)).toBe(false);
  });
});

describe('portal storage limits', () => {
  it('refuses a payload over the 1 MB portal limit, keeping the last good save', () => {
    const storage = createMemoryStorage();
    const good = createInitialState(0);
    saveGame(good, storage);
    const before = storage.getItem(SAVE.key);

    const oversized = createInitialState(0);
    oversized.chat.note = 'x'.repeat(MAX_SAVE_BYTES);

    expect(saveGame(oversized, storage)).toBe(false);
    expect(storage.getItem(SAVE.key)).toBe(before);
  });

  it('accepts a payload just under the limit', () => {
    const storage = createMemoryStorage();
    const state = createInitialState(0);
    state.chat.note = 'x'.repeat(MAX_SAVE_BYTES - 8000);
    expect(saveGame(state, storage)).toBe(true);
  });
});

describe('storage backend selection', () => {
  afterEach(() => {
    delete globalThis.CrazyGames;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('prefers the CrazyGames data module when the SDK has initialised', () => {
    const portal = createMemoryStorage();
    globalThis.CrazyGames = { SDK: { data: portal } };

    saveGame(createInitialState(0), defaultStorage());
    expect(hasSave(portal)).toBe(true);
  });

  it('falls back to localStorage when the portal storage throws', () => {
    // An SDK that is on the page but not initialised: `data` exists and throws.
    globalThis.CrazyGames = {
      SDK: {
        data: {
          getItem: () => null,
          setItem: () => {
            throw new Error('SDK is not initialized');
          },
          removeItem: () => {},
        },
      },
    };
    const local = createMemoryStorage();
    vi.stubGlobal('localStorage', local);

    saveGame(createInitialState(0), defaultStorage());
    expect(hasSave(local)).toBe(true);
  });

  it('falls back to memory when nothing persists', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('localStorage', undefined);

    const storage = defaultStorage();
    expect(saveGame(createInitialState(0), storage)).toBe(true);
    expect(hasSave(storage)).toBe(true);
  });
});
