import { CHAT_BOT } from '../data/balance.js';
import { formatNumber } from '../core/format.js';
import { clear, el, throttle } from './../ui/dom.js';

/**
 * AeroChat — the core idle engine (AO-5).
 *
 * Bots are bought with Buzz and produce Buzz while this window is open. The
 * buddy list is cosmetic for now; Day 2 turns the status messages into real
 * timed bonuses (GDD 6).
 */

const NICKS = [
  'Baho_007',
  'xX_aero_Xx',
  '~*SilverFrost*~',
  'dial_up_dan',
  'GlossyPanda',
  'mIRC_veteran',
  'N0kia_3310',
  'CD_Burner_King',
  'frutiger.fan',
  'LAN_party_lisa',
];

const STATUSES = [
  'is playing Star Wars Battlefront II',
  'is listening to a burned CD',
  'brb, mum needs the phone',
  'is downloading something totally legal',
  'is defragging C:',
  'changed their display picture',
  'is away — dinner',
  'is watching a 240p music video',
];

const pick = (list, seed) => list[seed % list.length];

export function mount(body, { game }) {
  body.classList.add('app-aerochat');
  body.innerHTML = `
    <div class="chat__me glass">
      <span class="chat__avatar" aria-hidden="true">🙂</span>
      <div>
        <strong data-role="me">Baho_007</strong>
        <small data-role="me-status">is building a social network</small>
      </div>
    </div>

    <div class="chat__stats">
      <span data-role="bot-count">0 buddies</span>
      <span data-role="bot-rate">0 / sec</span>
    </div>

    <ul class="chat__list" data-role="list" aria-label="Buddy list"></ul>

    <div class="chat__actions">
      <button type="button" class="chat__buy" data-buy="1">Add buddy — <span data-role="cost-1">10</span></button>
      <button type="button" class="chat__buy" data-buy="10">×10 — <span data-role="cost-10">—</span></button>
      <button type="button" class="chat__buy" data-buy="max">Max</button>
    </div>
    <p class="chat__hint" data-role="hint">Buddies chat while this window is open. Closing AeroChat stops the Buzz.</p>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const list = ref('list');
  let renderedBots = -1;

  for (const button of body.querySelectorAll('[data-buy]')) {
    button.addEventListener('click', () => {
      const raw = button.dataset.buy;
      const amount = raw === 'max' ? CHAT_BOT.maxPerRun : Number(raw);
      const result = game.buyBots(amount);
      if (!result.ok) {
        game.notify('Not enough Buzz', 'Nudge a few more times.', 'warn');
        return;
      }
      update();
    });
  }

  function renderList() {
    clear(list);
    const bots = game.state.chat.bots;
    // Only the most recent buddies are drawn; the list is flavour, not a table.
    const shown = Math.min(bots, 12);
    for (let i = 0; i < shown; i += 1) {
      const index = bots - shown + i;
      list.appendChild(
        el('li', { class: 'chat__buddy' }, [
          el('span', { class: 'chat__dot', 'aria-hidden': 'true' }),
          el('span', { class: 'chat__nick', text: pick(NICKS, index) }),
          el('span', { class: 'chat__status', text: pick(STATUSES, index * 3 + 1) }),
        ]),
      );
    }
    if (bots > shown) {
      list.appendChild(el('li', { class: 'chat__more', text: `+${bots - shown} more online` }));
    }
    if (bots === 0) {
      list.appendChild(
        el('li', { class: 'chat__empty', text: 'Nobody online yet. Add your first buddy.' }),
      );
    }
  }

  const update = throttle(() => {
    const s = game.state;
    const { econ } = game;

    ref('bot-count').textContent = `${s.chat.bots} ${s.chat.bots === 1 ? 'buddy' : 'buddies'}`;
    ref('bot-rate').textContent = `${formatNumber(econ.buzzPerSecond(s))} / sec`;
    ref('cost-1').textContent = formatNumber(econ.botCost(s.chat.bots));
    ref('cost-10').textContent = formatNumber(econ.botCostBulk(s.chat.bots, 10));

    for (const button of body.querySelectorAll('[data-buy]')) {
      const raw = button.dataset.buy;
      const amount = raw === 'max' ? CHAT_BOT.maxPerRun : Number(raw);
      button.disabled = econ.affordableBots(s, amount).count === 0;
    }

    if (s.chat.bots !== renderedBots) {
      renderedBots = s.chat.bots;
      renderList();
    }
  }, 150);

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);
  return () => {
    unsubscribe();
    body.classList.remove('app-aerochat');
  };
}
