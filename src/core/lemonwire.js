import { LEMONWIRE } from '../data/balance.js';
import { FILES, getFile, peerAt } from '../data/files.js';

/**
 * LemonWire — building #5's swarm.
 *
 * This module used to own a mechanic: seed slots the player filled by hand,
 * paying Buzz on their own schedule. Phase 2 of the redesign folded that into
 * the building model (GDD v2 §2.2, and the "known overlap" note in
 * docs/REDESIGN-PLAN.md) — LemonWire was a producer *and* a building with
 * units, which is two economies in one window.
 *
 * What survives is the part that was never about income: the swarm's *texture*.
 * Which files the peers are sharing, how much disk that implies, how many green
 * connection bars are lit. All of it derived from the unit count, none of it
 * stored — the same contract `data/buddies.js` has with AeroChat.
 *
 * The three-way trade the old app offered (size vs rarity vs risk) is not gone
 * either; it moved from a decision into a progression. `peerAt` weights rarer
 * and riskier files deeper into the swarm, so a player watching the list grow
 * sees exactly the spread they used to choose between.
 */

/**
 * What one file is worth to the swarm, as a display figure.
 *
 * No longer feeds production — units do that — but it is still what makes one
 * row of the list read as more valuable than another, and the numbers are the
 * ones players already learned.
 */
export function seedWeight(fileId) {
  const file = getFile(fileId);
  const size = 1 + file.sizeGB * LEMONWIRE.weightPerGB;
  const risk = 1 + file.risk * LEMONWIRE.riskPayoutBonus;
  // Rarity premium, inverted: a swarm of six needs you, a swarm of 302 does not.
  const demand = Math.min(
    LEMONWIRE.maxDemandModifier,
    Math.max(LEMONWIRE.minDemandModifier, LEMONWIRE.seedersPivot / Math.max(1, file.seeders)),
  );
  return { size, risk, demand, total: size * risk * demand };
}

/**
 * The swarm as the window draws it: one entry per file, with how many of the
 * player's peers are sharing it. Derived from `units`, capped at `limit` rows
 * so a swarm of five hundred is still a list somebody can read.
 */
export function swarm(units, limit = FILES.length) {
  const counts = new Map();
  for (let i = 0; i < units; i += 1) {
    const file = peerAt(i);
    counts.set(file.id, (counts.get(file.id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([fileId, peers]) => ({ file: getFile(fileId), peers, weight: seedWeight(fileId) }))
    .sort((a, b) => b.peers - a.peers)
    .slice(0, limit);
}

/** Disk the swarm implies. Flavour, but it is what the disk bar is measuring. */
export function storageUsedGB(units) {
  let total = 0;
  for (const row of swarm(units)) total += row.file.sizeGB * row.peers;
  return Math.round(total * 1000) / 1000;
}

/**
 * The connection tier, from the milestone tier rather than a Buzz purchase.
 *
 * This is GDD §4's "5 green connection bars" — the visual progression that
 * replaced the old `[Upgrade]` button. It is derived, so it cannot desync from
 * the milestone celebration that announces it.
 */
export function connectionAt(index) {
  const tiers = LEMONWIRE.connections;
  return tiers[Math.min(Math.max(index, 0), tiers.length - 1)];
}

/** Total risk the swarm is carrying. A readable stat for the status bar. */
export function swarmRisk(units) {
  let total = 0;
  for (const row of swarm(units)) total += row.file.risk * row.peers;
  return Math.round(total * 100) / 100;
}

/** The cosmetic KB/s counter next to a row. Period-accurate rather than generous. */
export function uploadKBps(fileId, peers = 1) {
  return Math.max(1, Math.round(seedWeight(fileId).total * peers * LEMONWIRE.uploadKBpsPerWeight));
}
