import { LEGACY } from '../data/balance.js';
import { getUpgrade } from '../data/upgrades.js';

/**
 * The Legacy layer — the permanent multiplier (v2 §5).
 *
 * The lesson this module exists to encode: **the permanent multiplier must not
 * share a currency with the shop.** v1 fed it from `dollarsEarnedTotal`, which
 * put one number in charge of both "what can I buy" and "how fast do I go
 * forever" — two purchases competing for one resource. So Legacy runs off its
 * own all-time accumulator instead, and Dollars stay exactly what they were.
 *
 * The curve is cubic on purpose: the reward is linear in level while the cost of
 * a level is cubic, which is what stops a permanent bonus from outrunning the
 * game that feeds it.
 *
 *     legacyLevel      = floor((allTimeBuzz / LEGACY.divisor) ^ 1/3)
 *     legacyMultiplier = 1 + perLevel × legacyLevel
 *
 * There is no activation step. An earlier draft had the player re-buy the bonus
 * after every wipe — a ritual that reads as flavour on your first Format C: and
 * as a chore on your fiftieth. It is applied automatically and the POST screen
 * simply reports it (patch §3).
 */

/** Cube root that does not return NaN for 0 or negatives. */
const cbrt = (n) => (n <= 0 ? 0 : Math.cbrt(n));

export function legacyLevel(state) {
  return Math.floor(cbrt((state.allTimeBuzz ?? 0) / LEGACY.divisor));
}

/** The permanent global multiplier. Enters the chain in `economy.js`. */
export function legacyMultiplier(state) {
  return 1 + LEGACY.perLevel * legacyLevel(state);
}

/**
 * All-time Buzz still needed for the next level, and how far along it is — the
 * same "show your working" treatment `dollarProgress` gives the payout curve,
 * for the same reason: a cubic curve is unreadable without a bar.
 */
export function legacyProgress(state) {
  const level = legacyLevel(state);
  const have = state.allTimeBuzz ?? 0;
  const from = level ** 3 * LEGACY.divisor;
  const at = (level + 1) ** 3 * LEGACY.divisor;
  const span = at - from;

  return {
    level,
    multiplier: legacyMultiplier(state),
    nextLevel: level + 1,
    have,
    at,
    buzzNeeded: Math.max(0, at - have),
    ratio: span <= 0 ? 0 : Math.min(1, Math.max(0, (have - from) / span)),
  };
}

/* ------------------------------------------------------------------- slots */

/**
 * Legacy Slots (v2 §5.2). Each one carries a single ordinary building upgrade
 * through a Format C:, so a player who prestiges nightly is not re-buying the
 * same four purchases forever. Priced in Dollars — the second Dollar sink
 * alongside hardware, kept as its own list so the two never compete on one row.
 */
export function slotCount(state) {
  return state.legacy?.slots?.length ?? 0;
}

export function nextSlotCost(state) {
  const owned = slotCount(state);
  return LEGACY.slotCosts[owned] ?? null;
}

export function canBuySlot(state) {
  const cost = nextSlotCost(state);
  if (cost === null) return { ok: false, reason: 'maxed' };
  if (state.dollars < cost) return { ok: false, reason: 'too-expensive', cost };
  return { ok: true, cost };
}

export function buySlot(state) {
  const check = canBuySlot(state);
  if (!check.ok) return check;
  state.dollars -= check.cost;
  state.dollarsSpentTotal += check.cost;
  state.legacy.slots.push(null); // empty until the player assigns one
  return { ok: true, cost: check.cost, slots: state.legacy.slots.length };
}

/**
 * Point a slot at an upgrade. Refuses an upgrade that is already held by
 * another slot — two slots on one purchase is a wasted $250 and nothing in the
 * UI would explain why.
 */
export function assignSlot(state, index, upgradeId) {
  const slots = state.legacy?.slots ?? [];
  if (index < 0 || index >= slots.length) return { ok: false, reason: 'no-such-slot' };
  if (upgradeId !== null && !getUpgrade(upgradeId)) {
    return { ok: false, reason: 'unknown-upgrade' };
  }
  if (upgradeId !== null && slots.some((id, i) => i !== index && id === upgradeId)) {
    return { ok: false, reason: 'already-slotted' };
  }
  slots[index] = upgradeId;
  return { ok: true, index, upgradeId };
}

/** The upgrade ids a Format C: should hand back. Empty slots are skipped. */
export function slottedUpgradeIds(state) {
  return (state.legacy?.slots ?? []).filter((id) => id !== null && getUpgrade(id) !== null);
}
