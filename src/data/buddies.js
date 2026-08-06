/**
 * Buddy identities (AO-8).
 *
 * Buddies are *derived*, never stored: `state.chat.bots` is a count, and every
 * visual detail — nickname, display picture, ambient status, away state — is a
 * pure function of the buddy's index. That keeps saves tiny and identities
 * stable across reloads, and means 500 buddies cost nothing until they are drawn.
 */

const NICKS = [
  'Baho_007',
  'xX_aero_Xx',
  '~*SilverFrost*~',
  'vista_vibes',
  'GlossyPanda',
  'rawr_xD',
  'Motorola_Razr',
  'LimeWire_Legend',
  'frutiger.fan',
  'scene_queen_xX',
  'MSN_Marcus',
  '~*StArBuCkS_L0v3r*~',
  'AeroGlass_Kid',
  'DriveByDownload',
  'sysfan_spins',
  'ParamoreFan_05',
  'ctrl_alt_defeat',
  'WMP_visualizer',
  'pixel_pusher',
  'Halo3_Sniper',
  'xX_DaRk_AnGeL_Xx',
  'gadget_geek_09',
  'ScreenSaverSam',
  'burnt_toast_04',
];

const SUFFIXES = ['', '_', '99', 'xX', '_2007', '.tr', '09'];

const AVATARS = ['🙂', '😎', '👾', '🎮', '🛹', '🎸', '🌸', '🖤', '🎧', '💾', '💿', '🦋', '🐬', '🧊'];

/** Ordinary flavour statuses — no mechanical effect (see STATUS_BONUSES). */
const AMBIENT_STATUSES = [
  'listening to: Linkin Park - Numb',
  'rawr means i love you in dinosaur XD',
  'changed their display picture',
  'don\'t message me, i\'m mad.',
  'downloading 1 song off limewire, 5 hours left...',
  'is customising their MySpace layout',
  'stuck on Windows Vista updates...',
  'playing Halo 3 custom games',
  'nudge me if you need anything',
  'does anyone have the cheat codes for GTA?',
  '~*~ LiFe iS PaIn ~*~',
  '(brb) changing my aero glass color',
];

/** Cheap deterministic hash — same index always yields the same buddy. */
function hash(...parts) {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const value = typeof part === 'number' ? part : [...String(part)].reduce((a, c) => a + c.charCodeAt(0), 0);
    h ^= value + 0x9e3779b9 + (h << 6) + (h >>> 2);
    h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
  }
  return h >>> 0;
}

const pick = (list, seed) => list[seed % list.length];

/** Stable identity for the buddy at `index`. */
export function buddyAt(index) {
  const seed = hash(index);
  const nick = pick(NICKS, seed);
  // Unsigned shifts: `>>` would go negative for large hashes and index off the end.
  const suffix = pick(SUFFIXES, seed >>> 7);
  // Repeat visitors get a numbered nick rather than a duplicate name.
  const cycle = Math.floor(index / NICKS.length);
  return {
    index,
    name: cycle === 0 ? nick + suffix : `${nick}${suffix}${cycle + 1}`,
    avatar: pick(AVATARS, seed >>> 3),
  };
}

/**
 * Ambient status for a buddy in a given rotation epoch. Passing the epoch (not
 * the clock) keeps this pure and makes the rotation testable.
 */
export function ambientStatus(index, epoch) {
  return pick(AMBIENT_STATUSES, hash(index, epoch));
}

/** Roughly one buddy in five is away in any given epoch. Cosmetic only. */
export function isAway(index, epoch) {
  return hash(index, epoch, 'away') % 5 === 0;
}

export const BUDDY_NICK_COUNT = NICKS.length;
