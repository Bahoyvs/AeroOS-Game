import { el } from './dom.js';

/**
 * The Format C: sequence (AO-17).
 *
 * Confirm → BSOD → wipe/POST → clean desktop. The GDD is explicit that this
 * should read as *relief* rather than punishment (GDD 7): the machine finally
 * gives out, and what comes back is faster. The reboot screen is also where the
 * Day 8 interstitial ad slots in, which is why it is a real beat and not a fade.
 *
 * Always skippable — on a platform with 30-minute sessions, an unskippable
 * cutscene on a repeatable action is a churn machine.
 */

const STAGES = {
  bsod: 2600,
  wipe: 2600,
};

/**
 * How long a stage must be on screen before a click can skip it. Without this,
 * the click that confirmed the dialog — or an impatient double-click — lands on
 * the overlay the instant it appears and the sequence blows past unseen.
 */
const SKIP_GRACE_MS = 800;

const DUMP_LINES = [
  'A problem has been detected and AeroOS has been shut down to prevent damage',
  'to your buddy list.',
  '',
  'FORMAT_C_INITIATED',
  '',
  'If this is the first time you have seen this Stop error screen, that is',
  'because you have never been this bloated before. Congratulations.',
  '',
  'Technical information:',
  '',
  '*** STOP: 0x000000C5 (0xBAD0BEEF, 0x00000002, 0x00000000, 0xC0FFEE00)',
  '',
  'Collecting data for crash dump ...',
];

const WIPE_STEPS = [
  'Wiping C:\\WINDOWS\\Temp',
  'Uninstalling software',
  'Disconnecting buddies',
  'Clearing system bloat',
  'Cashing out lifetime Buzz',
  'Detecting hardware',
];

export function createFormatSequence({ root, reducedMotion = () => false }) {
  const overlay = el('div', { class: 'bsod', hidden: '' });
  root.appendChild(overlay);

  /**
   * Hold a stage for `ms`, or until the player deliberately clicks past it.
   *
   * The duration is NOT shortened for reduced-motion preferences: "reduce
   * motion" asks for less movement, not less reading time, and clamping it here
   * made the whole sequence flash by in under a second. The moving parts are
   * disabled in CSS instead.
   */
  const wait = (ms) =>
    new Promise((resolve) => {
      let armed = false;

      const done = () => {
        clearTimeout(armTimer);
        clearTimeout(timer);
        overlay.removeEventListener('click', onClick);
        overlay.classList.remove('is-armed');
        resolve();
      };
      const onClick = () => {
        if (armed) done();
      };

      const armTimer = setTimeout(() => {
        armed = true;
        overlay.classList.add('is-armed');
      }, Math.min(SKIP_GRACE_MS, ms));
      const timer = setTimeout(done, ms);
      overlay.addEventListener('click', onClick);
    });

  function renderBsod() {
    overlay.className = 'bsod bsod--stop';
    overlay.innerHTML = `
      <div class="bsod__inner">
        <pre class="bsod__text">${DUMP_LINES.join('\n')}</pre>
        <p class="bsod__hint">Click to continue</p>
      </div>
    `;
  }

  function renderWipe(summary) {
    overlay.className = 'bsod bsod--post';
    overlay.innerHTML = `
      <div class="bsod__inner">
        <div class="bsod__post-head">AeroBIOS v4.51PG — Format C:</div>
        <ul class="bsod__steps">
          ${WIPE_STEPS.map((step) => `<li><span>${step}</span><b>OK</b></li>`).join('')}
        </ul>
        <dl class="bsod__summary">
          <div><dt>Banked</dt><dd>$${summary.dollars.toFixed(2)}</dd></div>
          ${
            summary.bonus > 0
              ? `<div><dt>Sponsor bonus</dt><dd>$${summary.bonus.toFixed(2)}</dd></div>`
              : ''
          }
          <div><dt>Format C: count</dt><dd>${summary.prestigeCount}</dd></div>
          ${
            /**
             * The Legacy line (GDD §2.6). It belongs *here*, on the POST
             * screen, and not in a balloon afterwards: the whole promise of
             * the layer is that the wipe is what pays it, and a number that
             * arrives a beat later reads as an unrelated reward. Only drawn
             * when there is a level to report — "Legacy Level 0" on the one
             * screen that exists to announce it would be worse than silence.
             */
            summary.legacy?.level > 0
              ? `<div><dt>Legacy Level</dt><dd>${summary.legacy.level}${
                  summary.legacy.gained > 0 ? ` (+${summary.legacy.gained})` : ''
                } — ×${(1 + summary.legacy.level / 100).toFixed(2)} forever</dd></div>`
              : ''
          }
          <div><dt>Memory</dt><dd>${summary.ramMB} MB OK</dd></div>
        </dl>
        <p class="bsod__hint">Starting AeroOS…</p>
      </div>
    `;

    // Tick the checklist in one by one so the wipe reads as work being done.
    const items = [...overlay.querySelectorAll('.bsod__steps li')];
    const step = STAGES.wipe / (items.length + 2);
    items.forEach((item, i) => setTimeout(() => item.classList.add('is-done'), step * i));
  }

  /**
   * Run the whole sequence. `applyReset` is called between the BSOD and the
   * reboot screen and must return the post-reset summary — so the POST screen
   * reports the machine the player is about to get.
   */
  async function run(applyReset) {
    overlay.hidden = false;
    document.body.classList.add('is-formatting');

    renderBsod();
    await wait(STAGES.bsod);

    const summary = await applyReset();

    renderWipe(summary);
    await wait(STAGES.wipe);

    overlay.classList.add('is-leaving');
    await new Promise((resolve) => setTimeout(resolve, reducedMotion() ? 0 : 400));


    overlay.hidden = true;
    overlay.classList.remove('is-leaving');
    overlay.innerHTML = '';
    document.body.classList.remove('is-formatting');
    return summary;
  }

  return { run, get busy() { return !overlay.hidden; } };
}

