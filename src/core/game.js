import { ADS, BREACH, CHAT_BOT, CLICK, DEFRAG, SAVE, AEROSTUDIO, SHIELD99, SWEEPER } from '../data/balance.js';
import { formatNumber } from './format.js';
import { getApp } from '../data/apps.js';
import { getCD } from '../data/cds.js';
import { getFile } from '../data/files.js';
import { getPlaylist } from '../data/playlists.js';
import { HARDWARE, nextTierOf } from '../data/hardware.js';
import * as econ from './economy.js';
import * as ads from './ads.js';
import * as burner from './aeroburn.js';
import * as aerostudio from './aerostudio.js';
import { addBuff, pruneBuffs } from './buffs.js';
import * as cosmetics from './cosmetics.js';
import * as defrag from './defrag.js';
import * as lw from './lemonwire.js';
import * as shield from './shield99.js';
import * as sweeper from './sweeper.js';
import * as buildings from './buildings.js';
import * as upgrades from './upgrades.js';
import * as legacy from './legacy.js';
import * as breach from './breach.js';
import * as minigames from './minigames.js';
import * as achievements from './achievements.js';
import { BUILDINGS as BUILDING_LIST, getBuilding } from '../data/buildings.js';
import { claimStatusEvent, updateStatusEvents } from './statusEvents.js';
import { EVENTS, createEventBus } from './events.js';
import { defaultStorage, loadGame, saveGame } from './save.js';
import { createInitialState, resetForPrestige } from './state.js';
import {
  advanceTutorial,
  currentStep,
  resumeTutorial,
  revealHardware,
  shouldRevealHardware,
  skipTutorial,
} from './tutorial.js';

/**
 * The game object owns the only mutable state in the app. UI modules read it
 * through `game.state` and change it only by calling the actions below, which
 * emit events describing what happened. Nothing here touches the DOM.
 */
