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

  const wait = (ms) =>
    new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        overlay.removeEventListener('click', done);
        resolve();
      };
      // Any click skips the rest of the current stage.
      const timer = setTimeout(done, reducedMotion() ? Math.min(ms, 400) : ms);
      overlay.addEventListener('click', done, { once: true });
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
          <div><dt>Format C: count</dt><dd>${summary.prestigeCount}</dd></div>
          <div><dt>Memory</dt><dd>${summary.ramMB} MB OK</dd></div>
        </dl>
        <p class="bsod__hint">Starting AeroOS…</p>
      </div>
    `;

    // Tick the checklist in one by one so the wipe reads as work being done.
    const items = [...overlay.querySelectorAll('.bsod__steps li')];
    const step = reducedMotion() ? 0 : STAGES.wipe / (items.length + 2);
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

    const summary = applyReset();

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
 * In-OS confirmation, in place of window.confirm — a native modal in the middle
 * of a themed desktop breaks the fiction, and blocks the render loop.
 */
export function confirmFormat({ root, dollars, onConfirm }) {
  const dialog = el('div', { class: 'confirm-shade' });
  dialog.innerHTML = `
    <div class="window glass confirm" role="region" aria-label="Confirm Format C:">
      <div class="title-bar">
        <div class="title-bar-text">⚠ Format C:</div>
      </div>
      <div class="window-body has-space confirm__body">
        <p><strong>This wipes all software and buddies.</strong></p>
        <p>Your hardware and Dollars stay. You will bank
          <strong>$${dollars.toFixed(2)}</strong>.</p>
        <div class="confirm__actions">
          <button type="button" data-role="cancel">Cancel</button>
          <button type="button" data-role="ok" class="confirm__ok">Format C:</button>
        </div>
      </div>
    </div>
  `;

  const close = () => dialog.remove();
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
