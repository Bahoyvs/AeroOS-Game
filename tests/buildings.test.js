import { describe, expect, it } from 'vitest';
import * as econ from '../src/core/economy.js';
import { createGame } from '../src/core/game.js';
import { createMemoryStorage } from '../src/core/save.js';
import { createInitialState } from '../src/core/state.js';
import { BUILDING } from '../src/data/balance.js';
import { BUILDINGS, getBuilding } from '../src/data/buildings.js';

/**
 * The building layer (GDD v2 §1-2). The tests the redesign explicitly asks for
 * in §13 live here: monotonicity, the milestone steps, and the negative test
 * that keeps AeroSweeper out of the production formula.
 */

const fresh = () => createInitialState(0);

const withUnits = (id, units) => {
  const s = fresh();
  s.buildings[id].units = units;
  // Unlocks are gated on run Buzz, and every test below is about a building the
  // player already owns units of.
  s.runBuzz = Number.MAX_SAFE_INTEGER;
  return s;
};

describe('the roster', () => {
  it('declares twelve buildings with unique ids', () => {
    expect(BUILDINGS).toHaveLength(12);
    expect(new Set(BUILDINGS.map((b) => b.id)).size).toBe(12);
  });

  it('costs and pays more the further down the list you go', () => {
    for (let i = 1; i < BUILDINGS.length; i += 1) {
      expect(BUILDINGS[i].baseCost).toBeGreaterThan(BUILDINGS[i - 1].baseCost);
      expect(BUILDINGS[i].baseProduction).toBeGreaterThan(BUILDINGS[i - 1].baseProduction);
      expect(BUILDINGS[i].unlockAt).toBeGreaterThan(BUILDINGS[i - 1].unlockAt);
    }
  });

  it('prices every rung above what it pays, so nothing is an instant upgrade', () => {
    // Cost climbs 12x per rung and production 10x, so the cost of a unit
    // measured in seconds of its own output rises down the list. Without this
    // the newest building would always be the only correct purchase.
    const paybackSeconds = (b) => b.baseCost / b.baseProduction;
    for (let i = 1; i < BUILDINGS.length; i += 1) {
      expect(paybackSeconds(BUILDINGS[i])).toBeGreaterThan(paybackSeconds(BUILDINGS[i - 1]));
    }
  });
});

describe('unit pricing', () => {
  it('grows geometrically from each building’s own base', () => {
    for (const building of BUILDINGS) {
      expect(econ.unitCost(building.id, 0)).toBe(building.baseCost);
      expect(econ.unitCost(building.id, 1)).toBe(
        Math.ceil(building.baseCost * BUILDING.costGrowth),
      );
    }
  });

  it('bulk price is the sum of the units it buys', () => {
    const each = [0, 1, 2, 3].map((n) => econ.unitCost('chainmail', n));
    expect(econ.unitCostBulk('chainmail', 0, 4)).toBe(each.reduce((a, b) => a + b, 0));
  });

  it('never sells more than the player can pay for', () => {
    const s = fresh();
    s.buzz = 1000;
    const { count, cost } = econ.affordableUnits(s, 'aerochat', 100);
    expect(cost).toBeLessThanOrEqual(1000);
    expect(econ.unitCostBulk('aerochat', 0, count + 1)).toBeGreaterThan(1000);
  });

  it('stops at the unit rail even with unlimited Buzz', () => {
    const s = withUnits('aerochat', BUILDING.maxUnits);
    s.buzz = Infinity;
    expect(econ.affordableUnits(s, 'aerochat', 10).count).toBe(0);
  });
});

describe('milestones', () => {
  it('steps exactly on each declared threshold', () => {
    for (const { at, multiplier } of BUILDING.milestones) {
      expect(econ.milestoneMultiplier(at)).toBe(multiplier);
      if (at > 0) expect(econ.milestoneMultiplier(at - 1)).toBeLessThan(multiplier);
    }
  });

  it('holds flat between thresholds', () => {
    const [, second, third] = BUILDING.milestones;
    for (let units = second.at; units < third.at; units += 1) {
      expect(econ.milestoneMultiplier(units)).toBe(second.multiplier);
    }
  });

  it('uses the same table for all twelve', () => {
    const units = BUILDING.milestones[3].at;
    const multipliers = BUILDINGS.map(
      (b) => econ.buildingProduction(withUnits(b.id, units), b.id) / (units * b.baseProduction),
    );
    expect(new Set(multipliers.map((m) => m.toFixed(6))).size).toBe(1);
  });

  it('reports the next threshold, and nothing at the top tier', () => {
    const next = econ.nextMilestone(BUILDING.milestones[1].at + 5);
    expect(next.at).toBe(BUILDING.milestones[2].at);
    expect(next.remaining).toBe(BUILDING.milestones[2].at - BUILDING.milestones[1].at - 5);
    expect(next.ratio).toBeGreaterThan(0);
    expect(econ.nextMilestone(BUILDING.milestones.at(-1).at)).toBeNull();
  });
});

