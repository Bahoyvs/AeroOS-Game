import { describe, expect, it } from 'vitest';
import * as econ from '../src/core/economy.js';
import * as overflow from '../src/core/overflow.js';
import { buffMultiplier } from '../src/core/buffs.js';
import { createGame } from '../src/core/game.js';
import { createMemoryStorage } from '../src/core/save.js';
import { createInitialState, resetForPrestige } from '../src/core/state.js';
import { OVERFLOW } from '../src/data/balance.js';
import { ANCHOR_BUILDING_IDS, FEED_BUILDING_IDS } from '../src/data/buildings.js';

/**
 * The Buffer Overflow crisis (GDD v2 §7).
 *
 * The event is deliberately made of parts that already existed — a buff, the
 * bloat counter, one more factor in the multiplier chain — so most of what can
 * rot here is *wiring*: a penalty that lands twice, a tax that reaches the wrong
 * buildings, an escalation that fires on a single purchase. Those are what this
 * file is about. The presentation (static, balloons, the takeover) is verified
 * in a browser, like the rest of `ui/`.
 */

const fresh = () => createInitialState(0);

/** A machine whose shape gives the wanted ratio. */
const shaped = (feed, anchorUnits) => {
  const s = fresh();
  s.buildings.flashfarm.units = feed;
  s.buildings.aerochat.units = anchorUnits;
  return s;
};

/** Drive whole samples. `updateOverflow` only looks at the clock it is given. */
const sample = (state, times = 1, now = 0) => {
  let last = null;
  for (let i = 0; i < times; i += 1) {
    last = overflow.updateOverflow(state, OVERFLOW.sampleSeconds, now) ?? last;
  }
  return last;
};

describe('feedRatio (GDD §7.1)', () => {
  it('is feed units over the units the player started with', () => {
    expect(overflow.feedRatio(shaped(600, 100))).toBe(6);
    expect(overflow.feedRatio(shaped(0, 100))).toBe(0);
  });

  it('floors the denominator at one, so a machine with no anchors reads worst', () => {
    // Not a guard clause: the numerator *is* the right answer here, and it is
    // the largest number the ratio can produce for that shape.
    const s = fresh();
    s.buildings.thehive.units = 40;
    expect(overflow.feedRatio(s)).toBe(40);
  });

  it('counts every feed building and no others', () => {
    for (const id of FEED_BUILDING_IDS) {
      const s = fresh();
      s.buildings[id].units = 10;
      expect(overflow.feedRatio(s)).toBe(10);
    }
    for (const id of ANCHOR_BUILDING_IDS) {
      const s = fresh();
      s.buildings[id].units = 10;
      expect(overflow.feedRatio(s)).toBe(0);
    }
  });

  it('leaves VidChat out of both halves', () => {
    /**
     * The regression this exists to stop: deriving the split from `phase >= 3`
     * instead of reading the hand-written lists. VidChat is a phase-3 building
     * the GDD deliberately keeps out of the feed — a stranger on a webcam is
     * still a person — and nothing in the numbers would show the difference.
     */
    const s = fresh();
    s.buildings.vidchat.units = 500;
    expect(overflow.feedRatio(s)).toBe(0);
    expect(FEED_BUILDING_IDS).not.toContain('vidchat');
    expect(ANCHOR_BUILDING_IDS).not.toContain('vidchat');
  });
});

describe('phase thresholds', () => {
  it('steps exactly on each declared ratio', () => {
    for (const { at, phase } of OVERFLOW.phases) {
      expect(overflow.phaseForRatio(at)).toBe(phase);
      expect(overflow.phaseForRatio(at - 0.0001)).toBeLessThan(phase);
    }
  });

  it('is zero on a machine that has not built a feed yet', () => {
    expect(overflow.phaseForRatio(0)).toBe(0);
  });
});

