import { describe, expect, it } from 'vitest';
import { createGame } from '../src/core/game.js';
import { createMemoryStorage } from '../src/core/save.js';
import { clickPower, clickStreak } from '../src/core/economy.js';
import { createInitialState } from '../src/core/state.js';
import { CLICK } from '../src/data/balance.js';

const fresh = () => createInitialState(0);
const game = () => createGame({ storage: createMemoryStorage(), now: 0 });

const WINDOW_MS = CLICK.streak.windowSeconds * 1000;

describe('the Nudge streak', () => {
  it('is inert on a fresh state', () => {
    const streak = clickStreak(fresh(), 0);
    expect(streak.count).toBe(0);
    expect(streak.multiplier).toBe(1);
    expect(streak.active).toBe(false);
  });

  /**
   * A single considered press has to pay exactly what the button advertises, or
   * the "+N" readout is lying to a player who is not clicking fast.
   */
  it('pays nothing extra for the first click of a streak', () => {
    const g = game();
    const base = clickPower(g.state, 0);
    expect(g.nudge(0)).toBeCloseTo(base);
  });

  it('grows with each click inside the window', () => {
    const g = game();
    g.nudge(0);
    g.nudge(100);
    g.nudge(200);
    const streak = clickStreak(g.state, 200);
    expect(streak.count).toBe(3);
    expect(streak.multiplier).toBeCloseTo(1 + 2 * CLICK.streak.perClick);
  });

  it('pays the click that earned it', () => {
    const g = game();
    g.nudge(0);
    const second = g.nudge(100);
    expect(second).toBeCloseTo(clickPower(g.state, 100));
    expect(second).toBeGreaterThan(clickPower(fresh(), 100));
  });

  it('drops when the player stops for longer than the window', () => {
    const g = game();
    g.nudge(0);
    g.nudge(100);
    expect(clickStreak(g.state, 100).count).toBe(2);
    expect(clickStreak(g.state, 100 + WINDOW_MS + 1).count).toBe(0);
  });

  it('restarts at one after the window lapses', () => {
    const g = game();
    g.nudge(0);
    g.nudge(100);
    g.nudge(100 + WINDOW_MS + 1);
    expect(clickStreak(g.state, 100 + WINDOW_MS + 1).count).toBe(1);
  });

  it('is capped', () => {
    const g = game();
    for (let i = 0; i < 200; i += 1) g.nudge(i * 10);
    const streak = clickStreak(g.state, 1990);
    expect(streak.count).toBeLessThanOrEqual(CLICK.streak.maxCount);
    expect(streak.multiplier).toBeCloseTo(1 + CLICK.streak.maxBonus);
    expect(streak.ratio).toBe(1);
  });

  /**
   * It is a wall-clock timer like every other real-time bonus, so a save
   * reloaded tomorrow must not resume yesterday's streak — without anything
   * having had to run while the tab was closed.
   */
  it('expires while the tab is shut', () => {
    const g = game();
    g.nudge(0);
    g.nudge(100);
    expect(clickStreak(g.state, 100 + 86_400_000).multiplier).toBe(1);
  });

  it('tolerates a save written before it existed', () => {
    const legacy = fresh();
    delete legacy.click;
    expect(clickStreak(legacy, 0).multiplier).toBe(1);
    expect(clickPower(legacy, 0)).toBeGreaterThan(0);
  });

  it('still counts every press in the stats', () => {
    const g = game();
    g.nudge(0);
    g.nudge(100);
    g.nudge(100 + WINDOW_MS + 1);
    expect(g.state.stats.nudges).toBe(3);
  });
});
