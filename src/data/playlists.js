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
    name: 'SOFT SIGNALS',
    genre: 'indie / shoegaze',
    blurb: 'Small, permanent lift. Leave it running.',
    multiplier: 0.15,
    ram: 0,
    durationSeconds: null, // runs until you eject it
    cooldownSeconds: 0,
    tracks: [
      'Glass Corridor',
      'Modem Lullaby',
      'Photocopy Heart',
      'Wet Grass, 4am',
      'Everything Blue Again',
    ],
  },
  {
    id: 'iron-overdrive',
    name: 'IRON OVERDRIVE',
    genre: 'heavy metal',
    blurb: 'Enormous burst. Eats memory. Needs a rest afterwards.',
    multiplier: 2.0,
    ram: 64,
    durationSeconds: 300, // five minutes of triple production
    cooldownSeconds: 600,
    tracks: [
      'Chrome Vengeance',
      'Fan Noise Cathedral',
      'Overclock Requiem',
      'Thermal Paste Massacre',
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
