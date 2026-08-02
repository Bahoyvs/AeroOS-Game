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
  'dial_up_dan',
  'GlossyPanda',
  'mIRC_veteran',
  'N0kia_3310',
  'CD_Burner_King',
  'frutiger.fan',
  'LAN_party_lisa',
  'MSN_Marcus',
  'bubble.tea.99',
  '[[ neon_kid ]]',
  'DriveByDownload',
  'sysfan_spins',
  'lo-fi_lauren',
  'ctrl_alt_defeat',
  'WinAmpWizard',
  'pixel_pusher',
  'modem_mika',
  'gLiTtEr_gRrL',
  'defrag_daddy',
  'ScreenSaverSam',
  'burnt_toast_04',
];

const SUFFIXES = ['', '_', '99', 'xX', '_2k5', '.tr', '01'];

const AVATARS = ['🙂', '😎', '👾', '🐧', '🦊', '🐼', '🌸', '⭐', '🎧', '💾', '📀', '🛸', '🐉', '☕'];

/** Ordinary flavour statuses — no mechanical effect (see STATUS_BONUSES). */
const AMBIENT_STATUSES = [
  'brb, mum needs the phone',
  'is defragging C:',
  'changed their display picture',
  'is away — dinner',
  'is watching a 240p music video',
  'is downloading something totally legal',
  'has 3 windows open and no idea why',
  'is waiting for a 4 MB file',
  'nudge me if you need anything',
  'is reading the CD booklet',
  'left the modem on all night',
  'is customising their profile again',
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
