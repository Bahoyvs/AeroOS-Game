import { ADS, AEROSTUDIO } from '../data/balance.js';
import { getSpeedMultiplier, getUpgradeCost } from '../core/aerostudio.js';
import { formatDuration, formatNumber } from '../core/format.js';
import { clear, el, setBar, throttle } from './../ui/dom.js';
import { createBuildingView } from './../ui/buildingView.js';
import { groupBox, menuBar, spinner, statusBar, tabStrip } from './../ui/win32.js';

/**
 * Aero Studio — the render suite.
 *
 * Modelled on an early-2000s NLE/DAW (Movie Maker, early Premiere, a tracker
 * with a plugin rack), which is what decides where the economy lives:
 *
 * - **Units are render blades**, allocated on a `Render Farm` tab from a rack
 *   diagram and a Win32 up-down spinner. There is no "Buy 10" anywhere — you
 *   type a blade count and press *Allocate*, which is both period-correct and
 *   strictly better than fixed steps.
 * - **Upgrades are plugins**, licensed in an `Effects Rack`. This also fixes a
 *   real duplication: the app had its own levelled upgrades (Sidechain
 *   Compression Lvl 152) *and* the v2 tiered ones, rendered as two unrelated
 *   lists. They are one rack now — levelled plugins carry a level and an
 *   *Upgrade* button, licensed ones carry an authorisation state.
 * - **The production breakdown is a throughput readout**, which is honestly
 *   what a render farm's output figure is.
 *
 * UI states of the transport, unchanged:
 *  1. Idle          — "Ready" / "NO VIDEO" / Start active
 *  2. Rendering     — "RENDERING..." / progress bar / Cancel active
 *  3. Reward Ready  — "RENDER COMPLETE" / Collect button / glow
 */

/** The levelled plugins that predate the v2 upgrade layer. */
const RACK_PLUGINS = [
  {
    id: 'sidechainCompression',
    label: 'Sidechain Compression',
    vendor: 'Aero Labs',
    category: 'Dynamics',
    blurb: 'Pumps the bass. Render speed +25% per level.',
  },
  {
    id: 'arpeggiator',
    label: '16th-Note Arpeggiator',
    vendor: 'Nullsoft',
    category: 'Generator',
    blurb: 'Fast sequence generation. Render speed +50% per level.',
  },
  {
    id: 'environmentalFx',
    label: 'Environmental FX',
    vendor: 'Aero Labs',
    category: 'Reverb',
    blurb: 'Massive atmospheric reverb. Render speed +100% per level.',
  },
];

