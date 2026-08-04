import { LEMONWIRE, SECURITY } from '../data/balance.js';
import { getFile } from '../data/files.js';

/**
 * LemonWire's P2P simulation (AO-21).
 *
 * Downloads advance on *simulation* time and only while the window is open —
 * same rule as every other producer, and it is what makes LemonWire's 96 MB
 * footprint a real decision rather than a free background earner.
 *
 * Infection is rolled when a download completes, so whether the player is
 * protected *at that moment* is what matters. Randomness is injected.
 */

/** Total gigabytes on disk: finished files plus what is currently downloading. */
export function storageUsedGB(state) {
  const library = state.lemonwire.library.reduce((sum, id) => sum + getFile(id).sizeGB, 0);
  const active = state.lemonwire.queue.reduce((sum, job) => sum + getFile(job.fileId).sizeGB, 0);
  return Math.round((library + active) * 1000) / 1000;
}

export function canDownload(state, fileId, capacityGB) {
  const file = getFile(fileId);
  if (!state.apps.lemonwire?.open) return { ok: false, reason: 'not-open' };
  if (state.security.infection) return { ok: false, reason: 'infected' };
  if (state.lemonwire.queue.length >= LEMONWIRE.maxConcurrent) {
    return { ok: false, reason: 'queue-full' };
  }
  if (state.lemonwire.queue.some((job) => job.fileId === fileId)) {
    return { ok: false, reason: 'already-downloading' };
  }
  if (state.lemonwire.library.includes(fileId)) return { ok: false, reason: 'already-have-it' };

  const free = capacityGB - storageUsedGB(state);
  if (file.sizeGB > free) {
    return { ok: false, reason: 'no-space', needed: file.sizeGB, free: Math.max(0, free) };
  }
  return { ok: true };
}

export function startDownload(state, fileId) {
  state.lemonwire.queue.push({
    id: state.lemonwire.nextId++,
    fileId,
    downloadedGB: 0,
  });
  return state.lemonwire.queue.at(-1);
}

export function cancelDownload(state, jobId) {
  const index = state.lemonwire.queue.findIndex((job) => job.id === jobId);
  if (index === -1) return { ok: false, reason: 'no-such-job' };
  const [job] = state.lemonwire.queue.splice(index, 1);
  return { ok: true, job };
}

export function deleteFile(state, fileId) {
  const index = state.lemonwire.library.indexOf(fileId);
  if (index === -1) return { ok: false, reason: 'not-in-library' };
  state.lemonwire.library.splice(index, 1);
  return { ok: true };
}

/** Bandwidth is shared, so three downloads each run at a third of the speed. */
export function speedPerJobGB(state) {
  const jobs = state.lemonwire.queue.length;
  return jobs === 0 ? 0 : LEMONWIRE.gbPerSecond / jobs;
}

export function progressOf(job) {
  return Math.min(1, job.downloadedGB / getFile(job.fileId).sizeGB);
}

export function secondsLeft(state, job) {
  const speed = speedPerJobGB(state);
  if (speed <= 0) return Infinity;
  return Math.max(0, (getFile(job.fileId).sizeGB - job.downloadedGB) / speed);
}

/**
 * Advance every active download by `dt` seconds. Returns the jobs that finished
 * this tick, each flagged with whether it turned out to be infected — the
 * caller decides what protection does about it.
 */
export function updateDownloads(state, dt, rng = Math.random) {
  if (!state.apps.lemonwire?.open || state.lemonwire.queue.length === 0) return [];

  const speed = speedPerJobGB(state);
  const finished = [];

  for (const job of state.lemonwire.queue) {
    job.downloadedGB += speed * dt;
    if (job.downloadedGB >= getFile(job.fileId).sizeGB) {
      finished.push({ ...job, infected: rng() < getFile(job.fileId).risk });
    }
  }

  if (finished.length > 0) {
    const done = new Set(finished.map((job) => job.id));
    state.lemonwire.queue = state.lemonwire.queue.filter((job) => !done.has(job.id));
  }
  return finished;
}

/** Buzz a finished file is worth, in seconds of the player's current output. */
export function payoutFor(fileId, buzzPerSecond) {
  const file = getFile(fileId);
  const seconds = file.sizeGB * LEMONWIRE.payoutSecondsPerGB * (1 + file.risk * LEMONWIRE.riskPayoutBonus);
  return Math.max(LEMONWIRE.minPayoutBuzz, buzzPerSecond * seconds);
}

/* -------------------------------------------------------------- Shield99 */

/**
 * What happens when an infected file lands (AO-22). Real-time protection wins
 * outright; otherwise the run's one free rescue is spent; otherwise the machine
 * is infected — and even then the damage is capped (SECURITY.productionFloor).
 */
export function resolveInfection(state) {
  const protectedNow = state.apps.shield99?.installed && state.apps.shield99?.open;
  if (protectedNow) {
    state.stats.threatsBlocked += 1;
    return { outcome: 'blocked' };
  }

  if (state.security.rescuesUsed < SECURITY.freeRescuesPerRun) {
    state.security.rescuesUsed += 1;
    state.stats.threatsBlocked += 1;
    return { outcome: 'rescued' };
  }

  state.security.infection = { at: Date.now() };
  return { outcome: 'infected' };
}

/** Multiplier applied to all production while infected. Never below the floor. */
export function infectionPenalty(state) {
  return state.security.infection ? SECURITY.productionFloor : 1;
}

export function isInfected(state) {
  return state.security.infection !== null;
}

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
