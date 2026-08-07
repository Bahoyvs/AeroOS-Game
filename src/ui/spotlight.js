import { el } from './dom.js';

/**
 * The onboarding spotlight.
 *
 * The old coach described the next objective in a panel in the bottom-left
 * corner. That is fine for a player who has already worked out what a Frutiger
 * Aero desktop is; for the three quarters of arrivals who close the tab in the
 * first few seconds, it is a paragraph competing with an icon column, a
 * taskbar, a gadget and a window. This dims all of that and puts a ring, an
 * arrow and four words on the one thing to touch next.
 *
 * Three properties it must keep:
 *
 * - **It never blocks input.** The entire layer is `pointer-events: none` and
 *   the "hole" is a box-shadow spread, not a modal cut-out. A player who
 *   ignores the arrow and clicks something else is not trapped — a tutorial
 *   that can trap someone is worse than no tutorial, which is the rule the
 *   original coach was built on and this does not get to break.
 * - **It follows the element.** Targets are resolved to a live rect on every
 *   update, so a dragged window, a rotated phone or a switch into PDA mode all
 *   keep the ring on the right thing. A target that disappears hides the
 *   spotlight rather than pointing at bare desktop.
 * - **It is cheap.** Repositioning is two style writes against a rect the
 *   caller already throttles to ~5 Hz. Nothing here runs per frame.
 */

/** Breathing room between the target's box and the ring around it. */
const PADDING = 10;
/** Roughly the cue's own height — used to decide above vs. below. */
const CUE_SPACE = 96;
const EDGE = 12;

export function createSpotlight({ root = document.body } = {}) {
  const hole = el('div', { class: 'spotlight__hole' });
  const cue = el('div', { class: 'spotlight__cue' }, [
    el('span', { class: 'spotlight__arrow', 'aria-hidden': 'true' }),
    el('span', { class: 'spotlight__label' }),
  ]);
  const layer = el('div', { class: 'spotlight', 'aria-hidden': 'true', hidden: '' }, [hole, cue]);
  root.appendChild(layer);

  const label = cue.querySelector('.spotlight__label');

  let target = null;
  let text = '';
  let visible = false;

  /**
   * Published on <html> so the stylesheet can get out of the spotlight's way.
   * On a phone the coach and the Nudge dock are both pinned to the bottom of
   * the screen, which is exactly where the cue for the first objective lands —
   * and the cue's four words say the same thing as the coach's sentence.
   */
  function stamp() {
    document.documentElement.dataset.spotlight = visible ? 'on' : 'off';
  }

  function hide() {
    if (!visible) return;
    visible = false;
    layer.hidden = true;
    stamp();
  }

  function place(rect) {
    const top = rect.top - PADDING;
    const left = rect.left - PADDING;
    const width = rect.width + PADDING * 2;
    const height = rect.height + PADDING * 2;

    hole.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    hole.style.width = `${Math.round(width)}px`;
    hole.style.height = `${Math.round(height)}px`;

    /**
     * The cue goes under the target when there is room, and above it when there
     * is not. Below is the better default: on a phone the Nudge dock and the
     * taskbar are at the bottom, so a cue that always sat above would spend the
     * whole tutorial covering the window the player is being sent to.
     */
    const below = rect.bottom + CUE_SPACE < window.innerHeight;
    cue.dataset.side = below ? 'below' : 'above';

    const cueWidth = cue.offsetWidth || 200;
    const cueHeight = cue.offsetHeight || 48;
    const centre = rect.left + rect.width / 2;
    let x = Math.max(EDGE, Math.min(centre - cueWidth / 2, window.innerWidth - cueWidth - EDGE));
    const y = Math.max(EDGE, below ? rect.bottom + PADDING : rect.top - PADDING - cueHeight);

    const dodged = dodge(x, y, cueWidth, cueHeight);
    // An arrow that had to slide sideways is no longer over its target, and an
    // arrow pointing at bare desktop is worse than no arrow. The ring is still
    // on the control; the label just stands beside it.
    cue.dataset.dodged = dodged === x ? 'no' : 'yes';
    cue.style.transform = `translate(${Math.round(dodged)}px, ${Math.round(y)}px)`;
  }

  /**
   * Slide the cue sideways if it has landed on the coach.
   *
   * These two collide constantly and not by accident: the coach is pinned to
   * the bottom-left, and so are the Start button and (on a phone) the Nudge
   * dock — two of the five objectives. Covering the coach would bury both the
   * long-form hint and the "Skip the tour" button, and burying an escape hatch
   * is the one thing this layer is not allowed to do. The ring is the precise
   * pointer; the label only has to be legible and nearby.
   */
  function dodge(x, y, width, height) {
    const coach = document.querySelector('.coach');
    if (!coach || coach.hidden) return x;

    const box = coach.getBoundingClientRect();
    const overlaps =
      x < box.right && x + width > box.left && y < box.bottom && y + height > box.top;
    if (!overlaps) return x;

    const toRight = box.right + 8;
    if (toRight + width + EDGE <= window.innerWidth) return toRight;
    const toLeft = box.left - 8 - width;
    return toLeft >= EDGE ? toLeft : x;
  }

  /** Recompute against the target's current position. Safe to call often. */
  function update() {
    if (!target) return hide();

    // `isConnected` catches a window that was closed; a zero-sized rect catches
    // one that is hidden, minimised or scrolled out of its container.
    if (!target.isConnected) return hide();
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return hide();
    if (rect.bottom < 0 || rect.top > window.innerHeight) return hide();

    if (!visible) {
      visible = true;
      layer.hidden = false;
      stamp();
    }
    place(rect);
  }

  /**
   * Point at an element. Passing the same target and text twice is a no-op
   * beyond repositioning, so callers can drive this from a render loop without
   * restarting the attention animation on every pass.
   */
  function point(nextTarget, nextText = '') {
    if (nextTarget === target && nextText === text) {
      update();
      return;
    }
    target = nextTarget ?? null;
    text = nextText;
    label.textContent = nextText;
    label.hidden = nextText === '';

    // Restart the pop only when the objective genuinely changed.
    layer.classList.remove('is-new');
    if (target) {
      void layer.offsetWidth;
      layer.classList.add('is-new');
    }
    update();
  }

  function clear() {
    target = null;
    text = '';
    hide();
  }

  function destroy() {
    clear();
    layer.remove();
  }

  // A resize changes every rect on the page, and the throttled caller may be a
  // few hundred milliseconds away from noticing.
  const onResize = () => update();
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  return {
    point,
    clear,
    update,
    destroy() {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      destroy();
    },
    get active() {
      return visible;
    },
  };
}
