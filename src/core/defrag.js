import { DEFRAG } from '../data/balance.js';

/**
 * Auto-Defrag — the answer to a machine that locks solid while nobody is home.
 *
 * Bloat is the pressure loop (GDD 7): it climbs with uptime and with what is
 * running, and at 100% production is halved. That works while the player is at
 * the keyboard and is simply punitive when they are not — a long night away
 * used to guarantee a desktop found at full bloat, so the first thing a
 * returning player did was Format C: whether or not the run was ready.
 *
 * This is the purchasable fix, and it is deliberately a *scheduler* rather than
 * a stat: it does nothing at all until bloat is already bad, it costs
 * production while it runs, and it is bought with Dollars, so it belongs to the
 * meta-game and survives the wipe like hardware does.
 *
 * Two halves, matching the two clocks (see ARCHITECTURE.md):
 *
 * - **Online** it is a simulation-time job: `updateDefrag(state, dt)` engages at
 *   `startAt`, drains bloat at `clearPerSecond`, and disengages at `stopAt`.
 *   It must not run on the wall clock, or a backgrounded tab would defragment
 *   a machine nobody is using.
 * - **Offline** there is nothing to animate and nothing to tax, so it is a
 *   *ceiling* on what the absence is allowed to accrue instead.
 */

export function defragOwned(state) {
  return state.defrag?.owned === true;
}

export function isDefragging(state) {
  return state.defrag?.active === true;
}

/** The production tax while a pass runs. 1 when it is idle or not installed. */
export function defragPenalty(state) {
  return isDefragging(state) ? 1 - DEFRAG.productionTax : 1;
}

export function canBuyDefrag(state) {
  if (defragOwned(state)) return { ok: false, reason: 'already-owned' };
  if (state.dollars < DEFRAG.cost) return { ok: false, reason: 'too-expensive' };
  return { ok: true, cost: DEFRAG.cost };
}

/**
 * Advance a pass. Returns `{ started }` / `{ finished }` on the tick the state
 * changes and null otherwise, so the caller can emit an event without having to
 * remember what it saw last frame.
 *
 * Simulation time (`dt`), on purpose — see the header.
 */
export function updateDefrag(state, dt) {
  if (!defragOwned(state)) return null;

  if (!isDefragging(state)) {
    if (state.bloat < DEFRAG.startAt) return null;
    state.defrag.active = true;
    state.defrag.startedFrom = state.bloat;
    state.defrag.passes += 1;
    return { started: true, from: state.bloat };
  }

  state.bloat = Math.max(0, state.bloat - DEFRAG.clearPerSecond * dt);
  if (state.bloat > DEFRAG.stopAt) return null;

  state.defrag.active = false;
  const from = state.defrag.startedFrom;
  state.defrag.startedFrom = 0;
  return { finished: true, from };
}

/**
 * How far through the current pass we are, for the gadget's block grid. Counted
 * from the bloat the pass started at rather than from `startAt`, so an offline
 * return at 50% and an online trigger at 85% both fill the same bar honestly.
 */
export function defragProgress(state) {
  if (!isDefragging(state)) return 0;
  const from = state.defrag.startedFrom || DEFRAG.startAt;
  const span = from - DEFRAG.stopAt;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (from - state.bloat) / span));
}

/**
 * The offline half. Bloat accrued while away is capped instead of being
 * defragmented, because there is no pass to watch and no production to tax.
 *
 * The ceiling is `max(current, offlineCap)`, never a flat `offlineCap`: it
 * limits what an absence can *add*, and cannot hand back bloat the player had
 * already run up before they closed the tab. Without Auto-Defrag the ceiling is
 * the ordinary 100%.
 */
export function offlineBloat(state, current, gained) {
  const ceiling = defragOwned(state) ? Math.max(current, DEFRAG.offlineCap) : 1;
  return Math.min(1, Math.min(ceiling, current + gained));
}
