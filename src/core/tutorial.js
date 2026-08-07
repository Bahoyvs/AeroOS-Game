import { TUTORIAL } from '../data/balance.js';
import { getApp } from '../data/apps.js';
import { getPlaylist } from '../data/playlists.js';
import { botCost } from './economy.js';

// Read the playlist names rather than repeating them. They have been renamed
// once already — "IRON OVERDRIVE" is "P2P DOWNLOADER" now — and a tutorial
// telling the player to click something that is not on screen anywhere is a
// worse failure than a slightly indirect constant.
const STARTER = getPlaylist('soft-signals');
const HEAVY = getPlaylist('iron-overdrive');

/**
 * Hard-scripted onboarding for the first minute (AO-12, GDD 7).
 *
 * The desktop starts clean with only AeroChat. Each step completes on something
 * the player *did*, never on a timer, so the tutorial can never run ahead of
 * them. Hardware (My Computer, the CPU/RAM readouts) stays hidden until the
 * first system bottleneck — which is what the heavy playlist is for.
 *
 * Pure: steps are predicates over state, and advancing returns what changed.
 *
 * `cta` is the imperative the spotlight puts next to its arrow (`ui/spotlight.js`).
 * It is deliberately shorter than `hint` — a label attached to a bouncing arrow
 * is read in about a second, and anything that does not fit in four or five
 * words is a sentence the player will skip past on the way to clicking.
 *
 * `cost` is what the step needs before it can be attempted at all, and it is
 * the difference between a tutorial and a dead end. Two of these steps ask the
 * player to *spend* — a buddy is 10 Buzz, RetroAmp is 50 — and a script that
 * says "add a buddy" to somebody holding 1 Buzz has stopped teaching and
 * started lying. When the Buzz is short the coach shows the shortfall with a
 * bar and sends them back to the Nudge button instead (see `stepGate`).
 */
export const TUTORIAL_STEPS = [
  {
    id: 'nudge',
    title: 'Say something',
    hint: 'Hit NUDGE to earn your first Buzz.',
    cta: 'Click NUDGE',
    isDone: (state) => state.stats.nudges >= 1,
  },
  {
    id: 'first-buddy',
    title: 'Get someone online',
    hint: 'Add a buddy in AeroChat. Buddies keep chatting while you idle.',
    cta: 'Add your first buddy',
    cost: (state) => botCost(state.chat.bots),
    shortOf: (needed) => `A buddy costs ${needed} Buzz. Keep nudging until you can afford one.`,
    isDone: (state) => state.chat.bots >= 1,
  },
  {
    id: 'install-retroamp',
    title: 'Put music on',
    hint: 'RetroAmp is in the Start menu now. Install it.',
    cta: 'Open Start → install RetroAmp',
    cost: () => getApp('retroamp').install.cost,
    shortOf: (needed) =>
      `RetroAmp costs ${needed} Buzz. Keep nudging — your buddies are earning too.`,
    isDone: (state) => state.apps.retroamp.installed === true,
  },
  {
    id: 'load-playlist',
    title: 'Load a playlist',
    hint: `Open RetroAmp and play ${STARTER.name} for a permanent boost.`,
    cta: `Play ${STARTER.name}`,
    isDone: (state) => state.retroamp.playlist !== null,
  },
  {
    id: 'bottleneck',
    title: 'Find the ceiling',
    hint: `Now try ${HEAVY.name}. Heavy playlists need serious memory.`,
    cta: `Try ${HEAVY.name}`,
    isDone: (state) => state.tutorial.hardwareRevealed === true,
  },
  /**
   * The step the tour was missing.
   *
   * The bottleneck reveals the hardware and then the tutorial simply stopped,
   * leaving the player looking at a memory bar they have just been told is the
   * problem, with no idea that CPU, RAM and disk are things you *buy*, that
   * they are bought with Dollars rather than Buzz, or that Dollars come from
   * Format C:. All three of those live behind one icon, and the tour now ends
   * by opening it. Free, immediate, and it is the door to the whole meta-game.
   */
  {
    id: 'my-computer',
    title: 'Meet your hardware',
    hint: 'My Computer is where CPU, RAM and disk are bought — and where Format C: lives.',
    cta: 'Open My Computer',
    isDone: (state) => state.apps.system?.open === true,
  },
];

