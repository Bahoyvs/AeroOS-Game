import { ACHIEVEMENTS } from '../data/balance.js';
import { ACHIEVEMENT_LIST, CATEGORIES, getAchievement } from '../data/achievements.js';
import { BUILDINGS } from '../data/buildings.js';
import { COSMETICS, COSMETIC_KINDS } from '../data/cosmetics.js';
import { HARDWARE, HARDWARE_TRACKS } from '../data/hardware.js';
import { isCosmeticUnlocked } from './cosmetics.js';
import { ownedBuildingCount, unitsOf } from './buildings.js';
import { isBuildingFullyUpgraded, ownedSynergyCount } from './upgrades.js';
import { legacyLevel } from './legacy.js';
import { MINIGAME_IDS } from './minigames.js';

/**
 * Achievement evaluation and the portal's completion figure (GDD §D).
 *
 * Everything here is derived from ordinary state on demand — see the note in
 * `data/achievements.js` — so this module stores exactly one thing: the moment
 * a badge was first earned.
 */

/** The helper surface the predicates are given, so `data/` imports no `core/`. */
function makeApi(state) {
  return {
    units: (id) => unitsOf(state, id),
    ownedBuildingCount: () => ownedBuildingCount(state),
    synergyCount: () => ownedSynergyCount(state),
    legacyLevel: () => legacyLevel(state),
    anyBuildingFullyUpgraded: () =>
      BUILDINGS.some((b) => isBuildingFullyUpgraded(state, b.id)),
    allCosmeticsUnlocked: () =>
      COSMETIC_KINDS.every((kind) =>
        COSMETICS[kind].every((item) => isCosmeticUnlocked(state, item)),
      ),
    allHardwareMaxed: () =>
      HARDWARE_TRACKS.every(
        (track) => (state.hardware?.[track] ?? 0) >= HARDWARE[track].tiers.length - 1,
      ),
    minigamesPlayedCount: () =>
      MINIGAME_IDS.filter((id) => (state.minigames?.[id]?.timesPlayed ?? 0) > 0).length,
    returnAfterHours: ACHIEVEMENTS.returnAfterHours,
    streakDays: ACHIEVEMENTS.streakDays,
  };
}

export function isUnlocked(state, id) {
  return state.achievements?.unlocked?.[id] != null;
}

export function unlockedCount(state) {
  return Object.keys(state.achievements?.unlocked ?? {}).length;
}

/**
 * Evaluate every predicate and return the ones that just came true.
 *
 * Called from the tick. It is ~30 comparisons over numbers already in memory and
 * only writes to the save when an answer changes, which is what lets a badge
 * arrive at the instant it is earned rather than the next time a window opens —
 * the same trade `announceCosmetics` makes.
 */
export function evaluateAchievements(state, now = Date.now()) {
  if (!state.achievements) state.achievements = { unlocked: {} };
  const api = makeApi(state);
  const fresh = [];

  for (const achievement of ACHIEVEMENT_LIST) {
    if (isUnlocked(state, achievement.id)) continue;
    let earned = false;
    try {
      earned = achievement.test(state, api) === true;
    } catch {
      // A predicate that throws on a half-migrated save must not take the tick
      // down with it — it simply stays locked until the state makes sense.
      earned = false;
    }
    if (!earned) continue;
    state.achievements.unlocked[achievement.id] = now;
    fresh.push(achievement);
  }
  return fresh;
}

/** One row per badge, grouped-ready for the achievements window. */
export function achievementRows(state) {
  return ACHIEVEMENT_LIST.map((achievement) => ({
    ...achievement,
    unlocked: isUnlocked(state, achievement.id),
    unlockedAt: state.achievements?.unlocked?.[achievement.id] ?? null,
    categoryLabel: CATEGORIES[achievement.category]?.label ?? achievement.category,
  }));
}

export function achievementSummary(state) {
  const rows = achievementRows(state);
  return {
    rows,
    total: rows.length,
    unlocked: rows.filter((r) => r.unlocked).length,
    categories: CATEGORIES,
  };
}

/* ------------------------------------------------------- portal reporting */

/**
 * The blended completion figure `reportGameCompletedPercentage` is fed (§D.3).
 *
 * Half "how much of the roster have you opened up", half "how many badges have
 * you earned". Neither alone is honest: buildings unlock in a fixed order and
 * would report 100% while most of the content is untouched, and badges include
 * habit ones a brand-new player cannot earn at any skill level.
 */
export function completionPercent(state) {
  const { buildings: wb, achievements: wa } = ACHIEVEMENTS.completionWeights;
  const buildingRatio = ownedBuildingCount(state) / BUILDINGS.length;
  const achievementRatio = unlockedCount(state) / ACHIEVEMENT_LIST.length;
  const blended = buildingRatio * wb + achievementRatio * wa;
  return Math.round(Math.min(100, Math.max(0, blended * 100)));
}

/**
 * Has completion moved far enough to be worth telling the portal?
 *
 * Returns the number to report, or null. The step gate is what makes it safe to
 * ask this from the tick: the SDK is a network call, not a counter.
 */
export function completionToReport(state) {
  const percent = completionPercent(state);
  const last = state.crazyGames?.lastReportedCompletion ?? 0;
  if (percent <= last) return null;
  if (percent - last < ACHIEVEMENTS.reportStepPercent && percent < 100) return null;
  return percent;
}

export function markCompletionReported(state, percent) {
  if (!state.crazyGames) state.crazyGames = { lastReportedCompletion: 0 };
  state.crazyGames.lastReportedCompletion = percent;
}

/* ------------------------------------------------------ session bookkeeping */

const dayIndex = (ms) => Math.floor(ms / 86_400_000);

/**
 * Record that a session has started, for the habit badges (§D.2).
 *
 * Called once on load. UTC days rather than local ones, matching how the ad
 * allowances already roll over — one definition of "a day" in the codebase is
 * worth more than a locally-correct second one.
 *
 * A gap of exactly one day extends the streak; a longer gap restarts it at one.
 * Returning twice on the same day changes nothing, so a player who reloads
 * six times cannot farm "Daily Driver".
 */
export function noteSession(state, awaySeconds = 0, now = Date.now()) {
  const stats = state.stats;
  const today = dayIndex(now);
  const last = stats.lastPlayDay ?? 0;

  const awayHours = awaySeconds / 3600;
  if (awayHours > (stats.longestAwayHours ?? 0)) stats.longestAwayHours = awayHours;

  if (last === today) return { streak: stats.dayStreak ?? 0, returned: false };

  stats.dayStreak = last > 0 && today - last === 1 ? (stats.dayStreak ?? 0) + 1 : 1;
  stats.lastPlayDay = today;
  return { streak: stats.dayStreak, returned: true };
}
