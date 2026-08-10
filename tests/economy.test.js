import { describe, expect, it } from 'vitest';
import * as econ from '../src/core/economy.js';
import { addBuff } from '../src/core/buffs.js';
import { createInitialState, resetForPrestige } from '../src/core/state.js';
import { BLOAT, BUILDING, OFFLINE, PRESTIGE } from '../src/data/balance.js';
import { getBuilding } from '../src/data/buildings.js';

const AEROCHAT = getBuilding('aerochat');
const FIRST_MILESTONE = BUILDING.milestones[1];
import { CPU_TIERS, GPU_TIERS, HARDWARE_BASE, HDD_TIERS, RAM_TIERS } from '../src/data/hardware.js';

const stateWith = (patch = {}) => ({ ...createInitialState(0), ...patch });

describe('memory budget', () => {
  it('counts only open apps against RAM', () => {
    const s = createInitialState(0);
    expect(econ.ramUsed(s)).toBe(0);
    s.apps.aerochat.open = true;
    expect(econ.ramUsed(s)).toBe(32);
  });

  it('reports the stock machine capacity', () => {
    expect(econ.ramCapacity(createInitialState(0))).toBe(HARDWARE_BASE.ramMB);
  });

  it('refuses to open an app that does not fit', () => {
    const s = createInitialState(0);
    s.hardware.ram = 0; // 128 MB
    s.apps.aerostudio.installed = true; // 192 MB
    expect(econ.canOpenApp(s, 'aerostudio')).toEqual({ ok: false, reason: 'out-of-memory' });
  });

  it('allows the same app once RAM is upgraded', () => {
    const s = createInitialState(0);
    s.hardware.ram = 3; // 1 GB
    s.apps.aerostudio.installed = true;
    expect(econ.canOpenApp(s, 'aerostudio').ok).toBe(true);
  });

  it('refuses apps that are not installed', () => {
    expect(econ.canOpenApp(createInitialState(0), 'lemonwire').reason).toBe('not-installed');
  });
});

describe('unit pricing', () => {
  it('grows the price geometrically', () => {
    expect(econ.unitCost('aerochat', 0)).toBe(AEROCHAT.baseCost);
    expect(econ.unitCost('aerochat', 1)).toBe(Math.ceil(AEROCHAT.baseCost * BUILDING.costGrowth));
    expect(econ.unitCost('aerochat', 10)).toBeGreaterThan(econ.unitCost('aerochat', 9));
  });

  it('bulk cost equals the sum of individual costs', () => {
    const sum = econ.unitCost('aerochat', 0) + econ.unitCost('aerochat', 1) + econ.unitCost('aerochat', 2);
    expect(econ.unitCostBulk('aerochat', 0, 3)).toBe(sum);
  });

  it('affordableUnits never overspends', () => {
    const s = stateWith({ buzz: 100 });
    const { count, cost } = econ.affordableUnits(s, 'aerochat', 50);
    expect(cost).toBeLessThanOrEqual(100);
    expect(econ.unitCostBulk('aerochat', 0, count + 1)).toBeGreaterThan(100);
  });

  it('affordableUnits returns nothing when broke', () => {
    expect(econ.affordableUnits(stateWith({ buzz: 0 }), 'aerochat', 10).count).toBe(0);
  });
});

describe('production', () => {
  it('keeps producing while AeroChat is closed', () => {
    // The redesign's rule (GDD §5): a building pays whether or not its window
    // is on screen. RAM bounds what can be *shown*, not what earns.
    const s = createInitialState(0);
    s.buildings.aerochat.units = 10;
    s.apps.aerochat.open = false;
    expect(econ.baseBuzzPerSecond(s)).toBeCloseTo(10 * AEROCHAT.baseProduction);
  });

  it('scales with bots', () => {
    const s = createInitialState(0);
    s.buildings.aerochat.units = 10;
    s.apps.aerochat.open = true;
    expect(econ.baseBuzzPerSecond(s)).toBeCloseTo(10 * AEROCHAT.baseProduction);
  });

  it('applies the CPU tick rate as a global multiplier', () => {
    const s = createInitialState(0);
    s.buildings.aerochat.units = 10;
    s.apps.aerochat.open = true;
    const base = econ.buzzPerSecond(s);
    s.hardware.cpu = 1;
    expect(econ.buzzPerSecond(s)).toBeGreaterThan(base);
  });
});

