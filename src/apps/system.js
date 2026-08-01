import { formatBytesMB, formatDuration, formatNumber } from '../core/format.js';
import { HARDWARE } from '../data/hardware.js';
import { clear, el, throttle } from './../ui/dom.js';

/**
 * "My Computer" — hardware shop, run statistics and the Format C: button
 * (GDD 5). Hardware rows are always visible here; the onboarding flow (Day 7)
 * decides when the icon itself first appears on the desktop.
 */
export function mount(body, { game }) {
  body.classList.add('app-system');
  body.innerHTML = `
    <div class="sys__summary glass">
      <div><span>Buzz</span><strong data-role="buzz">0</strong></div>
      <div><span>Per second</span><strong data-role="rate">0</strong></div>
      <div><span>Dollars</span><strong data-role="dollars">$0.00</strong></div>
      <div><span>Uptime</span><strong data-role="uptime">0s</strong></div>
    </div>

    <h4 class="sys__heading">Hardware</h4>
    <div class="sys__hardware" data-role="hardware"></div>

    <h4 class="sys__heading">Format C:</h4>
    <p class="sys__prestige-copy" data-role="prestige-copy"></p>
    <button type="button" class="sys__format" data-role="format">Format C:</button>
    <button type="button" class="sys__wipe" data-role="wipe">Erase save</button>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const hardwareRoot = ref('hardware');
  const rows = new Map();

  for (const [track, meta] of Object.entries(HARDWARE)) {
    const row = el('div', { class: 'hw-row' }, [
      el('div', { class: 'hw-row__info' }, [
        el('strong', { class: 'hw-row__label', text: meta.label }),
        el('span', { class: 'hw-row__current', dataset: { role: `${track}-current` } }),
        el('small', { class: 'hw-row__blurb', text: meta.blurb }),
      ]),
      el('button', {
        type: 'button',
        class: 'hw-row__buy',
        dataset: { role: `${track}-buy` },
        onclick: () => {
          const result = game.buyHardware(track);
          if (result.ok) {
            game.notify(`${meta.label} upgraded`, result.tier.name, 'success');
          } else if (result.reason === 'too-expensive') {
            game.notify('Not enough Dollars', 'Format C: to earn more.', 'warn');
          }
          update();
        },
      }),
    ]);
    hardwareRoot.appendChild(row);
    rows.set(track, {
      current: row.querySelector(`[data-role="${track}-current"]`),
      buy: row.querySelector(`[data-role="${track}-buy"]`),
    });
  }

  ref('format').addEventListener('click', () => {
    const dollars = game.econ.pendingPrestigeDollars(game.state);
    if (dollars <= 0) {
      game.notify('Not yet', 'This run has not earned a payout yet.', 'warn');
      return;
    }
    if (!confirm(`Format C: wipes all software and buddies.\n\nYou will receive $${dollars.toFixed(2)}. Continue?`)) return;
    const result = game.formatC();
    if (result.ok) {
      game.notify('Format complete', `Banked $${result.dollars.toFixed(2)}.`, 'success');
    }
    update();
  });

  ref('wipe').addEventListener('click', () => {
    if (!confirm('Erase your save and start from a clean desktop? This cannot be undone.')) return;
    game.hardReset();
    location.reload();
  });

  const update = throttle(() => {
    const s = game.state;
    const { econ } = game;

    ref('buzz').textContent = formatNumber(s.buzz);
    ref('rate').textContent = `${formatNumber(econ.buzzPerSecond(s))}/s`;
    ref('dollars').textContent = `$${s.dollars.toFixed(2)}`;
    ref('uptime').textContent = formatDuration(s.stats.playtimeSeconds);

    for (const entry of econ.hardwareSummary(s)) {
      const row = rows.get(entry.track);
      const detail =
        entry.track === 'ram'
          ? formatBytesMB(entry.current.capacity)
          : entry.track === 'hdd'
            ? `${entry.current.capacityGB} GB · ${entry.current.offlineHours}h offline`
            : entry.track === 'cpu'
              ? `×${entry.current.tickRate.toFixed(2)} tick · ×${entry.current.clickPower} click`
              : `×${entry.current.cooldownMultiplier.toFixed(2)} cooldown`;
      row.current.textContent = `${entry.current.name} — ${detail}`;
      row.buy.textContent = entry.next ? `${entry.next.name} · $${entry.next.cost}` : 'Maxed out';
      row.buy.disabled = !entry.next || !entry.affordable;
    }

    const pending = econ.pendingPrestigeDollars(s);
    ref('prestige-copy').textContent =
      pending > 0
        ? `Wipes software and buddies. Pays $${pending.toFixed(2)} for ${formatNumber(s.lifetimeBuzz)} lifetime Buzz.`
        : `Keep producing — Format C: pays out once your lifetime Buzz is worth more than the $${s.dollarsEarnedTotal.toFixed(2)} already banked.`;
    ref('format').disabled = pending <= 0;
  }, 200);

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);
  return () => {
    unsubscribe();
    clear(hardwareRoot);
    body.classList.remove('app-system');
  };
}
