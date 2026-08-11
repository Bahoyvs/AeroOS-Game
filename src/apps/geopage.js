import { formatNumber } from '../core/format.js';
import { createBuyControl, createCelebration, createLockedPanel, createMeter } from '../ui/building.js';
import { clear, el, throttle } from './../ui/dom.js';

/**
 * GeoPage — building #6 (GDD v2 §4).
 *
 * The Geocities editor, which means two panes that disagree with each other: a
 * WYSIWYG preview of a personal homepage on top, and a **View Source** pane
 * underneath showing the tag soup that produces it. The player edits neither —
 * they add widgets, and both panes react.
 *
 * The `w32-buy` costume is GDD §4's pair: **Add Widget** for one, and the bulk
 * steps stand in for **Embed Top 8**. The milestone moment is the one §4 names:
 * a new snippet appears in View Source on its own, which is exactly how a
 * Geocities page grew — somebody pasted something and never took it out.
 */

/** Widgets, in the order a page acquired them. Index into this with the tier. */
const WIDGETS = [
  { tag: 'hit counter', html: '<img src="/cgi-bin/counter.cgi?df=me.dat">' },
  { tag: 'guestbook', html: '<a href="gbook.html"><img src="signmy.gif"></a>' },
  { tag: 'MIDI autoplay', html: '<bgsound src="music/tubular.mid" loop="infinite">' },
  { tag: 'marquee', html: '<marquee scrollamount="6">welcome 2 my page!!!</marquee>' },
  { tag: 'Top 8 friends', html: '<table border="1" bgcolor="#000000"><!-- top 8 -->' },
  { tag: 'glitter text', html: '<img src="glitter/mypage_sparkle.gif" border="0">' },
];

/** The page's own decorations, revealed as the tier climbs. */
const STICKERS = ['✨', '💿', '🌈', '⭐', '👽', '💖'];

