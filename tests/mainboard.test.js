import { describe, expect, it } from 'vitest';
import * as econ from '../src/core/economy.js';
import { createGame } from '../src/core/game.js';
import { createMemoryStorage } from '../src/core/save.js';
import { createInitialState } from '../src/core/state.js';
import { MOBO_TIERS } from '../src/data/hardware.js';
import { PRESTIGE } from '../src/data/balance.js';

const withBoard = (mobo, lifetimeBuzz = 0) => {
  const s = createInitialState(0);
  s.hardware.mobo = mobo;
  s.lifetimeBuzz = lifetimeBuzz;
  return s;
};

describe('the Mainboard track', () => {
  it('leaves a stock machine on exactly the old curve', () => {
    const s = withBoard(0, 1_000_000);
    expect(econ.prestigeDivisor(s)).toBe(PRESTIGE.divisor);
    expect(econ.lifetimeDollarValue(s)).toBeCloseTo(
      Math.floor(Math.sqrt(1_000_000 / PRESTIGE.divisor) * 100) / 100,
    );
  });

  it('pays exactly the percentage the shop row advertises', () => {
    // The whole reason the track is written in payout rather than in divisor:
    // "+20% Format C: payout" has to be the number actually applied (AO-19).
    const lifetime = 4_000_000;
    const stock = econ.lifetimeDollarValue(withBoard(0, lifetime));

    for (let tier = 1; tier < MOBO_TIERS.length; tier += 1) {
      const advertised = MOBO_TIERS.slice(0, tier + 1).reduce((sum, t) => sum + t.payout, 0);
      const actual = econ.lifetimeDollarValue(withBoard(tier, lifetime)) / stock;
      expect(actual).toBeCloseTo(1 + advertised, 2);
    }
  });

  it('lands on the divisors the design was written against', () => {
    const divisors = MOBO_TIERS.map((_, tier) => Math.round(econ.prestigeDivisor(withBoard(tier))));
    expect(divisors).toEqual([1000, 826, 592, 309]);
  });

  it('states the gain as a payout percentage in the shop', () => {
    const row = econ.hardwareSummary(withBoard(0)).find((r) => r.track === 'mobo');
    expect(row.gains).toEqual(['+10% Format C: payout']);
    expect(row.cost).toBe(MOBO_TIERS[1].cost);
  });

  it('keeps the inverse curve honest, so the progress bar still fills', () => {
    const s = withBoard(2, 0);
    const divisor = econ.prestigeDivisor(s);
    for (const dollars of [5, 25, 100]) {
      const buzz = econ.buzzForDollars(dollars, divisor);
      expect(econ.lifetimeDollarValue({ ...s, lifetimeBuzz: buzz })).toBeCloseTo(dollars, 1);
    }

    const progress = econ.dollarProgress({ ...s, lifetimeBuzz: econ.buzzForDollars(3, divisor) });
    expect(progress.earned).toBeCloseTo(3, 1);
    expect(progress.nextDollar).toBe(4);
    expect(progress.ratio).toBeGreaterThanOrEqual(0);
    expect(progress.ratio).toBeLessThanOrEqual(1);
  });

  it('re-prices the whole history, so a purchase moves the pending payout', () => {
    const game = createGame({ storage: createMemoryStorage(), now: 0 });
    game.state.lifetimeBuzz = PRESTIGE.minLifetimeBuzz * 4000;
    game.state.dollars = 1000;

    const before = econ.pendingPrestigeDollars(game.state);
    game.buyHardware('mobo');
    const after = econ.pendingPrestigeDollars(game.state);

    expect(after).toBeGreaterThan(before);
    expect(after / before).toBeCloseTo(1 + MOBO_TIERS[1].payout, 2);
  });

  it('still never pays for the same Buzz twice, upgrade or no upgrade', () => {
    const game = createGame({ storage: createMemoryStorage(), now: 0 });
    game.state.lifetimeBuzz = PRESTIGE.minLifetimeBuzz * 400;
    game.state.dollars = 1000;

    let banked = 0;
    for (let i = 0; i < 3; i += 1) {
      banked += game.formatC().dollars ?? 0;
      game.state.lifetimeBuzz *= 4;
      game.buyHardware('mobo');
    }

    expect(banked).toBeCloseTo(game.state.dollarsEarnedTotal);
    expect(game.state.dollarsEarnedTotal).toBeLessThanOrEqual(
      econ.lifetimeDollarValue(game.state) + 0.01,
    );
  });

  it('survives the wipe and counts against Dollars spent', () => {
    const game = createGame({ storage: createMemoryStorage(), now: 0 });
    game.state.dollars = 100;
    game.buyHardware('mobo');
    expect(game.state.dollarsSpentTotal).toBeCloseTo(MOBO_TIERS[1].cost);

    game.state.lifetimeBuzz = PRESTIGE.minLifetimeBuzz * 400;
    game.formatC();
    expect(game.state.hardware.mobo).toBe(1);
    expect(game.state.dollarsSpentTotal).toBeCloseTo(MOBO_TIERS[1].cost);
  });
});
