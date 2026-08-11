import { BLOAT, CLICK, HEAT, LEMONWIRE, OFFLINE, PRESTIGE, SWEEPER } from '../data/balance.js';
import { getApp } from '../data/apps.js';
import { getBuilding } from '../data/buildings.js';
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
import {
  affordableUnits,
  buildingProduction,
  crossedMilestone,
  isBuildingUnlocked,
  milestoneIndex,
  milestoneMultiplier,
  nextMilestone,
  nextUnlock,
  totalBuildingProduction,
  totalUnits,
  unitCost,
  unitCostBulk,
  unitsOf,
  unlockedBuildings,
} from './buildings.js';
import { legacyLevel, legacyMultiplier, legacyProgress } from './legacy.js';
import { defragPenalty, defragProgress, isDefragging, offlineBloat } from './defrag.js';
import { connectionAt, storageUsedGB, swarm, swarmRisk } from './lemonwire.js';

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
    payout: HARDWARE_BASE.payout * (1 + sumBonus('mobo', h.mobo, 'payout')),
  };
}

export function ramCapacity(state) {
  return hardwareEffects(state).ramMB;
}

/** Storage ceiling for LemonWire's swarm — one of the HDD track's other jobs. */
export function storageCapacityGB(state) {
  return hardwareEffects(state).storageGB;
}

/**
 * The LemonWire swarm, wrapped so the window never imports the mechanic — the
 * same front door everything else in this module goes through. Every one of
 * these is derived from the unit count, so none of them is a second economy.
 */
export function lemonwireSwarm(state, limit) {
  return swarm(unitsOf(state, 'lemonwire'), limit);
}

export function lemonwireDiskUsedGB(state) {
  return storageUsedGB(unitsOf(state, 'lemonwire'));
}

export function lemonwireRisk(state) {
  return swarmRisk(unitsOf(state, 'lemonwire'));
}

/**
 * The connection tier, driven by LemonWire's milestone tier rather than by a
 * purchase (GDD §4: the five green bars are progression, not a shop row).
 */
export function lemonwireConnection(state) {
  return connectionAt(milestoneIndex(unitsOf(state, 'lemonwire')));
}


/** Cooldown scale for anything the GPU track is meant to speed up. */
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

/**
 * The playlist actually driving the multiplier right now — id or null.
 * Shared by `retroampMultiplier()` and the ambient audio layer (Faz 1.4,
 * `src/ui/audio.js`), so "is this playlist live" has exactly one definition.
 */
export function activePlaylist(state, now = Date.now()) {
  const id = state.retroamp.playlist;
  if (!id) return null;
  // The music only pays while the window is open — otherwise closing RetroAmp
  // would hand back its 64 MB and keep the multiplier for free. The burn-out
  // clock keeps running regardless, so closing it is not a way to bank a burst.
  if (!state.apps.retroamp?.open) return null;
  const playlist = getPlaylist(id);
  // A burnt-out playlist stops paying immediately; the tick ejects it.
  if (playlist.durationSeconds && state.retroamp.endsAt <= now) return null;
  return id;
}

