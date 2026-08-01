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
  HARDWARE_BOUGHT: 'hardware:bought', // { track, tier }
  PRESTIGE: 'prestige', // { dollars }
  SAVED: 'save:written', // { at }
  LOADED: 'save:loaded', // { offline }
  NOTIFY: 'ui:notify', // { title, body, tone }
};
