import { AEROBURN } from '../data/balance.js';
import { getCD } from '../data/cds.js';
import { addBuff } from './buffs.js';

/**
 * AeroBurn (AO-29): the only thing besides hardware and Dollars that survives a
 * Format C:. Burning runs on simulation time while the window is open, like
 * every other job in the OS.
 */

export function canBurn(state, typeId) {
  const cd = getCD(typeId);
  if (!state.apps.aeroburn?.open) return { ok: false, reason: 'not-open' };
  if (state.aeroburn.burning) return { ok: false, reason: 'already-burning' };
  if (state.aeroburn.discs.length >= AEROBURN.maxDiscs) return { ok: false, reason: 'shelf-full' };
  if (state.buzz < cd.cost) return { ok: false, reason: 'too-expensive', cost: cd.cost };
  return { ok: true, cd };
}

/** Charge the Buzz up front — a cancelled burn is a wasted disc, as it should be. */
export function startBurn(state, typeId) {
  const cd = getCD(typeId);
  state.buzz -= cd.cost;
  state.aeroburn.burning = {
    typeId,
    secondsLeft: cd.burnSeconds,
    total: cd.burnSeconds,
    spent: cd.cost,
  };
  return state.aeroburn.burning;
}

export function burnProgress(state) {
  const job = state.aeroburn.burning;
  return job ? 1 - job.secondsLeft / job.total : 0;
}

/**
 * Advance the burner. Returns the finished disc, or null. Closing AeroBurn
 * pauses the burn rather than losing it — the Buzz is already spent.
 */
export function updateBurn(state, dt) {
  const job = state.aeroburn.burning;
  if (!job || !state.apps.aeroburn?.open) return null;

  job.secondsLeft -= dt;
  if (job.secondsLeft > 0) return null;

  const disc = { typeId: job.typeId, spent: job.spent };
  state.aeroburn.discs.push(disc);
  state.aeroburn.burned += 1;
  state.aeroburn.burning = null;
  return disc;
}

export function canPlay(state, index) {
  if (!state.apps.aeroburn?.open) return { ok: false, reason: 'not-open' };
  if (!state.aeroburn.discs[index]) return { ok: false, reason: 'no-disc' };
  return { ok: true };
}

/**
 * Play a disc: MIX pays back its stored Buzz at the recovery rate, OVERCLOCK
 * applies its buff. Either way the disc is consumed.
 */
export function playDisc(state, index, now = Date.now()) {
  const check = canPlay(state, index);
  if (!check.ok) return check;

  const [disc] = state.aeroburn.discs.splice(index, 1);
  const cd = getCD(disc.typeId);

  if (cd.recovery) {
    return { ok: true, cd, buzz: disc.spent * cd.recovery };
  }
  addBuff(state, { ...cd.buff, source: 'aeroburn' }, now);
  return { ok: true, cd, buff: cd.buff, buzz: 0 };
}

/** Discs are the one soft-currency asset that outlives the wipe. */
export function carryDiscsThroughPrestige(previous, fresh) {
  fresh.aeroburn.discs = previous.aeroburn.discs.map((disc) => ({ ...disc }));
  fresh.aeroburn.burned = previous.aeroburn.burned;
  return fresh;
}
