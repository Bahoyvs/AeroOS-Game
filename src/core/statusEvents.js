import { STATUS_BONUSES, STATUS_EVENT } from '../data/balance.js';
import { addBuff } from './buffs.js';
// Straight from the mechanic rather than through `economy.js`: this module only
// needs the buddy count, and economy is the module that composes everything.
import { unitsOf } from './buildings.js';

const buddyCount = (state) => unitsOf(state, 'aerochat');

/**
 * Rotating status-message bonus events (AO-10).
 *
 * While AeroChat is open, one buddy at a time posts a "hot" status. Clicking it
 * inside the claim window applies the bonus; letting it lapse costs nothing.
 *
 * Timing runs on *simulation* time (seconds of `dt`), not the wall clock: an
 * event should only count down while the player is actually watching the
 * window, and a throttled or backgrounded tab must not silently burn through
 * claim windows. Buffs, by contrast, stay on the wall clock — they should keep
 * expiring while the tab is closed. Randomness is injected so this is testable.
 */

const TOTAL_WEIGHT = STATUS_BONUSES.reduce((sum, bonus) => sum + bonus.weight, 0);

export function getBonus(id) {
  return STATUS_BONUSES.find((bonus) => bonus.id === id) ?? null;
}

/** Weighted pick from the bonus table. */
export function rollBonus(rng = Math.random) {
  let ticket = rng() * TOTAL_WEIGHT;
  for (const bonus of STATUS_BONUSES) {
    ticket -= bonus.weight;
    if (ticket <= 0) return bonus;
  }
  return STATUS_BONUSES.at(-1);
}

/** Seconds until the next event, jittered inside the tuned interval. */
export function rollInterval(rng = Math.random) {
  const { minIntervalSeconds, maxIntervalSeconds } = STATUS_EVENT;
  return minIntervalSeconds + rng() * (maxIntervalSeconds - minIntervalSeconds);
}

function canSpawn(state) {
  return state.apps.aerochat?.open === true && buddyCount(state) >= STATUS_EVENT.minBuddies;
}

/**
 * Advance events by `dt` seconds. Returns `{ spawned, missed }` so the caller
 * can notify.
 */
export function updateStatusEvents(state, dt, rng = Math.random) {
  const result = { spawned: null, missed: null };
  const chat = state.chat;

  if (!canSpawn(state)) {
    // Closing AeroChat retires a pending event without counting it as missed —
    // the player was never given a chance to click it.
    chat.event = null;
    chat.nextEventIn = 0;
    return result;
  }

  if (chat.nextEventIn <= 0 && !chat.event) {
    chat.nextEventIn = rollInterval(rng);
    return result;
  }

  if (chat.event) {
    chat.event.secondsLeft -= dt;
    if (chat.event.secondsLeft <= 0) {
      result.missed = chat.event;
      state.stats.bonusesMissed += 1;
      chat.event = null;
      chat.nextEventIn = rollInterval(rng);
    }
    return result;
  }

  chat.nextEventIn -= dt;
  if (chat.nextEventIn <= 0) {
    const bonus = rollBonus(rng);
    chat.event = {
      index: Math.floor(rng() * buddyCount(state)),
      bonusId: bonus.id,
      secondsLeft: STATUS_EVENT.claimWindowSeconds,
    };
    result.spawned = chat.event;
  }

  return result;
}

/**
 * Claim the pending event. Applies timed buffs directly; 'burst' bonuses are
 * returned for the caller to pay out, since only the game knows the rate.
 */
export function claimStatusEvent(state, now = Date.now(), rng = Math.random) {
  const event = state.chat.event;
  if (!event) return { ok: false, reason: 'no-event' };
  if (event.secondsLeft <= 0) {
    state.chat.event = null;
    return { ok: false, reason: 'expired' };
  }

  const bonus = getBonus(event.bonusId);
  state.chat.event = null;
  state.chat.nextEventIn = rollInterval(rng);
  state.stats.bonusesClaimed += 1;

  if (bonus.kind !== 'burst') {
    addBuff(state, { ...bonus, source: 'status' }, now);
  }
  return { ok: true, bonus };
}

/** Seconds left to click the pending event, for the UI countdown. */
export function claimSecondsLeft(state) {
  return Math.max(0, state.chat.event?.secondsLeft ?? 0);
}
