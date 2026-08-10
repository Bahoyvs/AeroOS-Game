import { SECURITY, SHIELD99 } from '../data/balance.js';
import { adCooldownLeft, getThreat, scanProgress } from '../core/shield99.js';
import { formatDuration, formatNumber } from '../core/format.js';
import { clear, el, setBar, throttle } from './../ui/dom.js';
import { createBuildingView } from './../ui/buildingView.js';
import {
  buyList, buyTile, categoryList, explainedValue, groupBox, helpButton, menuBar, statusBar,
} from './../ui/win32.js';

/**
 * Shield99 (AO-22) — the antivirus, and the game's lootbox.
 *
 * The window says which of three states the machine is in — protected, exposed
 * or infected — and below that sits the quarantine: the threats real-time
 * protection has caught while LemonWire was seeding, sealed and waiting to be
 * opened. Opening one is the game's rewarded-ad placement.
 *
 * Two rules the placement is built around, both from the portal's checklist:
 * the reward is granted on `adFinished` only, and there is always a non-ad way
 * to open the file (at a fraction of the payout) so an ad blocker never locks
 * anybody out of a mechanic.
 *
 * ## The 2004 antivirus shell
 *
 * Laid out like Norton AntiVirus 2004: a menu bar, a left-hand navigation
 * column, and one page in the right pane at a time. That decides where the
 * economy lives, and none of it is a shop:
 *
 * - **Units are licence seats**, bought on the `Subscription` page the way you
 *   renewed a boxed antivirus — seats, an expiry date, and a renew action.
 * - **Upgrades are protection features**, listed on `Status` with the On/Off
 *   indicators Norton put beside Auto-Protect and Email Scanning. An unowned
 *   feature reads "Off" with a Turn On action, not "buy".
 */

/**
 * What each protection feature *says* it does, in the product's voice.
 *
 * The view-model's fallback copy is written in economy terms ("doubles this
 * building's output") — correct, and something a 2004 antivirus would never
 * print. Presentation is the app's job, so the app supplies the words.
 */
const FEATURE_COPY = {
  'shield99.t1': 'Detects unknown threats by behaviour, not signature.',
  'shield99.t2': 'Downloads new virus definitions every morning.',
  'shield99.t3': 'Scans files as they are opened, before anything runs.',
  'shield99.t4': 'Finds threats that hide themselves from the operating system.',
  'shield99.t5': 'Covers every workstation on the licence.',
  'shield99.t6': 'Submits samples to the threat network and pulls fixes back.',
  'shield99.buddies': 'Contacts on your buddy list get a discounted seat.',
  'lemonwire+shield99': 'Shared folders are scanned in place instead of quarantined.',
};

/** Tier glyphs, drawn in CSS (charter §A.1 bans emoji). */
const TIER_CLASS = { Common: 'is-common', Rare: 'is-rare', Epic: 'is-epic' };

