import { SECURITY, SHIELD99 } from '../data/balance.js';
import { seededRisk } from './lemonwire.js';

/**
 * Shield99 (AO-22) — the antivirus, and the game's lootbox.
 *
 * Seeding attracts threats. What happens when one arrives depends entirely on
 * whether Shield99 is watching:
 *
 *   installed + open → caught, sealed, and dropped in quarantine as a prize
 *   otherwise        → the old safety net: the run's free rescue, then a
 *                      capped infection (GDD 6 — a virus never ruins a run)
 *
 * That is the whole reason to spend 48 MB keeping this window open, and it is
 * what keeps a high-risk seed slot a decision rather than free money.
 *
 * Threat spawns run on *simulation* time: they are only interesting while
 * somebody is watching, and a claim the player never saw is not a reward. The
 * ad cooldown runs on the wall clock, because it should burn down while the
 * tab is closed like every other real-world timer.
 */

/* ------------------------------------------------------------ the loot table */

const THREATS_BY_ID = new Map(SHIELD99.threats.map((threat) => [threat.id, threat]));

export function getThreat(id) {
  const threat = THREATS_BY_ID.get(id);
  if (!threat) throw new Error(`Unknown threat: ${id}`);
  return threat;
}

const TOTAL_WEIGHT = SHIELD99.threats.reduce((sum, threat) => sum + threat.weight, 0);

/** Weighted roll over the loot table. Randomness is injected, never called. */
export function rollThreat(rng = Math.random) {
  let ticket = rng() * TOTAL_WEIGHT;
  for (const threat of SHIELD99.threats) {
    ticket -= threat.weight;
    if (ticket < 0) return threat;
  }
  return SHIELD99.threats.at(-1);
}

/* ---------------------------------------------------------------- spawning */

/**
 * Seconds until the next threat. Risk in the seed slots shortens the wait — the
 * player is choosing how often Shield99 has something for them, and paying for
 * it in exposure whenever they close the window.
 */
export function nextThreatDelay(state, rng = Math.random) {
  const span = SHIELD99.maxSpawnSeconds - SHIELD99.minSpawnSeconds;
  const base = SHIELD99.minSpawnSeconds + rng() * span;
  const urgency = Math.min(SHIELD99.maxUrgency, 1 + seededRisk(state) * SHIELD99.riskUrgency);
  return base / urgency;
}

export function quarantineIsFull(state) {
  return state.shield99.quarantine.length >= SHIELD99.maxQuarantine;
}

/**
 * Advance the threat timer. Returns what happened this tick, or null:
 *   { outcome: 'quarantined', item }  — Shield99 caught it
 *   { outcome: 'blocked' | 'rescued' | 'infected' }  — it got through the net
 */
export function updateThreats(state, dt, rng = Math.random, now = Date.now()) {
  // No seeds, no swarm, no threats: closing LemonWire is a way to stop the
  // whole loop, not just its income.
  if (!state.apps.lemonwire?.open || state.lemonwire.activeSeeds.length === 0) return null;

  if (state.shield99.nextThreatIn <= 0) {
    state.shield99.nextThreatIn = nextThreatDelay(state, rng);
    return null;
  }

  state.shield99.nextThreatIn -= dt;
  if (state.shield99.nextThreatIn > 0) return null;

  state.shield99.nextThreatIn = nextThreatDelay(state, rng);

  const guarded = state.apps.shield99?.installed && state.apps.shield99?.open;
  if (guarded) {
    // A full quarantine is not a reason to punish the player, so the threat is
    // simply stopped. It also stops the backlog growing while they are away
    // from the extract button.
    if (quarantineIsFull(state)) {
      state.stats.threatsBlocked += 1;
      return { outcome: 'blocked' };
    }
    return { outcome: 'quarantined', item: quarantine(state, rollThreat(rng), now) };
  }

  return resolveInfection(state, now);
}

function quarantine(state, threat, now) {
  const item = {
    id: state.shield99.nextId++,
    threatId: threat.id,
    at: now,
  };
  state.shield99.quarantine.push(item);
  state.stats.threatsBlocked += 1;
  return item;
}

/* ------------------------------------------------------------- the safety net */

/**
 * What happens when a threat lands unguarded (AO-22, GDD 6). The run's one free
 * rescue is spent first; after that the machine is infected — and even then the
 * damage is capped (SECURITY.productionFloor) and nothing earned is taken away.
 */
