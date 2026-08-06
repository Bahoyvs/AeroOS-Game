import { BLOAT, CHAT_BOT, CLICK, HEAT, LEMONWIRE, OFFLINE, PINBALL, PRESTIGE } from '../data/balance.js';
import { getApp } from '../data/apps.js';
import {
  HARDWARE,
  HARDWARE_BASE,
  HARDWARE_TRACKS,
  MIN_COOLDOWN,
  nextTierOf,
  sumBonus,
  tierOf,
} from '../data/hardware.js';
import { getPlaylist } from '../data/playlists.js';
import { buffMultiplier } from './buffs.js';
import { canBurn } from './aeroburn.js';
import { canSeed, connectionAt, seedWeight, storageUsedGB } from './lemonwire.js';
import { infectionPenalty } from './shield99.js';

/**
 * Every number the game shows is derived here. Functions are pure and take the
 * whole state so the UI never has to know how a value is composed — and so the
 * balance can be unit-tested without a DOM (tests/economy.test.js).
 */

/* ------------------------------------------------------------------ memory */

/**
 * Everything the player's hardware currently does for them (AO-19). Each stat
 * is the base value scaled by the flat percentages of every tier they own, so
 * "what does this upgrade give me" is always a single number.
 */
export function hardwareEffects(state) {
  const h = state.hardware;
  return {
    production: HARDWARE_BASE.production * (1 + sumBonus('cpu', h.cpu, 'production')),
    click: HARDWARE_BASE.click * (1 + sumBonus('cpu', h.cpu, 'click')),
    cooldown: Math.max(MIN_COOLDOWN, HARDWARE_BASE.cooldown - sumBonus('gpu', h.gpu, 'cooldown')),
    ramMB: Math.round(HARDWARE_BASE.ramMB * (1 + sumBonus('ram', h.ram, 'capacity'))),
    storageGB: Math.round(HARDWARE_BASE.storageGB * (1 + sumBonus('hdd', h.hdd, 'storage'))),
    offlineHours: HARDWARE_BASE.offlineHours * (1 + sumBonus('hdd', h.hdd, 'offline')),
  };
}

export function ramCapacity(state) {
  return hardwareEffects(state).ramMB;
}

/** Storage ceiling for LemonWire's seeds — one of the HDD track's other jobs. */
export function storageCapacityGB(state) {
  return hardwareEffects(state).storageGB;
}

export function storageFreeGB(state) {
  return Math.round((storageCapacityGB(state) - storageUsedGB(state)) * 1000) / 1000;
}

/** Can this disc be burned? Wrapper so the UI never imports the burner. */
export function canBurnDisc(state, typeId) {
  return canBurn(state, typeId);
}

/**
 * Seed slots. The base count lives in the save (so a future upgrade can raise
 * it); the HDD track adds the rest, which is the second job of that track and
 * the reason a bigger disk is worth Dollars beyond the raw capacity.
 */
export function seedSlots(state) {
  const fromHdd = Math.floor(state.hardware.hdd / LEMONWIRE.hddTiersPerSlot);
  return Math.min(LEMONWIRE.maxSeedSlots, state.lemonwire.maxSeedSlots + fromHdd);
}

export function seedSlotsFree(state) {
  return Math.max(0, seedSlots(state) - state.lemonwire.activeSeeds.length);
}

/** The connection multiplier — every slot at once (LEMONWIRE.connections). */
export function totalBandwidth(state) {
  return connectionAt(state.lemonwire.connection).multiplier;
}

/** Can this file take a seed slot? Wraps the capacity lookups for the UI. */
export function canSeedFile(state, fileId) {
  return canSeed(state, fileId, seedSlots(state), storageCapacityGB(state));
}

/** Cooldown scale for heavy apps like Aero Studio (Day 6). */
export function cooldownMultiplier(state) {
  return hardwareEffects(state).cooldown;
}

/** Extra memory the loaded playlist charges on top of RetroAmp itself. */
export function playlistRam(state) {
  return state.retroamp.playlist ? getPlaylist(state.retroamp.playlist).ram : 0;
}

/** An app's live footprint — RetroAmp's grows with a heavy playlist loaded. */
export function appRam(state, id) {
  return getApp(id).ram + (id === 'retroamp' ? playlistRam(state) : 0);
}

