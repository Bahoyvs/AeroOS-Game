/**
 * LemonWire's shared-files list (AO-21, GDD 6).
 *
 * These are the files the player can *seed*. Three fields decide what a slot is
 * worth: `sizeGB` costs disk and pays a little, `seeders` is inverted into a
 * rarity premium (a swarm of six needs you; a swarm of 302 does not), and
 * `risk` pays the most while deciding how often Shield99 has something to
 * quarantine. That is the whole decision the app offers.
 */

export const FILES = [
  {
    id: 'wallpapers',
    name: 'Windows_Vista_DreamScene_Pack.zip',
    sizeGB: 0.2,
    risk: 0.05,
    seeders: 48,
    kind: 'archive',
  },
  {
    id: 'soft-signals',
    name: 'AERO_AMBIENCE_-_full_album_[320kbps].rar',
    sizeGB: 0.5,
    risk: 0.1,
    seeders: 31,
    kind: 'audio',
  },
  {
    id: 'skins',
    name: 'WMP11_Custom_Glass_Skins_2007.zip',
    sizeGB: 0.1,
    risk: 0.12,
    seeders: 22,
    kind: 'archive',
  },
  {
    id: 'anime',
    name: 'Bleach_ep01_[Dattebayo]_HQ.rmvb',
    sizeGB: 0.35,
    risk: 0.18,
    seeders: 14,
    kind: 'video',
  },
  {
    id: 'cam-movie',
    name: 'Transformers_2007_CAM_XviD-aXXo.avi',
    sizeGB: 1.4,
    risk: 0.28,
    seeders: 9,
    kind: 'video',
  },
  {
    id: 'battlefront',
    name: 'Crysis_2007_Full_Game+Keygen.iso',
    sizeGB: 4,
    risk: 0.22,
    seeders: 6,
    kind: 'disc',
  },
  {
    id: 'speed-boost',
    name: 'LimeWire_PRO_v4.18_Crack_NoVirus.exe',
    sizeGB: 0.003,
    risk: 0.75,
    seeders: 302, // suspiciously popular
    kind: 'program',
  },
];

const BY_ID = new Map(FILES.map((file) => [file.id, file]));

export function getFile(id) {
  const file = BY_ID.get(id);
  if (!file) throw new Error(`Unknown file: ${id}`);
  return file;
}

/** Does this id still exist? Migrated saves may name a file we have retired. */
export function hasFile(id) {
  return BY_ID.has(id);
}

/** Rough risk band, for the UI to colour without repeating the thresholds. */
export function riskLabel(risk) {
  if (risk >= 0.5) return 'extreme';
  if (risk >= 0.25) return 'high';
  if (risk >= 0.12) return 'medium';
  return 'low';
}
