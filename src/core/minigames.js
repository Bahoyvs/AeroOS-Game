import { MINIGAMES } from '../data/balance.js';
import { getBuilding } from '../data/buildings.js';
import { buildingBuffKind } from './buildings.js';
import { isUpgradeOwned } from './upgrades.js';
import { addBuff } from './buffs.js';

/**
 * Mini-games (GDD §B) — the rules, not the games.
 *
 * Five of the twelve buildings have one, and every one of them funnels through
 * `applyMinigameReward` below. That single seam is deliberate (GDD §G, phase 7):
 * five bespoke reward paths is five places for a mini-game to quietly become the
 * best Buzz-per-minute in the game.
 *
 * Two economic guarantees live here and nowhere else:
 *
 * 1. **A mini-game never pays a permanent multiplier.** The reward is a timed
 *    buff scoped to the building it was played in, which is the same rule the
 *    v2 upgrade layer follows (§4.5) — nothing but hardware and Legacy touches
 *    the global chain.
 * 2. **A mini-game never pays raw Buzz.** A lump sum would make the games a
 *    production source that scales with how much free time somebody has, which
 *    is precisely what an idle game must not reward.
 */

export function hasMinigame(id) {
  return id in MINIGAMES.games;
}

export const MINIGAME_IDS = Object.keys(MINIGAMES.games);

export function minigameConfig(id) {
  return MINIGAMES.games[id] ?? null;
}

/**
 * Unlocked by the building's tier-3 upgrade — derived, never stored.
 *
 * Same reasoning as cosmetics and goals: a stored flag is a thing that can get
 * out of step, and here it genuinely could, because a Legacy Slot can hand the
 * tier-3 upgrade back after a Format C:. Deriving it means the mini-game comes
 * back with the upgrade automatically.
 */
export function isMinigameUnlocked(state, id) {
  if (!hasMinigame(id)) return false;
  return isUpgradeOwned(state, `${id}.t${MINIGAMES.unlockTier}`);
}

export function minigameCooldownLeft(state, id, now = Date.now()) {
  const record = state.minigames?.[id];
  // "Never played" is the only thing that means no cooldown. Testing
  // `lastPlayedAt` for truthiness would read a timestamp of 0 as never — which
  // is exactly what every test clock and a save restored at the epoch produce.
  if (!record || (record.timesPlayed ?? 0) === 0) return 0;
  const readyAt = (record.lastPlayedAt ?? 0) + MINIGAMES.cooldownSeconds * 1000;
  return Math.max(0, (readyAt - now) / 1000);
}

export function canPlayMinigame(state, id, now = Date.now()) {
  if (!hasMinigame(id)) return { ok: false, reason: 'no-minigame' };
  if (!isMinigameUnlocked(state, id)) {
    return { ok: false, reason: 'locked', tier: MINIGAMES.unlockTier };
  }
  const cooling = minigameCooldownLeft(state, id, now);
  if (cooling > 0) return { ok: false, reason: 'cooling-down', seconds: cooling };
  return { ok: true };
}

/**
 * Bank a round.
 *
 * `result.score` is a 0..1 normalised performance figure that every game
 * computes for itself — hits over beats, tiles solved over tiles, passes landed
 * over passes. Normalising in the game rather than here is what lets five very
 * different mechanics share one reward curve without this module knowing what
 * any of them are.
 *
 * Mutating, and it does not save: `game.js` owns both.
 */
export function applyMinigameReward(state, buildingId, result = {}, now = Date.now()) {
  if (!hasMinigame(buildingId)) return { ok: false, reason: 'no-minigame' };

  const score = Math.min(1, Math.max(0, Number(result.score) || 0));
  const perfect = result.perfect === true || score >= 1;

  const record = state.minigames[buildingId] ?? { bestScore: 0, timesPlayed: 0, lastPlayedAt: 0 };
  record.timesPlayed += 1;
  record.bestScore = Math.max(record.bestScore, score);
  record.lastPlayedAt = now;
  state.minigames[buildingId] = record;

  state.stats.minigamesPlayed = (state.stats.minigamesPlayed ?? 0) + 1;
  if (perfect) state.stats.perfectMinigames = (state.stats.perfectMinigames ?? 0) + 1;

  const magnitude =
    MINIGAMES.minMagnitude + (MINIGAMES.maxMagnitude - MINIGAMES.minMagnitude) * score;

  addBuff(
    state,
    {
      // One buff id per building, so replaying refreshes the bonus rather than
      // stacking five copies of it — the cooldown is the pacing, not attrition.
      id: `minigame-${buildingId}`,
      kind: buildingBuffKind(buildingId),
      magnitude,
      durationSeconds: MINIGAMES.durationSeconds,
      label: `${getBuilding(buildingId).name} boost`,
      source: 'minigame',
    },
    now,
  );

  return {
    ok: true,
    buildingId,
    score,
    perfect,
    magnitude,
    durationSeconds: MINIGAMES.durationSeconds,
    best: record.bestScore,
  };
}

/** One row per mini-game, for the shell to draw a launcher. */
export function minigameRows(state, now = Date.now()) {
  return MINIGAME_IDS.map((id) => {
    const config = MINIGAMES.games[id];
    const record = state.minigames?.[id] ?? { bestScore: 0, timesPlayed: 0 };
    const unlocked = isMinigameUnlocked(state, id);
    return {
      id,
      buildingId: id,
      title: config.title,
      blurb: config.blurb,
      unlocked,
      cooldownSeconds: minigameCooldownLeft(state, id, now),
      bestScore: record.bestScore,
      timesPlayed: record.timesPlayed,
      requirement: `${getBuilding(id).name} tier-${MINIGAMES.unlockTier} upgrade`,
    };
  });
}
