import { AEROBURN } from '../data/balance.js';
import { CD_TYPES, getCD } from '../data/cds.js';
import { burnProgress } from '../core/aeroburn.js';
import { formatDuration, formatNumber } from '../core/format.js';
import { clear, el, setBar, throttle } from './../ui/dom.js';

/**
 * AeroBurn (AO-29) — the disc burner.
 *
 * The shelf is the point: discs are the only soft-currency asset that survives
 * a Format C:, so the window keeps them visible next to the burner.
 */
export function mount(body, { game }) {
  body.classList.add('app-aeroburn');
  body.innerHTML = `
    <div class="burn__drive">
      <div class="burn__disc" data-role="disc" aria-hidden="true"></div>
      <div class="burn__status">
        <strong data-role="state">Tray empty</strong>
        <span data-role="detail">Pick a disc to burn.</span>
        <div class="meter__track"><div class="meter__fill" data-role="burn-bar"></div></div>
      </div>
    </div>

    <ul class="burn__types" data-role="types"></ul>

    <h4 class="burn__heading">Shelf <small data-role="shelf-count"></small></h4>
    <ul class="burn__shelf" data-role="shelf"></ul>
    <p class="burn__note">Discs survive Format C:. Everything else on this machine does not.</p>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const typesRoot = ref('types');
  const shelfRoot = ref('shelf');
  const typeRows = new Map();

  for (const cd of CD_TYPES) {
    const button = el(
      'button',
      {
        type: 'button',
        class: 'burn__type',
        dataset: { cdId: cd.id },
        onclick: () => {
          const result = game.startBurn(cd.id);
          if (!result.ok) {
            const messages = {
              'too-expensive': ['Not enough Buzz', `${cd.name} costs ${formatNumber(cd.cost)}.`],
              'shelf-full': ['Shelf is full', `${AEROBURN.maxDiscs} discs is the limit — play one first.`],
              'already-burning': ['Burner is busy', 'One disc at a time.'],
            };
            const [title, msg] = messages[result.reason] ?? ['Cannot burn', ''];
            game.notify(title, msg, 'warn');
          }
          update();
        },
      },
      [
        el('span', { class: 'burn__type-label', text: cd.label }),
        el('span', { class: 'burn__type-text' }, [
          el('strong', { text: cd.name }),
          el('small', { text: cd.blurb }),
        ]),
        el('span', { class: 'burn__type-cost', dataset: { role: `cost-${cd.id}` } }),
      ],
    );
    typesRoot.appendChild(el('li', {}, button));
    typeRows.set(cd.id, button);
  }

  /* ---------------------------------------------------------------- shelf */

  let shelfKey = null;

  function renderShelf() {
    const discs = game.state.aeroburn.discs;
    const key = discs.map((d) => d.typeId + d.spent).join('|');
    if (key === shelfKey) return;
    shelfKey = key;

    clear(shelfRoot);
    if (discs.length === 0) {
      shelfRoot.appendChild(el('li', { class: 'burn__empty', text: 'No discs burned yet.' }));
      return;
    }

    discs.forEach((disc, index) => {
      const cd = getCD(disc.typeId);
      shelfRoot.appendChild(
        el('li', { class: 'burn__slot' }, [
          el('span', { class: 'burn__slot-disc', style: `--disc-color:${cd.color}`, text: cd.label }),
          el('span', { class: 'burn__slot-text' }, [
            el('strong', { text: cd.name }),
            el('small', {
              text: cd.recovery
                ? `Plays back ${formatNumber(disc.spent * cd.recovery)} Buzz`
                : `+${Math.round(cd.buff.magnitude * 100)}% for ${cd.buff.durationSeconds / 60} min`,
            }),
          ]),
          el('button', {
            type: 'button',
            class: 'burn__play',
            text: 'Play',
            onclick: () => {
              game.playDisc(index);
              update();
            },
          }),
        ]),
      );
    });
  }

  /* --------------------------------------------------------------- update */

  const update = throttle(() => {
    const s = game.state;
    const job = s.aeroburn.burning;

    ref('state').textContent = job ? `Burning ${getCD(job.typeId).name}` : 'Tray empty';
    ref('detail').textContent = job
      ? `${formatDuration(job.secondsLeft)} remaining — keep this window open.`
      : `${s.aeroburn.discs.length} of ${AEROBURN.maxDiscs} slots used · ${s.aeroburn.burned} burned all-time`;
    setBar(ref('burn-bar'), job ? burnProgress(s) : 0, { warn: 2, critical: 2 });
    ref('disc').classList.toggle('is-spinning', Boolean(job));

    for (const [id, button] of typeRows) {
      const cd = getCD(id);
      const check = game.econ.canBurnDisc(s, id);
      button.disabled = !check.ok;
      ref(`cost-${id}`).textContent = formatNumber(cd.cost);
      ref(`cost-${id}`).classList.toggle('is-affordable', s.buzz >= cd.cost);
    }

    ref('shelf-count').textContent = `(${s.aeroburn.discs.length}/${AEROBURN.maxDiscs})`;
    renderShelf();
  }, 200);

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);
  return () => {
    unsubscribe();
    clear(typesRoot);
    body.classList.remove('app-aeroburn');
  };
}
