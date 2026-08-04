import { describe, expect, it } from 'vitest';
import {
  TUTORIAL_STEPS,
  advanceTutorial,
  currentStep,
  resumeTutorial,
  revealHardware,
  shouldRevealHardware,
  skipTutorial,
  stepNumber,
} from '../src/core/tutorial.js';
import { createInitialState, resetForPrestige } from '../src/core/state.js';
import { TUTORIAL } from '../src/data/balance.js';

const fresh = () => createInitialState(0);

/** Satisfy every step up to (not including) `id`. */
function progressTo(state, id) {
  const target = TUTORIAL_STEPS.findIndex((s) => s.id === id);
  const doIt = {
    nudge: () => (state.stats.nudges = 1),
    'first-buddy': () => (state.chat.bots = 1),
    'install-retroamp': () => (state.apps.retroamp.installed = true),
    'load-playlist': () => (state.retroamp.playlist = 'soft-signals'),
    bottleneck: () => (state.tutorial.hardwareRevealed = true),
  };
  for (let i = 0; i < target; i += 1) doIt[TUTORIAL_STEPS[i].id]();
  advanceTutorial(state);
  return state;
}

describe('a fresh desktop', () => {
  it('starts on the first step with hardware hidden', () => {
    const s = fresh();
    expect(currentStep(s).id).toBe('nudge');
    expect(s.tutorial.hardwareRevealed).toBe(false);
    expect(stepNumber(s)).toBe(1);
  });

  it('follows the GDD order: AeroChat, then RetroAmp, then the bottleneck', () => {
    expect(TUTORIAL_STEPS.map((s) => s.id)).toEqual([
      'nudge',
      'first-buddy',
      'install-retroamp',
      'load-playlist',
      'bottleneck',
    ]);
  });
});

describe('advancing', () => {
  it('does not move until the player actually acts', () => {
    const s = fresh();
    expect(advanceTutorial(s)).toEqual([]);
    expect(currentStep(s).id).toBe('nudge');
  });

  it('completes a step once its condition holds', () => {
    const s = fresh();
    s.stats.nudges = 1;
    const completed = advanceTutorial(s);
    expect(completed.map((c) => c.id)).toEqual(['nudge']);
    expect(currentStep(s).id).toBe('first-buddy');
  });

  it('skips over several steps at once if the player got ahead', () => {
    const s = fresh();
    s.stats.nudges = 5;
    s.chat.bots = 3;
    s.apps.retroamp.installed = true;
    const completed = advanceTutorial(s);
    expect(completed.map((c) => c.id)).toEqual(['nudge', 'first-buddy', 'install-retroamp']);
  });

  it('finishes after the last step', () => {
    const s = progressTo(fresh(), 'bottleneck');
    s.tutorial.hardwareRevealed = true;
    advanceTutorial(s);
    expect(s.tutorial.done).toBe(true);
    expect(currentStep(s)).toBeNull();
  });

  it('is inert once done', () => {
    const s = fresh();
    skipTutorial(s);
    expect(advanceTutorial(s)).toEqual([]);
  });
});

describe('the hardware reveal', () => {
  it('holds off while memory is comfortable', () => {
    // AeroChat + RetroAmp on a stock machine is 96/128 — not a bottleneck yet.
    expect(shouldRevealHardware(fresh(), 96, 128)).toBe(false);
  });

  it('fires once the machine is nearly full', () => {
    expect(shouldRevealHardware(fresh(), 128, 128)).toBe(true);
    expect(TUTORIAL.bottleneckRamRatio).toBeGreaterThan(96 / 128);
  });

  it('only fires once', () => {
    const s = fresh();
    expect(revealHardware(s)).toBe(true);
    expect(revealHardware(s)).toBe(false);
    expect(shouldRevealHardware(s, 128, 128)).toBe(false);
  });
});

describe('skipping', () => {
  it('finishes the script and hands over the hardware', () => {
    const s = fresh();
    skipTutorial(s);
    expect(s.tutorial.done).toBe(true);
    expect(s.tutorial.hardwareRevealed).toBe(true);
    expect(currentStep(s)).toBeNull();
  });
});

describe('resuming a save', () => {
  it('leaves a genuine first-timer at the start', () => {
    const s = fresh();
    resumeTutorial(s);
    expect(s.tutorial.done).toBe(false);
    expect(currentStep(s).id).toBe('nudge');
  });

  it('catches up a save that already satisfies early steps', () => {
    const s = fresh();
    s.stats.nudges = 2;
    resumeTutorial(s);
    expect(currentStep(s).id).toBe('first-buddy');
  });

  it('never drops an experienced player back into onboarding', () => {
    for (const patch of [
      { prestigeCount: 1 },
      { dollarsEarnedTotal: 4 },
      { lifetimeBuzz: TUTORIAL.experiencedBuzz },
    ]) {
      const s = Object.assign(fresh(), patch);
      resumeTutorial(s);
      expect(s.tutorial.done).toBe(true);
      expect(s.tutorial.hardwareRevealed).toBe(true);
    }
  });

  it('treats a big buddy list as experience', () => {
    const s = fresh();
    s.chat.bots = TUTORIAL.experiencedBuddies;
    resumeTutorial(s);
    expect(s.tutorial.done).toBe(true);
  });

  it('keeps hardware visible for a finished tutorial from an older save', () => {
    const s = fresh();
    s.tutorial = { step: 5, done: true }; // no hardwareRevealed field at all
    resumeTutorial(s);
    expect(s.tutorial.hardwareRevealed).toBe(true);
  });
});

describe('prestige', () => {
  it('does not replay the tutorial after Format C:', () => {
    const s = fresh();
    skipTutorial(s);
    s.lifetimeBuzz = 1_000_000;

    const after = resetForPrestige(s, 10, 0);
    expect(after.tutorial.done).toBe(true);
    expect(after.tutorial.hardwareRevealed).toBe(true);
    expect(currentStep(after)).toBeNull();
  });
});
