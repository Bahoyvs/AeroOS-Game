import { formatNumber } from '../core/format.js';
import { motionIsReduced } from './../ui/motion.js';
import { createBuyControl, createCelebration, createLockedPanel, createMeter } from '../ui/building.js';
import { clear, el, throttle } from './../ui/dom.js';

/**
 * BotNet — building #9 (GDD v2 §4).
 *
 * mIRC crossed with a command line, and the first window in the game with no
 * Aero chrome inside it at all: no gradients, no bevels, no glass. Phase 3's
 * erosion, one window early — this app was never pretending to be a consumer
 * product, so it does not get the OS's manners.
 *
 * Three panes, and all three are supposed to be slightly too much: a log that
 * scrolls faster than it can be read, an ASCII node map that outgrows its own
 * box, and a rootkit file tree that keeps finding new places to live.
 *
 * The `w32-buy` costume is the prompt itself — typing `execute payload.exe` is
 * the purchase (GDD §4). The command echoes into the log like a real one, so
 * the buy and the app's own output are indistinguishable, which is the point.
 */

/** Log chatter. Deliberately unreadable at speed — the volume is the message. */
const LOG_LINES = [
  'node %ID% joined :: handshake ok',
  'relay %ID% -> 10.%A%.%B%.%C% [%N% pkt]',
  'scan %A%.%B%.0.0/16 :: %N% hosts up',
  'payload staged on %ID% (%N% KB)',
  'beacon %ID% :: interval 900s',
  'harvest %ID% :: %N% credentials',
  '%ID% went dark, rerouting',
  'peer %ID% requests update channel',
  'ack %ID% :: uptime %N%h',
  'mirror sync %N%%% complete',
];

/** The rootkit's file tree. It gains a branch per milestone tier. */
const ROOTKIT = [
  ['C:\\WINDOWS\\system32\\', ['svch0st.exe', 'dllcache\\ntkrnl.sys']],
  ['C:\\WINDOWS\\Temp\\', ['~df3a91.tmp', 'mscache.dat']],
  ['C:\\Documents and Settings\\', ['All Users\\Start Menu\\Programs\\Startup\\run.pif']],
  ['C:\\Program Files\\Common Files\\', ['Microsft Shared\\web.dll']],
  ['C:\\WINDOWS\\', ['win.ini  [modified]', 'hosts  [modified]']],
  ['\\\\?\\GLOBALROOT\\Device\\', ['Null\\.hidden', 'Null\\.persist']],
];

function hash(...values) {
  let h = 0x811c9dc5;
  for (const value of values) {
    h ^= Number(value) + 0x9e3779b9 + (h << 6) + (h >>> 2);
    h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
  }
  return h >>> 0;
}

const nodeId = (seed) => `n${(seed % 0xffff).toString(16).padStart(4, '0')}`;

function logLine(index) {
  const seed = hash(index);
  return LOG_LINES[seed % LOG_LINES.length]
    .replace('%ID%', nodeId(seed >>> 3))
    .replace('%A%', String((seed >>> 5) % 254))
    .replace('%B%', String((seed >>> 9) % 254))
    .replace('%C%', String((seed >>> 13) % 254))
    .replace(/%N%/g, String(((seed >>> 17) % 900) + 12));
}

/**
 * The ASCII node map.
 *
 * A fixed character grid, seeded from the unit count, that gets denser as the
 * network grows — by the top tier it is close to solid, which is the intended
 * "slightly overwhelming" reading. It is built as one string rather than a
 * thousand spans: this redraws on every milestone, and a DOM node per glyph
 * would be a stutter the player can feel.
 */
function asciiMap(units, tier, width = 46, height = 11) {
  if (units === 0) return '  no nodes\n';
  const glyphs = ['·', '·', '-', '+', '*', '#', '@'];
  // Density climbs with the tier and rails below 1 so the map never fills
  // completely — a solid block reads as a rendering bug, not a swarm.
  const density = Math.min(0.82, 0.14 + Math.log2(Math.max(1, tier)) * 0.14);
  let out = '';
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const seed = hash(x, y, tier);
      if ((seed % 1000) / 1000 > density) {
        out += ' ';
        continue;
      }
      // A few hubs, most of them leaves.
      const weight = (seed >>> 7) % 100;
      const glyph =
        weight > 96 ? '@' : weight > 88 ? '#' : weight > 70 ? '*' : glyphs[(seed >>> 11) % 4];
      out += glyph;
    }
    out += '\n';
  }
  return out;
}

const LOG_CAP = 60;

