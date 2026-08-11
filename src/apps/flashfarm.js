import { formatNumber } from '../core/format.js';
import { createBuyControl, createCelebration, createLockedPanel, createMeter } from '../ui/building.js';
import { clear, el, setBar, throttle } from './../ui/dom.js';

/**
 * FlashFarm — building #8 (GDD v2 §4).
 *
 * Not a farm any more. It is the **hosting platform underneath** one: a server
 * dashboard for running slot sessions on behalf of clients you never see.
 *
 * The redesign matters because of where it puts the player. The first pass was
 * a consumer-facing bundle shop, which cast them as the mark — and an idle game
 * cannot really sell you anything, so the satire had nothing to bite on. Here
 * they are the *operator*: the thing being scaled is somebody else's compulsion
 * loop, metered in spins per second, and the platform is as glossy and eager as
 * any real one because that gloss is aimed at them too. Nobody in this window
 * is gambling. That is the point.
 *
 * The `w32-buy` costume is the provisioning control — "Host Session Loop" — and
 * the shelf beside it sells Slot Cycle Packages: the same `buyUnits` call in
 * bulk, wearing a starburst. It is a costume on one mechanic, never a second
 * economy.
 */

/**
 * The shelf. `units` is the bulk step; everything else is the sales pitch.
 * Deliberately reading like enterprise licensing written by a growth team.
 */
const PACKAGES = [
  { id: 'starter', name: 'Session Licence', units: 5, tag: 'ENTRY TIER', hue: 190 },
  { id: 'cluster', name: 'Slot Cycle Pack', units: 25, tag: 'MOST DEPLOYED', hue: 320 },
  { id: 'enterprise', name: 'Reel Farm Cluster', units: 100, tag: 'UNCAPPED RTP', hue: 45 },
];

/** Client operators. Faceless, plausible, and never actually contacted. */
const CLIENTS = [
  ['LuckySpin Media Ltd', 'CW-2291'],
  ['Aurora Interactive NV', 'CW-4417'],
  ['Meridian Play Group', 'CW-0083'],
  ['Halcyon Gaming BV', 'CW-7752'],
  ['Northgate Digital', 'CW-1108'],
  ['Vela Entertainment', 'CW-5560'],
];

/** The dashboard's alert strip — operations noise, phrased as good news. */
const NOTICES = [
  ['Region eu-west-2 at capacity', 'Provision more cycles'],
  ['Client CW-4417 requests higher RTP ceiling', 'Approve'],
  ['Session length up 34% this hour', 'View cohort'],
  ['Retention model retrained', 'Deploy to all tenants'],
  ['3 tenants exceeded their nightly cap', 'Raise caps'],
  ['Payout variance within target band', 'Acknowledge'],
];

function hash(...values) {
  let h = 0x811c9dc5;
  for (const value of values) {
    h ^= Number(value) + 0x9e3779b9 + (h << 6) + (h >>> 2);
    h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
  }
  return h >>> 0;
}

/** How many client tenants the operation is serving. Grows with the tier. */
const tenantCount = (tier) => Math.min(CLIENTS.length, 1 + Math.floor(Math.log2(tier)));

