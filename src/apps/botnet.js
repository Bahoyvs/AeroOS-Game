import { formatNumber } from '../core/format.js';
import { createBuyControl, createCelebration, createLockedPanel, createMeter } from '../ui/building.js';
import { clear, el, throttle } from './../ui/dom.js';

/**
 * BotNet — building #9 (GDD v2 §4).
 *
 * A network topology viewer on a black screen, modelled on Zenmap's radial
 * layout: concentric range rings, one hollow hub at the centre, and hosts
 * radiating outward on spokes with their names beside them.
 *
 * This replaced an earlier pass built from ASCII art and a scrolling log. That
 * version was *chaotic* on purpose and the chaos turned out to carry no
 * information — a wall of moving text reads as noise, and noise is not the same
 * as scale. A clean map that visibly grows says "this is enormous" far better,
 * because the player can actually see the shape of the thing they built.
 *
 * Everything is SVG, drawn once per milestone rather than per frame. The live
 * data that used to scroll past now lives where a scanner would put it: a
 * legend under the map, and a tooltip on each host.
 *
 * The `w32-buy` costume is still the prompt — `> execute payload.exe` — because
 * a purchase that is indistinguishable from the program's own output is the
 * best joke in the building.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

function hash(...values) {
  let h = 0x811c9dc5;
  for (const value of values) {
    h ^= Number(value) + 0x9e3779b9 + (h << 6) + (h >>> 2);
    h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
  }
  return h >>> 0;
}

/** Host names, in the register of machines nobody chose to enrol. */
const HOST_PREFIX = [
  'ns1', 'mail', 'vpn', 'cache', 'edge', 'relay', 'node', 'gw', 'pop', 'mx2',
  'cust-134', 'ae-42-89', 'ge-6-24', 'xe6-2', 'layer42', 'core1', 'ebr1', 'csw3',
];
const HOST_DOMAIN = [
  'titan.net', 'svk.layer42.net', 'sanjose2.level3.net', 'denver1.level3.net',
  'ebr2.sanjose1.net', 'car2.level3.net', 'core.aeroos.net', 'pool.dynamic.net',
];

const VIEW_W = 300;
const VIEW_H = 230;
/**
 * The hub sits left of centre, the way Zenmap's radial view does — the hosts
 * fan up and to the right, which is where the labels have room to sit. An
 * earlier fan reached far enough left that names ran off the viewBox.
 */
const HUB = { x: 112, y: 114 };

/** One host on the map, derived from its index so it never reshuffles. */
function hostAt(index) {
  const seed = hash(index);
  return {
    name: `${HOST_PREFIX[seed % HOST_PREFIX.length]}-${(seed >>> 5) % 90 + 10}.${
      HOST_DOMAIN[(seed >>> 9) % HOST_DOMAIN.length]
    }`,
    ports: 1 + ((seed >>> 13) % 6),
    latency: 4 + ((seed >>> 17) % 180),
    // A few hosts are unreachable — a real scan always has some.
    down: (seed >>> 21) % 9 === 0,
  };
}

/** Rings and hosts both grow with the milestone tier — the map gets bigger. */
const ringCount = (tier) => Math.min(7, 3 + Math.floor(Math.log2(tier)));
const hostCount = (tier) => Math.min(14, 3 + Math.floor(Math.log2(tier)) * 2);

