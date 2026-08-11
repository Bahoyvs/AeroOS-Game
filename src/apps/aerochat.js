import { STATUS_EVENT } from '../data/balance.js';
import { ambientStatus, buddyAt, isAway } from '../data/buddies.js';
import { activeBuffs, remainingSeconds } from '../core/buffs.js';
import { claimSecondsLeft, getBonus } from '../core/statusEvents.js';
import { formatNumber } from '../core/format.js';
import { createBuyControl, createCelebration, createMeter } from '../ui/building.js';
import { clear, el, throttle } from './../ui/dom.js';

/**
 * AeroChat — building #1, and the first thing anyone sees (AO-5, GDD v2 §4).
 *
 * Buddies are derived from their index (src/data/buddies.js), so the list can
 * show five hundred of them without storing any of it. Only a window of the
 * list is drawn; the rest is summarised.
 *
 * It was the last window still carrying its own hand-built buy row — the shape
 * every other building's kit was generalised *from*. It now uses the kit like
 * its eleven siblings, so there is one buy control in the game rather than a
 * canonical one and a copy that drifts.
 *
 * The `w32-buy` costume is MSN's own: **Add a Contact**, the wizard that asked
 * for an e-mail address and then made you wait.
 */

const VISIBLE_BUDDIES = 14;

export function mount(body, { game }) {
  body.classList.add('app-aerochat');
  body.innerHTML = `
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

    <div data-role="meter"></div>

    <p class="chat__breakdown" data-role="breakdown"></p>

    <div class="chat__buffs" data-role="buffs" aria-live="polite"></div>

    <ul class="chat__list" data-role="list" aria-label="Buddy list"></ul>

    <div data-role="buy"></div>
    <p class="chat__hint" data-role="hint">Buddies keep chatting whether or not this window is open. Closing it only frees the memory.</p>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const list = ref('list');
  const buffsRoot = ref('buffs');
  const breakdown = ref('breakdown');

  /* ------------------------------------------------------- the shared kit */

  const meter = createMeter({ game, buildingId: 'aerochat' });
  ref('meter').replaceWith(meter.root);

  const buy = createBuyControl({
    game,
    buildingId: 'aerochat',
    labels: { one: 'Add a Contact' },
    onBought: () => renderList(true),
  });
  buy.root.classList.add('chat__buy-row');
  ref('buy').replaceWith(buy.root);

  /**
   * GDD §4's milestone for AeroChat: a short automatic notice from
   * Tools → Options, as if the client had quietly reconfigured itself. The
   * quietest celebration of the twelve, deliberately — this is the innocent
   * phase, and it should not feel like a slot machine paying out.
   */
  const celebration = createCelebration({
    game,
    buildingId: 'aerochat',
    host: body,
    render: ({ at, multiplier, minigameUnlocked }) => [
      el('strong', { class: 'w32celebrate__title', text: 'Tools → Options' }),
      el('span', {
        class: 'w32celebrate__body',
        text: `${at} contacts online. Group chat capacity is now ×${multiplier}.`,
      }),
      ...(minigameUnlocked
        ? [el('em', { class: 'w32celebrate__extra', text: 'Nudge war unlocked' })]
        : []),
    ],
  });

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
    const bots = game.econ.buddyCount(s);
    const epoch = Math.floor(Date.now() / (STATUS_EVENT.ambientRotationSeconds * 1000));
    const key = `${bots}|${epoch}|${s.chat.event?.bonusId ?? ''}|${s.chat.event?.index ?? ''}`;
    if (!force && key === listKey) return;
    listKey = key;

    clear(list);

    if (s.chat.event) list.appendChild(hotRow(s.chat.event));

    if (bots === 0) {
      list.appendChild(
        el('li', { class: 'chat__empty', text: 'Nobody online yet. Add your first buddy.' }),
      );
      list.appendChild(fillRow());
      return;
    }

    // Group headers count the whole buddy list, not the drawn slice — showing
    // "Online (12)" next to "28 buddies" reads as if the other 16 vanished.
    let onlineTotal = 0;
    for (let i = 0; i < bots; i += 1) if (!isAway(i, epoch)) onlineTotal += 1;
    const awayTotal = bots - onlineTotal;

    // Newest buddies first — the list reads as "who just signed in".
    const shown = Math.min(bots, VISIBLE_BUDDIES);
    const online = [];
    const away = [];
    for (let i = 0; i < shown; i += 1) {
      const index = bots - 1 - i;
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
    if (bots > shown) {
      list.appendChild(el('li', { class: 'chat__more', text: `+${bots - shown} more buddies online` }));
    }

    list.appendChild(fillRow());
  }

  /* ------------------------------------------------------------ breakdown */

  /**
   * Shows the working behind the rate. Only factors that are actually doing
   * something are listed, so a clean system reads "28 × 0.5 = 14 / sec" and a
   * bloated one explains where the missing Buzz went.
   *
   * This one is AeroChat-specific and stays on `rateBreakdown`. A building
   * window that wants its own working uses `getProductionBreakdown` instead —
   * this panel is the machine's summary, drawn in the window that has been the
   * whole machine since the first minute of the game.
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
      ...(bd.legacy !== 1
        ? [el('span', { class: 'is-boost', text: `×${bd.legacy.toFixed(2)} legacy` })]
        : []),
      ...(bd.bloat !== 1
        ? [el('span', { class: 'is-drag', text: `×${bd.bloat.toFixed(2)} bloat` })]
        : []),
      // Seeding is a separate producer, so it adds rather than multiplies —
      // showing it as a factor would misreport where the Buzz comes from.
      ...(bd.seeds > 0
        ? [el('span', { class: 'is-boost', text: `+ ${formatNumber(bd.seeds)} seeding` })]
        : []),
      // ...and so is every other building. One line for all eleven: this panel
      // shows AeroChat's working, not the machine's.
      ...(bd.others > 0
        ? [el('span', { class: 'is-boost', text: `+ ${formatNumber(bd.others)} elsewhere` })]
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

    // One accessor, per GDD §2.8: the window translates these numbers into
    // buddy-list language and never computes one of its own.
    const bd = econ.getProductionBreakdown(s, 'aerochat', now);

    ref('rate').textContent = `${formatNumber(econ.buzzPerSecond(s, now))} / sec`;
    meter.update();
    buy.update();

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
    celebration.destroy();
    body.classList.remove('app-aerochat');
  };
}
