import { BREACH } from '../data/balance.js';
import { unitsOf } from './buildings.js';

/**
 * "Darknet Breach" — the crisis system (GDD §C).
 *
 * Pure and DOM-free: this module decides *that* a breach is happening and what
 * it costs, and `ui/breach.js` decides what that looks like. The phase-3 event
 * reuses the BSOD shell rather than inventing a second full-screen layer.
 *
 * Four properties make this a risk system rather than a punishment:
 *
 * - **The player builds it.** The trigger is a ratio between the three risky
 *   buildings and Shield99, so a breach is always the consequence of a
 *   portfolio the player chose. Nothing here fires at random.
 * - **Escalation is slow and recovery is fast.** Pressure accrues in seconds
 *   above the threshold and drains three times quicker, so buying Shield99
 *   licences visibly works — a counterweight that takes as long to help as it
 *   took to need reads as no counterweight at all.
 * - **Every phase can be answered.** Popups close, rogue processes pay out when
 *   killed, and the full breach offers a fight as well as a ransom.
 * - **It can be switched off for good.** Incognito Mode (§C.5) is a priced
 *   opt-out, not a difficulty slider — see `canBuyIncognito`.
 */

/* ------------------------------------------------------------------- ratio */

/**
 * Risky units per Shield99 licence.
 *
 * `max(1, ...)` on the denominator is what makes an unguarded machine read as
 * its full risky-unit count rather than dividing by zero — the first LemonWire
 * node on a machine with no antivirus is already a ratio of 1.
 */
export function riskRatio(state) {
  let risky = 0;
  for (const id of BREACH.riskyBuildings) risky += unitsOf(state, id);
  return risky / Math.max(1, unitsOf(state, BREACH.guardBuilding));
}

/** The averaged ratio the phase clock actually reads. */
export function smoothedRisk(state) {
  const history = state.event?.riskRatioHistory ?? [];
  if (history.length === 0) return riskRatio(state);
  return history.reduce((sum, n) => sum + n, 0) / history.length;
}

export function isIncognito(state) {
  return state.event?.incognitoModeOwned === true;
}

/** How close the machine is to the next phase, 0..1. Drives the warning UI. */
export function breachPressure(state) {
  const phase = state.event?.breachPhase ?? 0;
  const next = BREACH.phaseAtSeconds[phase];
  if (next == null) return 1;
  const from = phase === 0 ? 0 : BREACH.phaseAtSeconds[phase - 1];
  const span = next - from;
  const have = (state.event?.aboveSeconds ?? 0) - from;
  return span <= 0 ? 0 : Math.min(1, Math.max(0, have / span));
}

/* -------------------------------------------------------------- production */

/**
 * What the live rogue processes are skimming, as a fraction of production.
 *
 * Capped below 1 by construction (five processes × 3%), but clamped anyway:
 * a tuning change that let this reach 1.0 would silently stop the entire
 * economy, and that is not a failure mode worth trusting to arithmetic.
 */
export function rogueDrain(state) {
  const count = state.event?.rogueProcesses?.length ?? 0;
  return Math.min(0.9, count * BREACH.phase2.stealFraction);
}

/**
 * The Incognito tax (§C.5). It applies only to the three buildings that cause
 * the problem — a global tax would make the opt-out a strictly worse way to
 * play, and then it is not really an option.
 */
export function incognitoTax(state, buildingId) {
  if (!isIncognito(state)) return 1;
  return BREACH.riskyBuildings.includes(buildingId) ? 1 - BREACH.incognito.productionTax : 1;
}

/* ------------------------------------------------------------------- tick */

let nextEntityId = 1;

function clearEntities(event) {
  event.rogueProcesses = [];
  event.popups = [];
  event.nextSpawnIn = 0;
}

