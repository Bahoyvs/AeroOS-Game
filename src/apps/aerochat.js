import { CHAT_BOT, STATUS_EVENT } from '../data/balance.js';
import { ambientStatus, buddyAt, isAway } from '../data/buddies.js';
import { activeBuffs, remainingSeconds } from '../core/buffs.js';
import { claimSecondsLeft, getBonus } from '../core/statusEvents.js';
import { formatNumber } from '../core/format.js';
import { clear, el, setBar, throttle } from './../ui/dom.js';
import { createBuildingView } from './../ui/buildingView.js';
import { categoryList, dialog, groupBox, menuBar, splitButton, statusBar } from './../ui/win32.js';

/**
 * AeroChat — the core idle engine (AO-5, AO-8, AO-9, AO-10).
 *
 * Buddies are derived from their index (src/data/buddies.js), so the list can
 * show 500 of them without storing any of it. Only a window of the list is
 * drawn; the rest is summarised.
 *
 * ## Where the economy went
 *
 * This app used to carry a generic "Buy 1 / Buy 10 / Max" block bolted to its
 * foot. It is gone. Buddies are AeroChat's *units*, so buying them is the thing
 * MSN Messenger already had a verb for: **adding a contact**.
 *
 * - **Units** are the `Add a Contact` split button in the list footer. One click
 *   adds one; the drop-down offers the bulk imports a real client offered —
 *   a contact list, a Hotmail address book, everything.
 * - **Upgrades** live in `Tools ▸ Options…`, the MSN options dialog, filed under
 *   the category each one belongs to. They read as features you switch on, not
 *   as items in a shop.
 * - **The breakdown** was already here and better than any table: the header
 *   line spells out the whole multiplier chain in the app's own voice.
 *
 * The maths behind all three is untouched and still central — `ui/buildingView.js`
 * hands over a plain object and this file decides what it looks like.
 */

/**
 * Which Options page each upgrade belongs on. An upgrade with no entry falls
 * through to Account, so a new one added to `data/upgrades.js` never vanishes
 * from the dialog — it just lands somewhere sensible until it is filed.
 */
const OPTION_PAGES = {
  'aerochat.t1': 'personal',   // Custom Emoticon Pack
  'aerochat.t2': 'messages',   // Winks & Nudges Add-on
  'aerochat.t3': 'personal',   // Display Picture Studio
  'aerochat.t4': 'privacy',    // Buddy List Groups
  'aerochat.t5': 'messages',   // Offline Messaging
  'aerochat.t6': 'connection', // Multi-Client Patch
};

/**
 * What each feature *says* it does, in the client's voice.
 *
 * The view-model's fallback copy is written in economy terms ("doubles this
 * building's output"), which is correct and completely wrong here — MSN did not
 * know what a building was. Presentation is the app's job, so the app supplies
 * the words.
 */
const OPTION_COPY = {
  'aerochat.t1': 'Adds 130 custom emoticons. Conversations get livelier.',
  'aerochat.t2': 'Winks, nudges and a shake that rattles the whole window.',
  'aerochat.t3': 'Crop, rotate and frame your display picture.',
  'aerochat.t4': 'Sort contacts into groups and collapse the ones you ignore.',
  'aerochat.t5': 'Messages sent to offline contacts are delivered on sign-in.',
  'aerochat.t6': 'Sign in from more than one machine at a time.',
};

const OPTION_CATEGORIES = [
  { id: 'personal', label: 'Personal', blurb: 'Display picture, emoticons and how you appear to others.' },
  { id: 'messages', label: 'Messages', blurb: 'What happens when a message arrives.' },
  { id: 'privacy', label: 'Privacy', blurb: 'Who can see you, and how your list is organised.' },
  { id: 'connection', label: 'Connection', blurb: 'How this client talks to the service.' },
  { id: 'account', label: 'Account', blurb: 'Your contact allowance and subscription.' },
];

const VISIBLE_BUDDIES = 14;