export function resolveInfection(state, now = Date.now()) {
  if (state.security.rescuesUsed < SECURITY.freeRescuesPerRun) {
    state.security.rescuesUsed += 1;
    state.stats.threatsBlocked += 1;
    return { outcome: 'rescued' };
  }

  state.security.infection = { at: now };
  return { outcome: 'infected' };
}

/** Multiplier applied to all production while infected. Never below the floor. */
export function infectionPenalty(state) {
  return state.security.infection ? SECURITY.productionFloor : 1;
}

export function isInfected(state) {
  return state.security.infection !== null;
}

/* -------------------------------------------------------------- extraction */

export function adCooldownLeft(state, now = Date.now()) {
  return Math.max(0, (state.shield99.adCooldownUntil - now) / 1000);
}

/**
 * Can this quarantined file be opened? `viaAd` is the rewarded-ad path and is
 * the only one that has a cooldown — the manual path is slower in reward, not
 * in time, so an ad blocker never locks anybody out of the mechanic.
 */
export function canExtract(state, itemId, { viaAd = false, now = Date.now() } = {}) {
  const item = state.shield99.quarantine.find((entry) => entry.id === itemId);
  if (!item) return { ok: false, reason: 'no-such-file' };
  if (viaAd && adCooldownLeft(state, now) > 0) {
    return { ok: false, reason: 'cooling-down', seconds: adCooldownLeft(state, now) };
  }
  return { ok: true, item };
}

/**
 * What a threat is worth, resolved against the player's current output. Pure,
 * so the balance is testable — game.js applies the result.
 *
 * `fraction` is 1 for the full rewarded-ad payout and
 * SHIELD99.manualRewardFraction for the fallback.
 */
export function rewardFor(threat, { fraction = 1, buzzPerSecond = 0, isRendering = false } = {}) {
  const reward = threat.reward;

  if (reward.kind === 'buff') {
    return {
      kind: 'buff',
      // A quarter of a +100% buff is +25%, not a quarter of the time: a
      // ten-minute buff cut to 150 seconds would be over before it was felt.
      magnitude: reward.magnitude * fraction,
      durationSeconds: reward.durationSeconds,
    };
  }

  if (reward.kind === 'render') {
    if (isRendering) return { kind: 'render', renderFraction: reward.fraction * fraction };
    // Nothing to accelerate — pay the equivalent rather than nothing.
    return { kind: 'buzz', buzz: buzzPerSecond * reward.fallbackSeconds * fraction };
  }

  return { kind: 'buzz', buzz: buzzPerSecond * reward.seconds * fraction };
}

/** Remove a quarantined file and hand it back. The caller pays the reward. */
export function takeFromQuarantine(state, itemId) {
  const index = state.shield99.quarantine.findIndex((entry) => entry.id === itemId);
  if (index === -1) return null;
  const [item] = state.shield99.quarantine.splice(index, 1);
  state.shield99.filesCleaned += 1;
  return item;
}

export function startAdCooldown(state, now = Date.now()) {
  state.shield99.adCooldownUntil = now + SHIELD99.adCooldownSeconds * 1000;
}

/* -------------------------------------------------------------- deep scan */

/** Scanning runs on simulation time, so it needs Shield99 open and watched. */
export function updateScan(state, dt) {
  const scan = state.security.scan;
  if (!scan) return null;

  if (!state.apps.shield99?.open) {
    // Closing Shield99 mid-scan abandons it rather than finishing in the dark.
    state.security.scan = null;
    return { done: false, cancelled: true };
  }

  scan.secondsLeft -= dt;
  if (scan.secondsLeft > 0) return null;

  state.security.scan = null;
  const cured = state.security.infection !== null;
  state.security.infection = null;
  return { done: true, cured };
}

export function startScan(state) {
  if (!state.apps.shield99?.installed) return { ok: false, reason: 'not-installed' };
  if (!state.apps.shield99?.open) return { ok: false, reason: 'not-open' };
  if (state.security.scan) return { ok: false, reason: 'already-scanning' };

  state.security.scan = { secondsLeft: SECURITY.scanSeconds, total: SECURITY.scanSeconds };
  return { ok: true };
}

export function scanProgress(state) {
  const scan = state.security.scan;
  return scan ? 1 - scan.secondsLeft / scan.total : 0;
}
