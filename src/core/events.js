/**
 * Tiny synchronous event bus. The simulation emits, the UI listens — no UI
 * module ever reaches back into the game loop.
 */
export function createEventBus() {
  const listeners = new Map();

  return {
    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      return () => this.off(type, fn);
    },

    off(type, fn) {
      listeners.get(type)?.delete(fn);
    },

    emit(type, payload) {
      for (const fn of listeners.get(type) ?? []) {
        try {
          fn(payload);
        } catch (err) {
          // A broken listener must never take the simulation down with it.
          console.error(`[events] listener for "${type}" threw`, err);
        }
      }
    },

    clear() {
      listeners.clear();
    },
  };
}

/** Event names, kept in one place so typos surface as import errors. */
export const EVENTS = {
  TICK: 'tick', // { state, dt }
  RENDER: 'render', // { state }
  BUZZ_GAINED: 'buzz:gained', // { amount, source }
  APP_OPENED: 'app:opened', // { id }
  APP_CLOSED: 'app:closed', // { id }
  APP_INSTALLED: 'app:installed', // { id }
  OUT_OF_MEMORY: 'system:oom', // { id, needed, free }
  BOT_BOUGHT: 'chat:bot', // { count, cost }
  MILESTONE: 'chat:milestone', // { at, multiplier }
  STATUS_SPAWNED: 'status:spawned', // { index, bonusId, expiresAt }
  STATUS_MISSED: 'status:missed', // { index, bonusId }
  STATUS_CLAIMED: 'status:claimed', // { bonus, buzz }
  BUFF_EXPIRED: 'buff:expired', // { buff }
  DOWNLOAD_STARTED: 'lemonwire:started', // { job, file }
  DOWNLOAD_DONE: 'lemonwire:done', // { file, payout }
  DOWNLOAD_CANCELLED: 'lemonwire:cancelled', // { job }
  FILE_DELETED: 'lemonwire:deleted', // { file, secondsLeft }
  TRASH_EMPTIED: 'lemonwire:trashed', // { file } — its disk space came back
  VIRUS: 'security:virus', // { file, outcome: blocked | rescued | infected }
  SCAN_STARTED: 'security:scan', // {}
  SCAN_DONE: 'security:scanned', // { cured }
  BURN_STARTED: 'aeroburn:started', // { cd, job }
  BURN_DONE: 'aeroburn:done', // { cd, disc }
  DISC_PLAYED: 'aeroburn:played', // { cd, buzz }
  PLAYLIST_LOADED: 'retroamp:loaded', // { playlist }
  PLAYLIST_ENDED: 'retroamp:ended', // { playlist, reason }
  TUTORIAL_STEP: 'tutorial:step', // { completed, next, done }
  HARDWARE_REVEALED: 'tutorial:hardware', // {}
  HARDWARE_BOUGHT: 'hardware:bought', // { track, tier }
  FORMAT_REQUESTED: 'prestige:requested', // { dollars } — UI runs the sequence
  PRESTIGE: 'prestige', // { dollars }
  SETTINGS: 'settings:changed', // { settings }
  SAVED: 'save:written', // { at }
  LOADED: 'save:loaded', // { offline }
  NOTIFY: 'ui:notify', // { title, body, tone }
};