export function mount(body, { game, ads = null }) {
  // One question, asked once: can an ad actually play here? Off-portal and
  // behind an ad blocker the answer is no, and the window renders the manual
  // path as its only button rather than offering a video that cannot run.
  const canAd = Boolean(ads?.available);

  body.classList.add('app-shield');
  body.innerHTML = `
    <div data-role="menubar"></div>
    <div class="sh__nav" data-role="nav"></div>
    <div data-role="statusbar"></div>
  `;

  const view = createBuildingView(game, 'shield99');

  /* ------------------------------------------------ the Norton left nav */

  const nav = categoryList([
    { id: 'status', label: 'Status' },
    { id: 'scan', label: 'Scan for Viruses' },
    { id: 'quarantine', label: 'Quarantine' },
    { id: 'subscription', label: 'Subscription' },
  ]);
  body.querySelector('[data-role="nav"]').appendChild(nav.el);

  nav.pages.status.innerHTML = `
    <div class="sh__hero" data-role="hero">
      <span class="sh__badge" data-role="badge" aria-hidden="true"></span>
      <div>
        <strong class="sh__state" data-role="state">Protected</strong>
        <span class="sh__sub" data-role="sub">Real-time protection is on.</span>
      </div>
    </div>

    <div class="sh__radar" data-role="radar" aria-hidden="true">
      <span class="sh__radar-sweep"></span>
      <span class="sh__radar-ring"></span>
      <span class="sh__radar-ring is-inner"></span>
      <span class="sh__radar-count" data-role="radar-count">0</span>
    </div>

    <div data-role="features"></div>

    <dl class="sh__stats">
      <div><dt>Threats blocked</dt><dd data-role="blocked">0</dd></div>
      <div><dt>Files disinfected</dt><dd data-role="cleaned">0</dd></div>
      <div><dt>Free trial rescue</dt><dd data-role="trial">available</dd></div>
      <div><dt>Definitions</dt><dd>2005.11.14</dd></div>
    </dl>
  `;

  nav.pages.scan.innerHTML = `
    <p class="instruction instruction-primary">Scan this computer for viruses</p>
    <div class="sh__scan">
      <div class="meter__track"><div class="meter__fill" data-role="scan-bar"></div></div>
      <button type="button" class="sh__button" data-role="scan">Deep scan</button>
    </div>
    <p class="sh__note">
      Keep Shield99 running while LemonWire seeds and every threat is caught and sealed instead of
      infecting the machine. An infection never costs more than half your production, and never
      your progress.
    </p>
  `;

  nav.pages.quarantine.innerHTML = `
    <p class="instruction instruction-primary">
      Quarantined items <small data-role="quarantine-count"></small>
    </p>
    <ul class="sh__quarantine" data-role="quarantine"></ul>
  `;

  /* --------------------------------------------- Subscription (units) */

  /**
   * Licence seats, sold the way a boxed antivirus sold them — but drawn as
   * purchase tiles, because a player could not tell that "Add a licence seat"
   * was a transaction at all.
   */
  const seatTasks = [
    { id: 1, label: 'Add a licence seat', icon: 'shield', per: 1 },
    { id: 10, label: 'Add a 10-seat pack', icon: 'import', per: 10 },
    { id: 100, label: 'Upgrade to Small Business', icon: 'mail', per: 100 },
    { id: 'max', label: 'Upgrade to Enterprise Site Licence', icon: 'globe', per: null },
  ];

  const seatTiles = new Map();
  const seatHost = buyList(
    seatTasks.map((task) => {
      const tile = buyTile({
        icon: task.icon,
        name: task.label,
        effect: '',
        cost: '',
        onSelect: () => {
          const result = view.buy(task.id);
          if (!result.ok) {
            game.notify(
              result.reason === 'maxed' ? 'Site licence is full' : 'Not enough Buzz',
              result.reason === 'maxed'
                ? 'This licence covers as many seats as it ever will.'
                : 'Subscriptions are paid in Buzz.',
              'warn',
            );
          }
          update();
        },
      });
      seatTiles.set(task.id, tile);
      return tile.el;
    }),
  );

  nav.pages.subscription.append(
    groupBox('Subscription status', [
      el('p', { class: 'sh__sub-line' }, [
        el('span', { text: 'Licensed seats' }),
        el('b', { dataset: { role: 'seat-count' }, text: '0' }),
      ]),
      el('p', { class: 'sh__sub-line' }, [
        el('span', { text: 'Protection revenue' }),
        // The Coverage list moved into this value's tooltip.
        el('b', { dataset: { role: 'seat-rate-host' } }),
      ]),
      el('p', { class: 'sh__sub-line' }, [
        el('span', { text: 'Definitions expire' }),
        el('b', { text: '14 November 2005' }),
      ]),
      el('p', { class: 'sh__expiry', dataset: { role: 'seat-lock' }, hidden: '' }),
    ]),
    el('div', { class: 'sh__buy-head' }, [
      el('strong', { text: 'Extend your subscription' }),
      helpButton(() => ({
        title: 'Shield99 licences',
        body: 'Each licensed seat is a machine paying you a subscription. Seats earn whether or not this window is open.',
        gain: `Currently earning ${formatNumber(view.read()?.production ?? 0)} Buzz/sec`,
        note: 'Protection features are on the Status page.',
      })),
    ]),
    seatHost,
  );

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const quarantineRoot = ref('quarantine');

  const menus = menuBar([
    {
      label: 'File',
      items: [{ label: 'Close', onSelect: () => game.closeApp('shield99') }],
    },
    {
      label: 'Scan',
      items: [
        { label: 'Scan this computer', onSelect: () => ref('scan').click() },
        { label: 'View quarantine', onSelect: () => nav.select('quarantine') },
      ],
    },
    {
      label: 'Options',
      items: [
        { label: 'Protection features\u2026', onSelect: () => nav.select('status') },
        { label: 'Subscription\u2026', onSelect: () => nav.select('subscription') },
      ],
    },
    {
      label: 'Help',
      items: [{
        label: 'About Shield99',
        onSelect: () => game.notify(
          'Shield99 2004',
          'Definitions 2005.11.14. Real-time protection runs whether or not this window is open.',
          'info',
        ),
      }],
    },
  ]);
  body.querySelector('[data-role="menubar"]').appendChild(menus);

  const status = statusBar([
    { id: 'seats', text: '' },
    { id: 'rate', text: '', grow: true },
    { id: 'state', text: 'Protected' },
  ]);
  body.querySelector('[data-role="statusbar"]').appendChild(status.el);

  /* ------------------------------------------- protection features */

  /**
   * Norton listed Auto-Protect, Email Scanning and the rest as rows with an
   * On/Off indicator and an action beside them. The building's upgrades are
   * exactly that shape, so they are drawn that way — an unowned feature reads
   * "Off" with a *Turn On* action carrying its price, never "buy".
   */
  const featureTiles = new Map();
  let featureKey = null;

  function renderFeatures(snapshot) {
    const key = snapshot.upgrades.map((u) => u.id).join('|');
    if (key !== featureKey) {
      featureKey = key;
      for (const tile of featureTiles.values()) tile.destroy();
      featureTiles.clear();

      const host = ref('features');
      clear(host);
      host.appendChild(
        groupBox('Protection features', [
          el('p', {
            class: 'sh__feature-note',
            text: 'Each feature multiplies what your licences earn.',
          }),
          buyList(
            snapshot.upgrades.map((u) => {
              const tile = buyTile({
                icon: 'shield',
                name: u.name,
                effect: '',
                cost: '',
                onSelect: () => { view.buyUpgrade(u.id); update(); },
              });
              featureTiles.set(u.id, tile);
              return tile.el;
            }),
          ),
        ]),
      );
    }

    // Values refresh each pass; the tiles themselves are not rebuilt.
    for (const u of snapshot.upgrades) {
      const owned = u.state === 'owned';
      const now = snapshot.production;
      featureTiles.get(u.id)?.update({
        effect: owned
          ? 'Running'
          : u.state === 'gated'
            ? (u.requirement ?? 'Not yet available')
            : `${formatNumber(now)} \u2192 ${formatNumber(now * 2)}/sec`,
        cost: formatNumber(u.cost),
        progress: u.cost > 0 ? game.state.buzz / u.cost : 0,
        state: owned
          ? 'owned'
          : u.state === 'gated'
            ? 'locked'
            : u.state === 'buyable'
              ? 'buyable'
              : 'unaffordable',
        tooltip: {
          title: u.name,
          body: FEATURE_COPY[u.id] ?? u.blurb,
          gain: owned
            ? 'Already running.'
            : `${formatNumber(now)}/sec \u2192 ${formatNumber(now * 2)}/sec`,
          rows: [
            ['Cost', `${formatNumber(u.cost)} Buzz`],
            ['You have', `${formatNumber(game.state.buzz)} Buzz`],
            ...(u.requirement ? [['Requires', u.requirement]] : []),
          ],
        },
      });
    }
  }
  /** The seats page. The breakdown lives in the revenue figure's tooltip. */
  let rateNode = null;

  function renderSubscription(snapshot) {
    ref('seat-count').textContent = `${snapshot.units} of ${snapshot.maxPerRun}`;

    const host = ref('seat-rate-host');
    if (!rateNode) {
      rateNode = explainedValue('', () => ({
        title: 'Protection revenue',
        body: 'What your licensed seats earn, and everything currently shaping it.',
        gain: `${formatNumber(view.read()?.production ?? 0)} Buzz/sec`,
        rows: view.read()?.lines.map((l) => [l.label, l.value]) ?? [],
      }));
      clear(host);
      host.appendChild(rateNode);
    }
    rateNode.textContent = `${formatNumber(snapshot.production)} Buzz/sec`;

    const lock = ref('seat-lock');
    lock.hidden = snapshot.unlocked;
    if (!snapshot.unlocked) lock.textContent = snapshot.lockText ?? '';

    const perUnit = snapshot.raw.perUnit;
    const chain = snapshot.units > 0 ? snapshot.production / (snapshot.units * perUnit) : 1;

    for (const task of seatTasks) {
      const step = snapshot.steps.find((x) => x.step === task.id);
      const count = step?.count ?? 0;
      const gain = count * perUnit * chain;

      seatTiles.get(task.id)?.update({
        effect: snapshot.maxed
          ? 'Licence is full'
          : count > 0
            ? `+${formatNumber(gain)} Buzz/sec \u00b7 ${count} ${count === 1 ? 'seat' : 'seats'}`
            : 'Not enough Buzz yet',
        cost: step ? formatNumber(step.cost) : '\u2014',
        progress: step && step.cost > 0 ? game.state.buzz / step.cost : 0,
        state: snapshot.maxed ? 'maxed' : step && !step.disabled ? 'buyable' : 'unaffordable',
        tooltip: {
          title: task.label,
          body:
            task.id === 1
              ? 'One more machine covered by the subscription.'
              : `Licenses ${task.per ?? 'as many seats as you can afford'} at once. Each seat costs more than the last.`,
          gain: snapshot.maxed ? 'Licence is full.' : `+${formatNumber(gain)} Buzz/sec`,
          rows: [
            ['Cost', step ? `${formatNumber(step.cost)} Buzz` : '\u2014'],
            ['You have', `${formatNumber(game.state.buzz)} Buzz`],
            ['Seats', `${snapshot.units} of ${snapshot.maxPerRun}`],
          ],
        },
      });
    }
  }

  ref('scan').addEventListener('click', () => {
    const result = game.startScan();
    if (!result.ok && result.reason === 'already-scanning') {
      game.notify('Scan running', 'Let it finish.', 'info');
    }
    update();
  });

  /* ------------------------------------------------------- the pay-off */

  /**
   * The moment the reward lands: the sealed file shatters into pixels, coins
   * fall out of it, and the prize is stamped over the wreckage.
   *
   * The row is deliberately left in the list until the animation ends
   * (`freezeUntil`), because the alternative — the row vanishing on the next
   * 200 ms refresh — is the reward happening somewhere the player is not
   * looking. The prize label is a plain node removed on a timer rather than an
   * animated one, so it still reads under reduced motion, where every duration
   * in the document collapses to nothing.
   */
  let freezeUntil = 0;

  function celebrate(row, threat, reward) {
    const stage = el('div', { class: 'sh__burst', 'aria-hidden': 'true' });

    for (let i = 0; i < 14; i += 1) {
      const angle = (360 / 14) * i + (i % 3) * 7;
      stage.appendChild(
        el('span', {
          class: 'sh__shard',
          style: `--angle:${angle}deg;--dist:${34 + (i % 4) * 12}px;--spin:${
            i % 2 ? 180 : -220
          }deg;--delay:${(i % 5) * 18}ms`,
        }),
      );
    }
    for (let i = 0; i < 7; i += 1) {
      stage.appendChild(
        el('span', {
          class: 'sh__coin',
          text: '¤',
          style: `--x:${-54 + i * 18}px;--fall:${52 + (i % 3) * 16}px;--delay:${90 + i * 45}ms`,
        }),
      );
    }

    row.classList.add('is-extracting');
    row.appendChild(stage);
    row.appendChild(el('span', { class: 'sh__prize', text: rewardText(threat, reward) }));

    freezeUntil = performance.now() + 2200;
    setTimeout(() => {
      freezeUntil = 0;
      quarantineKey = null; // force the rebuild the freeze was holding back
      update();
    }, 2200);
  }

  function rewardText(threat, reward) {
    if (reward.kind === 'buzz') return `+${formatNumber(reward.buzz)} Buzz`;
    if (reward.kind === 'buff') {
      return `+${Math.round(reward.magnitude * 100)}% to everything for ${
        reward.durationSeconds / 60
      } min`;
    }
    return `Render +${Math.round(reward.renderFraction * 100)}%`;
  }

  /** Open a quarantined file. `viaAd` is the full payout; manual is a share. */
  async function extract(item, row, viaAd) {
    const finish = () => {
      const result = game.extractQuarantine(item.id, { viaAd });
      if (!result.ok) {
        update();
        return;
      }
      celebrate(row, result.threat, result.reward);
    };

    if (!viaAd) {
      finish();
      return;
    }

    // Rewarded ad, through the shared adapter: it stops gameplay for the
    // duration (which is what mutes the game around the break), reports a
    // failure once, and resolves false rather than paying out. The file stays
    // sealed either way and the manual button is still right there — never a
    // dead end.
    const watched = await ads.rewarded('quarantine');
    if (!watched) {
      update();
      return;
    }
    finish();
  }

  /* ---------------------------------------------------------- quarantine */

  let quarantineKey = null;

  function renderQuarantine(now) {
    // Mid-celebration: leave the DOM exactly as it is.
    if (freezeUntil > performance.now()) return;

    const s = game.state;
    const items = s.shield99.quarantine;
    const key = items.map((item) => item.id).join(',');

    if (key !== quarantineKey) {
      quarantineKey = key;
      clear(quarantineRoot);

      if (items.length === 0) {
        quarantineRoot.appendChild(
          el('li', { class: 'sh__empty' }, [
            el('span', {
              text: s.lemonwire.activeSeeds.length
                ? 'Nothing caught yet. Keep this window open while LemonWire shares.'
                : 'Nothing caught yet. Threats arrive while LemonWire is seeding.',
            }),
          ]),
        );
      }

      for (const item of items) {
        const threat = getThreat(item.threatId);
        const row = el('li', {
          class: `sh__threat is-${threat.tier.toLowerCase()}`,
          dataset: { itemId: String(item.id) },
        });

        row.append(
          el('span', {
            class: `sh__threat-icon ${TIER_CLASS[threat.tier] ?? 'is-common'}`,
            'aria-hidden': 'true',
          }),
          el('div', { class: 'sh__threat-text' }, [
            el('span', { class: 'sh__threat-name', text: threat.name }),
            el('span', { class: 'sh__threat-blurb', text: threat.blurb }),
          ]),
          el('span', { class: 'sh__tier', text: threat.tier }),
        );

        const actions = el('div', { class: 'sh__threat-actions' });
        if (canAd) {
          actions.append(
            el('button', {
              type: 'button',
              class: 'ad-button sh__button sh__extract',
              dataset: { role: `ad-${item.id}` },
              text: '▶ Disinfect & Extract',
              title: 'Watch a short ad for the full payload.',
              onclick: () => extract(item, row, true),
            }),
            el('button', {
              type: 'button',
              class: 'sh__button sh__manual',
              text: `Clean manually · ${Math.round(SHIELD99.manualRewardFraction * 100)}%`,
              title: 'No ad, a fraction of the payload.',
              onclick: () => extract(item, row, false),
            }),
          );
        } else {
          // Off-portal or behind an ad blocker: there is no ad to watch, so
          // there is no ad button — one that cannot do anything is worse than
          // no button, and the full payload is not gated behind it anyway.
          actions.append(
            el('button', {
              type: 'button',
              class: 'sh__button sh__extract',
              text: 'Disinfect & Extract',
              onclick: () => extract(item, row, false),
            }),
          );
        }
        row.append(actions);
        quarantineRoot.appendChild(row);
      }
    }

    // Ad pacing, refreshed in place: a greyed button with a countdown says
    // "later", where a button that simply does nothing says "broken".
    const cooling = adCooldownLeft(s, now);
    for (const item of items) {
      const button = ref(`ad-${item.id}`);
      if (!button) continue;
      button.disabled = cooling > 0;
      button.textContent =
        cooling > 0 ? `Ready in ${formatDuration(Math.ceil(cooling))}` : '▶ Disinfect & Extract';
    }
  }

  /* --------------------------------------------------------------- update */

  const update = throttle(() => {
    const s = game.state;
    const now = Date.now();
    const infected = s.security.infection !== null;
    const scanning = s.security.scan !== null;
    const caught = s.shield99.quarantine.length;

    body.dataset.status = infected ? 'infected' : 'protected';

    ref('state').textContent = infected ? 'Threat detected' : scanning ? 'Scanning…' : 'Protected';
    ref('sub').textContent = infected
      ? 'Production is halved until the machine is clean. Run a deep scan.'
      : scanning
        ? `${formatDuration(s.security.scan.secondsLeft)} remaining — keep this window open.`
        : caught > 0
          ? `${caught} sealed ${caught === 1 ? 'file' : 'files'} waiting in quarantine.`
          : 'Real-time protection is on while this window is open.';

    ref('radar').dataset.state = infected ? 'infected' : caught > 0 ? 'catch' : 'clear';
    ref('radar-count').textContent = String(caught);

    setBar(ref('scan-bar'), scanning ? scanProgress(s) : 0, { warn: 2, critical: 2 });
    ref('scan').disabled = scanning;
    ref('scan').textContent = scanning ? 'Scanning…' : infected ? 'Clean the machine' : 'Deep scan';
    ref('scan').classList.toggle('is-urgent', infected && !scanning);

    ref('quarantine-count').textContent = `(${caught} / ${SHIELD99.maxQuarantine})`;
    ref('blocked').textContent = String(s.stats.threatsBlocked ?? 0);
    ref('cleaned').textContent = String(s.shield99.filesCleaned ?? 0);
    const rescuesLeft = SECURITY.freeRescuesPerRun - s.security.rescuesUsed;
    ref('trial').textContent = rescuesLeft > 0 ? 'available' : 'used this run';

    renderQuarantine(now);

    const snapshot = view.read();
    if (snapshot) {
      renderFeatures(snapshot);
      renderSubscription(snapshot);
      status.set('seats', `${snapshot.units} seats`);
      status.set('rate', `${formatNumber(snapshot.production)} Buzz/sec`);
    }
    status.set('state', infected ? 'Threat detected' : scanning ? 'Scanning' : 'Protected');
  }, 200);

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);
  return () => {
    unsubscribe();
    for (const tile of featureTiles.values()) tile.destroy();
    for (const tile of seatTiles.values()) tile.destroy();
    menus.destroy();
    delete body.dataset.status;
    body.classList.remove('app-shield');
  };
}