describe('bloat', () => {
  it('is neutral on a clean system and halves production when full', () => {
    expect(econ.bloatPenalty(stateWith({ bloat: 0 }))).toBe(1);
    expect(econ.bloatPenalty(stateWith({ bloat: 1 }))).toBeCloseTo(BLOAT.productionPenaltyAtFull);
  });

  it('clamps out-of-range values', () => {
    expect(econ.bloatPenalty(stateWith({ bloat: 5 }))).toBeCloseTo(BLOAT.productionPenaltyAtFull);
    expect(econ.bloatPenalty(stateWith({ bloat: -2 }))).toBe(1);
  });

  it('accrues faster with more open apps', () => {
    const idle = createInitialState(0);
    const busy = createInitialState(0);
    busy.apps.aerochat.open = true;
    busy.apps.system.open = true;
    expect(econ.bloatGain(busy, 60)).toBeGreaterThan(econ.bloatGain(idle, 60));
  });

  it('reports warning levels at the tuned thresholds', () => {
    expect(econ.bloatLevel(stateWith({ bloat: 0 }))).toBe('ok');
    expect(econ.bloatLevel(stateWith({ bloat: BLOAT.warnAt }))).toBe('warn');
    expect(econ.bloatLevel(stateWith({ bloat: BLOAT.criticalAt }))).toBe('critical');
  });
});

describe('offline earnings', () => {
  const producing = () => {
    const s = createInitialState(0);
    s.buildings.aerochat.units = 100;
    s.apps.aerochat.open = true;
    return s;
  };

  it('ignores very short absences', () => {
    expect(econ.offlineEarnings(producing(), OFFLINE.minSeconds - 1).buzz).toBe(0);
  });

  it('is taxed by the offline efficiency', () => {
    const s = producing();
    const hour = 3600;
    expect(econ.offlineEarnings(s, hour).buzz).toBeCloseTo(
      econ.buzzPerSecond(s) * hour * OFFLINE.efficiency,
    );
  });

  it('caps at the HDD tier and flags the cap', () => {
    const s = producing();
    const capSeconds = HARDWARE_BASE.offlineHours * 3600;
    const result = econ.offlineEarnings(s, capSeconds * 10);
    expect(result.seconds).toBe(capSeconds);
    expect(result.capped).toBe(true);
  });

  it('extends the cap when the HDD is upgraded', () => {
    const s = producing();
    const before = econ.offlineCapSeconds(s);
    s.hardware.hdd = 3; // 250 GB SATA
    expect(econ.offlineCapSeconds(s)).toBe(econ.hardwareEffects(s).offlineHours * 3600);
    expect(econ.offlineCapSeconds(s)).toBeGreaterThan(before);
  });
});

