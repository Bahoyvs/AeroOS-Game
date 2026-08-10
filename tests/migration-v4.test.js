import { describe, expect, it } from 'vitest';
import { createMemoryStorage, deserialize, migrate, serialize } from '../src/core/save.js';
import { SAVE_VERSION, createInitialState } from '../src/core/state.js';
import { AEROSTUDIO, SAVE } from '../src/data/balance.js';
import { BUILDINGS } from '../src/data/buildings.js';
import { getApp } from '../src/data/apps.js';

/**
 * The 3 -> 4 migration (GDD v2 §10-11). This one runs against real players'
 * saves, so it gets its own file: the game is live, and a mistake here is
 * somebody's evening of progress.
 */

/** A version-3 save with a bit of everything the migration has to handle. */
function v3Save(overrides = {}) {
  return {
    version: 3,
    buzz: 5_000,
    lifetimeBuzz: 900_000,
    runBuzz: 40_000,
    dollars: 12,
    dollarsEarnedTotal: 30,
    dollarsSpentTotal: 18,
    hardware: { cpu: 2, ram: 1, gpu: 0, hdd: 1, mobo: 0 },
    prestigeCount: 3,
    apps: {
      system: { installed: true, open: false, minimized: false },
      aerochat: { installed: true, open: true, minimized: false },
      retroamp: { installed: true, open: false, minimized: false },
      shield99: { installed: true, open: false, minimized: false },
      aeroburn: { installed: true, open: false, minimized: false },
      aerostudio: { installed: false, open: false, minimized: false },
    },
    chat: { bots: 137, event: null, nextEventIn: 12 },
    shield99: { quarantine: [], nextThreatIn: 0, adCooldownUntil: 0, filesCleaned: 4, nextId: 1 },
    aeroburn: { discs: [{ typeId: 'mix', spent: 5_000 }], burning: null, burned: 2 },
    aerostudio: {
      isRendering: false,
      currentProject: null,
      progress: 0,
      pendingReward: null,
      upgrades: { sidechainCompression: 2, arpeggiator: 0, environmentalFx: 0 },
    },
    lemonwire: { activeSeeds: [], maxSeedSlots: 3, connection: 1, trash: [], nextId: 1 },
    stats: { nudges: 500, playtimeSeconds: 3600, bonusesClaimed: 2, bonusesMissed: 1, threatsBlocked: 0 },
    settings: { sfx: true, bgm: false, motion: 'reduced' },
    lastSeen: 0,
    startedAt: 0,
    ...overrides,
  };
}

describe('3 -> 4', () => {
  it('lands on the current version', () => {
    expect(migrate(v3Save()).version).toBe(4);
    expect(SAVE_VERSION).toBe(4);
  });

  it('turns the buddy count into building #1', () => {
    const after = migrate(v3Save());
    expect(after.buildings.aerochat.units).toBe(137);
    expect(after.chat.bots).toBeUndefined();
    expect(after.chat.nextEventIn).toBe(12);
  });

  it('gives every other building a zeroed entry', () => {
    const after = migrate(v3Save());
    for (const building of BUILDINGS) {
      expect(after.buildings[building.id]).toBeDefined();
      if (building.id !== 'aerochat') expect(after.buildings[building.id].units).toBe(0);
    }
  });

  it('seeds the Legacy accumulator from the history the player already has', () => {
    const after = migrate(v3Save());
    expect(after.allTimeBuzz).toBe(900_000);
    expect(after.legacy).toEqual({ level: 0 });
  });

  it('keeps everything the wipe was never meant to touch', () => {
    const before = v3Save();
    const after = migrate(before);
    expect(after.hardware).toEqual(before.hardware);
    expect(after.dollars).toBe(before.dollars);
    expect(after.dollarsEarnedTotal).toBe(before.dollarsEarnedTotal);
    expect(after.prestigeCount).toBe(before.prestigeCount);
    expect(after.stats).toEqual(before.stats);
    expect(after.settings).toEqual(before.settings);
    expect(after.lemonwire.connection).toBe(1);
  });

  it('adds the redesign’s new slices with their defaults', () => {
    const after = migrate(v3Save());
    expect(after.achievements).toEqual({ unlocked: {} });
    expect(after.event.airplaneModeOwned).toBe(false);
    expect(after.event.overflowPhase).toBe(0);
    expect(after.crazyGames).toEqual({ lastReportedCompletion: 0 });
  });
});

