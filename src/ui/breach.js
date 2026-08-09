import { BREACH } from '../data/balance.js';
import { formatNumber } from '../core/format.js';
import { clear, el } from './dom.js';
import { openMinigame } from './minigames.js';

/**
 * The Darknet Breach shell (GDD §C.3).
 *
 * Three escalating layers over the desktop, and one rule shared by all of them:
 * **everything is a real, hittable target**. Rogue processes and popups are
 * `<button>`s sized for a thumb (GDD §F) rather than absolutely-positioned divs
 * with click handlers, so they work with touch, with a keyboard, and with a
 * screen reader, and the phase-3 event is an ordinary focus-trapped dialog.
 *
 * `core/breach.js` decides *that* any of this is happening. This module only
 * decides what it looks like.
 */
export function mountBreachLayer(root, { game }) {
  const layer = el('div', { class: 'breach-layer', 'aria-live': 'polite' });
  root.appendChild(layer);

  const rogueNodes = new Map();
  const popupNodes = new Map();
  let phaseShown = 0;
  let fullScreen = null;

  /* -------------------------------------------------------- desktop dressing */

  function applyPhaseClass(phase) {
    // The wallpaper corruption, the clock jitter and the scanlines are all CSS,
    // keyed off one attribute on <html>. That keeps the escalation in the
    // stylesheet where the motion preference is already resolved, rather than
    // scattering inline styles the reduced-motion setting cannot reach.
    document.documentElement.dataset.breach = phase > 0 ? String(phase) : '';
  }

  /* ---------------------------------------------------------------- phase 1 */

  function renderPopups(popups) {
    for (const [id, node] of popupNodes) {
      if (!popups.some((p) => p.id === id)) {
        node.remove();
        popupNodes.delete(id);
      }
    }

    for (const popup of popups) {
      if (popupNodes.has(popup.id)) continue;
      const node = el(
        'div',
        {
          class: 'breach-popup glass',
          style: `--x:${popup.x};--y:${popup.y}`,
          role: 'alertdialog',
          'aria-label': 'Advertisement',
        },
        [
          el('div', { class: 'breach-popup__bar' }, [
            el('span', { text: 'FREE_DOWNLOAD.EXE' }),
            el('button', {
              type: 'button',
              class: 'breach-popup__close',
              'aria-label': 'Close popup',
              text: '✕',
              onclick: () => {
                game.dismissBreachPopup(popup.id);
                node.remove();
                popupNodes.delete(popup.id);
              },
            }),
          ]),
          el('div', { class: 'breach-popup__body' }, [
            el('strong', { text: 'CONGRATULATIONS!' }),
            // Deliberately inert. It is set dressing about the era's web, and
            // an ad parody that behaves like an ad would be a dark pattern.
            el('small', { text: 'You are the 1,000,000th visitor. Claim your prize!' }),
          ]),
        ],
      );
      layer.appendChild(node);
      popupNodes.set(popup.id, node);
    }
  }

  /* ---------------------------------------------------------------- phase 2 */

  function renderRogues(rogues) {
    for (const [id, node] of rogueNodes) {
      if (!rogues.some((r) => r.id === id)) {
        node.remove();
        rogueNodes.delete(id);
      }
    }

    for (const rogue of rogues) {
      if (rogueNodes.has(rogue.id)) continue;
      const node = el('button', {
        type: 'button',
        class: 'breach-rogue',
        style: `--x:${rogue.x};--y:${rogue.y}`,
        'aria-label': 'Terminate rogue process',
        title: 'Rogue process — click to terminate',
        onclick: () => {
          const result = game.terminateRogue(rogue.id);
          if (result.ok) {
            game.notify(
              'Process terminated',
              `Recovered ${formatNumber(result.buzz)} Buzz.`,
              'success',
            );
          }
          node.remove();
          rogueNodes.delete(rogue.id);
        },
      }, [
        el('span', { class: 'breach-rogue__glyph', 'aria-hidden': 'true', text: '☠' }),
        el('span', { class: 'breach-rogue__name', text: 'svch0st.exe' }),
      ]);
      layer.appendChild(node);
      rogueNodes.set(rogue.id, node);
    }
  }

  /* ---------------------------------------------------------------- phase 3 */

  /**
   * The full-screen event. Same shape as the Format C: stop screen — a takeover
   * that owns the whole viewport and cannot be clicked past — because it is the
   * same *kind* of beat: the machine has stopped being yours for a moment.
   *
   * Two ways out, and the active one is the better deal. That is what makes it
   * a decision rather than a toll.
   */
  function showFullScreen() {
    if (fullScreen) return;

    const previouslyFocused = document.activeElement;
    fullScreen = el('div', {
      class: 'breach-full',
      role: 'alertdialog',
      'aria-modal': 'true',
      'aria-label': 'System breach',
    });

    const ransom = Math.floor(game.state.buzz * BREACH.phase3.ransomFraction);

    fullScreen.append(
      el('div', { class: 'breach-full__rain', 'aria-hidden': 'true' }),
      el('div', { class: 'breach-full__panel' }, [
        el('h2', { text: 'YOUR FILES HAVE BEEN ENCRYPTED' }),
        el('p', {
          class: 'breach-full__lead',
          text: 'An unpatched machine on an unkind network. Somebody noticed.',
        }),
        el('dl', { class: 'breach-full__stats' }, [
          el('dt', { text: 'Ransom' }),
          el('dd', { text: `${formatNumber(ransom)} Buzz` }),
          el('dt', { text: 'Permanent progress' }),
          el('dd', { text: 'Untouched' }),
        ]),
        el('div', { class: 'breach-full__actions' }, [
          el('button', {
            type: 'button',
            class: 'breach-full__pay',
            text: 'Pay the ransom',
            onclick: () => {
              const result = game.resolveBreach('ransom');
              dismissFullScreen();
              game.notify(
                'Ransom paid',
                `${formatNumber(result.lost)} Buzz gone. The machine is quiet again.`,
                'warn',
              );
            },
          }),
          el('button', {
            type: 'button',
            class: 'breach-full__fight',
            text: 'Fight back',
            onclick: () => {
              // The counter-attack reuses Shield99's Firewall Defence engine
              // (GDD §C.3) rather than adding a sixth mini-game — same rules,
              // higher stakes, and the player has probably already met it.
              dismissFullScreen({ restoreFocus: false });
              openMinigame('shield99', {
                game,
                title: 'Counter-Attack',
                onFinish: (result) => {
                  const won = result.score >= 1;
                  const outcome = game.resolveBreach(won ? 'fought' : 'lost');
                  if (won) {
                    game.notify(
                      'Intrusion repelled',
                      `+${formatNumber(outcome.reward)} Buzz and $${outcome.dollars}.`,
                      'success',
                    );
                  } else {
                    game.notify(
                      'They got through',
                      `${formatNumber(outcome.lost)} Buzz lost. Buy more Shield99 licences.`,
                      'warn',
                    );
                  }
                },
              });
            },
          }),
        ]),
        el('p', {
          class: 'breach-full__note',
          text: 'Fighting costs nothing if you win, and more than the ransom if you lose.',
        }),
      ]),
    );

    document.body.appendChild(fullScreen);
    fullScreen.querySelector('.breach-full__fight')?.focus();

    // A takeover that a stray Tab can escape is not a takeover.
    const trap = (e) => {
      if (e.key !== 'Tab') return;
      const focusable = fullScreen.querySelectorAll('button');
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    fullScreen.addEventListener('keydown', trap);
    fullScreen._restore = previouslyFocused;
  }

  function dismissFullScreen({ restoreFocus = true } = {}) {
    if (!fullScreen) return;
    const restore = fullScreen._restore;
    fullScreen.remove();
    fullScreen = null;
    if (restoreFocus && restore?.focus) restore.focus();
  }

  /* ----------------------------------------------------------------- update */

  function update() {
    const status = game.breach();

    if (status.phase !== phaseShown) {
      phaseShown = status.phase;
      applyPhaseClass(status.phase);
    }

    renderPopups(status.phase >= 1 ? status.popups : []);
    renderRogues(status.phase >= 2 ? status.rogues : []);

    if (status.fullBreach) showFullScreen();
    else dismissFullScreen();
  }

  const offTick = game.bus.on(game.events.TICK, update);
  const offPhase = game.bus.on(game.events.BREACH_PHASE, ({ to }) => {
    if (to === 1) {
      game.notify(
        'Suspicious traffic',
        'Something is scanning your machine. More Shield99 licences would help.',
        'warn',
      );
    } else if (to === 2) {
      game.notify(
        'Intrusion detected',
        'Rogue processes are skimming your production. Click them to terminate.',
        'warn',
      );
    }
  });

  update();

  return () => {
    offTick();
    offPhase();
    dismissFullScreen();
    clear(layer);
    layer.remove();
    delete document.documentElement.dataset.breach;
  };
}
