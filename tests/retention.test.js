import { describe, expect, it } from 'vitest';
import { createInitialState, resetForPrestige } from '../src/core/state.js';
import * as mg from '../src/core/minigames.js';
import * as ach from '../src/core/achievements.js';
import { buffMultiplier } from '../src/core/buffs.js';
import { buildingBuffKind } from '../src/core/buildings.js';
import { ACHIEVEMENTS, MINIGAMES } from '../src/data/balance.js';
import { ACHIEVEMENT_LIST, BIG_ACHIEVEMENTS } from '../src/data/achievements.js';

/* ----------------------------------------------------------- mini-games */

describe('mini-game unlocking (GDD §B)', () => {
  it('covers exactly the five buildings the design picked', () => {
    expect(mg.MINIGAME_IDS.sort()).toEqual(
      ['aeroburn', 'lemonwire', 'registrydoctor', 'shield99', 'vidchat'].sort(),
    );
  });

  it('is locked until the building\'s tier-3 upgrade is owned', () => {
    const s = createInitialState(0);
    expect(mg.isMinigameUnlocked(s, 'aeroburn')).toBe(false);
    s.upgrades.owned[`aeroburn.t${MINIGAMES.unlockTier}`] = true;
    expect(mg.isMinigameUnlocked(s, 'aeroburn')).toBe(true);
  });

  it('comes back with the upgrade after a Format C: that slotted it', () => {
    const s = createInitialState(0);
    s.upgrades.owned['aeroburn.t3'] = true;
    s.legacy.slots = ['aeroburn.t3'];
    s.lifetimeBuzz = 1e6;

    const after = resetForPrestige(s, 1, 0);
    // Derived rather than stored, so it simply follows the upgrade home.
    expect(mg.isMinigameUnlocked(after, 'aeroburn')).toBe(true);
  });

  it('refuses a building that has no mini-game', () => {
    const s = createInitialState(0);
    expect(mg.canPlayMinigame(s, 'aerochat')).toMatchObject({ ok: false, reason: 'no-minigame' });
  });

  it('holds a cooldown between rounds', () => {
    const s = createInitialState(0);
    s.upgrades.owned['aeroburn.t3'] = true;
    expect(mg.canPlayMinigame(s, 'aeroburn', 0).ok).toBe(true);

    mg.applyMinigameReward(s, 'aeroburn', { score: 1 }, 0);
    expect(mg.canPlayMinigame(s, 'aeroburn', 1000)).toMatchObject({ reason: 'cooling-down' });
    expect(mg.canPlayMinigame(s, 'aeroburn', MINIGAMES.cooldownSeconds * 1000 + 1).ok).toBe(true);
  });
});

describe('mini-game rewards (GDD §B.1)', () => {
  function played(score) {
    const s = createInitialState(0);
    s.upgrades.owned['aeroburn.t3'] = true;
    const result = mg.applyMinigameReward(s, 'aeroburn', { score }, 0);
    return { s, result };
  }

  it('pays a timed buff scoped to that building and nothing else', () => {
    const { s } = played(1);
    expect(buffMultiplier(s, buildingBuffKind('aeroburn'), 0)).toBeGreaterThan(1);
    // The rule the whole module exists to hold: nothing global, ever.
    expect(buffMultiplier(s, 'global', 0)).toBe(1);
    expect(buffMultiplier(s, buildingBuffKind('lemonwire'), 0)).toBe(1);
  });

  it('never pays raw Buzz', () => {
    const { s } = played(1);
    expect(s.buzz).toBe(0);
    expect(s.lifetimeBuzz).toBe(0);
  });

  it('scales the bonus with the score, between the two rails', () => {
    expect(played(0).result.magnitude).toBeCloseTo(MINIGAMES.minMagnitude);
    expect(played(1).result.magnitude).toBeCloseTo(MINIGAMES.maxMagnitude);
    expect(played(0.5).result.magnitude).toBeGreaterThan(MINIGAMES.minMagnitude);
    expect(played(0.5).result.magnitude).toBeLessThan(MINIGAMES.maxMagnitude);
  });

  it('clamps a nonsense score instead of trusting it', () => {
    expect(played(99).result.magnitude).toBeCloseTo(MINIGAMES.maxMagnitude);
    expect(played(-5).result.magnitude).toBeCloseTo(MINIGAMES.minMagnitude);
    expect(played(NaN).result.magnitude).toBeCloseTo(MINIGAMES.minMagnitude);
  });

  it('refreshes rather than stacks when replayed', () => {
    const s = createInitialState(0);
    s.upgrades.owned['aeroburn.t3'] = true;
    mg.applyMinigameReward(s, 'aeroburn', { score: 1 }, 0);
    mg.applyMinigameReward(s, 'aeroburn', { score: 1 }, 1000);
    expect(s.buffs.filter((b) => b.id === 'minigame-aeroburn')).toHaveLength(1);
  });

  it('keeps the best score and counts the plays', () => {
    const s = createInitialState(0);
    s.upgrades.owned['aeroburn.t3'] = true;
    mg.applyMinigameReward(s, 'aeroburn', { score: 0.8 }, 0);
    mg.applyMinigameReward(s, 'aeroburn', { score: 0.4 }, 1);
    expect(s.minigames.aeroburn.bestScore).toBeCloseTo(0.8);
    expect(s.minigames.aeroburn.timesPlayed).toBe(2);
    expect(s.stats.minigamesPlayed).toBe(2);
  });

  it('records a perfect round for the badge', () => {
    const s = createInitialState(0);
    s.upgrades.owned['aeroburn.t3'] = true;
    mg.applyMinigameReward(s, 'aeroburn', { score: 1, perfect: true }, 0);
    expect(s.stats.perfectMinigames).toBe(1);
  });
});