export function mount(body, { game }) {
  body.classList.add('app-botnet');
  body.innerHTML = `
    <div class="bn__bar">
      <span class="bn__wordmark">botnet.exe</span>
      <span class="bn__nodes" data-role="nodes">0 nodes</span>
    </div>

    <div class="bn__panes">
      <pre class="bn__map" data-role="map" aria-hidden="true"></pre>
      <div class="bn__tree" aria-label="Installed files">
        <div class="bn__tree-head">rootkit :: persistence</div>
        <ul class="bn__tree-list" data-role="tree"></ul>
      </div>
    </div>

    <pre class="bn__log" data-role="log" aria-live="off"></pre>

    <div data-role="meter"></div>
    <div data-role="buy"></div>
    <div data-role="locked"></div>

    <div class="bn__status">
      <span data-role="status">no carrier</span>
      <span data-role="rate"></span>
    </div>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const logRoot = ref('log');
  const treeRoot = ref('tree');

  /* ------------------------------------------------------- the shared kit */

  const meter = createMeter({ game, buildingId: 'botnet' });
  ref('meter').replaceWith(meter.root);

  const buy = createBuyControl({
    game,
    buildingId: 'botnet',
    // The prompt is the purchase. GDD §4, near enough verbatim.
    labels: { one: '> execute payload.exe' },
    onBought: ({ count }) => {
      pushLog(`> execute payload.exe --count ${count}`, 'is-cmd');
      pushLog(`  ${count} node(s) provisioned`, 'is-ok');
      redraw(true);
    },
  });
  buy.root.classList.add('bn__buy');
  ref('buy').replaceWith(buy.root);

  const locked = createLockedPanel({
    game,
    buildingId: 'botnet',
    message: 'no route to host',
  });
  ref('locked').replaceWith(locked.root);

  const celebration = createCelebration({
    game,
    buildingId: 'botnet',
    host: body,
    render: ({ at, multiplier, minigameUnlocked }) => [
      el('strong', { class: 'w32celebrate__title', text: 'PERSISTENCE ESTABLISHED' }),
      el('span', {
        class: 'w32celebrate__body',
        text: `${formatNumber(at)} nodes. New file written. Throughput ×${multiplier}.`,
      }),
      ...(minigameUnlocked
        ? [el('em', { class: 'w32celebrate__extra', text: 'Node sweep unlocked' })]
        : []),
    ],
  });

  /* ----------------------------------------------------------------- log */

  let logIndex = 0;

  function pushLog(text, cls = '') {
    logRoot.appendChild(el('span', { class: `bn__line ${cls}`, text: `${text}\n` }));
    // Ring buffer. A window left open for an hour must not grow a DOM node per
    // line for that hour.
    while (logRoot.childElementCount > LOG_CAP) logRoot.removeChild(logRoot.firstChild);
    logRoot.scrollTop = logRoot.scrollHeight;
  }

  /**
   * The chatter, on its own cheap interval rather than inside the simulation
   * tick — it is decoration, and the tick has real work to do.
   *
   * Under reduced motion it slows to a crawl instead of stopping: an empty log
   * would read as a broken app, and "reduce motion" asks for less movement, not
   * less information. Same reasoning as RetroAmp's visualiser.
   */
  const logTimer = setInterval(() => {
    if (!game.econ.isBuildingUnlocked(game.state, 'botnet')) return;
    const units = game.econ.unitsOf(game.state, 'botnet');
    if (units === 0) return;
    if (motionIsReduced() && logIndex % 6 !== 0) {
      logIndex += 1;
      return;
    }
    // Bursts, not a metronome: a network is lumpy, and a steady drip reads as
    // a progress bar.
    const burst = 1 + (hash(logIndex) % 3);
    for (let i = 0; i < burst; i += 1) pushLog(logLine(logIndex + i));
    logIndex += burst;
  }, 420);

  /* ------------------------------------------------------- map + rootkit */

  let drawKey = null;

  function redraw(force = false) {
    const bd = game.econ.getProductionBreakdown(game.state, 'botnet');
    const key = `${bd.units}|${bd.milestoneMultiplier}`;
    if (!force && key === drawKey) return;
    drawKey = key;

    ref('map').textContent = asciiMap(bd.units, bd.milestoneMultiplier);

    clear(treeRoot);
    const branches = bd.units === 0 ? 0 : Math.min(ROOTKIT.length, 1 + Math.floor(Math.log2(bd.milestoneMultiplier)));
    for (let i = 0; i < branches; i += 1) {
      const [dir, files] = ROOTKIT[i];
      treeRoot.appendChild(el('li', { class: 'bn__dir', text: dir }));
      for (const file of files) {
        treeRoot.appendChild(
          el('li', { class: `bn__file${i === branches - 1 ? ' is-new' : ''}`, text: `  └ ${file}` }),
        );
      }
    }
  }

  /* --------------------------------------------------------------- update */

  const update = throttle(() => {
    const s = game.state;
    const { econ } = game;
    const unlocked = econ.isBuildingUnlocked(s, 'botnet');

    locked.root.hidden = unlocked;
    buy.root.hidden = !unlocked;
    meter.root.hidden = !unlocked;
    if (!unlocked) {
      locked.update();
      ref('status').textContent = 'no carrier';
      return;
    }

    const bd = econ.getProductionBreakdown(s, 'botnet');
    ref('nodes').textContent = `${formatNumber(bd.units)} nodes`;
    ref('status').textContent =
      bd.units === 0 ? 'idle :: awaiting payload' : `${formatNumber(bd.units * 3181)} hosts reachable`;
    ref('rate').textContent = bd.total > 0 ? `+${formatNumber(bd.total)} Buzz/s` : '';

    meter.update();
    buy.update();
    redraw();
  }, 150);

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);
  return () => {
    unsubscribe();
    clearInterval(logTimer);
    celebration.destroy();
    body.classList.remove('app-botnet');
  };
}
