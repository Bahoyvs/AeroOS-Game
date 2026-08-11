import './devPanel.css';
import { formatNumber } from '../core/format.js';

export function mountDevPanel({ game }) {
  if (!import.meta.env.DEV) return;

  /**
   * A handle on the running game, for driving it from outside the page.
   *
   * Dev builds only — it is inside the same guard as the panel itself, so it is
   * never in a production bundle. Some of what this codebase has to verify only
   * exists in a browser (window layout, focus order, whether a moving target can
   * be clicked), and reaching those states through the UI alone would mean
   * playing an idle game for an hour before every check.
   */
  globalThis.__aeroos = game;

  const panel = document.createElement('div');
  panel.className = 'aero-dev-panel';

  const header = document.createElement('div');
  header.className = 'aero-dev-header';
  header.textContent = '🛠 Dev Menu';

  const content = document.createElement('div');
  content.className = 'aero-dev-content';

  const buttons = [
    { label: '+10k Buzz', action: () => game.dev.addBuzz(10000) },
    { label: '+1M Buzz', action: () => game.dev.addBuzz(1000000) },
    { label: '+1B Buzz', action: () => game.dev.addBuzz(1000000000) },
    { label: '+1T Buzz', action: () => game.dev.addBuzz(1000000000000) },
    { label: '+1Q Buzz', action: () => game.dev.addBuzz(1000000000000000) },
    { label: '+1Qi Buzz', action: () => game.dev.addBuzz(1000000000000000000) },
    { label: '+1Sx Buzz', action: () => game.dev.addBuzz(1000000000000000000000) },
    { label: '+1Sp Buzz', action: () => game.dev.addBuzz(1000000000000000000000000) },
    { label: '+1Oc Buzz', action: () => game.dev.addBuzz(1000000000000000000000000000) },
    { label: '+1No Buzz', action: () => game.dev.addBuzz(1000000000000000000000000000000) },
    { label: '+1De Buzz', action: () => game.dev.addBuzz(1000000000000000000000000000000000) },
    { label: '+$1,000', action: () => game.dev.addMoney(1000) },
    { label: 'Skip 1 Hour', action: () => game.dev.skipTime(3600) },
    { label: 'Skip 1 Day', action: () => game.dev.skipTime(86400) },
    { label: 'Clear Cooldowns', action: () => game.dev.clearCooldowns() },
  ];

  for (const btn of buttons) {
    const button = document.createElement('button');
    button.className = 'aero-dev-btn';
    button.textContent = btn.label;
    button.onclick = btn.action;
    content.appendChild(button);
  }

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'aero-dev-toggle';
  toggleBtn.innerHTML = '🛠';
  toggleBtn.onclick = () => panel.classList.toggle('is-open');
  toggleBtn.title = 'Toggle Dev Menu';

  panel.appendChild(header);
  panel.appendChild(content);
  panel.appendChild(toggleBtn);
  document.body.appendChild(panel);

  // Keyboard shortcut to toggle: Ctrl+Shift+D
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
      panel.classList.toggle('is-open');
    }
  });
}
