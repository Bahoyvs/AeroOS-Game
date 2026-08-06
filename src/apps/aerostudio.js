import { AEROSTUDIO } from '../data/balance.js';
import { getSpeedMultiplier, getUpgradeCost } from '../core/aerostudio.js';
import { formatDuration, formatNumber } from '../core/format.js';
import { clear, el, setBar, throttle } from './../ui/dom.js';

/**
 * Aero Studio (Day 7) — Mega-project render center.
 */
export function mount(body, { game }) {
  body.classList.add('app-aerostudio');
  body.innerHTML = `
    <div class="aero-toolbar">
      <button type="button" class="aero-btn" data-role="start-btn">Start Render</button>
      <button type="button" class="aero-btn is-danger" data-role="cancel-btn">Cancel Render</button>
      <div class="aero-status">
        <strong data-role="status">Ready</strong>
        <span data-role="detail">Select upgrades or start rendering.</span>
      </div>
    </div>

    <div class="aero-preview" data-role="preview">
      <div class="aero-waveform"></div>
      <div class="aero-playhead-wrapper">
        <div class="aero-playhead"></div>
      </div>
      <div class="aero-render-text" data-role="render-text">NO VIDEO</div>
      <div class="aero-timecode" data-role="timecode">00:00:00:00</div>
    </div>

    <h4 class="aero-heading">Timeline / Track Upgrades</h4>
    <ul class="aero-timeline" data-role="tracks"></ul>

    <div class="aero-render-panel">
      <div class="meter__track aero-progress-track">
        <div class="meter__fill aero-progress-fill" data-role="render-bar"></div>
      </div>
      <div class="aero-eta" data-role="eta"></div>
    </div>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const tracksRoot = ref('tracks');
  const trackRows = new Map();

  const upgradesInfo = [
    { id: 'sidechainCompression', label: 'Sidechain Compression', blurb: 'Pumps the bass. Render speed +25% per level.' },
    { id: 'arpeggiator', label: '16th-Note Arpeggiator', blurb: 'Fast sequence generation. Render speed +50% per level.' },
    { id: 'environmentalFx', label: 'Environmental FX', blurb: 'Massive atmospheric reverb. Render speed +100% per level.' }
  ];

  // Initialize Tracks
  for (const info of upgradesInfo) {
    const button = el(
      'button',
      {
        type: 'button',
        class: 'aero-track-btn',
        dataset: { upgradeId: info.id },
        onclick: () => {
          const result = game.buyAeroUpgrade(info.id);
          if (!result.ok) {
            game.notify('Cannot upgrade', `Needs ${formatNumber(result.cost)} Buzz.`, 'warn');
          }
          update();
        },
      },
      [
        el('div', { class: 'aero-track-info' }, [
          el('div', { class: 'aero-track-title' }, [
            el('strong', { text: info.label }),
            el('div', { class: 'aero-eq' }, [el('span'), el('span'), el('span'), el('span')])
          ]),
          el('small', { text: info.blurb }),
        ]),
        el('div', { class: 'aero-track-stats' }, [
          el('span', { class: 'aero-level', dataset: { role: `level-${info.id}` } }),
          el('span', { class: 'aero-cost', dataset: { role: `cost-${info.id}` } }),
        ]),
      ],
    );
    tracksRoot.appendChild(el('li', { class: 'aero-track' }, button));
    trackRows.set(info.id, button);
  }

  // Bind Buttons
  ref('start-btn').onclick = () => {
    const result = game.startRender("Argent Metal OST");
    if (!result.ok) {
      game.notify('Error', 'Already rendering.', 'warn');
    }
    update();
  };

  ref('cancel-btn').onclick = () => {
    game.cancelRender();
    update();
  };

  /* --------------------------------------------------------------- update */

  const update = throttle(() => {
    const s = game.state;
    const { isRendering, progress, upgrades } = s.aerostudio;

    for (const [id, button] of trackRows) {
      const level = upgrades[id];
      const cost = getUpgradeCost(id, level);

      const levelStr = `Lvl ${level}`;
      if (ref(`level-${id}`).textContent !== levelStr) ref(`level-${id}`).textContent = levelStr;
      
      const costStr = `${formatNumber(cost)} Buzz`;
      if (ref(`cost-${id}`).textContent !== costStr) ref(`cost-${id}`).textContent = costStr;
      
      button.disabled = s.buzz < cost;
    }

    ref('start-btn').disabled = isRendering;
    ref('cancel-btn').disabled = !isRendering;

    const statusStr = isRendering ? 'Rendering...' : 'Ready';
    if (ref('status').textContent !== statusStr) ref('status').textContent = statusStr;

    const renderTextStr = isRendering ? 'RENDERING...' : 'NO VIDEO';
    if (ref('render-text').textContent !== renderTextStr) ref('render-text').textContent = renderTextStr;
    
    // Preview animation class
    if (ref('preview').classList.contains('is-active') !== isRendering) {
      ref('preview').classList.toggle('is-active', isRendering);
      body.classList.toggle('is-rendering', isRendering);
    }

    if (isRendering) {
      // 2-hour movie at 24fps
      const totalFrames = 2 * 60 * 60 * 24; 
      const currentFrame = Math.floor(progress * totalFrames);
      const h = Math.floor(currentFrame / (60 * 60 * 24)).toString().padStart(2, '0');
      const m = Math.floor((currentFrame / (60 * 24)) % 60).toString().padStart(2, '0');
      const s = Math.floor((currentFrame / 24) % 60).toString().padStart(2, '0');
      const f = (currentFrame % 24).toString().padStart(2, '0');
      ref('timecode').textContent = `${h}:${m}:${s}:${f}`;
    } else {
      ref('timecode').textContent = '00:00:00:00';
    }

    // ETA mirrors updateRender(): progress advances by dt × the upgrade
    // multiplier, over baseRenderRequired. Read the multiplier from core rather
    // than re-deriving it here, so the two cannot drift apart.
    let etaText = '';
    if (isRendering) {
      const secondsLeft = ((1 - progress) * AEROSTUDIO.baseRenderRequired) / getSpeedMultiplier(s);
      etaText = `ETA: ${formatDuration(secondsLeft)}`;
      ref('detail').textContent = `Working on ${s.aerostudio.currentProject}. Prod debuffed 20%.`;
    } else {
      ref('detail').textContent = 'Select upgrades or start rendering.';
    }

    if (ref('eta').textContent !== etaText) ref('eta').textContent = etaText;

    // Tone stays aqua from the stylesheet, so warn/critical never trip.
    setBar(ref('render-bar'), progress, { warn: 2, critical: 2 });
  }, 200);

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);
  return () => {
    unsubscribe();
    clear(tracksRoot);
    body.classList.remove('app-aerostudio');
  };
}
