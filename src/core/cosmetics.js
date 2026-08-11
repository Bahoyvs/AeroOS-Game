import {
  COSMETICS,
  COSMETIC_KINDS,
  DEFAULT_COSMETICS,
  getCosmetic,
} from '../data/cosmetics.js';
import { formatNumber } from './format.js';

/**
 * Cosmetics, resolved. Pure functions over the whole state, like the rest of
 * `core/` — nothing in here knows that a tint is eventually a CSS variable.
 *
 * The save stores one id per kind and nothing else. Which cosmetics are
 * *available* is derived every time it is asked, from counters that only ever
 * go up (see the note in data/cosmetics.js), so there is no unlock list to
 * migrate and no way for an owned cosmetic to be revoked.
 */

/** How far along an unlock condition the player currently is. */
function measure(state, unlock) {
  switch (unlock.kind) {
    case 'lifetimeBuzz':
      return { at: unlock.at, have: state.lifetimeBuzz, requirement: `${formatNumber(unlock.at)} lifetime Buzz` };
    case 'prestige':
      return {
        at: unlock.at,
        have: state.prestigeCount,
        requirement: unlock.at === 1 ? 'your first Format C:' : `${unlock.at} Format C: wipes`,
      };
    case 'dollarsSpent':
      return {
        at: unlock.at,
        have: state.dollarsSpentTotal ?? 0,
        requirement: `$${unlock.at.toFixed(2)} spent on hardware`,
      };
    case 'overflows':
      return {
        at: unlock.at,
        have: state.event?.overflowsResolved ?? 0,
        requirement:
          unlock.at === 1 ? 'surviving a Buffer Overflow' : `${unlock.at} Buffer Overflows`,
      };
    default:
      return { at: 0, have: 1, requirement: 'included' };
  }
}

export function isCosmeticUnlocked(state, item) {
  const { at, have } = measure(state, item.unlock);
  return have >= at;
}

export function allUnlocked(state) {
  for (const kind of COSMETIC_KINDS) {
    for (const item of COSMETICS[kind]) {
      if (!isCosmeticUnlocked(state, item)) return false;
    }
  }
  return true;
}

/**
 * One picker row: the item, whether it is unlocked, how close it is, and the
 * sentence the UI puts under a locked chip. Deriving the whole row here is what
 * keeps `apps/system.js` free of unlock rules.
 */
export function cosmeticRow(state, kind, item) {
  const { at, have, requirement } = measure(state, item.unlock);
  const unlocked = have >= at;
  return {
    ...item,
    kind,
    unlocked,
    selected: selectedCosmetic(state, kind).id === item.id,
    requirement,
    ratio: at <= 0 ? 1 : Math.min(1, Math.max(0, have / at)),
  };
}

export function cosmeticSummary(state) {
  const out = {};
  for (const kind of COSMETIC_KINDS) {
    out[kind] = COSMETICS[kind].map((item) => cosmeticRow(state, kind, item));
  }
  return out;
}

/**
 * The cosmetic actually in force for a kind.
 *
 * It falls back to the default for an id that is unknown (a cosmetic retired
 * from the roster) or not yet unlocked (a save edited by hand). The desktop has
 * to be *drawable* from any save, so this can never return null.
 */
export function selectedCosmetic(state, kind) {
  const stored = state.cosmetics?.[kind];
  const item = getCosmetic(kind, stored);
  if (item && isCosmeticUnlocked(state, item)) return item;
  return getCosmetic(kind, DEFAULT_COSMETICS[kind]);
}

/** Everything the shell needs to dress the desktop, in one call. */
export function activeCosmetics(state) {
  const out = {};
  for (const kind of COSMETIC_KINDS) out[kind] = selectedCosmetic(state, kind);
  return out;
}

/**
 * Apply a choice. Returns a refusal rather than throwing, like every other
 * action in this codebase, so the picker can explain itself without owning a
 * second copy of the unlock rules.
 */
export function chooseCosmetic(state, kind, id) {
  if (!COSMETIC_KINDS.includes(kind)) return { ok: false, reason: 'unknown-kind' };
  const item = getCosmetic(kind, id);
  if (!item) return { ok: false, reason: 'unknown-cosmetic' };
  if (!isCosmeticUnlocked(state, item)) return { ok: false, reason: 'locked' };
  if (state.cosmetics[kind] === id) return { ok: false, reason: 'already-selected' };

  state.cosmetics[kind] = id;
  return { ok: true, item };
}

/**
 * Cosmetics unlocked since the last time the player looked, so the shell can
 * say "Midnight Aero is available" at the moment it becomes true rather than
 * leaving it to be discovered in a settings panel nobody reopens.
 *
 * `seen` is a plain array of ids in the save; this returns the newcomers and
 * records them in one pass, because a notification fired twice is worse than
 * one never fired at all.
 */
export function takeNewlyUnlocked(state) {
  const seen = new Set(state.cosmetics.seen ?? []);
  const before = seen.size;
  const fresh = [];

  for (const kind of COSMETIC_KINDS) {
    for (const item of COSMETICS[kind]) {
      if (!isCosmeticUnlocked(state, item)) continue;
      const key = `${kind}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // The defaults are never news — they were there on the first boot.
      if (item.unlock.kind !== 'always') fresh.push({ ...item, kind });
    }
  }

  // Only write when something actually changed: this is called from the tick,
  // and rebuilding the array ten times a second to say "nothing new" is pure
  // garbage collection.
  if (seen.size !== before) state.cosmetics.seen = [...seen];
  return fresh;
}
