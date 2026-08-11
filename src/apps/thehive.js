import { formatNumber } from '../core/format.js';
import { createBuyControl, createCelebration } from '../ui/building.js';
import { el, throttle } from './../ui/dom.js';

/**
 * The Hive — building #12, the final one, and the only desktop anchor
 * (GDD v2 §5, §4, §14.4).
 *
 * A giant wireframe eye, pinned to the middle of the desktop, that watches the
 * cursor. No title bar, no minimise, no close, no scrollbar — nothing that
 * would let the player treat it as a window. The fiction is losing control of
 * your own machine, and the window model is the argument: every other program
 * in the OS is something you opened and can shut, and this one is not.
 *
 * The eye is built as **mesh geometry**, not as a glossy orb: an almond outline
 * traced by stacked contour lines, a sphere of latitude/longitude wires for the
 * iris, and a crosshair at the pupil. Wireframe is what makes it read as
 * *instrumentation* rather than as a cartoon — something measuring you.
 *
 * **Where the horror stops.** GDD §14.4 asked how an un-closable window behaves
 * for keyboard and screen-reader users, and the answer is that the fiction never
 * costs anyone their input. The frame (`ui/windowManager.js`, `buildAnchorFrame`)
 * is focusable, sits last in the tab order, announces itself politely, and hands
 * focus back to the Start button on Escape. No focus trap, nothing inert.
 *
 * The `w32-buy` costume is GDD §4's `[Feed]`.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** `el()` builds HTML elements; SVG children need the namespace. */
function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

const VIEW = 240; // viewBox is square; the eye is drawn wide inside it
const CX = VIEW / 2;
const CY = VIEW / 2;

/** The eye's outline: a lens shape, as two quadratic arcs meeting at the corners. */
function lidPath(halfWidth, halfHeight) {
  const l = CX - halfWidth;
  const r = CX + halfWidth;
  return (
    `M${l} ${CY} Q${CX} ${CY - halfHeight} ${r} ${CY} ` +
    `Q${CX} ${CY + halfHeight} ${l} ${CY} Z`
  );
}

/**
 * The mesh. Built once and re-parented rather than rebuilt per frame — this is
 * ~90 nodes of static geometry, and the *only* thing that changes at runtime is
 * a transform on two groups, which the compositor handles.
 */
function buildEye() {
  const root = svg('svg', {
    class: 'hive__eye',
    /**
     * Cropped to the eye, not to the square the geometry is laid out in.
     * The lens spans y = CY±66, so a full 0..VIEW box was a third empty top and
     * bottom — which read as a gap between the eye and its readout rather than
     * as breathing room.
     */
    viewBox: `2 ${CY - 74} ${VIEW - 4} 148`,
    // Decorative: the readout paragraph is the accessible description.
    'aria-hidden': 'true',
    focusable: 'false',
  });

  /* ---- lids: stacked contours, widest outermost, like a wireframe surface */
  const lids = svg('g', { class: 'hive__lids' });
  for (let i = 0; i < 9; i += 1) {
    const t = i / 8;
    lids.append(
      svg('path', {
        class: 'hive__lid',
        d: lidPath(112 - t * 10, 66 - t * 9),
        style: `--i:${i}`,
      }),
    );
  }
  root.append(lids);

  /* ---- the eyeball: a clipped sphere so the mesh never spills past the lids */
  const clip = svg('clipPath', { id: 'hive-lid-clip' }, svg('path', { d: lidPath(108, 62) }));
  root.append(svg('defs', {}, clip));

  const globe = svg('g', { class: 'hive__globe', 'clip-path': 'url(#hive-lid-clip)' });
  globe.append(svg('ellipse', { class: 'hive__sclera', cx: CX, cy: CY, rx: 108, ry: 62 }));

  /**
   * `hive__pupilGroup` is the part that moves. Everything that should follow
   * the cursor goes inside it; the lids and sclera stay put, which is what
   * makes it read as an eye turning rather than a picture sliding.
   */
  const pupil = svg('g', { class: 'hive__pupilGroup' });

  // Iris: latitude rings + longitude arcs = a sphere in wireframe.
  const iris = svg('g', { class: 'hive__iris' });
  for (let i = 1; i <= 6; i += 1) {
    iris.append(svg('circle', { class: 'hive__lat', cx: CX, cy: CY, r: i * 7.6 }));
  }
  for (let i = 0; i < 12; i += 1) {
    const rx = 46 * Math.cos((i / 12) * Math.PI);
    iris.append(
      svg('ellipse', {
        class: 'hive__lon',
        cx: CX,
        cy: CY,
        rx: Math.max(0.6, Math.abs(rx)),
        ry: 46,
      }),
    );
  }
  iris.append(svg('circle', { class: 'hive__iris-rim', cx: CX, cy: CY, r: 46 }));
  pupil.append(iris);

  // Pupil + crosshair — the instrument, and the thing that is actually aiming.
  pupil.append(svg('circle', { class: 'hive__pupil', cx: CX, cy: CY, r: 22 }));
  pupil.append(
    svg('g', { class: 'hive__crosshair' }, [
      svg('line', { x1: CX - 30, y1: CY, x2: CX - 9, y2: CY }),
      svg('line', { x1: CX + 9, y1: CY, x2: CX + 30, y2: CY }),
      svg('line', { x1: CX, y1: CY - 30, x2: CX, y2: CY - 9 }),
      svg('line', { x1: CX, y1: CY + 9, x2: CX, y2: CY + 30 }),
      svg('circle', { cx: CX, cy: CY, r: 5.5 }),
      svg('circle', { class: 'hive__crosshair-ring', cx: CX, cy: CY, r: 13 }),
    ]),
  );
  // The specular highlight travels with the eye, as a real one would.
  pupil.append(svg('ellipse', { class: 'hive__glint', cx: CX + 16, cy: CY - 18, rx: 11, ry: 7 }));

  globe.append(pupil);
  root.append(globe);

  // The lid contours again on top, so the mesh reads as wrapping the sphere.
  root.append(
    svg('path', { class: 'hive__lid hive__lid--front', d: lidPath(112, 66) }),
    svg('path', { class: 'hive__lid hive__lid--front', d: lidPath(108, 62) }),
  );

  return { root, pupil };
}

