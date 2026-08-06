import { ADS } from '../data/balance.js';
import { el } from './dom.js';

/**
 * The ad adapter (GDD 8) — every call into the portal's ad SDK, in one file.
 *
 * Before this existed the SDK was called from four different modules, each with
 * its own idea of whether to stop gameplay, what to do when an ad failed, and
 * whether the button should have been there at all. That is how a placement
 * quietly stops working: not by throwing, but by resolving nothing on a portal
 * where ads are blocked.
 *
 * Four rules the whole file is built around, all of them from the portal's
 * checklist:
 *
 * 1. **A reward is granted on `adFinished` and nowhere else.** `adError` pays
 *    nothing — it says so and leaves the offer where it was.
 * 2. **There is always a way to play without ads.** Every placement here is a
 *    bonus on top of a mechanic that already works; the one lootbox that gates
 *    a payout (Shield99's quarantine) keeps its non-ad path at a fraction.
 * 3. **Ad blockers are a supported configuration, not an error.** If ads cannot
 *    run, the buttons are not rendered at all — an offer that cannot be
 *    fulfilled is worse than no offer.
 * 4. **Interstitials announce themselves.** An idle game has no level boundary
 *    to hide a break behind, so a countdown swallows clicks for three seconds
 *    first. Without it the ad lands mid-Nudge and reads as a click trap.
 *
 * The SDK paces midgame ads itself (one per three minutes, with its own
 * safeguards around game start and rewarded ads) and the guide asks games not
 * to add a second cooldown, so we do not: `midgame()` is called at every
 * natural break and the portal decides. What we *do* gate is the first session,
 * which is the one thing the portal cannot know.
 */

/** How long a countdown digit is on screen. */
const COUNTDOWN_STEP_MS = 1000;

