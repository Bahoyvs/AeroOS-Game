import { describe, expect, it } from 'vitest';
import * as ads from '../src/core/ads.js';
import * as econ from '../src/core/economy.js';
import { createGame } from '../src/core/game.js';
import { createMemoryStorage } from '../src/core/save.js';
import { createInitialState, resetForPrestige } from '../src/core/state.js';
import { ADS, PRESTIGE } from '../src/data/balance.js';

const DAY = 86_400_000;
const newGame = () => createGame({ storage: createMemoryStorage() });

/** A machine that actually produces something, so rewards are non-zero. */
function producing(game, bots = 50) {
  game.state.chat.bots = bots;
  game.state.apps.aerochat.open = true; // buddies only pay while the window is open
  return game;
}

describe('daily allowances', () => {
  it('counts watches against today and rolls over on the next UTC day', () => {
    const s = createInitialState(0);

    ads.markWatched(s, 'gift', 0);
    ads.markWatched(s, 'gift', 1000);
    expect(ads.watchedToday(s, 'gift', 1000)).toBe(2);

    // Nothing has to run while the tab is closed: a later day simply reads as
    // a fresh allowance.
    expect(ads.watchedToday(s, 'gift', DAY)).toBe(0);
    expect(ads.watchesLeft(s, 'gift', DAY)).toBe(ADS.rewarded.gift.perDay);
  });

  it('refuses a placement once its daily allowance is spent', () => {
    const s = createInitialState(0);
    for (let i = 0; i < ADS.rewarded.gift.perDay; i += 1) {
      ads.markWatched(s, 'gift', i);
    }
    const check = ads.canWatch(s, 'gift', ADS.rewarded.gift.cooldownSeconds * 1000);
    expect(check).toMatchObject({ ok: false, reason: 'daily-cap' });
  });

  it('keeps a cooldown running across the day boundary', () => {
    const s = createInitialState(0);
    const justBeforeMidnight = DAY - 1000;
    ads.markWatched(s, 'overclock', justBeforeMidnight);

    // A fresh allowance, but the wall-clock cooldown is still burning down —
    // the rollover clears counters, never timers.
    expect(ads.watchedToday(s, 'overclock', DAY)).toBe(0);
    expect(ads.canWatch(s, 'overclock', DAY)).toMatchObject({ ok: false, reason: 'cooling-down' });
    expect(ads.canWatch(s, 'overclock', DAY + ADS.rewarded.overclock.cooldownSeconds * 1000).ok).toBe(
      true,
    );
  });
});

describe('reward sizing', () => {
  it('pays the daily gift less each time it is taken', () => {
    const s = createInitialState(0);
    const paid = [];
    for (let i = 0; i < ADS.rewarded.gift.seconds.length; i += 1) {
      paid.push(ads.giftSeconds(s, 0));
      ads.markWatched(s, 'gift', 0);
    }
    expect(paid).toEqual(ADS.rewarded.gift.seconds);
    // Past the end of the table the floor holds rather than throwing.
    expect(ads.giftSeconds(s, 0)).toBe(ADS.rewarded.gift.seconds.at(-1));
  });

  it('scales the gift with what the player currently produces', () => {
    const small = ads.rewardFor(createInitialState(0), 'gift', { buzzPerSecond: 1 });
    const large = ads.rewardFor(createInitialState(0), 'gift', { buzzPerSecond: 1000 });
    expect(large.buzz).toBeCloseTo(small.buzz * 1000);
    expect(small.buzz).toBeGreaterThan(0);
  });
});

describe('offers know what the game is doing', () => {
  it('does not offer a render skip with no render running', () => {
    const game = newGame();
    expect(game.adOffer('renderBoost')).toMatchObject({ ok: false, reason: 'not-rendering' });

    game.startRender('Argent Metal OST');
    expect(game.adOffer('renderBoost').ok).toBe(true);
  });

  it('does not offer a sweeper token when the player is already full', () => {
    const game = newGame();
    expect(game.adOffer('sweeperToken')).toMatchObject({ ok: false, reason: 'tokens-full' });

    game.state.sweeper.tokens = 0;
    expect(game.adOffer('sweeperToken').ok).toBe(true);
  });

  it('only offers the payout boost when a Format C: is actually worth something', () => {
    const game = newGame();
    expect(game.adOffer('formatBoost')).toMatchObject({ ok: false, reason: 'not-worth-it' });

    game.state.lifetimeBuzz = PRESTIGE.minLifetimeBuzz * 100;
    expect(game.adOffer('formatBoost').ok).toBe(true);

    // ...and never twice for the same wipe.
    game.claimAdReward('formatBoost');
    expect(game.adOffer('formatBoost')).toMatchObject({ ok: false, reason: 'already-boosted' });
  });
});

