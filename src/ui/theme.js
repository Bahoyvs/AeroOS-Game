/**
 * Who decides what the desktop looks like.
 *
 * Exactly the shape of `ui/motion.js`, and for the same reason: the stylesheet
 * never reads game state, it reads one attribute, and this module is the only
 * thing that writes it. `data-tint` swaps the glass palette, `data-wallpaper`
 * swaps the background — both in `styles/themes.css`.
 *
 * Everything it needs is derived (`game.activeCosmetics()` falls back to the
 * defaults for an unknown or locked id), so there is no state here to get out
 * of step with the save.
 */
export function createTheme({ game, root = document.documentElement }) {
  function apply() {
    const active = game.activeCosmetics();
    root.dataset.tint = active.tint.id;
    root.dataset.wallpaper = active.wallpaper.id;
  }

  // A Format C: cannot revoke a cosmetic (every unlock counter survives the
  // wipe), but it does rebuild the state object — so re-read rather than
  // assume the attributes still describe it.
  game.bus.on(game.events.COSMETIC_CHANGED, apply);
  game.bus.on(game.events.PRESTIGE, apply);
  game.bus.on(game.events.LOADED, apply);
  apply();

  return { apply };
}
