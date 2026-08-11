import { CHAT_BOT, PRESTIGE } from '../data/balance.js';
import { getApp } from '../data/apps.js';

/**
 * The goal tracker — "what am I working towards?", answered at all times.
 *
 * The scripted tutorial (`core/tutorial.js`) hands the player a working machine
 * in five steps and then stops, and until this existed the desktop went quiet
 * at exactly the moment the player had learned enough to want a target. An idle
 * game is a sequence of bars filling; a player who cannot see the next bar has
 * finished the game whether or not they know it.
 *
 * Everything here is *derived*, never stored: a goal is a predicate plus a
 * progress fraction over the same state the rest of the economy reads. That
 * means no save migration, no goal that can get stuck marked complete, and no
 * second definition of "is LemonWire unlocked" to drift out of step with the
 * roster in `src/data/apps.js`.
 *
 * Pure, and therefore testable in plain Node like the rest of `core/`.
 */

/** Clamp a raw fraction into a progress bar's range. */
const ratio = (value, target) => (target <= 0 ? 1 : Math.max(0, Math.min(value / target, 1)));

/** Is an app on the roster installed? */
const installed = (state, id) => state.apps[id]?.installed === true;

/**
 * "Save up for this app" — the goal that carries most of the mid-game. Progress
 * is measured against the install price rather than the unlock threshold, since
 * the price is the number the Start menu will actually charge.
 */
function installGoal(id, why) {
  const app = getApp(id);
  return {
    id: `install-${id}`,
    isDone: (state) => installed(state, id),
    /** Only offered once the roster says the player has seen enough of the run. */
    isReady: (state) => state.runBuzz >= app.install.unlockAt,
    title: `Install ${app.name}`,
    hint: why,
    progress: (state) => ratio(state.buzz, app.install.cost),
    detail: (state, { formatNumber }) =>
      `${formatNumber(Math.min(state.buzz, app.install.cost))} / ${formatNumber(app.install.cost)} Buzz`,
  };
}

/**
 * Ordered by when they should appear, and resolved first-unmet-wins. Order is
 * the whole design here: two goals on screen is a menu, and a menu is a
 * decision the player has to make before they are equipped to make it.
 */
export const GOALS = [
  {
    id: 'first-buddy',
    isDone: (state) => state.chat.bots >= 1,
    title: 'Get someone online',
    hint: 'Buddies keep chatting — and keep paying — while you idle.',
    progress: (state) => ratio(state.buzz, CHAT_BOT.baseCost),
    detail: (state, { formatNumber }) =>
      `${formatNumber(Math.min(state.buzz, CHAT_BOT.baseCost))} / ${formatNumber(CHAT_BOT.baseCost)} Buzz`,
  },
  {
    id: 'ten-buddies',
    isDone: (state) => state.chat.bots >= 10,
    title: 'Ten buddies online',
    hint: 'Every buddy adds to the idle rate. Ten is where it starts running itself.',
    progress: (state) => ratio(state.chat.bots, 10),
    detail: (state) => `${state.chat.bots} / 10 buddies`,
  },
  installGoal('retroamp', 'A playlist multiplies everything you earn, forever.'),
  {
    id: 'load-playlist',
    isDone: (state) => state.retroamp.playlist !== null,
    isReady: (state) => installed(state, 'retroamp'),
    title: 'Put a playlist on',
    hint: 'Open RetroAmp and play AERO AMBIENCE. It pays for itself immediately.',
    progress: (state) => (state.retroamp.playlist !== null ? 1 : 0),
    detail: () => 'RetroAmp · nothing loaded',
  },
  {
    id: 'first-milestone',
    isDone: (state) => state.chat.bots >= CHAT_BOT.milestoneEvery,
    title: `${CHAT_BOT.milestoneEvery} buddies`,
    hint: `Every ${CHAT_BOT.milestoneEvery} buddies doubles the output of the whole buddy list.`,
    progress: (state) => ratio(state.chat.bots, CHAT_BOT.milestoneEvery),
    detail: (state) => `${state.chat.bots} / ${CHAT_BOT.milestoneEvery} buddies`,
  },
  installGoal('lemonwire', 'Seeded files pay Buzz around the clock, with no clicking.'),
  installGoal('shield99', 'Seeding attracts threats. Shield99 turns them into loot.'),
  {
    id: 'first-format',
    isDone: (state) => state.prestigeCount >= 1,
    title: 'Reach Format C:',
    hint: 'Wipe the machine, keep the Dollars, come back with better hardware.',
    progress: (state) => ratio(state.lifetimeBuzz, PRESTIGE.minLifetimeBuzz),
    detail: (state, { formatNumber }) =>
      `${formatNumber(Math.min(state.lifetimeBuzz, PRESTIGE.minLifetimeBuzz))} / ${formatNumber(
        PRESTIGE.minLifetimeBuzz,
      )} lifetime Buzz`,
  },
  {
    id: 'first-hardware',
    isDone: (state) =>
      state.hardware.cpu + state.hardware.ram + state.hardware.gpu + state.hardware.hdd + state.hardware.mobo >=
      1,
    isReady: (state) => state.tutorial.hardwareRevealed === true,
    title: 'Buy your first upgrade',
    hint: 'Dollars are spent in My Computer, and hardware survives every wipe.',
    progress: (state) => (state.dollars > 0 ? 1 : 0),
    detail: (state) => `$${state.dollars.toFixed(2)} banked`,
  },
  installGoal('aerosweeper', 'Sweep squares, bank a multiplier, spend it on the Nudge button.'),
  installGoal('aeroburn', 'Burn Buzz onto a disc that survives the next Format C:.'),
  installGoal('aerostudio', 'The longest render in the game, and the biggest single payout.'),
];

