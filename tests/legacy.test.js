import { describe, expect, it } from 'vitest';
import { createInitialState, resetForPrestige } from '../src/core/state.js';
import * as legacy from '../src/core/legacy.js';
import { LEGACY } from '../src/data/balance.js';

describe('the Legacy curve (v2 §5.1)', () => {
  it('is zero on a fresh save', () => {
    expect(legacy.legacyLevel(createInitialState(0))).toBe(0);
    expect(legacy.legacyMultiplier(createInitialState(0))).toBe(1);
  });

  it('reaches level 1 at the divisor and level 10 at a thousand times it', () => {
    const s = createInitialState(0);
    s.allTimeBuzz = LEGACY.divisor;
    expect(legacy.legacyLevel(s)).toBe(1);
    s.allTimeBuzz = LEGACY.divisor * 1000;
    expect(legacy.legacyLevel(s)).toBe(10);
  });

  it('pays a linear multiplier for a cubic cost', () => {
    const s = createInitialState(0);
    s.allTimeBuzz = LEGACY.divisor * 8; // 2^3
    expect(legacy.legacyLevel(s)).toBe(2);
    expect(legacy.legacyMultiplier(s)).toBeCloseTo(1 + 2 * LEGACY.perLevel);
  });

  // v2 §9: the monotonicity test.
  it('never decreases as all-time Buzz grows', () => {
    const s = createInitialState(0);
    let last = 0;
    for (let buzz = 0; buzz <= LEGACY.divisor * 2000; buzz += LEGACY.divisor * 13) {
      s.allTimeBuzz = buzz;
      const level = legacy.legacyLevel(s);
      expect(level).toBeGreaterThanOrEqual(last);
      last = level;
    }
  });

  it('handles a zero or negative accumulator without producing NaN', () => {
    const s = createInitialState(0);
    s.allTimeBuzz = 0;
    expect(legacy.legacyLevel(s)).toBe(0);
    s.allTimeBuzz = -5;
    expect(legacy.legacyLevel(s)).toBe(0);
  });

  it('reports progress toward the next level', () => {
    const s = createInitialState(0);
    s.allTimeBuzz = LEGACY.divisor * 4; // between level 1 (1×) and level 2 (8×)
    const p = legacy.legacyProgress(s);
    expect(p.level).toBe(1);
    expect(p.nextLevel).toBe(2);
    expect(p.ratio).toBeGreaterThan(0);
    expect(p.ratio).toBeLessThan(1);
    expect(p.buzzNeeded).toBeCloseTo(LEGACY.divisor * 8 - LEGACY.divisor * 4);
  });
});

// v2 §9: the level must survive the wipe it is paid for.
describe('surviving Format C:', () => {
  it('keeps the all-time accumulator and therefore the level', () => {
    const s = createInitialState(0);
    s.allTimeBuzz = LEGACY.divisor * 27; // level 3
    s.lifetimeBuzz = LEGACY.divisor * 27;
    expect(legacy.legacyLevel(s)).toBe(3);

    const after = resetForPrestige(s, 5, 0);
    expect(after.allTimeBuzz).toBe(s.allTimeBuzz);
    expect(legacy.legacyLevel(after)).toBe(3);
  });

  it('resets the run but not the multiplier', () => {
    const s = createInitialState(0);
    s.allTimeBuzz = LEGACY.divisor * 8;
    s.buzz = 9999;
    s.runBuzz = 9999;
    const after = resetForPrestige(s, 1, 0);
    expect(after.buzz).toBe(0);
    expect(after.runBuzz).toBe(0);
    expect(legacy.legacyMultiplier(after)).toBeCloseTo(1 + 2 * LEGACY.perLevel);
  });
});

describe('Legacy Slots (v2 §5.2)', () => {
  function withDollars(amount) {
    const s = createInitialState(0);
    s.dollars = amount;
    return s;
  }

  it('charges the escalating price and records the spend', () => {
    const s = withDollars(LEGACY.slotCosts[0]);
    expect(legacy.buySlot(s).ok).toBe(true);
    expect(s.dollars).toBe(0);
    expect(s.dollarsSpentTotal).toBe(LEGACY.slotCosts[0]);
    expect(legacy.slotCount(s)).toBe(1);
    expect(legacy.nextSlotCost(s)).toBe(LEGACY.slotCosts[1]);
  });

  it('refuses a fourth slot', () => {
    const s = withDollars(1e6);
    for (let i = 0; i < LEGACY.slotCosts.length; i += 1) legacy.buySlot(s);
    expect(legacy.buySlot(s)).toMatchObject({ ok: false, reason: 'maxed' });
  });

  it('will not point two slots at one upgrade', () => {
    const s = withDollars(1e6);
    legacy.buySlot(s);
    legacy.buySlot(s);
    expect(legacy.assignSlot(s, 0, 'retroamp.t1').ok).toBe(true);
    expect(legacy.assignSlot(s, 1, 'retroamp.t1')).toMatchObject({
      ok: false,
      reason: 'already-slotted',
    });
  });

  it('rejects an upgrade id that is not on the roster', () => {
    const s = withDollars(1e6);
    legacy.buySlot(s);
    expect(legacy.assignSlot(s, 0, 'nope.t9')).toMatchObject({ ok: false });
  });

  it('carries a slotted upgrade through the wipe and drops the rest', () => {
    const s = withDollars(1e6);
    legacy.buySlot(s);
    legacy.assignSlot(s, 0, 'retroamp.t1');
    s.upgrades.owned['retroamp.t1'] = true;
    s.upgrades.owned['retroamp.t2'] = true;
    s.lifetimeBuzz = 1e6;

    const after = resetForPrestige(s, 1, 0);
    expect(after.upgrades.owned['retroamp.t1']).toBe(true);
    expect(after.upgrades.owned['retroamp.t2']).toBeUndefined();
    // The slot itself was bought with Dollars, so it survives too.
    expect(after.legacy.slots).toEqual(['retroamp.t1']);
  });

  it('does not resurrect a slotted upgrade that was never bought', () => {
    const s = withDollars(1e6);
    legacy.buySlot(s);
    legacy.assignSlot(s, 0, 'retroamp.t1');
    s.lifetimeBuzz = 1e6;

    const after = resetForPrestige(s, 1, 0);
    expect(after.upgrades.owned['retroamp.t1']).toBeUndefined();
  });
});
