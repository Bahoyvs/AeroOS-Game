import { formatNumber } from '../core/format.js';
import { createBuyControl, createCelebration, createLockedPanel, createMeter } from '../ui/building.js';
import { clear, el, throttle } from './../ui/dom.js';

/**
 * ChainMail — building #3 (GDD v2 §4).
 *
 * Outlook Express, near enough: a menu bar nobody clicks, a toolbar of chunky
 * bevelled buttons, three panes, and an unread counter that will not stop
 * rising. The whole app is that counter — GDD §4's visual progression for this
 * building is "the number climbs into the millions and turns red and bold", and
 * everything else here exists to make that number look like it belongs to a
 * real mail client.
 *
 * The `w32-buy` costume is the toolbar: **Send/Recv** is a single contact and
 * **Forward** is the bulk step. Nothing says "buy", and nothing shows a bare
 * production figure — the rate is spelled as "messages per second", because
 * that is what a mail client would count.
 */

/** The menu bar. Decorative, aria-hidden — five dead menus are not navigation. */
const MENUS = ['File', 'Edit', 'View', 'Tools', 'Message', 'Help'];

/**
 * The folder tree. `key` is how the row finds its live count; the rest are
 * fixed, because a mail client with one folder is not a mail client.
 */
const FOLDERS = [
  { key: 'inbox', name: 'Inbox', glyph: '📥', bold: true },
  { key: 'outbox', name: 'Outbox', glyph: '📤' },
  { key: 'sent', name: 'Sent Items', glyph: '📧' },
  { key: 'deleted', name: 'Deleted Items', glyph: '🗑' },
  { key: 'drafts', name: 'Drafts', glyph: '📝' },
];

/**
 * The chain letters themselves. Period-accurate misery: a curse, a hoax, a
 * pyramid scheme and two things your aunt forwarded without reading.
 *
 * Derived per row from the index like every other identity in this codebase
 * (`data/buddies.js`, `data/files.js`), so a list of a hundred messages costs
 * nothing in the save.
 */
const SUBJECTS = [
  ['FW: FW: FW: READ THIS OR ELSE', 'Sandra_71', 'This is not a joke. A girl died in 1987 because she'],
  ['Fwd: Bill Gates is sharing his fortune!!', 'dave.k', 'Microsoft is tracking this email. For every person you'],
  ['RE: RE: cute puppy pics :):):)', 'auntie_pat', 'awww look at this one!! sending to everyone i know xx'],
  ['FW: VIRUS WARNING - DO NOT OPEN', 'ITdept', 'If you receive an email titled "GOOD TIMES" do not open'],
  ['Fwd: Make $$$ From HOME (legit!!)', 'opportunity', 'I was skeptical too but after just 3 weeks I have earned'],
  ['FW: Send this to 10 friends by midnight', 'chain_angel', 'Your wish will come true. Ignore it and you will have'],
  ['Fwd: Nokia is giving away free phones', 'markymark', 'Just forward to 8 people and Nokia will send you the'],
  ['RE: the hampster dance!!!', 'lil_jenny', 'omg you HAVE to see this. turn your speakers up first'],
];

/** Cheap integer hash, same shape as buddies.js — see `messageAt`. */
function hash(...values) {
  let h = 0x811c9dc5;
  for (const value of values) {
    h ^= Number(value) + 0x9e3779b9 + (h << 6) + (h >>> 2);
    h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
  }
  return h >>> 0;
}

/** The message at `index`, derived and stable. Newest first in the list. */
function messageAt(index) {
  const seed = hash(index);
  const [subject, from, body] = SUBJECTS[seed % SUBJECTS.length];
  // Roughly one in three is still unread, which is what keeps the list looking
  // like a real inbox rather than a tidy one.
  return { subject, from, body, unread: seed % 3 !== 0, index };
}

const VISIBLE_MESSAGES = 9;

