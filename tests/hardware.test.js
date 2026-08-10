import { describe, expect, it } from 'vitest';
import * as econ from '../src/core/economy.js';
import { createGame } from '../src/core/game.js';
import { createMemoryStorage } from '../src/core/save.js';
import { createInitialState } from '../src/core/state.js';
import {
  HARDWARE,
  HARDWARE_BASE,
  HARDWARE_TRACKS,
  MIN_COOLDOWN,
  sumBonus,
} from '../src/data/hardware.js';

const at = (patch) => {
  const s = createInitialState(0);
  Object.assign(s.hardware, patch);
  return s;
};

describe('the flat-percentage model (AO-19)', () => {
  it('starts every track at its base value', () => {
    const effects = econ.hardwareEffects(createInitialState(0));
    expect(effects).toMatchObject({
      production: HARDWARE_BASE.production,
      click: HARDWARE_BASE.click,
      cooldown: HARDWARE_BASE.cooldown,
      ramMB: HARDWARE_BASE.ramMB,
      storageGB: HARDWARE_BASE.storageGB,
      offlineHours: HARDWARE_BASE.offlineHours,
    });
  });

  it('adds each tier bonus rather than replacing the stat', () => {
    // Tier 2 must be worth exactly tier 1's bonus plus its own.
    const cpu1 = econ.hardwareEffects(at({ cpu: 1 })).production;
    const cpu2 = econ.hardwareEffects(at({ cpu: 2 })).production;
    const tiers = HARDWARE.cpu.tiers;

    expect(cpu1).toBeCloseTo(1 + tiers[1].production);
    expect(cpu2).toBeCloseTo(cpu1 + tiers[2].production);
  });

  it('sums bonuses across every owned tier', () => {
    const owned = 3;
    const expected = HARDWARE.cpu.tiers
      .slice(0, owned + 1)
      .reduce((sum, tier) => sum + tier.production, 0);
    expect(sumBonus('cpu', owned, 'production')).toBeCloseTo(expected);
  });

  it('clamps a tier index beyond the end of the track', () => {
    const maxed = econ.hardwareEffects(at({ ram: 99 }));
    const last = econ.hardwareEffects(at({ ram: HARDWARE.ram.tiers.length - 1 }));
    expect(maxed.ramMB).toBe(last.ramMB);
  });

  it('every track improves monotonically', () => {
    for (const track of HARDWARE_TRACKS) {
      let previous = null;
      for (let i = 0; i < HARDWARE[track].tiers.length; i += 1) {
        const e = econ.hardwareEffects(at({ [track]: i }));
        const value = {
          cpu: e.production,
          ram: e.ramMB,
          gpu: -e.cooldown,
          hdd: e.offlineHours,
          mobo: e.payout,
        }[track];
        if (previous !== null) expect(value).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    }
  });
});

describe('the capacities players actually see', () => {
  it('doubles memory each tier, as the tier names promise', () => {
    expect(econ.ramCapacity(at({ ram: 0 }))).toBe(128);
    expect(econ.ramCapacity(at({ ram: 1 }))).toBe(256);
    expect(econ.ramCapacity(at({ ram: 2 }))).toBe(512);
    expect(econ.ramCapacity(at({ ram: 3 }))).toBe(1024);
    expect(econ.ramCapacity(at({ ram: 6 }))).toBe(8192);
  });

  it('matches the storage printed on each HDD tier', () => {
    expect(econ.storageCapacityGB(at({ hdd: 0 }))).toBe(20);
    expect(econ.storageCapacityGB(at({ hdd: 2 }))).toBe(80);
    expect(econ.storageCapacityGB(at({ hdd: 3 }))).toBe(250);
    expect(econ.storageCapacityGB(at({ hdd: 5 }))).toBe(1000);
  });

  it('extends offline earnings from 2 hours to 24 on a 250 GB SATA (GDD 5)', () => {
    expect(econ.hardwareEffects(at({ hdd: 0 })).offlineHours).toBe(2);
    expect(econ.hardwareEffects(at({ hdd: 3 })).offlineHours).toBe(24);
    expect(econ.offlineCapSeconds(at({ hdd: 3 }))).toBe(24 * 3600);
  });

  it('cuts cooldowns but never to zero', () => {
    expect(econ.cooldownMultiplier(at({ gpu: 0 }))).toBe(1);
    expect(econ.cooldownMultiplier(at({ gpu: 5 }))).toBeCloseTo(0.36);
    expect(econ.cooldownMultiplier(at({ gpu: 99 }))).toBeGreaterThanOrEqual(MIN_COOLDOWN);
  });
});

describe('what the stats are wired into', () => {
  const producing = (patch) => {
    const s = at(patch);
    s.buildings.aerochat.units = 10;
    s.apps.aerochat.open = true;
    return s;
  };

  it('CPU production scales Buzz per second', () => {
    const base = econ.buzzPerSecond(producing({ cpu: 0 }), 0);
    const upgraded = econ.buzzPerSecond(producing({ cpu: 3 }), 0);
    expect(upgraded / base).toBeCloseTo(econ.hardwareEffects(at({ cpu: 3 })).production);
  });

  it('CPU click scales the Nudge payout, and outpaces production', () => {
    const s = at({ cpu: 4 });
    const effects = econ.hardwareEffects(s);
    expect(econ.clickPower(s, 0)).toBeCloseTo(effects.click);
    expect(effects.click).toBeGreaterThan(effects.production);
  });

  it('RAM decides what fits in memory', () => {
    const s = at({ ram: 0 });
    // No single window outgrows the stock 128 MB now, so the budget is blown
    // by what is already open rather than by one heavyweight app.
    s.apps.lemonwire.installed = true;
    s.apps.lemonwire.open = true; // 96 of 128 MB
    s.apps.retroamp.installed = true; // wants 64
    expect(econ.canOpenApp(s, 'retroamp').ok).toBe(false);
    s.hardware.ram = 2;
    expect(econ.canOpenApp(s, 'retroamp').ok).toBe(true);
  });
});

describe('the shop rows (AO-18)', () => {
  it('describes one row per track with its position on it', () => {
    const rows = econ.hardwareSummary(at({ cpu: 2 }));
    expect(rows.map((r) => r.track)).toEqual(HARDWARE_TRACKS);

    const cpu = rows.find((r) => r.track === 'cpu');
    expect(cpu).toMatchObject({ index: 2, tierCount: HARDWARE.cpu.tiers.length, maxed: false });
    expect(cpu.next).toBe(HARDWARE.cpu.tiers[3]);
  });

  it('states what the next purchase gives, as percentages', () => {
    const cpu = econ.hardwareSummary(at({ cpu: 0 })).find((r) => r.track === 'cpu');
    expect(cpu.gains).toEqual(['+25% production', '+50% click power']);

    const gpu = econ.hardwareSummary(at({ gpu: 0 })).find((r) => r.track === 'gpu');
    expect(gpu.gains).toEqual(['−10% cooldowns']);
  });

  it('previews the upgraded machine so a row can show a delta', () => {
    const ram = econ.hardwareSummary(at({ ram: 1 })).find((r) => r.track === 'ram');
    expect(ram.effects.ramMB).toBe(256);
    expect(ram.upgraded.ramMB).toBe(512);
  });

  it('reports a maxed track with no next tier and no gains', () => {
    const last = HARDWARE.gpu.tiers.length - 1;
    const gpu = econ.hardwareSummary(at({ gpu: last })).find((r) => r.track === 'gpu');
    expect(gpu).toMatchObject({ maxed: true, next: null, cost: null });
    expect(gpu.gains).toEqual([]);
    expect(gpu.upgraded).toBeNull();
  });

  it('tracks affordability against the player wallet', () => {
    const s = at({ ram: 0 });
    expect(econ.hardwareSummary(s).find((r) => r.track === 'ram').affordable).toBe(false);
    s.dollars = 1000;
    expect(econ.hardwareSummary(s).find((r) => r.track === 'ram').affordable).toBe(true);
  });

  it('buying a tier applies exactly the advertised gain', () => {
    const game = createGame({ storage: createMemoryStorage(), now: 0 });
    game.state.dollars = 1000;

    const before = game.econ.hardwareEffects(game.state).production;
    const row = game.econ.hardwareSummary(game.state).find((r) => r.track === 'cpu');
    game.buyHardware('cpu');

    expect(game.econ.hardwareEffects(game.state).production).toBeCloseTo(
      before + row.next.production,
    );
  });
});

describe('save compatibility', () => {
  it('reads old saves unchanged — a tier index still means a tier index', () => {
    // The stored shape never changed, only what the tiers mean.
    const s = at({ cpu: 5, ram: 4, gpu: 3, hdd: 2 });
    expect(econ.ramCapacity(s)).toBe(2048);
    expect(econ.hardwareEffects(s).production).toBeCloseTo(3.8);
  });
});