export function mount(body, { game }) {
  body.classList.add('app-aerochat');
  body.innerHTML = `
    <div data-role="menubar"></div>

    <div class="chat__me glass">
      <span class="buddy-icon icon-user-green" aria-hidden="true"></span>
      <div class="chat__me-text">
        <!-- Re-read on every pass rather than baked in: the portal's username
             is fetched in the background so it cannot hold up the desktop, and
             it may land after this window is already open. -->
        <strong data-role="me-name">${game.state.username || 'Guest'}</strong>
        <small data-role="me-status">is building a social network</small>
      </div>
      <span class="chat__rate" data-role="rate">0 / sec</span>
    </div>

    <div class="chat__milestone">
      <div class="chat__milestone-label">
        <span data-role="bot-count">0 buddies</span>
        <span data-role="milestone-text">—</span>
      </div>
      <div class="meter__track"><div class="meter__fill" data-role="milestone-bar"></div></div>
    </div>

    <p class="chat__breakdown" data-role="breakdown"></p>

    <div class="chat__buffs" data-role="buffs" aria-live="polite"></div>

    <ul class="chat__list" data-role="list" aria-label="Buddy list"></ul>

    <div class="chat__actions" data-role="actions"></div>
    <div data-role="statusbar"></div>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const list = ref('list');
  const buffsRoot = ref('buffs');
  const breakdown = ref('breakdown');

  const view = createBuildingView(game, 'aerochat');

  /* ---------------------------------------------------------- add a contact */

  /**
   * Adding contacts, in the client's own words.
   *
   * A split button rather than four buttons in a row: the common case (add one)
   * is a single click with no menu, and the bulk options are the imports a real
   * messenger offered. Nobody has to read the word "buy".
   */
  function addContacts(step) {
    const result = view.buy(step);
    if (result.ok) {
      update();
      return;
    }
    if (result.reason === 'maxed' || result.reason === 'buddy-list-full') {
      game.notify(
        'Contact list is full',
        `${CHAT_BOT.maxPerRun} contacts is the limit on this account.`,
        'warn',
      );
    } else {
      game.notify('Cannot add contact', 'Not enough Buzz. Nudge a few more times.', 'warn');
    }
  }

  const IMPORTS = [
    { step: 10, label: 'Import a contact list\u2026' },
    { step: 100, label: 'Import Hotmail address book\u2026' },
    { step: 'max', label: 'Import everything\u2026' },
  ];

  const addButton = splitButton({
    label: 'Add a Contact',
    hint: '',
    onClick: () => addContacts(1),
    items: IMPORTS.map((i) => ({ label: i.label, onSelect: () => addContacts(i.step) })),
  });
  ref('actions').appendChild(addButton.el);

  /* ------------------------------------------------------------- menu bar */

  const menus = menuBar([
    {
      label: 'File',
      items: [
        { label: 'Sign out', disabled: true },
        'separator',
        { label: 'Close', onSelect: () => game.closeApp('aerochat') },
      ],
    },
    {
      label: 'Contacts',
      items: [
        { label: 'Add a Contact\u2026', onSelect: () => addContacts(1) },
        ...IMPORTS.map((i) => ({ label: i.label, onSelect: () => addContacts(i.step) })),
      ],
    },
    {
      label: 'Actions',
      items: [
        { label: 'Send a Nudge', onSelect: () => game.nudge() },
        { label: 'Claim status bonus', onSelect: () => game.claimStatusBonus() },
      ],
    },
    { label: 'Tools', items: [{ label: 'Options\u2026', onSelect: openOptions }] },
    {
      label: 'Help',
      items: [{ label: 'About AeroChat', onSelect: () => game.notify(
        'AeroChat 7.5',
        'Build 7.5.0324. Contacts chat whether or not this window is open.',
        'info',
      ) }],
    },
  ]);
  ref('menubar').appendChild(menus);

  /* --------------------------------------------------------- status bar */

  const status = statusBar([
    { id: 'contacts', text: '' },
    { id: 'rate', text: '', grow: true },
    { id: 'connection', text: 'Connected' },
  ]);
  ref('statusbar').appendChild(status.el);

  /* ------------------------------------------------- Tools > Options */

  let optionsOpen = null;

  /**
   * The MSN options dialog: a category list down the left, a page on the right.
   * Upgrades appear as *features* on the page they belong to — checked and
   * greyed once owned, with a Purchase button and a price while not, and the
   * classic etched hint underneath when a requirement is unmet.
   */
  function openOptions() {
    if (optionsOpen) return;

    const cats = categoryList(OPTION_CATEGORIES);
    const rebuild = () => {
      const snapshot = view.read();
      if (!snapshot) return;

      for (const category of OPTION_CATEGORIES) {
        const page = cats.pages[category.id];
        clear(page);
        page.appendChild(el('p', { class: 'chat__opt-blurb', text: category.blurb }));

        const mine = snapshot.upgrades.filter(
          (u) => (OPTION_PAGES[u.id] ?? 'account') === category.id,
        );

        if (mine.length > 0) {
          page.appendChild(
            groupBox(
              'Features',
              el('ul', { class: 'w32-list' }, mine.map(featureRow)),
            ),
          );
        }

        // The Account page also owns the contact allowance, which is where a
        // real client would have put "you may add N contacts".
        if (category.id === 'account') {
          page.appendChild(
            groupBox('Contact allowance', [
              el('p', { class: 'chat__opt-line' }, [
                el('span', { text: 'Contacts on this account' }),
                el('b', { text: `${snapshot.units} of ${snapshot.maxPerRun}` }),
              ]),
              el('p', { class: 'chat__opt-line' }, [
                el('span', { text: 'Next contact costs' }),
                el('b', { text: `${formatNumber(snapshot.steps[0].cost)} Buzz` }),
              ]),
              el('button', {
                type: 'button',
                class: 'chat__opt-add',
                disabled: snapshot.steps[0].disabled ? '' : null,
                text: 'Add a Contact',
                onSelect: null,
                onclick: () => { addContacts(1); rebuild(); },
              }),
            ]),
          );
        }

        if (mine.length === 0 && category.id !== 'account') {
          page.appendChild(el('p', { class: 'chat__opt-empty', text: 'Nothing to configure yet.' }));
        }
      }
    };

    function featureRow(upgrade) {
      const owned = upgrade.state === 'owned';
      const gated = upgrade.state === 'gated';

      return el('li', { class: `w32-row${gated ? ' is-disabled' : ''}` }, [
        // A real checkbox, disabled: the feature is on or it is not, and MSN's
        // options pages were columns of exactly this control.
        // 7.css draws a checkbox through an adjacent <label>, which this row
        // layout has no room for, so the box is drawn directly. Same sunken
        // white square and same tick — it just does not need the pairing.
        el('span', {
          class: `chat__opt-check${owned ? ' is-checked' : ''}`,
          role: 'img',
          'aria-label': owned ? 'Enabled' : 'Not purchased',
        }),
        el('span', { class: 'w32-row__text' }, [
          el('strong', { text: upgrade.name }),
          el('small', { text: OPTION_COPY[upgrade.id] ?? upgrade.blurb }),
          upgrade.requirement ? el('em', { class: 'w32-req', text: upgrade.requirement }) : null,
        ]),
        owned
          ? el('span', { class: 'chat__opt-state', text: 'Enabled' })
          : el('button', {
            type: 'button',
            disabled: upgrade.state === 'buyable' ? null : '',
            text: `Purchase \u2014 ${formatNumber(upgrade.cost)}`,
            onclick: () => { view.buyUpgrade(upgrade.id); rebuild(); update(); },
          }),
      ]);
    }

    rebuild();
    const tick = game.bus.on(game.events.TICK, rebuild);
    optionsOpen = dialog({
      title: 'Options',
      width: 520,
      body: cats.el,
      buttons: [{ label: 'OK', primary: true, onSelect: (close) => close() }],
      onClose: () => { tick(); optionsOpen = null; },
    });
  }

  /* ------------------------------------------------------------ buddy list */

  function buddyRow(index, epoch) {
    const buddy = buddyAt(index);
    const away = isAway(index, epoch);
    return el('li', { class: `chat__buddy${away ? ' is-away' : ''}` }, [
      el('span', { class: `buddy-icon ${buddy.avatar}`, 'aria-hidden': 'true' }),
      el('span', { class: 'chat__nick', text: buddy.name }),
      el('span', { class: 'chat__status', text: ambientStatus(index, epoch) }),
    ]);
  }

  /** The pending bonus buddy, pinned to the top so it is always clickable. */
  function hotRow(event) {
    const bonus = getBonus(event.bonusId);
    const buddy = buddyAt(event.index);
    const row = el(
      'li',
      {},
      el(
        'button',
        {
          type: 'button',
          class: 'chat__hot',
          title: `Claim: ${bonus.label}`,
          onclick: () => {
            const result = game.claimStatusBonus();
            if (result.ok) renderList(true);
          },
        },
        [
          el('span', { class: `buddy-icon ${buddy.avatar}`, 'aria-hidden': 'true' }),
          el('span', { class: 'chat__hot-text' }, [
            el('strong', { text: buddy.name }),
            el('em', { text: bonus.status }),
          ]),
          el('span', { class: 'chat__hot-claim' }, [
            el('span', { class: 'chat__hot-label', text: 'Nudge back' }),
            el('span', { class: 'chat__hot-timer', dataset: { role: 'hot-timer' }, text: '' }),
          ]),
        ],
      ),
    );
    return row;
  }

  function fillRow() {
    return el('li', { class: 'chat__space', 'aria-hidden': 'true' });
  }

  let listKey = null;

  function renderList(force = false) {
    const s = game.state;
    const epoch = Math.floor(Date.now() / (STATUS_EVENT.ambientRotationSeconds * 1000));
    const key = `${s.chat.bots}|${epoch}|${s.chat.event?.bonusId ?? ''}|${s.chat.event?.index ?? ''}`;
    if (!force && key === listKey) return;
    listKey = key;

    clear(list);

    if (s.chat.event) list.appendChild(hotRow(s.chat.event));

    if (s.chat.bots === 0) {
      list.appendChild(
        el('li', { class: 'chat__empty', text: 'Nobody online yet. Add your first buddy.' }),
      );
      list.appendChild(fillRow());
      return;
    }

    // Group headers count the whole buddy list, not the drawn slice — showing
    // "Online (12)" next to "28 buddies" reads as if the other 16 vanished.
    let onlineTotal = 0;
    for (let i = 0; i < s.chat.bots; i += 1) if (!isAway(i, epoch)) onlineTotal += 1;
    const awayTotal = s.chat.bots - onlineTotal;

    // Newest buddies first — the list reads as "who just signed in".
    const shown = Math.min(s.chat.bots, VISIBLE_BUDDIES);
    const online = [];
    const away = [];
    for (let i = 0; i < shown; i += 1) {
      const index = s.chat.bots - 1 - i;
      (isAway(index, epoch) ? away : online).push(index);
    }

    if (online.length > 0) {
      list.appendChild(el('li', { class: 'chat__group', text: `Online (${onlineTotal})` }));
      for (const index of online) list.appendChild(buddyRow(index, epoch));
    }
    if (away.length > 0) {
      list.appendChild(el('li', { class: 'chat__group', text: `Away (${awayTotal})` }));
      for (const index of away) list.appendChild(buddyRow(index, epoch));
    }
    if (s.chat.bots > shown) {
      list.appendChild(el('li', { class: 'chat__more', text: `+${s.chat.bots - shown} more buddies online` }));
    }

    list.appendChild(fillRow());
  }

  /* ------------------------------------------------------------ breakdown */

  /**
   * Shows the working behind the rate. Only factors that are actually doing
   * something are listed, so a clean system reads "28 × 0.5 = 14 / sec" and a
   * bloated one explains where the missing Buzz went.
   */
  function renderBreakdown(bd) {
    const parts = [
      el('span', { text: `${bd.bots} × ${bd.perBot}` }),
      ...(bd.milestone !== 1
        ? [el('span', { class: 'is-boost', text: `×${bd.milestone.toFixed(2)} buddies` })]
        : []),
      ...(bd.buffs !== 1
        ? [el('span', { class: 'is-boost', text: `×${bd.buffs.toFixed(2)} bonus` })]
        : []),
      ...(bd.playlist !== 1
        ? [el('span', { class: 'is-boost', text: `×${bd.playlist.toFixed(2)} playlist` })]
        : []),
      ...(bd.cpu !== 1 ? [el('span', { class: 'is-boost', text: `×${bd.cpu.toFixed(2)} CPU` })] : []),
      ...(bd.bloat !== 1
        ? [el('span', { class: 'is-drag', text: `×${bd.bloat.toFixed(2)} bloat` })]
        : []),
      // Seeding is a separate producer, so it adds rather than multiplies —
      // showing it as a factor would misreport where the Buzz comes from.
      ...(bd.seeds > 0
        ? [el('span', { class: 'is-boost', text: `+ ${formatNumber(bd.seeds)} seeding` })]
        : []),
      el('span', { class: 'is-total', text: `= ${formatNumber(bd.total)} / sec` }),
    ];

    clear(breakdown);
    breakdown.append(...parts);
  }

  /* ---------------------------------------------------------------- buffs */

  let buffKey = null;

  function renderBuffs(now) {
    const buffs = activeBuffs(game.state, now);
    const key = buffs.map((b) => b.id).join(',');
    if (key !== buffKey) {
      buffKey = key;
      clear(buffsRoot);
      for (const buff of buffs) {
        buffsRoot.appendChild(
          el('span', { class: 'chat__buff', dataset: { buffId: buff.id } }, [
            el('span', { class: 'chat__buff-label', text: buff.label }),
            el('span', { class: 'chat__buff-value', text: `+${Math.round(buff.magnitude * 100)}%` }),
            el('span', { class: 'chat__buff-timer' }),
          ]),
        );
      }
    }
    // Countdowns update every pass; the chips themselves do not get rebuilt.
    for (const buff of buffs) {
      const chip = buffsRoot.querySelector(`[data-buff-id="${buff.id}"] .chat__buff-timer`);
      if (chip) chip.textContent = `${Math.ceil(remainingSeconds(buff, now))}s`;
    }
  }

  /* --------------------------------------------------------------- update */

  const update = throttle(() => {
    const s = game.state;
    const { econ } = game;
    const now = Date.now();

    const name = s.username || 'Guest';
    if (ref('me-name').textContent !== name) ref('me-name').textContent = name;

    ref('rate').textContent = `${formatNumber(econ.buzzPerSecond(s, now))} / sec`;
    ref('bot-count').textContent = `${s.chat.bots} ${s.chat.bots === 1 ? 'buddy' : 'buddies'}`;

    const milestone = econ.nextChatMilestone(s);
    const multiplier = econ.chatMilestoneMultiplier(s);
    if (milestone) {
      ref('milestone-text').textContent = `×${multiplier.toFixed(2)} · ${milestone.remaining} to +${Math.round(milestone.bonus * 100)}%`;
      const span = CHAT_BOT.milestoneEvery;
      setBar(ref('milestone-bar'), (span - milestone.remaining) / span, { warn: 2, critical: 2 });
    } else {
      ref('milestone-text').textContent = `×${multiplier.toFixed(2)} · buddy list full`;
      setBar(ref('milestone-bar'), 1, { warn: 2, critical: 2 });
    }

    /**
     * The add-contact control. The price rides on the button as a hint rather
     * than as a second line of chrome, and the bulk imports carry theirs in the
     * drop-down — which is where a menu item's shortcut column always went.
     */
    const snapshot = view.read();
    if (snapshot) {
      const one = snapshot.steps[0];
      addButton.setDisabled(one.disabled);
      addButton.setHint(snapshot.maxed ? 'List full' : formatNumber(one.cost));
      addButton.setItems(
        IMPORTS.map((i) => {
          const step = snapshot.steps.find((x) => x.step === i.step);
          return {
            label: i.label,
            hint: step && !snapshot.maxed ? formatNumber(step.cost) : '—',
            disabled: !step || step.disabled,
            onSelect: () => addContacts(i.step),
          };
        }),
      );

      status.set('contacts', `${snapshot.units} contacts`);
      status.set('rate', `${formatNumber(snapshot.production)} Buzz/sec`);
      status.set('connection', snapshot.maxed ? 'List full' : 'Connected');
    }

    renderBreakdown(econ.rateBreakdown(s, now));
    renderList();
    renderBuffs(now);

    const timer = ref('hot-timer');
    if (timer) timer.textContent = `${Math.ceil(claimSecondsLeft(s, now))}s`;
  }, 150);

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);
  return () => {
    unsubscribe();
    optionsOpen?.close();
    addButton.destroy();
    menus.destroy();
    body.classList.remove('app-aerochat');
  };
}

/**
 * This app owns its own economy UI, so `apps/registry.js` must not append the
 * shared one. Every converted app exports this; the flag disappears once all
 * twelve are done.
 */
export const ownsBuildingUI = true;