export function mount(body, { game }) {
  body.classList.add('app-flashfarm');
  body.innerHTML = `
    <div class="ff__bar">
      <span class="ff__wordmark">FlashFarm</span>
      <span class="ff__sub">Session Hosting Platform</span>
      <span class="ff__region" data-role="region">eu-west-2</span>
    </div>

    <div class="ff__kpis">
      <div class="ff__kpi">
        <span class="ff__kpi-label">SPINS / SEC</span>
        <span class="ff__kpi-value" data-role="spins">0</span>
      </div>
      <div class="ff__kpi">
        <span class="ff__kpi-label">ACTIVE LOOPS</span>
        <span class="ff__kpi-value" data-role="loops">0</span>
      </div>
      <div class="ff__kpi">
        <span class="ff__kpi-label">TENANTS</span>
        <span class="ff__kpi-value" data-role="tenants">0</span>
      </div>
    </div>

    <div class="ff__body">
      <div class="ff__main">
        <div class="ff__notice" data-role="notice" hidden>
          <span class="ff__notice-text" data-role="notice-text"></span>
          <button type="button" class="ff__notice-action" data-role="notice-action"></button>
        </div>

        <h4 class="ff__heading">Hosted tenants</h4>
        <ul class="ff__tenants" data-role="tenants-list"></ul>
      </div>

      <aside class="ff__shop" data-role="shop" aria-label="Capacity packages">
        <div class="ff__shop-head">
          <span class="ff__shop-title">ADD CAPACITY</span>
          <span class="ff__shop-sub">Scale your hosting</span>
        </div>
        <div class="ff__packages" data-role="packages"></div>
        <div class="ff__shop-foot" aria-hidden="true">Billed in Buzz. No real money. Obviously.</div>
      </aside>
    </div>

    <div class="ff__status">
      <span data-role="status">No sessions hosted.</span>
      <span data-role="rate"></span>
    </div>

    <div data-role="meter"></div>
    <div data-role="buy"></div>
    <div data-role="locked"></div>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const tenantsRoot = ref('tenants-list');
  const packagesRoot = ref('packages');

  /* ------------------------------------------------------- the shared kit */

  const meter = createMeter({ game, buildingId: 'flashfarm' });
  ref('meter').replaceWith(meter.root);

  const buy = createBuyControl({
    game,
    buildingId: 'flashfarm',
    // Provisioning, not planting. The unit is a session loop the platform runs
    // for somebody else.
    labels: { one: 'Host Session Loop' },
    onBought: () => renderTenants(true),
  });
  buy.root.classList.add('ff__buy');
  ref('buy').replaceWith(buy.root);

  const locked = createLockedPanel({
    game,
    buildingId: 'flashfarm',
    message: 'Provisioning your operator account…',
  });
  ref('locked').replaceWith(locked.root);

  const celebration = createCelebration({
    game,
    buildingId: 'flashfarm',
    host: body,
    render: ({ multiplier }) => [
      el('strong', { class: 'w32celebrate__title', text: 'TIER UPGRADE APPROVED' }),
      el('span', {
        class: 'w32celebrate__body',
        text: `Payout engine relicensed. Cycle throughput is now ×${multiplier}.`,
      }),
    ],
  });

  /* ------------------------------------------------------------ packages */

  for (const pack of PACKAGES) {
    packagesRoot.appendChild(
      el(
        'button',
        {
          type: 'button',
          class: 'ff__package',
          style: `--pack-hue:${pack.hue}`,
          dataset: { pack: pack.id },
          onclick: () => {
            // The same call the provisioning row makes. A shelf that did
            // anything else would be a second economy in a costume.
            const result = game.buyUnits('flashfarm', pack.units);
            if (!result.ok) {
              game.notify(
                'Capacity request declined',
                `${pack.name} needs more Buzz than the account holds.`,
                'warn',
              );
              return;
            }
            renderTenants(true);
          },
        },
        [
          el('span', { class: 'ff__package-tag', text: pack.tag }),
          el('span', { class: 'ff__package-name', text: pack.name }),
          el('span', { class: 'ff__package-units', text: `${pack.units} loops` }),
          el('span', { class: 'ff__package-price', dataset: { role: `price-${pack.id}` } }),
        ],
      ),
    );
  }

  /* ------------------------------------------------------------- notices */

  /**
   * The alert strip.
   *
   * One at a time, capped, and dismissible — this is a dashboard, not the old
   * nag balloons. It pulses rather than moves, for the same reason the balloons
   * ended up doing so: a control that never settles is a control that is hard
   * to click, and "intrusive" must never mean "un-dismissable".
   */
  let noticeSeed = 0;
  let noticeTimer = null;

  function showNotice() {
    if (!game.econ.isBuildingUnlocked(game.state, 'flashfarm')) return;
    if (game.econ.unitsOf(game.state, 'flashfarm') === 0) return;
    const [text, action] = NOTICES[hash(noticeSeed) % NOTICES.length];
    noticeSeed += 1;
    ref('notice-text').textContent = text;
    ref('notice-action').textContent = action;
    ref('notice').hidden = false;
  }

  ref('notice-action').addEventListener('click', () => {
    // Acknowledging is free and changes nothing — the platform simply has
    // another thing to tell you in a moment.
    ref('notice').hidden = true;
    scheduleNotice(2200);
  });

  function scheduleNotice(ms) {
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      showNotice();
      scheduleNotice(6000 + (hash(noticeSeed) % 4000));
    }, ms);
  }

  /* ------------------------------------------------------------- tenants */

  let tenantsKey = null;

  function renderTenants(force = false) {
    const bd = game.econ.getProductionBreakdown(game.state, 'flashfarm');
    const tier = bd.milestoneMultiplier;
    const count = bd.units === 0 ? 0 : tenantCount(tier);
    const key = `${count}|${bd.units}`;
    if (!force && key === tenantsKey) return;
    tenantsKey = key;

    clear(tenantsRoot);
    if (count === 0) {
      tenantsRoot.appendChild(
        el('li', { class: 'ff__empty', text: 'No tenants. Host a session loop to begin.' }),
      );
      return;
    }

    for (let i = 0; i < count; i += 1) {
      const [name, ref_] = CLIENTS[i];
      // Load per tenant: what share of the operation each client is consuming.
      const load = 0.35 + ((hash(i, tier) % 60) / 100);
      const fill = el('div', { class: 'meter__fill' });
      const row = el('li', { class: 'ff__tenant' }, [
        el('span', { class: 'ff__tenant-name', text: name }),
        el('span', { class: 'ff__tenant-ref', text: ref_ }),
        el('span', { class: 'ff__tenant-load' }, el('span', { class: 'ff__tenant-track' }, fill)),
        el('span', {
          class: 'ff__tenant-spins',
          text: `${formatNumber(Math.floor((bd.units / count) * 61))}/s`,
        }),
      ]);
      tenantsRoot.appendChild(row);
      setBar(fill, Math.min(1, load), { warn: 0.85, critical: 0.95 });
    }
  }

  /* --------------------------------------------------------------- update */

  const update = throttle(() => {
    const s = game.state;
    const { econ } = game;
    const unlocked = econ.isBuildingUnlocked(s, 'flashfarm');

    locked.root.hidden = unlocked;
    buy.root.hidden = !unlocked;
    meter.root.hidden = !unlocked;
    ref('shop').hidden = !unlocked;
    if (!unlocked) {
      locked.update();
      return;
    }

    const bd = econ.getProductionBreakdown(s, 'flashfarm');
    const tier = bd.milestoneMultiplier;

    ref('spins').textContent = formatNumber(bd.units * 61 * tier);
    ref('loops').textContent = formatNumber(bd.units);
    ref('tenants').textContent = String(bd.units === 0 ? 0 : tenantCount(tier));
    ref('region').textContent = tier >= 8 ? 'multi-region' : 'eu-west-2';
    ref('status').textContent =
      bd.units === 0
        ? 'No sessions hosted.'
        : `${formatNumber(bd.units)} loops · ${formatNumber(bd.units * 61 * tier)} spins/s`;
    ref('rate').textContent = bd.total > 0 ? `+${formatNumber(bd.total)} Buzz/s` : '';

    for (const pack of PACKAGES) {
      ref(`price-${pack.id}`).textContent = formatNumber(
        econ.unitCostBulk('flashfarm', bd.units, pack.units),
      );
      const { count } = econ.affordableUnits(s, 'flashfarm', pack.units);
      body.querySelector(`[data-pack="${pack.id}"]`).disabled = count < pack.units;
    }

    meter.update();
    buy.update();
    renderTenants();
  }, 150);

  update();
  scheduleNotice(3200);
  const unsubscribe = game.bus.on(game.events.TICK, update);
  return () => {
    unsubscribe();
    clearTimeout(noticeTimer);
    celebration.destroy();
    body.classList.remove('app-flashfarm');
  };
}
