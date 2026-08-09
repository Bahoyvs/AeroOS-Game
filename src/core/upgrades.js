import { UPGRADES, getUpgrade, upgradesFor } from '../data/upgrades.js';
import { isBuildingUnlocked, unitsOf } from './buildings.js';

/**
 * Buying upgrades, and deciding which ones the player is allowed to *see*.
 *
 * The second half matters as much as the first. The economy audit's finding was
 * that nothing in the shipped game showed you what was coming next, and v2 §4.1
 * fixes it with a hard double gate rather than a hint: an upgrade needs both the
 * Buzz **and** a unit count, and the unit count is shown while it is unmet. The
 * player is meant to spend a while looking at something they cannot buy yet.
 */

export function isUpgradeOwned(state, id) {
  return state.upgrades?.owned?.[id] === true;
}

export function ownedUpgradeIds(state) {
  return Object.keys(state.upgrades?.owned ?? {}).filter((id) => state.upgrades.owned[id]);
}

export function ownedUpgradeCount(state) {
  return ownedUpgradeIds(state).length;
}

/**
 * Has the unit gate been met? This is the half that is *not* about money, and
 * the half a row keeps displaying while it is unsatisfied.
 */
function unitsGateMet(state, upgrade) {
  if (unitsOf(state, upgrade.buildingId) < upgrade.requiresUnits) return false;
  if (upgrade.requiresPartnerUnits != null) {
    if (unitsOf(state, upgrade.partnerId) < upgrade.requiresPartnerUnits) return false;
  }
  return true;
}

/**
 * Should this upgrade be drawn at all?
 *
 * Tiered upgrades reveal one rung ahead: owning tier N shows tier N+1, so there
 * is always exactly one visible goal per building and never a wall of twelve.
 * Cross and synergy upgrades appear as soon as their building does — they are
 * the two purchases that teach the player the system exists.
 */
export function isUpgradeVisible(state, id) {
  const upgrade = getUpgrade(id);
  if (!upgrade) return false;
  if (!isBuildingUnlocked(state, upgrade.buildingId)) return false;
  if (isUpgradeOwned(state, id)) return true;
  if (upgrade.kind !== 'tiered') return true;
  if (upgrade.tier === 1) return true;
  return isUpgradeOwned(state, `${upgrade.buildingId}.t${upgrade.tier - 1}`);
}

export function canBuyUpgrade(state, id) {
  const upgrade = getUpgrade(id);
  if (!upgrade) return { ok: false, reason: 'unknown-upgrade' };
  if (isUpgradeOwned(state, id)) return { ok: false, reason: 'already-owned' };
  if (!isBuildingUnlocked(state, upgrade.buildingId)) return { ok: false, reason: 'locked' };
  if (!unitsGateMet(state, upgrade)) {
    return { ok: false, reason: 'needs-units', requires: upgrade.requiresUnits };
  }
  if (state.buzz < upgrade.cost) return { ok: false, reason: 'too-expensive', cost: upgrade.cost };
  return { ok: true, cost: upgrade.cost, upgrade };
}

/** Mutating; `game.js` owns the event that announces it. */
export function buyUpgrade(state, id) {
  const check = canBuyUpgrade(state, id);
  if (!check.ok) return check;

  state.buzz -= check.cost;
  if (!state.upgrades.owned) state.upgrades.owned = {};
  state.upgrades.owned[id] = true;
  return { ok: true, upgrade: check.upgrade, cost: check.cost };
}

/**
 * Everything one building's upgrade panel needs, already resolved: what is
 * owned, what is buyable, and — for the rest — the sentence explaining which
 * of the two gates is still shut.
 */
export function upgradeRows(state, buildingId) {
  return upgradesFor(buildingId)
    .filter((upgrade) => isUpgradeVisible(state, upgrade.id))
    .map((upgrade) => {
      const owned = isUpgradeOwned(state, upgrade.id);
      const gated = !unitsGateMet(state, upgrade);
      const affordable = state.buzz >= upgrade.cost;

      return {
        ...upgrade,
        owned,
        gated,
        affordable,
        buyable: !owned && !gated && affordable,
        haveUnits: unitsOf(state, upgrade.buildingId),
        havePartnerUnits:
          upgrade.partnerId != null ? unitsOf(state, upgrade.partnerId) : null,
      };
    });
}

/** Has this building's whole ladder been bought? Used by the achievements. */
export function isBuildingFullyUpgraded(state, buildingId) {
  const all = upgradesFor(buildingId);
  return all.length > 0 && all.every((u) => isUpgradeOwned(state, u.id));
}

/** Every synergy pair whose upgrade has been bought. */
export function ownedSynergyCount(state) {
  return UPGRADES.filter((u) => u.effect.kind === 'synergy' && isUpgradeOwned(state, u.id)).length;
}
