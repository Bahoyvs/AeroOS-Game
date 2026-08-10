import { BUILDING } from '../data/balance.js';
import { getBuilding } from '../data/buildings.js';
import { formatNumber } from '../core/format.js';
import { clear, el, setBar } from './dom.js';

/**
 * The shared building-window kit (GDD v2 §3.1, §4).
 *
 * Twelve windows have to do the same three things — price units, buy them, and
 * celebrate a milestone — while looking like twelve unrelated programs from
 * 2004. That tension is the whole design, and this module is where it is
 * resolved: the *mechanism* lives here exactly once, and each window supplies
 * only the words and the chrome.
 *
 * Nothing here computes a game number. Every figure comes from
 * `econ.getProductionBreakdown()` or `econ.affordableUnits()`, per the rule in
 * CLAUDE.md — a window that did its own arithmetic would be the first step back
 * towards twelve bespoke economies.
 */

/** The bulk steps every buy control offers. `max` is resolved at click time. */
const STEPS = [1, 10, 100, 'max'];

/**
 * A `w32-buy` control: the purchase, wearing whatever costume the app calls for.
 *
 * `labels.one` is the app's own word for buying a single unit — "Add a Contact",
 * "+ ADD", "> execute payload.exe". The ×10/×100/Max steps are deliberately
 * *not* re-skinned: they are an accessibility affordance, not fiction, and a
 * player who has learned what "Max" does in AeroChat should not have to relearn
 * it in BotNet.
 *
 * Returns `{ root, update }`. The caller owns where it goes in the DOM.
 */
export function createBuyControl({ game, buildingId, labels = {}, onBought }) {
  const building = getBuilding(buildingId);
  const one = labels.one ?? `Add ${building.unit}`;

  const buttons = STEPS.map((step) =>
    el(
      'button',
      {
        type: 'button',
        class: `w32buy__btn${step === 1 ? ' w32buy__btn--primary' : ''}`,
        dataset: { step: String(step) },
        onclick: () => buy(step),
      },
      [
        el('span', { class: 'w32buy__label', text: step === 1 ? one : step === 'max' ? 'Max' : `×${step}` }),
        el('small', { class: 'w32buy__cost', text: '—' }),
      ],
    ),
  );

  const root = el('div', { class: 'w32buy', dataset: { building: buildingId } }, buttons);

  function buy(step) {
    const amount = step === 'max' ? BUILDING.maxUnits : step;
    const result = game.buyUnits(buildingId, amount);
    if (!result.ok) {
      const messages = {
        'too-expensive': ['Not enough Buzz', 'Keep nudging — the machine is earning too.'],
        full: [`${building.name} is full`, `${BUILDING.maxUnits} ${building.units} is as many as it holds.`],
        locked: [`${building.name} is not ready`, 'Keep earning — it opens on its own.'],
      };
      const [title, body] = messages[result.reason] ?? ['Cannot buy that', ''];
      game.notify(title, body, 'warn');
      return;
    }
    onBought?.(result);
    update();
  }

  function update() {
    const owned = game.econ.unitsOf(game.state, buildingId);
    for (const button of buttons) {
      const step = button.dataset.step;
      const amount = step === 'max' ? BUILDING.maxUnits : Number(step);
      const { count, cost } = game.econ.affordableUnits(game.state, buildingId, amount);
      button.disabled = count === 0;
      const costNode = button.querySelector('.w32buy__cost');
      costNode.textContent =
        step === 'max'
          ? count > 0
            ? `${count} · ${formatNumber(cost)}`
            : '—'
          : formatNumber(game.econ.unitCostBulk(buildingId, owned, amount));
    }
  }

  update();
  return { root, update };
}

/**
 * The unit/milestone readout: how many are owned, what tier that is worth, and
 * how far the next one is.
 *
 * One bar, one line, and the app's own noun for its units. This is the piece
 * that makes the shared milestone table legible across twelve very different
 * windows — the numbers move the same way everywhere even though the fiction
 * around them does not.
 */
export function createMeter({ game, buildingId }) {
  const building = getBuilding(buildingId);
  const count = el('span', { class: 'w32meter__count' });
  const tier = el('span', { class: 'w32meter__tier' });
  const fill = el('div', { class: 'meter__fill' });

  const root = el('div', { class: 'w32meter' }, [
    el('div', { class: 'w32meter__label' }, [count, tier]),
    el('div', { class: 'meter__track' }, fill),
  ]);

  function update() {
    const bd = game.econ.getProductionBreakdown(game.state, buildingId);
    count.textContent = `${bd.units} ${bd.units === 1 ? building.unit : building.units}`;
    if (bd.milestone) {
      tier.textContent = `×${bd.milestoneMultiplier} · ${bd.milestone.remaining} to ×${bd.milestone.multiplier}`;
      // The bar is updated on the app's own render pass, which is throttled to
      // ~150ms; the fill's transition is tuned under that in CSS so it always
      // arrives rather than restarting forever (see setBar).
      setBar(fill, bd.milestone.ratio, { warn: 2, critical: 2 });
    } else {
      tier.textContent = `×${bd.milestoneMultiplier} · maxed`;
      setBar(fill, 1, { warn: 2, critical: 2 });
    }
  }

  update();
  return { root, update };
}

