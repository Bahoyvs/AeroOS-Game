import { ALL_APPS, getApp } from '../data/apps.js';
import { ADS, NUDGE_JUICE } from '../data/balance.js';
import { formatDuration, formatNumber } from '../core/format.js';
import { clear, el, setBar, spawnTransient, throttle } from './dom.js';

/**
 * The desktop: icon grid plus the always-on-top Aero gadget that carries the
 * Buzz readout, the memory/bloat meters and the Nudge button (AO-5).
 */
export function createDesktop({ iconRoot, gadgetRoot, game, launch, ads = null }) {
  /* ---------------------------------------------------------------- icons */

  function renderIcons() {
    clear(iconRoot);
    for (const app of ALL_APPS) {
      if (!game.state.apps[app.id]?.installed) continue;
      /**
       * My Computer stays hidden until the first bottleneck reveals hardware
       * (GDD 7). Keyed off an explicit flag rather than off `system`, because
       * the Achievements window is also a system app and has nothing to do
       * with hardware — gating it here would hide the badge list from exactly
       * the new players its first badges are written for.
       */
      if (app.hiddenUntilHardware && !game.state.tutorial.hardwareRevealed) continue;

      const icon = el(
        'button',
        {
          class: 'desktop-icon',
          type: 'button',
          title: app.blurb,
          dataset: { appId: app.id },
          ondblclick: () => launch(app.id),
          onclick: (e) => {
            // Single tap launches on touch/PDA, double-click on desktop.
            if (e.detail === 0 || matchMedia('(pointer: coarse)').matches) launch(app.id);
          },
          onkeydown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') launch(app.id);
          },
        },
        [
          el('img', { class: 'desktop-icon__glyph', 'aria-hidden': 'true', src: app.icon, alt: '' }),
          el('span', { class: 'desktop-icon__label', text: app.name }),
        ],
      );
      iconRoot.appendChild(icon);
    }
  }

  /* --------------------------------------------------------------- gadget */

  /** How many cells the defrag animation draws. Cosmetic; see the note below. */
  const DEFRAG_BLOCKS = 32;

  const gadget = el('div', { class: 'gadget glass', role: 'complementary' }, []);
  gadget.innerHTML = `
    <div class="gadget__header">
      <span class="gadget__title">AeroOS</span>
      <span class="gadget__badge" data-role="prestige-badge" hidden>Format C: ready</span>
    </div>

    <div class="gadget__buzz">
      <span class="gadget__buzz-value" data-role="buzz">0</span>
      <span class="gadget__buzz-unit">Buzz</span>
    </div>
    <div class="gadget__rate" data-role="rate">0 / sec</div>

    <div class="meter" data-role="meter-ram" hidden>
      <div class="meter__label"><span>Memory</span><span data-role="ram-text">0 / 0</span></div>
      <div class="meter__track"><div class="meter__fill" data-role="ram-bar"></div></div>
    </div>

    <div class="meter" data-role="meter-bloat" hidden>
      <div class="meter__label"><span>System bloat</span><span data-role="bloat-text">0%</span></div>
      <div class="meter__track"><div class="meter__fill meter__fill--bloat" data-role="bloat-bar"></div></div>
    </div>

    <!--
      Auto-Defrag, while a pass is running. It is the one system in the game
      that quietly *takes* production, so it has to be visible while it does —
      a rate that dips 5% with nothing on screen to explain it is a bug report.
      The block grid is the old disk defragmenter, and it is decoration: the
      real progress is the bar under it.
    -->
    <div class="defrag" data-role="defrag" hidden>
      <div class="defrag__top">
        <span>Auto-Defrag</span>
        <span data-role="defrag-percent">0%</span>
      </div>
      <div class="defrag__blocks" aria-hidden="true"></div>
      <div class="meter__track"><div class="meter__fill defrag__fill" data-role="defrag-bar"></div></div>
    </div>

    <div class="heat" data-role="heat" hidden>
      <span class="heat__icon" aria-hidden="true">🌡</span>
      <span class="heat__value" data-role="heat-value">38°C</span>
      <span class="heat__track"><span class="heat__fill" data-role="heat-bar"></span></span>
    </div>

    <div class="gadget__offers" data-role="offers" hidden></div>

    <button type="button" class="nudge-button" data-role="nudge">
      <span class="nudge-button__label">NUDGE</span>
      <span class="nudge-button__hint" data-role="nudge-power">+1</span>
      <span class="nudge-button__streak" data-role="streak" hidden>
        <span class="nudge-button__streak-fill" data-role="streak-bar"></span>
      </span>
    </button>
    <p class="gadget__dollars" data-role="dollars">$0.00</p>
  `;
  gadgetRoot.appendChild(gadget);

  const ref = (role) => gadget.querySelector(`[data-role="${role}"]`);
  const nodes = {
    buzz: ref('buzz'),
    rate: ref('rate'),
    ramBar: ref('ram-bar'),
    ramText: ref('ram-text'),
    bloatBar: ref('bloat-bar'),
    bloatText: ref('bloat-text'),
    nudge: ref('nudge'),
    nudgePower: ref('nudge-power'),
    streak: ref('streak'),
    streakBar: ref('streak-bar'),
    dollars: ref('dollars'),
    prestigeBadge: ref('prestige-badge'),
    meterRam: ref('meter-ram'),
    meterBloat: ref('meter-bloat'),
    defrag: ref('defrag'),
    defragBar: ref('defrag-bar'),
    defragPercent: ref('defrag-percent'),
    heat: ref('heat'),
    heatValue: ref('heat-value'),
    heatBar: ref('heat-bar'),
  };

  /**
   * The block grid, built once and animated entirely in CSS: the cells are
   * identical and only their animation delay differs, so a pass costs the main
   * thread nothing per frame. Reduced motion switches it off through the
   * ordinary `data-motion` rule in tokens.css — the bar underneath still moves.
   */
  const blocksRoot = gadget.querySelector('.defrag__blocks');
  for (let i = 0; i < DEFRAG_BLOCKS; i += 1) {
    const block = el('i', { class: 'defrag__block' });
    block.style.setProperty('--i', String(i));
    blocksRoot.appendChild(block);
  }

  /**
   * PDA mode pins the gadget above the window stack and offsets windows by
   * `--gadget-height`. A hard-coded value is a guess, and when the content is
   * taller than the guess it spills over the window below — so publish the real
   * measured height instead and let the CSS follow it.
   */
  function publishGadgetHeight() {
    const height = Math.ceil(gadget.getBoundingClientRect().height);
    if (height > 0) {
      document.documentElement.style.setProperty('--gadget-height', `${height}px`);
    }
  }

  if (globalThis.ResizeObserver) {
    new ResizeObserver(publishGadgetHeight).observe(gadget);
  } else {
    window.addEventListener('resize', publishGadgetHeight);
  }
  requestAnimationFrame(publishGadgetHeight);

  function applyNudge(event) {
    const amount = game.nudge();
    spawnFloater(event, `+${formatNumber(amount)}`);
    // Rewind rather than remove/reflow/re-add: reading offsetWidth to restart an
    // animation forces a synchronous layout of the whole document, on the one
    // interaction the player performs fastest.
    nodes.nudge.classList.add('is-pressed');
    for (const animation of nodes.nudge.getAnimations()) {
      if (animation.animationName === 'nudge-shake') animation.currentTime = 0;
    }

    if (NUDGE_JUICE.visualEnabled) {
      const streak = game.econ.clickStreak(game.state);
      // Ice blue at the start of a streak, drifting toward neon green as it
      // builds — same ratio the streak meter under the button is reading.
      nodes.nudge.style.setProperty('--flare-hue', String(Math.round(200 - streak.ratio * 60)));
      flareUntil = performance.now() + 140;
      nodes.nudge.classList.add('is-flaring');

      spawnBubbles(nodes.nudge.getBoundingClientRect());
      spawnRipple(event.clientX, event.clientY);
    }
  }

  /**
   * Touch and pen go through `pointerdown`, not `click`.
   *
   * A `click` is synthesized from a touch only after the browser has decided
   * the gesture was a tap — and that synthesis is keyed to a single touch
   * sequence. Two fingers landing on the button close together (the standard
   * "drum" technique players use on any mobile clicker to beat their own tap
   * rate) are two independent touch points, but the browser reasons about
   * them as one ambiguous multi-touch gesture on the same element and can
   * drop the `click` for one or both — the exact "clicks stop registering
   * with a second finger" report this fixes. Pointer Events give each finger
   * its own `pointerId` and its own `pointerdown`, dispatched independently,
   * so both register.
   *
   * `preventDefault()` here stops the browser's follow-up compatibility
   * `click` for *this* touch, which is what keeps a tap from nudging twice.
   * It has no effect on real mouse input — a mouse `click` is not synthesized
   * from `pointerdown` — so the `click` listener below still owns the mouse
   * and keyboard (Space/Enter on a focused button) paths untouched.
   */
  nodes.nudge.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    event.preventDefault();
    applyNudge(event);
  });

  nodes.nudge.addEventListener('click', (event) => {
    applyNudge(event);
  });

  /* ---------------------------------------------------------- ad offers */

  /**
   * The two rewarded offers that belong on the desktop rather than inside an
   * app: an overclock for the button the whole game is built around, and the
   * daily sponsor gift. Both are here because the rewarded-ads guide is blunt
   * about it — offers have to be *easy to find*, and the gadget is the one
   * surface that is on screen in every session, on every device.
   *
   * The row renders nothing at all when ads cannot run (off-portal, or behind
   * an ad blocker): an offer that cannot be fulfilled is worse than no offer.
   * A cooling-down offer, by contrast, keeps its button and counts down — a
   * control that quietly disappears reads as a bug, and the player has no way
   * to learn it is coming back.
   */
  const offersRoot = ref('offers');
  const OFFERS = [
    {
      id: 'overclock',
      icon: '⚡',
      title: () =>
        `Overclock ×${(1 + ADS.rewarded.overclock.magnitude).toFixed(0)} · ${
          ADS.rewarded.overclock.durationSeconds / 60
        } min`,
    },
    {
      // "Free 38.8K Buzz" rather than "Sponsor gift": the guide asks for the
      // reward in the label, and the shorter string is also the one that fits
      // in a phone's status bar without being cut in half.
      id: 'gift',
      icon: '🎁',
      title: (offer) => `Free ${formatNumber(offer.reward.buzz)} Buzz`,
    },
  ];

  const offerButtons = new Map();

  if (ads?.available) {
    offersRoot.hidden = false;
    for (const offer of OFFERS) {
      const button = el('button', {
        type: 'button',
        class: 'ad-button gadget__offer',
        dataset: { offer: offer.id },
        onclick: async () => {
          button.disabled = true;
          await ads.claim(offer.id);
          updateOffers();
        },
      });
      offersRoot.appendChild(button);
      offerButtons.set(offer.id, button);
    }
  }

  function updateOffers() {
    if (offerButtons.size === 0) return;

    // Nothing is offered during onboarding. The first minutes decide whether
    // anybody comes back, and a scripted tour is no place for a sponsor button
    // competing with the objective the coach is pointing at.
    if (!game.state.tutorial.done) {
      offersRoot.hidden = true;
      return;
    }

    const now = Date.now();

    for (const meta of OFFERS) {
      const button = offerButtons.get(meta.id);
      const offer = game.adOffer(meta.id, now);

      // A cooling-down offer keeps its place and counts down. Anything else
      // that cannot be shown — the daily allowance is spent, nothing to boost —
      // is not coming back within the minute, so the row closes up instead of
      // holding a dead button open.
      const cooling = offer.reason === 'cooling-down';
      button.hidden = !offer.ok && !cooling;
      if (button.hidden) continue;

      button.disabled = !offer.ok;
      button.title = cooling
        ? 'Watched recently — this offer comes back on a timer.'
        : 'Watch a short video from a sponsor.';
      button.textContent = '';
      button.append(
        el('span', { class: 'ad-button__icon', 'aria-hidden': 'true', text: cooling ? '⏳' : meta.icon }),
        el('span', {
          class: 'ad-button__label',
          text: cooling
            ? `Ready in ${formatDuration(Math.ceil(offer.seconds))}`
            : meta.title(offer),
        }),
      );
    }

    offersRoot.hidden = [...offerButtons.values()].every((button) => button.hidden);
  }

  function spawnFloater(event, text) {
    const floater = el('span', { class: 'floater', text });
    floater.style.left = `${event.clientX}px`;
    floater.style.top = `${event.clientY}px`;
    document.body.appendChild(floater);
    setTimeout(() => floater.remove(), 900);
  }

  /* ------------------------------------------------------------ nudge juice */

  // When the flare's opacity transition should be back on its way to 0 —
  // checked on the ordinary 100ms `update()` tick rather than a `setTimeout`
  // per click, so a fast streak never queues up dozens of competing timers.
  let flareUntil = 0;

  // Hard cap across every bubble in flight at once (Faz 2.3): a fast streak
  // must not let particles pile up faster than their own animation clears
  // them, which is exactly the failure mode a low-end phone would feel first.
  let activeParticles = 0;

  function spawnBubbles(rect) {
    const budget = Math.min(NUDGE_JUICE.bubbleCount, NUDGE_JUICE.maxConcurrentParticles - activeParticles);
    for (let i = 0; i < budget; i += 1) {
      const size = 5 + Math.random() * 7;
      const bubble = el('span', { class: 'nudge-bubble' });
      bubble.style.width = `${size}px`;
      bubble.style.height = `${size}px`;
      bubble.style.left = `${rect.left + rect.width * (0.15 + Math.random() * 0.7) - size / 2}px`;
      bubble.style.top = `${rect.top + rect.height * (0.3 + Math.random() * 0.5) - size / 2}px`;
      bubble.style.setProperty('--drift', `${((Math.random() - 0.5) * 30).toFixed(1)}px`);
      bubble.style.animationDelay = `${Math.round(Math.random() * 60)}ms`;

      activeParticles += 1;
      spawnTransient(document.body, bubble);
      bubble.addEventListener('animationend', () => (activeParticles -= 1), { once: true });
    }
  }

  function spawnRipple(x, y) {
    const ripple = el('span', { class: 'nudge-ripple' });
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    spawnTransient(document.body, ripple);
  }

  /* --------------------------------------------------------------- update */

  // Once a second is plenty for a countdown measured in minutes, and the offer
  // row rebuilds its labels — that is not work for a 100 ms budget.
  const refreshOffers = throttle(updateOffers, 1000);

  const update = throttle(() => {
    const s = game.state;
    const { econ } = game;

    refreshOffers();

    nodes.buzz.textContent = formatNumber(s.buzz);
    nodes.rate.textContent = `${formatNumber(econ.buzzPerSecond(s))} / sec`;
    nodes.dollars.textContent = `$${s.dollars.toFixed(2)}`;

    /**
     * A sweeper combo is the one buff whose whole value is that the player
     * *notices* it: it multiplies clicks, it is short, and it is wasted if they
     * are looking at another window. So the button itself goes red and counts
     * down (Day 7). Everything else about it is an ordinary click buff.
     */
    const combo = econ.sweeperCombo(s);
    /**
     * The streak (CLICK.streak) is the button's own feedback loop: it exists so
     * that clicking *fast* looks different from clicking slowly, which it did
     * not for the whole of the opening minute. It is already inside
     * `clickPower()`, so the "+N" beside it climbs on its own — the meter is
     * there to show how much of it is left to lose.
     */
    const streak = econ.clickStreak(s);
    nodes.nudge.classList.toggle('is-combo', combo.active);
    nodes.nudge.classList.toggle('is-streaking', streak.active);
    nodes.streak.hidden = !streak.active;
    if (streak.active) setBar(nodes.streakBar, streak.ratio, { warn: 2, critical: 2 });

    if (NUDGE_JUICE.visualEnabled) {
      nodes.nudge.classList.toggle('is-flaring', performance.now() < flareUntil);
      // No shake keyframe is running before the streak crosses the threshold,
      // so toggling the class on is itself the restart — nothing to rewind.
      gadget.classList.toggle('is-nudge-shaking', streak.count >= NUDGE_JUICE.shakeStreakThreshold);
    }

    const power = `+${formatNumber(econ.clickPower(s))}`;
    nodes.nudgePower.textContent = combo.active
      ? `${power} · ×${combo.multiplier.toFixed(1)} for ${Math.ceil(combo.secondsLeft)}s`
      : streak.active
        ? `${power} · ×${streak.multiplier.toFixed(2)} streak`
        : power;

    const used = econ.ramUsed(s);
    const cap = econ.ramCapacity(s);
    nodes.ramText.textContent = `${used} / ${cap} MB`;
    setBar(nodes.ramBar, cap === 0 ? 0 : used / cap);

    nodes.bloatText.textContent = `${Math.round(s.bloat * 100)}%`;
    setBar(nodes.bloatBar, s.bloat, { warn: 0.6, critical: 0.85 });

    const revealed = s.tutorial.hardwareRevealed;
    nodes.meterRam.hidden = !revealed;
    nodes.meterBloat.hidden = !revealed;
    nodes.dollars.hidden = !revealed;

    // Only while a pass is actually running: an idle scheduler has nothing to
    // report, and a permanent strip in the gadget would cost the phone layout
    // a row of height for a system that fires once an hour.
    const defragging = econ.isDefragging(s);
    nodes.defrag.hidden = !defragging;
    if (defragging) {
      const progress = econ.defragProgress(s);
      nodes.defragPercent.textContent = `${Math.round(progress * 100)}%`;
      setBar(nodes.defragBar, progress, { warn: 2, critical: 2 });
    }

    // Heat is the escalation the player actually feels (AO-27).
    const heatLevel = econ.heatLevel(s);
    nodes.heat.hidden = !revealed;
    nodes.heatValue.textContent = `${econ.systemHeat(s)}°C`;
    nodes.heat.dataset.level = heatLevel;
    // Tone comes from the level on .heat, so the fill's own warn/critical
    // classes stay switched off.
    setBar(nodes.heatBar, econ.heatRatio(s), { warn: 2, critical: 2 });
    document.body.dataset.heat = heatLevel;

    const ready = econ.canPrestige(s);
    nodes.prestigeBadge.hidden = !ready;
    document.body.classList.toggle('is-bloated', econ.bloatLevel(s) !== 'ok');
    document.body.classList.toggle('is-critical', econ.bloatLevel(s) === 'critical');
  }, 100);

  game.bus.on(game.events.APP_INSTALLED, renderIcons);
  game.bus.on(game.events.PRESTIGE, renderIcons);
  game.bus.on(game.events.HARDWARE_REVEALED, renderIcons);

  renderIcons();
  updateOffers();
  update();

  return { update, renderIcons, appName: (id) => getApp(id).name };
}
