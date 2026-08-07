import { describe, expect, it } from 'vitest';
import { GOALS, currentGoal, goalStatus, goalsCompleted } from '../src/core/goals.js';
import { createInitialState } from '../src/core/state.js';
import { APPS, getApp } from '../src/data/apps.js';
import { CHAT_BOT, PRESTIGE } from '../src/data/balance.js';

const fresh = () => createInitialState(0);

describe('the goal tracker', () => {
  it('opens on the first buddy', () => {
    expect(currentGoal(fresh()).id).toBe('first-buddy');
  });

  it('reports progress towards the first buddy in Buzz', () => {
    const state = fresh();
    state.buzz = CHAT_BOT.baseCost / 2;
    expect(goalStatus(state).progress).toBeCloseTo(0.5);
  });

  it('never reports progress outside 0..1', () => {
    const state = fresh();
    state.buzz = 1e9;
    const status = goalStatus(state);
    expect(status.progress).toBeLessThanOrEqual(1);
    expect(status.progress).toBeGreaterThanOrEqual(0);
  });

  it('moves on once a goal is met', () => {
    const state = fresh();
    state.chat.bots = 1;
    expect(currentGoal(state).id).toBe('ten-buddies');

    state.chat.bots = 10;
    // Ten buddies cost far more than RetroAmp's unlock threshold, so a player
    // who got here has earned the right to be shown it.
    state.runBuzz = getApp('retroamp').install.unlockAt;
    expect(currentGoal(state).id).toBe('install-retroamp');
  });

  /**
   * The reason `isReady` exists. Offering "install Shield99" to a player who
   * has not earned a tenth of its price is a shopping list, not an objective —
   * and it would sit there unmoved for the whole early game.
   */
  it('skips an app the run has not unlocked yet', () => {
    const state = fresh();
    state.chat.bots = 10;
    state.apps.retroamp.installed = true;
    state.retroamp.playlist = 'soft-signals';
    state.chat.bots = CHAT_BOT.milestoneEvery;
    state.runBuzz = 0;

    // LemonWire is next on the list but unreachable, so the tracker moves past
    // it rather than parking on an objective the player cannot act on.
    expect(currentGoal(state).id).not.toBe('install-lemonwire');

    state.runBuzz = getApp('lemonwire').install.unlockAt;
    expect(currentGoal(state).id).toBe('install-lemonwire');
  });

  it('counts completed goals rather than the current index', () => {
    const state = fresh();
    expect(goalsCompleted(state)).toBe(0);
    state.chat.bots = 10;
    // first-buddy and ten-buddies are both behind the player now.
    expect(goalsCompleted(state)).toBe(2);
  });

  it('measures the first Format C: against the prestige threshold', () => {
    const state = fresh();
    state.chat.bots = CHAT_BOT.maxPerRun;
    state.apps.retroamp.installed = true;
    state.retroamp.playlist = 'soft-signals';
    state.runBuzz = 0; // nothing else is unlocked
    state.lifetimeBuzz = PRESTIGE.minLifetimeBuzz / 2;

    const goal = currentGoal(state);
    expect(goal.id).toBe('first-format');
    expect(goal.progress(state)).toBeCloseTo(0.5);
  });

  it('runs out of goals rather than repeating the last one', () => {
    const state = fresh();
    state.chat.bots = CHAT_BOT.maxPerRun;
    state.apps.retroamp.installed = true;
    state.retroamp.playlist = 'soft-signals';
    state.prestigeCount = 1;
    state.hardware.cpu = 1;
    state.tutorial.hardwareRevealed = true;
    for (const app of APPS) state.apps[app.id].installed = true;

    expect(currentGoal(state)).toBeNull();
    expect(goalStatus(state)).toBeNull();
  });

  /**
   * The tracker is the only thing telling a player that an app exists, so a new
   * one added to the roster without a goal is an app nobody will ever be
   * pointed at. Pre-installed apps are exempt: there is nothing to buy.
   */
  it('covers every app on the roster that has to be bought', () => {
    const covered = new Set(GOALS.map((goal) => goal.id));
    for (const app of APPS) {
      if (app.install.cost === 0) continue;
      expect(covered.has(`install-${app.id}`)).toBe(true);
    }
  });

  it('has a stable id, title and hint on every goal', () => {
    const state = fresh();
    const ids = new Set();
    for (const goal of GOALS) {
      expect(goal.id).toBeTruthy();
      expect(ids.has(goal.id)).toBe(false);
      ids.add(goal.id);
      expect(typeof goal.title).toBe('string');
      expect(typeof goal.hint).toBe('string');
      expect(typeof goal.progress(state)).toBe('number');
      expect(typeof goal.detail(state, { formatNumber: String })).toBe('string');
    }
  });
});
