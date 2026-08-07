import { describe, expect, it } from 'vitest';
import {
  TUTORIAL_STEPS,
  advanceTutorial,
  currentStep,
  resumeTutorial,
  revealHardware,
  shouldRevealHardware,
  skipTutorial,
  stepGate,
  stepNumber,
} from '../src/core/tutorial.js';
import { createInitialState, resetForPrestige } from '../src/core/state.js';
import { botCost } from '../src/core/economy.js';
import { getApp } from '../src/data/apps.js';
import { PLAYLISTS, getPlaylist } from '../src/data/playlists.js';
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
    'my-computer': () => (state.apps.system.open = true),
  };
  for (let i = 0; i < target; i += 1) doIt[TUTORIAL_STEPS[i].id]();
  advanceTutorial(state);
  return state;
}

describe('the copy', () => {
  /**
   * The playlists have been renamed once already — "IRON OVERDRIVE" is "P2P
   * DOWNLOADER" now — and the tutorial went on telling players to click a name
   * that appears nowhere on screen. Nothing here may hardcode one.
   */
  it('names playlists from the data, not from memory', () => {
    const script = TUTORIAL_STEPS.map((s) => `${s.hint} ${s.cta}`).join(' ');
    for (const playlist of PLAYLISTS) {
      if (!script.includes(playlist.id) && !script.includes(playlist.name)) continue;
      expect(script).toContain(playlist.name);
    }
    expect(script).toContain(getPlaylist('soft-signals').name);
    expect(script).toContain(getPlaylist('iron-overdrive').name);
  });

  it('gives every step something to say and something to point at', () => {
    for (const step of TUTORIAL_STEPS) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.hint.length).toBeGreaterThan(0);
      // The cue is read in about a second; anything longer is skipped past.
      expect(step.cta.split(' ').length).toBeLessThanOrEqual(6);
    }
  });
});

describe('a fresh desktop', () => {
  it('starts on the first step with hardware hidden', () => {
    const s = fresh();
    expect(currentStep(s).id).toBe('nudge');
    expect(s.tutorial.hardwareRevealed).toBe(false);
    expect(stepNumber(s)).toBe(1);
  });

  it('follows the GDD order: AeroChat, RetroAmp, the bottleneck, the hardware', () => {
    expect(TUTORIAL_STEPS.map((s) => s.id)).toEqual([
      'nudge',
      'first-buddy',
      'install-retroamp',
      'load-playlist',
      'bottleneck',
      'my-computer',
    ]);
  });
});

/**
 * The dead end this fixes: the script advanced off a single Nudge — one click,
 * one Buzz — and then asked for a buddy costing ten, and later a RetroAmp
 * costing fifty. The arrow pointed at a button the player could not press,
 * twice, with nothing on screen saying why.
 */
describe('affordability gates', () => {
  it('does not gate the opening step — nudging is free', () => {
    expect(stepGate(fresh())).toBeNull();
  });

  it('reports the shortfall on a buddy the player cannot afford', () => {
    const s = progressTo(fresh(), 'first-buddy');
    s.buzz = 1;

    const gate = stepGate(s);
    expect(gate.stepId).toBe('first-buddy');
    expect(gate.needed).toBe(botCost(0));
    expect(gate.have).toBe(1);
    expect(gate.short).toBe(botCost(0) - 1);
    expect(gate.progress).toBeCloseTo(1 / botCost(0));
  });

  it('lifts once the Buzz is there', () => {
    const s = progressTo(fresh(), 'first-buddy');
    s.buzz = botCost(0);
    expect(stepGate(s)).toBeNull();
  });

  it('gates RetroAmp on its install price too', () => {
    const s = progressTo(fresh(), 'install-retroamp');
    s.buzz = 0;

    const gate = stepGate(s);
    expect(gate.stepId).toBe('install-retroamp');
    expect(gate.needed).toBe(getApp('retroamp').install.cost);

    s.buzz = gate.needed;
    expect(stepGate(s)).toBeNull();
  });

  it('leaves the steps that cost nothing alone', () => {
    for (const id of ['load-playlist', 'bottleneck', 'my-computer']) {
      const s = progressTo(fresh(), id);
      s.buzz = 0;
      expect(stepGate(s)).toBeNull();
    }
  });

  /** A gate delays what the coach *points at*, never the script itself. */
  it('never blocks a step from completing', () => {
    const s = progressTo(fresh(), 'first-buddy');
    s.buzz = 0;
    expect(stepGate(s)).not.toBeNull();

    s.chat.bots = 1; // bought with Buzz that has since been spent
    advanceTutorial(s);
    expect(currentStep(s).id).toBe('install-retroamp');
  });

  it('has nothing to gate once the tour is over', () => {
    const s = fresh();
    skipTutorial(s);
    expect(stepGate(s)).toBeNull();
  });

  it('prices the gate off the live cost, not a constant', () => {
    const s = progressTo(fresh(), 'first-buddy');
    s.chat.bots = 0;
    s.buzz = 0;
    const first = stepGate(s).needed;

    // A player who bought and lost buddies faces the curve, not the sticker.
    s.chat.bots = 5;
    expect(stepGate(s).needed).toBeGreaterThan(first);
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
    const s = progressTo(fresh(), 'my-computer');
    s.apps.system.open = true;
    advanceTutorial(s);
    expect(s.tutorial.done).toBe(true);
    expect(currentStep(s)).toBeNull();
  });

  /**
   * The tour used to end on the bottleneck, which revealed the hardware and
   * then said nothing about it — leaving the player looking at a memory bar
   * they had just been told was the problem, with no idea that hardware is
   * something you buy, or where.
   */
  it('ends by opening My Computer, not on the bottleneck', () => {
    const s = progressTo(fresh(), 'my-computer');
    expect(s.tutorial.done).toBe(false);
    expect(currentStep(s).id).toBe('my-computer');
    expect(s.tutorial.hardwareRevealed).toBe(true);
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
