import { BLOAT, CHAT_BOT, CLICK, HEAT, LEMONWIRE, OFFLINE, PRESTIGE, SWEEPER } from '../data/balance.js';
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
import { defragPenalty, defragProgress, isDefragging, offlineBloat } from './defrag.js';
import { canSeed, connectionAt, seedWeight, storageUsedGB } from './lemonwire.js';
import { infectionPenalty } from './shield99.js';
import {
  affordableUnits,
  buildingProduction,
  chatMilestoneCount,
  chatMilestoneMultiplier,
  isBuildingUnlocked,
  lockReason,
  productionBreakdown,
  totalBuildingProduction,
  unitCost,
  unitCostBulk,
  unitsOf,
} from './buildings.js';
import { legacyMultiplier } from './legacy.js';
import { rogueDrain } from './breach.js';

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

/** Bloat accrued in `seconds` of uptime, given what is currently running. */
export function bloatGain(state, seconds) {
  const openApps = Object.values(state.apps).filter((a) => a.open).length;
  const perMinute =
    openApps * BLOAT.perOpenAppPerMinute + state.chat.bots * BLOAT.perBotPerMinute;
  return (perMinute * seconds) / 60;
}

/**
 * Auto-Defrag, re-exported so the UI never imports the mechanic directly — the
 * same wrapping `canBurnDisc` does for the burner.
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

/* --------------------------------------------------------------- chat bots */

/**
 * Buddies are AeroChat's units (v2 decision #3), so the price curve is the
 * shared one now — `unitCost('aerochat', n)`. These three keep their old names
 * and signatures because AeroChat's window, the tutorial and the goal chain all
 * call them, and the curve they return is numerically identical: CHAT_BOT's
 * baseCost and growth are exactly what the roster carries.
 */
export { unitCost, unitCostBulk, affordableUnits, unitsOf, isBuildingUnlocked, lockReason };

export function botCost(owned) {
  return unitCost('aerochat', owned);
}

export function botCostBulk(owned, amount) {
  return unitCostBulk('aerochat', owned, amount);
}

export function affordableBots(state, max = 100) {
  return affordableUnits(state, 'aerochat', max);
}

/* -------------------------------------------------------------- production */

/**
 * Buddy-count milestones (AO-9): every `milestoneEvery` buddies permanently
 * boosts AeroChat for the rest of the run, so buying in bulk has a visible goal.
 * The maths moved to `core/buildings.js` with the rest of AeroChat's *local*
 * multiplier when v2 landed; these are re-exported so nothing that reads them
 * had to change.
 */
export { chatMilestoneCount, chatMilestoneMultiplier };

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

/**
 * AeroChat's contribution, upgrades and all.
 *
 * It is no longer gated on the window being open (patch §1.1) — a building is a
 * thing you own, not a thing you babysit. What an open window buys you now is
 * *active participation*: status bonuses, playlists, seed slots, scans. Those
 * still pay only while you are there, and they pay through the buff system.
 */
function chatRate(state, now = Date.now()) {
  return buildingProduction(state, 'aerochat', now);
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

/**
 * Everything the seed slots pay together.
 *
 * Also no longer gated on the window (patch §1.1). Filling a slot *is* the
 * active decision; having made it, the swarm does not stop uploading because
 * you alt-tabbed.
 */
export function seedBuzzPerSecond(state, now = Date.now()) {
  return state.lemonwire.activeSeeds.reduce(
    (sum, seed) => sum + seedRate(state, seed.fileId, now),
    0,
  );
}

/**
 * Buzz/sec before global modifiers: every building's output, plus the seed
 * slots, which are LemonWire's own active layer rather than a thirteenth
 * building. RetroAmp's playlists are not here either — they multiply, via
 * `globalMultiplier`.
 */
export function baseBuzzPerSecond(state, now = Date.now()) {
  return totalBuildingProduction(state, now) + seedBuzzPerSecond(state, now);
}

/**
 * Global multiplier from hardware, system health, the Legacy layer and
 * global-kind buffs.
 *
 * Two things and only two things may enter this chain from the redesign: the
 * hardware layer and Legacy (v2 §4.5). Every building upgrade multiplies its own
 * building and nothing else, which is what keeps twelve buildings' worth of
 * upgrades from compounding into an unreadable number.
 */
export function globalMultiplier(state, now = Date.now()) {
  const renderPenalty = state.aerostudio?.isRendering ? 0.8 : 1.0;
  return (
    hardwareEffects(state).production *
    bloatPenalty(state) *
    infectionPenalty(state) *
    retroampMultiplier(state, now) *
    buffMultiplier(state, 'global', now) *
    // The permanent bonus (v2 §5.1). Automatic — there is no per-run
    // activation step to forget (patch §3).
    legacyMultiplier(state) *
    // What the rogue processes are skimming right now (GDD §C.3, phase 2).
    // Zero unless a breach is actually live.
    (1 - rogueDrain(state)) *
    // A defrag pass is disk-bound and the machine knows it. Small, and only
    // while it runs — the bloat it is clearing costs far more.
    defragPenalty(state) *
    renderPenalty
  );
}

/**
 * The itemised production of one building (patch §4.1).
 *
 * This is the accessor the UI tooltips read. It exists so that no multiplier can
 * act invisibly: a synergy the player cannot see is, for them, not there. The UI
 * prints these parts and never recomputes them.
 */
export function getProductionBreakdown(state, buildingId, now = Date.now()) {
  return productionBreakdown(state, buildingId, {
    globalMultiplier: globalMultiplier(state, now),
    now,
  });
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
  const global = globalMultiplier(state, now);
  // Seeding is a second producer, not a factor on the first, so it is reported
  // as its own line rather than folded into the chain — the factors below still
  // multiply to the AeroChat rate exactly (tests/economy.test.js).
  const seeds = seedBuzzPerSecond(state, now) * global;
  // ...and so is every building other than AeroChat, for the same reason. The
  // chain below describes AeroChat; this is everyone else.
  const otherBuildings =
    (totalBuildingProduction(state, now) - buildingProduction(state, 'aerochat', now)) * global;

  return {
    seeds,
    otherBuildings,
    bots: state.chat.bots,
    perBot: CHAT_BOT.baseRate,
    base,
    milestone: chatMilestoneMultiplier(state),
    buffs: buffMultiplier(state, 'chat', now) * buffMultiplier(state, 'global', now),
    playlist: retroampMultiplier(state, now),
    virus: infectionPenalty(state),
    cpu: hardwareEffects(state).production,
    bloat: bloatPenalty(state),
    defrag: defragPenalty(state),
    render: renderPenalty,
    legacy: legacyMultiplier(state),
    /** What a live breach is skimming, as a multiplier. 1 when there is none. */
    breach: 1 - rogueDrain(state),
    open: state.apps.aerochat?.open === true,
    total: buzzPerSecond(state, now),
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
