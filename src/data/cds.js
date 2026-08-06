/**
 * AeroBurn discs (AO-29, GDD 6).
 *
 * "Burns excess Buzz onto a CD that survives the prestige wipe, granting
 * starting boosts for the next run." Two kinds, deliberately different in what
 * they carry across the wipe:
 *
 *  - MIX carries *value*: Buzz in, less Buzz out. A savings account with a
 *    haircut, so hoarding is never strictly better than spending.
 *  - OVERCLOCK carries *time*: a burst of production you can bank now and cash
 *    at the start of a fresh run, when a multiplier is worth the most.
 */

export const CD_TYPES = [
  {
    id: 'mix',
    name: 'Mix CD',
    label: 'MIX',
    blurb: 'Stores Buzz through a Format C:, minus the burn loss.',
    cost: 5000, // Buzz spent per disc
    recovery: 0.6, // ...and what you get back when you play it
    burnSeconds: 20,
    color: '#c9e7ff',
  },
  {
    id: 'overclock',
    name: 'Overclock Disc',
    label: 'O/C',
    blurb: 'Play it on a fresh run for double production.',
    cost: 20000,
    buff: { id: 'cd-overclock', kind: 'global', magnitude: 1.0, durationSeconds: 300, label: 'Overclocked' },
    burnSeconds: 35,
    color: '#ffd9a3',
  },
  {
    id: 'gold-master',
    name: 'Gold Master',
    label: 'GOLD',
    blurb: 'High-density archival disc. Stash a massive fortune before a total Format C:.',
    cost: 1000000,
    recovery: 0.8,
    burnSeconds: 120,
    color: '#ffd700',
  },
];

const BY_ID = new Map(CD_TYPES.map((cd) => [cd.id, cd]));

export function getCD(id) {
  const cd = BY_ID.get(id);
  if (!cd) throw new Error(`Unknown CD type: ${id}`);
  return cd;
}
