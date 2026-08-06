/**
 * RetroAmp playlists (AO-14, GDD 6).
 *
 * Two shapes, deliberately opposed:
 *  - a soft indie playlist that is a small multiplier you can leave running forever;
 *  - a heavy playlist that is a huge multiplier for five minutes, eats a lot of
 *    memory, and then needs to cool down.
 *
 * `multiplier` is a fractional bonus (0.15 = +15%). `ram` is charged on top of
 * RetroAmp's own footprint while the playlist is loaded — which is what turns
 * the heavy playlist into the player's first real memory bottleneck.
 */

export const PLAYLISTS = [
  {
    id: 'soft-signals',
    name: 'AERO AMBIENCE',
    genre: 'frutiger aero / chillout',
    blurb: 'Smooth, glossy lift. Leave it running.',
    multiplier: 0.15,
    ram: 0,
    durationSeconds: null, // runs until you eject it
    cooldownSeconds: 0,
    tracks: [
      'Welcome Music (Longhorn)',
      'ClearType Dreams',
      'Glossy Orb',
      'Aquatic Taskbar',
      'Aurora Bliss',
    ],
  },
  {
    id: 'iron-overdrive',
    name: 'P2P DOWNLOADER',
    genre: 'nu-metal / post-grunge',
    blurb: 'Enormous burst. Eats memory. Needs a rest afterwards.',
    multiplier: 2.0,
    ram: 64,
    durationSeconds: 300, // five minutes of triple production
    cooldownSeconds: 600,
    tracks: [
      '09-system_of_a_down-toxicity.mp3',
      'LinkinPark_Numb.mp3.exe',
      'Evanescence_BringMeToLife_320kbps',
      'PapaRoach_LastResort_LimeWire',
    ],
  },
  {
    id: 'y2k-trance',
    name: 'Y2K TRANCE',
    genre: 'eurodance / trance',
    blurb: 'Extreme boost for a short time. Melts your RAM.',
    multiplier: 5.0,
    ram: 256,
    durationSeconds: 120,
    cooldownSeconds: 1200,
    tracks: [
      'Darude_Sandstorm_HQ.mp3',
      'Alice_Dejay_Better_Off_Alone.mp3',
      'PPK_ResuRection_Space.mp3',
      'Kernkraft400_ZombieNation.mp3',
    ],
  },
];

const BY_ID = new Map(PLAYLISTS.map((playlist) => [playlist.id, playlist]));

export function getPlaylist(id) {
  const playlist = BY_ID.get(id);
  if (!playlist) throw new Error(`Unknown playlist: ${id}`);
  return playlist;
}

/** Track shown in the "now playing" display; rotates on its own clock. */
export function trackAt(playlistId, index) {
  const { tracks } = getPlaylist(playlistId);
  return tracks[((index % tracks.length) + tracks.length) % tracks.length];
}