describe('escalation', () => {
  it('needs the ratio to hold, so one bulk buy cannot start a crisis', () => {
    const s = shaped(600, 100);
    for (let i = 1; i < OVERFLOW.dwellSamples; i += 1) {
      expect(sample(s)).toBeNull();
      expect(s.event.overflowPhase).toBe(0);
    }
    const shift = sample(s);
    expect(shift).toMatchObject({ from: 0, to: 3 });
  });

  it('does not sample between the sample intervals', () => {
    const s = shaped(600, 100);
    // A whole dwell window's worth of ticks, delivered as frames rather than
    // samples: not enough time has passed for a single reading.
    for (let i = 0; i < 200; i += 1) overflow.updateOverflow(s, 0.1, 0);
    expect(s.event.feedRatioHistory.length).toBeLessThan(OVERFLOW.dwellSamples);
    expect(s.event.overflowPhase).toBe(0);
  });

  it('de-escalates on the first sample that disagrees', () => {
    // Backfilling the early apps is the documented remedy, and a remedy that
    // takes a minute to be believed does not read as one.
    const s = shaped(600, 100);
    sample(s, OVERFLOW.dwellSamples);
    expect(s.event.overflowPhase).toBe(3);

    s.buildings.aerochat.units = 100_000;
    expect(sample(s)).toMatchObject({ from: 3, to: 0 });
  });

  it('arms the takeover once per crossing, and clears it on the way down', () => {
    const s = shaped(600, 100);
    sample(s, OVERFLOW.dwellSamples);
    expect(overflow.crisisPending(s)).toBe(true);

    s.event.crisisPending = false;
    expect(sample(s)).toBeNull(); // still phase 3, nothing re-arms it
    expect(overflow.crisisPending(s)).toBe(false);

    s.buildings.aerochat.units = 100_000;
    sample(s);
    expect(overflow.crisisPending(s)).toBe(false);
  });

  it('drops the ghosts when it drops below the phase that spawns them', () => {
    const s = shaped(600, 100);
    sample(s, OVERFLOW.dwellSamples);
    s.event.ghostNotifications = [{ id: 1, seed: 0, expiresAt: 1e12 }];

    s.buildings.aerochat.units = 100_000;
    sample(s);
    expect(s.event.ghostNotifications).toHaveLength(0);
  });
});

describe('ghost notifications', () => {
  const noisy = () => {
    const s = shaped(600, 100);
    sample(s, OVERFLOW.dwellSamples);
    return s;
  };

  it('does not spawn below phase 2', () => {
    const s = shaped(0, 100);
    const result = overflow.updateGhosts(s, 999, () => 0.5, 0);
    expect(result.spawned).toBeNull();
  });

  it('spawns on simulation time, so a closed tab accrues none', () => {
    const s = noisy();
    expect(overflow.updateGhosts(s, 0.1, () => 0.5, 0).spawned).toBeNull();
    expect(overflow.updateGhosts(s, 999, () => 0.5, 0).spawned).not.toBeNull();
  });

  it('expires on the wall clock, so a closed tab clears the ones that were live', () => {
    const s = noisy();
    overflow.updateGhosts(s, 999, () => 0.5, 0);
    expect(overflow.liveGhosts(s, 0)).toHaveLength(1);

    const later = OVERFLOW.ghost.lifetimeSeconds * 1000 + 1;
    expect(overflow.liveGhosts(s, later)).toHaveLength(0);
    expect(overflow.overflowPenalty(s, later)).toBe(1);
  });

  it('never stacks more than the cap', () => {
    const s = noisy();
    for (let i = 0; i < 50; i += 1) overflow.updateGhosts(s, 999, () => 0.5, 0);
    expect(s.event.ghostNotifications.length).toBe(OVERFLOW.ghost.maxLive);
  });

  it('costs production through the global chain, once', () => {
    /**
     * The wiring that matters: the penalty is a factor in `globalMultiplier`,
     * so every window reports it through `getProductionBreakdown` and no window
     * subtracts it a second time.
     */
    const s = noisy();
    s.buildings.aerochat.units = 10;
    const before = econ.globalMultiplier(s, 0);

    s.event.ghostNotifications = [
      { id: 1, seed: 0, expiresAt: 1e12 },
      { id: 2, seed: 1, expiresAt: 1e12 },
    ];
    const after = econ.globalMultiplier(s, 0);
    expect(after / before).toBeCloseTo((1 - OVERFLOW.ghost.penaltyEach) ** 2, 12);

    const bd = econ.getProductionBreakdown(s, 'aerochat', 0);
    expect(bd.base * bd.milestoneMultiplier * bd.feedTax * bd.globalMultiplier).toBeCloseTo(
      bd.total,
      9,
    );
  });

  it('derives its copy from the stored seed', () => {
    // Two numbers in the save, a whole notification out of it — the same
    // derived-not-stored rule buddies and files use.
    const s = noisy();
    overflow.updateGhosts(s, 999, () => 0.5, 0);
    const [ghost] = s.event.ghostNotifications;
    expect(Object.keys(ghost).sort()).toEqual(['expiresAt', 'id', 'seed']);
    expect(overflow.ghostAt(ghost.seed)).toMatchObject({ title: expect.any(String) });
  });
});