export function ramUsed(state) {
  let used = 0;
  for (const [id, app] of Object.entries(state.apps)) {
    if (app.open) used += appRam(state, id);
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
  if (appRam(state, id) > ramFree(state)) return { ok: false, reason: 'out-of-memory' };
  return { ok: true };
}

/* ------------------------------------------------------------- playlists */

/** Global multiplier from the loaded playlist (AO-14). 1 when nothing plays. */
export function retroampMultiplier(state, now = Date.now()) {
  const id = state.retroamp.playlist;
  if (!id) return 1;
  // The music only pays while the window is open — otherwise closing RetroAmp
  // would hand back its 64 MB and keep the multiplier for free. The burn-out
  // clock keeps running regardless, so closing it is not a way to bank a burst.
  if (!state.apps.retroamp?.open) return 1;
  const playlist = getPlaylist(id);
  // A burnt-out playlist stops paying immediately; the tick ejects it.
  if (playlist.durationSeconds && state.retroamp.endsAt <= now) return 1;
  return 1 + playlist.multiplier;
}

export function playlistSecondsLeft(state, now = Date.now()) {
  const id = state.retroamp.playlist;
  if (!id || !getPlaylist(id).durationSeconds) return null;
  return Math.max(0, (state.retroamp.endsAt - now) / 1000);
}

export function playlistCooldownLeft(state, id, now = Date.now()) {
  return Math.max(0, ((state.retroamp.cooldownUntil[id] ?? 0) - now) / 1000);
}

/**
 * Can this playlist be loaded right now? Swapping only charges the *difference*
 * in memory, since the outgoing playlist frees its own.
 */
export function canLoadPlaylist(state, id, now = Date.now()) {
  const playlist = getPlaylist(id);
  if (!state.apps.retroamp?.open) return { ok: false, reason: 'not-open' };
  if (state.retroamp.playlist === id) return { ok: false, reason: 'already-loaded' };

  const cooling = playlistCooldownLeft(state, id, now);
  if (cooling > 0) return { ok: false, reason: 'cooling-down', seconds: cooling };

  const extra = playlist.ram - playlistRam(state);
  if (extra > ramFree(state)) {
    return { ok: false, reason: 'out-of-memory', needed: extra, free: ramFree(state) };
  }
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

/**
 * Heat (AO-27): bloat with a face on it. The player cannot read a 0..1 bloat
 * float, but they understand a machine running at 91°C — and it escalates
 * with what they have chosen to keep open.
 */
export function systemHeat(state) {
  const open = Object.values(state.apps).filter((a) => a.open).length;
  const span = HEAT.maxC - HEAT.idleC;
  const raw = HEAT.idleC + span * Math.min(1, Math.max(0, state.bloat)) + open * HEAT.perOpenApp;
  return Math.min(HEAT.maxC, Math.round(raw));
}

export function heatLevel(state) {
  const heat = systemHeat(state);
  if (heat >= HEAT.criticalC) return 'critical';
  if (heat >= HEAT.warnC) return 'warn';
  return 'ok';
}

/** 0..1 "how close to melting", for bars and audio distortion. */
export function heatRatio(state) {
  return Math.min(1, Math.max(0, (systemHeat(state) - HEAT.idleC) / (HEAT.maxC - HEAT.idleC)));
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

/**
 * Buddy-count milestones (AO-9): every `milestoneEvery` buddies permanently
 * boosts AeroChat for the rest of the run, so buying in bulk has a visible goal.
 */
export function chatMilestoneCount(state) {
  return Math.floor(state.chat.bots / CHAT_BOT.milestoneEvery);
}

export function chatMilestoneMultiplier(state) {
  return 1 + chatMilestoneCount(state) * CHAT_BOT.milestoneBonus;
}

/** Buddies still needed for the next milestone, and what it is worth. */
export function nextChatMilestone(state) {
  const next = (chatMilestoneCount(state) + 1) * CHAT_BOT.milestoneEvery;
  if (next > CHAT_BOT.maxPerRun) return null;
  return {
    at: next,
    remaining: next - state.chat.bots,
    bonus: CHAT_BOT.milestoneBonus,
  };
}

/** AeroChat's own multiplier stack: milestones × chat-kind buffs. */
export function chatMultiplier(state, now = Date.now()) {
  return chatMilestoneMultiplier(state) * buffMultiplier(state, 'chat', now);
}

/** AeroChat's contribution on its own, before the window check. */
function chatRate(state, now = Date.now()) {
  return state.chat.bots * CHAT_BOT.baseRate * chatMultiplier(state, now);
}

/**
 * What one seed slot pays per second (AO-21, seeding refactor).
 *
 * Two terms, and both earn their place: the flat one is what makes the first
 * seed feel like something on a stock machine, and the proportional one is what
 * stops a slot being worthless at 300 buddies. The buddy rate is used as the
 * yardstick whether or not AeroChat is open — the swarm's appetite follows how
 * well connected the player is, not which window has focus.
 */
export function seedRate(state, fileId, now = Date.now()) {
  const anchor = LEMONWIRE.flatBuzzPerSecond + chatRate(state, now) * LEMONWIRE.shareOfChatRate;
  return anchor * seedWeight(fileId).total * totalBandwidth(state);
}

/** Everything the seed slots pay together. Zero while the window is closed. */
export function seedBuzzPerSecond(state, now = Date.now()) {
  if (!state.apps.lemonwire?.open) return 0;
  return state.lemonwire.activeSeeds.reduce(
    (sum, seed) => sum + seedRate(state, seed.fileId, now),
    0,
  );
}

/** Buzz/sec before global modifiers. Apps only produce while they are open. */
export function baseBuzzPerSecond(state, now = Date.now()) {
  let rate = 0;
  if (state.apps.aerochat?.open) rate += chatRate(state, now);
  rate += seedBuzzPerSecond(state, now);
  // RetroAmp is not a producer — it multiplies, via globalMultiplier.
  return rate;
}

/** Global multiplier from hardware, system health and global-kind buffs. */
export function globalMultiplier(state, now = Date.now()) {
  const renderPenalty = state.aerostudio?.isRendering ? 0.8 : 1.0;
  return (
    hardwareEffects(state).production *
    bloatPenalty(state) *
    infectionPenalty(state) *
    retroampMultiplier(state, now) *
    buffMultiplier(state, 'global', now) *
    renderPenalty
  );
}

export function buzzPerSecond(state, now = Date.now()) {
  return baseBuzzPerSecond(state, now) * globalMultiplier(state, now);
}

/**
 * Every factor behind the AeroChat rate, so the UI can show its working.
 * Without this the advertised milestone multiplier looks broken: bloat quietly
 * cancels it, and "28 buddies" reads as exactly 28 × baseRate.
 * The factors multiply to `total` — see tests/economy.test.js.
 */
export function rateBreakdown(state, now = Date.now()) {
  const base = state.chat.bots * CHAT_BOT.baseRate;
  const renderPenalty = state.aerostudio?.isRendering ? 0.8 : 1.0;
  // Seeding is a second producer, not a factor on the first, so it is reported
  // as its own line rather than folded into the chain — the factors below still
  // multiply to the AeroChat rate exactly (tests/economy.test.js).
  const seeds = seedBuzzPerSecond(state, now) * globalMultiplier(state, now);
  return {
    seeds,
    bots: state.chat.bots,
    perBot: CHAT_BOT.baseRate,
    base,
    milestone: chatMilestoneMultiplier(state),
    buffs: buffMultiplier(state, 'chat', now) * buffMultiplier(state, 'global', now),
    playlist: retroampMultiplier(state, now),
    virus: infectionPenalty(state),
    cpu: hardwareEffects(state).production,
    bloat: bloatPenalty(state),
    render: renderPenalty,
    open: state.apps.aerochat?.open === true,
    total: buzzPerSecond(state, now),
  };
}

/** Buzz granted by one press of the Nudge button. */
export function clickPower(state, now = Date.now()) {
  return (
    CLICK.baseBuzz *
    hardwareEffects(state).click *
    bloatPenalty(state) *
    buffMultiplier(state, 'click', now)
  );
}

/* ---------------------------------------------------------------- pinball */

/**
 * Buying a token, priced in seconds of current production so it costs the same
 * *time* early and late. The floor stops a machine producing nothing from
 * handing out free tokens.
 */
export function pinballTokenCost(state, now = Date.now()) {
  return Math.max(
    PINBALL.minTokenCost,
    Math.ceil(buzzPerSecond(state, now) * PINBALL.buyTokenSeconds),
  );
}

export function canBuyPinballToken(state, now = Date.now()) {
  if (state.pinball.tokens >= PINBALL.maxTokens) return { ok: false, reason: 'full' };
  if (state.buzz < pinballTokenCost(state, now)) return { ok: false, reason: 'too-expensive' };
  return { ok: true };
}

/**
 * The live combo, for the Nudge button and the pinball HUD. It is stored as an
 * ordinary click buff, so this is a lookup rather than a second timer — and the
 * multiplier it reports is already inside `clickPower()`.
 */
export function pinballCombo(state, now = Date.now()) {
  const buff = state.buffs.find((b) => b.id === PINBALL.comboBuffId && b.expiresAt > now);
  if (!buff) return { active: false, multiplier: 1, secondsLeft: 0 };
  return {
    active: true,
    multiplier: 1 + buff.magnitude,
    secondsLeft: (buff.expiresAt - now) / 1000,
  };
}

/* ----------------------------------------------------------------- offline */

export function offlineCapSeconds(state) {
  return hardwareEffects(state).offlineHours * 3600;
}

/**
 * Buzz earned while the tab was closed. Capped by the HDD tier and taxed by
 * OFFLINE.efficiency so being present always beats being away (GDD 5).
 */
export function offlineEarnings(state, elapsedSeconds, now = Date.now()) {
  if (elapsedSeconds < OFFLINE.minSeconds) {
    return { buzz: 0, seconds: 0, elapsedSeconds, capped: false, cappedHours: 0 };
  }
  const cap = offlineCapSeconds(state);
  const seconds = Math.min(elapsedSeconds, cap);
  return {
    buzz: buzzPerSecond(state, now) * seconds * OFFLINE.efficiency,
    seconds,
    // How long they were actually away, so the report can show both numbers
    // and explain the gap when the HDD cap ate the difference (AO-28).
    elapsedSeconds,
    capped: elapsedSeconds > cap,
    cappedHours: hardwareEffects(state).offlineHours,
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

/**
 * What the very first Format C: pays. The payout floor is a Buzz threshold, not
 * a Dollar amount, so the first payout is whatever that threshold is worth.
 */
export const FIRST_PAYOUT =
  Math.floor(PRESTIGE.scale * Math.sqrt(PRESTIGE.minLifetimeBuzz / PRESTIGE.divisor) * 100) / 100;

/** Inverse of the payout curve: lifetime Buzz needed to be worth `dollars`. */
export function buzzForDollars(dollars) {
  if (dollars <= 0) return 0;
  return Math.max(
    PRESTIGE.minLifetimeBuzz,
    (dollars / PRESTIGE.scale) ** 2 * PRESTIGE.divisor,
  );
}

/**
 * Progress toward the next whole Dollar (AO-16). The sqrt curve is invisible to
 * the player otherwise: they cannot tell whether a payout is seconds or hours
 * away, which makes Format C: feel arbitrary.
 */
export function dollarProgress(state) {
  const earned = lifetimeDollarValue(state);
  const pending = pendingPrestigeDollars(state);

  // The payout floor is already worth more than $1, so before the first one the
  // goal is that floor — promising "$1" would be a number they never receive.
  if (earned === 0) {
    const at = PRESTIGE.minLifetimeBuzz;
    return {
      earned: 0,
      pending,
      first: true,
      nextDollar: FIRST_PAYOUT,
      buzzNeeded: Math.max(0, at - state.lifetimeBuzz),
      ratio: Math.min(1, Math.max(0, state.lifetimeBuzz / at)),
    };
  }

  const nextDollar = Math.floor(earned) + 1;
  const at = buzzForDollars(nextDollar);
  const from = buzzForDollars(Math.floor(earned));
  const span = at - from;

  return {
    earned,
    pending,
    first: false,
    nextDollar,
    buzzNeeded: Math.max(0, at - state.lifetimeBuzz),
    ratio: span <= 0 ? 0 : Math.min(1, Math.max(0, (state.lifetimeBuzz - from) / span)),
  };
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

/**
 * Everything the shop needs for one row (AO-18): where the player is on the
 * track, what they have now, and what the next purchase adds — as the flat
 * percentages the tier tables are written in (AO-19).
 */
export function hardwareSummary(state) {
  const effects = hardwareEffects(state);

  return HARDWARE_TRACKS.map((track) => {
    const index = state.hardware[track];
    const next = nextTierOf(track, index);

    // What the machine would look like one tier up, so the row can show a delta
    // rather than asking the player to compare two multipliers.
    const upgraded = next
      ? hardwareEffects({ ...state, hardware: { ...state.hardware, [track]: index + 1 } })
      : null;

    return {
      track,
      label: HARDWARE[track].label,
      affects: HARDWARE[track].affects,
      blurb: HARDWARE[track].blurb,
      index,
      tierCount: HARDWARE[track].tiers.length,
      current: tierOf(track, index),
      next,
      cost: hardwareUpgradeCost(state, track),
      affordable: canBuyHardware(state, track),
      maxed: next === null,
      effects,
      upgraded,
      gains: next ? trackGains(track, next) : [],
    };
  });
}

/** The next tier's flat bonuses, as display-ready `+N%` / capacity strings. */
function trackGains(track, next) {
  const pct = (value) => `+${Math.round(value * 100)}%`;
  switch (track) {
    case 'cpu':
      return [`${pct(next.production)} production`, `${pct(next.click)} click power`];
    case 'ram':
      return [`${pct(next.capacity)} memory`];
    case 'gpu':
      return [`−${Math.round(next.cooldown * 100)}% cooldowns`];
    case 'hdd':
      return [`${pct(next.offline)} offline cap`, `${pct(next.storage)} storage`];
    default:
      return [];
  }
}

/* ------------------------------------------------------------------ unlock */

/** An app becomes buyable once the run has produced enough Buzz. */
export function isAppUnlocked(state, id) {
  const app = getApp(id);
  if (app.system) return true;
  return state.runBuzz >= (app.install?.unlockAt ?? 0);
}
