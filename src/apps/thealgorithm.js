import { formatNumber } from '../core/format.js';
import { createBuyControl, createCelebration, createLockedPanel, createMeter } from '../ui/building.js';
import { clear, el, setBar, throttle } from './../ui/dom.js';

/**
 * The Algorithm — building #10, and the first of phase 4 (GDD v2 §3.4, §4).
 *
 * A corporate server dashboard. Where phase 3 was loud, this is the opposite:
 * cold, flat, grey, and entirely without personality. That is the erosion GDD
 * §3.4 licenses — not "darker Aero" but *no Aero*, the flat-design vocabulary
 * the rest of the OS spends eleven windows refusing.
 *
 * The `w32-buy` costume is GDD §4's "Allocate Processing Power": the buy row is
 * a resource-allocation control on an admin console, and the thing being
 * allocated is never named. The charts go where they always go — the graph
 * flattens into a single rising line as the tier climbs, because a dashboard
 * that only ever goes up has stopped being a measurement.
 */

const EPOCH_STAGES = [
  'ingest',
  'normalise',
  'embed',
  'cluster',
  'weight',
  'commit',
];

function hash(...values) {
  let h = 0x811c9dc5;
  for (const value of values) {
    h ^= Number(value) + 0x9e3779b9 + (h << 6) + (h >>> 2);
    h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
  }
  return h >>> 0;
}

const SERIES_POINTS = 28;

/**
 * The chart.
 *
 * At tier 1 it is noisy and roughly flat — a real metric. Each tier straightens
 * it and tilts it up, until by ×32 it is a clean diagonal with no variance at
 * all. Returned as an SVG path so the whole series is one node.
 */
function seriesPath(tier, width, height) {
  const straighten = Math.min(1, Math.log2(Math.max(1, tier)) / 5);
  const points = [];
  for (let i = 0; i < SERIES_POINTS; i += 1) {
    const t = i / (SERIES_POINTS - 1);
    const noise = ((hash(i, tier) % 1000) / 1000 - 0.5) * (1 - straighten);
    // Blend a jittery flat line into a clean rising one.
    const value = 0.25 + t * 0.62 * straighten + noise * 0.5 + (1 - straighten) * 0.28;
    points.push([t * width, height - Math.max(0.02, Math.min(0.98, value)) * height]);
  }
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
}

