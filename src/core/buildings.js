import { BREACH, CHAT_BOT } from '../data/balance.js';
import { BUILDINGS, UNIT_COST_GROWTH, getBuilding } from '../data/buildings.js';
import { upgradesAffecting } from '../data/upgrades.js';
import { buffMultiplier } from './buffs.js';

/**
 * Buildings: units, the price curve, and what a building produces.
 *
 * Pure and DOM-free like the rest of `core/`. Everything takes the whole state
 * so the UI never has to know how a number is composed — and so the whole
 * economy can be exercised in plain Node (tests/buildings.test.js).
 *
 * The one rule that shapes this module: **a building's upgrades multiply only
 * that building** (v2 §4.5). The global chain — hardware, bloat, legacy, buffs —
 * lives in `economy.js` and nothing here reaches into it.
 */

/* ------------------------------------------------------------------- units */

/**
 * How many units of a building the player owns.
 *
 * AeroChat is special-cased through data rather than code: its units are
 * `state.chat.bots` and always have been (redesign decision #3 — the buddy
 * system stays where it is), so the roster carries a `unitsFrom` path instead
 * of this function growing an `if`.
 */
export function unitsOf(state, id) {
  const building = getBuilding(id);
  if (building.unitsFrom === 'chat.bots') return state.chat?.bots ?? 0;
  return state.buildings?.[id]?.units ?? 0;
}

function setUnits(state, id, units) {
  const building = getBuilding(id);
  if (building.unitsFrom === 'chat.bots') {
    state.chat.bots = units;
    return;
  }
  if (!state.buildings[id]) state.buildings[id] = { units: 0 };
  state.buildings[id].units = units;
}

/** Distinct buildings the player owns at least one unit of. */
export function ownedBuildingCount(state) {
  let count = 0;
  for (const building of BUILDINGS) {
    if (unitsOf(state, building.id) > 0) count += 1;
  }
  return count;
}

/** Every building the player has produced at least one unit of, in roster order. */
export function ownedBuildings(state) {
  return BUILDINGS.filter((b) => unitsOf(state, b.id) > 0);
}

/* -------------------------------------------------------------- price curve */

/**
 * What the next unit costs, given how many are already owned.
 *
 * One formula for all twelve buildings (patch §2.1). The growth factor is not a
 * per-building tuning knob and must not become one — a shared curve is what
 * makes `unitCostBulk` safe to reason about everywhere.
 */
export function unitCost(id, owned) {
  const building = getBuilding(id);
  return Math.ceil(building.baseCost * UNIT_COST_GROWTH ** Math.max(0, owned));
}

/**
 * Total price of `quantity` more units from the current count.
 *
 * This is the generalisation of the shipped `botCostBulk` (patch §2.2). Note
 * that it needs no safety rail of its own: at 1.15 growth the 500th unit costs
 * 1.15^500 times the first, so a runaway bulk purchase prices itself out of
 * existence long before it can break the economy. The stepped x1/x10/x100/Max
 * buttons in the UI are accident-prevention, not an economic guard.
 */
export function unitCostBulk(id, owned, quantity) {
  let total = 0;
  for (let i = 0; i < quantity; i += 1) total += unitCost(id, owned + i);
  return total;
}

/**
 * How many units the player can actually afford right now, and what they cost.
 * Capped by the building's own `maxPerRun` (patch §2.3).
 */
export function affordableUnits(state, id, max = 100) {
  const building = getBuilding(id);
  const owned = unitsOf(state, id);
  let count = 0;
  let spent = 0;

  while (count < max && owned + count < building.maxPerRun) {
    const next = spent + unitCost(id, owned + count);
    if (next > state.buzz) break;
    spent = next;
    count += 1;
  }
  return { count, cost: spent };
}

/* ------------------------------------------------------------------ unlock */

/**
 * Is this building on the roster yet?
 *
 * `unlockAt` is deliberately far below what a unit costs — that gap is the
 * visibility hook (v2 §6). IoT Botnet carries a second key as well: the CPU
 * tier flag that has been sitting unused in `data/hardware.js` since Day 4.
 */
export function isBuildingUnlocked(state, id) {
  const building = getBuilding(id);
  if (state.runBuzz < building.unlockAt) return false;
  if (building.requiresCpuTier != null && (state.hardware?.cpu ?? 0) < building.requiresCpuTier) {
    return false;
  }
  return true;
}

/** Why a building is still locked, for the roster row to explain itself. */
export function lockReason(state, id) {
  const building = getBuilding(id);
  if (state.runBuzz < building.unlockAt) return { reason: 'run-buzz', at: building.unlockAt };
  if (building.requiresCpuTier != null && (state.hardware?.cpu ?? 0) < building.requiresCpuTier) {
    return { reason: 'cpu-tier', at: building.requiresCpuTier };
  }
  return null;
}

/* ---------------------------------------------------------------- purchase */