/* --------------------------------------------------------- achievements */

describe('achievements (GDD §D)', () => {
  it('unlocks nothing on a fresh save', () => {
    const s = createInitialState(0);
    expect(ach.evaluateAchievements(s, 0)).toEqual([]);
    expect(ach.unlockedCount(s)).toBe(0);
  });

  it('awards a badge the moment its predicate becomes true', () => {
    const s = createInitialState(0);
    s.chat.bots = 1;
    const fresh = ach.evaluateAchievements(s, 1234);
    expect(fresh.map((a) => a.id)).toContain('first-buddy');
    expect(s.achievements.unlocked['first-buddy']).toBe(1234);
  });

  it('never awards the same badge twice', () => {
    const s = createInitialState(0);
    s.chat.bots = 1;
    ach.evaluateAchievements(s, 0);
    expect(ach.evaluateAchievements(s, 1)).toEqual([]);
  });

  it('survives a Format C: — a badge is permanent by definition', () => {
    const s = createInitialState(0);
    s.chat.bots = 1;
    s.lifetimeBuzz = 1e6;
    ach.evaluateAchievements(s, 0);
    const after = resetForPrestige(s, 1, 0);
    expect(ach.isUnlocked(after, 'first-buddy')).toBe(true);
  });

  it('keeps a badge even if the state that earned it goes away', () => {
    const s = createInitialState(0);
    s.chat.bots = 500;
    ach.evaluateAchievements(s, 0);
    s.chat.bots = 0;
    ach.evaluateAchievements(s, 1);
    expect(ach.isUnlocked(s, 'buddies-500')).toBe(true);
  });

  it('does not let one broken predicate stop the rest', () => {
    // A half-migrated save is the real-world version of this: everything that
    // can be judged still is.
    const s = createInitialState(0);
    s.chat.bots = 1;
    delete s.sweeper;
    expect(() => ach.evaluateAchievements(s, 0)).not.toThrow();
    expect(ach.isUnlocked(s, 'first-buddy')).toBe(true);
  });

  it('uses exactly three curated portal celebrations (GDD §D.3)', () => {
    expect(BIG_ACHIEVEMENTS).toHaveLength(3);
  });

  it('has a unique id for every badge', () => {
    const ids = ACHIEVEMENT_LIST.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('portal completion reporting (GDD §D.3)', () => {
  it('starts at zero and rises with progress', () => {
    const s = createInitialState(0);
    expect(ach.completionPercent(s)).toBe(0);
    s.chat.bots = 1;
    ach.evaluateAchievements(s, 0);
    expect(ach.completionPercent(s)).toBeGreaterThan(0);
  });

  it('stays quiet until the figure has moved a meaningful step', () => {
    const s = createInitialState(0);
    s.chat.bots = 1;
    ach.evaluateAchievements(s, 0);

    const first = ach.completionToReport(s);
    expect(first).not.toBeNull();
    ach.markCompletionReported(s, first);
    // Nothing changed, so there is nothing to say.
    expect(ach.completionToReport(s)).toBeNull();
  });

  it('never reports a figure it has already sent', () => {
    const s = createInitialState(0);
    s.crazyGames.lastReportedCompletion = 100;
    expect(ach.completionToReport(s)).toBeNull();
  });

  it('is capped at 100', () => {
    const s = createInitialState(0);
    for (const a of ACHIEVEMENT_LIST) s.achievements.unlocked[a.id] = 0;
    s.chat.bots = 1;
    for (const id of Object.keys(s.buildings)) s.buildings[id].units = 1;
    expect(ach.completionPercent(s)).toBe(100);
  });
});

describe('session tracking for the habit badges (GDD §D.2)', () => {
  const DAY = 86_400_000;

  it('starts a streak on the first session', () => {
    const s = createInitialState(0);
    ach.noteSession(s, 0, DAY * 100);
    expect(s.stats.dayStreak).toBe(1);
  });

  it('extends the streak on consecutive days', () => {
    const s = createInitialState(0);
    ach.noteSession(s, 0, DAY * 100);
    ach.noteSession(s, 0, DAY * 101);
    ach.noteSession(s, 0, DAY * 102);
    expect(s.stats.dayStreak).toBe(3);
  });

  it('cannot be farmed by reloading on the same day', () => {
    const s = createInitialState(0);
    ach.noteSession(s, 0, DAY * 100);
    ach.noteSession(s, 0, DAY * 100 + 3600_000);
    ach.noteSession(s, 0, DAY * 100 + 7200_000);
    expect(s.stats.dayStreak).toBe(1);
  });

  it('restarts the streak after a missed day', () => {
    const s = createInitialState(0);
    ach.noteSession(s, 0, DAY * 100);
    ach.noteSession(s, 0, DAY * 103);
    expect(s.stats.dayStreak).toBe(1);
  });

  it('remembers the longest absence, for Welcome Back', () => {
    const s = createInitialState(0);
    ach.noteSession(s, 3600 * 30, DAY * 100);
    expect(s.stats.longestAwayHours).toBeCloseTo(30);
    ach.noteSession(s, 60, DAY * 101);
    expect(s.stats.longestAwayHours).toBeCloseTo(30);
  });

  it('drives the retention badges end to end', () => {
    const s = createInitialState(0);
    ach.noteSession(s, ACHIEVEMENTS.returnAfterHours * 3600, DAY * 100);
    ach.evaluateAchievements(s, DAY * 100);
    expect(ach.isUnlocked(s, 'welcome-back')).toBe(true);

    ach.noteSession(s, 0, DAY * 101);
    ach.noteSession(s, 0, DAY * 102);
    ach.evaluateAchievements(s, DAY * 102);
    expect(ach.isUnlocked(s, 'weekend-warrior')).toBe(true);
  });
});
