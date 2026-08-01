import { BLOAT, CHAT_BOT, CLICK, OFFLINE, PRESTIGE } from '../data/balance.js';
import { getApp } from '../data/apps.js';
import { HARDWARE_TRACKS, nextTierOf, tierOf } from '../data/hardware.js';

/**
 * Every number the game shows is derived here. Functions are pure and take the
 * whole state so the UI never has to know how a value is composed — and so the
 * balance can be unit-tested without a DOM (tests/economy.test.js).
 */

/* ------------------------------------------------------------------ memory */

export function ramCapacity(state) {
  return tierOf('ram', state.hardware.ram).capacity;
}

export function ramUsed(state) {
  let used = 0;
  for (const [id, app] of Object.entries(state.apps)) {
    if (app.open) used += getApp(id).ram;
  }
  return used;
}

export function ramFree(state) {
  return ramCapacity(state) - ramUsed(state);
}

/** Can this app be opened without blowing the memory budget? */
export function canOpenApp(state, id) {
  const app = getApp(id);
  const entry = state.apps[id];
  if (!entry?.installed) return { ok: false, reason: 'not-installed' };
  if (entry.open) return { ok: false, reason: 'already-open' };
  if (app.ram > ramFree(state)) return { ok: false, reason: 'out-of-memory' };
  return { ok: true };
}

/* ------------------------------------------------------------------- bloat */

/** Bloat accrued in `seconds` of uptime, given what is currently running. */
export function bloatGain(state, seconds) {
  const openApps = Object.values(state.apps).filter((a) => a.open).length;
  const perMinute =
    openApps * BLOAT.perOpenAppPerMinute + state.chat.bots * BLOAT.perBotPerMinute;
  return (perMinute * seconds) / 60;
}

/** Multiplier applied to all production: 1.0 clean -> 0.5 fully bloated. */
export function bloatPenalty(state) {
  const bloat = Math.min(Math.max(state.bloat, 0), 1);
  return 1 - bloat * (1 - BLOAT.productionPenaltyAtFull);
}

export function bloatLevel(state) {
  if (state.bloat >= BLOAT.criticalAt) return 'critical';
  if (state.bloat >= BLOAT.warnAt) return 'warn';
  return 'ok';
}

/* --------------------------------------------------------------- chat bots */

/** Geometric price curve for the nth bot (0-indexed count already owned). */
export function botCost(owned) {
  return Math.ceil(CHAT_BOT.baseCost * CHAT_BOT.costGrowth ** owned);
}

/** Total cost of buying `amount` more bots from the current count. */
export function botCostBulk(owned, amount) {
  let total = 0;
  for (let i = 0; i < amount; i += 1) total += botCost(owned + i);
  return total;
}

/** How many bots the player can afford right now, capped by the run limit. */
export function affordableBots(state, max = 100) {
  let count = 0;
  let spent = 0;
  while (count < max && state.chat.bots + count < CHAT_BOT.maxPerRun) {
    const next = spent + botCost(state.chat.bots + count);
    if (next > state.buzz) break;
    spent = next;
    count += 1;
  }
  return { count, cost: spent };
}

/* -------------------------------------------------------------- production */

/** Buzz/sec before global modifiers. Apps only produce while they are open. */
export function baseBuzzPerSecond(state) {
  let rate = 0;
  if (state.apps.aerochat?.open) rate += state.chat.bots * CHAT_BOT.baseRate;
  // Day 2+: RetroAmp multipliers and other producers hook in here.
  return rate;
}

/** Global multiplier from hardware and system health. */
export function globalMultiplier(state) {
  return tierOf('cpu', state.hardware.cpu).tickRate * bloatPenalty(state);
}

export function buzzPerSecond(state) {
  return baseBuzzPerSecond(state) * globalMultiplier(state);
}

/** Buzz granted by one press of the Nudge button. */
export function clickPower(state) {
  return CLICK.baseBuzz * tierOf('cpu', state.hardware.cpu).clickPower * bloatPenalty(state);
}

/* ----------------------------------------------------------------- offline */

export function offlineCapSeconds(state) {
  return tierOf('hdd', state.hardware.hdd).offlineHours * 3600;
}

/**
 * Buzz earned while the tab was closed. Capped by the HDD tier and taxed by
 * OFFLINE.efficiency so being present always beats being away (GDD 5).
 */
export function offlineEarnings(state, elapsedSeconds) {
  if (elapsedSeconds < OFFLINE.minSeconds) return { buzz: 0, seconds: 0, capped: false };
  const cap = offlineCapSeconds(state);
  const seconds = Math.min(elapsedSeconds, cap);
  return {
    buzz: buzzPerSecond(state) * seconds * OFFLINE.efficiency,
    seconds,
    capped: elapsedSeconds > cap,
  };
}

/* ---------------------------------------------------------------- prestige */

/**
 * Total Dollars the player's lifetime Buzz has ever been worth. Payout is the
 * difference between this and everything already paid out, so a player who
 * prestiges often is never behind one who hoards a single long run.
 */
export function lifetimeDollarValue(state) {
  if (state.lifetimeBuzz < PRESTIGE.minLifetimeBuzz) return 0;
  return Math.floor(PRESTIGE.scale * Math.sqrt(state.lifetimeBuzz / PRESTIGE.divisor) * 100) / 100;
}

/** Dollars the player would actually receive from a Format C: right now. */
export function pendingPrestigeDollars(state) {
  const owed = lifetimeDollarValue(state) - state.dollarsEarnedTotal;
  return Math.max(0, Math.floor(owed * 100) / 100);
}

export function canPrestige(state) {
  return pendingPrestigeDollars(state) > 0;
}

/* ---------------------------------------------------------------- hardware */

export function hardwareUpgradeCost(state, track) {
  const next = nextTierOf(track, state.hardware[track]);
  return next ? next.cost : null;
}

export function canBuyHardware(state, track) {
  const cost = hardwareUpgradeCost(state, track);
  return cost !== null && state.dollars >= cost;
}

export function hardwareSummary(state) {
  return HARDWARE_TRACKS.map((track) => ({
    track,
    current: tierOf(track, state.hardware[track]),
    next: nextTierOf(track, state.hardware[track]),
    cost: hardwareUpgradeCost(state, track),
    affordable: canBuyHardware(state, track),
  }));
}

/* ------------------------------------------------------------------ unlock */

/** An app becomes buyable once the run has produced enough Buzz. */
export function isAppUnlocked(state, id) {
  const app = getApp(id);
  if (app.system) return true;
  return state.runBuzz >= (app.install?.unlockAt ?? 0);
}
