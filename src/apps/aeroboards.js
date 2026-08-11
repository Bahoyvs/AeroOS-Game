import { formatNumber } from '../core/format.js';
import { createBuyControl, createCelebration, createLockedPanel, createMeter } from '../ui/building.js';
import { clear, el, throttle } from './../ui/dom.js';

/**
 * AeroBoards — building #4 (GDD v2 §4).
 *
 * A phpBB board rendered *inside* an IE6 window frame, which is the joke and
 * also the design: this is the first building that is not a desktop program at
 * all. It is a website, so it gets browser chrome — an address bar, a status
 * bar that says "Done", and a page that has no idea it is inside a game.
 *
 * The `w32-buy` costume is the one GDD §4 names: the **"Upgrade Server
 * Hosting"** link in the footer, styled exactly like the dead admin links
 * either side of it. Buying members is renting more forum, which is the only
 * thing a board owner ever actually bought.
 *
 * Visual progression, per §4: sticky topics, locked-thread icons, and flaming
 * GIFs on the hottest threads — all derived from the milestone tier.
 */

/** The board's forum list. Fixed structure; the *rows* are what come alive. */
const FORUMS = [
  { name: 'General Discussion', desc: 'Anything and everything. Mostly everything.' },
  { name: 'Skins & Themes', desc: 'Post your desktop. Rate the one above you.' },
  { name: 'Off Topic', desc: 'Please keep it civil. (It is never civil.)' },
];

/** Thread titles, drawn from the index like every other identity here. */
const TOPICS = [
  ['THE OFFICIAL "post your desktop" THREAD v14', 'Sn1perW0lf'],
  ['Is Vista actually that bad?? [FLAME WAR]', 'aero_glass_fan'],
  ['My sig is too big? MODS ARE ASLEEP', 'xXDaRkAnGeLXx'],
  ['[GUIDE] How to get 1GB of RAM for under $80', 'PC_Builder_99'],
  ['Anyone else here still on dial-up', 'modem_noises'],
  ['MOD APPLICATION - please read before posting', 'AdminDave'],
  ['Rate my Winamp skin (56k warning)', 'llama_whipper'],
  ['Why did nobody tell me about this forum', 'newguy2007'],
];

function hash(...values) {
  let h = 0x811c9dc5;
  for (const value of values) {
    h ^= Number(value) + 0x9e3779b9 + (h << 6) + (h >>> 2);
    h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
  }
  return h >>> 0;
}

/**
 * The thread at `index`, and how heated it is.
 *
 * `tier` is the milestone tier, and it decides how much of the board's own
 * furniture is on show: at ×1 these are plain threads, and by ×8 half of them
 * are stickied, locked, or on fire. That is the progression GDD §4 asks for,
 * derived rather than stored.
 */
function topicAt(index, tier) {
  const seed = hash(index);
  const [title, author] = TOPICS[seed % TOPICS.length];
  const replies = 12 + (seed % 400) * Math.max(1, tier);
  return {
    title,
    author,
    replies,
    views: replies * (7 + (seed % 40)),
    // Each of these needs a *different* slice of the hash, or every hot thread
    // would also be every locked thread.
    sticky: tier >= 2 && seed % 7 === 0,
    locked: tier >= 4 && (seed >>> 3) % 11 === 0,
    hot: tier >= 2 && (seed >>> 6) % 4 === 0,
  };
}

const VISIBLE_TOPICS = 7;