export function currentStep(state) {
  if (state.tutorial.done) return null;
  return TUTORIAL_STEPS[state.tutorial.step] ?? null;
}

export function stepNumber(state) {
  return Math.min(state.tutorial.step + 1, TUTORIAL_STEPS.length);
}

/**
 * The shortfall standing between the player and the current objective, or
 * `null` when there is none.
 *
 * This is the fix for the tutorial's one real dead end. The script used to
 * advance off the first Nudge — one click, one Buzz — and then ask for a buddy
 * that costs ten, and later for a RetroAmp that costs fifty. Both times the
 * arrow pointed at a button the player could not press, with nothing on screen
 * explaining why, and "the tutorial is broken" is a reasonable conclusion to
 * draw from that.
 *
 * So an objective the player cannot yet afford is not shown as an objective.
 * It becomes a *goal with a bar*: how much is needed, how much is banked, and
 * the button that closes the gap. The step itself does not change and nothing
 * is skipped — only what the coach is pointing at.
 */
export function stepGate(state) {
  const step = currentStep(state);
  if (!step?.cost) return null;

  const needed = step.cost(state);
  if (state.buzz >= needed) return null;

  return {
    stepId: step.id,
    needed,
    have: state.buzz,
    short: needed - state.buzz,
    progress: needed <= 0 ? 1 : Math.max(0, Math.min(state.buzz / needed, 1)),
    // Each step words its own shortfall, because "Get someone online costs 10
    // Buzz" is what a generic sentence built from an imperative title reads
    // like, and the coach is the one surface where the copy has to be right.
    hint: step.shortOf?.(needed) ?? `This costs ${needed} Buzz. Keep nudging until you have it.`,
  };
}

export const TUTORIAL_STEP_COUNT = TUTORIAL_STEPS.length;

/**
 * Advance past every step whose condition is now satisfied. Returns the steps
 * completed by this call so the caller can announce them.
 */
export function advanceTutorial(state) {
  if (state.tutorial.done) return [];

  const completed = [];
  while (state.tutorial.step < TUTORIAL_STEPS.length) {
    const step = TUTORIAL_STEPS[state.tutorial.step];
    if (!step.isDone(state)) break;
    completed.push(step);
    state.tutorial.step += 1;
  }
  if (state.tutorial.step >= TUTORIAL_STEPS.length) state.tutorial.done = true;
  return completed;
}

/**
 * The first memory bottleneck: an out-of-memory refusal, or simply running the
 * machine close enough to full. Reveals the hardware the player now needs.
 */
export function shouldRevealHardware(state, ramUsed, ramCapacity) {
  if (state.tutorial.hardwareRevealed) return false;
  return ramUsed / ramCapacity >= TUTORIAL.bottleneckRamRatio;
}

export function revealHardware(state) {
  if (state.tutorial.hardwareRevealed) return false;
  state.tutorial.hardwareRevealed = true;
  return true;
}

/** Skip button: finish the script and hand over the whole desktop. */
export function skipTutorial(state) {
  state.tutorial.step = TUTORIAL_STEPS.length;
  state.tutorial.done = true;
  state.tutorial.hardwareRevealed = true;
}

/**
 * Called on load. A save from before the tutorial existed — or one that is
 * clearly mid-game — must not be dropped back into onboarding with its My
 * Computer icon taken away.
 */
export function resumeTutorial(state) {
  if (state.tutorial.done) {
    state.tutorial.hardwareRevealed = true;
    return;
  }
  const experienced =
    state.prestigeCount > 0 ||
    state.dollarsEarnedTotal > 0 ||
    state.lifetimeBuzz >= TUTORIAL.experiencedBuzz ||
    state.chat.bots >= TUTORIAL.experiencedBuddies;

  if (experienced) skipTutorial(state);
  else advanceTutorial(state);
}
