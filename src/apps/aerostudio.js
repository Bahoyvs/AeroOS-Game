import { ADS, AEROSTUDIO } from '../data/balance.js';
import { getSpeedMultiplier, getUpgradeCost } from '../core/aerostudio.js';
import { formatDuration, formatNumber } from '../core/format.js';
import { clear, el, setBar, throttle } from './../ui/dom.js';

/**
 * Aero Studio (Day 7) — Mega-project render center.
 *
 * UI states:
 *  1. Idle          — "Ready" / "NO VIDEO" / Start active
 *  2. Rendering     — "RENDERING..." / progress bar / Cancel active
 *  3. Reward Ready  — "RENDER COMPLETE" / Collect button / glow
 */
export function mount(body, { game, ads = null }) {
  body.classList.add('app-aerostudio');
  body.innerHTML = `
    <div class="aero-toolbar">
      <button type="button" class="aero-btn" data-role="start-btn">Start Render</button>
      <button type="button" class="aero-btn is-danger" data-role="cancel-btn">Cancel Render</button>
      <button type="button" class="ad-button aero-btn" data-role="skip-btn" hidden></button>
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

    <!-- Reward collection overlay — hidden until render completes -->
    <div class="aero-reward-overlay" data-role="reward-overlay">
      <div class="aero-reward-card">
        <div class="aero-reward-title">🎬 Render Complete!</div>
        <div class="aero-reward-project" data-role="reward-project"></div>
        <div class="aero-reward-amount" data-role="reward-amount"></div>
        <button type="button" class="aero-reward-btn" data-role="collect-btn">
          <span class="aero-reward-btn-icon">⬇</span>
          Collect Reward
        </button>
      </div>
      <div class="aero-sparkles" data-role="sparkles"></div>
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
      if (result.reason === 'pending-reward') {
        game.notify('Collect first', 'Claim your reward before starting a new render.', 'warn');
      } else {
        game.notify('Error', 'Already rendering.', 'warn');
      }
    }
    update();
  };

  ref('cancel-btn').onclick = () => {
    game.cancelRender();
    update();
  };

  /**
   * The time-skip placement. A render is the longest wait in the game — hours,
   * with nothing to do but come back — which is exactly the "convenience" trade
   * the rewarded-ads guide says converts best. It shortens a wait the player
   * would otherwise sit through; it never pays out a render they did not run,
   * so the payout curve is untouched.
   */
  ref('skip-btn').onclick = async () => {
    ref('skip-btn').disabled = true;
    await ads?.claim('renderBoost');
    update();
  };

  ref('collect-btn').onclick = () => {
    const result = game.claimRenderReward();
    if (result.ok) {
      // Brief sparkle burst on the overlay before it vanishes.
      body.classList.add('is-collecting');
      setTimeout(() => {
        body.classList.remove('is-collecting');
        update();
      }, 600);
    }
    update();
  };

  /* --------------------------------------------------------------- update */

  const update = throttle(() => {
    const s = game.state;
    const { isRendering, progress, upgrades, pendingReward } = s.aerostudio;

    // Determine UI phase
    const hasReward = !!pendingReward;

    for (const [id, button] of trackRows) {
      const level = upgrades[id];
      const cost = getUpgradeCost(id, level);

      const levelStr = `Lvl ${level}`;
      if (ref(`level-${id}`).textContent !== levelStr) ref(`level-${id}`).textContent = levelStr;
      
      const costStr = `${formatNumber(cost)} Buzz`;
      if (ref(`cost-${id}`).textContent !== costStr) ref(`cost-${id}`).textContent = costStr;
      
      button.disabled = s.buzz < cost;
    }

    ref('start-btn').disabled = isRendering || hasReward;
    ref('cancel-btn').disabled = !isRendering;

    // Only while there is something to skip: game.adOffer() refuses this
    // placement outright when no render is running.
    const skip = ads?.available ? game.adOffer('renderBoost') : { ok: false };
    const skipCooling = skip.reason === 'cooling-down';
    ref('skip-btn').hidden = !(skip.ok || (skipCooling && isRendering));
    ref('skip-btn').disabled = !skip.ok;
    ref('skip-btn').textContent = skipCooling
      ? `⏳ Skip in ${formatDuration(Math.ceil(skip.seconds))}`
      : `▶ Skip ahead ${Math.round(ADS.rewarded.renderBoost.fraction * 100)}%`;
    ref('skip-btn').title = 'Watch a short video from a sponsor to advance the render.';

    // Status text
    let statusStr, detailStr;
    if (hasReward) {
      statusStr = 'Complete!';
      detailStr = `"${pendingReward.projectName}" is ready to collect.`;
    } else if (isRendering) {
      statusStr = 'Rendering...';
      detailStr = `Working on ${s.aerostudio.currentProject}. Prod debuffed 20%.`;
    } else {
      statusStr = 'Ready';
      detailStr = 'Select upgrades or start rendering.';
    }
    if (ref('status').textContent !== statusStr) ref('status').textContent = statusStr;
    if (ref('detail').textContent !== detailStr) ref('detail').textContent = detailStr;

    // Render text in preview
    let renderTextStr;
    if (hasReward) {
      renderTextStr = 'RENDER COMPLETE';
    } else if (isRendering) {
      renderTextStr = 'RENDERING...';
    } else {
      renderTextStr = 'NO VIDEO';
    }
    if (ref('render-text').textContent !== renderTextStr) ref('render-text').textContent = renderTextStr;

    // Preview animation class
    const shouldBeActive = isRendering;
    if (ref('preview').classList.contains('is-active') !== shouldBeActive) {
      ref('preview').classList.toggle('is-active', shouldBeActive);
    }
    body.classList.toggle('is-rendering', isRendering);

    // Reward overlay
    const overlayVisible = hasReward && !body.classList.contains('is-collecting');
    ref('reward-overlay').classList.toggle('is-visible', overlayVisible);
    body.classList.toggle('is-reward-ready', hasReward);

    if (hasReward) {
      ref('reward-project').textContent = `"${pendingReward.projectName}"`;
      ref('reward-amount').textContent = `+${formatNumber(pendingReward.payout)} Buzz`;
    }

    // Preview reward-complete class for green glow
    ref('preview').classList.toggle('is-complete', hasReward);

    if (isRendering) {
      // 2-hour movie at 24fps
      const totalFrames = 2 * 60 * 60 * 24; 
      const currentFrame = Math.floor(progress * totalFrames);
      const h = Math.floor(currentFrame / (60 * 60 * 24)).toString().padStart(2, '0');
      const m = Math.floor((currentFrame / (60 * 24)) % 60).toString().padStart(2, '0');
      const s = Math.floor((currentFrame / 24) % 60).toString().padStart(2, '0');
      const f = (currentFrame % 24).toString().padStart(2, '0');
      ref('timecode').textContent = `${h}:${m}:${s}:${f}`;
    } else if (!hasReward) {
      ref('timecode').textContent = '00:00:00:00';
    }

    // ETA mirrors updateRender(): progress advances by dt × the upgrade
    // multiplier, over baseRenderRequired. Read the multiplier from core rather
    // than re-deriving it here, so the two cannot drift apart.
    let etaText = '';
    if (isRendering) {
      const secondsLeft = ((1 - progress) * AEROSTUDIO.baseRenderRequired) / getSpeedMultiplier(s);
      etaText = `ETA: ${formatDuration(secondsLeft)}`;
    } else if (hasReward) {
      etaText = '🎉 Ready to collect!';
    }

    if (ref('eta').textContent !== etaText) ref('eta').textContent = etaText;

    // Tone stays aqua from the stylesheet, so warn/critical never trip.
    const barProgress = hasReward ? 1 : progress;
    setBar(ref('render-bar'), barProgress, { warn: 2, critical: 2 });
  }, 200);

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);
  return () => {
    unsubscribe();
    clear(tracksRoot);
    body.classList.remove('app-aerostudio', 'is-rendering', 'is-reward-ready', 'is-collecting');
  };
}
