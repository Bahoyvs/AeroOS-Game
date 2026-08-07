import { formatBytesMB, formatDuration, formatNumber } from '../core/format.js';
import { DEFRAG } from '../data/balance.js';
import { HARDWARE } from '../data/hardware.js';
import { MOTION_LABELS, MOTION_MODES, systemPrefersReducedMotion } from './../ui/motion.js';
import { clear, el, setBar, throttle } from './../ui/dom.js';

/**
 * "My Computer" — the hardware shop and the Format C: panel (AO-16/AO-18).
 *
 * Every row states what the next purchase gives you as a flat percentage
 * (AO-19) rather than making the player diff two multipliers, and the prestige
 * panel shows progress toward the next Dollar so the sqrt payout curve stops
 * being invisible.
 */
export function mount(body, { game, ads = null }) {
  body.classList.add('app-system');
  body.innerHTML = `
    <div class="sys__summary glass">
      <div><span>Buzz</span><strong data-role="buzz">0</strong></div>
      <div><span>Per second</span><strong data-role="rate">0</strong></div>
      <div><span>Dollars</span><strong data-role="dollars">$0.00</strong></div>
      <div><span>Uptime</span><strong data-role="uptime">0s</strong></div>
    </div>

    <div class="sys__specs" data-role="specs"></div>

    <h4 class="sys__heading">Hardware shop</h4>
    <div class="sys__hardware" data-role="hardware"></div>

    <!--
      The banner slot (GDD 8). A shop screen is where the banner guide says to
      put one — a surface the player reads and plans on rather than clicks
      through — and it is deliberately below the shop rows and above nothing,
      so there is no button within a thumb's width of it.
    -->
    <div class="ad-banner" data-role="banner" hidden>
      <small class="ad-banner__label">Advertisement</small>
      <div class="ad-banner__slot" data-role="banner-slot"></div>
    </div>

    <h4 class="sys__heading">Utilities</h4>
    <div class="sys__utility glass" data-role="defrag"></div>

    <h4 class="sys__heading">Display properties</h4>
    <div class="sys__display glass">
      <div class="sys__display-top">
        <span>Window colour</span>
        <small data-role="tint-note"></small>
      </div>
      <div class="sys__swatches" role="group" aria-label="Window colour" data-role="tints"></div>

      <div class="sys__display-top">
        <span>Wallpaper</span>
        <small data-role="wallpaper-note"></small>
      </div>
      <div class="sys__swatches" role="group" aria-label="Wallpaper" data-role="wallpapers"></div>

      <div class="sys__display-top">
        <span>Desktop animations</span>
        <small data-role="motion-note"></small>
      </div>
      <div class="sys__motion" role="group" aria-label="Desktop animations" data-role="motion"></div>
    </div>

    <h4 class="sys__heading">Format C:</h4>
    <div class="sys__prestige glass">
      <div class="sys__prestige-top">
        <span data-role="pending">$0.00 waiting</span>
        <span data-role="next-dollar">—</span>
      </div>
      <div class="meter__track"><div class="meter__fill" data-role="dollar-bar"></div></div>
      <p class="sys__prestige-copy" data-role="prestige-copy"></p>
      <button type="button" class="sys__format" data-role="format">Format C:</button>
    </div>

    <button type="button" class="sys__wipe" data-role="wipe">Erase save</button>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const hardwareRoot = ref('hardware');
  const specsRoot = ref('specs');
  const rows = new Map();

  /* ------------------------------------------------------------ shop rows */

  for (const [track, meta] of Object.entries(HARDWARE)) {
    const row = el('div', { class: 'hw-row' }, [
      el('div', { class: 'hw-row__info' }, [
        el('div', { class: 'hw-row__top' }, [
          el('strong', { class: 'hw-row__label', text: meta.label }),
          el('span', { class: 'hw-row__pips', dataset: { role: `${track}-pips` } }),
        ]),
        el('span', { class: 'hw-row__current', dataset: { role: `${track}-current` } }),
        el('span', { class: 'hw-row__gain', dataset: { role: `${track}-gain` } }),
        el('small', { class: 'hw-row__blurb', text: meta.affects }),
      ]),
      el('button', {
        type: 'button',
        class: 'hw-row__buy',
        dataset: { role: `${track}-buy` },
        onclick: () => {
          const result = game.buyHardware(track);
          if (result.ok) game.notify(`${meta.label} upgraded`, result.tier.name, 'success');
          else if (result.reason === 'too-expensive') {
            game.notify('Not enough Dollars', 'Format C: to earn more.', 'warn');
          }
          // Dollars spent is an unlock counter, so a purchase can hand the
          // player a cosmetic two panels down the same window.
          renderCosmetics();
          renderDefrag();
          update();
        },
      }),
    ]);
    hardwareRoot.appendChild(row);
    rows.set(track, {
      pips: row.querySelector(`[data-role="${track}-pips"]`),
      current: row.querySelector(`[data-role="${track}-current"]`),
      gain: row.querySelector(`[data-role="${track}-gain"]`),
      buy: row.querySelector(`[data-role="${track}-buy"]`),
    });
  }

  /** Owned tiers as filled pips — position on the track at a glance. */
  function renderPips(node, index, count) {
    clear(node);
    for (let i = 1; i < count; i += 1) {
      node.appendChild(el('span', { class: `pip${i <= index ? ' is-owned' : ''}` }));
    }
  }

  /** What this machine currently is, in the units the player cares about. */
  function currentText(track, effects) {
    switch (track) {
      case 'cpu':
        return `+${Math.round((effects.production - 1) * 100)}% production · +${Math.round((effects.click - 1) * 100)}% click`;
      case 'ram':
        return formatBytesMB(effects.ramMB);
      case 'gpu':
        return `−${Math.round((1 - effects.cooldown) * 100)}% cooldowns`;
      case 'hdd':
        return `${effects.storageGB} GB · ${effects.offlineHours}h offline`;
      case 'mobo':
        return `+${Math.round((effects.payout - 1) * 100)}% on every Format C:`;
      default:
        return '';
    }
  }

  /* ------------------------------------------------------------ utilities */

  /**
   * Auto-Defrag. One card with three states — for sale, installed and idle,
   * installed and running — because the middle one is the one that has to
   * explain itself: a utility that does nothing visible until the machine is
   * already choking reads as a broken purchase otherwise.
   */
  const defragRoot = ref('defrag');

  function renderDefrag() {
    const s = game.state;
    const { econ } = game;
    clear(defragRoot);

    const running = econ.isDefragging(s);
    defragRoot.classList.toggle('is-running', running);

    const info = el('div', { class: 'sys__utility-info' }, [
      el('strong', { class: 'sys__utility-name', text: 'Auto-Defrag' }),
      el('span', {
        class: 'sys__utility-state',
        text: !s.defrag.owned
          ? 'Not installed'
          : running
            ? `Defragmenting — ${Math.round(econ.defragProgress(s) * 100)}%`
            : `Idle · arms at ${Math.round(DEFRAG.startAt * 100)}% bloat`,
      }),
      el('small', {
        class: 'sys__utility-blurb',
        text: s.defrag.owned
          ? `Sweeps bloat back to zero at ${Math.round(DEFRAG.productionTax * 100)}% production while it runs, and holds bloat under ${Math.round(DEFRAG.offlineCap * 100)}% while the machine is off.`
          : `A scheduled sweep that catches the machine before it seizes: it clears bloat from ${Math.round(DEFRAG.startAt * 100)}% back to zero, and caps what an overnight absence can build up at ${Math.round(DEFRAG.offlineCap * 100)}%.`,
      }),
    ]);

    const action = s.defrag.owned
      ? el('span', { class: 'sys__utility-owned', text: 'Installed' })
      : el('button', {
          type: 'button',
          class: 'hw-row__buy',
          text: `$${DEFRAG.cost.toFixed(2)}`,
          onclick: () => {
            const result = game.buyDefrag();
            if (result.ok) {
              game.notify('Auto-Defrag installed', 'It arms itself when the disk gets bad.', 'success');
            } else if (result.reason === 'too-expensive') {
              game.notify('Not enough Dollars', 'Format C: to earn more.', 'warn');
            }
            renderDefrag();
            update();
          },
        })
      ;

    if (!s.defrag.owned) {
      action.classList.toggle('is-affordable', s.dollars >= DEFRAG.cost);
      action.disabled = s.dollars < DEFRAG.cost;
    }

    defragRoot.append(info, action);

    if (running) {
      const track = el('div', { class: 'meter__track sys__utility-bar' }, [
        el('div', { class: 'meter__fill', dataset: { role: 'defrag-bar' } }),
      ]);
      defragRoot.appendChild(track);
      setBar(track.firstChild, econ.defragProgress(s), { warn: 2, critical: 2 });
    }
  }

  /* --------------------------------------------------------- personalisation */

  /**
   * The tint and wallpaper pickers. Locked entries are *shown*, not hidden:
   * a cosmetic nobody knows exists is not a goal, and the requirement under the
   * chip is the entire reason the panel is worth opening early. The rules
   * themselves live in `core/cosmetics.js` — this only draws the answer.
   */
  const pickers = [
    { kind: 'tint', root: ref('tints'), note: ref('tint-note') },
    { kind: 'wallpaper', root: ref('wallpapers'), note: ref('wallpaper-note') },
  ];

  function renderCosmetics() {
    const summary = game.cosmetics();

    for (const picker of pickers) {
      clear(picker.root);
      const rows = summary[picker.kind];

      for (const row of rows) {
        const chip = el(
          'button',
          {
            type: 'button',
            class: `swatch${row.selected ? ' is-selected' : ''}${row.unlocked ? '' : ' is-locked'}`,
            'aria-pressed': String(row.selected),
            disabled: row.unlocked ? null : 'disabled',
            title: row.unlocked ? row.blurb : `Unlocks at ${row.requirement}`,
            onclick: () => {
              game.setCosmetic(picker.kind, row.id);
              renderCosmetics();
            },
          },
          [
            el('span', { class: 'swatch__chip', 'aria-hidden': 'true' }),
            el('span', { class: 'swatch__label', text: row.label }),
            row.unlocked ? null : el('span', { class: 'swatch__lock', text: '🔒' }),
          ],
        );

        /**
         * Two kinds of chip, one element. A tint carries its own potted
         * gradient in the data; a wallpaper is a photograph, so the chip only
         * names itself and `styles/themes.css` supplies the thumbnail — the
         * file is then referenced in exactly one place in the whole codebase.
         */
        const swatch = chip.querySelector('.swatch__chip');
        if (row.swatch) swatch.style.background = row.swatch;
        else swatch.dataset.wallpaper = row.id;

        picker.root.appendChild(chip);
      }

      const selected = rows.find((row) => row.selected);
      const nextLocked = rows.find((row) => !row.unlocked);
      picker.note.textContent = nextLocked
        ? `${selected?.blurb ?? ''} Next: ${nextLocked.label} at ${nextLocked.requirement}.`
        : (selected?.blurb ?? '');
    }
  }

  /* ------------------------------------------------------------ animations */

  /**
   * The escape hatch for a machine whose OS has animations switched off
   * system-wide. Without this the game just looks broken — windows appear
   * instantly, meters jump, the render playhead never moves — and there is
   * nothing on screen to explain that Windows, not AeroOS, is the reason.
   */
  const motionRoot = ref('motion');
  const motionButtons = new Map();

  for (const mode of MOTION_MODES) {
    const button = el('button', {
      type: 'button',
      class: 'sys__motion-option',
      text: MOTION_LABELS[mode],
      onclick: () => {
        game.setSettings({ motion: mode });
        renderMotion();
      },
    });
    motionRoot.appendChild(button);
    motionButtons.set(mode, button);
  }

  function renderMotion() {
    const mode = game.state.settings.motion ?? 'auto';
    for (const [id, button] of motionButtons) {
      button.classList.toggle('is-selected', id === mode);
      button.setAttribute('aria-pressed', String(id === mode));
    }
    ref('motion-note').textContent =
      mode === 'auto'
        ? systemPrefersReducedMotion()
          ? 'Your system asks for reduced motion, so AeroOS is holding still.'
          : 'Following your system setting.'
        : mode === 'full'
          ? 'On, whatever your system prefers.'
          : 'Off — nothing on the desktop moves.';
  }

  renderMotion();
  renderCosmetics();
  renderDefrag();

  /* ---------------------------------------------------------------- update */

  /**
   * The defrag card rebuilds its own subtree, so it is refreshed on its own
   * slower beat: a pass takes 85 seconds and the percentage on it does not need
   * five updates a second to be legible.
   */
  const refreshDefrag = throttle(renderDefrag, 500);

  const update = throttle(() => {
    const s = game.state;
    const { econ } = game;

    ref('buzz').textContent = formatNumber(s.buzz);
    ref('rate').textContent = `${formatNumber(econ.buzzPerSecond(s))}/s`;
    ref('dollars').textContent = `$${s.dollars.toFixed(2)}`;
    ref('uptime').textContent = formatDuration(s.stats.playtimeSeconds);

    const summary = econ.hardwareSummary(s);
    const effects = econ.hardwareEffects(s);

    specsRoot.textContent = `${summary.map((row) => row.current.name).join(' · ')}`;

    for (const row of summary) {
      const node = rows.get(row.track);
      renderPips(node.pips, row.index, row.tierCount);
      node.current.textContent = `${row.current.name} — ${currentText(row.track, effects)}`;
      node.gain.textContent = row.maxed ? 'Fully upgraded' : row.gains.join(' · ');
      node.gain.classList.toggle('is-maxed', row.maxed);
      // Two decimals throughout: the Mainboard track is priced in cents, and a
      // "$2.5" next to a "$12" reads as a rendering bug rather than a price.
      node.buy.textContent = row.maxed ? 'Maxed out' : `$${row.next.cost.toFixed(2)}`;
      node.buy.classList.toggle('is-affordable', row.affordable);
      node.buy.disabled = row.maxed || !row.affordable;
    }

    refreshDefrag();

    // Format C: panel — AO-16's payout made legible.
    const progress = econ.dollarProgress(s);
    ref('pending').textContent =
      progress.pending > 0 ? `$${progress.pending.toFixed(2)} waiting` : 'Nothing banked yet';
    ref('pending').classList.toggle('is-ready', progress.pending > 0);
    ref('next-dollar').textContent = `$${progress.nextDollar} at ${formatNumber(
      progress.buzzNeeded,
    )} more Buzz`;
    setBar(ref('dollar-bar'), progress.ratio, { warn: 2, critical: 2 });

    // The Mainboard multiplier is stated here as well as in its shop row: this
    // is the panel where it is actually being spent, and "worth $X" with no
    // explanation of why X moved is the thing that makes an upgrade invisible.
    const payout = effects.payout > 1 ? ` Mainboard is paying ×${effects.payout.toFixed(2)}.` : '';
    ref('prestige-copy').textContent =
      progress.pending > 0
        ? `${formatNumber(s.lifetimeBuzz)} lifetime Buzz is worth $${progress.earned.toFixed(2)}; $${s.dollarsEarnedTotal.toFixed(2)} already banked.${payout}`
        : `Dollars come from lifetime Buzz, and lifetime Buzz never resets. Keep producing.${payout}`;
    ref('format').disabled = progress.pending <= 0;
    ref('format').classList.toggle('is-ready', progress.pending > 0);
  }, 200);

  /* --------------------------------------------------------------- actions */

  ref('format').addEventListener('click', () => {
    // The sequence itself lives in main.js, which owns the BSOD overlay.
    game.requestFormat();
  });

  ref('wipe').addEventListener('click', () => {
    if (!confirm('Erase your save and start from a clean desktop? This cannot be undone.')) return;
    game.hardReset();
    location.reload();
  });

  /**
   * The banner lives for exactly as long as the window does. Clearing it on
   * close is not politeness: a banner left behind in a torn-down window is an
   * impression nobody can see, and the portal will not refill a slot it still
   * believes is on screen.
   */
  const bannerFrame = ref('banner');
  const slot = ads?.banner(ref('banner-slot'));
  bannerFrame.hidden = !slot?.ok;

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);
  return () => {
    unsubscribe();
    slot?.clear();
    bannerFrame.hidden = true;
    clear(hardwareRoot);
    clear(defragRoot);
    body.classList.remove('app-system');
  };
}