export function mount(body, { game }) {
  body.classList.add('app-thealgorithm');
  body.innerHTML = `
    <div class="alg__bar">
      <span class="alg__wordmark">ALGORITHM</span>
      <span class="alg__env">prod-01</span>
      <span class="alg__health" data-role="health">● nominal</span>
    </div>

    <div class="alg__grid">
      <div class="alg__card">
        <span class="alg__card-label">ALLOCATED CORES</span>
        <span class="alg__card-value" data-role="cores">0</span>
      </div>
      <div class="alg__card">
        <span class="alg__card-label">THROUGHPUT</span>
        <span class="alg__card-value" data-role="throughput">0/s</span>
      </div>
      <div class="alg__card">
        <span class="alg__card-label">EPOCH</span>
        <span class="alg__card-value" data-role="epoch">—</span>
      </div>
    </div>

    <div class="alg__chart">
      <div class="alg__chart-head">
        <span data-role="chart-title">engagement</span>
        <span class="alg__chart-note" data-role="chart-note">last 28 epochs</span>
      </div>
      <svg class="alg__svg" viewBox="0 0 260 84" preserveAspectRatio="none" aria-hidden="true">
        <path class="alg__series" data-role="series" d="" />
      </svg>
    </div>

    <div class="alg__sliders" data-role="sliders" aria-hidden="true"></div>

    <div data-role="meter"></div>
    <div data-role="buy"></div>
    <div data-role="locked"></div>

    <div class="alg__status">
      <span data-role="status">standby</span>
      <span data-role="rate"></span>
    </div>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const slidersRoot = ref('sliders');

  /* ------------------------------------------------------- the shared kit */

  const meter = createMeter({ game, buildingId: 'thealgorithm' });
  ref('meter').replaceWith(meter.root);

  const buy = createBuyControl({
    game,
    buildingId: 'thealgorithm',
    labels: { one: 'Allocate Processing Power' },
  });
  buy.root.classList.add('alg__buy');
  ref('buy').replaceWith(buy.root);

  const locked = createLockedPanel({
    game,
    buildingId: 'thealgorithm',
    message: 'Cluster provisioning. No action required.',
  });
  ref('locked').replaceWith(locked.root);

  /**
   * GDD §4's milestone: an "epoch completed" compile animation. Written in the
   * register of a system reporting to itself — no exclamation marks, nothing
   * addressed to the player, because by this point the software has stopped
   * talking to them.
   */
  const celebration = createCelebration({
    game,
    buildingId: 'thealgorithm',
    host: body,
    render: ({ at, multiplier }) => [
      el('strong', { class: 'w32celebrate__title', text: 'EPOCH COMPLETE' }),
      el('span', {
        class: 'w32celebrate__body',
        text: `${formatNumber(at)} cores committed. Model weights updated. ×${multiplier}.`,
      }),
    ],
  });

  /* -------------------------------------------------------------- sliders */

  /**
   * Six parameter sliders. Read-only: they move because the system is moving
   * them, which is a different statement from a control the player operates.
   * `aria-hidden` on the container — they are a status display shaped like an
   * input, and announcing six unlabelled sliders to a screen reader would be a
   * lie about what they are.
   */
  const SLIDER_COUNT = 6;
  for (let i = 0; i < SLIDER_COUNT; i += 1) {
    slidersRoot.appendChild(
      el('div', { class: 'alg__slider' }, [
        el('span', { class: 'alg__slider-label', text: `p${String(i).padStart(2, '0')}` }),
        el('div', { class: 'alg__slider-track' }, el('div', { class: 'meter__fill', dataset: { role: `slider-${i}` } })),
      ]),
    );
  }

  /* --------------------------------------------------------------- update */

  let chartKey = null;

  const update = throttle(() => {
    const s = game.state;
    const { econ } = game;
    const unlocked = econ.isBuildingUnlocked(s, 'thealgorithm');

    locked.root.hidden = unlocked;
    buy.root.hidden = !unlocked;
    meter.root.hidden = !unlocked;
    if (!unlocked) {
      locked.update();
      return;
    }

    const bd = econ.getProductionBreakdown(s, 'thealgorithm');
    const tier = bd.milestoneMultiplier;

    ref('cores').textContent = formatNumber(bd.units);
    ref('throughput').textContent = `${formatNumber(bd.total)}/s`;
    ref('epoch').textContent = EPOCH_STAGES[Math.floor(Math.log2(tier)) % EPOCH_STAGES.length];
    ref('status').textContent = bd.units === 0 ? 'standby' : `${formatNumber(bd.units * 4096)} vectors resident`;
    ref('rate').textContent = bd.total > 0 ? `+${formatNumber(bd.total)} Buzz/s` : '';

    // The chart only needs redrawing when the tier changes its shape.
    if (chartKey !== tier) {
      chartKey = tier;
      ref('series').setAttribute('d', seriesPath(tier, 260, 84));
      ref('chart-note').textContent =
        tier >= 8 ? 'variance within tolerance' : 'last 28 epochs';
      body.classList.toggle('is-converged', tier >= 8);
    }

    for (let i = 0; i < SLIDER_COUNT; i += 1) {
      // Drifting, not random per frame: the values move slowly with the tier so
      // the panel reads as a system settling rather than a screensaver.
      const value = ((hash(i, Math.floor(s.stats.playtimeSeconds / 3), tier) % 1000) / 1000) * 0.6 + 0.2;
      setBar(ref(`slider-${i}`), value, { warn: 2, critical: 2 });
    }

    meter.update();
    buy.update();
  }, 150);

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);
  return () => {
    unsubscribe();
    celebration.destroy();
    clear(slidersRoot);
    body.classList.remove('app-thealgorithm', 'is-converged');
  };
}
