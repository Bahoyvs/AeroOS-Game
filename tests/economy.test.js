import { describe, expect, it } from 'vitest';
import * as econ from '../src/core/economy.js';
import { addBuff } from '../src/core/buffs.js';
import { createInitialState, resetForPrestige } from '../src/core/state.js';
import { BLOAT, CHAT_BOT, OFFLINE, PRESTIGE } from '../src/data/balance.js';
import { RAM_TIERS, HDD_TIERS } from '../src/data/hardware.js';

const stateWith = (patch = {}) => ({ ...createInitialState(0), ...patch });

describe('memory budget', () => {
  it('counts only open apps against RAM', () => {
    const s = createInitialState(0);
    expect(econ.ramUsed(s)).toBe(0);
    s.apps.aerochat.open = true;
    expect(econ.ramUsed(s)).toBe(32);
  });

  it('reports the starting RAM tier as capacity', () => {
    expect(econ.ramCapacity(createInitialState(0))).toBe(RAM_TIERS[0].capacity);
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

describe('chat bots', () => {
  it('grows the price geometrically', () => {
    expect(econ.botCost(0)).toBe(CHAT_BOT.baseCost);
    expect(econ.botCost(1)).toBe(Math.ceil(CHAT_BOT.baseCost * CHAT_BOT.costGrowth));
    expect(econ.botCost(10)).toBeGreaterThan(econ.botCost(9));
  });

  it('bulk cost equals the sum of individual costs', () => {
    const sum = econ.botCost(0) + econ.botCost(1) + econ.botCost(2);
    expect(econ.botCostBulk(0, 3)).toBe(sum);
  });

  it('affordableBots never overspends', () => {
    const s = stateWith({ buzz: 100 });
    const { count, cost } = econ.affordableBots(s, 50);
    expect(cost).toBeLessThanOrEqual(100);
    expect(econ.botCostBulk(0, count + 1)).toBeGreaterThan(100);
  });

  it('affordableBots returns nothing when broke', () => {
    expect(econ.affordableBots(stateWith({ buzz: 0 })).count).toBe(0);
  });
});

describe('production', () => {
  it('produces nothing while AeroChat is closed', () => {
    const s = stateWith({ chat: { bots: 10 } });
    expect(econ.baseBuzzPerSecond(s)).toBe(0);
  });

  it('scales with bots when AeroChat is open', () => {
    const s = createInitialState(0);
    s.chat.bots = 10;
    s.apps.aerochat.open = true;
    expect(econ.baseBuzzPerSecond(s)).toBeCloseTo(10 * CHAT_BOT.baseRate);
  });

  it('applies the CPU tick rate as a global multiplier', () => {
    const s = createInitialState(0);
    s.chat.bots = 10;
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
    s.chat.bots = 100;
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
    const capSeconds = HDD_TIERS[0].offlineHours * 3600;
    const result = econ.offlineEarnings(s, capSeconds * 10);
    expect(result.seconds).toBe(capSeconds);
    expect(result.capped).toBe(true);
  });

  it('extends the cap when the HDD is upgraded', () => {
    const s = producing();
    s.hardware.hdd = 3; // 250 GB SATA -> 24h
    expect(econ.offlineCapSeconds(s)).toBe(HDD_TIERS[3].offlineHours * 3600);
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
    s.chat.bots = 42;
    s.apps.retroamp.installed = true;

    const after = resetForPrestige(s, 10, 0);
    expect(after.hardware.cpu).toBe(2);
    expect(after.dollars).toBe(15);
    expect(after.buzz).toBe(0);
    expect(after.chat.bots).toBe(0);
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
    s.chat.bots = bots;
    s.apps.aerochat.open = true;
    return s;
  };

  it('is neutral below the first milestone', () => {
    expect(econ.chatMilestoneMultiplier(withBots(CHAT_BOT.milestoneEvery - 1))).toBe(1);
  });

  it('adds a flat bonus per milestone', () => {
    const s = withBots(CHAT_BOT.milestoneEvery * 3);
    expect(econ.chatMilestoneCount(s)).toBe(3);
    expect(econ.chatMilestoneMultiplier(s)).toBeCloseTo(1 + 3 * CHAT_BOT.milestoneBonus);
  });

  it('reports how far the next milestone is', () => {
    const next = econ.nextChatMilestone(withBots(CHAT_BOT.milestoneEvery + 4));
    expect(next.at).toBe(CHAT_BOT.milestoneEvery * 2);
    expect(next.remaining).toBe(CHAT_BOT.milestoneEvery - 4);
  });

  it('has no next milestone once the buddy list is full', () => {
    expect(econ.nextChatMilestone(withBots(CHAT_BOT.maxPerRun))).toBeNull();
  });

  it('raises production', () => {
    const before = econ.buzzPerSecond(withBots(CHAT_BOT.milestoneEvery - 1), 0);
    const after = econ.buzzPerSecond(withBots(CHAT_BOT.milestoneEvery), 0);
    // One more buddy plus the milestone: strictly more than the linear step.
    expect(after / before).toBeGreaterThan(CHAT_BOT.milestoneEvery / (CHAT_BOT.milestoneEvery - 1));
  });
});

describe('buff integration', () => {
  const producing = () => {
    const s = createInitialState(0);
    s.chat.bots = 10;
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