export function createGame({ storage = defaultStorage(), now = Date.now(), rng = Math.random } = {}) {
  const bus = createEventBus();
  let state = createInitialState(now);
  let lastSaveAt = now;

  /**
   * Legacy level-up announcements are batched (see the tick). Wall clock, like
   * every other "how often may this bother the player" timer.
   */
  const LEGACY_ANNOUNCE_MS = 8000;
  let pendingLegacyFrom = null;
  let lastLegacyAnnounceAt = now;
  let offlineReport = null;

  function grantBuzz(amount, source) {
    if (amount <= 0) return;
    state.buzz += amount;
    state.runBuzz += amount;
    state.lifetimeBuzz += amount;
    // The Legacy accumulator (v2 §5.1). Every path that pays Buzz goes through
    // here, which is exactly why it is the right place to feed it — a permanent
    // multiplier that misses a payout source would drift forever.
    state.allTimeBuzz = (state.allTimeBuzz ?? 0) + amount;
    bus.emit(EVENTS.BUZZ_GAINED, { amount, source });
  }

  /* ------------------------------------------------------------ lifecycle */

  function load() {
    const result = loadGame(storage, now);
    if (!result) return { loaded: false };

    state = result.state;
    // A closed tab retires timed bonuses: buffs that ran out while away are
    // dropped, and a status event nobody could click is not held against them.
    pruneBuffs(state, now);
    state.chat.event = null;
    state.chat.nextEventIn = 0;
    resumeTutorial(state);

    /**
     * The habit badges (GDD §D.2) are measured here, before anything else has a
     * chance to move the clock: how long the player was away, and whether this
     * is a new day on their login streak.
     */
    achievements.noteSession(state, result.elapsedSeconds, now);

    const offline = econ.offlineEarnings(state, result.elapsedSeconds, now);
    if (offline.buzz > 0) {
      grantBuzz(offline.buzz, 'offline');
      /**
       * The offline half of Auto-Defrag (core/defrag.js). There is no pass to
       * watch and no production to tax while the tab is shut, so ownership caps
       * what the absence may accrue instead of clearing it — which is the
       * difference between coming back to a machine you can play and coming
       * back to one whose only move is a Format C: you had not planned.
       */
      state.bloat = econ.offlineBloat(state, state.bloat, econ.bloatGain(state, offline.seconds));
      offlineReport = { ...offline, bloatCapped: defrag.defragOwned(state) };
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
    const now = Date.now();

    grantBuzz(econ.buzzPerSecond(state, now) * dt, 'idle');
    state.bloat = Math.min(1, state.bloat + econ.bloatGain(state, dt));
    state.stats.playtimeSeconds += dt;

    // Auto-Defrag runs on simulation time, after the tick's bloat has landed:
    // it is a job on a machine somebody is watching, not a wall-clock timer.
    const pass = defrag.updateDefrag(state, dt);
    if (pass?.started) bus.emit(EVENTS.DEFRAG_STARTED, { from: pass.from });
    if (pass?.finished) {
      bus.emit(EVENTS.DEFRAG_DONE, { from: pass.from, passes: state.defrag.passes });
      save();
    }

    for (const buff of pruneBuffs(state, now)) bus.emit(EVENTS.BUFF_EXPIRED, { buff });

    const { spawned, missed } = updateStatusEvents(state, dt, rng);
    if (spawned) bus.emit(EVENTS.STATUS_SPAWNED, spawned);
    if (missed) bus.emit(EVENTS.STATUS_MISSED, missed);

    lw.updateSeeds(state, dt, econ.totalBandwidth(state));

    for (const item of lw.updateTrash(state, dt)) {
      bus.emit(EVENTS.TRASH_EMPTIED, { file: getFile(item.fileId) });
    }

    const threat = shield.updateThreats(state, dt, rng, now);
    if (threat) {
      if (threat.outcome === 'quarantined') {
        bus.emit(EVENTS.THREAT_QUARANTINED, {
          item: threat.item,
          threat: shield.getThreat(threat.item.threatId),
        });
      } else {
        bus.emit(EVENTS.VIRUS, { outcome: threat.outcome });
      }
      save();
    }

    const disc = burner.updateBurn(state, dt);
    if (disc) {
      bus.emit(EVENTS.BURN_DONE, { cd: getCD(disc.typeId), disc });
      save();
    }

    const render = aerostudio.updateRender(state, dt);
    if (render?.done) {
      const payout = econ.buzzPerSecond(state, now) * AEROSTUDIO.payoutSeconds;
      // Store the reward for manual collection instead of granting immediately.
      // finishRender() resets isRendering so updateRender stops returning done.
      state.aerostudio.pendingReward = {
        projectName: render.projectName,
        payout,
      };
      aerostudio.finishRender(state);
      bus.emit(EVENTS.RENDER_DONE, { projectName: render.projectName, payout });
      bus.emit(EVENTS.NOTIFY, {
        title: 'Render Complete!',
        body: `"${render.projectName}" is ready — collect your reward!`,
        tone: 'success',
      });
      save();
    }

    // AeroSweeper tokens refill whether or not the tab was open — wall clock.
    const tokens = sweeper.updateTokens(state, now);
    if (tokens > 0) {
      bus.emit(EVENTS.SWEEPER_TOKEN, { granted: tokens, tokens: state.sweeper.tokens, bought: false });
      save();
    }

    const scan = shield.updateScan(state, dt);
    if (scan?.done) {
      bus.emit(EVENTS.SCAN_DONE, { cured: scan.cured });
      save();
    }

    // A timed playlist burns out on the wall clock, so it also expires while
    // the tab is closed rather than resuming on return.
    if (state.retroamp.playlist && state.retroamp.endsAt > 0 && state.retroamp.endsAt <= now) {
      ejectPlaylist('burnt-out');
    }

    /**
     * The Darknet Breach clock (GDD §C). Simulation time, not wall clock: a
     * player who shuts the tab for a week must not come back to a machine that
     * has been quietly robbed in their absence. See ARCHITECTURE.md on the two
     * clocks — this is firmly in the "only while somebody is watching" camp.
     */
    for (const item of breach.updateBreach(state, dt, rng, now)) {
      if (item.type === 'phase') {
        bus.emit(EVENTS.BREACH_PHASE, { from: item.from, to: item.to });
        save();
      } else if (item.type === 'rogue') {
        bus.emit(EVENTS.ROGUE_SPAWNED, { rogue: item.rogue });
      } else if (item.type === 'popup') {
        bus.emit(EVENTS.BREACH_POPUP, { popup: item.popup });
      } else if (item.type === 'phase3') {
        bus.emit(EVENTS.BREACH_FULL, {});
        save();
      }
    }

    /**
     * A Legacy level-up is silent otherwise — it is a background accumulator
     * with no purchase attached, so this is the only moment it can announce
     * itself (patch §3: automatic, but never invisible).
     *
     * Coalesced, because "one level" is not a fixed amount of Buzz. A level
     * costs `3n²+3n+1` million, so early on they arrive minutes apart and in the
     * late game several can land per second — which as raw events meant a
     * torrent of toasts and a save write each. The level itself still updates
     * every tick; only the announcement waits, and it reports the whole jump
     * rather than the last step of it.
     */
    const level = legacy.legacyLevel(state);
    if (level !== state.legacy.level) {
      if (pendingLegacyFrom === null) pendingLegacyFrom = state.legacy.level;
      state.legacy.level = level;
    }
    if (pendingLegacyFrom !== null && now - lastLegacyAnnounceAt >= LEGACY_ANNOUNCE_MS) {
      const from = pendingLegacyFrom;
      pendingLegacyFrom = null;
      lastLegacyAnnounceAt = now;
      if (level > from) {
        bus.emit(EVENTS.LEGACY_LEVEL, { from, to: level });
        save();
      }
    }

    if (shouldRevealHardware(state, econ.ramUsed(state), econ.ramCapacity(state))) {
      noticeBottleneck();
    }
    checkTutorial();
    announceCosmetics();
    checkAchievements(now);

    if (now - lastSaveAt >= SAVE.autosaveMs) save();
    bus.emit(EVENTS.TICK, { state, dt });
  }

  /**
   * Award anything just earned, and tell the portal how far along the player is.
   *
   * Both halves are cheap by construction: the predicates are ~30 comparisons
   * over numbers already in memory, and `completionToReport` returns null until
   * the figure has actually moved five points, so the SDK call site downstream
   * fires a handful of times across an entire playthrough rather than per tick.
   */
  function checkAchievements(now = Date.now()) {
    const fresh = achievements.evaluateAchievements(state, now);
    for (const achievement of fresh) {
      bus.emit(EVENTS.ACHIEVEMENT, { achievement });
    }
    if (fresh.length > 0) save();

    const percent = achievements.completionToReport(state);
    if (percent !== null) {
      achievements.markCompletionReported(state, percent);
      bus.emit(EVENTS.COMPLETION_REPORT, { percent });
    }
  }

  /* -------------------------------------------------------------- actions */

  /**
   * Manual click on the Nudge button (GDD 4).
   *
   * The streak is advanced *before* the payout is priced, so the click that
   * extends a streak is the click that is paid for it — a bonus applied on the
   * next press instead would read as the button paying out at random.
   */
  function nudge(at = Date.now()) {
    const streak = state.click;
    const alive = streak.count > 0 && at - streak.lastAt <= CLICK.streak.windowSeconds * 1000;
    streak.count = alive ? Math.min(streak.count + 1, CLICK.streak.maxCount) : 1;
    streak.lastAt = at;

    const amount = econ.clickPower(state, at);
    state.stats.nudges += 1;
    grantBuzz(amount, 'nudge');
    return amount;
  }

  function setUsername(username) {
    state.username = username;
    save();
  }

  function openApp(id) {
    const check = econ.canOpenApp(state, id);
    if (!check.ok) {
      if (check.reason === 'out-of-memory') {
        bus.emit(EVENTS.OUT_OF_MEMORY, {
          id,
          needed: econ.appRam(state, id),
          free: econ.ramFree(state),
        });
        noticeBottleneck();
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

  /**
   * Buy units of a building (v2 §2) — the economy's main spending sink.
   *
   * One action for all twelve, including AeroChat: the price curve is shared
   * (patch §2.1) and so is the max-per-run rail, so a second code path would
   * only be a second place for them to drift apart.
   *
   * A purchase that changes another building's output says so (patch §4.2). A
   * synergy the player cannot see is a synergy that, for them, does not exist.
   */
  function buyBuildingUnits(id, amount = 1) {
    const milestonesBefore = id === 'aerochat' ? econ.chatMilestoneCount(state) : 0;
    const result = buildings.buyUnits(state, id, amount);
    if (!result.ok) return result;

    const building = getBuilding(id);
    bus.emit(EVENTS.UNITS_BOUGHT, { id, count: result.count, cost: result.cost, building });
    if (id === 'aerochat') {
      bus.emit(EVENTS.BOT_BOUGHT, { count: result.count, cost: result.cost });
      // Crossing a milestone is the reason to buy in bulk, so it is announced.
      if (econ.chatMilestoneCount(state) > milestonesBefore) {
        bus.emit(EVENTS.MILESTONE, {
          at: econ.chatMilestoneCount(state) * CHAT_BOT.milestoneEvery,
          multiplier: econ.chatMilestoneMultiplier(state),
        });
      }
    }

    for (const partner of buildings.synergyPartnersOf(state, id)) {
      bus.emit(EVENTS.SYNERGY_APPLIED, { source: id, target: partner });
    }

    save();
    return result;
  }

  /**
   * One row per building for the roster UI, already resolved.
   *
   * Locked buildings are included on purpose — that is the visibility hook
   * (v2 §6). The player is meant to see Cloud Mainframe sitting greyed out with
   * its requirement printed under it for a very long time before they can touch
   * it.
   */
  function buildingRows() {
    const now = Date.now();
    return BUILDING_LIST.map((building) => {
      const unlocked = buildings.isBuildingUnlocked(state, building.id);
      const owned = buildings.unitsOf(state, building.id);
      return {
        ...building,
        unlocked,
        lock: buildings.lockReason(state, building.id),
        units: owned,
        maxed: owned >= building.maxPerRun,
        cost: buildings.unitCost(building.id, owned),
        affordable: state.buzz >= buildings.unitCost(building.id, owned),
        production: buildings.buildingProduction(state, building.id, now),
        breakdown: econ.getProductionBreakdown(state, building.id, now),
        upgrades: upgrades.upgradeRows(state, building.id),
        minigame: minigames.hasMinigame(building.id)
          ? {
            unlocked: minigames.isMinigameUnlocked(state, building.id),
            cooldownSeconds: minigames.minigameCooldownLeft(state, building.id, now),
            config: minigames.minigameConfig(building.id),
          }
          : null,
      };
    });
  }

  /** Buy chat buddies (AO-9). AeroChat's units, under their original name. */
  function buyBots(amount = 1) {
    const result = buyBuildingUnits('aerochat', amount);
    if (!result.ok && result.reason === 'maxed') {
      return { ok: false, reason: 'buddy-list-full' };
    }
    return result;
  }

  /**
   * Buy a building upgrade (v2 §4). The double gate — Buzz *and* a unit count —
   * is enforced in `core/upgrades.js`; this only announces the result.
   */
  function buyBuildingUpgrade(upgradeId) {
    const result = upgrades.buyUpgrade(state, upgradeId);
    if (!result.ok) return result;

    bus.emit(EVENTS.UPGRADE_BOUGHT, { upgrade: result.upgrade, cost: result.cost });
    // A synergy upgrade is the one purchase whose whole point is elsewhere.
    if (result.upgrade.effect.kind === 'synergy') {
      bus.emit(EVENTS.SYNERGY_APPLIED, {
        source: result.upgrade.effect.major,
        target: result.upgrade.effect.minor,
        upgrade: result.upgrade,
      });
    }
    if (minigames.hasMinigame(result.upgrade.buildingId) && minigames.isMinigameUnlocked(state, result.upgrade.buildingId)) {
      bus.emit(EVENTS.MINIGAME_UNLOCKED, { id: result.upgrade.buildingId });
    }
    save();
    return result;
  }

  /* --------------------------------------------------------------- legacy */

  /** Buy another Legacy Slot (v2 §5.2) — the second Dollar sink. */
  function buyLegacySlot() {
    const result = legacy.buySlot(state);
    if (result.ok) {
      bus.emit(EVENTS.LEGACY_SLOT, { slots: result.slots, cost: result.cost });
      announceCosmetics();
      save();
    }
    return result;
  }

  /** Point a slot at the upgrade it should carry through the next wipe. */
  function setLegacySlot(index, upgradeId) {
    const result = legacy.assignSlot(state, index, upgradeId);
    if (result.ok) save();
    return result;
  }

  /* ------------------------------------------------------- Darknet Breach */

  /**
   * Kill a rogue process (GDD §C.3, phase 2). Pays a lump sized by current
   * production, so checking in on a breached desktop is rewarded rather than
   * merely damage-limiting.
   */
  function terminateRogue(id) {
    const now = Date.now();
    const result = breach.popRogue(state, id, econ.buzzPerSecond(state, now));
    if (!result.ok) return result;

    grantBuzz(result.buzz, 'rogue-process');
    bus.emit(EVENTS.ROGUE_TERMINATED, { id, buzz: result.buzz });
    save();
    return result;
  }

  function dismissBreachPopup(id) {
    return breach.closePopup(state, id);
  }

  /**
   * Answer the full-screen breach (GDD §C.3, phase 3).
   *
   * `outcome` is 'ransom' (pay and it ends), 'fought' (the reaction game was
   * won) or 'lost' (it was not). Fighting and winning is the best result and
   * losing is the worst, which is what makes the choice a real one.
   */
  function resolveBreach(outcome) {
    const now = Date.now();
    const result = breach.resolveBreach(state, outcome);
    if (!result.ok) return result;

    if (outcome === 'fought') {
      const reward = econ.buzzPerSecond(state, now) * BREACH.phase3.fightRewardSeconds;
      grantBuzz(reward, 'breach');
      state.dollars += BREACH.phase3.fightDollars;
      addBuff(
        state,
        {
          id: 'breach-victory',
          kind: 'global',
          magnitude: BREACH.phase3.fightBuffMagnitude,
          durationSeconds: BREACH.phase3.fightBuffSeconds,
          label: 'Counter-Attack',
          source: 'breach',
        },
        now,
      );
      result.reward = reward;
      result.dollars = BREACH.phase3.fightDollars;
    }

    bus.emit(EVENTS.BREACH_RESOLVED, result);
    checkAchievements(now);
    save();
    return result;
  }

  /** Buy the opt-out (GDD §C.5). Permanent, priced, and it silences everything. */
  function buyIncognito() {
    const result = breach.buyIncognito(state);
    if (result.ok) {
      bus.emit(EVENTS.INCOGNITO_BOUGHT, { cost: result.cost });
      checkAchievements();
      save();
    }
    return result;
  }

  /* ------------------------------------------------------------ mini-games */

  function canPlayMinigame(id) {
    return minigames.canPlayMinigame(state, id, Date.now());
  }

  /**
   * Bank a mini-game round (GDD §B).
   *
   * Every one of the five funnels through here, and through the one reward
   * function underneath it — which is what guarantees the economic rule holds:
   * a timed bonus scoped to that building, never a permanent multiplier and
   * never raw Buzz.
   */
  function finishMinigame(id, result) {
    const now = Date.now();
    const check = minigames.canPlayMinigame(state, id, now);
    if (!check.ok) return check;

    const reward = minigames.applyMinigameReward(state, id, result, now);
    if (!reward.ok) return reward;

    bus.emit(EVENTS.MINIGAME_ENDED, reward);
    checkAchievements(now);
    save();
    return reward;
  }

  /* ------------------------------------------------------------- RetroAmp */

  /** Load a playlist (AO-14). Timed playlists start their countdown here. */
  function loadPlaylist(id) {
    const now = Date.now();
    const check = econ.canLoadPlaylist(state, id, now);
    if (!check.ok) {
      if (check.reason === 'out-of-memory') {
        bus.emit(EVENTS.OUT_OF_MEMORY, { id: 'retroamp', needed: check.needed, free: check.free });
        noticeBottleneck();
      }
      return check;
    }

    // Swapping is an eject followed by a load — never a silent overwrite, or
    // the outgoing playlist escapes its cooldown.
    if (state.retroamp.playlist && state.retroamp.playlist !== id) ejectPlaylist('swapped');

    const playlist = getPlaylist(id);
    state.retroamp.playlist = id;
    state.retroamp.startedAt = now;
    state.retroamp.endsAt = playlist.durationSeconds
      ? now + playlist.durationSeconds * 1000
      : 0;

    bus.emit(EVENTS.PLAYLIST_LOADED, { playlist });
    checkTutorial();
    return { ok: true, playlist };
  }

  function ejectPlaylist(reason = 'ejected') {
    const id = state.retroamp.playlist;
    if (!id) return { ok: false, reason: 'nothing-loaded' };
    const playlist = getPlaylist(id);
    const now = Date.now();

    /**
     * A timed playlist owes cooldown *however* it leaves the deck — burnt out,
     * ejected by hand, or swapped for another one. Charging only on burn-out
     * let the player swap to SOFT SIGNALS a second before the end and reload
     * the burst immediately, which is an unlimited ×3.
     *
     * The debt is proportional to the burst actually consumed, so the duty
     * cycle is the same whether it runs in one stretch or five: a fifth of the
     * burst costs a fifth of the cooldown.
     */
    if (playlist.cooldownSeconds > 0 && playlist.durationSeconds) {
      // Burning out means the whole burst was consumed by definition — do not
      // re-derive that from the clock, or a playlist whose end time was reached
      // in a single tick owes almost nothing.
      const used =
        reason === 'burnt-out'
          ? playlist.durationSeconds
          : Math.min(
            playlist.durationSeconds,
            Math.max(0, (now - state.retroamp.startedAt) / 1000),
          );
      const owed = playlist.cooldownSeconds * (used / playlist.durationSeconds);
      if (owed > 0) state.retroamp.cooldownUntil[id] = now + owed * 1000;
    }
    state.retroamp.playlist = null;
    state.retroamp.endsAt = 0;
    state.retroamp.startedAt = 0;

    bus.emit(EVENTS.PLAYLIST_ENDED, { playlist, reason });
    return { ok: true, playlist };
  }

  /* ------------------------------------------------- LemonWire / Shield99 */

  /** Put a file in a seed slot (AO-21). Refusals explain themselves to the UI. */
  function startSeeding(fileId) {
    const check = econ.canSeedFile(state, fileId);
    if (!check.ok) return check;

    const seed = lw.startSeeding(state, fileId, Date.now());
    bus.emit(EVENTS.SEED_STARTED, { seed, file: getFile(fileId) });
    save();
    return { ok: true, seed };
  }

  /** Free the slot. The file goes to the bin, so the disk lags behind. */
  function stopSeeding(seedId) {
    const result = lw.stopSeeding(state, seedId);
    if (result.ok) {
      bus.emit(EVENTS.SEED_STOPPED, {
        file: getFile(result.seed.fileId),
        secondsLeft: result.secondsLeft,
      });
      save();
    }
    return result;
  }

  /** Buy the next connection tier — the multiplier over every slot at once. */
  function upgradeConnection() {
    const result = lw.upgradeConnection(state);
    if (result.ok) {
      bus.emit(EVENTS.BANDWIDTH_UPGRADED, { connection: result.connection, cost: result.cost });
      save();
    }
    return result;
  }

  /**
   * Open a quarantined file (the rewarded-ad lootbox).
   *
   * The ad itself belongs to the shell — the SDK is a browser API and core does
   * not touch it — so this is called *after* `adFinished` with `viaAd: true`.
   * The manual path is always available at a fraction of the reward, because a
   * player with an ad blocker must never be locked out of a mechanic.
   *
   * When the ad system is switched off entirely (`ADS.enabled`), that fraction
   * would stop being a trade and become a permanent tax: there is no ad to
   * watch, so 25% is simply what the lootbox is worth now. It pays in full
   * instead — "nothing is gated behind an ad" has to survive the ads being off.
   */
  function extractQuarantine(itemId, { viaAd = false } = {}) {
    const now = Date.now();
    const check = shield.canExtract(state, itemId, { viaAd, now });
    if (!check.ok) return check;

    const threat = shield.getThreat(check.item.threatId);
    const reward = shield.rewardFor(threat, {
      fraction: viaAd || !ADS.enabled ? 1 : SHIELD99.manualRewardFraction,
      buzzPerSecond: econ.buzzPerSecond(state, now),
      isRendering: state.aerostudio.isRendering,
    });

    shield.takeFromQuarantine(state, itemId);
    if (viaAd) shield.startAdCooldown(state, now);

    if (reward.kind === 'buzz') {
      grantBuzz(reward.buzz, 'quarantine');
    } else if (reward.kind === 'buff') {
      addBuff(
        state,
        {
          id: `quarantine-${threat.id}`,
          kind: 'global',
          magnitude: reward.magnitude,
          durationSeconds: reward.durationSeconds,
          label: threat.name,
          source: 'shield99',
        },
        now,
      );
    } else if (reward.kind === 'render') {
      aerostudio.boostRender(state, reward.renderFraction);
    }

    bus.emit(EVENTS.QUARANTINE_CLAIMED, { threat, reward, viaAd });
    save();
    return { ok: true, threat, reward };
  }

  /* ----------------------------------------------------------- AeroSweeper */

  /**
   * Deal a fresh board (Day 7). One token, one round.
   *
   * The round object is *returned*, not stored: it lasts a minute and means
   * nothing once banked, so the app module holds it. It carries the injected
   * `rng` with it, because the mine layout is not decided until the first click
   * and no mechanic in this codebase reaches for `Math.random` itself.
   */
  function startSweeperRound() {
    const check = sweeper.canPlay(state);
    if (!check.ok) return check;

    const now = Date.now();
    sweeper.spendToken(state, now);
    bus.emit(EVENTS.SWEEPER_STARTED, { tokensLeft: state.sweeper.tokens });
    save();
    return { ok: true, round: sweeper.createRound(SWEEPER, rng), tokensLeft: state.sweeper.tokens };
  }

  /** Skip the queue with Buzz. The board is pacing, not a paywall. */
  function buySweeperToken() {
    const now = Date.now();
    const check = econ.canBuySweeperToken(state, now);
    if (!check.ok) return check;

    const cost = econ.sweeperTokenCost(state, now);
    state.buzz -= cost;
    sweeper.addToken(state, 1);
    bus.emit(EVENTS.SWEEPER_TOKEN, { granted: 1, tokens: state.sweeper.tokens, bought: true, cost });
    save();
    return { ok: true, cost, tokens: state.sweeper.tokens };
  }

  /**
   * Bank the round — by cashing out, by clearing the board, or by standing on a
   * mine. Everything it was worth is settled here: a click buff sized by the
   * squares survived, which is what turns the Nudge button red and sends the
   * player back to it, plus a Buzz payout so a spent token always buys
   * something.
   *
   * A mine halves the buff rather than taking it. The whole round is an
   * argument for one more square, and a penalty that erases the session just
   * teaches the player to stop after the first click.
   */
  function endSweeperRound(tiles, { hitMine = false, cleared = false } = {}) {
    const now = Date.now();
    const combo = sweeper.comboFor(Math.max(0, Math.floor(tiles)), { hitMine, cleared });

    state.sweeper.rounds += 1;
    state.sweeper.bestTiles = Math.max(state.sweeper.bestTiles, combo.tiles);
    if (cleared) state.sweeper.sweeps += 1;

    const survived = hitMine ? SWEEPER.mineFraction : 1;
    const buzz = econ.buzzPerSecond(state, now) * SWEEPER.buzzSecondsPerTile * combo.tiles * survived;
    if (buzz > 0) grantBuzz(buzz, 'aerosweeper');

    if (combo.magnitude > 0) {
      addBuff(
        state,
        {
          id: SWEEPER.comboBuffId,
          kind: 'click',
          magnitude: combo.magnitude,
          durationSeconds: combo.durationSeconds,
          label: 'Sweeper combo',
          source: 'aerosweeper',
        },
        now,
      );
    }

    bus.emit(EVENTS.SWEEPER_ENDED, {
      tiles: combo.tiles,
      combo,
      buzz,
      best: state.sweeper.bestTiles,
    });
    save();
    return { ok: true, combo, buzz };
  }

  /* -------------------------------------------------------------- AeroBurn */

  /** Burn Buzz onto a disc that will outlive the next Format C: (AO-29). */
  function startBurn(typeId) {
    const check = burner.canBurn(state, typeId);
    if (!check.ok) return check;

    const job = burner.startBurn(state, typeId);
    bus.emit(EVENTS.BURN_STARTED, { cd: getCD(typeId), job });
    return { ok: true, job };
  }

  /** Play a disc: Buzz back, or a buff. Either way it is consumed. */
  function playDisc(index) {
    const result = burner.playDisc(state, index, Date.now());
    if (!result.ok) return result;

    if (result.buzz > 0) grantBuzz(result.buzz, 'aeroburn');
    bus.emit(EVENTS.DISC_PLAYED, { cd: result.cd, buzz: result.buzz });
    save();
    return result;
  }

  /** Start a Shield99 scan (AO-22). Curing is what ends an infection. */
  function startScan() {
    const result = shield.startScan(state);
    if (result.ok) bus.emit(EVENTS.SCAN_STARTED, {});
    return result;
  }

  /* ----------------------------------------------------------- rewarded ads */

  /**
   * Is a rewarded offer worth showing, and what does it pay?
   *
   * Two gates, deliberately kept apart: `core/ads.js` owns *pacing* (daily
   * allowance, cooldown) and knows nothing about the game; this function owns
   * *context* — there is no point offering a render skip with no render
   * running, or a payout boost on a Format C: that is not ready. The UI calls
   * it to label a button, and `claimAdReward` calls it again to make sure the
   * offer was still valid by the time the video finished.
   */
  function adOffer(id, now = Date.now()) {
    const paced = ads.canWatch(state, id, now);
    if (!paced.ok) return paced;

    if (id === 'sweeperToken' && state.sweeper.tokens >= SWEEPER.maxTokens) {
      return { ok: false, reason: 'tokens-full' };
    }
    if (id === 'renderBoost' && !state.aerostudio.isRendering) {
      return { ok: false, reason: 'not-rendering' };
    }
    if (id === 'formatBoost') {
      if (state.ads.formatBoost) return { ok: false, reason: 'already-boosted' };
      if (!econ.canPrestige(state)) return { ok: false, reason: 'not-worth-it' };
    }

    return {
      ...paced,
      reward: ads.rewardFor(state, id, { buzzPerSecond: econ.buzzPerSecond(state, now), now }),
    };
  }

  /**
   * Pay out a rewarded ad.
   *
   * Called by the shell *after* `adFinished`, never before — the SDK is a
   * browser API and core does not touch it, which is the same seam
   * `extractQuarantine` uses. Everything it can hand out is an existing system:
   * a buff, a Buzz grant, a sweeper token, render progress. Nothing here is a
   * bespoke ad-only mechanic, so nothing here can drift out of balance on its
   * own.
   */
  function claimAdReward(id, now = Date.now()) {
    const offer = adOffer(id, now);
    if (!offer.ok) return offer;

    const { reward } = offer;
    ads.markWatched(state, id, now);

    if (reward.kind === 'buzz') {
      grantBuzz(reward.buzz, 'rewarded-ad');
    } else if (reward.kind === 'buff') {
      addBuff(
        state,
        {
          id: ADS.rewarded.overclock.buffId,
          kind: 'global',
          magnitude: reward.magnitude,
          durationSeconds: reward.durationSeconds,
          label: 'Overclocked',
          source: 'ads',
        },
        now,
      );
    } else if (reward.kind === 'token') {
      sweeper.addToken(state, reward.tokens);
      bus.emit(EVENTS.SWEEPER_TOKEN, {
        granted: reward.tokens,
        tokens: state.sweeper.tokens,
        bought: true,
      });
    } else if (reward.kind === 'render') {
      aerostudio.boostRender(state, reward.renderFraction);
    } else if (reward.kind === 'dollars') {
      // Nothing is paid now: the flag is spent by the Format C: it was bought
      // for, so a player who changes their mind keeps it for the next one.
      state.ads.formatBoost = true;
    }

    bus.emit(EVENTS.AD_REWARD, { id, reward });
    save();
    return { ok: true, reward };
  }

  /**
   * The welcome-back multiplier (GDD 8's "Internet Cafe Bonus"). It is not part
   * of `claimAdReward` because the thing it multiplies — the offline report —
   * is closure state that exists for exactly one dialog.
   */
  function doubleOfflineBuzz(now = Date.now()) {
    if (!(offlineReport?.buzz > 0)) return { ok: false, reason: 'nothing-to-double' };
    const paced = ads.canWatch(state, 'offlineDouble', now);
    if (!paced.ok) return paced;

    const extra = offlineReport.buzz * (ADS.rewarded.offlineDouble.multiplier - 1);
    ads.markWatched(state, 'offlineDouble', now);
    grantBuzz(extra, 'rewarded-ad');
    bus.emit(EVENTS.AD_REWARD, { id: 'offlineDouble', reward: { kind: 'buzz', buzz: extra } });
    save();
    return { ok: true, buzz: extra };
  }

  /* -------------------------------------------------------------- tutorial */

  function checkTutorial() {
    const completed = advanceTutorial(state);
    if (completed.length > 0) {
      bus.emit(EVENTS.TUTORIAL_STEP, {
        completed,
        next: currentStep(state),
        done: state.tutorial.done,
      });
    }
  }

  /**
   * The first time the machine is pushed to its limit, hardware appears
   * (GDD 7). Called on any out-of-memory refusal, and from the tick once the
   * player is simply running close to full.
   */
  function noticeBottleneck() {
    if (!revealHardware(state)) return;
    bus.emit(EVENTS.HARDWARE_REVEALED, {});
    checkTutorial();
    save();
  }

  function skipOnboarding() {
    skipTutorial(state);
    bus.emit(EVENTS.HARDWARE_REVEALED, {});
    bus.emit(EVENTS.TUTORIAL_STEP, { completed: [], next: null, done: true });
    save();
  }

  /**
   * The player has read the hand-off card at the end of the goal chain
   * (`core/goals.js`). Nothing in the simulation changes; the coach panel stops
   * being drawn, which on a phone is fifty pixels of app it was reserving to
   * repeat a sentence with no objective in it.
   */
  function dismissGoals() {
    if (state.tutorial.goalsDismissed) return;
    state.tutorial.goalsDismissed = true;
    save();
  }

  /**
   * Claim the pending status-message bonus (AO-10). Timed buffs are applied by
   * the event module; 'burst' bonuses are paid here, where the rate is known.
   */
  function claimStatusBonus() {
    const now = Date.now();
    const result = claimStatusEvent(state, now, rng);
    if (!result.ok) return result;

    let buzz = 0;
    if (result.bonus.kind === 'burst') {
      buzz = econ.buzzPerSecond(state, now) * result.bonus.magnitude;
      grantBuzz(buzz, 'status-burst');
    }
    bus.emit(EVENTS.STATUS_CLAIMED, { bonus: result.bonus, buzz });
    return { ...result, buzz };
  }

  function buyHardware(track) {
    if (!(track in HARDWARE)) return { ok: false, reason: 'unknown-track' };
    const next = nextTierOf(track, state.hardware[track]);
    if (!next) return { ok: false, reason: 'maxed' };
    if (state.dollars < next.cost) return { ok: false, reason: 'too-expensive' };

    state.dollars -= next.cost;
    state.dollarsSpentTotal += next.cost;
    state.hardware[track] += 1;
    bus.emit(EVENTS.HARDWARE_BOUGHT, { track, tier: next });
    announceCosmetics();
    save();
    return { ok: true, tier: next };
  }

  /* -------------------------------------------------------- Auto-Defrag */

  /**
   * Buy the scheduler (core/defrag.js). Dollar-priced, so it belongs to the
   * meta-game and survives the wipe — a bloat fix the player has to re-earn
   * every run is not a fix, it is another chore.
   */
  function buyDefrag() {
    const check = defrag.canBuyDefrag(state);
    if (!check.ok) return check;

    state.dollars -= check.cost;
    state.dollarsSpentTotal += check.cost;
    state.defrag.owned = true;
    bus.emit(EVENTS.DEFRAG_INSTALLED, { cost: check.cost });
    announceCosmetics();
    save();
    return { ok: true, cost: check.cost };
  }

  /* --------------------------------------------------------- cosmetics */

  /**
   * Pick a window tint or a wallpaper. The rules live in `core/cosmetics.js`;
   * this is the action that writes the choice and tells the shell to redress
   * the desktop.
   */
  function setCosmetic(kind, id) {
    const result = cosmetics.chooseCosmetic(state, kind, id);
    if (!result.ok) return result;
    bus.emit(EVENTS.COSMETIC_CHANGED, { kind, item: result.item });
    save();
    return result;
  }

  /**
   * Announce anything that just became available. Cheap enough to sit in the
   * tick — eight predicates over numbers, and it only writes to the save when
   * the answer changes — which is what lets a lifetime-Buzz unlock arrive at
   * the moment it is earned rather than the next time a shop is opened.
   */
  function announceCosmetics() {
    for (const item of cosmetics.takeNewlyUnlocked(state)) {
      bus.emit(EVENTS.COSMETIC_UNLOCKED, { item });
    }
  }

  function startRender(projectName) {
    // Don't allow starting a new render while a reward is waiting to be claimed.
    if (state.aerostudio.pendingReward) return { ok: false, reason: 'pending-reward' };
    const result = aerostudio.startRender(state, projectName);
    if (result.ok) bus.emit(EVENTS.RENDER_STARTED, { projectName });
    return result;
  }

  /**
   * Claim the deferred render reward (the player clicks "Collect").
   *
   * The portal's `happytime()` belongs on this moment, but not in here: core
   * does not touch the browser, and the bare `window.CrazyGames` this used to
   * reach for was also a ReferenceError waiting for the first test that ran this
   * function in plain Node. `RENDER_CLAIMED` is emitted below and main.js makes
   * the call, the same way it does for PRESTIGE.
   */
  function claimRenderReward() {
    const pending = state.aerostudio.pendingReward;
    if (!pending) return { ok: false, reason: 'no-pending' };

    grantBuzz(pending.payout, 'aerostudio');
    state.aerostudio.pendingReward = null;

    bus.emit(EVENTS.RENDER_CLAIMED, { projectName: pending.projectName, payout: pending.payout });
    bus.emit(EVENTS.NOTIFY, {
      title: 'Reward Collected!',
      body: `+${formatNumber(pending.payout)} Buzz from "${pending.projectName}"`,
      tone: 'success',
    });
    save();
    return { ok: true, projectName: pending.projectName, payout: pending.payout };
  }

  function cancelRender() {
    return aerostudio.cancelRender(state);
  }

  function buyAeroUpgrade(upgradeId) {
    const result = aerostudio.buyUpgrade(state, upgradeId);
    if (result.ok) {
      bus.emit(EVENTS.AERO_UPGRADE_BOUGHT, { upgradeId, cost: result.cost });
      save();
    }
    return result;
  }

  /**
   * Ask the shell to run the Format C: sequence (AO-17). The game does not own
   * the animation, so it announces the intent and lets main.js drive the BSOD,
   * calling formatC() at the right beat.
   */
  function requestFormat() {
    const dollars = econ.pendingPrestigeDollars(state);
    if (dollars <= 0) return { ok: false, reason: 'not-worth-it' };
    bus.emit(EVENTS.FORMAT_REQUESTED, { dollars });
    return { ok: true, dollars };
  }

  /**
   * "Format C:" — wipe software, keep hardware, bank Dollars (GDD 5).
   *
   * A rewarded payout boost bought before the wipe is spent here, and paid as a
   * *bonus* rather than as extra earnings: see the note in resetForPrestige.
   */
  function formatC() {
    const dollars = econ.pendingPrestigeDollars(state);
    if (dollars <= 0) return { ok: false, reason: 'not-worth-it' };

    const bonus = state.ads.formatBoost
      ? Math.floor(dollars * (ADS.rewarded.formatBoost.multiplier - 1) * 100) / 100
      : 0;

    state = resetForPrestige(state, dollars, Date.now(), { bonusDollars: bonus });
    bus.emit(EVENTS.PRESTIGE, { dollars, bonus });
    save();
    return { ok: true, dollars, bonus };
  }

  /** Player settings (sound, motion). Persisted immediately — it is a promise. */
  function setSettings(patch) {
    state.settings = { ...state.settings, ...patch };
    bus.emit(EVENTS.SETTINGS, { settings: state.settings });
    save();
    return state.settings;
  }

  function hardReset() {
    state = createInitialState(Date.now());
    save();
    return { ok: true };
  }

  const dev = import.meta.env.DEV ? {
    addBuzz(amount) {
      grantBuzz(amount, 'dev');
    },
    addMoney(amount) {
      state.dollars += amount;
      state.dollarsEarnedTotal += amount;
      bus.emit(EVENTS.NOTIFY, { title: 'Dev', body: `Added $${amount.toLocaleString()}`, tone: 'success' });
    },
    skipTime(seconds) {
      tick(seconds);
      bus.emit(EVENTS.NOTIFY, { title: 'Dev', body: `Skipped ${seconds}s`, tone: 'info' });
    },
    clearCooldowns() {
      state.retroamp.cooldownUntil = {};
      state.shield99.adCooldownUntil = 0;
      state.sweeper.nextTokenAt = 0;
      state.sweeper.tokens = SWEEPER.maxTokens;
      state.ads.watched = {};
      state.ads.lastAt = {};
      bus.emit(EVENTS.NOTIFY, { title: 'Dev', body: 'Cooldowns cleared', tone: 'success' });
    }
  } : null;

  return {
    dev,
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
    setUsername,
    openApp,
    closeApp,
    installApp,
    buyBots,

    /* ------------------------------------------- v2 economy: buildings */
    buyBuildingUnits,
    buyBuildingUpgrade,
    units: (id) => buildings.unitsOf(state, id),
    unitCost: (id) => buildings.unitCost(id, buildings.unitsOf(state, id)),
    buildingRows: () => buildingRows(),
    upgradeRows: (id) => upgrades.upgradeRows(state, id),
    productionBreakdown: (id) => econ.getProductionBreakdown(state, id),

    /* ------------------------------------------------- v2 economy: legacy */
    buyLegacySlot,
    setLegacySlot,
    legacy: () => legacy.legacyProgress(state),
    legacySlots: () => ({
      slots: [...(state.legacy?.slots ?? [])],
      nextCost: legacy.nextSlotCost(state),
      canBuy: legacy.canBuySlot(state),
    }),

    /* ------------------------------------------------------ Darknet Breach */
    breach: () => breach.breachStatus(state),
    terminateRogue,
    dismissBreachPopup,
    resolveBreach,
    buyIncognito,
    incognitoCost: BREACH.incognito.cost,

    /* ---------------------------------------------------------- mini-games */
    canPlayMinigame,
    finishMinigame,
    minigames: () => minigames.minigameRows(state, Date.now()),
    minigameConfig: (id) => minigames.minigameConfig(id),

    /* -------------------------------------------------------- achievements */
    achievements: () => achievements.achievementSummary(state),
    completionPercent: () => achievements.completionPercent(state),
    claimStatusBonus,
    loadPlaylist,
    ejectPlaylist,
    startSeeding,
    stopSeeding,
    upgradeConnection,
    extractQuarantine,
    startScan,
    startBurn,
    playDisc,
    startSweeperRound,
    buySweeperToken,
    endSweeperRound,
    sweeperTokenSeconds: (now = Date.now()) => sweeper.secondsToNextToken(state, now),
    skipOnboarding,
    dismissGoals,
    setSettings,
    currentTutorialStep: () => currentStep(state),
    buyHardware,
    buyDefrag,
    defragCost: DEFRAG.cost,
    setCosmetic,
    cosmetics: () => cosmetics.cosmeticSummary(state),
    activeCosmetics: () => cosmetics.activeCosmetics(state),
    startRender,
    cancelRender,
    claimRenderReward,
    buyAeroUpgrade,
    formatC,
    requestFormat,
    hardReset,
    adOffer,
    claimAdReward,
    doubleOfflineBuzz,
    /** What a Format C: would bank right now, boost included. */
    formatPayout() {
      const dollars = econ.pendingPrestigeDollars(state);
      const bonus = state.ads.formatBoost
        ? Math.floor(dollars * (ADS.rewarded.formatBoost.multiplier - 1) * 100) / 100
        : 0;
      return { dollars, bonus, total: dollars + bonus };
    },
    notify(title, body, tone = 'info') {
      bus.emit(EVENTS.NOTIFY, { title, body, tone });
    },
  };
}