export function mount(body, { game }) {
  body.classList.add('app-aeroboards');
  body.innerHTML = `
    <div class="ab__browser" aria-hidden="true">
      <div class="ab__addressbar">
        <span class="ab__ie-label">Address</span>
        <span class="ab__url">http://www.aeroboards.net/forum/index.php</span>
        <span class="ab__go">Go</span>
      </div>
    </div>

    <div class="ab__page">
      <div class="ab__banner">
        <span class="ab__logo">AeroBoards</span>
        <span class="ab__tagline" aria-hidden="true">« a community for people with computers »</span>
      </div>

      <div class="ab__welcome">
        Welcome, <strong data-role="user">Guest</strong>.
        You last visited: <span data-role="lastvisit">Never</span>
        · <span data-role="online"></span>
      </div>

      <div data-role="meter"></div>

      <div class="ab__forums" data-role="forums"></div>

      <div class="ab__cpanel" data-role="cpanel" hidden>
        <strong>cPanel</strong> <span data-role="cpanel-text"></span>
      </div>

      <div class="ab__footer">
        <span class="ab__footer-link is-dead" aria-hidden="true">Mark Forums Read</span>
        <span class="ab__footer-link is-dead" aria-hidden="true">Contact Us</span>
        <div data-role="buy"></div>
        <span class="ab__footer-link is-dead" aria-hidden="true">Archive</span>
        <span class="ab__footer-link is-dead" aria-hidden="true">Top</span>
      </div>

      <div data-role="locked"></div>
    </div>

    <div class="ab__statusbar" aria-hidden="true">
      <span data-role="ie-status">Done</span>
      <span class="ab__zone">🌐 Internet</span>
    </div>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const forumsRoot = ref('forums');

  /* ------------------------------------------------------- the shared kit */

  const meter = createMeter({ game, buildingId: 'aeroboards' });
  meter.root.classList.add('ab__meter');
  ref('meter').replaceWith(meter.root);

  const buy = createBuyControl({
    game,
    buildingId: 'aeroboards',
    // GDD §4's footer link. It looks like the dead admin links either side of
    // it on purpose — the fiction is that you are renting forum, not buying
    // units, and the board would never admit to the difference.
    labels: { one: 'Upgrade Server Hosting' },
    onBought: () => renderForums(true),
  });
  buy.root.classList.add('ab__buy');
  ref('buy').replaceWith(buy.root);

  const locked = createLockedPanel({
    game,
    buildingId: 'aeroboards',
    message: 'This board is not accepting registrations yet.',
  });
  ref('locked').replaceWith(locked.root);

  /**
   * The milestone: a cPanel notification granting a permission nobody asked
   * for (GDD §4). It stays on the page for a beat as a real admin banner would,
   * rather than floating over it — this app is a *website*, and websites did
   * not have toasts in 2004.
   */
  const PERMISSIONS = [
    'You may now create sticky threads.',
    'You may now lock threads in your own forums.',
    'Avatar size limit raised to 100×100.',
    'Signature image limit raised. Please be reasonable.',
    'You have been granted Moderator status.',
  ];

  const celebration = createCelebration({
    game,
    buildingId: 'aeroboards',
    host: body,
    render: ({ at, multiplier }) => {
      const index = Math.min(PERMISSIONS.length - 1, Math.floor(Math.log2(Math.max(1, multiplier))));
      return [
        el('strong', { class: 'w32celebrate__title', text: 'cPanel: new permission granted' }),
        el('span', { class: 'w32celebrate__body', text: PERMISSIONS[index] }),
        el('em', { class: 'w32celebrate__extra', text: `${formatNumber(at)} members · ×${multiplier}` }),
      ];
    },
  });

  /* -------------------------------------------------------------- forums */

  let forumsKey = null;

  function renderForums(force = false) {
    const bd = game.econ.getProductionBreakdown(game.state, 'aeroboards');
    const tier = bd.milestoneMultiplier;
    const key = `${bd.units}|${tier}`;
    if (!force && key === forumsKey) return;
    forumsKey = key;

    clear(forumsRoot);

    if (bd.units === 0) {
      forumsRoot.appendChild(
        el('p', { class: 'ab__empty', text: 'No members yet. The board is very quiet.' }),
      );
      return;
    }

    // More forum sections as the board grows: one at first, all three by ×4.
    const sections = Math.min(FORUMS.length, 1 + Math.floor(Math.log2(tier)));
    let index = 0;

    for (let f = 0; f < sections; f += 1) {
      const forum = FORUMS[f];
      forumsRoot.appendChild(
        el('div', { class: 'ab__forum-head' }, [
          el('span', { class: 'ab__forum-name', text: forum.name }),
          el('span', { class: 'ab__forum-desc', text: forum.desc }),
        ]),
      );
      forumsRoot.appendChild(
        el('div', { class: 'ab__cols', 'aria-hidden': 'true' }, [
          el('span', { text: 'Thread' }),
          el('span', { text: 'Replies' }),
          el('span', { text: 'Views' }),
        ]),
      );

      const rows = el('ul', { class: 'ab__topics' });
      const perForum = Math.max(2, Math.floor(VISIBLE_TOPICS / sections));
      for (let i = 0; i < perForum; i += 1, index += 1) {
        const topic = topicAt(index, tier);
        rows.appendChild(
          el(
            'li',
            {
              class: `ab__topic${topic.sticky ? ' is-sticky' : ''}${topic.locked ? ' is-locked' : ''}`,
            },
            [
              el('span', { class: 'ab__topic-icon', 'aria-hidden': 'true' }, [
                topic.locked
                  ? el('span', { class: 'ab__lock', text: '🔒' })
                  : el('span', { class: 'ab__doc', text: '📄' }),
                // The flaming GIF, minus the GIF: a CSS flame, so it honours
                // reduced motion instead of animating regardless.
                ...(topic.hot ? [el('span', { class: 'ab__flame', text: '🔥' })] : []),
              ]),
              el('span', { class: 'ab__topic-title' }, [
                ...(topic.sticky ? [el('b', { class: 'ab__sticky-tag', text: 'Sticky: ' })] : []),
                el('span', { text: topic.title }),
                el('small', { class: 'ab__topic-author', text: ` by ${topic.author}` }),
              ]),
              el('span', { class: 'ab__topic-replies', text: formatNumber(topic.replies) }),
              el('span', { class: 'ab__topic-views', text: formatNumber(topic.views) }),
            ],
          ),
        );
      }
      forumsRoot.appendChild(rows);
    }
  }

  /* --------------------------------------------------------------- update */

  const update = throttle(() => {
    const s = game.state;
    const { econ } = game;
    const unlocked = econ.isBuildingUnlocked(s, 'aeroboards');

    locked.root.hidden = unlocked;
    buy.root.hidden = !unlocked;
    meter.root.hidden = !unlocked;
    ref('ie-status').textContent = unlocked ? 'Done' : 'Waiting for www.aeroboards.net…';
    if (!unlocked) {
      locked.update();
      return;
    }

    const bd = econ.getProductionBreakdown(s, 'aeroboards');
    ref('user').textContent = s.username || 'Guest';
    ref('lastvisit').textContent = 'Today, 03:41 AM';
    ref('online').textContent =
      bd.units === 0
        ? '0 members online'
        : `${formatNumber(bd.units)} members online · ${formatNumber(bd.total)} Buzz/s`;

    meter.update();
    buy.update();
    renderForums();
  }, 150);

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);
  return () => {
    unsubscribe();
    celebration.destroy();
    body.classList.remove('app-aeroboards');
  };
}