/**
 * The milestone celebration (GDD §2.3).
 *
 * The redesign deleted the upgrade shops, and with them every "you have a
 * decision to make" moment. What it explicitly did *not* delete is the flavour
 * those shops carried — the EQ lights, the PRO banner, the fake activation
 * flow. Those become this: two or three seconds the player did not ask for and
 * cannot get wrong.
 *
 * One driver for all twelve. A window passes `render(payload)` to draw its own
 * costume; everything about *when*, *how long*, and reduced-motion behaviour is
 * decided once, here. Six windows with six bespoke timers is how a celebration
 * ends up outliving the window that spawned it.
 */
export function createCelebration({ game, buildingId, host, render, durationMs = 2600 }) {
  let timer = null;

  const unsubscribe = game.bus.on(game.events.MILESTONE, (payload) => {
    if (payload.id !== buildingId) return;
    show(payload);
  });

  function show(payload) {
    // A second milestone landing during the first (a big Max buy can cross two)
    // replaces it rather than queueing: the player is looking at the newest
    // number, and a backlog of congratulations is noise.
    clearTimeout(timer);
    const existing = host.querySelector('.w32celebrate');
    if (existing) existing.remove();

    const node = el('div', { class: 'w32celebrate' }, render(payload));
    host.appendChild(node);
    host.classList.add('is-celebrating');

    timer = setTimeout(() => {
      node.classList.add('is-leaving');
      const dismiss = () => {
        node.remove();
        host.classList.remove('is-celebrating');
      };
      // `animationend` rather than a fixed delay, so the exit duration stays
      // tuned in CSS — and reduced motion, which collapses the duration rather
      // than removing the animation, still fires it and cleans up at once.
      node.addEventListener('animationend', dismiss, { once: true });
      // ...with a fallback, because an element whose exit animation never runs
      // (display:none in a hidden window, a stylesheet that failed to load)
      // would otherwise strand `is-celebrating` on the host forever.
      timer = setTimeout(dismiss, 700);
    }, durationMs);
  }

  return {
    show,
    destroy() {
      clearTimeout(timer);
      unsubscribe();
      host.classList.remove('is-celebrating');
    },
  };
}

/**
 * The default celebration body, for windows with nothing more specific to say.
 * A building that has its own idea — RetroAmp's EQ, LemonWire's PRO banner —
 * passes its own `render` instead.
 */
export function milestoneCard({ id, at, multiplier, minigameUnlocked }) {
  const building = getBuilding(id);
  return [
    el('strong', { class: 'w32celebrate__title', text: `${at} ${building.units}` }),
    el('span', { class: 'w32celebrate__body', text: `${building.name} is now ×${multiplier}.` }),
    ...(minigameUnlocked && building.minigame
      ? [el('em', { class: 'w32celebrate__extra', text: `${building.minigame.title} unlocked` })]
      : []),
  ];
}

/**
 * The locked state: a building the run has not reached yet.
 *
 * Every window needs one, and it must never show the real threshold as a bare
 * number the player is meant to track — that is the "matematik oyuncuya asla
 * çıplak sayı olarak görünmez" rule (GDD §3.1). It shows a bar and the app's
 * own excuse for not being ready.
 */
export function createLockedPanel({ game, buildingId, message }) {
  const building = getBuilding(buildingId);
  const fill = el('div', { class: 'meter__fill' });
  const text = el('p', { class: 'w32locked__text', text: message ?? `${building.name} is not ready yet.` });
  const root = el('div', { class: 'w32locked' }, [
    text,
    el('div', { class: 'meter__track' }, fill),
    el('small', { class: 'w32locked__hint', text: 'Keep earning — it opens on its own.' }),
  ]);

  function update() {
    const next = game.econ.nextUnlock(game.state);
    const ratio =
      next?.id === buildingId
        ? next.ratio
        : game.econ.isBuildingUnlocked(game.state, buildingId)
          ? 1
          : 0;
    setBar(fill, ratio, { warn: 2, critical: 2 });
  }

  update();
  return { root, update };
}

/** Re-exported so a window has one import for the whole kit. */
export { clear, el, formatNumber, setBar };
