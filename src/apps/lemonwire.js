import { FILES, getFile, riskLabel } from '../data/files.js';
import {
  progressOf,
  secondsLeft,
  speedModifiers,
  storageUsedGB,
  trashUsedGB,
} from '../core/downloads.js';
import { formatDuration, formatNumber } from '../core/format.js';
import { clear, el, setBar, throttle } from './../ui/dom.js';

/**
 * LemonWire (AO-21) — the P2P download simulator.
 *
 * Search results on top, transfers underneath, and a disk gauge that ties the
 * whole app to the HDD track. Downloads only advance while this window is open,
 * which is what makes its 96 MB footprint a real decision.
 */

const sizeText = (gb) => (gb < 1 ? `${Math.round(gb * 1024)} MB` : `${gb} GB`);

/** Transfer speed as words, so the risk/reward trade is legible before clicking. */
function speedLabel(total) {
  if (total >= 1.5) return 'fast';
  if (total >= 0.75) return 'steady';
  if (total >= 0.15) return 'slow';
  return 'crawling';
}

export function mount(body, { game }) {
  body.classList.add('app-lemonwire');
  body.innerHTML = `
    <div class="lw__bar">
      <span class="lw__logo" aria-hidden="true">🍋</span>
      <span class="lw__status" data-role="status">Connected to 1,204 peers</span>
    </div>

    <div class="lw__disk">
      <div class="lw__disk-label">
        <span>Disk</span><span data-role="disk-text">0 / 0 GB</span>
      </div>
      <div class="meter__track"><div class="meter__fill" data-role="disk-bar"></div></div>
      <div class="lw__disk-trash" data-role="disk-trash" hidden></div>
    </div>

    <div class="lw__quarantine" data-role="quarantine" hidden>
      <strong>⚠ Infected — LemonWire is locked</strong>
      <span>Run a Shield99 scan to clean the machine. Production is halved until you do.</span>
    </div>

    <h4 class="lw__heading">Shared files</h4>
    <ul class="lw__results" data-role="results"></ul>

    <h4 class="lw__heading">Transfers <small data-role="queue-count"></small></h4>
    <ul class="lw__queue" data-role="queue"></ul>

    <h4 class="lw__heading">Library <small data-role="library-count"></small></h4>
    <ul class="lw__library" data-role="library"></ul>

    <h4 class="lw__heading" data-role="trash-heading" hidden>
      Recycle Bin <small data-role="trash-count"></small>
    </h4>
    <ul class="lw__library" data-role="trash" hidden></ul>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const resultsRoot = ref('results');
  const queueRoot = ref('queue');
  const libraryRoot = ref('library');
  const trashRoot = ref('trash');
  const rows = new Map();

  /* -------------------------------------------------------------- results */

  for (const file of FILES) {
    const risk = riskLabel(file.risk);
    const speed = speedLabel(speedModifiers(file.id).total);
    const button = el(
      'button',
      {
        type: 'button',
        class: 'lw__result',
        dataset: { fileId: file.id },
        // The trade the app is built around, spelled out before the click.
        title: `${file.name}\n${sizeText(file.sizeGB)} · ${speed} transfer · ${risk} risk${
          file.risk >= 0.25 ? ' — dangerous files trickle in, and pay accordingly' : ''
        }`,
        onclick: () => {
          const result = game.startDownload(file.id);
          if (!result.ok) {
            const messages = {
              'no-space': [`Disk full`, `${file.name} needs ${sizeText(file.sizeGB)}. Delete something or buy a bigger HDD.`],
              'queue-full': ['Too many transfers', 'Finish or cancel one first.'],
              'already-downloading': ['Already downloading', 'Check your transfers.'],
              'already-have-it': ['Already in your library', 'You downloaded this one.'],
              'in-trash': ['Still in the Recycle Bin', 'Wait for the bin to empty before downloading it again.'],
              infected: ['LemonWire is locked', 'Clean the infection with Shield99 first.'],
            };
            const [title, bodyText] = messages[result.reason] ?? ['Cannot download', ''];
            game.notify(title, bodyText, 'warn');
          }
          update();
        },
      },
      [
        el('span', { class: 'lw__file-name', text: file.name }),
        el('span', { class: 'lw__file-meta' }, [
          el('span', { text: sizeText(file.sizeGB) }),
          el('span', { text: `${file.seeders} seeders` }),
          el('span', { class: `lw__speed is-${speed}`, text: speed }),
          el('span', { class: `lw__risk is-${risk}`, text: `${risk} risk` }),
        ]),
      ],
    );
    resultsRoot.appendChild(el('li', {}, button));
    rows.set(file.id, button);
  }

  /* --------------------------------------------------------------- queue */

  let queueKey = null;

  function renderQueue() {
    const jobs = game.state.lemonwire.queue;
    const key = jobs.map((job) => job.id).join(',');
    if (key !== queueKey) {
      queueKey = key;
      clear(queueRoot);

      if (jobs.length === 0) {
        queueRoot.appendChild(el('li', { class: 'lw__empty', text: 'No active transfers.' }));
      }
      for (const job of jobs) {
        const meta = getFile(job.fileId);
        queueRoot.appendChild(
          el('li', { class: 'lw__job', dataset: { jobId: String(job.id) } }, [
            el('div', { class: 'lw__job-top' }, [
              el('span', { class: 'lw__file-name', text: meta.name }),
              el('button', {
                type: 'button',
                class: 'lw__cancel',
                text: '✕',
                'aria-label': `Cancel ${meta.name}`,
                onclick: () => {
                  game.cancelDownload(job.id);
                  update();
                },
              }),
            ]),
            el('div', { class: 'meter__track' }, el('div', { class: 'meter__fill' })),
            el('div', { class: 'lw__job-meta' }, [
              el('span', { dataset: { role: `pct-${job.id}` }, text: '0%' }),
              el('span', { dataset: { role: `eta-${job.id}` }, text: '' }),
            ]),
          ]),
        );
      }
    }

    // Progress updates every pass without rebuilding the rows.
    for (const job of jobs) {
      const row = queueRoot.querySelector(`[data-job-id="${job.id}"]`);
      if (!row) continue;
      const ratio = progressOf(job);
      setBar(row.querySelector('.meter__fill'), ratio, { warn: 2, critical: 2 });
      row.querySelector(`[data-role="pct-${job.id}"]`).textContent = `${Math.round(ratio * 100)}%`;
      row.querySelector(`[data-role="eta-${job.id}"]`).textContent = `${formatDuration(
        secondsLeft(game.state, job),
      )} left`;
    }
  }

  /* ------------------------------------------------------------- library */

  let libraryKey = null;

  function renderLibrary() {
    const library = game.state.lemonwire.library;
    const key = library.join(',');
    if (key === libraryKey) return;
    libraryKey = key;

    clear(libraryRoot);
    if (library.length === 0) {
      libraryRoot.appendChild(el('li', { class: 'lw__empty', text: 'Nothing downloaded yet.' }));
      return;
    }
    for (const fileId of library) {
      const meta = getFile(fileId);
      libraryRoot.appendChild(
        el('li', { class: 'lw__owned' }, [
          el('span', { class: 'lw__file-name', text: meta.name }),
          el('span', { class: 'lw__file-size', text: sizeText(meta.sizeGB) }),
          el('button', {
            type: 'button',
            class: 'lw__delete',
            text: 'Move to Trash',
            title: 'Deleted files keep their disk space until the Recycle Bin empties itself.',
            onclick: () => {
              game.deleteFile(fileId);
              update();
            },
          }),
        ]),
      );
    }
  }

  /* --------------------------------------------------------------- trash */

  /**
   * The Recycle Bin. Its whole job is to make "delete" cost something: the
   * space is still gone, and the countdown says for how long.
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
    const infected = s.security.infection !== null;

    const used = storageUsedGB(s);
    const capacity = econ.storageCapacityGB(s);
    ref('disk-text').textContent = `${used.toFixed(2)} / ${capacity} GB`;
    setBar(ref('disk-bar'), capacity === 0 ? 0 : used / capacity, { warn: 0.8, critical: 0.95 });

    // Space the player thinks they freed, and has not.
    const held = trashUsedGB(s);
    ref('disk-trash').hidden = held === 0;
    ref('disk-trash').textContent = `🗑 ${sizeText(held)} in Trash — not free yet`;

    ref('quarantine').hidden = !infected;
    ref('status').textContent = infected
      ? 'Quarantined'
      : `${s.lemonwire.queue.length} transferring · ${s.lemonwire.completed} completed`;

    ref('queue-count').textContent = `(${s.lemonwire.queue.length})`;
    ref('library-count').textContent = `(${s.lemonwire.library.length})`;

    for (const [fileId, button] of rows) {
      const check = econ.canDownloadFile(s, fileId);
      button.disabled = !check.ok;
      button.classList.toggle('is-owned', s.lemonwire.library.includes(fileId));
    }

    renderQueue();
    renderLibrary();
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
