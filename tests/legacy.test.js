import { describe, expect, it } from 'vitest';
import * as econ from '../src/core/economy.js';
import { buzzForLevel, earlyLevelsFor, lateLevelsFor, legacyLevel, legacyMultiplier, legacyProgress, levelFor } from '../src/core/legacy.js';
import { createInitialState } from '../src/core/state.js';
import { LEGACY } from '../src/data/balance.js';

describe('Legacy Level dual-term formula', () => {
  it('grants Legacy Level 1 on the very first Format C: threshold (5,000 Buzz)', () => {
    expect(earlyLevelsFor(LEGACY.earlyAt)).toBe(1);
    expect(levelFor(LEGACY.earlyAt)).toBe(1);
  });

  it('early term scales logarithmically up to earlyLevels cap', () => {
    expect(earlyLevelsFor(5_000)).toBe(1);
    expect(earlyLevelsFor(50_000)).toBe(2);
    expect(earlyLevelsFor(500_000)).toBe(3);
    expect(earlyLevelsFor(5_000_000)).toBe(4);
    expect(earlyLevelsFor(50_000_000)).toBe(5);
    expect(earlyLevelsFor(500_000_000)).toBe(6);
    expect(earlyLevelsFor(5_000_000_000)).toBe(6); // Capped at earlyLevels
  });

  it('late term kicks in smoothly past 1 Billion Buzz', () => {
    expect(lateLevelsFor(1e9)).toBe(1);
    expect(levelFor(1e9)).toBe(7); // 6 early + 1 late
    expect(lateLevelsFor(8e9)).toBe(2);
    expect(levelFor(8e9)).toBe(8); // 6 early + 2 late
  });

  it('buzzForLevel is exact inverse of levelFor', () => {
    for (let level = 1; level <= 12; level += 1) {
      const buzz = buzzForLevel(level);
      expect(levelFor(buzz)).toBeGreaterThanOrEqual(level);
    }
  });

  it('legacyMultiplier scales global production by +1% per Legacy Level', () => {
    const s0 = createInitialState(0);
    s0.allTimeBuzz = 0;
    expect(legacyMultiplier(s0)).toBe(1.0);

    const s1 = createInitialState(0);
    s1.allTimeBuzz = 5_000;
    expect(legacyLevel(s1)).toBe(1);
    expect(legacyMultiplier(s1)).toBeCloseTo(1.01);

    const s7 = createInitialState(0);
    s7.allTimeBuzz = 1e9;
    expect(legacyLevel(s7)).toBe(7);
    expect(legacyMultiplier(s7)).toBeCloseTo(1.07);
  });

  it('legacyProgress reports ratio and remaining buzz accurately', () => {
    const s = createInitialState(0);
    s.allTimeBuzz = 25_000; // Between level 1 (5k) and level 2 (50k)
    const prog = legacyProgress(s);
    expect(prog.level).toBe(1);
    expect(prog.nextLevel).toBe(2);
    expect(prog.buzzNeeded).toBe(25_000);
    expect(prog.ratio).toBeCloseTo(0.444, 2);
  });
});
