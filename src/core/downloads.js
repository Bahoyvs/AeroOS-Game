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

/* ------------------------------------------------------- risk vs reward */

/**
 * How fast a file transfers, relative to the base rate.
 *
 * Seeders help — up to a cap, so a huge swarm cannot trivialise everything.
 * Risk hurts, in bands: a high-risk file trickles and an extreme-risk one
 * barely moves. Above `fakeSwarmAtRisk` the advertised seeder count is ignored
 * entirely: 302 peers sharing a 3 MB "speed boost" are bots, and treating them
 * as real made the most dangerous file in the list the fastest to download.
 */
export function speedModifiers(fileId) {
  const file = getFile(fileId);

  const tier = LEMONWIRE.riskSpeedTiers.find(({ atRisk }) => file.risk >= atRisk);
  const risk = tier ? tier.modifier : 1;

  const seeders = file.risk >= LEMONWIRE.fakeSwarmAtRisk
    ? 1
    : Math.min(
        LEMONWIRE.maxSeederModifier,
        Math.max(LEMONWIRE.minSeederModifier, file.seeders / LEMONWIRE.seedersPerSpeedUnit),
      );

  return { seeders, risk, total: seeders * risk };
}

/** Total gigabytes on disk: library, active transfers, and the trash. */
export function storageUsedGB(state) {
  const library = state.lemonwire.library.reduce((sum, id) => sum + getFile(id).sizeGB, 0);
  const active = state.lemonwire.queue.reduce((sum, job) => sum + getFile(job.fileId).sizeGB, 0);
  const trash = state.lemonwire.trash.reduce((sum, item) => sum + getFile(item.fileId).sizeGB, 0);
  return Math.round((library + active + trash) * 1000) / 1000;
}

export function trashUsedGB(state) {
  return Math.round(
    state.lemonwire.trash.reduce((sum, item) => sum + getFile(item.fileId).sizeGB, 0) * 1000,
  ) / 1000;
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
  // Still physically on the disk until the trash empties — no download-and-
  // delete farming loop.
  if (state.lemonwire.trash.some((item) => item.fileId === fileId)) {
    return { ok: false, reason: 'in-trash' };
  }

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

/**
 * "Delete" moves a file to the trash. It keeps occupying the disk until the bin
 * empties itself, which is what makes storage a real constraint rather than a
 * button you press between downloads.
 */
export function deleteFile(state, fileId) {
  const index = state.lemonwire.library.indexOf(fileId);
  if (index === -1) return { ok: false, reason: 'not-in-library' };

  state.lemonwire.library.splice(index, 1);
  state.lemonwire.trash.push({ fileId, secondsLeft: LEMONWIRE.trashSeconds });
  return { ok: true, secondsLeft: LEMONWIRE.trashSeconds };
}

/** Empty the bin on simulation time. Returns the files whose space came back. */
export function updateTrash(state, dt) {
  if (state.lemonwire.trash.length === 0) return [];

  const emptied = [];
  for (const item of state.lemonwire.trash) {
    item.secondsLeft -= dt;
    if (item.secondsLeft <= 0) emptied.push(item);
  }
  if (emptied.length > 0) {
    state.lemonwire.trash = state.lemonwire.trash.filter((item) => item.secondsLeft > 0);
  }
  return emptied;
}

/**
 * Speed for one transfer: the base rate, shared between concurrent downloads,
 * scaled by that file's own seeders and risk.
 */
export function speedPerJobGB(state, job) {
  const jobs = state.lemonwire.queue.length;
  if (jobs === 0 || !job) return 0;
  return (LEMONWIRE.gbPerSecond / jobs) * speedModifiers(job.fileId).total;
}

export function progressOf(job) {
  return Math.min(1, job.downloadedGB / getFile(job.fileId).sizeGB);
}

export function secondsLeft(state, job) {
  const speed = speedPerJobGB(state, job);
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

  const finished = [];

  for (const job of state.lemonwire.queue) {
    job.downloadedGB += speedPerJobGB(state, job) * dt;
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

/**
 * Buzz a finished file is worth, in seconds of the player's current output.
 *
 * The payout scales *inversely* to the speed modifiers — a transfer that took
 * 200× longer pays 200× more — plus a risk premium on top. The premium is what
 * makes the choice real: pure inverse scaling would pay every file the same
 * Buzz per second of waiting, leaving risk as downside with no upside.
 */
export function payoutFor(fileId, buzzPerSecond) {
  const file = getFile(fileId);
  const { total } = speedModifiers(fileId);

  const seconds =
    (file.sizeGB * LEMONWIRE.payoutSecondsPerGB * (1 + file.risk * LEMONWIRE.riskPayoutBonus)) /
    total;
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
