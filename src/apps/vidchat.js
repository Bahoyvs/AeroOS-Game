import { formatNumber } from '../core/format.js';
import { createBuyControl, createCelebration, createLockedPanel, createMeter } from '../ui/building.js';
import { clear, el, throttle } from './../ui/dom.js';

/**
 * VidChat — building #7, and the first window of the addiction layer
 * (GDD v2 §1 phase 3, §4).
 *
 * Early Skype crossed with Chatroulette: a grid of strangers, none of whom you
 * chose, all of them arriving over a connection that cannot carry them. The
 * skeuomorphic brief for phase 3 is that the OS stops being innocent, and the
 * way this window does it is by *failing convincingly* — the feeds are meant to
 * look degraded and slightly wrong, not slick.
 *
 * Every "webcam" is CSS over a two-tone gradient: no images, no video, no
 * canvas. A face is a handful of blocks at low resolution, and the tearing,
 * chroma split and scanlines are the same three effects a 2007 codec produced
 * when it gave up. Deterministic per tile, so a face does not reshuffle on
 * every render — a grid that churns reads as decorative, and this one is
 * supposed to read as *people*.
 *
 * The `w32-buy` costume is GDD §4's pair: **Next Partner** for one, and the
 * bulk steps stand in for the Bandwidth slider.
 */

/** Status lines under a tile. Uncomfortable by design — nobody is having fun. */
const CAPTIONS = [
  'connecting…',
  'no audio',
  'camera in use by another program',
  'signal weak',
  'stranger is typing',
  'reconnecting (4)',
  'stranger disconnected',
  'bandwidth limited',
];

const REGIONS = ['NL', 'BR', 'RU', 'US', 'DE', 'PH', 'UA', 'TR', 'ID', 'PL'];

function hash(...values) {
  let h = 0x811c9dc5;
  for (const value of values) {
    h ^= Number(value) + 0x9e3779b9 + (h << 6) + (h >>> 2);
    h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
  }
  return h >>> 0;
}

/**
 * One stranger, derived from the tile index.
 *
 * `hue`/`skin` place a face; `tear`, `shift` and `dead` decide how badly the
 * feed is failing. A *quarter* of tiles are dead air — that ratio is the whole
 * unnerving effect, because it means the grid is mostly people and sometimes
 * nobody, which is worse than either.
 */
function partnerAt(index, tier) {
  const seed = hash(index);
  return {
    region: REGIONS[seed % REGIONS.length],
    caption: CAPTIONS[(seed >>> 3) % CAPTIONS.length],
    // A narrow, *desaturated* band. The first pass ran hot on both hue and
    // saturation and the tiles read as orange test-cards rather than as people
    // behind a dying codec — which is a different kind of wrong: unsettling
    // needs the viewer to recognise a face first.
    skin: 12 + ((seed >>> 5) % 30),
    light: 30 + ((seed >>> 9) % 24),
    tear: (seed >>> 13) % 5, // how many torn scanline rows
    shift: ((seed >>> 17) % 9) - 4, // chroma split, in pixels
    dead: (seed >>> 21) % 4 === 0,
    // Deeper tiers mean more feeds, and worse ones: the network is not coping.
    rot: Math.min(3, Math.floor(Math.log2(Math.max(1, tier)))),
  };
}

/**
 * How many tiles the grid shows at a given tier — it widens as you buy in.
 *
 * Three per tier rather than two: at ×4 the old count left most of the grid
 * empty, which read as a window that had failed to load rather than a network
 * that is mostly strangers and sometimes nobody.
 */
const tileCount = (tier) => Math.min(12, 3 + Math.floor(Math.log2(tier)) * 3);

