import { OVERFLOW } from '../data/balance.js';
import { ANCHOR_BUILDING_IDS, FEED_BUILDING_IDS } from '../data/buildings.js';
import { GHOSTS } from '../data/ghosts.js';
import { addBuff } from './buffs.js';
import { unitsOf } from './buildings.js';

/**
 * The Buffer Overflow — the "Dead Internet" crisis event (GDD v2 §7).
 *
 * The one system in AeroOS whose job is to make the machine worse. It watches
 * the *shape* of what the player has built rather than the size of it, and when
 * the automated feed has grown past the apps they started with, the OS begins
 * behaving like something that has stopped being theirs.
 *
 * Three rules kept this to one module:
 *
 * 1. **It adds no new verb.** Every consequence is an ordinary buff, the
 *    existing bloat counter, or one more factor in the multiplier chain. There
 *    is nothing here to play — Phase 5 was cut precisely so this layer would not
 *    become another thing to do.
 * 2. **It only escalates while somebody is watching.** Sampling runs on `dt`,
 *    not the wall clock (see ARCHITECTURE.md's two clocks). A crisis about
 *    attention that fires into a closed tab and resolves itself is not a crisis;
 *    it is a save-file event nobody saw.
 * 3. **Ghosts age on the wall clock anyway.** They spawn on `dt` and expire on
 *    `Date.now()`, so both directions favour the player who steps away: none
 *    accumulate while the tab is shut, and any that were live are gone on
 *    return. Coming back to a stolen night is exactly what this event must not
 *    do to somebody.
 *
 * Pure over `state.event` and `state.buildings`. No DOM, no timers of its own —
 * `game.js` calls in once per tick and hands the result to the bus.
 */

/* ---------------------------------------------------------------- the ratio */

/**
 * GDD §7.1's `feedRatio`: units across the five automated feed buildings over
 * units across the three the player started with.
 *
 * The denominator is floored at 1 rather than guarded as a special case, so a
 * machine with feed buildings and no anchors reports the numerator itself — the
 * worst possible shape reads as the worst possible number, which is right.
 */
export function feedRatio(state) {
  let feed = 0;
  let anchor = 0;
  for (const id of FEED_BUILDING_IDS) feed += unitsOf(state, id);
  for (const id of ANCHOR_BUILDING_IDS) anchor += unitsOf(state, id);
  return feed / Math.max(1, anchor);
}

/** The phase a ratio *would* justify, ignoring dwell, calm and Airplane Mode. */
export function phaseForRatio(ratio) {
  let phase = 0;
  for (const step of OVERFLOW.phases) {
    if (ratio >= step.at) phase = step.phase;
  }
  return phase;
}

/**
 * The phase the recent history actually supports.
 *
 * The minimum across the dwell window, which gives the asymmetry the event
 * wants: escalating needs every sample in the window to agree, so one bulk buy
 * cannot trigger a crisis, while *de*-escalating happens on the first sample
 * that disagrees. Backfilling AeroChat is the documented remedy, and a remedy
 * that takes a minute to be believed does not read as a remedy.
 */
function sustainedPhase(history) {
  const { dwellSamples } = OVERFLOW;
  if (history.length < dwellSamples) return 0;
  let phase = Infinity;
  for (const ratio of history.slice(-dwellSamples)) {
    phase = Math.min(phase, phaseForRatio(ratio));
  }
  return phase;
}

/** Airplane Mode and the post-Log Off calm, as one ceiling on the phase. */
function ceilingFor(state, now) {
  let ceiling = OVERFLOW.phases.at(-1).phase;
  if (airplaneModeOwned(state)) ceiling = Math.min(ceiling, OVERFLOW.airplane.capPhase);
  if (now < (state.event?.calmUntil ?? 0)) ceiling = Math.min(ceiling, OVERFLOW.logOff.calmPhase);
  return ceiling;
}

export function overflowPhase(state) {
  return state.event?.overflowPhase ?? 0;
}

/* ------------------------------------------------------------------ escalate */

/**
 * Sample the ratio and move the phase if the sample says so. Returns
 * `{ from, to, ratio }` on the tick the phase changes and null otherwise, the
 * same shape `updateDefrag` uses, so the caller never has to remember what it
 * saw last frame.
 */
