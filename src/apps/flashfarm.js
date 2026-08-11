import { formatNumber } from '../core/format.js';
import { createBuyControl, createCelebration, createLockedPanel, createMeter } from '../ui/building.js';
import { clear, el, throttle } from './../ui/dom.js';

/**
 * FlashFarm — building #8 (GDD v2 §4).
 *
 * A satirical FarmVille, and the loudest window in the game on purpose. Phase 3
 * is where the OS stops being innocent, and FlashFarm's particular dishonesty
 * is *commercial*: it is the only app that tries to sell you something.
 *
 * The micro-transaction shop down the right-hand side is deliberately too
 * bright, too glossy and slightly too animated — it is styled to be a little
 * unpleasant next to the Aero chrome around it, because that contrast is the
 * joke. Nothing in it is a real purchase and nothing in it is a real IAP: every
 * price is in Buzz, and pressing a bundle is the same `buyUnits` call the
 * `w32-buy` row makes. It is a *costume* on the building's only mechanic.
 *
 * The gift-request balloons over the farm are GDD §4's "kapatılamaz bildirim
 * balonları" — they nag, they overlap the crops, and closing one spawns the
 * next. They cost the player nothing; the only thing they take is attention,
 * which is exactly what the building is about.
 */

/**
 * The shop shelf. Prices are in *units*, not currency — a "bundle" is a bulk
 * buy of the same thing the plain button buys, wearing a starburst.
 */
const BUNDLES = [
  { id: 'starter', name: 'Starter Pack', units: 5, tag: 'BEST VALUE!', hue: 32 },
  { id: 'barn', name: 'Barn Bundle', units: 25, tag: 'MOST POPULAR', hue: 320 },
  { id: 'harvest', name: 'Mega Harvest', units: 100, tag: 'LIMITED TIME', hue: 260 },
];

/** What the balloons ask for. Escalating, and never once taking no. */
const REQUESTS = [
  ['Sandra needs a Fence Post!', 'Send one?'],
  ['Your Turnips are withering!', 'Revive for 3 Farm Bucks'],
  ['Dave sent you a Cow!', 'Accept and send one back'],
  ['You have 47 unclaimed gifts', 'Claim all'],
  ['Your farm misses you', 'Come back tomorrow for a bonus'],
  ['Marie invited you to Farm Club', 'Join now'],
  ['Only 4 hours left!', 'Do not lose your streak'],
];

const CROPS = ['🌽', '🍅', '🥕', '🌾', '🥬', '🍓'];

function hash(...values) {
  let h = 0x811c9dc5;
  for (const value of values) {
    h ^= Number(value) + 0x9e3779b9 + (h << 6) + (h >>> 2);
    h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
  }
  return h >>> 0;
}

/** Plots shown, and how crowded they get. 30 is a screen full of noise. */
const plotCount = (units) => Math.min(30, units);

