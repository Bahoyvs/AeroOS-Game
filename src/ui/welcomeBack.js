import { formatDuration, formatNumber } from '../core/format.js';
import { el } from './dom.js';

/**
 * The "welcome back" report (AO-28).
 *
 * The offline calculation itself has existed since Day 1 — capped by the HDD
 * tier and taxed by OFFLINE.efficiency. What it lacked was a moment: a balloon
 * that fades after four seconds is a poor way to tell somebody what happened
 * while they were gone, and it gave the HDD cap nowhere to explain itself.
 *
 * The "watch a sponsor video to 2× your offline Buzz" slot from GDD 8 goes in
 * this dialog on the monetization day — `onDouble` is the seam, and the button
 * simply does not render until an adapter is passed.
 */
export function showWelcomeBack({ root, offline, hoursCap, onDouble = null, onClose }) {
  const shade = el('div', { class: 'confirm-shade welcome-shade' });

  shade.innerHTML = `
    <div class="window glass welcome" role="region" aria-label="Welcome back">
      <div class="title-bar">
        <div class="title-bar-text">☕ Welcome back</div>
      </div>
      <div class="window-body has-space welcome__body">
        <p class="welcome__lede">Your buddies kept chatting while you were away.</p>

        <dl class="welcome__stats">
          <div><dt>Away for</dt><dd data-role="away"></dd></div>
          <div><dt>Counted</dt><dd data-role="counted"></dd></div>
          <div><dt>Buzz earned</dt><dd class="welcome__buzz" data-role="buzz"></dd></div>
        </dl>

        <p class="welcome__cap" data-role="cap" hidden></p>
        <div class="welcome__actions" data-role="actions">
          <button type="button" data-role="ok">Back to work</button>
        </div>
      </div>
    </div>
  `;

  const ref = (role) => shade.querySelector(`[data-role="${role}"]`);

  ref('away').textContent = formatDuration(offline.elapsedSeconds ?? offline.seconds);
  ref('counted').textContent = formatDuration(offline.seconds);
  ref('buzz').textContent = `+${formatNumber(offline.buzz)}`;

  if (offline.capped) {
    const cap = ref('cap');
    cap.hidden = false;
    cap.textContent = `Your HDD only banks ${hoursCap} hours of Buzz — the rest of the time was not counted. A bigger drive stores more.`;
  }

  // The rewarded-ad slot (GDD 8). Renders only when something can fulfil it.
  if (onDouble) {
    ref('actions').prepend(
      el('button', {
        type: 'button',
        class: 'welcome__double',
        text: '2× offline Buzz',
        onclick: () => {
          onDouble();
          close();
        },
      }),
    );
  }

  function close() {
    shade.remove();
    onClose?.();
  }

  ref('ok').addEventListener('click', close);
  shade.addEventListener('click', (e) => {
    if (e.target === shade) close();
  });

  root.appendChild(shade);
  ref('ok').focus();
  return { close };
}