export function updateOverflow(state, dt, now = Date.now()) {
  if (!OVERFLOW.enabled) return null;
  const event = state.event;
  if (!event) return null;

  event.sampleIn -= dt;
  if (event.sampleIn > 0) return null;
  event.sampleIn = OVERFLOW.sampleSeconds;

  const ratio = feedRatio(state);
  event.feedRatioHistory.push(ratio);
  while (event.feedRatioHistory.length > OVERFLOW.historyLength) event.feedRatioHistory.shift();

  const to = Math.min(sustainedPhase(event.feedRatioHistory), ceilingFor(state, now));
  const from = event.overflowPhase;
  if (to === from) return null;

  event.overflowPhase = to;

  /**
   * Ghosts belong to phase 2 and up. Dropping below it clears them rather than
   * letting them tick out, because the balloon is the *symptom* — leaving three
   * on screen after the machine has calmed down says the remedy did not work.
   */
  if (to < 2) event.ghostNotifications = [];
  /**
   * Entering phase 2 seeds the spawn timer rather than letting it fire on the
   * same frame. The wallpaper tearing and the first balloon arriving together
   * reads as one glitch; a beat apart, it reads as the machine getting worse.
   */
  if (to >= 2 && from < 2) event.ghostIn = OVERFLOW.ghost.spawnSecondsMin;

  // Crossing into 3 is the only thing in this system that takes over the screen,
  // and it arms exactly once per crossing.
  if (to >= 3 && from < 3) {
    event.crisisPending = true;
    event.crisisRearmAt = 0;
  }
  if (to < 3) {
    event.crisisPending = false;
    event.crisisRearmAt = 0;
  }

  return { from, to, ratio };
}

/* -------------------------------------------------------------------- ghosts */

/** The message behind a stored seed. Derived, so a ghost costs two numbers. */
export function ghostAt(seed) {
  return GHOSTS[seed % GHOSTS.length];
}

/** Ghosts still on screen. Wall clock — see the header. */
export function liveGhosts(state, now = Date.now()) {
  return (state.event?.ghostNotifications ?? []).filter((g) => g.expiresAt > now);
}

/**
 * What the ghosts are costing. One factor in `globalMultiplier`, next to bloat
 * and the defrag tax, which is what gets it reported by every building window
 * through `getProductionBreakdown` without any of them knowing it exists.
 */
export function overflowPenalty(state, now = Date.now()) {
  const count = liveGhosts(state, now).length;
  return count === 0 ? 1 : (1 - OVERFLOW.ghost.penaltyEach) ** count;
}

/**
 * Spawn and retire ghosts. `{ spawned, expired }`, where `spawned` is the new
 * ghost or null — `game.js` turns it into a balloon.
 */
export function updateGhosts(state, dt, rng = Math.random, now = Date.now()) {
  const event = state.event;
  if (!OVERFLOW.enabled || !event) return { spawned: null, expired: 0 };

  const before = event.ghostNotifications.length;
  event.ghostNotifications = liveGhosts(state, now);
  const expired = before - event.ghostNotifications.length;

  if (event.overflowPhase < 2) return { spawned: null, expired };

  event.ghostIn -= dt;
  if (event.ghostIn > 0) return { spawned: null, expired };

  const { spawnSecondsMin, spawnSecondsMax, frenzyFactor, lifetimeSeconds, maxLive } =
    OVERFLOW.ghost;
  const frenzy = event.overflowPhase >= 3 ? frenzyFactor : 1;
  event.ghostIn = (spawnSecondsMin + rng() * (spawnSecondsMax - spawnSecondsMin)) * frenzy;

  // The cap is checked *after* the timer is rolled, so a full screen re-rolls
  // rather than spawning the instant one expires.
  if (event.ghostNotifications.length >= maxLive) return { spawned: null, expired };

  /**
   * A message that is not already on screen.
   *
   * Rolled over the rows that are *free* rather than over the whole table and
   * rerolled on a collision: the table has twelve rows and the stack holds
   * three, so choosing from what is left is guaranteed to be distinct, while
   * rerolling is only probably distinct. An honest uniform roll shows the same
   * notification twice about a quarter of the time, and a duplicate reads as a
   * broken generator rather than as a machine talking nonsense.
   */
  const taken = new Set(event.ghostNotifications.map((g) => g.seed % GHOSTS.length));
  const free = [];
  for (let i = 0; i < GHOSTS.length; i += 1) if (!taken.has(i)) free.push(i);
  // `free` cannot empty out while maxLive < GHOSTS.length, but a future table
  // shorter than the cap should degrade to a repeat rather than to a crash.
  const pool = free.length > 0 ? free : GHOSTS.map((_, i) => i);
  const seed = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];

  event.ghostSeq += 1;
  const ghost = { id: event.ghostSeq, seed, expiresAt: now + lifetimeSeconds * 1000 };
  event.ghostNotifications.push(ghost);
  return { spawned: ghost, expired };
}

