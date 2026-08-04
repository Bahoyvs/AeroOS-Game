import { TUTORIAL } from '../data/balance.js';

/**
 * Hard-scripted onboarding for the first minute (AO-12, GDD 7).
 *
 * The desktop starts clean with only AeroChat. Each step completes on something
 * the player *did*, never on a timer, so the tutorial can never run ahead of
 * them. Hardware (My Computer, the CPU/RAM readouts) stays hidden until the
 * first system bottleneck — which is what the heavy playlist is for.
 *
 * Pure: steps are predicates over state, and advancing returns what changed.
 */
export const TUTORIAL_STEPS = [
  {
    id: 'nudge',
    title: 'Say something',
    hint: 'Hit NUDGE to earn your first Buzz.',
    isDone: (state) => state.stats.nudges >= 1,
  },
  {
    id: 'first-buddy',
    title: 'Get someone online',
    hint: 'Add a buddy in AeroChat. Buddies keep chatting while you idle.',
    isDone: (state) => state.chat.bots >= 1,
  },
  {
    id: 'install-retroamp',
    title: 'Put music on',
    hint: 'RetroAmp is in the Start menu now. Install it.',
    isDone: (state) => state.apps.retroamp.installed === true,
  },
  {
    id: 'load-playlist',
    title: 'Load a playlist',
    hint: 'Open RetroAmp and play SOFT SIGNALS for a permanent boost.',
    isDone: (state) => state.retroamp.playlist !== null,
  },
  {
    id: 'bottleneck',
    title: 'Find the ceiling',
    hint: 'Now try IRON OVERDRIVE. Heavy playlists need serious memory.',
    isDone: (state) => state.tutorial.hardwareRevealed === true,
  },
];

export function currentStep(state) {
  if (state.tutorial.done) return null;
  return TUTORIAL_STEPS[state.tutorial.step] ?? null;
}

export function stepNumber(state) {
  return Math.min(state.tutorial.step + 1, TUTORIAL_STEPS.length);
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