export function mount(body, { game, ads = null }) {
  body.classList.add('app-aerostudio');
  body.innerHTML = `
    <div data-role="menubar"></div>

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
        <div class="aero-reward-title">Render Complete</div>
        <div class="aero-reward-project" data-role="reward-project"></div>
        <div class="aero-reward-amount" data-role="reward-amount"></div>
        <button type="button" class="aero-reward-btn" data-role="collect-btn">Collect Reward</button>
      </div>
      <div class="aero-sparkles" data-role="sparkles"></div>
    </div>

    <div data-role="tabs" class="aero-tabhost"></div>
    <div data-role="statusbar"></div>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const view = createBuildingView(game, 'aerostudio');

  /* --------------------------------------------------------------- tabs */

  const tabs = tabStrip([
    { id: 'timeline', label: 'Timeline' },
    { id: 'rack', label: 'Effects Rack' },
    { id: 'farm', label: 'Render Farm' },
  ]);
  ref('tabs').appendChild(tabs.el);

  /* ------------------------------------------------------- tab: timeline */

  tabs.panels.timeline.innerHTML = `
    <div class="aero-render-panel">
      <div class="meter__track aero-progress-track">
        <div class="meter__fill aero-progress-fill" data-role="render-bar"></div>
      </div>
      <div class="aero-eta" data-role="eta"></div>
    </div>
    <div class="aero-strip" data-role="strip" aria-label="Storyboard"></div>
  `;

  // A storyboard strip: eight frames that light up as the render advances.
  const strip = tabs.panels.timeline.querySelector('[data-role="strip"]');
  const STRIP_FRAMES = 8;
  for (let i = 0; i < STRIP_FRAMES; i += 1) {
    strip.appendChild(el('div', { class: 'aero-strip__frame' }, [
      el('span', { class: 'aero-strip__thumb' }),
      el('small', { text: `${String(i + 1).padStart(2, '0')}` }),
    ]));
  }

  /* ----------------------------------------------------- tab: effects rack */

  const rackRoot = el('div', { class: 'aero-rack' });
  tabs.panels.rack.append(
    el('p', { class: 'instruction', text: 'Plugins run in order, top to bottom. Licensed plugins process every frame.' }),
    rackRoot,
  );

  let rackKey = null;

  /**
   * One rack slot. The power LED is the state at a glance — lit means the
   * plugin is authorised and running, dark means it is not — which is exactly
   * how a hardware rack reads and needs no words at all.
   */
  function pluginSlot({ name, vendor, category, blurb, level, lit, action, requirement }) {
    return el('div', { class: `aero-slot${lit ? ' is-live' : ''}${requirement ? ' is-locked' : ''}` }, [
      el('span', { class: 'aero-slot__led', 'aria-hidden': 'true' }),
      el('div', { class: 'aero-slot__text' }, [
        el('div', { class: 'aero-slot__head' }, [
          el('strong', { text: name }),
          level != null ? el('span', { class: 'aero-slot__level', text: level }) : null,
        ]),
        el('small', { text: `${vendor} · ${category}` }),
        el('small', { class: 'aero-slot__blurb', text: blurb }),
        requirement ? el('em', { class: 'w32-req', text: requirement }) : null,
      ]),
      action,
    ]);
  }

  function renderRack() {
    const s = game.state;
    const snapshot = view.read();
    if (!snapshot) return;

    const key = [
      ...RACK_PLUGINS.map((p) => `${p.id}:${s.aerostudio.upgrades[p.id]}:${s.buzz >= getUpgradeCost(p.id, s.aerostudio.upgrades[p.id])}`),
      ...snapshot.upgrades.map((u) => `${u.id}:${u.state}`),
    ].join('|');
    if (key === rackKey) return;
    rackKey = key;

    clear(rackRoot);

    // The levelled plugins: always authorised, upgraded rather than bought.
    for (const plugin of RACK_PLUGINS) {
      const level = s.aerostudio.upgrades[plugin.id];
      const cost = getUpgradeCost(plugin.id, level);
      rackRoot.appendChild(
        pluginSlot({
          name: plugin.label,
          vendor: plugin.vendor,
          category: plugin.category,
          blurb: plugin.blurb,
          level: `v${level}.0`,
          lit: true,
          action: el('button', {
            type: 'button',
            class: 'aero-slot__act',
            disabled: s.buzz < cost ? '' : null,
            text: `Upgrade — ${formatNumber(cost)}`,
            onclick: () => {
              const result = game.buyAeroUpgrade(plugin.id);
              if (!result.ok) {
                game.notify('Cannot upgrade', `Needs ${formatNumber(result.cost)} Buzz.`, 'warn');
              }
              rackKey = null;
              renderRack();
              update();
            },
          }),
        }),
      );
    }

    rackRoot.appendChild(el('div', { class: 'aero-rack__divider', text: 'Licensed inserts' }));

    /**
     * The v2 building upgrades, as licensed inserts. "Authorise" rather than
     * "Buy": a plugin in 2004 came with a serial you entered, and that is a
     * verb this fiction already owns.
     */
    for (const upgrade of snapshot.upgrades) {
      const owned = upgrade.state === 'owned';
      rackRoot.appendChild(
        pluginSlot({
          name: upgrade.name,
          vendor: 'Aero Studio',
          category: upgrade.kind === 'synergy' ? 'Send' : upgrade.kind === 'cross' ? 'Sidechain' : 'Insert',
          blurb: upgrade.blurb,
          level: owned ? 'Authorised' : null,
          lit: owned,
          requirement: upgrade.requirement,
          action: owned
            ? el('span', { class: 'aero-slot__ok', text: 'Licensed' })
            : el('button', {
              type: 'button',
              class: 'aero-slot__act',
              disabled: upgrade.state === 'buyable' ? null : '',
              text: `Authorise — ${formatNumber(upgrade.cost)}`,
              onclick: () => {
                view.buyUpgrade(upgrade.id);
                rackKey = null;
                renderRack();
                update();
              },
            }),
        }),
      );
    }
  }

  /* ------------------------------------------------------ tab: render farm */

  const bladeGrid = el('div', { class: 'aero-blades', 'aria-hidden': 'true' });
  const throughputList = el('ul', { class: 'w32-list aero-throughput' });

  const allocateCount = spinner({
    value: 1,
    min: 1,
    max: view.building.maxPerRun,
    label: 'Blades to allocate',
    onChange: () => refreshAllocateCost(),
  });

  const allocateCost = el('b', { class: 'aero-alloc__cost', text: '—' });
  const allocateButton = el('button', {
    type: 'button',
    class: 'aero-alloc__go',
    text: 'Allocate',
    onclick: () => {
      const result = view.buyAmount(allocateCount.value);
      if (!result.ok) {
        game.notify(
          result.reason === 'maxed' ? 'Chassis full' : 'Insufficient budget',
          result.reason === 'maxed'
            ? `This chassis holds ${view.building.maxPerRun} blades.`
            : 'Not enough Buzz for that many blades.',
          'warn',
        );
      }
      update();
    },
  });

  const fillButton = el('button', {
    type: 'button',
    text: 'Fill chassis',
    onclick: () => {
      const { count } = view.affordable();
      if (count === 0) {
        game.notify('Insufficient budget', 'Not enough Buzz for another blade.', 'warn');
        return;
      }
      view.buyAmount(count);
      update();
    },
  });

  function refreshAllocateCost() {
    allocateCost.textContent = `${formatNumber(view.costOf(allocateCount.value))} Buzz`;
  }

  tabs.panels.farm.append(
    groupBox('Hardware configuration', [
      el('p', { class: 'aero-farm__stat' }, [
        el('span', { text: 'Render blades installed' }),
        el('b', { dataset: { role: 'blade-count' }, text: '0' }),
      ]),
      el('p', { class: 'aero-farm__stat' }, [
        el('span', { text: 'Farm throughput' }),
        el('b', { dataset: { role: 'blade-rate' }, text: '0' }),
      ]),
      bladeGrid,
      el('p', { class: 'aero-farm__lock', dataset: { role: 'farm-lock' }, hidden: '' }),
    ]),
    groupBox('Allocate capacity', [
      el('div', { class: 'aero-alloc' }, [
        el('label', { class: 'aero-alloc__label', text: 'Blades:' }),
        allocateCount.el,
        allocateButton,
        fillButton,
      ]),
      el('p', { class: 'aero-alloc__line' }, [el('span', { text: 'Estimated cost' }), allocateCost]),
    ]),
    groupBox('Throughput', throughputList),
  );

  /** The chassis. Each cell is a blade bay; filled bays carry a lit edge. */
  const BAYS = view.building.maxPerRun;
  for (let i = 0; i < BAYS; i += 1) {
    bladeGrid.appendChild(el('i', { class: 'aero-blade' }));
  }
  const bladeCells = [...bladeGrid.children];
  let drawnBlades = -1;

  let throughputKey = null;

  function renderFarm(snapshot) {
    if (!snapshot) return;

    ref('blade-count').textContent = `${snapshot.units} of ${BAYS}`;
    ref('blade-rate').textContent = `${formatNumber(snapshot.production)} Buzz/sec`;

    // Only touch the bays that actually changed — 150 class writes per frame is
    // the kind of thing that shows up on a phone.
    if (snapshot.units !== drawnBlades) {
      const from = Math.min(drawnBlades < 0 ? 0 : drawnBlades, snapshot.units);
      const to = Math.max(drawnBlades < 0 ? BAYS : drawnBlades, snapshot.units);
      for (let i = from; i < to && i < BAYS; i += 1) {
        bladeCells[i].classList.toggle('is-live', i < snapshot.units);
      }
      if (drawnBlades < 0) {
        for (let i = 0; i < BAYS; i += 1) bladeCells[i].classList.toggle('is-live', i < snapshot.units);
      }
      drawnBlades = snapshot.units;
    }

    const lock = ref('farm-lock');
    lock.hidden = snapshot.unlocked;
    if (!snapshot.unlocked) lock.textContent = snapshot.lockText ?? '';

    allocateCount.setMax(Math.max(1, BAYS - snapshot.units));
    allocateButton.disabled = snapshot.maxed || !snapshot.unlocked;
    fillButton.disabled = snapshot.maxed || !snapshot.unlocked;
    refreshAllocateCost();

    const key = snapshot.lines.map((l) => `${l.key}=${l.value}`).join('|');
    if (key !== throughputKey) {
      throughputKey = key;
      clear(throughputList);
      for (const line of snapshot.lines) {
        throughputList.appendChild(
          el('li', { class: `aero-throughput__row${line.key === 'total' ? ' is-total' : ''}` }, [
            el('span', { text: line.label }),
            el('b', { text: line.value }),
          ]),
        );
      }
    }
  }

  /* ----------------------------------------------------------- menu bar */

  const menus = menuBar([
    {
      label: 'File',
      items: [
        { label: 'New project', disabled: true },
        'separator',
        { label: 'Close', onSelect: () => game.closeApp('aerostudio') },
      ],
    },
    {
      label: 'Project',
      items: [
        { label: 'Timeline', onSelect: () => tabs.select('timeline') },
        { label: 'Effects rack', onSelect: () => tabs.select('rack') },
      ],
    },
    {
      label: 'Render',
      items: [
        { label: 'Start render', onSelect: () => ref('start-btn').click() },
        { label: 'Cancel render', onSelect: () => ref('cancel-btn').click() },
        'separator',
        { label: 'Render farm…', onSelect: () => tabs.select('farm') },
      ],
    },
    {
      label: 'Help',
      items: [{
        label: 'About Aero Studio',
        onSelect: () => game.notify(
          'Aero Studio 2.1',
          'Blades render whether or not this window is open.',
          'info',
        ),
      }],
    },
  ]);
  ref('menubar').appendChild(menus);

  /* --------------------------------------------------------- status bar */

  const status = statusBar([
    { id: 'blades', text: '' },
    { id: 'speed', text: '', grow: true },
    { id: 'state', text: 'Ready' },
  ]);
  ref('statusbar').appendChild(status.el);

  /* ------------------------------------------------------------ transport */

  ref('start-btn').onclick = () => {
    const result = game.startRender('Argent Metal OST');
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
    const { isRendering, progress, pendingReward } = s.aerostudio;
    const hasReward = !!pendingReward;

    ref('start-btn').disabled = isRendering || hasReward;
    ref('cancel-btn').disabled = !isRendering;

    // Only while there is something to skip: game.adOffer() refuses this
    // placement outright when no render is running.
    const skip = ads?.available ? game.adOffer('renderBoost') : { ok: false };
    const skipCooling = skip.reason === 'cooling-down';
    ref('skip-btn').hidden = !(skip.ok || (skipCooling && isRendering));
    ref('skip-btn').disabled = !skip.ok;
    ref('skip-btn').textContent = skipCooling
      ? `Skip in ${formatDuration(Math.ceil(skip.seconds))}`
      : `Skip ahead ${Math.round(ADS.rewarded.renderBoost.fraction * 100)}%`;
    ref('skip-btn').title = 'Watch a short video from a sponsor to advance the render.';

    let statusStr;
    let detailStr;
    if (hasReward) {
      statusStr = 'Complete';
      detailStr = `"${pendingReward.projectName}" is ready to collect.`;
    } else if (isRendering) {
      statusStr = 'Rendering…';
      detailStr = `Working on ${s.aerostudio.currentProject}. Production down 20%.`;
    } else {
      statusStr = 'Ready';
      detailStr = 'Allocate blades or start a render.';
    }
    if (ref('status').textContent !== statusStr) ref('status').textContent = statusStr;
    if (ref('detail').textContent !== detailStr) ref('detail').textContent = detailStr;

    const renderTextStr = hasReward ? 'RENDER COMPLETE' : isRendering ? 'RENDERING...' : 'NO VIDEO';
    if (ref('render-text').textContent !== renderTextStr) ref('render-text').textContent = renderTextStr;

    ref('preview').classList.toggle('is-active', isRendering);
    ref('preview').classList.toggle('is-complete', hasReward);
    body.classList.toggle('is-rendering', isRendering);

    const overlayVisible = hasReward && !body.classList.contains('is-collecting');
    ref('reward-overlay').classList.toggle('is-visible', overlayVisible);
    body.classList.toggle('is-reward-ready', hasReward);

    if (hasReward) {
      ref('reward-project').textContent = `"${pendingReward.projectName}"`;
      ref('reward-amount').textContent = `+${formatNumber(pendingReward.payout)} Buzz`;
    }

    if (isRendering) {
      // 2-hour movie at 24fps
      const totalFrames = 2 * 60 * 60 * 24;
      const currentFrame = Math.floor(progress * totalFrames);
      const h = String(Math.floor(currentFrame / (60 * 60 * 24))).padStart(2, '0');
      const m = String(Math.floor((currentFrame / (60 * 24)) % 60)).padStart(2, '0');
      const sec = String(Math.floor((currentFrame / 24) % 60)).padStart(2, '0');
      const f = String(currentFrame % 24).padStart(2, '0');
      ref('timecode').textContent = `${h}:${m}:${sec}:${f}`;
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
      etaText = 'Ready to collect.';
    }
    if (ref('eta').textContent !== etaText) ref('eta').textContent = etaText;

    const barProgress = hasReward ? 1 : progress;
    setBar(ref('render-bar'), barProgress, { warn: 2, critical: 2 });

    // Storyboard frames light up behind the playhead.
    const lit = Math.round(barProgress * STRIP_FRAMES);
    strip.querySelectorAll('.aero-strip__frame').forEach((frame, i) => {
      frame.classList.toggle('is-rendered', i < lit);
    });

    const snapshot = view.read();
    renderFarm(snapshot);
    renderRack();

    if (snapshot) {
      status.set('blades', `${snapshot.units} blades`);
      status.set('speed', `${formatNumber(snapshot.production)} Buzz/sec · ×${getSpeedMultiplier(s).toFixed(2)} render`);
    }
    status.set('state', statusStr);
  }, 200);

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);
  return () => {
    unsubscribe();
    menus.destroy();
    clear(rackRoot);
    body.classList.remove('app-aerostudio', 'is-rendering', 'is-reward-ready', 'is-collecting');
  };
}

/** See the note in apps/aerochat.js — this app draws its own economy UI. */
export const ownsBuildingUI = true;
