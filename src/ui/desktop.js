import { ALL_APPS, getApp } from '../data/apps.js';
import { formatNumber } from '../core/format.js';
import { clear, el, setBar, throttle } from './dom.js';

/**
 * The desktop: icon grid plus the always-on-top Aero gadget that carries the
 * Buzz readout, the memory/bloat meters and the Nudge button (AO-5).
 */
export function createDesktop({ iconRoot, gadgetRoot, game, launch }) {
  /* ---------------------------------------------------------------- icons */

  function renderIcons() {
    clear(iconRoot);
    for (const app of ALL_APPS) {
      if (!game.state.apps[app.id]?.installed) continue;
      // My Computer stays hidden until the first bottleneck reveals hardware.
      if (app.system && !game.state.tutorial.hardwareRevealed) continue;

      const icon = el(
        'button',
        {
          class: 'desktop-icon',
          type: 'button',
          title: app.blurb,
          dataset: { appId: app.id },
          ondblclick: () => launch(app.id),
          onclick: (e) => {
            // Single tap launches on touch/PDA, double-click on desktop.
            if (e.detail === 0 || matchMedia('(pointer: coarse)').matches) launch(app.id);
          },
          onkeydown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') launch(app.id);
          },
        },
        [
          el('img', { class: 'desktop-icon__glyph', 'aria-hidden': 'true', src: app.icon, alt: '' }),
          el('span', { class: 'desktop-icon__label', text: app.name }),
        ],
      );
      iconRoot.appendChild(icon);
    }
  }

  /* --------------------------------------------------------------- gadget */

  const gadget = el('div', { class: 'gadget glass', role: 'complementary' }, []);
  gadget.innerHTML = `
    <div class="gadget__header">
      <span class="gadget__title">AeroOS</span>
      <span class="gadget__badge" data-role="prestige-badge" hidden>Format C: ready</span>
    </div>

    <div class="gadget__buzz">
      <span class="gadget__buzz-value" data-role="buzz">0</span>
      <span class="gadget__buzz-unit">Buzz</span>
    </div>
    <div class="gadget__rate" data-role="rate">0 / sec</div>

    <div class="meter" data-role="meter-ram" hidden>
      <div class="meter__label"><span>Memory</span><span data-role="ram-text">0 / 0</span></div>
      <div class="meter__track"><div class="meter__fill" data-role="ram-bar"></div></div>
    </div>

    <div class="meter" data-role="meter-bloat" hidden>
      <div class="meter__label"><span>System bloat</span><span data-role="bloat-text">0%</span></div>
      <div class="meter__track"><div class="meter__fill meter__fill--bloat" data-role="bloat-bar"></div></div>
    </div>

    <div class="heat" data-role="heat" hidden>
      <span class="heat__icon" aria-hidden="true">🌡</span>
      <span class="heat__value" data-role="heat-value">38°C</span>
      <span class="heat__track"><span class="heat__fill" data-role="heat-bar"></span></span>
    </div>

    <button type="button" class="nudge-button" data-role="nudge">
      <span class="nudge-button__label">NUDGE</span>
      <span class="nudge-button__hint" data-role="nudge-power">+1</span>
    </button>
    <p class="gadget__dollars" data-role="dollars">$0.00</p>
  `;
  gadgetRoot.appendChild(gadget);

  const ref = (role) => gadget.querySelector(`[data-role="${role}"]`);
  const nodes = {
    buzz: ref('buzz'),
    rate: ref('rate'),
    ramBar: ref('ram-bar'),
    ramText: ref('ram-text'),
    bloatBar: ref('bloat-bar'),
    bloatText: ref('bloat-text'),
    nudge: ref('nudge'),
    nudgePower: ref('nudge-power'),
    dollars: ref('dollars'),
    prestigeBadge: ref('prestige-badge'),
    meterRam: ref('meter-ram'),
    meterBloat: ref('meter-bloat'),
    heat: ref('heat'),
    heatValue: ref('heat-value'),
    heatBar: ref('heat-bar'),
  };

  /**
   * PDA mode pins the gadget above the window stack and offsets windows by
   * `--gadget-height`. A hard-coded value is a guess, and when the content is
   * taller than the guess it spills over the window below — so publish the real
   * measured height instead and let the CSS follow it.
   */
  function publishGadgetHeight() {
    const height = Math.ceil(gadget.getBoundingClientRect().height);
    if (height > 0) {
      document.documentElement.style.setProperty('--gadget-height', `${height}px`);
    }
  }

  if (globalThis.ResizeObserver) {
    new ResizeObserver(publishGadgetHeight).observe(gadget);
  } else {
    window.addEventListener('resize', publishGadgetHeight);
  }
  requestAnimationFrame(publishGadgetHeight);

  nodes.nudge.addEventListener('click', (event) => {
    const amount = game.nudge();
    spawnFloater(event, `+${formatNumber(amount)}`);
    nodes.nudge.classList.remove('is-pressed');
    // Force a reflow so the animation restarts on rapid clicks.
    void nodes.nudge.offsetWidth;
    nodes.nudge.classList.add('is-pressed');
  });

  function spawnFloater(event, text) {
    const floater = el('span', { class: 'floater', text });
    floater.style.left = `${event.clientX}px`;
    floater.style.top = `${event.clientY}px`;
    document.body.appendChild(floater);
    setTimeout(() => floater.remove(), 900);
  }

  /* --------------------------------------------------------------- update */

  const update = throttle(() => {
    const s = game.state;
    const { econ } = game;

    nodes.buzz.textContent = formatNumber(s.buzz);
    nodes.rate.textContent = `${formatNumber(econ.buzzPerSecond(s))} / sec`;
    nodes.nudgePower.textContent = `+${formatNumber(econ.clickPower(s))}`;
    nodes.dollars.textContent = `$${s.dollars.toFixed(2)}`;

    const used = econ.ramUsed(s);
    const cap = econ.ramCapacity(s);
    nodes.ramText.textContent = `${used} / ${cap} MB`;
    setBar(nodes.ramBar, cap === 0 ? 0 : used / cap);

    nodes.bloatText.textContent = `${Math.round(s.bloat * 100)}%`;
    setBar(nodes.bloatBar, s.bloat, { warn: 0.6, critical: 0.85 });

    const revealed = s.tutorial.hardwareRevealed;
    nodes.meterRam.hidden = !revealed;
    nodes.meterBloat.hidden = !revealed;
    nodes.dollars.hidden = !revealed;

    // Heat is the escalation the player actually feels (AO-27).
    const heatLevel = econ.heatLevel(s);
    nodes.heat.hidden = !revealed;
    nodes.heatValue.textContent = `${econ.systemHeat(s)}°C`;
    nodes.heat.dataset.level = heatLevel;
    nodes.heatBar.style.clipPath = `inset(0 ${(1 - econ.heatRatio(s)) * 100}% 0 0)`;
    document.body.dataset.heat = heatLevel;

    const ready = econ.canPrestige(s);
    nodes.prestigeBadge.hidden = !ready;
    document.body.classList.toggle('is-bloated', econ.bloatLevel(s) !== 'ok');
    document.body.classList.toggle('is-critical', econ.bloatLevel(s) === 'critical');
  }, 100);

  game.bus.on(game.events.APP_INSTALLED, renderIcons);
  game.bus.on(game.events.PRESTIGE, renderIcons);
  game.bus.on(game.events.HARDWARE_REVEALED, renderIcons);

  renderIcons();
  update();

  return { update, renderIcons, appName: (id) => getApp(id).name };
}
