import { SECURITY } from '../data/balance.js';
import { scanProgress } from '../core/downloads.js';
import { formatDuration } from '../core/format.js';
import { el, setBar, throttle } from './../ui/dom.js';

/**
 * Shield99 (AO-22) — the antivirus.
 *
 * Three states, and the window says which one plainly: protected (open, so
 * real-time protection blocks an infected download outright), exposed (closed
 * or uninstalled), or infected (scan to clean). The free trial rescue is
 * advertised while it is still available, because a safety net nobody knows
 * about does not reduce anxiety.
 */
export function mount(body, { game }) {
  body.classList.add('app-shield');
  body.innerHTML = `
    <div class="sh__hero" data-role="hero">
      <span class="sh__badge" data-role="badge" aria-hidden="true">🛡️</span>
      <div>
        <strong class="sh__state" data-role="state">Protected</strong>
        <span class="sh__sub" data-role="sub">Real-time protection is on.</span>
      </div>
    </div>

    <div class="sh__scan">
      <div class="meter__track"><div class="meter__fill" data-role="scan-bar"></div></div>
      <button type="button" class="sh__button" data-role="scan">Deep scan</button>
    </div>

    <dl class="sh__stats">
      <div><dt>Threats blocked</dt><dd data-role="blocked">0</dd></div>
      <div><dt>Free trial rescue</dt><dd data-role="trial">available</dd></div>
      <div><dt>Definitions</dt><dd>2005.11.14</dd></div>
    </dl>

    <p class="sh__note">
      Keep Shield99 open while LemonWire runs and infected files are stopped on arrival.
      An infection never costs more than half your production, and never your progress.
    </p>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);

  ref('scan').addEventListener('click', () => {
    const result = game.startScan();
    if (!result.ok && result.reason === 'already-scanning') {
      game.notify('Scan running', 'Let it finish.', 'info');
    }
    update();
  });

  const update = throttle(() => {
    const s = game.state;
    const infected = s.security.infection !== null;
    const scanning = s.security.scan !== null;

    const status = infected ? 'infected' : 'protected';
    body.dataset.status = status;
    ref('badge').textContent = infected ? '☣️' : '🛡️';

    ref('state').textContent = infected
      ? 'Threat detected'
      : scanning
        ? 'Scanning…'
        : 'Protected';
    ref('sub').textContent = infected
      ? 'Production is halved until the machine is clean. Run a deep scan.'
      : scanning
        ? `${formatDuration(s.security.scan.secondsLeft)} remaining — keep this window open.`
        : 'Real-time protection is on while this window is open.';

    setBar(ref('scan-bar'), scanning ? scanProgress(s) : 0, { warn: 2, critical: 2 });
    ref('scan').disabled = scanning;
    ref('scan').textContent = scanning ? 'Scanning…' : infected ? 'Clean the machine' : 'Deep scan';
    ref('scan').classList.toggle('is-urgent', infected && !scanning);

    ref('blocked').textContent = String(s.stats.threatsBlocked ?? 0);
    const rescuesLeft = SECURITY.freeRescuesPerRun - s.security.rescuesUsed;
    ref('trial').textContent = rescuesLeft > 0 ? 'available' : 'used this run';
  }, 200);

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);
  return () => {
    unsubscribe();
    delete body.dataset.status;
    body.classList.remove('app-shield');
  };
}

/** Tray icon (AO-22): protection status without opening anything. */
export function createTrayShield({ root, game, launch }) {
  const button = el('button', {
    type: 'button',
    class: 'tray__shield',
    'aria-label': 'Shield99',
    title: 'Shield99',
    onclick: () => launch('shield99'),
  });
  root.prepend(button);

  const update = throttle(() => {
    const s = game.state;
    const installed = s.apps.shield99.installed;
    button.hidden = !installed;
    if (!installed) return;

    const infected = s.security.infection !== null;
    const active = s.apps.shield99.open;
    const status = infected ? 'infected' : active ? 'protected' : 'idle';

    button.dataset.status = status;
    button.textContent = infected ? '☣️' : '🛡️';
    button.title = {
      infected: 'Shield99 — threat detected, open to clean',
      protected: 'Shield99 — real-time protection on',
      idle: 'Shield99 — open for real-time protection',
    }[status];
  }, 300);

  update();
  return { update };
}
