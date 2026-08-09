import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/core/state.js';
import * as b from '../src/core/buildings.js';
import { BUILDINGS, UNIT_COST_GROWTH, getBuilding } from '../src/data/buildings.js';
import { SYNERGY_PAIRS } from '../src/data/upgrades.js';
import { BREACH } from '../src/data/balance.js';

/** A state with enough Buzz and progress to buy anything. */
function rich() {
  const s = createInitialState(0);
  s.buzz = Number.MAX_SAFE_INTEGER / 4;
  s.runBuzz = 1e12;
  s.hardware.cpu = 6;
  return s;
}

function own(state, id, units) {
  const building = getBuilding(id);
  if (building.unitsFrom === 'chat.bots') state.chat.bots = units;
  else state.buildings[id].units = units;
}

describe('unit accounting', () => {
  it("reads AeroChat's units from chat.bots, not the buildings map", () => {
    const s = createInitialState(0);
    s.chat.bots = 7;
    expect(b.unitsOf(s, 'aerochat')).toBe(7);
    // The buildings map deliberately has no aerochat entry — one source of truth.
    expect(s.buildings.aerochat).toBeUndefined();
  });

  it('writes AeroChat purchases back to chat.bots', () => {
    const s = rich();
    b.buyUnits(s, 'aerochat', 5);
    expect(s.chat.bots).toBe(5);
    expect(b.unitsOf(s, 'aerochat')).toBe(5);
  });

  it('counts only buildings with at least one unit', () => {
    const s = createInitialState(0);
    expect(b.ownedBuildingCount(s)).toBe(0);
    own(s, 'aerochat', 1);
    own(s, 'retroamp', 3);
    expect(b.ownedBuildingCount(s)).toBe(2);
  });
});

describe('the price curve', () => {
  it('uses one growth factor for every building (patch §2.1)', () => {
    for (const building of BUILDINGS) {
      const first = b.unitCost(building.id, 0);
      const second = b.unitCost(building.id, 1);
      expect(first).toBe(Math.ceil(building.baseCost));
      expect(second).toBe(Math.ceil(building.baseCost * UNIT_COST_GROWTH));
    }
  });

  it('bulk pricing is the sum of the individual units', () => {
    const manual = b.unitCost('retroamp', 0) + b.unitCost('retroamp', 1) + b.unitCost('retroamp', 2);
    expect(b.unitCostBulk('retroamp', 0, 3)).toBe(manual);
  });

  it('prices a runaway bulk purchase out of existence on its own', () => {
    // The economic guard is the exponent, not a rail: the 300th unit alone
    // costs astronomically more than the first, so "buy 500" can never be
    // affordable at the moment it would matter (patch §2.2).
    const s = createInitialState(0);
    s.buzz = 1e12;
    s.runBuzz = 1e12;
    const { count } = b.affordableUnits(s, 'aerochat', 500);
    expect(count).toBeLessThan(500);
  });

  it('never sells past maxPerRun', () => {
    const s = rich();
    own(s, 'aerochat', getBuilding('aerochat').maxPerRun);
    expect(b.canBuyUnits(s, 'aerochat', 1)).toMatchObject({ ok: false, reason: 'maxed' });
  });
});

describe('unlock gating', () => {
  it('hides a building until the run has produced enough Buzz', () => {
    const s = createInitialState(0);
    s.runBuzz = 0;
    expect(b.isBuildingUnlocked(s, 'lemonwire')).toBe(false);
    s.runBuzz = getBuilding('lemonwire').unlockAt;
    expect(b.isBuildingUnlocked(s, 'lemonwire')).toBe(true);
  });

  // v2 §9: the IoT Botnet double-condition test.
  it('locks IoT Botnet behind BOTH run Buzz and the CPU tier', () => {
    const s = createInitialState(0);
    const need = getBuilding('iotbotnet');

    s.runBuzz = need.unlockAt;
    s.hardware.cpu = 0;
    expect(b.isBuildingUnlocked(s, 'iotbotnet')).toBe(false);
    expect(b.lockReason(s, 'iotbotnet')).toMatchObject({ reason: 'cpu-tier' });

    s.runBuzz = 0;
    s.hardware.cpu = need.requiresCpuTier;
    expect(b.isBuildingUnlocked(s, 'iotbotnet')).toBe(false);
    expect(b.lockReason(s, 'iotbotnet')).toMatchObject({ reason: 'run-buzz' });

    s.runBuzz = need.unlockAt;
    expect(b.isBuildingUnlocked(s, 'iotbotnet')).toBe(true);
    expect(b.lockReason(s, 'iotbotnet')).toBeNull();
  });

  it('refuses to sell units of a locked building', () => {
    const s = rich();
    s.runBuzz = 0;
    expect(b.canBuyUnits(s, 'cloudmainframe', 1)).toMatchObject({ ok: false, reason: 'locked' });
  });
});