describe('the sunset refund (GDD §11)', () => {
  it('drops the three retired buildings from the save', () => {
    const after = migrate(v3Save());
    expect(after.shield99).toBeUndefined();
    expect(after.aeroburn).toBeUndefined();
    expect(after.aerostudio).toBeUndefined();
  });

  it('refunds install prices, upgrade spend, and unplayed discs', () => {
    const before = v3Save();
    const after = migrate(before);

    const sidechain = AEROSTUDIO.upgrades.sidechainCompression;
    const upgradeSpend =
      Math.ceil(sidechain.baseCost) + Math.ceil(sidechain.baseCost * sidechain.costGrowth);
    const expected =
      getApp('shield99').install.cost + // installed
      getApp('aeroburn').install.cost + // installed
      // Aero Studio was never installed, so its install price is not owed...
      upgradeSpend + // ...but its upgrade spend is, and 5,000 sits on a disc.
      5_000;

    expect(after.sunsetRefund).toBe(expected);
    expect(after.buzz).toBe(before.buzz + expected);
  });

  it('is not the GDD draft’s zero — the three never had a unit count', () => {
    // The documented formula reads `app.units ?? app.bots`, which is 0 for all
    // three. A refund of nothing is the failure mode this test exists to catch.
    expect(migrate(v3Save()).sunsetRefund).toBeGreaterThan(0);
  });

  it('refunds a disc still in the drive', () => {
    const save = v3Save();
    save.aeroburn = { discs: [], burning: { typeId: 'gold', spent: 1_000_000 }, burned: 0 };
    const plain = v3Save();
    plain.aeroburn = { discs: [], burning: null, burned: 0 };
    expect(migrate(save).sunsetRefund - migrate(plain).sunsetRefund).toBe(1_000_000);
  });

  it('refunds nothing to a player who never bought any of them', () => {
    const save = v3Save({
      apps: {
        system: { installed: true, open: false, minimized: false },
        aerochat: { installed: true, open: true, minimized: false },
      },
      aeroburn: { discs: [], burning: null, burned: 0 },
      aerostudio: { upgrades: { sidechainCompression: 0, arpeggiator: 0, environmentalFx: 0 } },
    });
    const after = migrate(save);
    expect(after.sunsetRefund).toBe(0);
    expect(after.buzz).toBe(save.buzz);
  });
});

describe('through the real load path', () => {
  it('survives a round trip and comes out playable', () => {
    const storage = createMemoryStorage({ [SAVE.key]: JSON.stringify(v3Save()) });
    const loaded = deserialize(storage.getItem(SAVE.key), 0);

    expect(loaded.version).toBe(4);
    expect(loaded.buildings.aerochat.units).toBe(137);
    expect(loaded.allTimeBuzz).toBe(900_000);
    // withDefaults fills anything the migration did not name...
    expect(loaded.sweeper).toBeDefined();
    expect(loaded.cosmetics).toBeDefined();
    // ...and no window survives a reload minimised.
    for (const app of Object.values(loaded.apps)) expect(app.minimized).toBe(false);
  });

  it('re-serialises without losing the new fields', () => {
    const loaded = deserialize(JSON.stringify(v3Save()), 0);
    const again = deserialize(serialize(loaded), 0);
    expect(again.buildings).toEqual(loaded.buildings);
    expect(again.allTimeBuzz).toBe(loaded.allTimeBuzz);
    expect(again.event).toEqual(loaded.event);
  });

  it('leaves a fresh version-4 save alone', () => {
    const fresh = createInitialState(0);
    const after = migrate(JSON.parse(JSON.stringify(fresh)));
    expect(after).toEqual(JSON.parse(JSON.stringify(fresh)));
    expect(after.sunsetRefund).toBeUndefined();
  });

  it('drops a building id the roster no longer declares', () => {
    const stale = { ...createInitialState(0) };
    stale.buildings = { ...stale.buildings, aeroburn: { units: 9 } };
    const loaded = deserialize(JSON.stringify(stale), 0);
    expect(loaded.buildings.aeroburn).toBeUndefined();
    expect(loaded.buildings.aerochat).toBeDefined();
  });
});
