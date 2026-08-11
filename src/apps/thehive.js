import { formatNumber } from '../core/format.js';
import { createBuyControl, createCelebration } from '../ui/building.js';
import { el, throttle } from './../ui/dom.js';

/**
 * The Hive — building #12, the final one, and the only desktop anchor
 * (GDD v2 §5, §4, §14.4).
 *
 * No title bar, no minimise, no close, pinned to the middle of the desktop. The
 * fiction is losing control of your own machine, and the window model is the
 * argument: every other program in the OS is something you opened and can shut,
 * and this one is not.
 *
 * **Where that stops.** GDD §14.4 asked how an un-closable window behaves for
 * keyboard and screen-reader users, and the answer this implements is that the
 * fiction never costs anyone their input. The frame (`ui/windowManager.js`,
 * `buildAnchorFrame`) is focusable, sits last in the tab order, announces
 * itself politely, and hands focus back to the Start button on Escape. There is
 * no focus trap and nothing is made inert. A player who cannot use a mouse gets
 * the same "I can look away" that a mouse user gets for free.
 *
 * The `w32-buy` costume is GDD §4's `[Feed]` — the one verb, and the only
 * building whose purchase is not dressed as a feature.
 */

/** What the orb says. It never addresses the player, and never asks twice. */
const UTTERANCES = [
  'feed',
  'more',
  'again',
  'closer',
  'do not stop',
  'yes',
];

export function mount(body, { game }) {
  body.classList.add('app-thehive');
  body.innerHTML = `
    <div class="hive__orb" data-role="orb">
      <span class="hive__halo" aria-hidden="true"></span>
      <span class="hive__core" aria-hidden="true"></span>
      <span class="hive__utterance" data-role="utterance" aria-hidden="true"></span>
    </div>

    <p class="hive__readout" data-role="readout">The Hive is quiet.</p>
    <div data-role="buy"></div>
    <p class="hive__escape" data-role="escape-hint">Press Esc to look away.</p>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const orb = ref('orb');

  const buy = createBuyControl({
    game,
    buildingId: 'thehive',
    labels: { one: 'Feed' },
  });
  buy.root.classList.add('hive__buy');
  ref('buy').replaceWith(buy.root);

  const celebration = createCelebration({
    game,
    buildingId: 'thehive',
    host: body,
    render: ({ multiplier }) => [
      el('strong', { class: 'w32celebrate__title', text: 'THE HIVE IS PLEASED' }),
      el('span', { class: 'w32celebrate__body', text: `×${multiplier}` }),
    ],
  });

  /**
   * The orb follows the cursor (GDD §4).
   *
   * Bound to the document because the anchor is small and the point is that it
   * tracks you across the *whole desktop*, not just inside itself. Passive, and
   * it only writes two custom properties — the transform happens in CSS on the
   * compositor, so this costs nothing per move.
   *
   * It does nothing under reduced motion: `--hive-look` is only read by a rule
   * the motion attribute disables, so the handler stays cheap rather than
   * needing to know about the setting itself.
   */
  const onPointerMove = (event) => {
    const rect = orb.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = Math.max(-1, Math.min(1, (event.clientX - cx) / (window.innerWidth / 2)));
    const dy = Math.max(-1, Math.min(1, (event.clientY - cy) / (window.innerHeight / 2)));
    body.style.setProperty('--hive-look-x', dx.toFixed(3));
    body.style.setProperty('--hive-look-y', dy.toFixed(3));
  };
  document.addEventListener('pointermove', onPointerMove, { passive: true });

  /* --------------------------------------------------------------- update */

  let lastTier = 0;

  const update = throttle(() => {
    const s = game.state;
    const { econ } = game;
    const bd = econ.getProductionBreakdown(s, 'thehive');
    const tier = bd.milestoneMultiplier;

    /**
     * The anchor frame is an `aria-live="polite"` region, so this text *is* the
     * screen-reader experience of the whole building. It has to carry the two
     * numbers that matter — how much has been fed, and what it is producing —
     * in a sentence rather than as decoration around an orb nobody can see.
     *
     * Written into one node and only when it changes: a live region rewritten
     * on every tick would read continuously and never let the user leave.
     */
    const readout =
      bd.units === 0
        ? 'The Hive is quiet.'
        : `Hive level ${Math.log2(tier) + 1}. ${formatNumber(bd.units)} fed. ${formatNumber(
            bd.total,
          )} Buzz per second.`;
    if (ref('readout').textContent !== readout) ref('readout').textContent = readout;

    if (tier !== lastTier) {
      lastTier = tier;
      ref('utterance').textContent =
        bd.units === 0 ? '' : UTTERANCES[Math.min(UTTERANCES.length - 1, Math.floor(Math.log2(tier)))];
      // Size and heat both climb with the tier — the orb grows as it is fed.
      body.style.setProperty('--hive-scale', (1 + Math.log2(Math.max(1, tier)) * 0.14).toFixed(3));
      body.style.setProperty('--hive-heat', Math.min(1, Math.log2(Math.max(1, tier)) / 5).toFixed(3));
    }

    buy.update();
  }, 150);

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);
  return () => {
    unsubscribe();
    document.removeEventListener('pointermove', onPointerMove);
    celebration.destroy();
    body.classList.remove('app-thehive');
  };
}
