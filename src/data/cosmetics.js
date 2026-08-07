/**
 * Personalisation — the Display Properties panel in My Computer.
 *
 * Two lists with one shape: an id, a label, a line of flavour, and the
 * condition that unlocks it. Nothing here is a mechanic — a tint is a set of
 * CSS custom properties, a wallpaper is a JPEG — and neither list knows how it
 * is painted. `src/styles/themes.css` is what draws them, keyed off `data-tint`
 * and `data-wallpaper` on <html>.
 *
 * Two rules make the whole system cheap:
 *
 * - **Unlocks are predicates over ordinary state, never a stored flag.** Same
 *   reasoning as `core/goals.js`: there is no migration, no cosmetic that can
 *   get stuck locked, and re-tuning a threshold takes effect on the next frame.
 * - **Every counter they read is monotonic** — `lifetimeBuzz`, `prestigeCount`
 *   and `dollarsSpentTotal` all survive a Format C:. That is what makes it safe
 *   to derive rather than store: an unlock can never be taken back, so the
 *   player's chosen tint cannot vanish underneath them.
 */

/** Unlock kinds, in the order the panel should teach them. */
export const UNLOCK = {
  always: () => ({ kind: 'always' }),
  lifetimeBuzz: (at) => ({ kind: 'lifetimeBuzz', at }),
  prestige: (at) => ({ kind: 'prestige', at }),
  dollarsSpent: (at) => ({ kind: 'dollarsSpent', at }),
};

/**
 * Window tints. `swatch` is the potted version of the palette that the picker
 * draws in the chip — the real theme lives in the stylesheet, because a tint is
 * half a dozen custom properties and duplicating them here would be two sources
 * of truth for one colour.
 */
export const TINTS = [
  {
    id: 'aqua',
    label: 'Aqua Blue',
    blurb: 'The factory finish. Wet glass over a summer sky.',
    swatch: 'linear-gradient(160deg, #9fe6ff, #1b7fd4 60%, #0a4d8c)',
    unlock: UNLOCK.always(),
  },
  {
    id: 'toxic',
    label: 'Toxic Green',
    blurb: 'Chassis lighting for a machine that runs too hot anyway.',
    swatch: 'linear-gradient(160deg, #d6ffb8, #4fc21f 58%, #14611a)',
    unlock: UNLOCK.dollarsSpent(1),
  },
  {
    id: 'midnight',
    label: 'Midnight Aero',
    blurb: 'The same glass at 3am, lit from underneath.',
    swatch: 'linear-gradient(160deg, #7fa8ff, #2b3f8c 55%, #101a3a)',
    unlock: UNLOCK.lifetimeBuzz(50_000),
  },
  {
    id: 'sunset',
    label: 'Sunset Chrome',
    blurb: 'Warm plastic and a low orange sun. Peak 2006.',
    swatch: 'linear-gradient(160deg, #ffd9a3, #f0762c 58%, #8c2f0a)',
    unlock: UNLOCK.dollarsSpent(20),
  },
];

/**
 * Wallpapers — photographs, unlike the tints.
 *
 * Each one is a real JPEG in `src/assets/wallpapers/`, and the id is the file
 * stem: `styles/themes.css` owns both URLs (the desktop, and the thumbnail the
 * swatch draws), so a wallpaper is named in exactly one place here and painted
 * in exactly one place there. That is also why these entries carry no `swatch`
 * string — the chip is keyed off the id.
 *
 * The order is the order they unlock in, and it is a deliberate arc: open on
 * bright daylight, and hand out dusk and then night as the rarer prizes.
 */
export const WALLPAPERS = [
  {
    id: 'blue-lagoon',
    label: 'Blue Lagoon',
    blurb: 'Three palm trees, one sail, and water the colour of a screensaver.',
    unlock: UNLOCK.always(),
  },
  {
    id: 'green-hill',
    label: 'Green Hill',
    blurb: 'The most-looked-at photograph ever taken. You know this hill.',
    unlock: UNLOCK.prestige(1),
  },
  {
    id: 'moonlit-peak',
    label: 'Moonlit Peak',
    blurb: 'A blue mountain at dusk with the moon already up. Nobody is on it.',
    unlock: UNLOCK.dollarsSpent(5),
  },
  {
    id: 'crimson-dunes',
    label: 'Crimson Dunes',
    blurb: 'Red sand under a full moon, raked into ridges by a wind that has gone.',
    unlock: UNLOCK.lifetimeBuzz(5_000_000),
  },
];

export const COSMETIC_KINDS = ['tint', 'wallpaper'];

/** The lists, addressable by the same key the save uses. */
export const COSMETICS = { tint: TINTS, wallpaper: WALLPAPERS };

/** What a fresh install boots with — always the `always`-unlocked first entry. */
export const DEFAULT_COSMETICS = { tint: TINTS[0].id, wallpaper: WALLPAPERS[0].id };

export function getCosmetic(kind, id) {
  return COSMETICS[kind]?.find((item) => item.id === id) ?? null;
}
