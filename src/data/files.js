/**
 * LemonWire's shared-files list (AO-21, GDD 6).
 *
 * `risk` is the chance the finished download turns out to be infected, and it
 * correlates with reward: the sketchy 3 MB "speed boost" pays like a 4 GB ISO.
 * That is the whole decision the app offers — how much risk for how much Buzz.
 *
 * Payouts are measured in *seconds of current production* rather than flat Buzz
 * so a download stays meaningful at every stage of the game.
 */

export const FILES = [
  {
    id: 'wallpapers',
    name: 'Aero_Wallpaper_Pack_HQ.zip',
    sizeGB: 0.2,
    risk: 0.05,
    seeders: 48,
    kind: 'archive',
  },
  {
    id: 'soft-signals',
    name: 'SOFT_SIGNALS_-_full_album_[320kbps].rar',
    sizeGB: 0.5,
    risk: 0.1,
    seeders: 31,
    kind: 'audio',
  },
  {
    id: 'skins',
    name: 'WinAmp_skins_MEGA_PACK_2005.zip',
    sizeGB: 0.1,
    risk: 0.12,
    seeders: 22,
    kind: 'archive',
  },
  {
    id: 'anime',
    name: 'Naruto_ep01_[fansub].rmvb',
    sizeGB: 0.35,
    risk: 0.18,
    seeders: 14,
    kind: 'video',
  },
  {
    id: 'cam-movie',
    name: 'totally_legal_movie_CAM_GOOD_QUALITY.avi',
    sizeGB: 1.4,
    risk: 0.28,
    seeders: 9,
    kind: 'video',
  },
  {
    id: 'battlefront',
    name: 'Star_Wars_Battlefront_II_[NO-CD].iso',
    sizeGB: 4,
    risk: 0.22,
    seeders: 6,
    kind: 'disc',
  },
  {
    id: 'speed-boost',
    name: 'system32_SPEED_BOOST_2005.exe',
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

/** Rough risk band, for the UI to colour without repeating the thresholds. */
export function riskLabel(risk) {
  if (risk >= 0.5) return 'extreme';
  if (risk >= 0.25) return 'high';
  if (risk >= 0.12) return 'medium';
  return 'low';
}
