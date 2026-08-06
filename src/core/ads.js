import { ADS } from '../data/balance.js';

/**
 * Ad pacing and reward sizing — the half of the ad system that is *not* a
 * browser API.
 *
 * Nothing here knows the SDK exists. This module answers two questions:
 * "is this offer available right now?" and "what is it worth?", both of them
 * pure enough to unit-test in plain Node. The shell (src/ui/ads.js) owns the
 * video, and src/core/game.js owns applying the reward — the same three-way
 * split Shield99's quarantine already uses, and for the same reason: a reward
 * that can only be exercised by watching a real ad cannot be balanced.
 *
 * Allowances roll over on the **wall clock**, in UTC days. That is deliberate,
 * and it is the same rule as buffs and offline earnings: a daily reward the
 * player cannot reach until they leave the tab open until midnight is not a
 * daily reward. Cooldowns are wall clock for the same reason — a 15-minute wait
 * should be over when you come back an hour later.
 */

const DAY_MS = 86_400_000;

/** UTC day number. Whole days since the epoch, which is all the reset needs. */
export function dayIndex(now = Date.now()) {
  return Math.floor(now / DAY_MS);
}

export function getPlacement(id) {
  const placement = ADS.rewarded[id];
  if (!placement) throw new Error(`Unknown ad placement: ${id}`);
  return placement;
}

/**
 * How many times this placement has been watched *today*.
 *
 * Reads the rollover rather than performing it: this is called from render
 * loops to label buttons, and a query that mutates state would be a save write
 * on every frame. `markWatched` does the actual reset.
 */
export function watchedToday(state, id, now = Date.now()) {
  if (state.ads.day !== dayIndex(now)) return 0;
  return state.ads.watched[id] ?? 0;
}

export function watchesLeft(state, id, now = Date.now()) {
  return Math.max(0, getPlacement(id).perDay - watchedToday(state, id, now));
}

export function cooldownLeft(state, id, now = Date.now()) {
  const last = state.ads.lastAt[id] ?? 0;
  const cooldown = getPlacement(id).cooldownSeconds * 1000;
  return Math.max(0, (last + cooldown - now) / 1000);
}

/**
 * Is the offer available? Refusals name themselves so the UI can say "back
 * tomorrow" or "ready in 4:12" instead of greying a button out in silence — a
 * button that does nothing reads as broken, which costs a watch either way.
 *
 * This is pacing only. Whether there is anything to *spend* the reward on
 * (a render running, a Format C: pending) is game.js's question, because that
 * is where the systems live.
 */
export function canWatch(state, id, now = Date.now()) {
  const remaining = watchesLeft(state, id, now);
  if (remaining <= 0) return { ok: false, reason: 'daily-cap', remaining: 0 };

  const seconds = cooldownLeft(state, id, now);
  if (seconds > 0) return { ok: false, reason: 'cooling-down', seconds, remaining };

  return { ok: true, remaining };
}

/** Record a watch. The only function here that touches state. */
export function markWatched(state, id, now = Date.now()) {
  const day = dayIndex(now);
  if (state.ads.day !== day) {
    state.ads.day = day;
    state.ads.watched = {};
  }
  state.ads.watched[id] = (state.ads.watched[id] ?? 0) + 1;
  state.ads.lastAt[id] = now;
  state.ads.totalWatched += 1;
  return state.ads.watched[id];
}

/**
 * Seconds of production the daily gift is worth on its *next* watch.
 *
 * Diminishing returns, straight from the rewarded-ads guide: the first one
 * today is the big one, and the table's last entry is the floor for anything
 * beyond it.
 */
export function giftSeconds(state, now = Date.now()) {
  const { seconds } = ADS.rewarded.gift;
  const taken = watchedToday(state, 'gift', now);
  return seconds[Math.min(taken, seconds.length - 1)];
}

/**
 * What an offer pays, resolved against the player's current output. Pure, like
 * `shield99.rewardFor` — game.js applies the descriptor, so the same table can
 * be shown on a button before the ad and paid out after it without two
 * balance sheets.
 *
 * `dollars` and `render` are described rather than computed here: their value
 * depends on a pending prestige payout and a live render, which are the
 * caller's business.
 */
export function rewardFor(state, id, { buzzPerSecond = 0, now = Date.now() } = {}) {
  const placement = getPlacement(id);

  switch (id) {
    case 'overclock':
      return {
        kind: 'buff',
        magnitude: placement.magnitude,
        durationSeconds: placement.durationSeconds,
      };
    case 'gift': {
      const seconds = giftSeconds(state, now);
      return {
        kind: 'buzz',
        buzz: Math.max(placement.minBuzz, buzzPerSecond * seconds),
        seconds,
      };
    }
    case 'sweeperToken':
      return { kind: 'token', tokens: 1 };
    case 'renderBoost':
      return { kind: 'render', renderFraction: placement.fraction };
    case 'formatBoost':
      return { kind: 'dollars', multiplier: placement.multiplier };
    case 'offlineDouble':
      return { kind: 'buzz-multiplier', multiplier: placement.multiplier };
    default:
      throw new Error(`No reward defined for ad placement: ${id}`);
  }
}
