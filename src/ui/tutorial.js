import { TUTORIAL_STEP_COUNT, currentStep, stepNumber } from '../core/tutorial.js';
import { throttle } from './dom.js';

/**
 * The onboarding coach (AO-12): one objective at a time, bottom-left, out of
 * the way of the cascade. It never blocks input and can be skipped outright —
 * a tutorial that traps a returning player is worse than no tutorial.
 */
export function createTutorialCoach({ root, game }) {
  const panel = document.createElement('aside');
  panel.className = 'coach glass';
  panel.setAttribute('aria-live', 'polite');
  panel.innerHTML = `
    <div class="coach__head">
      <span class="coach__label">Getting started</span>
      <span class="coach__progress" data-role="progress"></span>
    </div>
    <strong class="coach__title" data-role="title"></strong>
    <p class="coach__hint" data-role="hint"></p>
    <button type="button" class="coach__skip" data-role="skip">Skip the tour</button>
  `;
  root.appendChild(panel);

  const ref = (role) => panel.querySelector(`[data-role="${role}"]`);

  ref('skip').addEventListener('click', () => {
    game.skipOnboarding();
    update();
  });

  let shownStepId = null;

  const update = throttle(() => {
    const step = currentStep(game.state);
    panel.hidden = step === null;
    if (!step) return;

    if (step.id !== shownStepId) {
      shownStepId = step.id;
      ref('title').textContent = step.title;
      ref('hint').textContent = step.hint;
      ref('progress').textContent = `${stepNumber(game.state)} / ${TUTORIAL_STEP_COUNT}`;
      // Re-trigger the attention animation on each new objective.
      panel.classList.remove('is-new');
      void panel.offsetWidth;
      panel.classList.add('is-new');
    }
  }, 200);

  update();
  return { update };
}