export function mount(body, { game }) {
  body.classList.add('app-chainmail');
  body.innerHTML = `
    <div class="cm__menubar" aria-hidden="true">
      ${MENUS.map((m) => `<span class="cm__menu">${m}</span>`).join('')}
    </div>

    <div class="cm__toolbar" data-role="toolbar"></div>

    <div class="cm__panes">
      <div class="cm__tree" role="navigation" aria-label="Folders">
        <div class="cm__tree-root" aria-hidden="true">📁 Local Folders</div>
        <ul class="cm__folders" data-role="folders"></ul>
      </div>

      <div class="cm__list-pane">
        <div class="cm__columns" aria-hidden="true">
          <span>!</span><span>From</span><span>Subject</span><span>Received</span>
        </div>
        <ul class="cm__list" data-role="list" aria-label="Messages"></ul>
      </div>
    </div>

    <div class="cm__preview" data-role="preview">
      <div class="cm__preview-head">
        <strong data-role="preview-subject">—</strong>
        <span data-role="preview-from"></span>
      </div>
      <p class="cm__preview-body" data-role="preview-body">Select a message to read it.</p>
    </div>

    <div data-role="meter"></div>
    <div data-role="buy"></div>
    <div data-role="locked"></div>

    <div class="cm__status" aria-live="polite">
      <span data-role="status">Connecting to mail.aeroos.net…</span>
      <span data-role="rate"></span>
    </div>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const listRoot = ref('list');
  const foldersRoot = ref('folders');

  /* ------------------------------------------------------- the shared kit */

  const meter = createMeter({ game, buildingId: 'chainmail' });
  ref('meter').replaceWith(meter.root);

  const buy = createBuyControl({
    game,
    buildingId: 'chainmail',
    // The two verbs a 2003 mail client actually had. "Send/Recv" is the button
    // every one of these apps put first, so it is the one that buys.
    labels: { one: '✉ Send/Recv' },
    onBought: () => renderList(true),
  });
  buy.root.classList.add('cm__buy');
  ref('buy').replaceWith(buy.root);

  const locked = createLockedPanel({
    game,
    buildingId: 'chainmail',
    message: 'Waiting for the mail server to respond…',
  });
  ref('locked').replaceWith(locked.root);

  /**
   * The milestone moment GDD §4 asks for: the unread counter *jumps* and a new
   * message rule announces itself. It is a notification the player did not ask
   * for and cannot dismiss wrongly — which is exactly what a mail client did.
   */
  const celebration = createCelebration({
    game,
    buildingId: 'chainmail',
    host: body,
    render: ({ at, multiplier, minigameUnlocked }) => [
      el('strong', { class: 'w32celebrate__title', text: 'New message rule created' }),
      el('span', {
        class: 'w32celebrate__body',
        text: `${at} contacts are forwarding automatically — ×${multiplier} mail.`,
      }),
      ...(minigameUnlocked
        ? [el('em', { class: 'w32celebrate__extra', text: 'Inbox triage unlocked' })]
        : []),
    ],
  });

  /* ------------------------------------------------------------- folders */

  for (const folder of FOLDERS) {
    foldersRoot.appendChild(
      el('li', { class: `cm__folder${folder.bold ? ' is-current' : ''}` }, [
        el('span', { class: 'cm__folder-glyph', 'aria-hidden': 'true', text: folder.glyph }),
        el('span', { class: 'cm__folder-name', text: folder.name }),
        el('span', { class: 'cm__folder-count', dataset: { role: `count-${folder.key}` } }),
      ]),
    );
  }

  /* ------------------------------------------------------------ messages */

  let selected = 0;
  let listKey = null;

  function renderPreview(message) {
    ref('preview-subject').textContent = message.subject;
    ref('preview-from').textContent = `From: ${message.from}@hotmail.com`;
    ref('preview-body').textContent = `${message.body}…`;
  }

  function renderList(force = false) {
    const units = game.econ.unitsOf(game.state, 'chainmail');
    const key = `${units}|${selected}`;
    if (!force && key === listKey) return;
    listKey = key;

    clear(listRoot);

    if (units === 0) {
      listRoot.appendChild(el('li', { class: 'cm__empty', text: 'No messages in this folder.' }));
      return;
    }

    const shown = Math.min(units, VISIBLE_MESSAGES);
    for (let i = 0; i < shown; i += 1) {
      const message = messageAt(units - 1 - i);
      const row = el(
        'li',
        {},
        el(
          'button',
          {
            type: 'button',
            class: `cm__row${message.unread ? ' is-unread' : ''}${
              message.index === selected ? ' is-selected' : ''
            }`,
            onclick: () => {
              selected = message.index;
              renderPreview(message);
              renderList(true);
            },
          },
          [
            el('span', { class: 'cm__row-flag', 'aria-hidden': 'true', text: message.unread ? '✉' : '' }),
            el('span', { class: 'cm__row-from', text: message.from }),
            el('span', { class: 'cm__row-subject', text: message.subject }),
            el('span', { class: 'cm__row-when', text: `${Math.max(1, i + 1)}m ago` }),
          ],
        ),
      );
      listRoot.appendChild(row);
    }

    if (units > shown) {
      listRoot.appendChild(
        el('li', { class: 'cm__more', text: `${formatNumber(units - shown)} more messages` }),
      );
    }
  }

  /* --------------------------------------------------------------- update */

  const update = throttle(() => {
    const s = game.state;
    const { econ } = game;
    const unlocked = econ.isBuildingUnlocked(s, 'chainmail');

    locked.root.hidden = unlocked;
    buy.root.hidden = !unlocked;
    meter.root.hidden = !unlocked;
    if (!unlocked) {
      locked.update();
      ref('status').textContent = 'Connecting to mail.aeroos.net…';
      return;
    }

    const bd = econ.getProductionBreakdown(s, 'chainmail');

    /**
     * The unread count, and the whole point of the app.
     *
     * It is not the unit count — it is the unit count times the milestone tier,
     * so crossing a threshold makes the number *visibly* jump rather than
     * ticking up by one. That is GDD §4's "sayaç milyonlara çıkar" and it is
     * why the tier is worth celebrating in a window with no shop in it.
     */
    const unread = Math.floor(bd.units * bd.milestoneMultiplier);
    const countNode = ref('count-inbox');
    countNode.textContent = unread > 0 ? `(${formatNumber(unread)})` : '';
    // Red and bold past a thousand: the client giving up on being calm about it.
    countNode.classList.toggle('is-alarming', unread >= 1000);
    ref('count-sent').textContent = bd.units > 0 ? `(${formatNumber(bd.units)})` : '';

    ref('status').textContent =
      bd.units === 0
        ? 'Connected · no new messages'
        : `${formatNumber(unread)} unread · ${bd.units} contacts`;
    ref('rate').textContent = bd.total > 0 ? `+${formatNumber(bd.total)} Buzz/s` : '';

    meter.update();
    buy.update();
    renderList();
  }, 150);

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);
  return () => {
    unsubscribe();
    celebration.destroy();
    body.classList.remove('app-chainmail');
  };
}
