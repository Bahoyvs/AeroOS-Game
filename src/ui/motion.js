/**
 * Who decides whether the desktop animates.
 *
 * The stylesheet does not read `prefers-reduced-motion` directly any more. It
 * reads `:root[data-motion]`, and this module is the only thing that writes it,
 * resolving the OS preference against the player's own setting:
 *
 *   auto     follow the OS (the default, and the accessible one)
 *   full     animate regardless of the OS
 *   reduced  never animate, whatever the OS says
 *
 * The reason 'full' exists: "show animations in Windows" is a machine-wide
 * switch people flip once for performance and forget. With `auto` as the only
 * behaviour, that setting silently strips every window transition, meter and
 * playhead in the game and there is nothing in the game to tell them why.
 */

export const MOTION_MODES = ['auto', 'full', 'reduced'];

export const MOTION_LABELS = {
  auto: 'Match system',
  full: 'Always on',
  reduced: 'Reduced',
};

/** The OS preference, on its own. Safe to call in a non-browser test run. */
export function systemPrefersReducedMotion() {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Resolve a stored setting plus the OS preference down to 'full' | 'reduced'. */
export function resolveMotion(mode, systemReduced = systemPrefersReducedMotion()) {
  if (mode === 'full') return 'full';
  if (mode === 'reduced') return 'reduced';
  return systemReduced ? 'reduced' : 'full';
}

/**
 * Publish the resolved preference on <html> and keep it there. Re-applies when
 * the player changes the setting and when the OS preference itself changes.
 */
export function createMotionPreference({ game, root = document.documentElement }) {
  const query = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') ?? {
    matches: false,
    addEventListener() {},
  };

  const resolved = () => resolveMotion(game.state.settings.motion, query.matches);

  function apply() {
    root.dataset.motion = resolved();
  }

  query.addEventListener?.('change', apply);
  game.bus.on(game.events.SETTINGS, apply);
  apply();

  return {
    apply,
    resolved,
    isReduced: () => resolved() === 'reduced',
  };
}
