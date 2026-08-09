import { clear, el, throttle } from '../ui/dom.js';
import { mountBuildingPanel } from '../ui/buildingPanel.js';

/**
 * GeoPage — a Geocities homepage editor (GDD §A.4).
 *
 * The three details that make it read as 1999 rather than "retro-styled": the
 * odometer hit counter, the UNDER CONSTRUCTION sign, and a WYSIWYG pane whose
 * content is visibly, proudly bad. The construction sign is drawn in CSS rather
 * than shipped as an animated GIF — same look, no asset, and it respects the
 * reduced-motion setting the shell already resolves.
 *
 * No mini-game here: GeoPage is one of the seven buildings the design
 * deliberately left alone (GDD §B.2), so it gets a plain building panel.
 */
export function mount(body, { game }) {
  body.classList.add('app-geopage');
  body.innerHTML = `
    <div class="gp__browser">
      <div class="gp__chrome">
        <span class="gp__url">http://www.geopage.com/~aeroos/index.html</span>
      </div>
      <div class="gp__page">
        <span class="gp__marquee" data-role="marquee"></span>
        <h3 class="gp__title">✦ Welcome 2 My Homepage ✦</h3>
        <div class="gp__construction" aria-label="Under construction">
          <span class="gp__cone" aria-hidden="true"></span>
          <span>UNDER CONSTRUCTION</span>
        </div>
        <p class="gp__body">
          hi!!! this site is best viewed in 800x600. sign my guestbook!!
        </p>
        <div class="gp__counter" aria-label="Visitor counter">
          <span class="gp__counter-label">You are visitor</span>
          <span class="gp__odometer" data-role="odometer"></span>
        </div>
      </div>
    </div>
    <div data-role="panel"></div>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const odometer = ref('odometer');

  /**
   * The odometer. Digits are rendered as individual cells so the counter looks
   * like the mechanical LED GIFs everyone used, and only the digits that
   * actually changed are rewritten — the number ticks several times a second
   * and replacing eight nodes each time would be the most expensive thing in
   * the window.
   */
  let digitNodes = [];
  function renderOdometer(value) {
    const text = String(Math.floor(value)).padStart(8, '0');
    if (digitNodes.length !== text.length) {
      clear(odometer);
      digitNodes = [...text].map((ch) => {
        const node = el('i', { class: 'gp__digit', text: ch });
        odometer.appendChild(node);
        return node;
      });
      return;
    }
    for (let i = 0; i < text.length; i += 1) {
      if (digitNodes[i].textContent !== text[i]) digitNodes[i].textContent = text[i];
    }
  }

  const MESSAGES = [
    '★ ★ ★ THANKS 4 VISITING ★ ★ ★',
    'this page is 100% hand coded in notepad',
    'best viewed in Internet Exploder 6',
    'webring: << prev · random · next >>',
  ];
  let messageIndex = 0;
  const marquee = ref('marquee');
  marquee.textContent = MESSAGES[0];
  const rotate = setInterval(() => {
    messageIndex = (messageIndex + 1) % MESSAGES.length;
    marquee.textContent = MESSAGES[messageIndex];
  }, 6000);

  const update = throttle(() => {
    // Visitors are the building's lifetime output, which is the honest reading
    // of what a GeoPage unit produces: traffic.
    const units = game.units('geopage');
    const rate = game.productionBreakdown('geopage').total;
    renderOdometer(units === 0 ? 0 : game.state.stats.playtimeSeconds * (1 + units) + rate / 10);
    body.querySelector('.gp__page').classList.toggle('is-live', units > 0);
  }, 300);

  const panelCleanup = mountBuildingPanel(ref('panel'), { game, buildingId: 'geopage' });

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);

  return () => {
    unsubscribe();
    clearInterval(rotate);
    panelCleanup();
    body.classList.remove('app-geopage');
  };
}