export function mount(body, { game }) {
  body.classList.add('app-vidchat');
  body.innerHTML = `
    <div class="vc__bar">
      <span class="vc__logo" aria-hidden="true">◉</span>
      <span class="vc__wordmark">VidChat</span>
      <span class="vc__peers" data-role="peers">no one online</span>
    </div>

    <div class="vc__grid" data-role="grid" aria-label="Active streams"></div>

    <div class="vc__status">
      <span data-role="status">Looking for someone…</span>
      <span data-role="rate"></span>
    </div>

    <div data-role="meter"></div>
    <div data-role="buy"></div>
    <div data-role="locked"></div>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const grid = ref('grid');

  /* ------------------------------------------------------- the shared kit */

  const meter = createMeter({ game, buildingId: 'vidchat' });
  ref('meter').replaceWith(meter.root);

  const buy = createBuyControl({
    game,
    buildingId: 'vidchat',
    labels: { one: 'Next Partner ▸' },
    onBought: () => renderGrid(true),
  });
  buy.root.classList.add('vc__buy');
  ref('buy').replaceWith(buy.root);

  const locked = createLockedPanel({
    game,
    buildingId: 'vidchat',
    message: 'Waiting for a camera…',
  });
  ref('locked').replaceWith(locked.root);

  /**
   * GDD §4's milestone: a Webcam Settings notice announcing an "enhancement"
   * nobody asked for. It is written in the register of software doing something
   * to you and calling it an improvement — which is the phase-3 thesis in one
   * balloon.
   */
  const ENHANCEMENTS = [
    'Auto-accept incoming streams is now ON.',
    'Face tracking enabled. Keep your head still.',
    'Your camera will stay on between calls.',
    'Preview quality reduced to serve more partners.',
    'Session recording enabled for quality purposes.',
  ];

  const celebration = createCelebration({
    game,
    buildingId: 'vidchat',
    host: body,
    render: ({ multiplier, minigameUnlocked }) => {
      const index = Math.min(ENHANCEMENTS.length - 1, Math.floor(Math.log2(Math.max(1, multiplier))));
      return [
        el('strong', { class: 'w32celebrate__title', text: 'Webcam Settings updated' }),
        el('span', { class: 'w32celebrate__body', text: ENHANCEMENTS[index] }),
        el('em', { class: 'w32celebrate__extra', text: `Throughput ×${multiplier}` }),
        ...(minigameUnlocked
          ? [el('em', { class: 'w32celebrate__extra', text: 'Latency Sync unlocked' })]
          : []),
      ];
    },
  });

  /* ---------------------------------------------------------------- grid */

  let gridKey = null;

  function renderGrid(force = false) {
    const bd = game.econ.getProductionBreakdown(game.state, 'vidchat');
    const tier = bd.milestoneMultiplier;
    const count = bd.units === 0 ? 0 : tileCount(tier);
    const key = `${count}|${tier}`;
    if (!force && key === gridKey) return;
    gridKey = key;

    clear(grid);

    if (count === 0) {
      grid.appendChild(el('p', { class: 'vc__empty', text: 'No one is online. Try again.' }));
      return;
    }

    for (let i = 0; i < count; i += 1) {
      const p = partnerAt(i, tier);
      const tile = el('div', { class: `vc__tile${p.dead ? ' is-dead' : ''} is-rot-${p.rot}` });

      /**
       * The "feed". Custom properties rather than inline pixel maths so the
       * stylesheet owns how a broken stream looks and this module only owns
       * *how broken* each one is.
       */
      tile.style.setProperty('--skin', `hsl(${p.skin} 26% ${p.light}%)`);
      tile.style.setProperty('--shift', `${p.shift}px`);

      const feed = el('div', { class: 'vc__feed', 'aria-hidden': 'true' }, [
        el('span', { class: 'vc__head' }),
        el('span', { class: 'vc__shoulders' }),
        // Torn rows: the codec dropping a slice and repeating the one above it.
        ...Array.from({ length: p.tear }, (_, t) =>
          el('span', {
            class: 'vc__tear',
            style: `top:${14 + t * 17}%;--tear-shift:${((t % 2) * 2 - 1) * (3 + t * 2)}px`,
          }),
        ),
      ]);

      tile.append(
        feed,
        el('span', { class: 'vc__region', text: p.region }),
        el('span', { class: 'vc__caption', text: p.dead ? 'no signal' : p.caption }),
      );
      grid.appendChild(tile);
    }
  }

  /* --------------------------------------------------------------- update */

  const update = throttle(() => {
    const s = game.state;
    const { econ } = game;
    const unlocked = econ.isBuildingUnlocked(s, 'vidchat');

    locked.root.hidden = unlocked;
    buy.root.hidden = !unlocked;
    meter.root.hidden = !unlocked;
    if (!unlocked) {
      locked.update();
      return;
    }

    const bd = econ.getProductionBreakdown(s, 'vidchat');
    ref('peers').textContent =
      bd.units === 0 ? 'no one online' : `${formatNumber(bd.units * 41)} strangers online`;
    ref('status').textContent =
      bd.units === 0 ? 'Looking for someone…' : `${bd.units} streams open`;
    ref('rate').textContent = bd.total > 0 ? `+${formatNumber(bd.total)} Buzz/s` : '';

    meter.update();
    buy.update();
    renderGrid();
  }, 150);

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);
  return () => {
    unsubscribe();
    celebration.destroy();
    body.classList.remove('app-vidchat');
  };
}