/**
 * Where the chain stops, and why it stops here rather than one entry later.
 *
 * "Fill the buddy list" used to be the last card: 500 buddies, which by then
 * costs on the order of 10^10 Buzz. That is an endgame achievement wearing a
 * tutorial costume. "Next up" carries an implicit promise that the thing in it is
 * reachable soon, and a queue whose final step is quietly four orders of
 * magnitude past every step before it breaks that promise — not loudly enough for
 * anyone to file it as a bug, just enough to make the desktop feel like it has
 * stopped answering.
 *
 * The milestone itself is untouched and is not hidden: AeroChat's own header
 * counts buddies, tracks the next multiplier and reads "buddy list full" when it
 * is reached, which is the surface that actually owns it. What is removed is the
 * framing.
 *
 * So the chain ends on a hand-off instead. No target and no bar — there is
 * nothing left to measure, and a progress bar with nothing behind it is the
 * thing being fixed. `isDone` is what the player says, not what the state says,
 * which is why this one is not in `GOALS`: it must never be counted as an
 * objective, and it must not park the coach on screen forever once acknowledged.
 */
export const CLOSING_GOAL = {
  id: 'onboarding-complete',
  title: "You're in control now",
  hint: 'Every app is installed and the machine is yours. Build the network your way.',
  isDone: (state) => state.tutorial.goalsDismissed === true,
};

/**
 * The one goal to show. First unmet, skipping anything not yet `isReady` —
 * "install Shield99" before the player has met a virus is a shopping list, not
 * an objective.
 *
 * Once the chain is exhausted it hands over with `CLOSING_GOAL`, and after that
 * returns `null`, which the coach reads as "there is nothing to nag about"
 * rather than as an error.
 */
export function currentGoal(state) {
  for (const goal of GOALS) {
    if (goal.isDone(state)) continue;
    if (goal.isReady && !goal.isReady(state)) continue;
    return goal;
  }
  return CLOSING_GOAL.isDone(state) ? null : CLOSING_GOAL;
}

/**
 * The goal plus its live numbers, which is what the UI actually wants. Kept
 * separate from `currentGoal` so a caller can ask "has the objective changed?"
 * without formatting anything.
 */
export function goalStatus(state, { formatNumber = String } = {}) {
  const goal = currentGoal(state);
  if (!goal) return null;
  return {
    id: goal.id,
    title: goal.title,
    hint: goal.hint,
    // The hand-off has neither, and says so with null rather than with a full
    // bar: the coach hides the meter instead of drawing a finished one.
    progress: goal.progress?.(state) ?? null,
    detail: goal.detail?.(state, { formatNumber }) ?? null,
  };
}

/**
 * How many goals are behind the player. Only used for the "n / total" readout —
 * it counts *completed* goals rather than the index of the current one, so an
 * objective that is skipped for not being ready yet does not silently advance
 * the counter and then walk it backwards later.
 */
export function goalsCompleted(state) {
  return GOALS.filter((goal) => goal.isDone(state)).length;
}

export const GOAL_COUNT = GOALS.length;
