import { describe, expect, it } from 'vitest';
import {
  activeBuffs,
  addBuff,
  buffMultiplier,
  pruneBuffs,
  remainingSeconds,
} from '../src/core/buffs.js';
import { createInitialState } from '../src/core/state.js';

const def = (patch = {}) => ({
  id: 'test',
  kind: 'chat',
  magnitude: 0.25,
  durationSeconds: 60,
  label: 'Test',
  ...patch,
});

describe('adding buffs', () => {
  it('stores the buff with an absolute expiry', () => {
    const s = createInitialState(0);
    const buff = addBuff(s, def(), 1000);
    expect(buff.expiresAt).toBe(61_000);
    expect(s.buffs).toHaveLength(1);
  });

  it('refreshes an existing buff instead of stacking duplicates', () => {
    const s = createInitialState(0);
    addBuff(s, def(), 0);
    addBuff(s, def(), 30_000);
    expect(s.buffs).toHaveLength(1);
    expect(s.buffs[0].expiresAt).toBe(90_000);
  });

  it('never shortens a running buff', () => {
    const s = createInitialState(0);
    addBuff(s, def({ durationSeconds: 120 }), 0);
    addBuff(s, def({ durationSeconds: 10 }), 0);
    expect(s.buffs[0].expiresAt).toBe(120_000);
  });
});

describe('multipliers', () => {
  it('is 1 with nothing active', () => {
    expect(buffMultiplier(createInitialState(0), 'chat', 0)).toBe(1);
  });

  it('multiplies buffs of the same kind', () => {
    const s = createInitialState(0);
    addBuff(s, def({ id: 'a', magnitude: 0.25 }), 0);
    addBuff(s, def({ id: 'b', magnitude: 0.25 }), 0);
    expect(buffMultiplier(s, 'chat', 0)).toBeCloseTo(1.5625);
  });

  it('keeps kinds separate', () => {
    const s = createInitialState(0);
    addBuff(s, def({ id: 'a', kind: 'chat', magnitude: 0.5 }), 0);
    addBuff(s, def({ id: 'b', kind: 'click', magnitude: 1 }), 0);
    expect(buffMultiplier(s, 'chat', 0)).toBeCloseTo(1.5);
    expect(buffMultiplier(s, 'click', 0)).toBeCloseTo(2);
    expect(buffMultiplier(s, 'global', 0)).toBe(1);
  });

  it('ignores expired buffs even before they are pruned', () => {
    const s = createInitialState(0);
    addBuff(s, def({ durationSeconds: 10 }), 0);
    expect(buffMultiplier(s, 'chat', 20_000)).toBe(1);
    expect(s.buffs).toHaveLength(1);
  });
});

describe('pruning', () => {
  it('removes expired buffs and reports them', () => {
    const s = createInitialState(0);
    addBuff(s, def({ id: 'short', durationSeconds: 5 }), 0);
    addBuff(s, def({ id: 'long', durationSeconds: 500 }), 0);

    const expired = pruneBuffs(s, 10_000);
    expect(expired.map((b) => b.id)).toEqual(['short']);
    expect(s.buffs.map((b) => b.id)).toEqual(['long']);
  });

  it('is a no-op when nothing has expired', () => {
    const s = createInitialState(0);
    addBuff(s, def(), 0);
    const before = s.buffs;
    expect(pruneBuffs(s, 1000)).toEqual([]);
    expect(s.buffs).toBe(before);
  });
});

describe('readouts', () => {
  it('reports remaining seconds, floored at zero', () => {
    const buff = addBuff(createInitialState(0), def({ durationSeconds: 30 }), 0);
    expect(remainingSeconds(buff, 10_000)).toBe(20);
    expect(remainingSeconds(buff, 90_000)).toBe(0);
  });

  it('lists only active buffs', () => {
    const s = createInitialState(0);
    addBuff(s, def({ id: 'a', durationSeconds: 5 }), 0);
    addBuff(s, def({ id: 'b', durationSeconds: 50 }), 0);
    expect(activeBuffs(s, 10_000).map((b) => b.id)).toEqual(['b']);
  });
});