/**
 * The one-time "System Updating…" screen (GDD §11).
 *
 * Shield99, AeroBurn and Aero Studio were taken away from players who had
 * already paid for them. The migration refunds that Buzz; this is where the
 * player is *told*, and it is deliberately not a toast or a modal — it borrows
 * the POST screen because a mid-2000s OS removing three programs and handing
 * back what they cost is exactly the sort of thing that happened on a reboot.
 *
 * Shown once, on the first boot after the 3 -> 4 migration, and only when there
 * is a refund to report: a player who never bought any of the three is not
 * owed a screen explaining that they were refunded nothing.
 */
export function createSystemUpdate({ root, reducedMotion = () => false }) {
  const REMOVED = ['Shield99', 'AeroBurn', 'Aero Studio'];

  async function run({ refund, formatNumber = (n) => String(n) }) {
    const overlay = el('div', { class: 'bsod bsod--post' });
    overlay.innerHTML = `
      <div class="bsod__inner">
        <div class="bsod__post-head">AeroOS — System Update</div>
        <ul class="bsod__steps">
          ${REMOVED.map((name) => `<li><span>Removing ${name}</span><b>OK</b></li>`).join('')}
          <li><span>Refunding your investment</span><b>OK</b></li>
        </ul>
        <dl class="bsod__summary">
          <div><dt>Programs removed</dt><dd>${REMOVED.length}</dd></div>
          <div><dt>Refunded</dt><dd>${formatNumber(refund)} Buzz</dd></div>
        </dl>
        <p class="bsod__hint">Click to continue</p>
      </div>
    `;
    root.appendChild(overlay);
    document.body.classList.add('is-formatting');

    const items = [...overlay.querySelectorAll('.bsod__steps li')];
    const step = STAGES.wipe / (items.length + 2);
    items.forEach((item, i) => setTimeout(() => item.classList.add('is-done'), step * i));

    // Same skip contract as the Format C: sequence: held long enough to read,
    // dismissible the moment the player has had enough of it.
    await new Promise((resolve) => {
      let armed = false;
      const done = () => {
        overlay.removeEventListener('click', onClick);
        resolve();
      };
      const onClick = () => armed && done();
      setTimeout(() => {
        armed = true;
        overlay.classList.add('is-armed');
      }, SKIP_GRACE_MS);
      setTimeout(done, STAGES.wipe + 1400);
      overlay.addEventListener('click', onClick);
    });

    overlay.classList.add('is-leaving');
    await new Promise((resolve) => setTimeout(resolve, reducedMotion() ? 0 : 400));
    overlay.remove();
    document.body.classList.remove('is-formatting');
  }

  return { run };
}