export function canBuyUnits(state, id, amount = 1) {
  if (!isBuildingUnlocked(state, id)) return { ok: false, reason: 'locked' };
  const building = getBuilding(id);
  if (unitsOf(state, id) >= building.maxPerRun) return { ok: false, reason: 'maxed' };

  const { count, cost } = affordableUnits(state, id, amount);
  if (count === 0) return { ok: false, reason: 'too-expensive' };
  return { ok: true, count, cost };
}

/**
 * Buy units. Mutating — it is called from `game.js`, which owns the only
 * mutable state and emits the event afterwards.
 */
export function buyUnits(state, id, amount = 1) {
  const check = canBuyUnits(state, id, amount);
  if (!check.ok) return check;

  state.buzz -= check.cost;
  setUnits(state, id, unitsOf(state, id) + check.count);
  return { ok: true, count: check.count, cost: check.cost };
}

/* --------------------------------------------------------- upgrade effects */

const isOwned = (state, upgradeId) => state.upgrades?.owned?.[upgradeId] === true;

/**
 * The building's own multiplier from tiered upgrades: ×2 per rung owned.
 *
 * AeroChat's late rungs are not doublings (§4.4) and are skipped here — they
 * land in `flatPerBuildingBonus` instead.
 */
export function localMultiplier(state, id) {
  let multiplier = 1;
  for (const upgrade of upgradesAffecting(id)) {
    if (upgrade.buildingId !== id) continue;
    if (upgrade.effect.kind !== 'double') continue;
    if (isOwned(state, upgrade.id)) multiplier *= upgrade.effect.multiplier;
  }
  return multiplier;
}

/**
 * The Grandma bonus (§4.2): a fraction scaled by how many buddies are owned.
 * Zero until the building's one buddy upgrade is bought.
 */
export function crossBonus(state, id) {
  const buddies = unitsOf(state, 'aerochat');
  let bonus = 0;
  for (const upgrade of upgradesAffecting(id)) {
    if (upgrade.buildingId !== id) continue;
    if (upgrade.effect.kind !== 'perBuddies') continue;
    if (!isOwned(state, upgrade.id)) continue;
    bonus += Math.floor(buddies / upgrade.effect.per) * upgrade.effect.bonus;
  }
  return bonus;
}

/**
 * Synergy contributions (§4.3), itemised so the tooltip can name each source.
 *
 * One purchase switches on both directions of a pair, and the two sides are
 * deliberately unequal: the major partner gains more per partner unit than the
 * minor one does. That asymmetry is what stops a pair collapsing into "buy both
 * evenly forever".
 */
export function synergyBonuses(state, id) {
  const out = [];
  for (const upgrade of upgradesAffecting(id)) {
    if (upgrade.effect.kind !== 'synergy') continue;
    if (!isOwned(state, upgrade.id)) continue;

    const { major, minor, majorPerUnit, minorPerUnit } = upgrade.effect;
    // Whichever side *this* building is on, it is paid by the other one.
    const partner = id === major ? minor : major;
    const perUnit = id === major ? majorPerUnit : minorPerUnit;
    const amount = unitsOf(state, partner) * perUnit;
    if (amount > 0) out.push({ source: partner, upgradeId: upgrade.id, amount });
  }
  return out;
}

/**
 * The AeroChat exception (§4.4): flat Buzz/sec per *distinct* building owned,
 * added to AeroChat's base before any of its multipliers.
 *
 * Per building owned rather than per unit owned, so it grows with how much of
 * the game the player has opened up rather than with how deep they have gone
 * into any one step — which is exactly what keeps it from running away.
 */
export function flatPerBuildingBonus(state, id) {
  let flat = 0;
  for (const upgrade of upgradesAffecting(id)) {
    if (upgrade.buildingId !== id) continue;
    if (upgrade.effect.kind !== 'perBuilding') continue;
    if (isOwned(state, upgrade.id)) flat += upgrade.effect.flat * ownedBuildingCount(state);
  }
  return flat;
}

/**
 * The Incognito tax (GDD §C.5).
 *
 * Read straight off the state rather than through `core/breach.js`, which would
 * close an import cycle for one boolean and a constant. It applies to the three
 * risky buildings only: a global tax would make opting out of the crisis system
 * a strictly worse way to play, and an option nobody should take is not an
 * option.
 */
function incognitoTax(state, id) {
  if (state.event?.incognitoModeOwned !== true) return 1;
  return BREACH.riskyBuildings.includes(id) ? 1 - BREACH.incognito.productionTax : 1;
}

/**
 * AeroChat's own multiplier stack, from before the building layer existed.
 *
 * Buddy-count milestones and `chat`-kind buffs predate v2 and are kept exactly
 * as they were — a redesign that silently deleted the "every 25 buddies" bonus
 * would be taking away the one progression beat the first ten minutes has. It
 * lives here rather than in `economy.js` because it is AeroChat's *local*
 * multiplier in v2 terms, and AeroChat is already the roster's special case.
 */
