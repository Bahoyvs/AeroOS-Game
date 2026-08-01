import { SAVE } from '../data/balance.js';
import { getApp } from '../data/apps.js';
import { HARDWARE, nextTierOf } from '../data/hardware.js';
import * as econ from './economy.js';
import { EVENTS, createEventBus } from './events.js';
import { defaultStorage, loadGame, saveGame } from './save.js';
import { createInitialState, resetForPrestige } from './state.js';

/**
 * The game object owns the only mutable state in the app. UI modules read it
 * through `game.state` and change it only by calling the actions below, which
 * emit events describing what happened. Nothing here touches the DOM.
 */
export function createGame({ storage = defaultStorage(), now = Date.now() } = {}) {
  const bus = createEventBus();
  let state = createInitialState(now);
  let lastSaveAt = now;
  let offlineReport = null;

  function grantBuzz(amount, source) {
    if (amount <= 0) return;
    state.buzz += amount;
    state.runBuzz += amount;
    state.lifetimeBuzz += amount;
    bus.emit(EVENTS.BUZZ_GAINED, { amount, source });
  }

  /* ------------------------------------------------------------ lifecycle */

  function load() {
    const result = loadGame(storage, now);
    if (!result) return { loaded: false };

    state = result.state;
    const offline = econ.offlineEarnings(state, result.elapsedSeconds);
    if (offline.buzz > 0) {
      grantBuzz(offline.buzz, 'offline');
      state.bloat = Math.min(1, state.bloat + econ.bloatGain(state, offline.seconds));
      offlineReport = offline;
    }
    bus.emit(EVENTS.LOADED, { offline: offlineReport });
    return { loaded: true, offline: offlineReport };
  }

  function save() {
    state.lastSeen = Date.now();
    if (saveGame(state, storage)) {
      lastSaveAt = state.lastSeen;
      bus.emit(EVENTS.SAVED, { at: lastSaveAt });
    }
  }

  /* ----------------------------------------------------------------- tick */

  function tick(dt) {
    grantBuzz(econ.buzzPerSecond(state) * dt, 'idle');
    state.bloat = Math.min(1, state.bloat + econ.bloatGain(state, dt));
    state.stats.playtimeSeconds += dt;

    if (Date.now() - lastSaveAt >= SAVE.autosaveMs) save();
    bus.emit(EVENTS.TICK, { state, dt });
  }

  /* -------------------------------------------------------------- actions */

  /** Manual click on the Nudge button (GDD 4). */
  function nudge() {
    const amount = econ.clickPower(state);
    state.stats.nudges += 1;
    grantBuzz(amount, 'nudge');
    return amount;
  }

  function openApp(id) {
    const check = econ.canOpenApp(state, id);
    if (!check.ok) {
      if (check.reason === 'out-of-memory') {
        bus.emit(EVENTS.OUT_OF_MEMORY, {
          id,
          needed: getApp(id).ram,
          free: econ.ramFree(state),
        });
      }
      return check;
    }
    state.apps[id].open = true;
    state.apps[id].minimized = false;
    bus.emit(EVENTS.APP_OPENED, { id });
    return { ok: true };
  }

  function closeApp(id) {
    if (!state.apps[id]?.open) return { ok: false, reason: 'not-open' };
    state.apps[id].open = false;
    state.apps[id].minimized = false;
    bus.emit(EVENTS.APP_CLOSED, { id });
    return { ok: true };
  }

  function installApp(id) {
    const app = getApp(id);
    const entry = state.apps[id];
    if (entry.installed) return { ok: false, reason: 'already-installed' };
    if (!econ.isAppUnlocked(state, id)) return { ok: false, reason: 'locked' };
    const cost = app.install?.cost ?? 0;
    if (state.buzz < cost) return { ok: false, reason: 'too-expensive' };

    state.buzz -= cost;
    entry.installed = true;
    bus.emit(EVENTS.APP_INSTALLED, { id });
    return { ok: true };
  }

  /** Buy chat bots — the Day 1 spending sink. */
  function buyBots(amount = 1) {
    const { count, cost } = econ.affordableBots(state, amount);
    if (count === 0) return { ok: false, reason: 'too-expensive' };
    state.buzz -= cost;
    state.chat.bots += count;
    bus.emit(EVENTS.BOT_BOUGHT, { count, cost });
    return { ok: true, count, cost };
  }

  function buyHardware(track) {
    if (!(track in HARDWARE)) return { ok: false, reason: 'unknown-track' };
    const next = nextTierOf(track, state.hardware[track]);
    if (!next) return { ok: false, reason: 'maxed' };
    if (state.dollars < next.cost) return { ok: false, reason: 'too-expensive' };

    state.dollars -= next.cost;
    state.hardware[track] += 1;
    bus.emit(EVENTS.HARDWARE_BOUGHT, { track, tier: next });
    save();
    return { ok: true, tier: next };
  }

  /** "Format C:" — wipe software, keep hardware, bank Dollars (GDD 5). */
  function formatC() {
    const dollars = econ.pendingPrestigeDollars(state);
    if (dollars <= 0) return { ok: false, reason: 'not-worth-it' };

    state = resetForPrestige(state, dollars, Date.now());
    bus.emit(EVENTS.PRESTIGE, { dollars });
    save();
    return { ok: true, dollars };
  }

  function hardReset() {
    state = createInitialState(Date.now());
    save();
    return { ok: true };
  }

  return {
    bus,
    events: EVENTS,
    econ,
    get state() {
      return state;
    },
    get offlineReport() {
      return offlineReport;
    },
    clearOfflineReport() {
      offlineReport = null;
    },
    load,
    save,
    tick,
    nudge,
    openApp,
    closeApp,
    installApp,
    buyBots,
    buyHardware,
    formatC,
    hardReset,
    notify(title, body, tone = 'info') {
      bus.emit(EVENTS.NOTIFY, { title, body, tone });
    },
  };
}