describe('production monotonicity', () => {
  /**
   * The guard against the bug this redesign was audited for: a building whose
   * units were bought and quietly did nothing. Every building, every step from
   * zero past the last milestone, must produce strictly more than the step
   * before it.
   */
  it('is strictly increasing in units, for every building', () => {
    for (const building of BUILDINGS) {
      let previous = -1;
      for (const units of [0, 1, 2, 24, 25, 49, 50, 99, 100, 249, 250, 499, 500, 900]) {
        const rate = econ.buildingProduction(withUnits(building.id, units), building.id);
        expect(rate).toBeGreaterThan(previous);
        previous = rate;
      }
    }
  });

  it('never lets one building’s units change another’s output', () => {
    const s = withUnits('aerochat', 300);
    const before = econ.buildingProduction(s, 'chainmail');
    s.buildings.chainmail.units = 10;
    s.buildings.aerochat.units = 600;
    expect(econ.buildingProduction(s, 'chainmail')).toBe(
      10 * getBuilding('chainmail').baseProduction,
    );
    expect(before).toBe(0);
  });

  it('totals to the sum of the twelve', () => {
    const s = fresh();
    s.buildings.aerochat.units = 30;
    s.buildings.chainmail.units = 7;
    s.buildings.thehive.units = 1;
    const parts = BUILDINGS.reduce((sum, b) => sum + econ.buildingProduction(s, b.id), 0);
    expect(econ.totalBuildingProduction(s)).toBeCloseTo(parts, 6);
  });
});

describe('unlocks', () => {
  it('opens on run Buzz, and closes again after a Format C:', () => {
    const s = fresh();
    expect(econ.isBuildingUnlocked(s, 'aerochat')).toBe(true);
    expect(econ.isBuildingUnlocked(s, 'chainmail')).toBe(false);

    s.runBuzz = getBuilding('chainmail').unlockAt;
    expect(econ.isBuildingUnlocked(s, 'chainmail')).toBe(true);

    s.runBuzz = 0;
    expect(econ.isBuildingUnlocked(s, 'chainmail')).toBe(false);
  });

  it('names the next one to appear', () => {
    const s = fresh();
    expect(econ.nextUnlock(s).id).toBe('retroamp');
    s.runBuzz = Number.MAX_SAFE_INTEGER;
    expect(econ.nextUnlock(s)).toBeNull();
  });
});

describe('buying units', () => {
  const newGame = () => {
    const game = createGame({ storage: createMemoryStorage(), now: 0, rng: () => 0.5 });
    game.state.runBuzz = Number.MAX_SAFE_INTEGER;
    // Comfortably more than any purchase below, and small enough that a double
    // still resolves single Buzz — at 1e18 the ULP is over a hundred and an
    // exact-price assertion would be testing the float, not the price.
    game.state.buzz = 1e12;
    return game;
  };

  it('charges exactly what the price says', () => {
    const game = newGame();
    const expected = econ.unitCostBulk('chainmail', 0, 5);
    const before = game.state.buzz;
    expect(game.buyUnits('chainmail', 5)).toMatchObject({ ok: true, count: 5, units: 5 });
    expect(before - game.state.buzz).toBe(expected);
  });

  it('announces the milestone it crossed', () => {
    const game = newGame();
    const seen = [];
    game.bus.on(game.events.MILESTONE, (payload) => seen.push(payload));

    game.buyUnits('lemonwire', BUILDING.milestones[1].at - 1);
    expect(seen).toHaveLength(0);

    game.buyUnits('lemonwire', 1);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      id: 'lemonwire',
      at: BUILDING.milestones[1].at,
      multiplier: BUILDING.milestones[1].multiplier,
    });
  });

  it('announces each threshold once, not every purchase past it', () => {
    const game = newGame();
    game.buyUnits('lemonwire', BUILDING.milestones[1].at);
    const seen = [];
    game.bus.on(game.events.MILESTONE, (payload) => seen.push(payload));

    // Two buys inside the same tier, then one that crosses into the next.
    game.buyUnits('lemonwire', 5);
    game.buyUnits('lemonwire', 5);
    expect(seen).toHaveLength(0);

    game.buyUnits('lemonwire', BUILDING.milestones[2].at - BUILDING.milestones[1].at - 10);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ at: BUILDING.milestones[2].at });
  });

  it('is the only way units appear — a refused buy costs nothing', () => {
    const game = newGame();
    game.state.buzz = 0;
    const before = game.state.buzz;
    expect(game.buyUnits('geopage', 1).ok).toBe(false);
    expect(econ.unitsOf(game.state, 'geopage')).toBe(0);
    expect(game.state.buzz).toBe(before);
  });
});

describe('AeroSweeper isolation (GDD §13)', () => {
  it('is not on the building roster at all', () => {
    expect(BUILDINGS.some((b) => b.id === 'aerosweeper')).toBe(false);
  });

  it('does not move production, however well the player plays it', () => {
    const game = createGame({ storage: createMemoryStorage(), now: 0, rng: () => 0.9 });
    game.state.runBuzz = Number.MAX_SAFE_INTEGER;
    game.state.buzz = 1e9;
    game.buyUnits('aerochat', 40);

    const before = econ.totalBuildingProduction(game.state);
    game.state.buzz = 1e9;
    game.startSweeperRound();
    game.endSweeperRound(12, { cleared: true });

    // The round pays Buzz and a *click* buff. Neither is a building, so the
    // twelve produce exactly what they did before it was played.
    expect(econ.totalBuildingProduction(game.state)).toBe(before);
    expect(econ.unitsOf(game.state, 'aerochat')).toBe(40);
  });
});