export function mount(body, { game }) {
  body.classList.add('app-flashfarm');
  body.innerHTML = `
    <div class="ff__bar">
      <span class="ff__wordmark">FlashFarm</span>
      <span class="ff__bucks" data-role="bucks">🪙 0 Farm Bucks</span>
      <span class="ff__level" data-role="level">Lv 1</span>
    </div>

    <div class="ff__body">
      <div class="ff__field" data-role="field">
        <div class="ff__plots" data-role="plots" aria-label="Your farm"></div>
        <div class="ff__balloons" data-role="balloons" aria-live="polite"></div>
      </div>

      <aside class="ff__shop" data-role="shop" aria-label="Farm Bucks Shop">
        <div class="ff__shop-head">
          <span class="ff__shop-title">FARM BUCKS</span>
          <span class="ff__shop-sub">Grow faster!</span>
        </div>
        <div class="ff__bundles" data-role="bundles"></div>
        <div class="ff__shop-foot" aria-hidden="true">Prices in Buzz. No real money. Obviously.</div>
      </aside>
    </div>

    <div class="ff__status">
      <span data-role="status">Your farm is empty.</span>
      <span data-role="rate"></span>
    </div>

    <div data-role="meter"></div>
    <div data-role="buy"></div>
    <div data-role="locked"></div>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const plotsRoot = ref('plots');
  const balloonRoot = ref('balloons');
  const bundlesRoot = ref('bundles');

  /* ------------------------------------------------------- the shared kit */

  const meter = createMeter({ game, buildingId: 'flashfarm' });
  ref('meter').replaceWith(meter.root);

  const buy = createBuyControl({
    game,
    buildingId: 'flashfarm',
    labels: { one: '＋ Plant' },
    onBought: () => renderPlots(true),
  });
  buy.root.classList.add('ff__buy');
  ref('buy').replaceWith(buy.root);

  const locked = createLockedPanel({
    game,
    buildingId: 'flashfarm',
    message: 'Loading FlashFarm… 14%',
  });
  ref('locked').replaceWith(locked.root);

  const celebration = createCelebration({
    game,
    buildingId: 'flashfarm',
    host: body,
    render: ({ multiplier, minigameUnlocked }) => [
      el('strong', { class: 'w32celebrate__title', text: '🎁 A friend sent you a gift!' }),
      el('span', {
        class: 'w32celebrate__body',
        text: `Free Deluxe Fertiliser applied. Yield is now ×${multiplier}.`,
      }),
      ...(minigameUnlocked
        ? [el('em', { class: 'w32celebrate__extra', text: 'Decline Gift Requests unlocked' })]
        : []),
    ],
  });

  /* ---------------------------------------------------------------- shop */

  for (const bundle of BUNDLES) {
    bundlesRoot.appendChild(
      el(
        'button',
        {
          type: 'button',
          class: 'ff__bundle',
          style: `--bundle-hue:${bundle.hue}`,
          dataset: { bundle: bundle.id },
          onclick: () => {
            // The same call the plain buy row makes. A shop that did anything
            // else would be a second economy in a satirical costume.
            const result = game.buyUnits('flashfarm', bundle.units);
            if (!result.ok) {
              game.notify(
                'Not enough Buzz',
                `${bundle.name} needs more than you have. Your crops are fine. Probably.`,
                'warn',
              );
              return;
            }
            renderPlots(true);
          },
        },
        [
          el('span', { class: 'ff__bundle-tag', text: bundle.tag }),
          el('span', { class: 'ff__bundle-art', 'aria-hidden': 'true', text: '🪙' }),
          el('span', { class: 'ff__bundle-name', text: bundle.name }),
          el('span', { class: 'ff__bundle-units', text: `${bundle.units} plots` }),
          el('span', { class: 'ff__bundle-price', dataset: { role: `price-${bundle.id}` } }),
        ],
      ),
    );
  }

  /* ------------------------------------------------------------- balloons */

  /**
   * The nagging.
   *
   * Simulation-independent and capped at three on screen: this is decoration
   * with a pulse, not a mechanic, and it must never become a performance
   * problem in a window the player leaves open. Dismissing one schedules the
   * next, which is the point — the app does not stop asking.
   */
  const MAX_BALLOONS = 3;
  let balloonSeed = 0;
  let balloonTimer = null;

  function spawnBalloon() {
    if (!game.econ.isBuildingUnlocked(game.state, 'flashfarm')) return;
    if (game.econ.unitsOf(game.state, 'flashfarm') === 0) return;
    if (balloonRoot.childElementCount >= MAX_BALLOONS) return;

    const [title, action] = REQUESTS[hash(balloonSeed) % REQUESTS.length];
    balloonSeed += 1;

    const node = el('div', { class: 'ff__balloon' }, [
      el('span', { class: 'ff__balloon-title', text: title }),
      el('span', { class: 'ff__balloon-action', text: action }),
      el('button', {
        type: 'button',
        class: 'ff__balloon-close',
        'aria-label': 'Dismiss request',
        text: '×',
        onclick: () => {
          node.remove();
          // ...and immediately queue another. Closing one is not an exit.
          schedule(1200);
        },
      }),
    ]);
    balloonRoot.appendChild(node);
  }

  function schedule(ms) {
    clearTimeout(balloonTimer);
    balloonTimer = setTimeout(() => {
      spawnBalloon();
      schedule(4200 + hash(balloonSeed) % 3000);
    }, ms);
  }

  /* ---------------------------------------------------------------- plots */

  let plotsKey = null;

  function renderPlots(force = false) {
    const units = game.econ.unitsOf(game.state, 'flashfarm');
    const count = plotCount(units);
    if (!force && count === plotsKey) return;
    plotsKey = count;

    clear(plotsRoot);
    for (let i = 0; i < count; i += 1) {
      const seed = hash(i);
      // One plot in seven is withering, which is what the shop is *for*.
      const withering = seed % 7 === 0;
      plotsRoot.appendChild(
        el('span', {
          class: `ff__plot${withering ? ' is-withering' : ''}`,
          text: withering ? '🥀' : CROPS[seed % CROPS.length],
        }),
      );
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
    ref('bucks').textContent = `🪙 ${formatNumber(bd.units * 3)} Farm Bucks`;
    ref('level').textContent = `Lv ${1 + Math.floor(Math.log2(bd.milestoneMultiplier)) * 7}`;
    ref('status').textContent =
      bd.units === 0 ? 'Your farm is empty.' : `${formatNumber(bd.units)} plots · 47 unclaimed gifts`;
    ref('rate').textContent = bd.total > 0 ? `+${formatNumber(bd.total)} Buzz/s` : '';

    for (const bundle of BUNDLES) {
      const node = ref(`price-${bundle.id}`);
      const { count, cost } = econ.affordableUnits(s, 'flashfarm', bundle.units);
      const full = econ.unitCostBulk('flashfarm', bd.units, bundle.units);
      node.textContent = formatNumber(full);
      body.querySelector(`[data-bundle="${bundle.id}"]`).disabled = count < bundle.units;
      void cost;
    }

    meter.update();
    buy.update();
    renderPlots();
  }, 150);

  update();
  schedule(2600);
  const unsubscribe = game.bus.on(game.events.TICK, update);
  return () => {
    unsubscribe();
    clearTimeout(balloonTimer);
    celebration.destroy();
    body.classList.remove('app-flashfarm');
  };
}
