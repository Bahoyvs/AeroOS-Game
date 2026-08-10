import { describe, expect, it } from 'vitest';
import {
  claimSecondsLeft,
  claimStatusEvent,
  getBonus,
  rollBonus,
  rollInterval,
  updateStatusEvents,
} from '../src/core/statusEvents.js';
import { buffMultiplier } from '../src/core/buffs.js';
import { createInitialState } from '../src/core/state.js';
import { STATUS_BONUSES, STATUS_EVENT } from '../src/data/balance.js';

/** A state with AeroChat open and buddies online — the spawn preconditions. */
function chatting(bots = 10) {
  const s = createInitialState(0);
  s.apps.aerochat.open = true;
  s.buildings.aerochat.units = bots;
  return s;
}

/** Deterministic rng cycling through fixed values. */
const seq = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe('rolling bonuses', () => {
  it('picks the first entry at the bottom of the range', () => {
    expect(rollBonus(() => 0).id).toBe(STATUS_BONUSES[0].id);
  });

  it('picks the last entry at the top of the range', () => {
    expect(rollBonus(() => 0.999999).id).toBe(STATUS_BONUSES.at(-1).id);
  });

  it('always returns a bonus from the table', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(STATUS_BONUSES).toContain(rollBonus(Math.random));
    }
  });

  it('schedules inside the tuned interval', () => {
    expect(rollInterval(() => 0)).toBe(STATUS_EVENT.minIntervalSeconds);
    expect(rollInterval(() => 1)).toBe(STATUS_EVENT.maxIntervalSeconds);
  });
});

/** Advance simulation time until an event is pending, with a hard bound. */
function advanceToEvent(state, rng, maxSeconds = 500) {
  for (let i = 0; i < maxSeconds && !state.chat.event; i += 1) {
    updateStatusEvents(state, 1, rng);
  }
  return state.chat.event;
}

describe('spawning', () => {
  it('does not spawn while AeroChat is closed', () => {
    const s = chatting();
    s.apps.aerochat.open = false;
    expect(advanceToEvent(s, () => 0)).toBeNull();
  });

  it('does not spawn without buddies', () => {
    expect(advanceToEvent(chatting(0), () => 0)).toBeNull();
  });

  it('rolls an interval on the first tick, then spawns when it elapses', () => {
    const s = chatting();
    updateStatusEvents(s, 1, () => 0);
    expect(s.chat.nextEventIn).toBe(STATUS_EVENT.minIntervalSeconds);
    expect(s.chat.event).toBeNull();

    const { spawned } = updateStatusEvents(s, STATUS_EVENT.minIntervalSeconds, () => 0);
    expect(spawned).not.toBeNull();
    expect(s.chat.event.bonusId).toBe(STATUS_BONUSES[0].id);
    expect(s.chat.event.secondsLeft).toBe(STATUS_EVENT.claimWindowSeconds);
  });

  it('does not spawn early', () => {
    const s = chatting();
    updateStatusEvents(s, 1, () => 0);
    updateStatusEvents(s, STATUS_EVENT.minIntervalSeconds - 1, () => 0);
    expect(s.chat.event).toBeNull();
  });

  it('targets a buddy that exists', () => {
    const s = chatting(7);
    advanceToEvent(s, () => 0.99);
    expect(s.chat.event.index).toBeGreaterThanOrEqual(0);
    expect(s.chat.event.index).toBeLessThan(7);
  });

  it('does not spawn a second event while one is pending', () => {
    const s = chatting();
    const pending = advanceToEvent(s, () => 0);
    updateStatusEvents(s, 1, () => 0);
    expect(s.chat.event).toBe(pending);
  });

  it('retires a pending event when AeroChat is closed, without counting a miss', () => {
    const s = chatting();
    advanceToEvent(s, () => 0);
    expect(s.chat.event).not.toBeNull();

    s.apps.aerochat.open = false;
    updateStatusEvents(s, 1, () => 0);
    expect(s.chat.event).toBeNull();
    expect(s.stats.bonusesMissed).toBe(0);
  });
});

describe('expiry', () => {
  it('counts an unclaimed event as missed and reschedules', () => {
    const s = chatting();
    advanceToEvent(s, () => 0);

    const { missed } = updateStatusEvents(s, STATUS_EVENT.claimWindowSeconds, () => 0);
    expect(missed).not.toBeNull();
    expect(s.stats.bonusesMissed).toBe(1);
    expect(s.chat.event).toBeNull();
    expect(s.chat.nextEventIn).toBeGreaterThan(0);
  });

  it('reports the remaining claim window', () => {
    const s = chatting();
    advanceToEvent(s, () => 0);
    expect(claimSecondsLeft(s)).toBe(STATUS_EVENT.claimWindowSeconds);

    updateStatusEvents(s, 5, () => 0);
    expect(claimSecondsLeft(s)).toBeCloseTo(STATUS_EVENT.claimWindowSeconds - 5);
  });

  it('reports zero with no event pending', () => {
    expect(claimSecondsLeft(chatting())).toBe(0);
  });
});

describe('claiming', () => {
  const spawn = (rng) => {
    const s = chatting();
    advanceToEvent(s, rng);
    return s;
  };

  it('refuses when there is no event', () => {
    expect(claimStatusEvent(chatting(), 0).reason).toBe('no-event');
  });

  it('refuses an expired event and clears it', () => {
    const s = spawn(() => 0);
    s.chat.event.secondsLeft = 0;
    expect(claimStatusEvent(s, 0).reason).toBe('expired');
    expect(s.chat.event).toBeNull();
  });

  it('applies a timed buff and clears the event', () => {
    const s = spawn(() => 0); // first table entry: a 'chat' buff
    const result = claimStatusEvent(s, 0, () => 0);

    expect(result.ok).toBe(true);
    expect(result.bonus.kind).toBe('chat');
    expect(s.chat.event).toBeNull();
    expect(s.stats.bonusesClaimed).toBe(1);
    expect(buffMultiplier(s, 'chat', 0)).toBeCloseTo(1 + result.bonus.magnitude);
  });

  it('does not add a buff for burst bonuses', () => {
    const s = chatting();
    const burst = STATUS_BONUSES.find((b) => b.kind === 'burst');
    s.chat.event = { index: 0, bonusId: burst.id, secondsLeft: 10 };

    const result = claimStatusEvent(s, 0, () => 0);
    expect(result.bonus.kind).toBe('burst');
    expect(s.buffs).toHaveLength(0);
  });

  it('schedules the next event after a claim', () => {
    const s = spawn(() => 0);
    claimStatusEvent(s, 0, () => 0);
    expect(s.chat.nextEventIn).toBe(STATUS_EVENT.minIntervalSeconds);
  });

  it('cannot be claimed twice', () => {
    const s = spawn(seq(0, 0.5));
    expect(claimStatusEvent(s, 0, () => 0).ok).toBe(true);
    expect(claimStatusEvent(s, 0, () => 0).ok).toBe(false);
    expect(s.stats.bonusesClaimed).toBe(1);
  });
});

describe('bonus table', () => {
  it('exposes every bonus by id', () => {
    for (const bonus of STATUS_BONUSES) expect(getBonus(bonus.id)).toBe(bonus);
    expect(getBonus('nope')).toBeNull();
  });

  it('only uses known buff kinds', () => {
    for (const bonus of STATUS_BONUSES) {
      expect(['chat', 'global', 'click', 'burst']).toContain(bonus.kind);
    }
  });
});
