import { LEGACY } from '../data/balance.js';

/**
 * Legacy Level — the prestige layer.
 *
 * One accumulator, `state.allTimeBuzz`, which nothing resets: not Format C:,
 * not a hard reset of the run.
 *
 *   level      = earlyLevels(allTimeBuzz) + lateLevels(allTimeBuzz)
 *   multiplier = 1 + perLevel × level
 *
 * Two terms, tuned to hand over to each other — the why is in `LEGACY`
 * (data/balance.js). The cubic term is the endgame mechanism sized off peak production,
 * which leaves the first prestiges paying nothing; the logarithmic early term
 * covers exactly that span and then caps.
 *
 * Both terms are floored separately and added. That is deliberate — it keeps
 * the total monotonic in `allTimeBuzz` (a sum of two non-decreasing step
 * functions), and it makes `buzzForLevel` an exact inverse at every level.
 *
 * Pure, and the level is *always* derived rather than read from the save.
 * `state.legacy.level` exists only so the Format C: sequence can show what
 * changed; if it ever disagrees with `allTimeBuzz`, `allTimeBuzz` is right.
 */

/**
 * The early term. Logarithmic and capped: level 1 at `earlyAt` — which is the
 * first Format C: threshold, so a player's first wipe always pays one — and
 * each level after it costs `earlyRatio`× the last.
 */
export function earlyLevelsFor(allTimeBuzz) {
  let level = 0;
  let threshold = LEGACY.earlyAt;
  while (level < LEGACY.earlyLevels && allTimeBuzz >= threshold) {
    level += 1;
    threshold *= LEGACY.earlyRatio;
  }
  return level;
}

/** The late term: the cubic curve, which pays nothing until `divisor`. */
export function lateLevelsFor(allTimeBuzz) {
  if (!(allTimeBuzz > 0)) return 0;
  return Math.floor(Math.cbrt(allTimeBuzz / LEGACY.divisor));
}

/** The level a given all-time total is worth. Monotonic by construction. */
export function levelFor(allTimeBuzz) {
  return earlyLevelsFor(allTimeBuzz) + lateLevelsFor(allTimeBuzz);
}

export function legacyLevel(state) {
  return levelFor(state.allTimeBuzz ?? 0);
}

/**
 * All-time Buzz needed to reach `level` — the exact inverse, piecewise like the
 * curve it inverts. Below the early cap a level is a power of `earlyRatio`;
 * above it, the cubic term is carrying the whole thing and the early term is
 * pinned at its cap.
 */
export function buzzForLevel(level) {
  if (level <= 0) return 0;
  if (level > LEGACY.earlyLevels) return (level - LEGACY.earlyLevels) ** 3 * LEGACY.divisor;
  let threshold = LEGACY.earlyAt;
  for (let i = 1; i < level; i += 1) threshold *= LEGACY.earlyRatio;
  return threshold;
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
 * Called by Format C: so the stop screen can say "Legacy Level N applied" and mean it.
 */
export function applyLegacyLevel(state) {
  const before = state.legacy?.level ?? 0;
  const level = legacyLevel(state);
  state.legacy = { ...state.legacy, level };
  return { level, before, gained: level - before, changed: level !== before };
}
