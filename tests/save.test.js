import { describe, expect, it } from 'vitest';
import {
  clearSave,
  createMemoryStorage,
  deserialize,
  hasSave,
  loadGame,
  saveGame,
  serialize,
} from '../src/core/save.js';
import { SAVE_VERSION, createInitialState } from '../src/core/state.js';
import { SAVE } from '../src/data/balance.js';

describe('save round-trip', () => {
  it('restores currencies, hardware and bots', () => {
    const storage = createMemoryStorage();
    const state = createInitialState(0);
    state.buzz = 1234.5;
    state.lifetimeBuzz = 90_000;
    state.dollars = 7.25;
    state.hardware.ram = 2;
    state.chat.bots = 17;

    expect(saveGame(state, storage)).toBe(true);
    const { state: loaded } = loadGame(storage, 0);

    expect(loaded.buzz).toBeCloseTo(1234.5);
    expect(loaded.lifetimeBuzz).toBe(90_000);
    expect(loaded.dollars).toBeCloseTo(7.25);
    expect(loaded.hardware.ram).toBe(2);
    expect(loaded.chat.bots).toBe(17);
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
    expect(loaded.apps.aerostudio.installed).toBe(false);
    expect(loaded.chat.bots).toBe(0);
    expect(loaded.settings.sfx).toBe(true);
    expect(loaded.hardware).toEqual({ cpu: 0, ram: 0, gpu: 0, hdd: 0 });
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
