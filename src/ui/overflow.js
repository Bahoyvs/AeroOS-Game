import { OVERFLOW } from '../data/balance.js';
import { formatNumber } from '../core/format.js';
import { el } from './dom.js';

/**
 * The Buffer Overflow's face (GDD v2 §7) — the shell half of core/overflow.js.
 *
 * Three surfaces, in escalating order of rudeness:
 *
 * 1. **The static.** One attribute on `<html>`, and `styles/overflow.css` does
 *    the rest. Nothing here re-renders per frame; the phase changes a handful of
 *    times in a run and the desktop is painted by the cascade.
 * 2. **Ghost notifications.** The tray's column, deliberately not the tray's
 *    notifier: every live ghost is costing the player production, so every live
 *    ghost has to be on screen, and sharing a queue with milestone balloons
 *    would let an ordinary success message evict one of them.
 * 3. **The question.** A modal takeover with two buttons and no third option —
 *    except Escape, which picks Log Off, because the key that means "get me out
 *    of this" should do the thing it looks like.
 *
 * The UI never decides anything here. Every button calls an action on `game`
 * and re-reads state; the phase, the penalty and both payouts are core's.
 */

const CRISIS_DUMP = [
  'BUFFER_OVERFLOW at 0x0000FEED',
  '',
  'The feed has written past the end of the buffer you allocated for it.',
  'AeroOS cannot free the memory while the feed is still writing.',
];

