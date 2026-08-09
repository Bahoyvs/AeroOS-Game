import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/core/state.js';
import * as up from '../src/core/upgrades.js';
import { getUpgrade, upgradesFor } from '../src/data/upgrades.js';
import { getBuilding } from '../src/data/buildings.js';

function unlocked(runBuzz = 1e12) {
  const s = createInitialState(0);
  s.runBuzz = runBuzz;
  s.hardware.cpu = 6;
  return s;
}

const own = (s, id, n) => {
  const building = getBuilding(id);
  if (building.unitsFrom === 'chat.bots') s.chat.bots = n;
  else s.buildings[id].units = n;
};

// v2 §9: the gating test — both keys, every time.
describe('the double gate (v2 §4.1)', () => {
  const id = 'retroamp.t1';

  it('refuses on money alone', () => {
    const s = unlocked();
    s.buzz = Number.MAX_SAFE_INTEGER;
    own(s, 'retroamp', 0);
    expect(up.canBuyUpgrade(s, id)).toMatchObject({ ok: false, reason: 'needs-units' });
  });

  it('refuses on units alone', () => {
    const s = unlocked();
    s.buzz = 0;
    own(s, 'retroamp', 500);
    expect(up.canBuyUpgrade(s, id)).toMatchObject({ ok: false, reason: 'too-expensive' });
  });

  it('allows the purchase only with both', () => {
    const s = unlocked();
    s.buzz = getUpgrade(id).cost;
    own(s, 'retroamp', getUpgrade(id).requiresUnits);
    expect(up.canBuyUpgrade(s, id).ok).toBe(true);

    const result = up.buyUpgrade(s, id);
    expect(result.ok).toBe(true);
    expect(s.buzz).toBe(0);
    expect(up.isUpgradeOwned(s, id)).toBe(true);
  });

  it('will not sell the same upgrade twice', () => {
    const s = unlocked();
    s.buzz = getUpgrade(id).cost * 4;
    own(s, 'retroamp', 999);
    up.buyUpgrade(s, id);
    expect(up.buyUpgrade(s, id)).toMatchObject({ ok: false, reason: 'already-owned' });
  });

  it('needs both partners in play before a synergy is for sale', () => {
    const s = unlocked();
    s.buzz = Number.MAX_SAFE_INTEGER;
    own(s, 'lemonwire', 50);
    own(s, 'shield99', 0);
    expect(up.canBuyUpgrade(s, 'lemonwire+shield99')).toMatchObject({
      ok: false,
      reason: 'needs-units',
    });
    own(s, 'shield99', 50);
    expect(up.canBuyUpgrade(s, 'lemonwire+shield99').ok).toBe(true);
  });
});

describe('visibility (v2 §6)', () => {
  it('shows the first rung immediately, and exactly one rung ahead after that', () => {
    const s = unlocked();
    expect(up.isUpgradeVisible(s, 'retroamp.t1')).toBe(true);
    expect(up.isUpgradeVisible(s, 'retroamp.t2')).toBe(false);

    s.upgrades.owned['retroamp.t1'] = true;
    expect(up.isUpgradeVisible(s, 'retroamp.t2')).toBe(true);
    expect(up.isUpgradeVisible(s, 'retroamp.t3')).toBe(false);
  });

  it('shows an unaffordable upgrade rather than hiding it', () => {
    const s = unlocked();
    s.buzz = 0;
    own(s, 'retroamp', 0);
    const row = up.upgradeRows(s, 'retroamp').find((r) => r.id === 'retroamp.t1');
    // The whole point: visible, explained, and out of reach.
    expect(row).toBeDefined();
    expect(row.buyable).toBe(false);
    expect(row.gated).toBe(true);
    expect(row.requiresUnits).toBeGreaterThan(0);
  });

  it('hides everything for a building that is still locked', () => {
    const s = createInitialState(0);
    s.runBuzz = 0;
    expect(up.upgradeRows(s, 'cloudmainframe')).toEqual([]);
  });
});

describe('roll-ups used by the achievements', () => {
  it('detects a fully upgraded building', () => {
    const s = unlocked();
    expect(up.isBuildingFullyUpgraded(s, 'retroamp')).toBe(false);
    for (const upgrade of upgradesFor('retroamp')) s.upgrades.owned[upgrade.id] = true;
    expect(up.isBuildingFullyUpgraded(s, 'retroamp')).toBe(true);
  });

  it('counts owned synergy pairs', () => {
    const s = unlocked();
    expect(up.ownedSynergyCount(s)).toBe(0);
    s.upgrades.owned['lemonwire+shield99'] = true;
    s.upgrades.owned['retroamp+vidchat'] = true;
    expect(up.ownedSynergyCount(s)).toBe(2);
  });
});
