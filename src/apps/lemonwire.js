import { LEMONWIRE } from '../data/balance.js';
import { riskLabel } from '../data/files.js';
import { uploadKBps } from '../core/lemonwire.js';
import { formatNumber } from '../core/format.js';
import { createBuyControl, createCelebration, createLockedPanel, createMeter } from '../ui/building.js';
import { clear, el, setBar, throttle } from './../ui/dom.js';

/**
 * LemonWire — building #5 (GDD v2 §4).
 *
 * The app used to ask the player to pick three files and tend them. It now asks
 * the only question the redesign leaves any building: how many more? Everything
 * else — which files the swarm is sharing, how full the disk is, how many green
 * bars are lit — is *derived* from the unit count and shown, not chosen.
 *
 * The `w32-buy` costume (GDD §3.1) is the one control this app has always had:
 * a Search box with a Download button under it. Pressing Download is buying
 * units; the swarm list underneath is what those units turned into. The player
 * never sees a "buy" verb or a bare number.
 */

const sizeText = (gb) => (gb < 1 ? `${Math.round(gb * 1024)} MB` : `${gb.toFixed(1)} GB`);

/** The list's type column. `kind` comes from src/data/files.js. */
const KIND_GLYPH = {
  audio: '♪',
  video: '▶',
  image: '▣',
  archive: '🗜',
  disc: '💿',
  program: '⚙',
};

/**
 * Decorative chrome: the category tabs and the sidebar filters are period
 * dressing, not controls. They are aria-hidden and not focusable — a screen
 * reader announcing five tabs that do nothing is worse than not announcing
 * them, and the real navigation is the list below.
 */
const CATEGORY_TABS = ['Audio', 'Video', 'Images', 'Documents', 'Programs'];
const CATEGORY_COUNTS = ['12,481', '3,912', '981', '402', '66'];

/** Demand as words, so the reason a row pays well is legible at a glance. */
function demandLabel(demand) {
  if (demand >= 1.6) return 'rare';
  if (demand >= 1) return 'wanted';
  if (demand >= 0.7) return 'common';
  return 'saturated';
}

