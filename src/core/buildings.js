import { BUILDING } from '../data/balance.js';
import { BUILDINGS, getBuilding } from '../data/buildings.js';

/**
 * The building mechanic (GDD v2 §2): what a unit costs, what it pays, and when
 * the next one unlocks. Pure functions over state, no DOM, no clock — a
 * building's output does not depend on the time of day, only on what is owned.
 *
 * `economy.js` composes and re-exports these, the same way it wraps
 * `core/lemonwire.js` and `core/defrag.js`. UI modules import from `economy`,
 * never from here.
 */

/* -------------------------------------------------------------------- units */

/** Units owned, tolerating a save that predates the building. */
export function unitsOf(state, id) {
  return state.buildings?.[id]?.units ?? 0;
}

/** Total units across the whole roster — the bloat denominator, and a stat. */
export function totalUnits(state) {
  let total = 0;
  for (const building of BUILDINGS) total += unitsOf(state, building.id);
  return total;
}

/* --------------------------------------------------------------------- cost */

/** Price of the next unit for a building that already has `owned` of them. */
export function unitCost(id, owned) {
  return Math.ceil(getBuilding(id).baseCost * BUILDING.costGrowth ** owned);
}

/**
 * Total price of buying `amount` more from `owned`.
 *
 * Summed term by term rather than closed-form. The closed form of a geometric
 * series is exact in maths and not in floating point, and this number is
 * compared against the player's Buzz — an answer a few units light lets a
 * purchase through that the loop below refuses, which reads as the Max button
 * lying. `amount` is bounded by `BUILDING.maxUnits`, so the loop is cheap.
 */
export function unitCostBulk(id, owned, amount) {
  let total = 0;
  for (let i = 0; i < amount; i += 1) total += unitCost(id, owned + i);
  return total;
}

/**
 * How many units the player can actually afford right now, and what they cost.
 * Capped by `max` (what the button asked for) and by the unit rail.
 */
export function affordableUnits(state, id, max = 1) {
  const owned = unitsOf(state, id);
  let count = 0;
  let spent = 0;
  while (count < max && owned + count < BUILDING.maxUnits) {
    const next = spent + unitCost(id, owned + count);
    if (next > state.buzz) break;
    spent = next;
    count += 1;
  }
  return { count, cost: spent };
}

/* ---------------------------------------------------------------- milestones */

/** Index into `BUILDING.milestones` for a unit count — the tier reached. */
export function milestoneIndex(units) {
  let index = 0;
  for (let i = 0; i < BUILDING.milestones.length; i += 1) {
    if (units >= BUILDING.milestones[i].at) index = i;
  }
  return index;
}

/** The automatic production multiplier for owning `units` (GDD §2.2). */
export function milestoneMultiplier(units) {
  return BUILDING.milestones[milestoneIndex(units)].multiplier;
}

/**
 * The next threshold, or null at the top tier. What the celebration counts
 * down to, and the only "goal" a building advertises.
 */
export function nextMilestone(units) {
  const next = BUILDING.milestones[milestoneIndex(units) + 1];
  if (!next) return null;
  const from = BUILDING.milestones[milestoneIndex(units)].at;
  const span = next.at - from;
  return {
    at: next.at,
    remaining: next.at - units,
    multiplier: next.multiplier,
    /** 0..1 across the current tier, for the bar under the unit count. */
    ratio: span <= 0 ? 1 : Math.min(1, Math.max(0, (units - from) / span)),
  };
}

/** Did buying units cross a threshold? Both counts, so the caller can compare. */
export function crossedMilestone(before, after) {
  return milestoneIndex(after) > milestoneIndex(before);
}

/* --------------------------------------------------------------- production */

/**
 * One building's own output, before any global multiplier.
 *
 * Note what is *not* here: the window's open/closed state. A building pays
 * whether or not it is on screen (GDD §5) — RAM decides how much of the desktop
 * the player can see at once, not how much of it is earning.
 */
export function buildingProduction(state, id) {
  const units = unitsOf(state, id);
  return units * getBuilding(id).baseProduction * milestoneMultiplier(units);
}

/** The twelve buildings together — what CPU and Legacy then multiply. */
export function totalBuildingProduction(state) {
  let total = 0;
  for (const building of BUILDINGS) total += buildingProduction(state, building.id);
  return total;
}

/* ------------------------------------------------------------------ unlocks */

/**
 * A building appears once the *run* has produced enough Buzz — the same gate
 * app installs already use, and it resets with Format C: on purpose, so a new
 * run re-walks the roster instead of opening twelve windows on the first tick.
 */
export function isBuildingUnlocked(state, id) {
  return state.runBuzz >= getBuilding(id).unlockAt;
}

export function unlockedBuildings(state) {
  return BUILDINGS.filter((b) => isBuildingUnlocked(state, b.id));
}

/** The next building to appear, and how far off it is. Null once all 12 are up. */
export function nextUnlock(state) {
  const locked = BUILDINGS.find((b) => !isBuildingUnlocked(state, b.id));
  if (!locked) return null;
  return {
    id: locked.id,
    at: locked.unlockAt,
    remaining: Math.max(0, locked.unlockAt - state.runBuzz),
    ratio: Math.min(1, Math.max(0, state.runBuzz / locked.unlockAt)),
  };
}

