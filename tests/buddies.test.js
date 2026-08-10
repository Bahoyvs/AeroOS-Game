import { describe, expect, it } from 'vitest';
import { BUDDY_NICK_COUNT, ambientStatus, buddyAt, isAway } from '../src/data/buddies.js';


describe('derived buddy identities', () => {
  it('is stable for the same index', () => {
    expect(buddyAt(7)).toEqual(buddyAt(7));
  });

  it('gives every buddy a name and an avatar', () => {
    for (let i = 0; i < 500; i += 1) {
      const buddy = buddyAt(i);
      expect(buddy.name).toBeTruthy();
      expect(buddy.avatar).toBeTruthy();
    }
  });

  it('numbers repeat visitors instead of showing duplicate names', () => {
    const first = buddyAt(0);
    const wrapped = buddyAt(BUDDY_NICK_COUNT * 2);
    expect(wrapped.name).not.toBe(first.name);
    expect(wrapped.name).toMatch(/3$/);
  });

  it('produces a reasonable spread of names across a full list', () => {
    const names = new Set();
    for (let i = 0; i < 100; i += 1) names.add(buddyAt(i).name);
    expect(names.size).toBeGreaterThan(20);
  });
});

describe('ambient rotation', () => {
  it('is stable within an epoch and changes across epochs', () => {
    expect(ambientStatus(3, 100)).toBe(ambientStatus(3, 100));

    const statuses = new Set();
    for (let epoch = 0; epoch < 40; epoch += 1) statuses.add(ambientStatus(3, epoch));
    expect(statuses.size).toBeGreaterThan(1);
  });

  it('marks some buddies away, but not most of them', () => {
    let away = 0;
    for (let i = 0; i < 200; i += 1) if (isAway(i, 5)) away += 1;
    expect(away).toBeGreaterThan(0);
    expect(away).toBeLessThan(100);
  });
});
