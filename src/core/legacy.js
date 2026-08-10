import { LEGACY } from '../data/balance.js';

/**
 * Legacy Level — the prestige layer (GDD v2 §2.6).
 *
 * One accumulator, `state.allTimeBuzz`, which nothing resets: not Format C:,
 * not a hard reset of the run. `lifetimeBuzz` cannot do this job — the Mainboard
 * track re-prices it and Format C: pays against it, so it is a *ledger*, and a
 * ledger that gets settled is not a monument.
 *
 *   level      = floor((allTimeBuzz / divisor) ^ (1/3))
 *   multiplier = 1 + perLevel × level
 *
 * The cube root is the entire mechanism, taken from Cookie Clicker's Prestige
 * Level: the reward is linear in the level and the price of the next one is
 * cubic, so the gap widens by itself. No schedule to hand-tune, and no point at
 * which prestiging is obviously early or obviously late.
 *
 * Pure, and the level is *always* derived rather than read from the save.
 * `state.legacy.level` exists only so the Format C: sequence can show what
 * changed; if it ever disagrees with `allTimeBuzz`, `allTimeBuzz` is right.
 */

/** The level a given all-time total is worth. Monotonic by construction. */
export function levelFor(allTimeBuzz) {
  if (!(allTimeBuzz > 0)) return 0;
  return Math.floor(Math.cbrt(allTimeBuzz / LEGACY.divisor));
}

export function legacyLevel(state) {
  return levelFor(state.allTimeBuzz ?? 0);
}

/** All-time Buzz needed to reach `level`. The inverse of the curve above. */
export function buzzForLevel(level) {
  return level <= 0 ? 0 : level ** 3 * LEGACY.divisor;
}

/** The permanent global multiplier the player's history is worth. */
export function legacyMultiplier(state) {
  return 1 + LEGACY.perLevel * legacyLevel(state);
}

/**
 * Progress toward the next level, for the Format C: screen and the achievement
 * window. Without it the cube root is invisible: the player cannot tell whether
 * the next level is one run away or twenty.
 */
export function legacyProgress(state) {
  const level = legacyLevel(state);
  const from = buzzForLevel(level);
  const at = buzzForLevel(level + 1);
  const have = state.allTimeBuzz ?? 0;
  const span = at - from;
  return {
    level,
    multiplier: legacyMultiplier(state),
    nextLevel: level + 1,
    nextAt: at,
    buzzNeeded: Math.max(0, at - have),
    ratio: span <= 0 ? 0 : Math.min(1, Math.max(0, (have - from) / span)),
  };
}

/**
 * Stamp the derived level onto the save, and report whether it moved.
 *
 * Called by Format C: (GDD §2.6: the level applies automatically the moment the
 * wipe completes, with no purchase step) so the stop screen can say "Legacy
 * Level N applied" and mean it. The multiplier itself does not wait for this —
 * it is derived on every read — so a player who never formats still gets what
 * their history is worth.
 */
export function applyLegacyLevel(state) {
  const before = state.legacy?.level ?? 0;
  const level = legacyLevel(state);
  state.legacy = { ...state.legacy, level };
  return { level, before, gained: level - before, changed: level !== before };
}