/**
 * Advance the breach clock. Takes `dt` (simulation seconds), because this is a
 * thing that should only happen while somebody is watching — a player who
 * closes the tab for a week must not come back to a machine that has been
 * quietly robbed. That is the same reasoning behind status events; see
 * ARCHITECTURE.md on the two clocks.
 *
 * Returns a list of things that happened, for `game.js` to announce.
 */
export function updateBreach(state, dt, rng = Math.random, now = Date.now()) {
  const event = state.event;
  if (!event) return [];

  // The opt-out is absolute: no sampling, no pressure, no entities left behind.
  if (isIncognito(state)) {
    if (event.breachPhase !== 0 || event.rogueProcesses.length > 0) {
      event.breachPhase = 0;
      event.aboveSeconds = 0;
      event.phase3 = null;
      clearEntities(event);
    }
    return [];
  }

  const out = [];

  // 1. Sample the ratio on a fixed cadence and keep a short window of it.
  event.nextSampleIn -= dt;
  if (event.nextSampleIn <= 0) {
    event.nextSampleIn = BREACH.sampleSeconds;
    event.riskRatioHistory.push(riskRatio(state));
    while (event.riskRatioHistory.length > BREACH.historyLength) {
      event.riskRatioHistory.shift();
    }
  }

  // 2. Run the escalation clock off the smoothed value.
  const above = smoothedRisk(state) > BREACH.threshold;
  event.aboveSeconds = above
    ? event.aboveSeconds + dt
    : Math.max(0, event.aboveSeconds - dt * BREACH.recoveryRate);

  // 3. Resolve the phase. A live phase-3 event holds the phase where it is
  //    until the player answers it — de-escalating out from under an open
  //    ransom dialog would leave the shell showing a breach that no longer
  //    exists.
  let phase = 0;
  for (let i = 0; i < BREACH.phaseAtSeconds.length; i += 1) {
    if (event.aboveSeconds >= BREACH.phaseAtSeconds[i]) phase = i + 1;
  }
  if (event.phase3) phase = 3;

  if (phase !== event.breachPhase) {
    const from = event.breachPhase;
    event.breachPhase = phase;
    out.push({ type: 'phase', from, to: phase });

    if (phase < 2) event.rogueProcesses = [];
    if (phase < 1) event.popups = [];
  }

  /**
   * Arm the full-screen event.
   *
   * Driven by the *computed* phase rather than by the transition that usually
   * produces it. Those are the same thing in ordinary play, but not for a save
   * restored at phase 3: there is no transition to observe on the first tick, so
   * a transition-only check would leave the player pinned at maximum dressing
   * with no dialog and therefore no way out. Self-healing beats atomic here —
   * `phase3` is the thing that must exist whenever the phase says 3.
   */
  if (phase === 3 && !event.phase3) {
    event.phase3 = { startedAt: now };
    out.push({ type: 'phase3' });
  }

  // 4. Phase behaviour. Nothing spawns while the full-screen event is open —
  //    the player is already dealing with it.
  if (event.phase3) return out;

  if (phase >= 1) {
    event.nextSpawnIn -= dt;
    if (event.nextSpawnIn <= 0) {
      if (phase >= 2 && event.rogueProcesses.length < BREACH.phase2.maxProcesses) {
        event.nextSpawnIn = BREACH.phase2.spawnEverySeconds;
        const rogue = {
          id: nextEntityId++,
          bornAt: now,
          // Where it sits on the desktop, as fractions of the viewport, so the
          // shell can place it without core knowing anything about pixels.
          x: 0.1 + rng() * 0.8,
          y: 0.15 + rng() * 0.6,
        };
        event.rogueProcesses.push(rogue);
        out.push({ type: 'rogue', rogue });
      } else if (phase === 1 && event.popups.length < BREACH.phase1.maxPopups) {
        event.nextSpawnIn = BREACH.phase1.popupEverySeconds;
        const popup = { id: nextEntityId++, x: 0.15 + rng() * 0.6, y: 0.15 + rng() * 0.5 };
        event.popups.push(popup);
        out.push({ type: 'popup', popup });
      } else {
        // Nothing to spawn right now; check again shortly rather than every tick.
        event.nextSpawnIn = BREACH.phase2.spawnEverySeconds / 2;
      }
    }
  }

  return out;
}

