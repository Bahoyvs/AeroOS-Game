import { TUTORIAL_STEP_COUNT, currentStep, stepNumber } from '../core/tutorial.js';
import { GOAL_COUNT, goalStatus, goalsCompleted } from '../core/goals.js';
import { formatNumber } from '../core/format.js';
import { createSpotlight } from './spotlight.js';
import { setBar, throttle } from './dom.js';

/**
 * The coach (AO-12), in two lives.
 *
 * **During the tour** it is the scripted onboarding: one objective at a time,
 * paired with a spotlight that dims the desktop and points an arrow at the
 * control the objective is about. It never blocks input and it can be skipped
 * outright — a tutorial that traps a returning player is worse than no
 * tutorial.
 *
 * **After the tour** it does not disappear. It becomes "Next up": the single
 * next goal from `core/goals.js` with a progress bar under it. The desktop used
 * to go quiet the moment the fifth step completed, which is precisely when a
 * new player has learned enough to want a target and has none — and an idle
 * game with no bar filling on screen has ended, whether or not it says so.
 */

/**
 * Where the spotlight points for each scripted step.
 *
 * Resolvers, not selectors, because two of the steps have a fallback: the
 * player is sent to the Start menu, and where the arrow belongs depends on
 * whether the menu is currently open. Returning `null` hides the spotlight,
 * which is the right answer when the window it wants has been closed.
 */
const TARGETS = {
  nudge: () => document.querySelector('.nudge-button'),

  'first-buddy': () => document.querySelector('.window[data-app-id="aerochat"] [data-buy="1"]'),

  'install-retroamp': () =>
    document.querySelector('.start-menu:not([hidden]) .start-menu__item[data-app-id="retroamp"]') ??
    document.querySelector('.start-button'),

  'load-playlist': () =>
    document.querySelector('.window[data-app-id="retroamp"] [data-playlist-id="soft-signals"]') ??
    document.querySelector('.desktop-icon[data-app-id="retroamp"]'),

  bottleneck: () =>
    document.querySelector('.window[data-app-id="retroamp"] [data-playlist-id="iron-overdrive"]') ??
    document.querySelector('.desktop-icon[data-app-id="retroamp"]'),
};

export function createTutorialCoach({ root, game }) {
  const panel = document.createElement('aside');
  panel.className = 'coach glass';
  panel.setAttribute('aria-live', 'polite');
  panel.innerHTML = `
    <div class="coach__head">
      <span class="coach__label" data-role="label">Getting started</span>
      <span class="coach__progress" data-role="progress"></span>
    </div>
    <strong class="coach__title" data-role="title"></strong>
    <p class="coach__hint" data-role="hint"></p>
    <div class="coach__meter" data-role="meter" hidden>
      <div class="meter__track"><div class="meter__fill" data-role="bar"></div></div>
      <small class="coach__detail" data-role="detail"></small>
    </div>
    <button type="button" class="coach__skip" data-role="skip">Skip the tour</button>
  `;
  root.appendChild(panel);

  const ref = (role) => panel.querySelector(`[data-role="${role}"]`);
  const spotlight = createSpotlight({ root: document.body });

  ref('skip').addEventListener('click', () => {
    game.skipOnboarding();
    spotlight.clear();
    update();
  });

  let shownKey = null;

  /** The scripted tour: coach copy plus an arrow on the thing to click. */
  function renderStep(step) {
    ref('label').textContent = 'Getting started';
    ref('skip').hidden = false;
    ref('meter').hidden = true;

    if (step.id !== shownKey) {
      shownKey = step.id;
      ref('title').textContent = step.title;
      ref('hint').textContent = step.hint;
      ref('progress').textContent = `${stepNumber(game.state)} / ${TUTORIAL_STEP_COUNT}`;
      panel.classList.remove('is-new');
      void panel.offsetWidth;
      panel.classList.add('is-new');
    }

    spotlight.point(TARGETS[step.id]?.() ?? null, step.cta ?? '');
  }

  /**
   * After the tour. No spotlight here on purpose: the arrow is a teaching
   * device for someone who does not know where anything is, and pointing at
   * the Start button for the rest of the session would be nagging rather than
   * coaching.
   */
  function renderGoal(goal) {
    spotlight.clear();
    ref('label').textContent = 'Next up';
    ref('skip').hidden = true;
    ref('meter').hidden = false;

    if (goal.id !== shownKey) {
      shownKey = goal.id;
      ref('title').textContent = goal.title;
      ref('hint').textContent = goal.hint;
      panel.classList.remove('is-new');
      void panel.offsetWidth;
      panel.classList.add('is-new');
    }

    ref('progress').textContent = `${goalsCompleted(game.state)} / ${GOAL_COUNT}`;
    ref('detail').textContent = goal.detail;
    // The bar is a target, not a warning: a nearly-full objective is good news,
    // so the warn/critical tones are switched off.
    setBar(ref('bar'), goal.progress, { warn: 2, critical: 2 });
  }

  const update = throttle(() => {
    const step = currentStep(game.state);
    if (step) {
      panel.hidden = false;
      renderStep(step);
      return;
    }

    const goal = goalStatus(game.state, { formatNumber });
    if (!goal) {
      // Everything on the list is done. Nothing left to point at, and a coach
      // repeating its last objective forever is worse than a quiet desktop.
      panel.hidden = true;
      spotlight.clear();
      return;
    }
    panel.hidden = false;
    renderGoal(goal);
  }, 200);

  update();
  return {
    update,
    /** Keeps the ring on a target that moved between throttled updates. */
    refreshSpotlight: () => spotlight.update(),
  };
}
