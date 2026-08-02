import { CHAT_BOT, STATUS_EVENT } from '../data/balance.js';
import { ambientStatus, buddyAt, isAway } from '../data/buddies.js';
import { activeBuffs, remainingSeconds } from '../core/buffs.js';
import { claimSecondsLeft, getBonus } from '../core/statusEvents.js';
import { formatNumber } from '../core/format.js';
import { clear, el, setBar, throttle } from './../ui/dom.js';

/**
 * AeroChat — the core idle engine (AO-5, AO-8, AO-9, AO-10).
 *
 * Buddies are derived from their index (src/data/buddies.js), so the list can
 * show 500 of them without storing any of it. Only a window of the list is
 * drawn; the rest is summarised.
 */

const VISIBLE_BUDDIES = 14;

export function mount(body, { game }) {
  body.classList.add('app-aerochat');
  body.innerHTML = `
    <div class="chat__me glass">
      <span class="chat__avatar" aria-hidden="true">🙂</span>
      <div class="chat__me-text">
        <strong>Baho_007</strong>
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

    <div class="chat__buffs" data-role="buffs" aria-live="polite"></div>

    <ul class="chat__list" data-role="list" aria-label="Buddy list"></ul>

    <div class="chat__actions">
      <button type="button" class="chat__buy" data-buy="1">
        Add buddy<small data-role="cost-1">10</small>
      </button>
      <button type="button" class="chat__buy" data-buy="10">
        ×10<small data-role="cost-10">—</small>
      </button>
      <button type="button" class="chat__buy" data-buy="max">
        Max<small data-role="cost-max">—</small>
      </button>
    </div>
    <p class="chat__hint" data-role="hint">Buddies chat while this window is open. Closing AeroChat stops the Buzz.</p>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const list = ref('list');
  const buffsRoot = ref('buffs');

  for (const button of body.querySelectorAll('[data-buy]')) {
    button.addEventListener('click', () => {
      const amount = button.dataset.buy === 'max' ? CHAT_BOT.maxPerRun : Number(button.dataset.buy);
      const result = game.buyBots(amount);
      if (!result.ok) {
        game.notify(
          result.reason === 'buddy-list-full' ? 'Buddy list is full' : 'Not enough Buzz',
          result.reason === 'buddy-list-full'
            ? `${CHAT_BOT.maxPerRun} buddies is the cap for this run.`
            : 'Nudge a few more times.',
          'warn',
        );
        return;
      }
      update();
    });
  }

  /* ------------------------------------------------------------ buddy list */

  function buddyRow(index, epoch) {
    const buddy = buddyAt(index);
    const away = isAway(index, epoch);
    return el('li', { class: `chat__buddy${away ? ' is-away' : ''}` }, [
      el('span', { class: 'chat__avatar-sm', 'aria-hidden': 'true', text: buddy.avatar }),
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
          el('span', { class: 'chat__avatar-sm', 'aria-hidden': 'true', text: buddy.avatar }),
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

    // Newest buddies first — the list reads as "who just signed in".
    const shown = Math.min(s.chat.bots, VISIBLE_BUDDIES);
    const online = [];
    const away = [];
    for (let i = 0; i < shown; i += 1) {
      const index = s.chat.bots - 1 - i;
      (isAway(index, epoch) ? away : online).push(index);
    }

    if (online.length > 0) {
      list.appendChild(el('li', { class: 'chat__group', text: `Online (${online.length})` }));
      for (const index of online) list.appendChild(buddyRow(index, epoch));
    }
    if (away.length > 0) {
      list.appendChild(el('li', { class: 'chat__group', text: `Away (${away.length})` }));
      for (const index of away) list.appendChild(buddyRow(index, epoch));
    }
    if (s.chat.bots > shown) {
      list.appendChild(el('li', { class: 'chat__more', text: `+${s.chat.bots - shown} more buddies online` }));
    }

    list.appendChild(fillRow());
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

    for (const button of body.querySelectorAll('[data-buy]')) {
      const raw = button.dataset.buy;
      const amount = raw === 'max' ? CHAT_BOT.maxPerRun : Number(raw);
      const { count, cost } = econ.affordableBots(s, amount);
      button.disabled = count === 0;
      const costNode = ref(`cost-${raw}`);
      if (costNode) {
        costNode.textContent =
          raw === 'max'
            ? count > 0
              ? `${count} · ${formatNumber(cost)}`
              : '—'
            : formatNumber(econ.botCostBulk(s.chat.bots, amount));
      }
    }

    renderList();
    renderBuffs(now);

    const timer = ref('hot-timer');
    if (timer) timer.textContent = `${Math.ceil(claimSecondsLeft(s, now))}s`;
  }, 150);

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);
  return () => {
    unsubscribe();
    body.classList.remove('app-aerochat');
  };
}