export function mount(body, { game }) {
  body.classList.add('app-botnet');
  body.innerHTML = `
    <div class="bn__bar">
      <span class="bn__wordmark">botnet.exe — topology</span>
      <span class="bn__nodes" data-role="nodes">0 nodes</span>
    </div>

    <div class="bn__map" data-role="map"></div>

    <dl class="bn__legend" data-role="legend">
      <div><dt>hosts up</dt><dd data-role="lg-up">0</dd></div>
      <div><dt>open ports</dt><dd data-role="lg-ports">0</dd></div>
      <div><dt>mean rtt</dt><dd data-role="lg-rtt">—</dd></div>
      <div><dt>throughput</dt><dd data-role="lg-rate">0/s</dd></div>
    </dl>

    <div data-role="meter"></div>
    <div data-role="buy"></div>
    <div data-role="locked"></div>

    <div class="bn__status">
      <span data-role="status">no carrier</span>
      <span class="bn__hint" data-role="hint">hover a host for detail</span>
    </div>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const mapRoot = ref('map');

  /* ------------------------------------------------------- the shared kit */

  const meter = createMeter({ game, buildingId: 'botnet' });
  ref('meter').replaceWith(meter.root);

  const buy = createBuyControl({
    game,
    buildingId: 'botnet',
    labels: { one: '> execute payload.exe' },
    onBought: () => draw(true),
  });
  buy.root.classList.add('bn__buy');
  ref('buy').replaceWith(buy.root);

  const locked = createLockedPanel({ game, buildingId: 'botnet', message: 'no route to host' });
  ref('locked').replaceWith(locked.root);

  const celebration = createCelebration({
    game,
    buildingId: 'botnet',
    host: body,
    render: ({ at, multiplier }) => [
      el('strong', { class: 'w32celebrate__title', text: 'SUBNET ACQUIRED' }),
      el('span', {
        class: 'w32celebrate__body',
        text: `${formatNumber(at)} nodes mapped. Throughput ×${multiplier}.`,
      }),
    ],
  });

  /* ----------------------------------------------------------------- map */

  let drawKey = null;

  function draw(force = false) {
    const bd = game.econ.getProductionBreakdown(game.state, 'botnet');
    const tier = bd.milestoneMultiplier;
    const key = `${bd.units}|${tier}`;
    if (!force && key === drawKey) return;
    drawKey = key;

    clear(mapRoot);

    const root = svg('svg', {
      class: 'bn__svg',
      viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
      role: 'img',
      'aria-label':
        bd.units === 0
          ? 'Network topology: no hosts.'
          : `Network topology: ${bd.units} nodes across ${ringCount(tier)} hops.`,
    });

    // Range rings, drawn from the hub outward. These are the scanner's hop
    // distances, and adding one is the clearest possible "the net got bigger".
    const rings = ringCount(tier);
    for (let i = 1; i <= rings; i += 1) {
      root.append(svg('circle', { class: 'bn__ring', cx: HUB.x, cy: HUB.y, r: i * 26 }));
    }

    if (bd.units === 0) {
      root.append(
        svg('text', { class: 'bn__idle', x: HUB.x, y: HUB.y + 4, 'text-anchor': 'middle' }, [
          document.createTextNode('awaiting payload'),
        ]),
      );
      mapRoot.append(root);
      return;
    }

    const count = hostCount(tier);
    const spokes = svg('g', { class: 'bn__spokes' });
    const nodes = svg('g', { class: 'bn__nodes-g' });

    for (let i = 0; i < count; i += 1) {
      const host = hostAt(i);
      // Fan the hosts across the upper-right, the way Zenmap's radial layout
      // splays them — not a full circle, so the labels have room to sit.
      const angle = -2.05 + (i / Math.max(1, count - 1)) * 3.35;
      /**
       * Radius steps with the index rather than with the hash, so *adjacent*
       * hosts are never on the same ring. Hashing it alone let neighbouring
       * spokes land at the same distance and their labels overprinted.
       */
      const radius = 34 + (i % 3) * 22 + (hash(i, 7) % 2) * 9;
      const x = HUB.x + Math.cos(angle) * radius;
      const y = HUB.y + Math.sin(angle) * radius;

      spokes.append(svg('line', { class: 'bn__spoke', x1: HUB.x, y1: HUB.y, x2: x, y2: y }));

      const group = svg('g', {
        class: `bn__host${host.down ? ' is-down' : ''}`,
        tabindex: '0',
        role: 'listitem',
      });
      // The tooltip is where the old scrolling log's information went: per-host
      // and on demand, instead of a wall of text nobody could read.
      group.append(
        svg('title', {}, [
          document.createTextNode(
            `${host.name}\n${host.down ? 'filtered — no response' : `${host.ports} open ports · ${host.latency} ms`}`,
          ),
        ]),
      );
      group.append(svg('circle', { class: 'bn__dot', cx: x, cy: y, r: 4.6 }));

      // Labels only while the map is legible; past that the names are noise and
      // the tooltip carries them instead.
      if (count <= 9) {
        const left = x < HUB.x;
        group.append(
          svg(
            'text',
            {
              class: 'bn__label',
              x: x + (left ? -8 : 8),
              y: y + 3.2,
              'text-anchor': left ? 'end' : 'start',
            },
            [document.createTextNode(host.name.slice(0, 22))],
          ),
        );
      }
      nodes.append(group);
    }

    root.append(spokes, nodes);
    // The hub last, so it sits over its own spokes — hollow, like Zenmap's
    // "you are here".
    root.append(svg('circle', { class: 'bn__hub', cx: HUB.x, cy: HUB.y, r: 6 }));
    mapRoot.append(root);
  }

  /* --------------------------------------------------------------- update */

  const update = throttle(() => {
    const s = game.state;
    const { econ } = game;
    const unlocked = econ.isBuildingUnlocked(s, 'botnet');

    locked.root.hidden = unlocked;
    buy.root.hidden = !unlocked;
    meter.root.hidden = !unlocked;
    ref('legend').hidden = !unlocked;
    if (!unlocked) {
      locked.update();
      ref('status').textContent = 'no carrier';
      return;
    }

    const bd = econ.getProductionBreakdown(s, 'botnet');
    const tier = bd.milestoneMultiplier;
    const shown = bd.units === 0 ? 0 : hostCount(tier);

    // The legend is the honest home for the numbers the log used to shout.
    let ports = 0;
    let rtt = 0;
    let up = 0;
    for (let i = 0; i < shown; i += 1) {
      const host = hostAt(i);
      if (host.down) continue;
      up += 1;
      ports += host.ports;
      rtt += host.latency;
    }
    ref('lg-up').textContent = `${up} / ${shown}`;
    ref('lg-ports').textContent = formatNumber(ports * Math.max(1, Math.round(bd.units / Math.max(1, shown))));
    ref('lg-rtt').textContent = up === 0 ? '—' : `${Math.round(rtt / up)} ms`;
    ref('lg-rate').textContent = `${formatNumber(bd.total)}/s`;

    ref('nodes').textContent = `${formatNumber(bd.units)} nodes`;
    ref('status').textContent =
      bd.units === 0 ? 'idle :: awaiting payload' : `${formatNumber(bd.units * 3181)} hosts reachable`;

    meter.update();
    buy.update();
    draw();
  }, 150);

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);
  return () => {
    unsubscribe();
    celebration.destroy();
    body.classList.remove('app-botnet');
  };
}
