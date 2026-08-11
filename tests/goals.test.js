import { describe, expect, it } from 'vitest';
import { GOALS, GOAL_COUNT, currentGoal, goalStatus, goalsCompleted } from '../src/core/goals.js';
import { createInitialState } from '../src/core/state.js';
import { APPS, getApp } from '../src/data/apps.js';
import { BUILDING, PRESTIGE } from '../src/data/balance.js';
import { getBuilding } from '../src/data/buildings.js';

const AEROCHAT = getBuilding('aerochat');
const FIRST_MILESTONE = BUILDING.milestones[1];

const fresh = () => createInitialState(0);

describe('the goal tracker', () => {
  it('opens on the first buddy', () => {
    expect(currentGoal(fresh()).id).toBe('first-buddy');
  });

  it('reports progress towards the first buddy in Buzz', () => {
    const state = fresh();
    state.buzz = AEROCHAT.baseCost / 2;
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
    state.buildings.aerochat.units = 1;
    expect(currentGoal(state).id).toBe('ten-buddies');

    state.buildings.aerochat.units = 10;
    // Ten buddies cost far more than RetroAmp's unlock threshold, so a player
    // who got here has earned the right to be shown it.
    state.runBuzz = getApp('retroamp').install.unlockAt;
    expect(currentGoal(state).id).toBe('install-retroamp');
  });

  /**
   * The reason `isReady` exists. Offering "install GeoPage" to a player who has
   * not earned a thousandth of its price is a shopping list, not an objective —
   * and it would sit there unmoved for the whole early game.
   *
   * Written against the *next unreached install* rather than a named app, so
   * adding a building to the roster cannot silently retarget the assertion.
   */
  it('skips an app the run has not unlocked yet', () => {
    const state = fresh();
    state.buildings.aerochat.units = 10;
    state.apps.retroamp.installed = true;
    state.retroamp.playlist = 'soft-signals';
    state.buildings.aerochat.units = FIRST_MILESTONE.at;
    state.runBuzz = 0;

    // The next install is unreachable at runBuzz 0, so the tracker moves past
    // it rather than parking on an objective the player cannot act on.
    // Taken from the goal chain's own order, and skipping anything the fixture
    // has already installed — otherwise this picks RetroAmp, which is installed
    // two lines above.
    const nextInstall = GOALS.map((goal) => goal.id)
      .filter((id) => id.startsWith('install-'))
      .map((id) => getApp(id.slice('install-'.length)))
      .find((app) => !state.apps[app.id].installed);
    expect(currentGoal(state).id).not.toBe(`install-${nextInstall.id}`);

    // ...and it is offered the moment the run has earned its way there.
    state.runBuzz = nextInstall.install.unlockAt;
    expect(currentGoal(state).id).toBe(`install-${nextInstall.id}`);
  });

  it('counts completed goals rather than the current index', () => {
    const state = fresh();
    expect(goalsCompleted(state)).toBe(0);
    state.buildings.aerochat.units = 10;
    // first-buddy and ten-buddies are both behind the player now.
    expect(goalsCompleted(state)).toBe(2);
  });

  it('measures the first Format C: against the prestige threshold', () => {
    const state = fresh();
    state.buildings.aerochat.units = 500;
    state.apps.retroamp.installed = true;
    state.retroamp.playlist = 'soft-signals';
    state.runBuzz = 0; // nothing else is unlocked
    state.lifetimeBuzz = PRESTIGE.minLifetimeBuzz / 2;

    const goal = currentGoal(state);
    expect(goal.id).toBe('first-format');
    expect(goal.progress(state)).toBeCloseTo(0.5);
  });

  it('completes the first-hardware goal on a mainboard-only purchase', () => {
    const state = fresh();
    state.tutorial.hardwareRevealed = true;
    state.buildings.aerochat.units = 10;
    state.hardware.mobo = 1;

    const goal = GOALS.find((g) => g.id === 'first-hardware');
    expect(goal.isDone(state)).toBe(true);
  });

  /** Everything on the chain done, with the closing card not yet acknowledged. */
  const finished = () => {
    const state = fresh();
    state.apps.retroamp.installed = true;
    state.retroamp.playlist = 'soft-signals';
    state.buildings.aerochat.units = FIRST_MILESTONE.at;
    state.prestigeCount = 1;
    state.hardware.cpu = 1;
    state.tutorial.hardwareRevealed = true;
    for (const app of APPS) state.apps[app.id].installed = true;
    return state;
  };

  /**
   * The chain used to end on "fill the buddy list" — 500 buddies, which is an
   * endgame achievement rather than a next step. It hands over instead, and the
   * hand-off is not an objective: no target, no bar, nothing to measure.
   */
  it('ends the chain with a hand-off rather than an endgame target', () => {
    const state = finished();

    expect(currentGoal(state).id).toBe('onboarding-complete');
    const status = goalStatus(state);
    expect(status.progress).toBeNull();
    expect(status.detail).toBeNull();
  });

  it('does not count the hand-off as a goal', () => {
    const state = finished();
    expect(GOALS.some((goal) => goal.id === 'onboarding-complete')).toBe(false);
    expect(goalsCompleted(state)).toBe(GOAL_COUNT);
  });

  it('runs out of goals rather than repeating the last one', () => {
    const state = finished();
    state.tutorial.goalsDismissed = true;

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