describe('paying out', () => {
  it('grants the gift as Buzz and records the watch', () => {
    const game = producing(newGame());
    const before = game.state.buzz;

    const result = game.claimAdReward('gift');
    expect(result.ok).toBe(true);
    expect(game.state.buzz - before).toBeCloseTo(result.reward.buzz);
    expect(game.state.ads.totalWatched).toBe(1);
  });

  it('applies the overclock as an ordinary expiring buff', () => {
    const game = producing(newGame());
    const now = Date.now();
    const before = econ.buzzPerSecond(game.state, now);

    game.claimAdReward('overclock', now);
    const boosted = econ.buzzPerSecond(game.state, now);
    expect(boosted / before).toBeCloseTo(1 + ADS.rewarded.overclock.magnitude);

    // It is a buff, so it runs out — nothing here is permanent.
    const after = now + (ADS.rewarded.overclock.durationSeconds + 1) * 1000;
    expect(econ.buzzPerSecond(game.state, after)).toBeCloseTo(before);
  });

  it('refuses to pay twice inside a cooldown', () => {
    const game = producing(newGame());
    const now = Date.now();
    expect(game.claimAdReward('overclock', now).ok).toBe(true);
    expect(game.claimAdReward('overclock', now + 1000)).toMatchObject({
      ok: false,
      reason: 'cooling-down',
    });
  });

  it('hands the sweeper a real token', () => {
    const game = newGame();
    game.state.sweeper.tokens = 0;
    expect(game.claimAdReward('sweeperToken').ok).toBe(true);
    expect(game.state.sweeper.tokens).toBe(1);
  });

  it('doubles offline Buzz, and refuses a second helping of the same report', () => {
    const storage = createMemoryStorage();
    const first = producing(createGame({ storage }));
    first.state.apps.aerochat.open = true;
    first.save();

    // Rewind the stored timestamp by an hour to simulate a closed tab.
    const stored = JSON.parse(storage.getItem('aeroos.save.v1'));
    stored.lastSeen -= 3_600_000;
    storage.setItem('aeroos.save.v1', JSON.stringify(stored));

    const second = createGame({ storage });
    const { offline } = second.load();
    const banked = second.state.buzz;

    const doubled = second.doubleOfflineBuzz();
    expect(doubled.ok).toBe(true);
    expect(doubled.buzz).toBeCloseTo(offline.buzz * (ADS.rewarded.offlineDouble.multiplier - 1));
    expect(second.state.buzz).toBeCloseTo(banked + doubled.buzz);

    // The report is one dialog's worth of state; once the dialog is gone there
    // is nothing left to multiply.
    second.clearOfflineReport();
    expect(second.doubleOfflineBuzz()).toMatchObject({ ok: false, reason: 'nothing-to-double' });
  });
});

describe('the Format C: payout boost', () => {
  it('pays the bonus without borrowing it from the next prestige', () => {
    const game = newGame();
    game.state.lifetimeBuzz = PRESTIGE.minLifetimeBuzz * 100;

    const plain = econ.pendingPrestigeDollars(game.state);
    game.claimAdReward('formatBoost');

    const result = game.formatC();
    expect(result.dollars).toBeCloseTo(plain);
    expect(result.bonus).toBeCloseTo(plain * (ADS.rewarded.formatBoost.multiplier - 1), 1);
    expect(game.state.dollars).toBeCloseTo(result.dollars + result.bonus, 1);

    // The whole point of paying it as a bonus: the next payout is unaffected,
    // rather than being the boost quietly taken back.
    expect(game.state.dollarsEarnedTotal).toBeCloseTo(plain);
    expect(econ.pendingPrestigeDollars(game.state)).toBe(0);
  });

  it('is spent by the wipe it was bought for', () => {
    const game = newGame();
    game.state.lifetimeBuzz = PRESTIGE.minLifetimeBuzz * 100;
    game.claimAdReward('formatBoost');
    game.formatC();
    expect(game.state.ads.formatBoost).toBe(false);
  });

  it('carries daily allowances through a Format C:', () => {
    const s = createInitialState(0);
    ads.markWatched(s, 'gift', 0);
    s.lifetimeBuzz = PRESTIGE.minLifetimeBuzz * 100;

    // Otherwise a player could reset their daily caps by pressing Format C:,
    // which is not a cap.
    const after = resetForPrestige(s, 10, 0);
    expect(ads.watchedToday(after, 'gift', 0)).toBe(1);
  });
});