export function mount(body, { game }) {
  body.classList.add('app-geopage');
  body.innerHTML = `
    <div class="gp__toolbar" aria-hidden="true">
      <span class="gp__wordmark">GeoPage Editor</span>
      <span class="gp__tab is-active">Design</span>
      <span class="gp__tab" data-role="source-tab">HTML</span>
    </div>

    <div class="gp__preview" data-role="preview">
      <div class="gp__construction" aria-hidden="true">
        <span class="gp__cone">🚧</span>
        <span class="gp__construction-text">UNDER CONSTRUCTION</span>
        <span class="gp__cone">🚧</span>
      </div>

      <h3 class="gp__title" data-role="title">MY HOME PAGE</h3>
      <p class="gp__welcome" data-role="welcome">welcome 2 my page!!! plz sign my guestbook</p>

      <div class="gp__stickers" data-role="stickers" aria-hidden="true"></div>

      <div class="gp__counter">
        <span class="gp__counter-label">You are visitor number</span>
        <span class="gp__counter-digits" data-role="counter">000000</span>
      </div>

      <div class="gp__midi" data-role="midi" hidden>
        ♪ now playing: <em>tubular.mid</em>
      </div>
    </div>

    <div class="gp__source">
      <div class="gp__source-head" aria-hidden="true">
        <span>index.html — Notepad</span>
        <span class="gp__source-menu">File  Edit  Format</span>
      </div>
      <pre class="gp__code" data-role="code"></pre>
    </div>

    <div data-role="meter"></div>
    <div data-role="buy"></div>
    <div data-role="locked"></div>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const codeRoot = ref('code');
  const stickerRoot = ref('stickers');

  /* ------------------------------------------------------- the shared kit */

  const meter = createMeter({ game, buildingId: 'geopage' });
  ref('meter').replaceWith(meter.root);

  const buy = createBuyControl({
    game,
    buildingId: 'geopage',
    labels: { one: '＋ Add Widget' },
    onBought: () => renderSource(true),
  });
  buy.root.classList.add('gp__buy');
  ref('buy').replaceWith(buy.root);

  const locked = createLockedPanel({
    game,
    buildingId: 'geopage',
    message: 'Your free 15 MB of web space is still being provisioned…',
  });
  ref('locked').replaceWith(locked.root);

  /**
   * The milestone (GDD §4): a new snippet writes *itself* into View Source.
   *
   * The celebration overlay says what landed, and `renderSource` then draws it
   * into the code pane permanently — so unlike every other building's moment,
   * this one leaves something behind. That is the joke about Geocities pages:
   * nothing ever got removed.
   */
  const celebration = createCelebration({
    game,
    buildingId: 'geopage',
    host: body,
    render: ({ multiplier, minigameUnlocked }) => {
      const widget = WIDGETS[Math.min(WIDGETS.length - 1, Math.floor(Math.log2(multiplier)) + 1)];
      return [
        el('strong', { class: 'w32celebrate__title', text: 'Widget added to your page' }),
        el('span', { class: 'w32celebrate__body', text: `<${widget.tag}> is now live. ×${multiplier} visitors.` }),
        ...(minigameUnlocked
          ? [el('em', { class: 'w32celebrate__extra', text: 'Guestbook moderation unlocked' })]
          : []),
      ];
    },
  });

  /* --------------------------------------------------------- View Source */

  let sourceKey = null;

  /** How many widgets the page has earned — the tier, not the unit count. */
  const widgetCount = (tier) => Math.min(WIDGETS.length, 1 + Math.floor(Math.log2(tier)));

  function renderSource(force = false) {
    const bd = game.econ.getProductionBreakdown(game.state, 'geopage');
    const tier = bd.milestoneMultiplier;
    const key = `${bd.units}|${tier}`;
    if (!force && key === sourceKey) return;
    sourceKey = key;

    clear(codeRoot);
    clear(stickerRoot);

    if (bd.units === 0) {
      codeRoot.textContent = '<html>\n<body bgcolor="#000000">\n\n</body>\n</html>';
      return;
    }

    const shown = widgetCount(tier);
    const lines = [
      '<html>',
      '<head><title>MY HOME PAGE</title></head>',
      '<body bgcolor="#000000" text="#00ff00">',
      ...WIDGETS.slice(0, shown).map((w) => `  ${w.html}`),
      `  <!-- ${formatNumber(bd.units)} widgets, none of them removed -->`,
      '</body>',
      '</html>',
    ];

    // The newest line is highlighted, which is what makes the pane read as
    // something that just changed rather than a static block of text.
    lines.forEach((line, i) => {
      const isNewest = i === 3 + shown - 1;
      codeRoot.appendChild(
        el('span', { class: `gp__line${isNewest ? ' is-new' : ''}`, text: `${line}\n` }),
      );
    });

    for (let i = 0; i < shown; i += 1) {
      stickerRoot.appendChild(el('span', { class: 'gp__sticker', text: STICKERS[i] }));
    }
  }

  /* --------------------------------------------------------------- update */

  const update = throttle(() => {
    const s = game.state;
    const { econ } = game;
    const unlocked = econ.isBuildingUnlocked(s, 'geopage');

    locked.root.hidden = unlocked;
    buy.root.hidden = !unlocked;
    meter.root.hidden = !unlocked;
    if (!unlocked) {
      locked.update();
      return;
    }

    const bd = econ.getProductionBreakdown(s, 'geopage');

    /**
     * The visitor counter, and the reason it is not just `units`: a Geocities
     * counter was famously, obviously inflated, so this one runs on the whole
     * building's output. It rolls like the CGI odometer it is pretending to be.
     */
    const visitors = Math.floor(bd.units * bd.milestoneMultiplier * 137);
    ref('counter').textContent = String(visitors).padStart(6, '0').slice(-6);

    ref('title').textContent = bd.milestoneMultiplier >= 4 ? '★ MY HOME PAGE ★' : 'MY HOME PAGE';
    ref('midi').hidden = bd.milestoneMultiplier < 4;
    body.classList.toggle('is-loud', bd.milestoneMultiplier >= 8);

    meter.update();
    buy.update();
    renderSource();
  }, 150);

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);
  return () => {
    unsubscribe();
    celebration.destroy();
    body.classList.remove('app-geopage', 'is-loud');
  };
}
