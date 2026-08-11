import { describe, expect, it } from 'vitest';
import { ACHIEVEMENT_LIST, CATEGORIES, getAchievement, hasAchievement } from '../src/data/achievements.js';
import { createGame } from '../src/core/game.js';

describe('achievements system', () => {
  it('defines valid categories and achievement list', () => {
    expect(Object.keys(CATEGORIES).length).toBe(4);
    expect(ACHIEVEMENT_LIST.length).toBeGreaterThan(10);
  });

  it('can query achievements by id', () => {
    expect(hasAchievement('first-buddy')).toBe(true);
    expect(getAchievement('first-buddy').name).toBe('Hello, World');
    expect(getAchievement('non-existent')).toBeNull();
  });

  it('tracks achievements unlocked in game state', () => {
    const game = createGame();
    let summary = game.achievements();
    expect(summary.unlocked).toBe(0);

    game.state.buzz = 1000;
    const res = game.buyUnits('aerochat', 1);
    expect(res.ok).toBe(true);

    summary = game.achievements();
    expect(summary.unlocked).toBeGreaterThanOrEqual(1);
    expect(game.state.achievements.unlocked['first-buddy']).toBeTruthy();
  });

  it('computes completion percentage correctly', () => {
    const game = createGame();
    expect(game.completionPercent()).toBe(0);
    game.state.buzz = 1000;
    game.buyUnits('aerochat', 1);
    expect(game.completionPercent()).toBeGreaterThan(0);
  });
});
