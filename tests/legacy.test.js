import { describe, expect, it } from 'vitest';
import * as econ from '../src/core/economy.js';
import { applyLegacyLevel, buzzForLevel, levelFor } from '../src/core/legacy.js';
import { createGame } from '../src/core/game.js';
import { createMemoryStorage } from '../src/core/save.js';
import { createInitialState, resetForPrestige } from '../src/core/state.js';
import { LEGACY, PRESTIGE } from '../src/data/balance.js';

/** Legacy Level — the prestige layer (GDD v2 §2.6, tests required by §13). */

const withHistory = (allTimeBuzz) => ({ ...createInitialState(0), allTimeBuzz });

describe('the curve', () => {
  it('is zero until the first level is actually earned', () => {
    expect(levelFor(0)).toBe(0);
    expect(levelFor(LEGACY.divisor - 1)).toBe(0);
    expect(levelFor(LEGACY.divisor)).toBe(1);
  });

  it('is cubic: each level costs more than the last', () => {
    for (let level = 1; level < 20; level += 1) {
      const step = buzzForLevel(level + 1) - buzzForLevel(level);
      const previous = buzzForLevel(level) - buzzForLevel(level - 1);
      expect(step).toBeGreaterThan(previous);
    }
  });

  it('round-trips through its own inverse', () => {
    for (const level of [1, 2, 5, 25, 400]) {
      expect(levelFor(buzzForLevel(level))).toBe(level);
      // Stepped back by a share of the gap below, not by 1: the thresholds run
      // to 1e17 and up, where a double cannot resolve a single Buzz and "one
      // short of the threshold" would be testing the float rather than the curve.
      const gap = buzzForLevel(level) - buzzForLevel(level - 1);
      expect(levelFor(buzzForLevel(level) - gap / 2)).toBe(level - 1);
    }
  });

  it('never decreases as all-time Buzz grows', () => {
    let previous = 0;
    for (let buzz = 0; buzz < 1e9; buzz = buzz * 1.7 + 1000) {
      const level = levelFor(buzz);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
  });

  it('is worth a flat percentage per level', () => {
    expect(econ.legacyMultiplier(withHistory(0))).toBe(1);
    expect(econ.legacyMultiplier(withHistory(buzzForLevel(10)))).toBeCloseTo(1 + 10 * LEGACY.perLevel);
  });

  it('reports progress toward the next level', () => {
    const half = (buzzForLevel(3) + buzzForLevel(4)) / 2;
    const progress = econ.legacyProgress(withHistory(half));
    expect(progress.level).toBe(3);
    expect(progress.nextAt).toBe(buzzForLevel(4));
    expect(progress.ratio).toBeGreaterThan(0);
    expect(progress.ratio).toBeLessThan(1);
    expect(progress.buzzNeeded).toBeCloseTo(buzzForLevel(4) - half);
  });
});

describe('in the multiplier chain', () => {
  it('raises production without touching what a building itself makes', () => {
    const s = createInitialState(0);
    s.buildings.aerochat.units = 50;
    const own = econ.buildingProduction(s, 'aerochat');
    const before = econ.buzzPerSecond(s, 0);

    s.allTimeBuzz = buzzForLevel(30);
    expect(econ.buildingProduction(s, 'aerochat')).toBe(own);
    expect(econ.buzzPerSecond(s, 0)).toBeCloseTo(before * (1 + 30 * LEGACY.perLevel));
  });
});

describe('across a Format C:', () => {
  it('carries the accumulator through the wipe', () => {
    const s = createInitialState(0);
    s.allTimeBuzz = buzzForLevel(4);
    s.lifetimeBuzz = 1_000_000;
    s.buildings.aerochat.units = 42;

    const after = resetForPrestige(s, 10, 0);
    expect(after.buildings.aerochat.units).toBe(0);
    expect(after.allTimeBuzz).toBe(buzzForLevel(4));
    expect(econ.legacyLevel(after)).toBe(4);
  });

  it('is stamped and reported by the wipe itself', () => {
    const game = createGame({ storage: createMemoryStorage(), now: 0, rng: () => 0.5 });
    game.state.lifetimeBuzz = PRESTIGE.minLifetimeBuzz * 100;
    game.state.allTimeBuzz = buzzForLevel(6);

    const result = game.formatC();
    expect(result.ok).toBe(true);
    expect(result.legacy).toMatchObject({ level: 6, before: 0, gained: 6, changed: true });
    expect(game.state.legacy.level).toBe(6);
    expect(econ.legacyMultiplier(game.state)).toBeCloseTo(1 + 6 * LEGACY.perLevel);
  });

  it('never falls, however many times the machine is wiped', () => {
    const game = createGame({ storage: createMemoryStorage(), now: 0, rng: () => 0.5 });
    let previous = 0;
    for (let i = 0; i < 5; i += 1) {
      game.state.buzz = 0;
      game.state.lifetimeBuzz += PRESTIGE.minLifetimeBuzz * 1000 * (i + 1);
      game.state.allTimeBuzz += buzzForLevel(3 + i);
      game.formatC();
      expect(game.state.legacy.level).toBeGreaterThanOrEqual(previous);
      previous = game.state.legacy.level;
    }
    expect(previous).toBeGreaterThan(0);
  });
});

describe('the accumulator', () => {
  it('is fed by every source of Buzz, and never settled', () => {
    const game = createGame({ storage: createMemoryStorage(), now: 0, rng: () => 0.5 });
    game.nudge(0);
    const afterNudge = game.state.allTimeBuzz;
    expect(afterNudge).toBeGreaterThan(0);
    expect(afterNudge).toBe(game.state.lifetimeBuzz);

    // Format C: settles `lifetimeBuzz` against what it has paid out; nothing
    // ever settles against `allTimeBuzz`, which is what makes it a monument.
    game.state.lifetimeBuzz = PRESTIGE.minLifetimeBuzz * 100;
    game.state.allTimeBuzz = PRESTIGE.minLifetimeBuzz * 100;
    game.formatC();
    expect(game.state.allTimeBuzz).toBe(PRESTIGE.minLifetimeBuzz * 100);
  });

  it('reports no change when the level did not move', () => {
    const s = withHistory(buzzForLevel(2));
    applyLegacyLevel(s);
    expect(applyLegacyLevel(s)).toMatchObject({ level: 2, gained: 0, changed: false });
  });
});
