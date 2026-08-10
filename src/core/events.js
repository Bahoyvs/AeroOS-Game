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
  UNITS_BOUGHT: 'building:bought', // { id, count, cost, units }
  MILESTONE: 'building:milestone', // { id, at, multiplier, minigameUnlocked }
  STATUS_SPAWNED: 'status:spawned', // { index, bonusId, expiresAt }
  STATUS_MISSED: 'status:missed', // { index, bonusId }
  STATUS_CLAIMED: 'status:claimed', // { bonus, buzz }
  BUFF_EXPIRED: 'buff:expired', // { buff }
  SEED_STARTED: 'lemonwire:seeding', // { seed, file }
  SEED_STOPPED: 'lemonwire:stopped', // { file, secondsLeft }
  BANDWIDTH_UPGRADED: 'lemonwire:bandwidth', // { connection, cost }
  TRASH_EMPTIED: 'lemonwire:trashed', // { file } — its disk space came back
  SWEEPER_STARTED: 'sweeper:started', // { tokensLeft }
  SWEEPER_ENDED: 'sweeper:ended', // { tiles, combo, buzz, best }
  SWEEPER_TOKEN: 'sweeper:token', // { granted, tokens, bought }
  PLAYLIST_LOADED: 'retroamp:loaded', // { playlist }
  PLAYLIST_ENDED: 'retroamp:ended', // { playlist, reason }
  TUTORIAL_STEP: 'tutorial:step', // { completed, next, done }
  HARDWARE_REVEALED: 'tutorial:hardware', // {}
  HARDWARE_BOUGHT: 'hardware:bought', // { track, tier }
  DEFRAG_INSTALLED: 'defrag:installed', // { cost }
  DEFRAG_STARTED: 'defrag:started', // { from } — bloat the pass engaged at
  DEFRAG_DONE: 'defrag:done', // { from, passes }
  COSMETIC_CHANGED: 'cosmetics:changed', // { kind, item }
  COSMETIC_UNLOCKED: 'cosmetics:unlocked', // { item }
  FORMAT_REQUESTED: 'prestige:requested', // { dollars } — UI runs the sequence
  PRESTIGE: 'prestige', // { dollars, bonus }
  AD_REWARD: 'ads:rewarded', // { id, reward } — a rewarded ad has been paid out
  SETTINGS: 'settings:changed', // { settings }
  SAVED: 'save:written', // { at }
  LOADED: 'save:loaded', // { offline }
  NOTIFY: 'ui:notify', // { title, body, tone }
};
