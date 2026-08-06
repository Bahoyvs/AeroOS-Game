import { FILES, getFile, riskLabel } from '../data/files.js';
import {
  connectionAt,
  nextConnection,
  seedWeight,
  storageUsedGB,
  trashUsedGB,
  uploadKBps,
} from '../core/lemonwire.js';
import { formatDuration, formatNumber } from '../core/format.js';
import { clear, el, setBar, throttle } from './../ui/dom.js';

/**
 * LemonWire (AO-21) — the P2P *seeder*.
 *
 * The app no longer asks the player to start a transfer and watch it finish. It
 * asks a better question: which three files are worth a slot? Rare files pay
 * more than popular ones, risky files pay more than safe ones, and big files
 * charge the disk for the privilege. Income only accrues while this window is
 * open, which is what keeps its 96 MB footprint a real decision.
 */

const sizeText = (gb) => (gb < 1 ? `${Math.round(gb * 1024)} MB` : `${gb} GB`);

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
 * Decorative chrome (AO-21 revision): the category tabs and the search box are
 * period dressing, not controls. They are marked aria-hidden and are not
 * focusable — a screen reader announcing four tabs that do nothing is worse
 * than not announcing them, and the real navigation is the list below.
 */
const CATEGORY_TABS = ['Audio', 'Video', 'Images', 'Documents', 'Programs'];

/** Fake swarm sizes for the sidebar. Flavour only — nothing reads these. */
const CATEGORY_COUNTS = ['12,481', '3,912', '981', '402', '66'];

