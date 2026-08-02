/**
 * Timed buffs (AO-10 and everything after it).
 *
 * A buff is `{ id, kind, magnitude, expiresAt, label, source }`. Magnitudes are
 * fractional bonuses — 0.25 means +25% — and buffs of the same kind multiply,
 * so two +25% buffs give ×1.5625 rather than ×1.5.
 *
 * Buff kinds:
 *   'chat'   — AeroChat production only
 *   'global' — every producer
 *   'click'  — Nudge button payout
 *
 * Pure except for `addBuff`/`pruneBuffs`, which mutate the array they are given
 * (state mutation is game.js's job, and it calls these).
 */

export const BUFF_KINDS = ['chat', 'global', 'click'];

/**
 * Add a buff, or refresh one that is already running. Refreshing never shortens
 * an existing buff — a re-roll of the same bonus extends it instead.
 */
export function addBuff(state, def, now = Date.now()) {
  const expiresAt = now + def.durationSeconds * 1000;
  const existing = state.buffs.find((b) => b.id === def.id);

  if (existing) {
    existing.expiresAt = Math.max(existing.expiresAt, expiresAt);
    existing.magnitude = def.magnitude;
    return existing;
  }

  const buff = {
    id: def.id,
    kind: def.kind,
    magnitude: def.magnitude,
    label: def.label,
    source: def.source ?? null,
    expiresAt,
  };
  state.buffs.push(buff);
  return buff;
}

/** Drop expired buffs. Returns the ones that were removed, for notifications. */
export function pruneBuffs(state, now = Date.now()) {
  const expired = state.buffs.filter((b) => b.expiresAt <= now);
  if (expired.length > 0) {
    state.buffs = state.buffs.filter((b) => b.expiresAt > now);
  }
  return expired;
}

export function activeBuffs(state, now = Date.now()) {
  return state.buffs.filter((b) => b.expiresAt > now);
}

/** Combined multiplier for one kind. 1 when nothing is active. */
export function buffMultiplier(state, kind, now = Date.now()) {
  let multiplier = 1;
  for (const buff of state.buffs) {
    if (buff.kind === kind && buff.expiresAt > now) multiplier *= 1 + buff.magnitude;
  }
  return multiplier;
}

/** Seconds left on a buff, for the UI countdown. */
export function remainingSeconds(buff, now = Date.now()) {
  return Math.max(0, (buff.expiresAt - now) / 1000);
}