describe('prestige', () => {
  it('pays nothing below the minimum lifetime Buzz', () => {
    const s = stateWith({ lifetimeBuzz: PRESTIGE.minLifetimeBuzz - 1 });
    expect(econ.pendingPrestigeDollars(s)).toBe(0);
    expect(econ.canPrestige(s)).toBe(false);
  });

  it('pays out the growth since the last Format C:', () => {
    const s = stateWith({ lifetimeBuzz: 1_000_000 });
    const first = econ.pendingPrestigeDollars(s);
    expect(first).toBeGreaterThan(0);

    const after = resetForPrestige(s, first, 0);
    expect(econ.pendingPrestigeDollars(after)).toBe(0);

    after.lifetimeBuzz *= 4;
    expect(econ.pendingPrestigeDollars(after)).toBeGreaterThan(0);
  });

  it('never pays the same lifetime Buzz twice', () => {
    let s = stateWith({ lifetimeBuzz: 250_000 });
    let banked = 0;
    for (let i = 0; i < 3; i += 1) {
      const owed = econ.pendingPrestigeDollars(s);
      s = resetForPrestige(s, owed, 0);
      banked += owed;
    }
    expect(banked).toBeCloseTo(econ.lifetimeDollarValue(s), 2);
  });

  it('keeps hardware and Dollars but wipes software', () => {
    const s = stateWith({ lifetimeBuzz: 1_000_000, buzz: 999, dollars: 5 });
    s.hardware.cpu = 2;
    s.buildings.aerochat.units = 42;
    s.apps.retroamp.installed = true;

    const after = resetForPrestige(s, 10, 0);
    expect(after.hardware.cpu).toBe(2);
    expect(after.dollars).toBe(15);
    expect(after.buzz).toBe(0);
    expect(after.buildings.aerochat.units).toBe(0);
    expect(after.apps.retroamp.installed).toBe(false);
    expect(after.apps.aerochat.installed).toBe(true);
    expect(after.lifetimeBuzz).toBe(1_000_000);
    expect(after.prestigeCount).toBe(1);
  });

  it('does not mutate the state it resets', () => {
    const s = stateWith({ lifetimeBuzz: 1_000_000, buzz: 500 });
    resetForPrestige(s, 10, 0);
    expect(s.buzz).toBe(500);
  });
});

describe('buddy milestones', () => {
  const withBots = (bots) => {
    const s = createInitialState(0);
    s.buildings.aerochat.units = bots;
    s.apps.aerochat.open = true;
    return s;
  };

  it('is neutral below the first milestone', () => {
    expect(econ.milestoneMultiplier(FIRST_MILESTONE.at - 1)).toBe(1);
  });

  it('steps to the next tier exactly on the threshold', () => {
    expect(econ.milestoneMultiplier(FIRST_MILESTONE.at)).toBe(FIRST_MILESTONE.multiplier);
  });

  it('reports how far the next milestone is', () => {
    const next = econ.nextMilestone(FIRST_MILESTONE.at + 4);
    expect(next.at).toBe(BUILDING.milestones[2].at);
    expect(next.remaining).toBe(BUILDING.milestones[2].at - FIRST_MILESTONE.at - 4);
  });

  it('has no next milestone at the top tier', () => {
    expect(econ.nextMilestone(BUILDING.milestones.at(-1).at)).toBeNull();
  });

  it('raises production', () => {
    const before = econ.buzzPerSecond(withBots(FIRST_MILESTONE.at - 1), 0);
    const after = econ.buzzPerSecond(withBots(FIRST_MILESTONE.at), 0);
    // One more buddy plus the milestone: strictly more than the linear step.
    expect(after / before).toBeGreaterThan(FIRST_MILESTONE.at / (FIRST_MILESTONE.at - 1));
  });
});