describe('the question', () => {
  const inCrisis = () => {
    const s = shaped(600, 100);
    sample(s, OVERFLOW.dwellSamples);
    s.event.ghostNotifications = [{ id: 1, seed: 0, expiresAt: 1e12 }];
    return s;
  };

  it('Log Off costs half of two minutes and buys quiet', () => {
    const s = inCrisis();
    const result = overflow.resolveOverflow(s, 'logoff', 1000);

    expect(result.choice).toBe('logoff');
    expect(buffMultiplier(s, 'global', 1000)).toBeCloseTo(1 + OVERFLOW.logOff.magnitude, 12);
    expect(s.event.ghostNotifications).toHaveLength(0);
    expect(s.event.overflowPhase).toBeLessThanOrEqual(OVERFLOW.logOff.calmPhase);
    expect(s.event.calmUntil).toBe(1000 + OVERFLOW.logOff.calmSeconds * 1000);
    expect(s.bloat).toBe(0);
  });

  it('and the quiet is real — the crisis cannot re-fire during it', () => {
    /**
     * Both halves are needed. The calm ceiling alone would let the *history*
     * carry four crisis-level samples across it, so the first tick after the
     * calm expired would re-fire instantly and the player would have bought a
     * delay rather than a reprieve.
     */
    const s = inCrisis();
    overflow.resolveOverflow(s, 'logoff', 1000);
    expect(s.event.feedRatioHistory).toHaveLength(0);

    sample(s, OVERFLOW.dwellSamples * 2, 2000);
    expect(s.event.overflowPhase).toBeLessThanOrEqual(OVERFLOW.logOff.calmPhase);
    expect(overflow.crisisPending(s)).toBe(false);
  });

  it('Doomscroll pays triple and leaves the bloat behind', () => {
    const s = inCrisis();
    const result = overflow.resolveOverflow(s, 'doomscroll', 1000);

    expect(buffMultiplier(s, 'global', 1000)).toBeCloseTo(1 + OVERFLOW.doomscroll.magnitude, 12);
    expect(s.bloat).toBeCloseTo(OVERFLOW.doomscroll.bloat, 12);
    expect(result.bloat).toBe(OVERFLOW.doomscroll.bloat);
    // The phase does not move, and the ghosts are not cleared: nothing was
    // fixed, it was agreed to.
    expect(s.event.overflowPhase).toBe(3);
    expect(s.event.ghostNotifications).toHaveLength(1);
  });

  it('and the machine asks again when it wears off', () => {
    const s = inCrisis();
    overflow.resolveOverflow(s, 'doomscroll', 1000);
    const wearsOff = 1000 + OVERFLOW.doomscroll.durationSeconds * 1000;

    expect(overflow.updateCrisis(s, wearsOff - 1)).toBe(false);
    expect(overflow.updateCrisis(s, wearsOff)).toBe(true);
    expect(overflow.crisisPending(s)).toBe(true);
    // Once. A second call must not re-announce a question already on screen.
    expect(overflow.updateCrisis(s, wearsOff + 1)).toBe(false);
  });

  it('stacks its cost — three of them is a machine you have to format', () => {
    const s = inCrisis();
    for (let i = 0; i < 3; i += 1) {
      s.event.crisisPending = true;
      overflow.resolveOverflow(s, 'doomscroll', 1000 + i);
    }
    expect(s.bloat).toBeCloseTo(OVERFLOW.doomscroll.bloat * 3, 12);
  });

  it('refuses an answer it does not have', () => {
    expect(overflow.resolveOverflow(inCrisis(), 'ignore', 0)).toBeNull();
  });

  it('counts both answers, and the count outlives a Format C:', () => {
    const s = inCrisis();
    overflow.resolveOverflow(s, 'logoff', 1000);
    overflow.resolveOverflow(s, 'doomscroll', 2000);
    expect(s.event.overflowsResolved).toBe(2);

    // The counter cosmetics hang off has to be monotonic, or an unlock could be
    // revoked by a wipe (see the note in data/cosmetics.js).
    const after = resetForPrestige(s, 0, 3000);
    expect(after.event.overflowsResolved).toBe(2);
    expect(after.event.overflowPhase).toBe(0);
    expect(after.event.feedRatioHistory).toHaveLength(0);
  });
});