/**
 * In-OS confirmation, in place of window.confirm — a native modal in the middle
 * of a themed desktop breaks the fiction, and blocks the render loop.
 *
 * `boost` is the rewarded-ad offer (GDD 8): `{ multiplier, run() }`, where
 * `run()` shows the video and resolves the new payout, or null if it was not
 * watched. Pass nothing and the dialog is exactly what it was before.
 */
export function confirmFormat({ root, dollars, onConfirm, boost = null }) {
  const dialog = el('div', { class: 'confirm-shade' });
  dialog.innerHTML = `
    <div class="window glass confirm" role="region" aria-label="Confirm Format C:">
      <div class="title-bar">
        <div class="title-bar-text">⚠ Format C:</div>
      </div>
      <div class="window-body has-space confirm__body">
        <p><strong>This wipes all software and buddies.</strong></p>
        <p>Your hardware and Dollars stay. You will bank
          <strong data-role="payout">$${dollars.toFixed(2)}</strong>.</p>
        <div class="confirm__actions">
          <button type="button" data-role="cancel">Cancel</button>
          <button type="button" data-role="ok" class="confirm__ok">Format C:</button>
        </div>
      </div>
    </div>
  `;

  const close = () => dialog.remove();
  const payoutNode = dialog.querySelector('[data-role="payout"]');

  /**
   * The payout boost. This is the strongest rewarded placement an idle game
   * has: the player is one click from cashing in an entire run, so the offer
   * lands where its value is most obvious and its refusal costs nothing.
   *
   * It is *above* the confirm button rather than beside it, because a video
   * button next to "Format C:" is a mis-click on the one action in the game
   * that cannot be undone.
   */
  if (boost) {
    const button = el(
      'button',
      {
        type: 'button',
        class: 'ad-button confirm__boost',
        title: 'Watch a short video from a sponsor.',
        onclick: async () => {
          button.disabled = true;
          const payout = await boost.run();
          if (!payout) {
            button.disabled = false;
            return;
          }
          payoutNode.textContent = `$${payout.total.toFixed(2)}`;
          payoutNode.classList.add('is-boosted');
          button.replaceWith(
            el('p', {
              class: 'confirm__boosted',
              text: `Sponsor bonus applied — +$${payout.bonus.toFixed(2)} on this format.`,
            }),
          );
        },
      },
      [
        el('span', { class: 'ad-button__icon', 'aria-hidden': 'true', text: '▶' }),
        el('span', {
          class: 'ad-button__label',
          text: `Bank +${Math.round((boost.multiplier - 1) * 100)}% — $${(
            dollars * boost.multiplier
          ).toFixed(2)}`,
        }),
      ],
    );
    dialog.querySelector('.confirm__actions').before(button);
  }

  dialog.querySelector('[data-role="cancel"]').addEventListener('click', close);
  dialog.querySelector('[data-role="ok"]').addEventListener('click', () => {
    close();
    onConfirm();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });

  root.appendChild(dialog);
  dialog.querySelector('[data-role="ok"]').focus();
  return { close };
}
