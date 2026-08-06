import { CHAT_BOT, SAVE, AEROSTUDIO, SHIELD99, SWEEPER } from '../data/balance.js';
import { formatNumber } from './format.js';
import { getApp } from '../data/apps.js';
import { getCD } from '../data/cds.js';
import { getFile } from '../data/files.js';
import { getPlaylist } from '../data/playlists.js';
import { HARDWARE, nextTierOf } from '../data/hardware.js';
import * as econ from './economy.js';
import * as burner from './aeroburn.js';
import * as aerostudio from './aerostudio.js';
import { addBuff, pruneBuffs } from './buffs.js';
import * as lw from './lemonwire.js';
import * as shield from './shield99.js';
import * as sweeper from './sweeper.js';
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
    // A closed tab retires timed bonuses: buffs that ran out while away are
    // dropped, and a status event nobody could click is not held against them.
    pruneBuffs(state, now);
    state.chat.event = null;
    state.chat.nextEventIn = 0;
    resumeTutorial(state);

    const offline = econ.offlineEarnings(state, result.elapsedSeconds, now);
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
    const now = Date.now();

    grantBuzz(econ.buzzPerSecond(state, now) * dt, 'idle');
    state.bloat = Math.min(1, state.bloat + econ.bloatGain(state, dt));
    state.stats.playtimeSeconds += dt;

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

    if (shouldRevealHardware(state, econ.ramUsed(state), econ.ramCapacity(state))) {
      noticeBottleneck();
    }
    checkTutorial();

    if (now - lastSaveAt >= SAVE.autosaveMs) save();
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

  /** Buy chat buddies — the core spending sink (AO-9). */
  function buyBots(amount = 1) {
    const { count, cost } = econ.affordableBots(state, amount);
    if (count === 0) {
      const reason = state.chat.bots >= CHAT_BOT.maxPerRun ? 'buddy-list-full' : 'too-expensive';
      return { ok: false, reason };
    }

    const milestonesBefore = econ.chatMilestoneCount(state);
    state.buzz -= cost;
    state.chat.bots += count;
    bus.emit(EVENTS.BOT_BOUGHT, { count, cost });

    // Crossing a milestone is the reason to buy in bulk, so it gets announced.
    if (econ.chatMilestoneCount(state) > milestonesBefore) {
      bus.emit(EVENTS.MILESTONE, {
        at: econ.chatMilestoneCount(state) * CHAT_BOT.milestoneEvery,
        multiplier: econ.chatMilestoneMultiplier(state),
      });
    }
    return { ok: true, count, cost };
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
   */
  function extractQuarantine(itemId, { viaAd = false } = {}) {
    const now = Date.now();
    const check = shield.canExtract(state, itemId, { viaAd, now });
    if (!check.ok) return check;

    const threat = shield.getThreat(check.item.threatId);
    const reward = shield.rewardFor(threat, {
      fraction: viaAd ? 1 : SHIELD99.manualRewardFraction,
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
    state.hardware[track] += 1;
    bus.emit(EVENTS.HARDWARE_BOUGHT, { track, tier: next });
    save();
    return { ok: true, tier: next };
  }

  function startRender(projectName) {
    // Don't allow starting a new render while a reward is waiting to be claimed.
    if (state.aerostudio.pendingReward) return { ok: false, reason: 'pending-reward' };
    const result = aerostudio.startRender(state, projectName);
    if (result.ok) bus.emit(EVENTS.RENDER_STARTED, { projectName });
    return result;
  }

  /** Claim the deferred render reward (the player clicks "Collect"). */
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
    if (window.CrazyGames?.SDK?.game) {
      window.CrazyGames.SDK.game.happytime();
    }
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

  /** "Format C:" — wipe software, keep hardware, bank Dollars (GDD 5). */
  function formatC() {
    const dollars = econ.pendingPrestigeDollars(state);
    if (dollars <= 0) return { ok: false, reason: 'not-worth-it' };

    state = resetForPrestige(state, dollars, Date.now());
    bus.emit(EVENTS.PRESTIGE, { dollars });
    save();
    return { ok: true, dollars };
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
    setUsername,
    openApp,
    closeApp,
    installApp,
    buyBots,
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
    setSettings,
    currentTutorialStep: () => currentStep(state),
    buyHardware,
    startRender,
    cancelRender,
    claimRenderReward,
    buyAeroUpgrade,
    formatC,
    requestFormat,
    hardReset,
    doubleOfflineBuzz() {
      if (offlineReport?.buzz > 0) {
        grantBuzz(offlineReport.buzz, 'rewarded-ad');
        save();
      }
    },
    notify(title, body, tone = 'info') {
      bus.emit(EVENTS.NOTIFY, { title, body, tone });
    },
  };
}