export function mount(body, { game }) {
  body.classList.add('app-lemonwire');
  body.innerHTML = `
    <div class="lw__chrome">
      <span class="lw__logo" aria-hidden="true">🍋</span>
      <span class="lw__wordmark">LemonWire<small data-role="edition">4.9</small></span>
      <div class="lw__search" aria-hidden="true">
        <span class="lw__search-field">frutiger aero mix</span>
        <span class="lw__search-go">Search</span>
      </div>
    </div>

    <div class="lw__tabs" aria-hidden="true">
      ${CATEGORY_TABS.map(
        (label, i) => `<span class="lw__tab${i === 0 ? ' is-active' : ''}">${label}</span>`,
      ).join('')}
    </div>

    <aside class="lw__side">
      <h5 class="lw__side-heading" aria-hidden="true">Filters</h5>
      <ul class="lw__filters" aria-hidden="true">
        ${CATEGORY_TABS.map(
          (label, i) =>
            `<li><span>${label}</span><span class="lw__filter-count">${CATEGORY_COUNTS[i]}</span></li>`,
        ).join('')}
      </ul>

      <h5 class="lw__side-heading">Connection</h5>
      <div class="lw__connection">
        <strong data-role="conn-label"></strong>
        <div class="lw__bars" data-role="conn-bars" aria-hidden="true"></div>
        <span class="lw__conn-note" data-role="conn-note"></span>
      </div>

      <h5 class="lw__side-heading">Disk</h5>
      <div class="lw__disk">
        <div class="lw__disk-label">
          <span>Used</span><span data-role="disk-text">0 / 0 GB</span>
        </div>
        <div class="lw__pbar"><div class="meter__fill" data-role="disk-bar"></div></div>
      </div>
    </aside>

    <div class="lw__main">
      <div class="lw__bar">
        <span class="lw__status" data-role="status">Connecting…</span>
        <span class="lw__uprate" data-role="uprate"></span>
      </div>

      <div data-role="meter"></div>

      <h4 class="lw__heading">Sharing <small data-role="peer-count"></small></h4>
      <div class="lw__columns" aria-hidden="true">
        <span></span><span>Name</span><span>Peers</span><span>Size</span><span>Up</span>
      </div>
      <ul class="lw__results" data-role="results"></ul>

      <div data-role="buy"></div>
      <div data-role="locked"></div>
    </div>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const resultsRoot = ref('results');

  /* ------------------------------------------------------- the shared kit */

  const meter = createMeter({ game, buildingId: 'lemonwire' });
  ref('meter').replaceWith(meter.root);

  const buy = createBuyControl({
    game,
    buildingId: 'lemonwire',
    // The download button *is* the purchase — the app's own verb, never "buy".
    labels: { one: 'Download' },
    onBought: () => renderSwarm(true),
  });
  ref('buy').replaceWith(buy.root);

  const locked = createLockedPanel({
    game,
    buildingId: 'lemonwire',
    message: 'Searching for peers…',
  });
  ref('locked').replaceWith(locked.root);

  /**
   * LemonWire's milestone moment is the one GDD §4 calls for by name: the
   * "Upgraded to PRO!" banner and its fake activation flow. It costs nothing,
   * decides nothing, and is the whole reason the upgrade shop could be deleted
   * without the app feeling emptier.
   */
  const celebration = createCelebration({
    game,
    buildingId: 'lemonwire',
    host: body,
    render: ({ multiplier }) => {
      const connection = game.econ.lemonwireConnection(game.state);
      return [
        el('strong', { class: 'w32celebrate__title', text: 'Upgraded to PRO!' }),
        el('span', {
          class: 'w32celebrate__body',
          text: `${connection.label} unlocked — the swarm is ×${multiplier} faster.`,
        }),
      ];
    },
  });

  /* -------------------------------------------------------------- swarm */

  let swarmKey = null;

  function renderSwarm(force = false) {
    const rows = game.econ.lemonwireSwarm(game.state, 8);
    const key = rows.map((r) => `${r.file.id}:${r.peers}`).join('|');
    if (!force && key === swarmKey) return;
    swarmKey = key;

    clear(resultsRoot);

    if (rows.length === 0) {
      resultsRoot.appendChild(
        el('li', { class: 'lw__empty', text: 'No peers yet. Download something.' }),
      );
      return;
    }

    for (const { file, peers, weight } of rows) {
      const risk = riskLabel(file.risk);
      const demand = demandLabel(weight.demand);
      resultsRoot.appendChild(
        el('li', {}, [
          el(
            'div',
            {
              class: 'lw__result',
              title: `${file.name}\n${sizeText(file.sizeGB)} · ${demand} in the swarm · ${risk} risk`,
            },
            [
              el('span', { class: 'lw__result-row' }, [
                el('span', {
                  class: 'lw__kind',
                  'aria-hidden': 'true',
                  text: KIND_GLYPH[file.kind] ?? '▤',
                }),
                el('span', { class: 'lw__file-name', text: file.name }),
                el('span', { class: 'lw__file-swarm', text: `${peers}` }),
                el('span', { class: 'lw__file-size', text: sizeText(file.sizeGB * peers) }),
                el('span', {
                  class: 'lw__result-rate',
                  text: `↑ ${uploadKBps(file.id, peers)} KB/s`,
                }),
              ]),
              el('span', { class: 'lw__file-meta' }, [
                el('span', { class: `lw__demand is-${demand}`, text: demand }),
                el('span', { class: `lw__risk is-${risk}`, text: `${risk} risk` }),
              ]),
            ],
          ),
        ]),
      );
    }
  }

  /* --------------------------------------------------------------- update */

  const update = throttle(() => {
    const s = game.state;
    const { econ } = game;
    const now = Date.now();
    const unlocked = econ.isBuildingUnlocked(s, 'lemonwire');

    // Locked and unlocked are the same window with different halves showing:
    // the chrome is the point, and hiding it entirely would make the app feel
    // like it arrived rather than like it was always there, waiting.
    locked.root.hidden = unlocked;
    buy.root.hidden = !unlocked;
    meter.root.hidden = !unlocked;
    if (!unlocked) {
      locked.update();
      return;
    }

    const bd = econ.getProductionBreakdown(s, 'lemonwire', now);
    const connection = econ.lemonwireConnection(s);

    ref('edition').textContent = bd.milestoneMultiplier > 1 ? 'PRO 4.9' : '4.9';
    ref('conn-label').textContent = connection.label;
    ref('conn-note').textContent = `${econ.lemonwireRisk(s).toFixed(1)} risk shared`;

    // Five bars, lit to the milestone tier — GDD §4's visual progression.
    const bars = ref('conn-bars');
    const lit = LEMONWIRE.connections.indexOf(connection) + 1;
    if (bars.childElementCount !== 5) {
      clear(bars);
      for (let i = 0; i < 5; i += 1) bars.appendChild(el('span', { class: 'lw__bar-tick' }));
    }
    [...bars.children].forEach((tick, i) => tick.classList.toggle('is-lit', i < lit));

    const used = econ.lemonwireDiskUsedGB(s);
    const capacity = econ.storageCapacityGB(s);
    ref('disk-text').textContent = `${used.toFixed(2)} / ${capacity} GB`;
    setBar(ref('disk-bar'), capacity === 0 ? 0 : used / capacity, { warn: 0.8, critical: 0.95 });

    ref('peer-count').textContent = `(${bd.units} ${bd.units === 1 ? 'peer' : 'peers'})`;
    ref('status').textContent =
      bd.units === 0 ? 'Connected to 1,204 peers' : `Sharing with ${bd.units} peers`;
    ref('uprate').textContent = bd.total > 0 ? `+${formatNumber(bd.total)} Buzz/s` : '';

    meter.update();
    buy.update();
    renderSwarm();
  }, 150);

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);
  return () => {
    unsubscribe();
    celebration.destroy();
    body.classList.remove('app-lemonwire');
  };
}