describe('Airplane Mode (GDD §7.3)', () => {
  it('caps the event at its cosmetic phase, whatever the ratio', () => {
    const s = shaped(6000, 100);
    s.event.airplaneModeOwned = true;
    sample(s, OVERFLOW.dwellSamples);
    expect(s.event.overflowPhase).toBe(OVERFLOW.airplane.capPhase);
    expect(overflow.crisisPending(s)).toBe(false);
  });

  it('taxes the five feed buildings and nothing else', () => {
    const s = fresh();
    s.event.airplaneModeOwned = true;
    for (const id of FEED_BUILDING_IDS) {
      expect(econ.feedTax(s, id)).toBeCloseTo(1 - OVERFLOW.airplane.feedTax, 12);
    }
    for (const id of ANCHOR_BUILDING_IDS) expect(econ.feedTax(s, id)).toBe(1);
    expect(econ.feedTax(s, 'vidchat')).toBe(1);
  });

  it('is free until it is bought', () => {
    const s = fresh();
    for (const id of FEED_BUILDING_IDS) expect(econ.feedTax(s, id)).toBe(1);
  });

  it('the tax reaches the total and the breakdown identically', () => {
    // The reason `feedTax` lives inside `buildingProduction`: if the total and
    // the window disagreed about it, the twelve windows' shares would stop
    // summing to one and nobody would know which number was lying.
    const s = fresh();
    s.buildings.thehive.units = 10;
    const before = econ.totalBuildingProduction(s);

    s.event.airplaneModeOwned = true;
    expect(econ.totalBuildingProduction(s)).toBeCloseTo(
      before * (1 - OVERFLOW.airplane.feedTax),
      9,
    );
    const bd = econ.getProductionBreakdown(s, 'thehive', 0);
    expect(bd.base * bd.milestoneMultiplier * bd.feedTax * bd.globalMultiplier).toBeCloseTo(
      bd.total,
      9,
    );
  });

  it('is bought with Dollars, and survives the wipe like every other utility', () => {
    const game = createGame({ storage: createMemoryStorage(), now: 0, rng: () => 0.5 });
    expect(game.buyAirplaneMode()).toMatchObject({ ok: false, reason: 'too-expensive' });

    game.state.dollars = OVERFLOW.airplane.cost;
    expect(game.buyAirplaneMode()).toMatchObject({ ok: true, cost: OVERFLOW.airplane.cost });
    expect(game.state.dollars).toBe(0);
    expect(game.state.dollarsSpentTotal).toBe(OVERFLOW.airplane.cost);
    expect(game.buyAirplaneMode()).toMatchObject({ ok: false, reason: 'already-owned' });

    expect(resetForPrestige(game.state, 0, 1).event.airplaneModeOwned).toBe(true);
  });
});

describe('the game actions', () => {
  const newGame = () => createGame({ storage: createMemoryStorage(), now: 0, rng: () => 0.5 });

  it('pays a burst for silencing a ghost, and only once', () => {
    const game = newGame();
    game.state.runBuzz = Number.MAX_SAFE_INTEGER;
    game.state.buzz = 1e9;
    game.buyUnits('aerochat', 20);
    game.state.event.ghostNotifications = [{ id: 7, seed: 0, expiresAt: Date.now() + 60_000 }];

    const before = game.state.buzz;
    const result = game.silenceGhost(7);
    expect(result.ok).toBe(true);
    expect(result.buzz).toBeGreaterThan(0);
    expect(game.state.buzz - before).toBeCloseTo(result.buzz, 6);

    expect(game.silenceGhost(7)).toMatchObject({ ok: false, reason: 'gone' });
  });

  it('announces the crisis exactly once when the tick crosses into it', () => {
    const game = newGame();
    game.state.runBuzz = Number.MAX_SAFE_INTEGER;
    game.state.buildings.flashfarm.units = 600;
    game.state.buildings.aerochat.units = 100;

    const seen = [];
    game.bus.on(game.events.OVERFLOW_CRISIS, (payload) => seen.push(payload));
    for (let i = 0; i < OVERFLOW.dwellSamples + 4; i += 1) game.tick(OVERFLOW.sampleSeconds);

    expect(seen).toHaveLength(1);
    expect(seen[0].ratio).toBe(6);
  });

  it('refuses an answer the crisis does not offer', () => {
    expect(newGame().answerOverflow('panic')).toMatchObject({ ok: false });
  });
});