export function createOverflowShell({ game, root = document.body, ghostRoot, staticRoot, reducedMotion }) {
  /* -------------------------------------------------------------- the static */

  const html = document.documentElement;

  /**
   * The whole visual layer, as one attribute. Phase 0 removes it rather than
   * writing "0": an absent attribute is a desktop with no crisis CSS attached
   * to it at all, which is what the ordinary game should cost.
   *
   * Guarded on the last value so it is safe to call every frame — which it is,
   * because the phase can also move without an event to hang off: a Format C:
   * wipes the units the ratio is derived from, and the static must not outlive
   * the machine it was describing.
   */
  let painted = -1;

  function paint() {
    const phase = game.econ.overflowPhase(game.state);
    if (phase === painted) return;
    painted = phase;
    if (phase <= 0) delete html.dataset.overflow;
    else html.dataset.overflow = String(phase);
    if (staticRoot) staticRoot.hidden = phase <= 0;
  }

  /* ------------------------------------------------------------- the ghosts */

  /**
   * Ghosts share the tray's column but not its queue.
   *
   * Sharing the column is a layout fix with a real bug behind it: two stacks
   * both anchored bottom-right drew straight through each other, and a ghost
   * half-covered by a "cosmetic unlocked" balloon is unreadable. Not sharing the
   * *queue* is the part that matters — `createNotifier` evicts its oldest
   * balloon past three, and every live ghost is costing the player production,
   * so an ordinary success message must never be able to hide one.
   */
  const live = new Set();

  /**
   * One balloon. It is *not* a `.balloon` — the tray notifier is the OS talking
   * to the player, and the point of a ghost is that the thing talking is not the
   * OS. Same affordances (a close box, a live region, a 44 px target), a
   * deliberately wrong palette.
   */
  function showGhost(ghost, message) {
    const node = el('div', { class: 'ghost', role: 'status', dataset: { id: String(ghost.id) } }, [
      el('div', { class: 'ghost__content' }, [
        el('div', { class: 'ghost__title', text: message.title }),
        el('div', { class: 'ghost__body', text: message.body }),
      ]),
      el('button', {
        type: 'button',
        class: 'ghost__close',
        // The close box is the interaction, so it says what it does and what it
        // is closing — "Dismiss" alone is three identical buttons to a screen
        // reader walking the stack.
        'aria-label': `Dismiss: ${message.title}`,
        text: '×',
        onclick: () => {
          const result = game.silenceGhost(ghost.id);
          if (result.ok && result.buzz > 0) {
            game.notify('Notification dismissed', `+${formatNumber(result.buzz)} Buzz`, 'success');
          }
          remove(node);
        },
      }),
    ]);

    ghostRoot.appendChild(node);
    live.add(node);
    requestAnimationFrame(() => node.classList.add('is-visible'));

    /**
     * The balloon and the ghost expire together. Core retires it on the wall
     * clock; this is only the picture of it, so it is timed rather than polled —
     * but it is timed to the same constant, so a balloon can never outlive the
     * penalty it is explaining.
     */
    setTimeout(() => remove(node), OVERFLOW.ghost.lifetimeSeconds * 1000);
  }

  function remove(node) {
    live.delete(node);
    node.classList.remove('is-visible');
    setTimeout(() => node.remove(), reducedMotion?.() ? 0 : 220);
  }

  const removeAll = () => {
    for (const node of [...live]) remove(node);
  };

  /* ----------------------------------------------------------- the question */

  let crisis = null;

  /**
   * The takeover. Modal on purpose — this is the one moment the game stops
   * being a desktop — but never a trap: focus moves in, is held between the two
   * answers while it is up, Escape answers Log Off, and focus goes back to
   * whatever the player was on when it is over.
   */
  function askQuestion() {
    if (crisis) return;
    const returnTo = document.activeElement;

    const answer = (choice) => {
      const result = game.answerOverflow(choice);
      close();
      if (!result.ok) return;
      if (choice === 'logoff') {
        game.notify(
          'Logged off',
          `Production is halved for ${OVERFLOW.logOff.durationSeconds} seconds. The feed has gone quiet.`,
          'info',
        );
      } else {
        game.notify(
          'Still scrolling',
          `×${1 + OVERFLOW.doomscroll.magnitude} production for ${
            OVERFLOW.doomscroll.durationSeconds
          } seconds. The machine is dirtier for it.`,
          'warn',
        );
      }
    };

    const logOff = el('button', {
      type: 'button',
      class: 'ovc__answer ovc__answer--logoff',
      onclick: () => answer('logoff'),
    }, [
      el('strong', { text: 'Log Off' }),
      el('small', {
        text: `Half production for ${OVERFLOW.logOff.durationSeconds}s. Ten minutes of quiet, and nothing left behind.`,
      }),
    ]);

    const doomscroll = el('button', {
      type: 'button',
      class: 'ovc__answer ovc__answer--doomscroll',
      onclick: () => answer('doomscroll'),
    }, [
      el('strong', { text: 'Keep Scrolling' }),
      el('small', {
        text: `×${1 + OVERFLOW.doomscroll.magnitude} production for ${
          OVERFLOW.doomscroll.durationSeconds
        }s. The bloat stays on the disk.`,
      }),
    ]);

    const overlay = el(
      'div',
      {
        class: 'ovc',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'ovc-title',
        'aria-describedby': 'ovc-copy',
      },
      [
        el('div', { class: 'ovc__inner' }, [
          el('pre', { class: 'ovc__dump', 'aria-hidden': 'true', text: CRISIS_DUMP.join('\n') }),
          el('h2', { class: 'ovc__title', id: 'ovc-title', text: 'Buffer Overflow' }),
          el('p', {
            class: 'ovc__copy',
            id: 'ovc-copy',
            text: 'There is more feed than there is you. Something has to give, and the machine would like you to choose which.',
          }),
          el('div', { class: 'ovc__answers' }, [logOff, doomscroll]),
          el('p', { class: 'ovc__hint', text: 'Escape logs off.' }),
        ]),
      ],
    );

    /**
     * The focus trap. Two buttons, so it is a two-line loop rather than a
     * general one — and Escape is checked first, so the way out is never behind
     * the trap.
     */
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        answer('logoff');
        return;
      }
      if (event.key !== 'Tab') return;
      event.preventDefault();
      (document.activeElement === logOff ? doomscroll : logOff).focus();
    };

    function close() {
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
      document.body.classList.remove('is-overflowing');
      crisis = null;
      if (returnTo instanceof HTMLElement && document.contains(returnTo)) returnTo.focus();
    }

    document.addEventListener('keydown', onKeyDown, true);
    root.appendChild(overlay);
    document.body.classList.add('is-overflowing');
    logOff.focus();
    crisis = { close };
  }

  /* -------------------------------------------------------------- the wiring */

  const offPhase = game.bus.on(game.events.OVERFLOW_PHASE, paint);
  const offGhost = game.bus.on(game.events.OVERFLOW_GHOST, ({ ghost, message }) =>
    showGhost(ghost, message),
  );
  const offCrisis = game.bus.on(game.events.OVERFLOW_CRISIS, askQuestion);
  const offResolved = game.bus.on(game.events.OVERFLOW_RESOLVED, () => {
    removeAll();
    paint();
  });
  const offAirplane = game.bus.on(game.events.AIRPLANE_INSTALLED, () => {
    removeAll();
    paint();
  });

  paint();
  /**
   * A save reloaded mid-crisis. The question is persisted (`crisisPending`), so
   * a player who closed the tab on it is asked again rather than quietly let
   * off — but on the next frame, not during boot, which already has a system
   * update screen and a welcome-back dialog competing for the same moment.
   */
  if (game.econ.crisisPending(game.state)) requestAnimationFrame(askQuestion);

  return {
    update: paint,
    destroy() {
      offPhase();
      offGhost();
      offCrisis();
      offResolved();
      offAirplane();
      crisis?.close();
      removeAll();
    },
  };
}
