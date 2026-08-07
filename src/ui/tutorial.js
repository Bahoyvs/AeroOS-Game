import { TUTORIAL_STEP_COUNT, currentStep, stepGate, stepNumber } from '../core/tutorial.js';
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
 * Is this element actually on screen where the player could touch it?
 *
 * Existing in the DOM is not enough, and on a phone it is barely a hint. PDA
 * mode makes every window a full-screen sheet, so a desktop icon, a background
 * window's controls and a minimised app all keep perfectly good rects while
 * being completely buried — and a ring drawn around a buried control points at
 * whatever happens to be on top of it, which is how a tutorial ends up
 * apparently telling the player to press the coach panel.
 *
 * `elementFromPoint` answers the real question: what would a tap here hit? It
 * ignores `pointer-events: none`, so the spotlight's own layer never shows up
 * as the answer.
 */
function reachable(node) {
  if (!node?.isConnected) return null;
  const rect = node.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  if (rect.bottom < 0 || rect.top > window.innerHeight) return null;

  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  if (!hit) return null;
  // Either direction counts: the hit may be a label inside the button, or the
  // button inside a wrapper we were handed.
  return node.contains(hit) || hit.contains(node) ? node : null;
}

const q = (selector) => () => document.querySelector(selector);

/** First candidate the player could actually press, or null. */
const firstReachable =
  (...candidates) =>
  () => {
    for (const candidate of candidates) {
      const found = reachable(candidate());
      if (found) return found;
    }
    return null;
  };

/**
 * Where the spotlight points for each scripted step.
 *
 * Resolvers, not selectors, because most steps have a fallback: the player is
 * sent to the Start menu, and where the arrow belongs depends on whether the
 * menu is open, whether the app's window is in front, and — on a phone —
 * whether the desktop is visible at all. Returning `null` hides the spotlight,
 * which is the right answer when nothing it wants is on screen.
 */
const TARGETS = {
  nudge: q('.nudge-button'),

  'first-buddy': firstReachable(
    q('.window[data-app-id="aerochat"] [data-buy="1"]'),
    q('.desktop-icon[data-app-id="aerochat"]'),
  ),

  'install-retroamp': firstReachable(
    q('.start-menu:not([hidden]) .start-menu__item[data-app-id="retroamp"]'),
    q('.start-button'),
  ),

  'load-playlist': firstReachable(
    q('.window[data-app-id="retroamp"] [data-playlist-id="soft-signals"]'),
    q('.desktop-icon[data-app-id="retroamp"]'),
    q('.task[data-app-id="retroamp"]'),
  ),

  bottleneck: firstReachable(
    q('.window[data-app-id="retroamp"] [data-playlist-id="iron-overdrive"]'),
    q('.desktop-icon[data-app-id="retroamp"]'),
    q('.task[data-app-id="retroamp"]'),
  ),

  // The desktop icon first, then the Start menu's own My Computer row, then
  // the "Computer" system link, then Start itself — which is the chain a phone
  // actually walks, since a full-screen sheet is sitting on the icon.
  'my-computer': firstReachable(
    q('.desktop-icon[data-app-id="system"]'),
    q('.start-menu:not([hidden]) .start-menu__item[data-app-id="system"]'),
    q('.start-menu:not([hidden]) .start-menu__sys-btn[data-app-id="system"]'),
    q('.start-button'),
  ),
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

  /**
   * Publish the panel's measured height, the same way the gadget publishes its
   * own (`ui/desktop.js`).
   *
   * In PDA mode this is not decoration. A window is a full-screen sheet, the
   * coach is pinned to the bottom of the screen, and the coach used to be drawn
   * straight over the sheet's last hundred pixels — which is where AeroChat
   * keeps its buy row and AeroSweeper its cash-out button. The tutorial was
   * covering the very control it was pointing at. The stylesheet reserves this
   * height instead of overlaying it, so it has to be the real number and not a
   * guess: the panel's height changes with the objective, with the meter
   * appearing and disappearing, and with how the hint wraps.
   */
  function publishHeight() {
    const height = panel.hidden ? 0 : Math.ceil(panel.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--coach-height', `${height}px`);
  }

  if (globalThis.ResizeObserver) {
    new ResizeObserver(publishHeight).observe(panel);
  } else {
    window.addEventListener('resize', publishHeight);
  }
  requestAnimationFrame(publishHeight);

  ref('skip').addEventListener('click', () => {
    game.skipOnboarding();
    spotlight.clear();
    update();
  });

  let shownKey = null;

  /**
   * The scripted tour: coach copy plus an arrow on the thing to click.
   *
   * Unless the player cannot afford the thing yet, in which case the objective
   * is replaced by the shortfall that is blocking it. Pointing an arrow at a
   * button somebody has 1 Buzz for, and calling that a tutorial step, is how
   * the first minute used to dead-end — so the arrow goes back to the Nudge
   * button, which is the answer to every version of this question, and the
   * meter shows how much further there is to go.
   */
  function renderStep(step) {
    const gate = stepGate(game.state);
    ref('label').textContent = 'Getting started';
    ref('skip').hidden = false;
    ref('meter').hidden = gate === null;
    ref('progress').textContent = `${stepNumber(game.state)} / ${TUTORIAL_STEP_COUNT}`;

    // Keyed on the gate as well as the step, so crossing the threshold replays
    // the attention animation on what is now a genuinely new instruction.
    const key = `${step.id}:${gate ? 'gated' : 'open'}`;
    if (key !== shownKey) {
      shownKey = key;
      ref('title').textContent = step.title;
      ref('hint').textContent = gate ? gate.hint : step.hint;
      panel.classList.remove('is-new');
      void panel.offsetWidth;
      panel.classList.add('is-new');
    }

    if (gate) {
      ref('detail').textContent = `${formatNumber(gate.have)} / ${formatNumber(gate.needed)} Buzz`;
      setBar(ref('bar'), gate.progress, { warn: 2, critical: 2 });
      spotlight.point(TARGETS.nudge(), `${formatNumber(gate.short)} Buzz to go`);
      return;
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

    // Namespaced: the tour keys on `${stepId}:gated|open`, and the two share
    // this one slot.
    if (`goal:${goal.id}` !== shownKey) {
      shownKey = `goal:${goal.id}`;
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

  /**
   * Showing and hiding has to republish the height: a `display: none` panel
   * does not reliably produce a ResizeObserver entry, and the reserved strip
   * would stay behind as a dead margin at the bottom of every window.
   */
  function setHidden(hidden) {
    if (panel.hidden === hidden) return;
    panel.hidden = hidden;
    publishHeight();
  }

  const update = throttle(() => {
    const step = currentStep(game.state);
    if (step) {
      setHidden(false);
      renderStep(step);
      return;
    }

    const goal = goalStatus(game.state, { formatNumber });
    if (!goal) {
      // Everything on the list is done. Nothing left to point at, and a coach
      // repeating its last objective forever is worse than a quiet desktop.
      setHidden(true);
      spotlight.clear();
      return;
    }
    setHidden(false);
    renderGoal(goal);
  }, 200);

  update();
  return {
    update,
    /** Keeps the ring on a target that moved between throttled updates. */
    refreshSpotlight: () => spotlight.update(),
  };
}
