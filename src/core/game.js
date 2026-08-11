import { ADS, BUILDING, CLICK, DEFRAG, SAVE, SWEEPER } from '../data/balance.js';
import { formatNumber } from './format.js';
import { getApp } from '../data/apps.js';
import { hasBuilding } from '../data/buildings.js';
import { applyLegacyLevel } from './legacy.js';
import { getPlaylist } from '../data/playlists.js';
import { HARDWARE, nextTierOf } from '../data/hardware.js';
import * as econ from './economy.js';
import * as ads from './ads.js';
import { addBuff, pruneBuffs } from './buffs.js';
import * as cosmetics from './cosmetics.js';
import * as defrag from './defrag.js';
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
    // The Legacy accumulator (GDD §2.6). Every Buzz the player has ever earned
    // passes through here exactly once, which is what makes it trustworthy —
    // and unlike `lifetimeBuzz`, nothing ever settles against it.
    state.allTimeBuzz += amount;
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





    // AeroSweeper tokens refill whether or not the tab was open — wall clock.
    const tokens = sweeper.updateTokens(state, now);
    if (tokens > 0) {
      bus.emit(EVENTS.SWEEPER_TOKEN, { granted: tokens, tokens: state.sweeper.tokens, bought: false });
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
    announceCosmetics();

    if (now - lastSaveAt >= SAVE.autosaveMs) save();
    bus.emit(EVENTS.TICK, { state, dt });
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

  /**
   * The sunset refund screen has been shown (GDD §11). Clearing the field is
   * what makes it a one-time message rather than a permanent save entry, and it
   * is an action rather than a UI-side delete because the UI never writes state.
   */
  function acknowledgeSunsetRefund() {
    if (!(state.sunsetRefund > 0)) return { ok: false, reason: 'nothing-pending' };
    const refund = state.sunsetRefund;
    delete state.sunsetRefund;
    save();
    return { ok: true, refund };
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
   * Buy units of a building — the core spending sink, and the only one there is
   * (GDD §2.2: the manual upgrade shops are gone).
   *
   * Every one of the twelve goes through this single action. A window dresses
   * the purchase up as whatever its era would have called it — an Add Contact
   * wizard, a `[+ ADD]` button, a `> execute payload.exe` prompt — but there is
   * one code path underneath, so no building can drift into having its own
   * pricing rules.
   */
  function buyUnits(buildingId, amount = 1) {
    if (!hasBuilding(buildingId)) return { ok: false, reason: 'unknown-building' };
    if (!econ.isBuildingUnlocked(state, buildingId)) return { ok: false, reason: 'locked' };

    const { count, cost } = econ.affordableUnits(state, buildingId, amount);
    if (count === 0) {
      const reason = econ.unitsOf(state, buildingId) >= BUILDING.maxUnits ? 'full' : 'too-expensive';
      return { ok: false, reason };
    }

    const before = econ.unitsOf(state, buildingId);
    state.buzz -= cost;
    state.buildings[buildingId].units = before + count;
    const after = state.buildings[buildingId].units;
    bus.emit(EVENTS.UNITS_BOUGHT, { id: buildingId, count, cost, units: after });

    /**
     * Crossing a milestone is the reason to buy in bulk, so it gets announced —
     * and under the redesign it is also the *only* thing a purchase can trigger,
     * since there is nothing to decide afterwards. The window turns this into
     * its 2-3 second celebration (GDD §2.3); the simulation just says it landed.
     */
    if (econ.crossedMilestone(before, after)) {
      bus.emit(EVENTS.MILESTONE, {
        id: buildingId,
        at: BUILDING.milestones[econ.milestoneIndex(after)].at,
        multiplier: econ.milestoneMultiplier(after),
      });
    }
    return { ok: true, count, cost, units: after };
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



  /**
   * Is a rewarded offer worth showing, and what does it pay?
   *
   * Two gates, deliberately kept apart: `core/ads.js` owns *pacing* (daily
   * allowance, cooldown) and knows nothing about the game; this function owns
   * *context* — there is no point offering a payout boost on a Format C: that
   * is not ready, or a token to a player whose tokens are full. The UI calls it
   * to label a button, and `claimAdReward` calls it again to make sure the
   * offer was still valid by the time the video finished.
   */
  function adOffer(id, now = Date.now()) {
    const paced = ads.canWatch(state, id, now);
    if (!paced.ok) return paced;

    if (id === 'sweeperToken' && state.sweeper.tokens >= SWEEPER.maxTokens) {
      return { ok: false, reason: 'tokens-full' };
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
   * browser API and core does not touch it. Everything it can hand out is an
   * existing system: a buff, a Buzz grant, a sweeper token. Nothing here is a
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

    /**
     * The Legacy Level applies the moment the wipe completes, with nothing to
     * buy and nothing to confirm (GDD §2.6). The multiplier does not actually
     * wait for this — it is derived from `allTimeBuzz` on every read — so what
     * happens here is that the number is *stamped and reported*, which is what
     * lets the POST sequence say "Legacy Level 3 applied" and be telling the
     * truth rather than performing a purchase the player never made.
     */
    const legacy = applyLegacyLevel(state);

    bus.emit(EVENTS.PRESTIGE, { dollars, bonus, legacy });
    save();
    return { ok: true, dollars, bonus, legacy };
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
    acknowledgeSunsetRefund,
    buyUnits,
    claimStatusBonus,
    loadPlaylist,
    ejectPlaylist,
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