describe('rate breakdown', () => {
  const producing = (bots) => {
    const s = createInitialState(0);
    s.buildings.aerochat.units = bots;
    s.apps.aerochat.open = true;
    return s;
  };

  it('factors multiply back to the total', () => {
    const s = producing(FIRST_MILESTONE.at * 2 + 3);
    s.hardware.cpu = 2;
    s.bloat = 0.4;
    addBuff(s, { id: 'b', kind: 'chat', magnitude: 0.25, durationSeconds: 60, label: 'b' }, 0);
    addBuff(s, { id: 'g', kind: 'global', magnitude: 0.15, durationSeconds: 60, label: 'g' }, 0);

    s.apps.retroamp.installed = true;
    s.apps.retroamp.open = true;
    s.retroamp.playlist = 'soft-signals';

    const bd = econ.rateBreakdown(s, 0);
    expect(bd.playlist).toBeGreaterThan(1);
    expect(
      bd.base * bd.milestone * bd.buffs * bd.playlist * bd.cpu * bd.legacy * bd.bloat,
    ).toBeCloseTo(bd.total, 6);
  });

  it('reports the plain case with every factor neutral', () => {
    const bd = econ.rateBreakdown(producing(10), 0);
    expect(bd).toMatchObject({ bots: 10, milestone: 1, buffs: 1, cpu: 1, bloat: 1, open: true });
    expect(bd.total).toBeCloseTo(bd.base);
  });

  it('shows bloat as a factor eating into the milestone', () => {
    // The shape of the original bug report: an advertised multiplier that looks
    // like it did nothing, because bloat quietly cancels part of it. The step
    // table is far too big for bloat to erase now, but the breakdown still has
    // to *show* the drag rather than let the player infer it.
    const s = producing(28);
    s.bloat = 0.11; // the value on screen when it was reported
    const bd = econ.rateBreakdown(s, 0);

    expect(bd.milestone).toBe(FIRST_MILESTONE.multiplier);
    expect(bd.bloat).toBeCloseTo(0.945);
    expect(bd.total).toBeLessThan(bd.base * bd.milestone);
  });

  it('keeps reporting the rate while AeroChat is closed', () => {
    const s = producing(10);
    s.apps.aerochat.open = false;
    const bd = econ.rateBreakdown(s, 0);
    expect(bd.open).toBe(false);
    expect(bd.total).toBeGreaterThan(0);
  });
});

describe('buff integration', () => {
  const producing = () => {
    const s = createInitialState(0);
    s.buildings.aerochat.units = 10;
    s.apps.aerochat.open = true;
    return s;
  };

  it('chat buffs scale AeroChat production', () => {
    const s = producing();
    const before = econ.buzzPerSecond(s, 0);
    addBuff(s, { id: 'x', kind: 'chat', magnitude: 0.5, durationSeconds: 60, label: 'x' }, 0);
    expect(econ.buzzPerSecond(s, 0)).toBeCloseTo(before * 1.5);
  });

  it('global buffs scale everything', () => {
    const s = producing();
    const before = econ.buzzPerSecond(s, 0);
    addBuff(s, { id: 'g', kind: 'global', magnitude: 0.2, durationSeconds: 60, label: 'g' }, 0);
    expect(econ.buzzPerSecond(s, 0)).toBeCloseTo(before * 1.2);
  });

  it('click buffs scale the Nudge payout only', () => {
    const s = producing();
    const rate = econ.buzzPerSecond(s, 0);
    const click = econ.clickPower(s, 0);
    addBuff(s, { id: 'c', kind: 'click', magnitude: 1, durationSeconds: 60, label: 'c' }, 0);
    expect(econ.clickPower(s, 0)).toBeCloseTo(click * 2);
    expect(econ.buzzPerSecond(s, 0)).toBeCloseTo(rate);
  });

  it('expired buffs stop counting', () => {
    const s = producing();
    const before = econ.buzzPerSecond(s, 0);
    addBuff(s, { id: 'x', kind: 'chat', magnitude: 1, durationSeconds: 10, label: 'x' }, 0);
    expect(econ.buzzPerSecond(s, 20_000)).toBeCloseTo(before);
  });

  it('offline earnings are computed at the given moment', () => {
    const s = producing();
    addBuff(s, { id: 'x', kind: 'chat', magnitude: 1, durationSeconds: 10, label: 'x' }, 0);
    const withBuff = econ.offlineEarnings(s, 3600, 0).buzz;
    const without = econ.offlineEarnings(s, 3600, 60_000).buzz;
    expect(withBuff).toBeGreaterThan(without);
  });
});

describe('unlocks', () => {
  it('gates apps behind run Buzz', () => {
    expect(econ.isAppUnlocked(stateWith({ runBuzz: 0 }), 'retroamp')).toBe(false);
    expect(econ.isAppUnlocked(stateWith({ runBuzz: 10_000 }), 'retroamp')).toBe(true);
  });

  it('always unlocks system windows', () => {
    expect(econ.isAppUnlocked(stateWith({ runBuzz: 0 }), 'system')).toBe(true);
  });
});