/* ----------------------------------------------------------------- actions */

/**
 * Kill a rogue process. Pays more than it was stealing, on purpose: the
 * mechanic's job is to reward a player for looking at their desktop, and a
 * payout that merely undoes the theft is not a reward, it is a chore.
 */
export function popRogue(state, id, buzzPerSecond) {
  const list = state.event?.rogueProcesses ?? [];
  const index = list.findIndex((r) => r.id === id);
  if (index === -1) return { ok: false, reason: 'no-such-process' };

  list.splice(index, 1);
  return { ok: true, buzz: Math.max(0, buzzPerSecond) * BREACH.phase2.popRewardSeconds };
}

/** Dismiss a phase-1 popup. Pure nuisance — it pays nothing and costs nothing. */
export function closePopup(state, id) {
  const list = state.event?.popups ?? [];
  const index = list.findIndex((p) => p.id === id);
  if (index === -1) return { ok: false, reason: 'no-such-popup' };
  list.splice(index, 1);
  return { ok: true };
}

/**
 * End a phase-3 breach.
 *
 * `outcome` is 'ransom', 'fought' or 'lost'. All three clear the breach and
 * reset the pressure clock — surviving one has to actually buy peace, or the
 * event re-arms the moment it closes and the player is in a loop they cannot
 * leave.
 *
 * Nothing here touches `lifetimeBuzz`, `allTimeBuzz` or `dollarsEarnedTotal`.
 * A crisis may cost a player their wallet; it may never cost them their
 * permanent progress.
 */
export function resolveBreach(state, outcome) {
  const event = state.event;
  if (!event?.phase3) return { ok: false, reason: 'no-breach' };

  const fraction =
    outcome === 'ransom'
      ? BREACH.phase3.ransomFraction
      : outcome === 'lost'
        ? BREACH.phase3.fightFailFraction
        : 0;

  const lost = Math.max(0, state.buzz) * fraction;
  state.buzz = Math.max(0, state.buzz - lost);

  event.phase3 = null;
  event.breachPhase = 0;
  event.aboveSeconds = 0;
  event.riskRatioHistory = [];
  clearEntities(event);
  if (outcome === 'fought') event.survived += 1;

  return { ok: true, outcome, lost };
}

/* --------------------------------------------------------- incognito mode */

export function canBuyIncognito(state) {
  if (isIncognito(state)) return { ok: false, reason: 'already-owned' };
  if (state.dollars < BREACH.incognito.cost) {
    return { ok: false, reason: 'too-expensive', cost: BREACH.incognito.cost };
  }
  return { ok: true, cost: BREACH.incognito.cost };
}

export function buyIncognito(state) {
  const check = canBuyIncognito(state);
  if (!check.ok) return check;

  state.dollars -= check.cost;
  state.dollarsSpentTotal += check.cost;
  state.event.incognitoModeOwned = true;
  // Silence anything already in flight, so the purchase takes effect visibly
  // and immediately rather than at the next tick boundary.
  state.event.breachPhase = 0;
  state.event.aboveSeconds = 0;
  state.event.phase3 = null;
  clearEntities(state.event);
  return { ok: true, cost: check.cost };
}

/** Everything the shell needs to dress the desktop for a breach, in one call. */
export function breachStatus(state) {
  const event = state.event ?? {};
  return {
    phase: event.breachPhase ?? 0,
    pressure: breachPressure(state),
    ratio: smoothedRisk(state),
    threshold: BREACH.threshold,
    incognito: isIncognito(state),
    rogues: event.rogueProcesses ?? [],
    popups: event.popups ?? [],
    fullBreach: event.phase3 ?? null,
    drain: rogueDrain(state),
    survived: event.survived ?? 0,
  };
}
