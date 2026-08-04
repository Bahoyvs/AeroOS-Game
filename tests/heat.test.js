import { describe, expect, it } from 'vitest';
import * as econ from '../src/core/economy.js';
import { createInitialState } from '../src/core/state.js';
import { HEAT, OFFLINE } from '../src/data/balance.js';

const machine = ({ bloat = 0, open = [] } = {}) => {
  const s = createInitialState(0);
  s.bloat = bloat;
  for (const id of open) s.apps[id].open = true;
  return s;
};

describe('system heat (AO-27)', () => {
  it('a freshly booted machine idles cool', () => {
    expect(econ.systemHeat(machine())).toBe(HEAT.idleC);
    expect(econ.heatLevel(machine())).toBe('ok');
    expect(econ.heatRatio(machine())).toBe(0);
  });

  it('rises with bloat', () => {
    const cool = econ.systemHeat(machine({ bloat: 0.1 }));
    const warm = econ.systemHeat(machine({ bloat: 0.5 }));
    const hot = econ.systemHeat(machine({ bloat: 1 }));

    expect(warm).toBeGreaterThan(cool);
    expect(hot).toBeGreaterThan(warm);
  });

  it('rises with what the player keeps open', () => {
    const idle = econ.systemHeat(machine({ bloat: 0.3 }));
    const busy = econ.systemHeat(machine({ bloat: 0.3, open: ['aerochat', 'retroamp'] }));
    expect(busy).toBeGreaterThan(idle);
  });

  it('never exceeds the thermal ceiling', () => {
    const cooked = machine({ bloat: 5, open: ['aerochat', 'retroamp', 'lemonwire', 'shield99'] });
    expect(econ.systemHeat(cooked)).toBe(HEAT.maxC);
    expect(econ.heatRatio(cooked)).toBe(1);
  });

  it('escalates through ok → warn → critical', () => {
    const levels = [0, 0.5, 0.8, 1].map((bloat) => econ.heatLevel(machine({ bloat })));
    expect(levels[0]).toBe('ok');
    expect(levels.at(-1)).toBe('critical');
    // Monotone: it never cools down as bloat rises.
    const rank = { ok: 0, warn: 1, critical: 2 };
    for (let i = 1; i < levels.length; i += 1) {
      expect(rank[levels[i]]).toBeGreaterThanOrEqual(rank[levels[i - 1]]);
    }
  });

  it('crosses the warn threshold before production is badly hurt', () => {
    // Tension should arrive *before* the player has lost much — that is the
    // point of the escalation (GDD 7).
    const s = machine({ bloat: 0.55, open: ['aerochat'] });
    expect(econ.systemHeat(s)).toBeGreaterThanOrEqual(HEAT.warnC);
    expect(econ.bloatPenalty(s)).toBeGreaterThan(0.7);
  });

  it('ratio stays inside 0..1 for any state', () => {
    for (const bloat of [-1, 0, 0.3, 1, 99]) {
      const ratio = econ.heatRatio(machine({ bloat }));
      expect(ratio).toBeGreaterThanOrEqual(0);
      expect(ratio).toBeLessThanOrEqual(1);
    }
  });
});

describe('the offline report (AO-28)', () => {
  const producing = () => {
    const s = createInitialState(0);
    s.chat.bots = 100;
    s.apps.aerochat.open = true;
    return s;
  };

  it('reports how long they were away as well as what counted', () => {
    const s = producing();
    const day = 24 * 3600;
    const report = econ.offlineEarnings(s, day, 0);

    expect(report.elapsedSeconds).toBe(day);
    expect(report.seconds).toBeLessThan(day); // a stock HDD banks 2 hours
    expect(report.capped).toBe(true);
    expect(report.cappedHours).toBe(2);
  });

  it('does not flag a cap when the whole absence counted', () => {
    const report = econ.offlineEarnings(producing(), 1800, 0);
    expect(report.capped).toBe(false);
    expect(report.seconds).toBe(1800);
    expect(report.elapsedSeconds).toBe(1800);
  });

  it('still reports the elapsed time for an absence too short to pay', () => {
    const report = econ.offlineEarnings(producing(), OFFLINE.minSeconds - 1, 0);
    expect(report.buzz).toBe(0);
    expect(report.elapsedSeconds).toBe(OFFLINE.minSeconds - 1);
  });

  it('a bigger HDD banks more of the same absence', () => {
    const stock = econ.offlineEarnings(producing(), 24 * 3600, 0);
    const upgraded = producing();
    upgraded.hardware.hdd = 3;
    const better = econ.offlineEarnings(upgraded, 24 * 3600, 0);

    expect(better.seconds).toBeGreaterThan(stock.seconds);
    expect(better.buzz).toBeGreaterThan(stock.buzz);
    expect(better.cappedHours).toBe(24);
  });
});