/** What the eye says. It never addresses the player, and never asks twice. */
const UTTERANCES = ['feed', 'more', 'again', 'closer', 'do not stop', 'yes'];

export function mount(body, { game }) {
  body.classList.add('app-thehive');
  body.innerHTML = `
    <div class="hive__stage" data-role="stage"></div>
    <p class="hive__readout" data-role="readout">The Hive is quiet.</p>
    <div data-role="buy"></div>
    <p class="hive__escape">Press Esc to look away.</p>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const eye = buildEye();
  ref('stage').append(eye.root);

  const utterance = el('span', { class: 'hive__utterance', 'aria-hidden': 'true' });
  ref('stage').append(utterance);

  const buy = createBuyControl({ game, buildingId: 'thehive', labels: { one: 'Feed' } });
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

  /* ------------------------------------------------------- mouse tracking */

  /**
   * The eye tracks the cursor across the whole desktop, not just inside itself
   * — bound to the document, because a giant eye that only notices you when you
   * are already on top of it is not watching anything.
   *
   * The pupil group is translated in *SVG user units* via `transform`, which
   * keeps the geometry crisp at any scale and stays off the layout path. The
   * throw is deliberately short: an eye whose pupil slides to the edge of the
   * sclera reads as a googly toy. A small, confident turn is worse.
   *
   * Reduced motion is honoured by simply not writing the transform, rather than
   * by a CSS rule that would still leave this handler running per pointer move.
   */
  const THROW = 26; // user units, out of a 46-unit iris radius
  let tracking = true;

  const onPointerMove = (event) => {
    if (!tracking) return;
    const rect = ref('stage').getBoundingClientRect();
    if (rect.width === 0) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    // Normalised against the viewport, so the eye is looking at the *cursor's
    // place on the desktop* rather than at its distance from the orb.
    const dx = Math.max(-1, Math.min(1, (event.clientX - cx) / (window.innerWidth / 2)));
    const dy = Math.max(-1, Math.min(1, (event.clientY - cy) / (window.innerHeight / 2)));
    eye.pupil.setAttribute('transform', `translate(${(dx * THROW).toFixed(2)} ${(dy * THROW * 0.62).toFixed(2)})`);
  };
  document.addEventListener('pointermove', onPointerMove, { passive: true });

  /* --------------------------------------------------------------- update */

  let lastTier = 0;

  const update = throttle(() => {
    const s = game.state;
    const { econ } = game;
    const bd = econ.getProductionBreakdown(s, 'thehive');
    const tier = bd.milestoneMultiplier;

    // Reduced motion is read here rather than cached at mount: the player can
    // change the setting while the window is open, and this is the one window
    // they cannot close and reopen to pick the change up.
    tracking = document.documentElement.dataset.motion !== 'reduced';
    if (!tracking) eye.pupil.removeAttribute('transform');

    /**
     * The anchor frame is an `aria-live="polite"` region, so this sentence *is*
     * the screen-reader experience of the whole building. It carries the two
     * numbers that matter — how much has been fed, and what it produces — and
     * is only written when it changes, because a live region rewritten every
     * tick reads continuously and never lets the user leave.
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
      utterance.textContent =
        bd.units === 0 ? '' : UTTERANCES[Math.min(UTTERANCES.length - 1, Math.floor(Math.log2(tier)))];
      const step = Math.log2(Math.max(1, tier));
      body.style.setProperty('--hive-scale', (1 + step * 0.09).toFixed(3));
      body.style.setProperty('--hive-heat', Math.min(1, step / 5).toFixed(3));
      body.classList.toggle('is-awake', bd.units > 0);
    }

    buy.update();
  }, 150);

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);
  return () => {
    unsubscribe();
    document.removeEventListener('pointermove', onPointerMove);
    celebration.destroy();
    body.classList.remove('app-thehive', 'is-awake');
  };
}