/** See the note in apps/aerochat.js — this app draws its own economy UI. */
export const ownsBuildingUI = true;

/** Tray icon (AO-22): protection status without opening anything. */
export function createTrayShield({ root, game, launch }) {
  const button = el('button', {
    type: 'button',
    class: 'tray__shield',
    'aria-label': 'Shield99',
    title: 'Shield99',
    onclick: () => launch('shield99'),
  });
  root.prepend(button);

  const update = throttle(() => {
    const s = game.state;
    const installed = s.apps.shield99.installed;
    button.hidden = !installed;
    if (!installed) return;

    const infected = s.security.infection !== null;
    const active = s.apps.shield99.open;
    const waiting = s.shield99.quarantine.length;
    const status = infected ? 'infected' : waiting > 0 ? 'catch' : active ? 'protected' : 'idle';

    button.dataset.status = status;
    // The tray glyph is drawn by CSS off `data-status` (charter §A.1).
    button.textContent = '';
    button.title = {
      infected: 'Shield99 — threat detected, open to clean',
      catch: `Shield99 — ${waiting} file${waiting === 1 ? '' : 's'} in quarantine`,
      protected: 'Shield99 — real-time protection on',
      idle: 'Shield99 — open for real-time protection',
    }[status];
  }, 300);

  update();
  return { update };
}
