import { AEROSTUDIO } from '../data/balance.js';
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
      const def = AEROSTUDIO.upgrades[id];
      const level = upgrades[id];
      const cost = Math.ceil(def.baseCost * Math.pow(def.costGrowth, level));
      
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

    // Calculate ETA (rough estimate based on current speed)
    let etaText = '';
    if (isRendering) {
      const remainingPct = 1 - progress;
      const baseRequired = AEROSTUDIO.baseRenderRequired;
      const rate = Math.max(1, game.econ.buzzPerSecond(s, Date.now()));
      
      let mult = 1;
      mult += AEROSTUDIO.upgrades.sidechainCompression.speedBonus * upgrades.sidechainCompression;
      mult += AEROSTUDIO.upgrades.arpeggiator.speedBonus * upgrades.arpeggiator;
      mult += AEROSTUDIO.upgrades.environmentalFx.speedBonus * upgrades.environmentalFx;
      
      const speed = rate * mult;
      // Total seconds the render takes = baseRequired / speed
      // Wait, in updateRender: progressGained = dt * multi
      // state.progress += progressGained / baseRequired
      // So dt needed to get remaining pct = (remainingPct * baseRequired) / multi
      // Oh, wait, the rate is not included in the multi. 
      // Let's look at updateRender in aerostudio.js. 
      // updateRender does: 
      // progressGained = dt * multi (where multi is just the upgrade multi).
      // rate is calculated but not used in `updateRender`. Ah, wait, did I forget to use rate in `updateRender`?
      // Let me double check... Yes, in updateRender I wrote `dt * multi`, and didn't multiply by rate!
      // I will need to fix `aerostudio.js` core!
      
      const secondsLeft = (remainingPct * AEROSTUDIO.baseRenderRequired) / mult;
      const etaStr = `ETA: ${formatDuration(secondsLeft)}`;
      if (etaText !== etaStr) etaText = etaStr;
      
      const detailStr = `Working on ${s.aerostudio.currentProject}. Prod debuffed 20%.`;
      if (ref('detail').textContent !== detailStr) ref('detail').textContent = detailStr;
    } else {
      const detailStr = `Select upgrades or start rendering.`;
      if (ref('detail').textContent !== detailStr) ref('detail').textContent = detailStr;
    }
    
    if (ref('eta').textContent !== etaText) ref('eta').textContent = etaText;
    
    // Progress Bar
    setBar(ref('render-bar'), progress, { warn: 2, critical: 2 });
    // Keep it always green/aqua instead of the default warn/critical colors if possible, 
    // or we'll just style it in CSS.

  }, 200);

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);
  return () => {
    unsubscribe();
    clear(tracksRoot);
    body.classList.remove('app-aerostudio');
  };
}