/** Global multiplier from the loaded playlist (AO-14). 1 when nothing plays. */
export function retroampMultiplier(state, now = Date.now()) {
  const id = activePlaylist(state, now);
  return id ? 1 + getPlaylist(id).multiplier : 1;
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

/**
 * Bloat accrued in `seconds` of uptime, given what is currently running.
 *
 * The per-unit term counts every building's units, not just AeroChat's — a
 * machine running nine programs' worth of them is not a clean machine, and
 * leaving the term on buddies alone would have made the phase-1 buildings the
 * only ones with a downside.
 */
export function bloatGain(state, seconds) {
  const openApps = Object.values(state.apps).filter((a) => a.open).length;
  const perMinute =
    openApps * BLOAT.perOpenAppPerMinute + totalUnits(state) * BLOAT.perBotPerMinute;
  return (perMinute * seconds) / 60;
}

/**
 * Auto-Defrag, re-exported so the UI never imports the mechanic directly — the
 * same front door everything else in this module provides.
 */
export { defragPenalty, defragProgress, isDefragging, offlineBloat };

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

/* --------------------------------------------------------------- buildings */

/**
 * The building layer (GDD v2 §2), re-exported so the UI has one import for
 * every derived number — the same front door `defragPenalty` and the LemonWire
 * wrappers go through. The mechanic itself is in core/buildings.js.
 */
export {
  affordableUnits,
  buildingProduction,
  crossedMilestone,
  isBuildingUnlocked,
  legacyLevel,
  legacyMultiplier,
  legacyProgress,
  milestoneIndex,
  milestoneMultiplier,
  nextMilestone,
  nextUnlock,
  totalBuildingProduction,
  totalUnits,
  unitCost,
  unitCostBulk,
  unitsOf,
  unlockedBuildings,
};

/* -------------------------------------------------------------- production */

/**
 * AeroChat's buddies, which are building #1's units and nothing special. Kept
 * as a named accessor because a great deal of the game still talks about
 * buddies by name — the tutorial, the goal chain, the status events — and
 * `unitsOf(state, 'aerochat')` at all of those call sites reads like a
 * refactor that lost the plot.
 */
export function buddyCount(state) {
  return unitsOf(state, 'aerochat');
}

/**
 * AeroChat's own multiplier stack: its milestone tier × chat-kind buffs.
 *
 * The chat-kind buff is AeroChat's alone and always has been — status-message
 * bonuses come from the buddy list, so they pay the buddy list. Every other
 * building multiplies through `globalMultiplier`.
 */
export function chatMultiplier(state, now = Date.now()) {
  return milestoneMultiplier(buddyCount(state)) * buffMultiplier(state, 'chat', now);
}

/** AeroChat's contribution on its own, before any global modifier. */
function chatRate(state, now = Date.now()) {
  return buildingProduction(state, 'aerochat') * buffMultiplier(state, 'chat', now);
}


/**
 * Buzz/sec before global modifiers: the twelve buildings, and nothing else.
 *
 * Production is *not* gated on a window being open (GDD §5). It used to be, for
 * AeroChat — and with twelve buildings that rule would mean the RAM budget
 * silently decides how much of the game is switched on, which is a memory
 * management puzzle nobody asked for. RAM still bounds how much of the desktop
 * can be on screen at once; it no longer bounds income.
 *
 * There is exactly one producer term now. LemonWire's seed slots used to be a
 * second one living inside a building that also has units — Phase 2 folded them
 * in, so the swarm is what LemonWire's units *look like* rather than a parallel
 * income the player has to tend.
 */
export function baseBuzzPerSecond(state, now = Date.now()) {
  // The chat-kind buff belongs to AeroChat's units alone, so it is applied here
  // rather than folded into the eleven siblings' total.
  const buildings =
    totalBuildingProduction(state) +
    buildingProduction(state, 'aerochat') * (buffMultiplier(state, 'chat', now) - 1);
  // RetroAmp's units produce like any other building; its *playlists* are a
  // separate axis and multiply, via globalMultiplier.
  return buildings;
}

/** Global multiplier from hardware, system health, legacy and global-kind buffs. */
export function globalMultiplier(state, now = Date.now()) {
  return (
    hardwareEffects(state).production *
    bloatPenalty(state) *
    retroampMultiplier(state, now) *
    buffMultiplier(state, 'global', now) *
    // Everything the player has ever earned, in one number (GDD §2.6). It is
    // the only factor in this chain that a Format C: cannot take away.
    legacyMultiplier(state) *
    // A defrag pass is disk-bound and the machine knows it. Small, and only
    // while it runs — the bloat it is clearing costs far more.
    defragPenalty(state)
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
  const bots = buddyCount(state);
  const base = bots * getBuilding('aerochat').baseProduction;
  // Seeding and the other eleven buildings are separate producers, not factors
  // on the first, so they are reported as their own lines rather than folded
  // into the chain — the factors below still multiply to the AeroChat rate
  // exactly (tests/economy.test.js).
  const global = globalMultiplier(state, now);
  const others = (totalBuildingProduction(state) - buildingProduction(state, 'aerochat')) * global;
  return {
    others,
    bots,
    perBot: getBuilding('aerochat').baseProduction,
    base,
    milestone: milestoneMultiplier(bots),
    buffs: buffMultiplier(state, 'chat', now) * buffMultiplier(state, 'global', now),
    playlist: retroampMultiplier(state, now),
    cpu: hardwareEffects(state).production,
    legacy: legacyMultiplier(state),
    bloat: bloatPenalty(state),
    defrag: defragPenalty(state),
    open: state.apps.aerochat?.open === true,
    total: buzzPerSecond(state, now),
  };
}

/**
 * Everything behind one building's contribution (GDD §2.8) — the single
 * accessor every building window reads.
 *
 * The rule this exists to enforce: a window may translate these numbers into
 * whatever fiction it likes (five green connection bars, an unread counter, a
 * spectrum analyser), but it may never *compute* one. If a window needs a
 * factor that is not on this object, the factor belongs here first.
 *
 * `base × milestoneMultiplier × globalMultiplier === total`, exactly. The
 * `legacyMultiplier` and `hardwareMultiplier` fields are the two slices of
 * `globalMultiplier` the player is most likely to ask about; they are reported
 * for display and are already inside it, so multiplying them in again would
 * double-count.
 */
export function getProductionBreakdown(state, buildingId, now = Date.now()) {
  const units = unitsOf(state, buildingId);
  const building = getBuilding(buildingId);
  const milestone = milestoneMultiplier(units);
  const global = globalMultiplier(state, now);
  const own = buildingProduction(state, buildingId);
  const total = own * global;
  return {
    id: buildingId,
    units,
    base: units * building.baseProduction,
    perUnit: building.baseProduction,
    milestoneMultiplier: milestone,
    legacyMultiplier: legacyMultiplier(state),
    hardwareMultiplier: hardwareEffects(state).production,
    globalMultiplier: global,
    /** Before global modifiers — what the building itself makes. */
    own,
    total,
    /** 0..1 of the machine's whole output — how much of the game this window is. */
    share: buzzPerSecond(state, now) > 0 ? total / buzzPerSecond(state, now) : 0,
    nextCost: unitCost(buildingId, units),
    milestone: nextMilestone(units),
  };
}

/**
 * The live Nudge streak. Read-only: `game.nudge()` is what advances it, and a
 * streak whose window has lapsed reports zero without anything having to clear
 * it — which is what lets it expire while the tab is closed.
 */
export function clickStreak(state, now = Date.now()) {
  const { windowSeconds, perClick, maxBonus } = CLICK.streak;
  const streak = state.click ?? { count: 0, lastAt: 0 };
  const alive = streak.count > 0 && now - streak.lastAt <= windowSeconds * 1000;
  const count = alive ? streak.count : 0;
  // The bonus starts on the second click, so one considered press pays exactly
  // what the button advertises.
  const bonus = Math.min(Math.max(count - 1, 0) * perClick, maxBonus);
  return {
    count,
    active: bonus > 0,
    multiplier: 1 + bonus,
    /** How far along the cap the streak is — the meter on the button. */
    ratio: maxBonus === 0 ? 0 : bonus / maxBonus,
    /** How long is left to land the next click before it drops. */
    secondsLeft: alive ? Math.max(0, windowSeconds - (now - streak.lastAt) / 1000) : 0,
  };
}

/** Buzz granted by one press of the Nudge button. */
export function clickPower(state, now = Date.now()) {
  return (
    CLICK.baseBuzz *
    hardwareEffects(state).click *
    bloatPenalty(state) *
    buffMultiplier(state, 'click', now) *
    clickStreak(state, now).multiplier
  );
}

/* ------------------------------------------------------------ AeroSweeper */

/**
 * Buying a token, priced in seconds of current production so it costs the same
 * *time* early and late. The floor stops a machine producing nothing from
 * handing out free tokens.
 */
export function sweeperTokenCost(state, now = Date.now()) {
  return Math.max(
    SWEEPER.minTokenCost,
    Math.ceil(buzzPerSecond(state, now) * SWEEPER.buyTokenSeconds),
  );
}

export function canBuySweeperToken(state, now = Date.now()) {
  if (state.sweeper.tokens >= SWEEPER.maxTokens) return { ok: false, reason: 'full' };
  if (state.buzz < sweeperTokenCost(state, now)) return { ok: false, reason: 'too-expensive' };
  return { ok: true };
}

/**
 * The live combo, for the Nudge button and the AeroSweeper HUD. It is stored as
 * an ordinary click buff, so this is a lookup rather than a second timer — and
 * the multiplier it reports is already inside `clickPower()`.
 */
export function sweeperCombo(state, now = Date.now()) {
  const buff = state.buffs.find((b) => b.id === SWEEPER.comboBuffId && b.expiresAt > now);
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
 * The divisor under the sqrt, for this machine.
 *
 * `PRESTIGE.divisor` is the stock board; the Mainboard track divides it down.
 * The track is written in *payout* percentages because that is the number a
 * shop row can honestly advertise, and Dollars go as the square root of Buzz —
 * so a +20% payout is a divisor of 1/1.2², not of 1/1.2.
 */
export function prestigeDivisor(state) {
  return PRESTIGE.divisor / hardwareEffects(state).payout ** 2;
}

/**
 * Total Dollars the player's lifetime Buzz has ever been worth. Payout is the
 * difference between this and everything already paid out, so a player who
 * prestiges often is never behind one who hoards a single long run.
 *
 * Note that this re-prices the whole history, not just Buzz earned since the
 * last upgrade: buying a Mainboard tier makes the pending payout jump on the
 * spot. That is the intended shape of the purchase — see data/hardware.js.
 */
export function lifetimeDollarValue(state) {
  if (state.lifetimeBuzz < PRESTIGE.minLifetimeBuzz) return 0;
  return (
    Math.floor(PRESTIGE.scale * Math.sqrt(state.lifetimeBuzz / prestigeDivisor(state)) * 100) / 100
  );
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
 * What the very first Format C: pays on a stock board. The payout floor is a
 * Buzz threshold, not a Dollar amount, so the first payout is whatever that
 * threshold is worth — and nobody owns a Mainboard tier before their first
 * wipe, which is why this can stay a constant.
 */
export const FIRST_PAYOUT =
  Math.floor(PRESTIGE.scale * Math.sqrt(PRESTIGE.minLifetimeBuzz / PRESTIGE.divisor) * 100) / 100;

/** The same figure for a machine that has since been upgraded. */
export function firstPayout(state) {
  return (
    Math.floor(PRESTIGE.scale * Math.sqrt(PRESTIGE.minLifetimeBuzz / prestigeDivisor(state)) * 100) /
    100
  );
}

/**
 * Inverse of the payout curve: lifetime Buzz needed to be worth `dollars`.
 * Takes the divisor rather than the state so it stays a plain piece of maths;
 * callers that have a machine pass `prestigeDivisor(state)`.
 */
export function buzzForDollars(dollars, divisor = PRESTIGE.divisor) {
  if (dollars <= 0) return 0;
  return Math.max(PRESTIGE.minLifetimeBuzz, (dollars / PRESTIGE.scale) ** 2 * divisor);
}

/**
 * Progress toward the next whole Dollar (AO-16). The sqrt curve is invisible to
 * the player otherwise: they cannot tell whether a payout is seconds or hours
 * away, which makes Format C: feel arbitrary.
 */
export function dollarProgress(state) {
  const earned = lifetimeDollarValue(state);
  const pending = pendingPrestigeDollars(state);
  const divisor = prestigeDivisor(state);

  // The payout floor is already worth more than $1, so before the first one the
  // goal is that floor — promising "$1" would be a number they never receive.
  if (earned === 0) {
    const at = PRESTIGE.minLifetimeBuzz;
    return {
      earned: 0,
      pending,
      first: true,
      nextDollar: firstPayout(state),
      buzzNeeded: Math.max(0, at - state.lifetimeBuzz),
      ratio: Math.min(1, Math.max(0, state.lifetimeBuzz / at)),
    };
  }

  const nextDollar = Math.floor(earned) + 1;
  const at = buzzForDollars(nextDollar, divisor);
  const from = buzzForDollars(Math.floor(earned), divisor);
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
    case 'mobo':
      return [`${pct(next.payout)} Format C: payout`];
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
