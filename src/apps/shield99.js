import { SECURITY, SHIELD99 } from '../data/balance.js';
import { adCooldownLeft, getThreat, scanProgress } from '../core/shield99.js';
import { formatDuration, formatNumber } from '../core/format.js';
import { clear, el, setBar, throttle } from './../ui/dom.js';

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
 */

const TIER_ICON = { Common: '📄', Rare: '💾', Epic: '💿' };

export function mount(body, { game, ads = null }) {
  // One question, asked once: can an ad actually play here? Off-portal and
  // behind an ad blocker the answer is no, and the window renders the manual
  // path as its only button rather than offering a video that cannot run.
  const canAd = Boolean(ads?.available);

  body.classList.add('app-shield');
  body.innerHTML = `
    <div class="sh__hero" data-role="hero">
      <span class="sh__badge" data-role="badge" aria-hidden="true">🛡️</span>
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

    <div class="sh__scan">
      <div class="meter__track"><div class="meter__fill" data-role="scan-bar"></div></div>
      <button type="button" class="sh__button" data-role="scan">Deep scan</button>
    </div>

    <h4 class="sh__heading">
      Quarantine <small data-role="quarantine-count"></small>
    </h4>
    <ul class="sh__quarantine" data-role="quarantine"></ul>

    <dl class="sh__stats">
      <div><dt>Threats blocked</dt><dd data-role="blocked">0</dd></div>
      <div><dt>Files disinfected</dt><dd data-role="cleaned">0</dd></div>
      <div><dt>Free trial rescue</dt><dd data-role="trial">available</dd></div>
      <div><dt>Definitions</dt><dd>2005.11.14</dd></div>
    </dl>

    <p class="sh__note">
      Keep Shield99 open while LemonWire seeds and every threat is caught and sealed instead of
      infecting the machine. An infection never costs more than half your production, and never
      your progress.
    </p>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const quarantineRoot = ref('quarantine');

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
          el('span', { class: 'sh__threat-icon', 'aria-hidden': 'true', text: TIER_ICON[threat.tier] ?? '📄' }),
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
    ref('badge').textContent = infected ? '☣️' : '🛡️';

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
  }, 200);

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);
  return () => {
    unsubscribe();
    delete body.dataset.status;
    body.classList.remove('app-shield');
  };
}

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
    button.textContent = infected ? '☣️' : '🛡️';
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