describe('production', () => {
  it('pays units × baseRate before any upgrades', () => {
    const s = createInitialState(0);
    own(s, 'retroamp', 4);
    expect(b.buildingProduction(s, 'retroamp', 0)).toBeCloseTo(4 * getBuilding('retroamp').baseRate);
  });

  it('does not depend on the window being open (patch §1.1)', () => {
    const s = createInitialState(0);
    own(s, 'retroamp', 4);
    const closed = b.buildingProduction(s, 'retroamp', 0);
    s.apps.retroamp.open = true;
    expect(b.buildingProduction(s, 'retroamp', 0)).toBeCloseTo(closed);
  });

  it('doubles per tiered upgrade owned', () => {
    const s = createInitialState(0);
    own(s, 'retroamp', 10);
    const plain = b.buildingProduction(s, 'retroamp', 0);
    s.upgrades.owned['retroamp.t1'] = true;
    expect(b.buildingProduction(s, 'retroamp', 0)).toBeCloseTo(plain * 2);
    s.upgrades.owned['retroamp.t2'] = true;
    expect(b.buildingProduction(s, 'retroamp', 0)).toBeCloseTo(plain * 4);
  });

  it('keeps AeroChat buddy milestones working after the v2 rewrite', () => {
    const s = createInitialState(0);
    own(s, 'aerochat', 25);
    // 25 buddies is exactly one milestone: +8%.
    expect(b.chatMilestoneCount(s)).toBe(1);
    expect(b.buildingProduction(s, 'aerochat', 0)).toBeCloseTo(25 * 0.5 * 1.08);
  });

  it('pays the cross-building bonus per N buddies, once bought', () => {
    const s = createInitialState(0);
    own(s, 'aerochat', 100);
    own(s, 'retroamp', 10);
    const before = b.buildingProduction(s, 'retroamp', 0);

    s.upgrades.owned['retroamp.buddies'] = true;
    // 100 buddies / 10 per chunk × 2% = +20%.
    expect(b.crossBonus(s, 'retroamp')).toBeCloseTo(0.2);
    expect(b.buildingProduction(s, 'retroamp', 0)).toBeCloseTo(before * 1.2);
  });

  it("applies AeroChat's flat per-building bonus (the Cursor exception)", () => {
    const s = createInitialState(0);
    own(s, 'aerochat', 10);
    own(s, 'retroamp', 1);
    own(s, 'lemonwire', 1);
    // Three distinct buildings owned × 5 flat Buzz/sec.
    s.upgrades.owned['aerochat.t4'] = true;
    expect(b.flatPerBuildingBonus(s, 'aerochat')).toBeCloseTo(15);
  });
});

// v2 §9: the synergy symmetry test.
describe('synergy pairs', () => {
  it.each(SYNERGY_PAIRS)('$id pays both directions', (pair) => {
    const s = createInitialState(0);
    own(s, pair.major, 20);
    own(s, pair.minor, 20);

    const majorBefore = b.buildingProduction(s, pair.major, 0);
    const minorBefore = b.buildingProduction(s, pair.minor, 0);

    s.upgrades.owned[pair.id] = true;

    expect(b.buildingProduction(s, pair.major, 0)).toBeGreaterThan(majorBefore);
    expect(b.buildingProduction(s, pair.minor, 0)).toBeGreaterThan(minorBefore);
  });

  it('pays the major partner more per unit than the minor one', () => {
    const pair = SYNERGY_PAIRS[0];
    const s = createInitialState(0);
    own(s, pair.major, 20);
    own(s, pair.minor, 20);
    s.upgrades.owned[pair.id] = true;

    const major = b.synergyBonuses(s, pair.major)[0].amount;
    const minor = b.synergyBonuses(s, pair.minor)[0].amount;
    expect(major).toBeGreaterThan(minor);
  });

  it('pays nothing until the pair is bought', () => {
    const pair = SYNERGY_PAIRS[0];
    const s = createInitialState(0);
    own(s, pair.major, 20);
    own(s, pair.minor, 20);
    expect(b.synergyBonuses(s, pair.major)).toEqual([]);
  });

  it('names the partners a purchase just helped', () => {
    const pair = SYNERGY_PAIRS[0];
    const s = createInitialState(0);
    s.upgrades.owned[pair.id] = true;
    expect(b.synergyPartnersOf(s, pair.major)).toContain(pair.minor);
    expect(b.synergyPartnersOf(s, pair.minor)).toContain(pair.major);
  });
});

describe('the production breakdown (patch §4.1)', () => {
  it('multiplies back out to the same number production reports', () => {
    const s = createInitialState(0);
    own(s, 'aerochat', 60);
    own(s, 'lemonwire', 30);
    own(s, 'shield99', 30);
    s.upgrades.owned['lemonwire.t1'] = true;
    s.upgrades.owned['lemonwire.buddies'] = true;
    s.upgrades.owned['lemonwire+shield99'] = true;

    const bd = b.productionBreakdown(s, 'lemonwire', { globalMultiplier: 1, now: 0 });
    expect(bd.beforeGlobal).toBeCloseTo(b.buildingProduction(s, 'lemonwire', 0));
  });

  it('itemises every source so nothing multiplies invisibly', () => {
    const s = createInitialState(0);
    own(s, 'aerochat', 100);
    own(s, 'lemonwire', 30);
    own(s, 'shield99', 30);
    s.upgrades.owned['lemonwire.buddies'] = true;
    s.upgrades.owned['lemonwire+shield99'] = true;

    const bd = b.productionBreakdown(s, 'lemonwire', { now: 0 });
    expect(bd.crossBuildingBonus).toMatchObject({ source: 'aerochat' });
    expect(bd.synergyBonus[0]).toMatchObject({ source: 'shield99' });
    expect(bd.units).toBe(30);
  });
});

describe('the Incognito tax (GDD §C.5)', () => {
  it('taxes only the risky buildings', () => {
    const s = createInitialState(0);
    own(s, 'lemonwire', 10);
    own(s, 'retroamp', 10);
    const riskyBefore = b.buildingProduction(s, 'lemonwire', 0);
    const safeBefore = b.buildingProduction(s, 'retroamp', 0);

    s.event.incognitoModeOwned = true;

    expect(b.buildingProduction(s, 'lemonwire', 0)).toBeCloseTo(
      riskyBefore * (1 - BREACH.incognito.productionTax),
    );
    expect(b.buildingProduction(s, 'retroamp', 0)).toBeCloseTo(safeBefore);
  });
});
