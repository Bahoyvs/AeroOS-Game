import { getAchievement } from '../data/achievements.js';

/**
 * The CrazyGames achievement bridge (GDD §D.1, §D.3).
 *
 * The clarification this module exists to encode: **CrazyGames has no
 * achievement API.** The badge list is entirely ours — our save, our window —
 * and only two narrow SDK hooks are involved:
 *
 * - `happytime()` fires the site's own celebration animation. The documentation
 *   is explicit that it should be used *sparingly*, so it is wired to exactly
 *   three curated moments (the `big` flag in `data/achievements.js`) and not to
 *   the other twenty-five badges.
 * - `reportGameCompletedPercentage(0-100)` tells the portal how far through the
 *   game a player is. `core/achievements.js` gates it behind a five-point step,
 *   so it fires a handful of times across a whole playthrough.
 *
 * A third, `leaderboards`, is deliberately *not* wired: it is only available to
 * invited games, and calling an API we may not have access to would fail at
 * runtime on the portal rather than here. `LEADERBOARD_PLAN` below records what
 * to submit if that invitation ever arrives.
 *
 * Everything is called through `safely()`. This is a third-party script on a
 * page we do not control — it can be blocked, stubbed by an extension, or
 * simply absent in local dev — and no celebration is worth taking the game
 * down for.
 */

const sdk = () => globalThis.CrazyGames?.SDK ?? null;

function safely(label, fn) {
  try {
    const api = sdk();
    if (!api) return false;
    fn(api);
    return true;
  } catch (err) {
    // Not even a warning in production: a portal SDK that throws is the
    // portal's problem, and the player is mid-game.
    if (import.meta.env?.DEV) console.warn(`[crazygames] ${label} failed`, err);
    return false;
  }
}

/**
 * If AeroOS is ever invited to the leaderboard programme, this is the shape to
 * submit: one board per game, incremental because an idle game's score only
 * ever goes up, and keyed on Legacy Level rather than Buzz because Buzz is
 * unbounded and unreadable at a glance.
 */
export const LEADERBOARD_PLAN = {
  metric: 'legacyLevel',
  isIncremental: true,
  note: 'Invited games only — see GDD §D.3. Not wired until the invitation exists.',
};

export function attachPortalHooks(game) {
  /**
   * The three big moments. Curated in data rather than decided here, so the
   * "use it sparingly" rule is visible next to the badge list it applies to
   * instead of buried in a UI module.
   */
  const offAchievement = game.bus.on(game.events.ACHIEVEMENT, ({ achievement }) => {
    if (!achievement.big) return;
    safely('happytime', (api) => api.game.happytime());
  });

  /**
   * Progress reporting. The event only fires when the blended figure has
   * actually moved (see `completionToReport`), so there is no throttle here —
   * the gate is upstream, where the number is.
   */
  const offCompletion = game.bus.on(game.events.COMPLETION_REPORT, ({ percent }) => {
    safely('reportGameCompletedPercentage', (api) =>
      api.game.reportGameCompletedPercentage(percent),
    );
  });

  /**
   * Surviving a full Darknet Breach is one of the three, and it is worth
   * noting why it is *here* as well as in the badge list: the badge fires once,
   * ever, but the moment is the game's biggest single beat. Repeat wins are
   * intentionally quiet.
   */
  const offBreach = game.bus.on(game.events.BREACH_RESOLVED, ({ outcome }) => {
    if (outcome !== 'fought') return;
    if (game.state.event.survived !== 1) return;
    safely('happytime', (api) => api.game.happytime());
  });

  return () => {
    offAchievement();
    offCompletion();
    offBreach();
  };
}

/** Exposed for the achievements window's tooltip copy. */
export function isBigAchievement(id) {
  return getAchievement(id)?.big === true;
}