/** Demand as words, so the reason a file pays well is legible before clicking. */
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
      <span class="lw__wordmark">LemonWire<small>PRO 4.9</small></span>
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
        <span data-role="conn-note"></span>
        <button type="button" class="lw__upgrade" data-role="conn-buy"></button>
      </div>

      <h5 class="lw__side-heading">Disk</h5>
      <div class="lw__disk">
        <div class="lw__disk-label">
          <span>Used</span><span data-role="disk-text">0 / 0 GB</span>
        </div>
        <div class="lw__pbar"><div class="meter__fill" data-role="disk-bar"></div></div>
        <div class="lw__disk-trash" data-role="disk-trash" hidden></div>
      </div>
    </aside>

    <div class="lw__main">
      <div class="lw__bar">
        <span class="lw__status" data-role="status">Connecting…</span>
        <span class="lw__uprate" data-role="uprate"></span>
      </div>

      <div class="lw__quarantine" data-role="infected" hidden>
        <strong>⚠ Infected — sharing suspended</strong>
        <span>Run a Shield99 scan to clean the machine. Production is halved until you do.</span>
      </div>

      <h4 class="lw__heading">Seeding <small data-role="slot-count"></small></h4>
      <ul class="lw__seeds" data-role="seeds"></ul>

      <h4 class="lw__heading">Shared files</h4>
      <div class="lw__columns" aria-hidden="true">
        <span></span><span>Name</span><span>Size</span><span>Swarm</span><span>Buzz/s</span>
      </div>
      <ul class="lw__results" data-role="results"></ul>

      <h4 class="lw__heading" data-role="trash-heading" hidden>
        Recycle Bin <small data-role="trash-count"></small>
      </h4>
      <ul class="lw__library" data-role="trash" hidden></ul>
    </div>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const resultsRoot = ref('results');
  const seedsRoot = ref('seeds');
  const trashRoot = ref('trash');
  const rows = new Map();

  /* --------------------------------------------------------- shared files */

  for (const file of FILES) {
    const risk = riskLabel(file.risk);
    const demand = demandLabel(seedWeight(file.id).demand);
    const button = el(
      'button',
      {
        type: 'button',
        class: 'lw__result',
        dataset: { fileId: file.id },
        // The trade the app is built around, spelled out before the click.
        title: `${file.name}\n${sizeText(file.sizeGB)} · ${demand} in the swarm · ${risk} risk${
          file.risk >= 0.25 ? ' — risky shares attract threats for Shield99 to catch' : ''
        }`,
        onclick: () => {
          const result = game.startSeeding(file.id);
          if (!result.ok) {
            const messages = {
              'no-space': [
                'Disk full',
                `${file.name} needs ${sizeText(file.sizeGB)}. Stop a seed or buy a bigger HDD.`,
              ],
              'no-slots': ['Every slot is busy', 'Stop seeding something first, or upgrade your HDD.'],
              'already-seeding': ['Already sharing', 'It is in one of your slots.'],
              'in-trash': ['Still in the Recycle Bin', 'Wait for the bin to empty before sharing it again.'],
              infected: ['Sharing suspended', 'Clean the infection with Shield99 first.'],
              'not-open': ['LemonWire is closed', 'Open it to share.'],
            };
            const [title, bodyText] = messages[result.reason] ?? ['Cannot share that', ''];
            game.notify(title, bodyText, 'warn');
          }
          update();
        },
      },
      [
        el('span', { class: 'lw__result-row' }, [
          el('span', { class: 'lw__kind', 'aria-hidden': 'true', text: KIND_GLYPH[file.kind] ?? '▤' }),
          el('span', { class: 'lw__file-name', text: file.name }),
          el('span', { class: 'lw__file-size', text: sizeText(file.sizeGB) }),
          el('span', { class: 'lw__file-swarm', text: String(file.seeders) }),
          el('span', { class: 'lw__result-rate', dataset: { role: `rate-${file.id}` } }),
        ]),
        el('span', { class: 'lw__file-meta' }, [
          el('span', { class: `lw__demand is-${demand}`, text: demand }),
          el('span', { class: `lw__risk is-${risk}`, text: `${risk} risk` }),
        ]),
      ],
    );
    resultsRoot.appendChild(el('li', {}, button));
    rows.set(file.id, button);
  }

  /* ------------------------------------------------------------ the slots */

  let seedKey = null;

  function renderSeeds() {
    const s = game.state;
    const seeds = s.lemonwire.activeSeeds;
    const slots = game.econ.seedSlots(s);
    const key = `${seeds.map((seed) => seed.id).join(',')}|${slots}`;

    if (key !== seedKey) {
      seedKey = key;
      clear(seedsRoot);

      for (const seed of seeds) {
        const meta = getFile(seed.fileId);
        seedsRoot.appendChild(
          el('li', { class: 'lw__seed', dataset: { seedId: String(seed.id) } }, [
            el('div', { class: 'lw__seed-top' }, [
              el('span', { class: 'lw__file-name', text: meta.name }),
              el('button', {
                type: 'button',
                class: 'lw__cancel',
                text: '✕',
                'aria-label': `Stop seeding ${meta.name}`,
                title: 'Stop seeding — the file goes to the Recycle Bin and holds its space for a while.',
                onclick: () => {
                  game.stopSeeding(seed.id);
                  update();
                },
              }),
            ]),
            // A seed has no end state, so the bar shows share of income rather
            // than progress: which slot is actually carrying the app.
            el('div', { class: 'lw__pbar' }, el('div', { class: 'meter__fill' })),
            el('div', { class: 'lw__seed-meta' }, [
              el('span', { class: 'is-rate', dataset: { role: `seed-rate-${seed.id}` } }),
              el('span', { dataset: { role: `seed-up-${seed.id}` } }),
            ]),
          ]),
        );
      }

      // Empty slots are shown, not implied: the player should be able to see
      // what an HDD upgrade just bought them.
      for (let i = seeds.length; i < slots; i += 1) {
        seedsRoot.appendChild(
          el('li', { class: 'lw__seed is-empty' }, [
            el('span', { class: 'lw__empty', text: 'Empty slot — pick something to share.' }),
          ]),
        );
      }
    }

    const now = Date.now();
    const best = Math.max(1, ...seeds.map((seed) => game.econ.seedRate(s, seed.fileId, now)));
    for (const seed of seeds) {
      const row = seedsRoot.querySelector(`[data-seed-id="${seed.id}"]`);
      if (!row) continue;
      const rate = game.econ.seedRate(s, seed.fileId, now);
      setBar(row.querySelector('.meter__fill'), rate / best, { warn: 2, critical: 2 });
      row.querySelector(`[data-role="seed-rate-${seed.id}"]`).textContent =
        `${formatNumber(rate * game.econ.globalMultiplier(s, now))} Buzz/s`;
      row.querySelector(`[data-role="seed-up-${seed.id}"]`).textContent =
        `↑ ${uploadKBps(seed.fileId, game.econ.totalBandwidth(s)).toFixed(1)} KB/s · ${formatNumber(
          seed.uploadedMB,
        )} MB shared`;
    }
  }

  /* ------------------------------------------------------- the connection */

  function renderConnection() {
    const s = game.state;
    const current = connectionAt(s.lemonwire.connection);
    const next = nextConnection(s.lemonwire.connection);

    ref('conn-label').textContent = `${current.label} · ×${current.multiplier}`;
    const buy = ref('conn-buy');

    if (!next) {
      ref('conn-note').textContent = 'Fastest line in the neighbourhood.';
      buy.hidden = true;
      return;
    }

    buy.hidden = false;
    ref('conn-note').textContent = `${next.label} multiplies every slot by ${next.multiplier}.`;
    buy.textContent = `Upgrade · ${formatNumber(next.cost)}`;
    buy.disabled = s.buzz < next.cost;
  }

  ref('conn-buy').addEventListener('click', () => {
    const result = game.upgradeConnection();
    if (!result.ok && result.reason === 'too-expensive') {
      game.notify('Not enough Buzz', 'The phone company wants more than that.', 'warn');
    }
    update();
  });

  /* --------------------------------------------------------------- trash */

  /**
   * The Recycle Bin. Its whole job is to make "stop seeding" cost something:
   * the space is still gone, and the countdown says for how long.
   */
  let trashKey = null;

  function renderTrash() {
    const trash = game.state.lemonwire.trash;
    const key = trash.map((item) => item.fileId).join(',');

    ref('trash-heading').hidden = trash.length === 0;
    trashRoot.hidden = trash.length === 0;
    ref('trash-count').textContent = `(${sizeText(trashUsedGB(game.state))} held)`;

    if (key !== trashKey) {
      trashKey = key;
      clear(trashRoot);
      for (const item of trash) {
        const meta = getFile(item.fileId);
        trashRoot.appendChild(
          el('li', { class: 'lw__owned is-trashed', dataset: { fileId: item.fileId } }, [
            el('span', { class: 'lw__file-name', text: meta.name }),
            el('span', { class: 'lw__file-size', text: sizeText(meta.sizeGB) }),
            el('span', { class: 'lw__trash-timer', dataset: { role: `trash-${item.fileId}` } }),
          ]),
        );
      }
    }

    for (const item of trash) {
      const timer = trashRoot.querySelector(`[data-role="trash-${item.fileId}"]`);
      if (timer) timer.textContent = `frees in ${formatDuration(Math.ceil(item.secondsLeft))}`;
    }
  }

  /* --------------------------------------------------------------- update */

  const update = throttle(() => {
    const s = game.state;
    const { econ } = game;
    const now = Date.now();
    const infected = s.security.infection !== null;

    const used = storageUsedGB(s);
    const capacity = econ.storageCapacityGB(s);
    ref('disk-text').textContent = `${used.toFixed(2)} / ${capacity} GB`;
    setBar(ref('disk-bar'), capacity === 0 ? 0 : used / capacity, { warn: 0.8, critical: 0.95 });

    // Space the player thinks they freed, and has not.
    const held = trashUsedGB(s);
    ref('disk-trash').hidden = held === 0;
    ref('disk-trash').textContent = `🗑 ${sizeText(held)} in Trash — not free yet`;

    ref('infected').hidden = !infected;

    const seeding = s.lemonwire.activeSeeds.length;
    ref('status').textContent = infected
      ? 'Sharing suspended'
      : seeding === 0
        ? 'Connected to 1,204 peers'
        : `Sharing ${seeding} ${seeding === 1 ? 'file' : 'files'}`;
    ref('uprate').textContent =
      seeding === 0
        ? ''
        : `+${formatNumber(econ.seedBuzzPerSecond(s, now) * econ.globalMultiplier(s, now))} Buzz/s`;

    ref('slot-count').textContent = `(${seeding} / ${econ.seedSlots(s)} slots)`;

    for (const [fileId, button] of rows) {
      const check = econ.canSeedFile(s, fileId);
      button.disabled = !check.ok;
      button.classList.toggle('is-seeding', check.reason === 'already-seeding');
      button.querySelector(`[data-role="rate-${fileId}"]`).textContent = `${formatNumber(
        econ.seedRate(s, fileId, now) * econ.globalMultiplier(s, now),
      )} Buzz/s`;
    }

    renderSeeds();
    renderConnection();
    renderTrash();
  }, 150);

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);
  return () => {
    unsubscribe();
    clear(resultsRoot);
    body.classList.remove('app-lemonwire');
  };
}