export function chatMilestoneCount(state) {
  return Math.floor((state.chat?.bots ?? 0) / CHAT_BOT.milestoneEvery);
}

export function chatMilestoneMultiplier(state) {
  return 1 + chatMilestoneCount(state) * CHAT_BOT.milestoneBonus;
}

function legacyChatMultiplier(state, id, now) {
  if (id !== 'aerochat') return 1;
  return chatMilestoneMultiplier(state) * buffMultiplier(state, 'chat', now);
}

/* -------------------------------------------------------------- production */

/**
 * What one building pays per second, before the global chain.
 *
 * Production is **not** conditional on a window being open (patch §1.1). That
 * was the shipped behaviour and it is deliberately gone: a building is a thing
 * you own, not a thing you babysit. What windows are for now is *active
 * participation* — a playlist, a seed slot, a scan — and those pay their own
 * timed bonuses on top through the existing buff system.
 */
export function buildingProduction(state, id, now = Date.now()) {
  const building = getBuilding(id);
  const units = unitsOf(state, id);
  if (units <= 0) return 0;

  const base = units * building.baseRate + flatPerBuildingBonus(state, id);
  const synergy = synergyBonuses(state, id).reduce((sum, s) => sum + s.amount, 0);

  return (
    base *
    localMultiplier(state, id) *
    (1 + crossBonus(state, id)) *
    (1 + synergy) *
    legacyChatMultiplier(state, id, now) *
    buildingBuffMultiplier(state, id, now) *
    incognitoTax(state, id)
  );
}

/**
 * Timed, building-scoped bonuses — what a mini-game round pays out (GDD §B.1),
 * and the only way anything temporary can touch a single building. It rides on
 * the ordinary buff system under a namespaced kind, so it expires on the wall
 * clock and shows up in the buff list like everything else.
 */
export function buildingBuffKind(id) {
  return `building:${id}`;
}

export function buildingBuffMultiplier(state, id, now = Date.now()) {
  return buffMultiplier(state, buildingBuffKind(id), now);
}

/** Every building's base production, summed. The economy's top line. */
export function totalBuildingProduction(state, now = Date.now()) {
  let total = 0;
  for (const building of BUILDINGS) total += buildingProduction(state, building.id, now);
  return total;
}

/**
 * The itemised version (patch §4.1).
 *
 * The rule this exists to serve: **no multiplier may act invisibly.** A synergy
 * the player cannot see is a synergy that, for them, does not exist — so the UI
 * gets the parts and never recomputes them. `globalMultiplier` is passed in
 * rather than imported, because it belongs to `economy.js` and importing it
 * here would close a cycle.
 */
export function productionBreakdown(state, id, { globalMultiplier = 1, now = Date.now() } = {}) {
  const building = getBuilding(id);
  const units = unitsOf(state, id);
  const flat = flatPerBuildingBonus(state, id);
  const base = units * building.baseRate + flat;

  const local = localMultiplier(state, id);
  const cross = crossBonus(state, id);
  const synergies = synergyBonuses(state, id);
  const synergyTotal = synergies.reduce((sum, s) => sum + s.amount, 0);
  const minigame = buildingBuffMultiplier(state, id, now);
  const incognito = incognitoTax(state, id);
  const chat = legacyChatMultiplier(state, id, now);
  const beforeGlobal =
    base * local * (1 + cross) * (1 + synergyTotal) * chat * minigame * incognito;

  return {
    buildingId: id,
    units,
    perUnit: building.baseRate,
    /** Flat Buzz/sec that is not per-unit — only AeroChat has any (§4.4). */
    flatBonus: flat,
    base,
    localUpgrades: local,
    crossBuildingBonus: cross > 0 ? { source: 'aerochat', amount: cross } : null,
    synergyBonus: synergies,
    /** AeroChat only: buddy milestones × chat-kind buffs. 1 everywhere else. */
    chatMultiplier: chat,
    /** A live mini-game reward, if one is running. 1 when there is none. */
    minigameMultiplier: minigame,
    /** The Incognito tax, if this is one of the buildings it applies to. */
    incognitoMultiplier: incognito,
    globalMultiplier,
    beforeGlobal,
    total: beforeGlobal * globalMultiplier,
  };
}

/**
 * Which *other* buildings a purchase of `id` just made more productive, so the
 * shell can say so out loud (patch §4.2). Returns the partner ids only — the
 * notification's wording belongs to the UI.
 */
export function synergyPartnersOf(state, id) {
  const partners = new Set();
  for (const upgrade of upgradesAffecting(id)) {
    if (upgrade.effect.kind !== 'synergy') continue;
    if (!isOwned(state, upgrade.id)) continue;
    partners.add(id === upgrade.effect.major ? upgrade.effect.minor : upgrade.effect.major);
  }
  return [...partners];
}