/**
 * Silence one. Returns the ghost that went, or null — `game.js` pays the burst,
 * because paying Buzz is its job and not this module's.
 */
export function dismissGhost(state, id, now = Date.now()) {
  const list = state.event?.ghostNotifications ?? [];
  const index = list.findIndex((g) => g.id === id && g.expiresAt > now);
  if (index === -1) return null;
  return list.splice(index, 1)[0];
}

/* -------------------------------------------------------------- the question */

export const OVERFLOW_CHOICES = ['logoff', 'doomscroll'];

/** Is the fullscreen crisis waiting to be answered? */
export function crisisPending(state) {
  return state.event?.crisisPending === true;
}

/**
 * Answer it. Both branches are ordinary economy modifiers, and both are honest
 * about what they cost:
 *
 * - **Log Off** halves production for two minutes and buys ten minutes of quiet.
 *   Nothing is left on the machine afterwards.
 * - **Doomscroll** triples it for three minutes, leaves a quarter of a bloat bar
 *   behind *permanently*, and the machine asks again when the buff runs out.
 *   It is the better answer today and the reason the run ends early.
 *
 * Returns `{ choice, buff, bloat }` for the caller to announce.
 */
export function resolveOverflow(state, choice, now = Date.now()) {
  if (!OVERFLOW_CHOICES.includes(choice)) return null;
  const event = state.event;
  if (!event) return null;

  event.crisisPending = false;
  event.overflowsResolved += 1;

  if (choice === 'logoff') {
    const { buffId, magnitude, durationSeconds, calmSeconds, calmPhase } = OVERFLOW.logOff;
    event.ghostNotifications = [];
    event.overflowPhase = Math.min(event.overflowPhase, calmPhase);
    event.calmUntil = now + calmSeconds * 1000;
    event.crisisRearmAt = 0;
    /**
     * The history is cleared too, not just the phase. Without it the dwell
     * window still holds four samples above the crisis threshold, and the tick
     * after the calm expires re-fires the whole thing — the player would have
     * paid for ten minutes of quiet and bought ten minutes of delay.
     */
    event.feedRatioHistory = [];
    const buff = addBuff(
      state,
      { id: buffId, kind: 'global', magnitude, durationSeconds, label: 'Logged off', source: 'overflow' },
      now,
    );
    return { choice, buff, bloat: 0 };
  }

  const { buffId, magnitude, durationSeconds, bloat } = OVERFLOW.doomscroll;
  state.bloat = Math.min(1, state.bloat + bloat);
  event.crisisRearmAt = now + durationSeconds * 1000;
  const buff = addBuff(
    state,
    { id: buffId, kind: 'global', magnitude, durationSeconds, label: 'Doomscrolling', source: 'overflow' },
    now,
  );
  return { choice, buff, bloat };
}

/**
 * Re-arm the question after a Doomscroll runs out. Called from the tick; returns
 * true on the frame the crisis comes back, so the caller can emit once.
 */
export function updateCrisis(state, now = Date.now()) {
  const event = state.event;
  if (!event || event.crisisPending) return false;
  if (event.overflowPhase < 3 || event.crisisRearmAt === 0) return false;
  if (now < event.crisisRearmAt) return false;
  event.crisisPending = true;
  event.crisisRearmAt = 0;
  return true;
}

/* ------------------------------------------------------------ Airplane Mode */

export function airplaneModeOwned(state) {
  return state.event?.airplaneModeOwned === true;
}

export function canBuyAirplaneMode(state) {
  if (airplaneModeOwned(state)) return { ok: false, reason: 'already-owned' };
  if (state.dollars < OVERFLOW.airplane.cost) return { ok: false, reason: 'too-expensive' };
  return { ok: true, cost: OVERFLOW.airplane.cost };
}

/**
 * What owning it costs, per building — 1 for the seven it does not touch.
 *
 * The function itself lives in `core/buildings.js`, because it has to be inside
 * `buildingProduction` for the total and the twelve breakdowns to agree, and a
 * building module that imported this one would close an import cycle around
 * `unitsOf`. Re-exported here so the rule still reads as Airplane Mode's.
 */
export { feedTax } from './buildings.js';
