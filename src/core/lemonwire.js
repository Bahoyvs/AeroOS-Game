import { LEMONWIRE } from '../data/balance.js';
import { getFile } from '../data/files.js';

/**
 * LemonWire's P2P simulation (AO-21).
 *
 * The app used to be a download manager: queue a transfer, watch a bar, collect
 * a lump sum. It is now a *seeder*. A file sits in a slot and pays Buzz every
 * second it is shared, which turns LemonWire from a thing you babysit into a
 * second income stream — and into the thing that attracts the threats Shield99
 * turns into loot (src/core/shield99.js).
 *
 * Income accrues on the same terms as every other producer: only while the
 * window is open. That is what keeps its 96 MB footprint a real decision
 * rather than a free background earner. The Recycle Bin still runs on
 * simulation time, for the reason ARCHITECTURE.md gives: the cost of deleting
 * a file is time spent *at the machine*.
 */

/* ------------------------------------------------------- what a seed pays */

/**
 * Relative earning weight of one file, before bandwidth and before the
 * player's own production is folded in.
 *
 * Size pays a little (you are pushing more bytes), risk pays a lot, and rarity
 * pays most: a file with six seeders needs *you*, so the leechers queue up. The
 * inversion is also what stops the "302 seeders" malware from being the
 * obvious best slot in the list — that swarm is bots, and bots do not download.
 */
export function seedWeight(fileId) {
  const file = getFile(fileId);

  const size = 1 + file.sizeGB * LEMONWIRE.weightPerGB;
  const risk = 1 + file.risk * LEMONWIRE.riskPayoutBonus;
  const demand = Math.min(
    LEMONWIRE.maxDemandModifier,
    Math.max(LEMONWIRE.minDemandModifier, LEMONWIRE.seedersPivot / Math.max(1, file.seeders)),
  );

  return { size, risk, demand, total: size * risk * demand };
}

/** Total risk being seeded — Shield99 reads this to pace its threats. */
export function seededRisk(state) {
  return state.lemonwire.activeSeeds.reduce((sum, seed) => sum + getFile(seed.fileId).risk, 0);
}

/* ---------------------------------------------------------------- the disk */

/** Total gigabytes on disk: what is seeding, plus what is still in the bin. */
export function storageUsedGB(state) {
  const seeding = state.lemonwire.activeSeeds.reduce(
    (sum, seed) => sum + getFile(seed.fileId).sizeGB,
    0,
  );
  const trash = state.lemonwire.trash.reduce((sum, item) => sum + getFile(item.fileId).sizeGB, 0);
  return Math.round((seeding + trash) * 1000) / 1000;
}

export function trashUsedGB(state) {
  return Math.round(
    state.lemonwire.trash.reduce((sum, item) => sum + getFile(item.fileId).sizeGB, 0) * 1000,
  ) / 1000;
}

/* -------------------------------------------------------------- seed slots */

export function isSeeding(state, fileId) {
  return state.lemonwire.activeSeeds.some((seed) => seed.fileId === fileId);
}

/**
 * Can this file take a slot? `slots` and `capacityGB` are passed in rather than
 * derived here, because both are hardware-dependent and hardware maths lives in
 * economy.js.
 */
export function canSeed(state, fileId, slots, capacityGB) {
  const file = getFile(fileId);
  if (!state.apps.lemonwire?.open) return { ok: false, reason: 'not-open' };
  if (state.security.infection) return { ok: false, reason: 'infected' };
  if (isSeeding(state, fileId)) return { ok: false, reason: 'already-seeding' };
  if (state.lemonwire.activeSeeds.length >= slots) return { ok: false, reason: 'no-slots' };
  // Still physically on the disk until the bin empties — no stop-and-restart
  // farming loop, and no way to dodge the cost of changing your mind.
  if (state.lemonwire.trash.some((item) => item.fileId === fileId)) {
    return { ok: false, reason: 'in-trash' };
  }

  const free = capacityGB - storageUsedGB(state);
  if (file.sizeGB > free) {
    return { ok: false, reason: 'no-space', needed: file.sizeGB, free: Math.max(0, free) };
  }
  return { ok: true };
}

export function startSeeding(state, fileId, now = Date.now()) {
  state.lemonwire.activeSeeds.push({
    id: state.lemonwire.nextId++,
    fileId,
    startedAt: now,
    uploadedMB: 0,
  });
  return state.lemonwire.activeSeeds.at(-1);
}

/**
 * Stop seeding. The file goes to the Recycle Bin rather than evaporating, so
 * chasing a better slot costs the disk space for a while — otherwise the "which
 * three files" decision could be re-taken for free every few seconds.
 */
export function stopSeeding(state, seedId) {
  const index = state.lemonwire.activeSeeds.findIndex((seed) => seed.id === seedId);
  if (index === -1) return { ok: false, reason: 'no-such-seed' };

  const [seed] = state.lemonwire.activeSeeds.splice(index, 1);
  state.lemonwire.trash.push({ fileId: seed.fileId, secondsLeft: LEMONWIRE.trashSeconds });
  return { ok: true, seed, secondsLeft: LEMONWIRE.trashSeconds };
}

/** Upload rate in KB/s, for the counter in the window. Cosmetic. */
export function uploadKBps(fileId, bandwidth = 1) {
  return seedWeight(fileId).total * LEMONWIRE.uploadKBpsPerWeight * bandwidth;
}

/**
 * Bookkeeping for the upload counters the UI shows. Purely cosmetic — the Buzz
 * itself is paid by the production formula in economy.js, like every other
 * producer, so it lands in one place and gets the global multipliers.
 */
export function updateSeeds(state, dt, bandwidth = 1) {
  if (!state.apps.lemonwire?.open) return;
  for (const seed of state.lemonwire.activeSeeds) {
    seed.uploadedMB += (uploadKBps(seed.fileId, bandwidth) * dt) / 1024;
  }
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

/* ------------------------------------------------------------ the connection */

export function connectionAt(index) {
  const list = LEMONWIRE.connections;
  return list[Math.min(Math.max(index | 0, 0), list.length - 1)];
}

export function nextConnection(index) {
  return LEMONWIRE.connections[index + 1] ?? null;
}

export function canUpgradeConnection(state) {
  const next = nextConnection(state.lemonwire.connection);
  if (!next) return { ok: false, reason: 'maxed' };
  if (state.buzz < next.cost) return { ok: false, reason: 'too-expensive', cost: next.cost };
  return { ok: true, cost: next.cost, connection: next };
}

export function upgradeConnection(state) {
  const check = canUpgradeConnection(state);
  if (!check.ok) return check;

  state.buzz -= check.cost;
  state.lemonwire.connection += 1;
  return { ok: true, connection: check.connection, cost: check.cost };
}
