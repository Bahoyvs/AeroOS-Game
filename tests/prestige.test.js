import { describe, expect, it } from 'vitest';
import * as econ from '../src/core/economy.js';
import { createGame } from '../src/core/game.js';
import { createMemoryStorage } from '../src/core/save.js';
import { createInitialState } from '../src/core/state.js';
import { PRESTIGE } from '../src/data/balance.js';

const withLifetime = (lifetimeBuzz, patch = {}) =>
  Object.assign(createInitialState(0), { lifetimeBuzz }, patch);

describe('the Dollars curve (AO-16)', () => {
  it('pays nothing until the run is worth something', () => {
    expect(econ.lifetimeDollarValue(withLifetime(PRESTIGE.minLifetimeBuzz - 1))).toBe(0);
    expect(econ.lifetimeDollarValue(withLifetime(PRESTIGE.minLifetimeBuzz))).toBeGreaterThan(0);
  });

  it('grows with the square root of lifetime Buzz', () => {
    // Four times the Buzz is twice the Dollars.
    const one = econ.lifetimeDollarValue(withLifetime(1_000_000));
    const four = econ.lifetimeDollarValue(withLifetime(4_000_000));
    expect(four / one).toBeCloseTo(2, 1);
  });

  it('buzzForDollars inverts the curve above the payout floor', () => {
    for (const dollars of [5, 25, 100]) {
      const buzz = econ.buzzForDollars(dollars);
      expect(econ.lifetimeDollarValue(withLifetime(buzz))).toBeCloseTo(dollars, 1);
    }
  });

  it('never asks for less Buzz than the payout floor', () => {
    // Below the floor the inverse clamps: the threshold is already worth more
    // than $1, so $1 is not a payout anybody can actually receive.
    expect(econ.buzzForDollars(0.01)).toBe(PRESTIGE.minLifetimeBuzz);
    expect(econ.buzzForDollars(1)).toBe(PRESTIGE.minLifetimeBuzz);
    expect(econ.buzzForDollars(0)).toBe(0);
    expect(econ.FIRST_PAYOUT).toBeGreaterThan(1);
  });

  it('aims a brand-new player at the first real payout, not at $1', () => {
    const progress = econ.dollarProgress(withLifetime(0));
    expect(progress.first).toBe(true);
    expect(progress.nextDollar).toBe(econ.FIRST_PAYOUT);
    expect(progress.buzzNeeded).toBe(PRESTIGE.minLifetimeBuzz);

    const half = econ.dollarProgress(withLifetime(PRESTIGE.minLifetimeBuzz / 2));
    expect(half.ratio).toBeCloseTo(0.5);
  });
});

describe('progress toward the next Dollar', () => {
  it('reports the gap in Buzz and a ratio for the bar', () => {
    const progress = econ.dollarProgress(withLifetime(econ.buzzForDollars(3)));
    expect(progress.earned).toBeCloseTo(3, 1);
    expect(progress.nextDollar).toBe(4);
    expect(progress.buzzNeeded).toBeGreaterThan(0);
    expect(progress.ratio).toBeGreaterThanOrEqual(0);
    expect(progress.ratio).toBeLessThanOrEqual(1);
  });

  it('the ratio fills as Buzz accumulates', () => {
    const from = econ.buzzForDollars(3);
    const to = econ.buzzForDollars(4);
    const early = econ.dollarProgress(withLifetime(from + (to - from) * 0.25));
    const late = econ.dollarProgress(withLifetime(from + (to - from) * 0.75));

    expect(early.ratio).toBeCloseTo(0.25, 1);
    expect(late.ratio).toBeGreaterThan(early.ratio);
    expect(late.buzzNeeded).toBeLessThan(early.buzzNeeded);
  });

  it('stays inside its bounds below the minimum', () => {
    const progress = econ.dollarProgress(withLifetime(0));
    expect(progress.earned).toBe(0);
    expect(progress.pending).toBe(0);
    expect(progress.ratio).toBeGreaterThanOrEqual(0);
    expect(progress.ratio).toBeLessThanOrEqual(1);
  });
});

describe('requesting a Format C: (AO-17)', () => {
  const rich = () => {
    const game = createGame({ storage: createMemoryStorage(), now: 0 });
    game.state.lifetimeBuzz = PRESTIGE.minLifetimeBuzz * 400;
    return game;
  };

  it('announces the intent without changing anything', () => {
    const game = rich();
    let requested = null;
    game.bus.on(game.events.FORMAT_REQUESTED, (payload) => (requested = payload));

    const before = { ...game.state.hardware, buzz: game.state.buzz };
    const result = game.requestFormat();

    expect(result.ok).toBe(true);
    expect(requested.dollars).toBeCloseTo(econ.pendingPrestigeDollars(game.state));
    // Nothing is wiped until the sequence calls formatC().
    expect(game.state.prestigeCount).toBe(0);
    expect(game.state.buzz).toBe(before.buzz);
  });

  it('refuses when the run has not earned a payout', () => {
    const game = createGame({ storage: createMemoryStorage(), now: 0 });
    let fired = 0;
    game.bus.on(game.events.FORMAT_REQUESTED, () => (fired += 1));

    expect(game.requestFormat()).toEqual({ ok: false, reason: 'not-worth-it' });
    expect(fired).toBe(0);
  });

  it('the wipe keeps hardware and banks the Dollars it promised', () => {
    const game = rich();
    game.state.hardware.cpu = 2;
    game.state.chat.bots = 40;
    game.state.apps.retroamp.installed = true;

    const promised = game.requestFormat().dollars;
    const result = game.formatC();

    expect(result.dollars).toBeCloseTo(promised);
    expect(game.state.dollars).toBeCloseTo(promised);
    expect(game.state.hardware.cpu).toBe(2);
    expect(game.state.chat.bots).toBe(0);
    expect(game.state.apps.retroamp.installed).toBe(false);
    expect(game.state.prestigeCount).toBe(1);
  });

  it('leaves the machine the reboot screen reports', () => {
    const game = rich();
    game.state.hardware.ram = 2;
    game.formatC();
    expect(game.econ.ramCapacity(game.state)).toBe(512);
  });

  it('a second Format C: straight away is refused', () => {
    const game = rich();
    game.formatC();
    expect(game.requestFormat()).toEqual({ ok: false, reason: 'not-worth-it' });
  });

  it('repeated formats never pay for the same Buzz twice', () => {
    const game = rich();
    let banked = 0;
    for (let i = 0; i < 3; i += 1) {
      banked += game.formatC().dollars ?? 0;
      game.state.lifetimeBuzz *= 4;
    }
    expect(banked).toBeCloseTo(game.state.dollarsEarnedTotal);
    expect(game.state.dollarsEarnedTotal).toBeLessThanOrEqual(
      econ.lifetimeDollarValue(game.state) + 0.01,
    );
  });
});