export function createAds({ sdk = null, game, notify = () => {}, root = document.body } = {}) {
  const sessionStartedAt = Date.now();

  let adblocked = false;
  let busy = false;
  let lastRewardedAt = 0;
  let lastBannerAt = 0;
  let bannerId = 0;

  /**
   * Ad-blocker detection. Best-effort and non-fatal: an SDK that does not
   * answer is treated as "ads work", because rendering no buttons on a portal
   * where ads would have played is the more expensive mistake.
   */
  async function init() {
    if (!sdk?.ad) return { available: false, adblocked: false };
    try {
      adblocked = (await sdk.ad.hasAdblock?.()) === true;
    } catch (err) {
      console.warn('[ads] adblock check failed; assuming ads are available', err);
    }
    if (adblocked) console.info('[aeroos] ad blocker detected; ad offers are hidden');
    return { available: available(), adblocked };
  }

  /** True when an ad could actually play. Every ad button checks this first. */
  function available() {
    return Boolean(sdk?.ad) && !adblocked;
  }

  /* --------------------------------------------------------------- rewarded */

  /**
   * Show a rewarded video. Resolves `true` only when the portal reports the ad
   * was watched to the end — the caller pays out on `true` and on nothing else.
   *
   * Gameplay is stopped for the duration, which is what mutes the game around
   * the break: `ui/audio.js` already follows the portal's audio setting, so
   * nothing plays out underneath the video.
   */
  function rewarded(placement = 'reward') {
    if (!available() || busy) return Promise.resolve(false);
    busy = true;

    return new Promise((resolve) => {
      let settled = false;
      const finish = (watched) => {
        if (settled) return;
        settled = true;
        busy = false;
        if (watched) lastRewardedAt = Date.now();
        try {
          sdk.game?.gameplayStart?.();
        } catch {
          /* the portal is gone; the game keeps running either way */
        }
        resolve(watched);
      };

      try {
        sdk.game?.gameplayStop?.();
        sdk.ad.requestAd('rewarded', {
          adStarted: () => {},
          adFinished: () => finish(true),
          adError: (err) => {
            // Blocked, unfilled, or closed early. Say so once, plainly: the
            // player pressed a button and is owed an explanation, not silence.
            console.info(`[ads] rewarded ad for "${placement}" did not complete`, err);
            notify({
              title: 'No sponsor available',
              body: 'The video could not be played, so nothing was charged or awarded. Try again in a bit.',
              tone: 'warn',
            });
            finish(false);
          },
        });
      } catch (err) {
        console.warn('[ads] rewarded request threw', err);
        finish(false);
      }
    });
  }

  /**
   * Watch an ad and take the reward it was offered for — the path every
   * rewarded button in the game uses.
   *
   * The offer is checked twice on purpose: once here, so a capped or
   * cooling-down placement never costs the player 30 seconds for nothing, and
   * again inside `game.claimAdReward` after the video, because a minute passed
   * and the render they were boosting may have finished in the meantime.
   */
  async function claim(id) {
    if (!available()) return false;
    if (!game.adOffer(id).ok) return false;

    const watched = await rewarded(id);
    if (!watched) return false;

    return game.claimAdReward(id).ok;
  }

  /* ---------------------------------------------------------------- midgame */

  /**
   * The one thing the SDK's pacing cannot know: whether this player has learned
   * the game yet. An interstitial in the first few minutes costs a retained
   * player, and a retained player is worth more than the impression.
   */
  function midgameAllowed() {
    if (!available() || busy) return false;
    const s = game.state;
    const { midgame } = ADS;

    if (midgame.requireTutorialDone && !s.tutorial.done) return false;
    if (s.stats.playtimeSeconds < midgame.minPlaytimeSeconds) return false;
    if (Date.now() - sessionStartedAt < midgame.minSessionSeconds * 1000) return false;
    if (Date.now() - lastRewardedAt < midgame.afterRewardedSeconds * 1000) return false;
    return true;
  }

  /**
   * The warning card. Three seconds of "hands off", and it eats clicks while it
   * runs so the last frantic Nudge cannot land on the ad that replaces it.
   */
  function countdown(seconds) {
    return new Promise((resolve) => {
      const value = el('strong', { class: 'ad-countdown__count', text: String(seconds) });
      const shade = el('div', { class: 'ad-countdown', role: 'status', 'aria-live': 'polite' }, [
        el('div', { class: 'ad-countdown__card' }, [
          el('span', { class: 'ad-countdown__icon', 'aria-hidden': 'true', text: '📺' }),
          el('p', { class: 'ad-countdown__lede' }, [document.createTextNode('Ad break in '), value]),
          el('small', {
            class: 'ad-countdown__note',
            text: 'Hands off the mouse — your progress is already saved.',
          }),
        ]),
      ]);
      root.appendChild(shade);

      let left = seconds;
      const timer = setInterval(() => {
        left -= 1;
        if (left > 0) {
          value.textContent = String(left);
          return;
        }
        clearInterval(timer);
        shade.remove();
        resolve();
      }, COUNTDOWN_STEP_MS);
    });
  }

  /**
   * Request an interstitial at a natural break. Never awaited for a result:
   * the caller carries on whether or not an ad played, because the portal may
   * simply decide it is too soon.
   *
   * `options.silent` skips the countdown for breaks that already *are* a pause
   * with a screen in front of them — the Format C: stop screen, where the game
   * is visibly not running and a second warning would be noise.
   */
  async function midgame(reason, { silent = false } = {}) {
    if (!midgameAllowed()) return false;
    busy = true;

    try {
      if (!silent) await countdown(ADS.midgame.countdownSeconds);
      return await new Promise((resolve) => {
        let settled = false;
        const finish = (shown) => {
          if (settled) return;
          settled = true;
          try {
            sdk.game?.gameplayStart?.();
          } catch {
            /* nothing to resume */
          }
          resolve(shown);
        };

        sdk.game?.gameplayStop?.();
        sdk.ad.requestAd('midgame', {
          adStarted: () => {},
          adFinished: () => finish(true),
          // Unfilled or too soon by the portal's own pacing. Silent by design:
          // the player did not ask for this, so they are not owed a balloon
          // about an ad that never played.
          adError: () => finish(false),
        });
      });
    } catch (err) {
      console.warn(`[ads] midgame request for "${reason}" threw`, err);
      return false;
    } finally {
      busy = false;
    }
  }

  /* ----------------------------------------------------------------- banner */

  /**
   * Attach a banner to a container — shop and menu surfaces only, never the
   * desktop itself. Returns a handle whose `clear()` the caller must run when
   * the surface goes away; a banner left in a closed window is an impression
   * nobody can see and a slot the portal will not refill.
   *
   * The refresh cooldown is respected here rather than at the call sites: a
   * window that is opened and closed five times in a minute asks for one ad,
   * and asking more often is a policy violation, not a bigger number.
   */
  function banner(container, { width = ADS.banner.minWidth, height = ADS.banner.minHeight } = {}) {
    const empty = { ok: false, clear() {} };
    if (!available() || !sdk.banner || !container) return empty;

    const now = Date.now();
    if (now - lastBannerAt < ADS.banner.refreshSeconds * 1000) return empty;
    lastBannerAt = now;

    bannerId += 1;
    const id = `aeroos-banner-${bannerId}`;
    container.id = id;

    try {
      // Responsive first: it picks a size that fits the container, which is the
      // only thing that works across a phone sheet and a wide desktop window.
      if (typeof sdk.banner.requestResponsiveBanner === 'function') {
        sdk.banner.requestResponsiveBanner([id]);
      } else {
        sdk.banner.requestBanner({ id, width, height });
      }
    } catch (err) {
      console.info('[ads] banner request failed', err);
      return empty;
    }

    return {
      ok: true,
      clear() {
        try {
          sdk.banner.clearBanner?.(id);
        } catch {
          /* the slot went away with the window */
        }
      },
    };
  }

  return {
    init,
    claim,
    rewarded,
    midgame,
    banner,
    get available() {
      return available();
    },
    get adblocked() {
      return adblocked;
    },
    /** True while an ad is on screen — used to keep two from overlapping. */
    get busy() {
      return busy;
    },
  };
}
