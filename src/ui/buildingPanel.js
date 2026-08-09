import { BUY_STEPS, getBuilding } from '../data/buildings.js';
import { formatDuration, formatNumber } from '../core/format.js';
import { clear, el, throttle } from './dom.js';

/**
 * The building panel — units, upgrades and the production breakdown.
 *
 * One component for all twelve buildings, mounted inside a Full Window app's
 * body or inside a Tray popover. Writing it twelve times would have been twelve
 * places for the "show your working" rule to be broken, and that rule is not
 * optional: **no multiplier may act invisibly** (patch §4.1). A synergy the
 * player cannot see is, for them, not there.
 *
 * The panel never computes anything. Every figure it prints comes from
 * `game.productionBreakdown(id)`, which is the accessor `core/economy.js`
 * exposes for exactly this purpose.
 */
export function mountBuildingPanel(host, { game, buildingId, onPlayMinigame = null }) {
  const building = getBuilding(buildingId);
  host.classList.add('bpanel');
  host.innerHTML = `
    <div class="bpanel__head">
      <div class="bpanel__owned">
        <strong data-role="units">0</strong>
        <small data-role="unit-label"></small>
      </div>
      <div class="bpanel__rate">
        <strong data-role="rate">0</strong>
        <small>Buzz/sec</small>
      </div>
    </div>

    <div class="bpanel__buy" data-role="buy" role="group" aria-label="Buy units"></div>
    <p class="bpanel__lock" data-role="lock" hidden></p>

    <details class="bpanel__breakdown">
      <summary>Where this comes from</summary>
      <ul data-role="breakdown"></ul>
    </details>

    <h4 class="bpanel__heading">Upgrades</h4>
    <ul class="bpanel__upgrades" data-role="upgrades"></ul>

    <div class="bpanel__minigame" data-role="minigame" hidden></div>
  `;

  const ref = (role) => host.querySelector(`[data-role="${role}"]`);
  const buyRoot = ref('buy');
  const upgradeRoot = ref('upgrades');
  const breakdownRoot = ref('breakdown');
  const minigameRoot = ref('minigame');

  /* ------------------------------------------------------------ buy buttons */

  /**
   * Stepped quantities rather than a free quantity box (patch §2.2). The
   * exponential curve already makes a runaway purchase impossible, so this is
   * purely accident-prevention — nobody should empty their wallet with one
   * mistimed tap on a phone.
   */
  const buyButtons = new Map();
  for (const step of BUY_STEPS) {
    const amount = step === 'max' ? Number.MAX_SAFE_INTEGER : step;
    const button = el(
      'button',
      {
        type: 'button',
        class: 'bpanel__buy-btn',
        onclick: () => {
          const result = game.buyBuildingUnits(buildingId, amount);
          if (!result.ok && result.reason === 'too-expensive') {
            game.notify('Not enough Buzz', `${building.name} needs more than you have.`, 'warn');
          }
          update();
        },
      },
      [
        el('span', { class: 'bpanel__buy-step', text: step === 'max' ? 'Max' : `×${step}` }),
        el('span', { class: 'bpanel__buy-cost', dataset: { role: `cost-${step}` } }),
      ],
    );
    buyRoot.appendChild(button);
    buyButtons.set(step, button);
  }

  /* -------------------------------------------------------------- upgrades */

  let upgradeKey = null;

  function renderUpgrades(rows) {
    // Rebuilding this list every frame would throw away focus and hover on a
    // panel the player is actively clicking through, so it only redraws when
    // the *shape* of the list changes.
    const key = rows.map((r) => `${r.id}:${r.owned}:${r.gated}:${r.affordable}`).join('|');
    if (key === upgradeKey) return;
    upgradeKey = key;

    clear(upgradeRoot);
    if (rows.length === 0) {
      upgradeRoot.appendChild(
        el('li', { class: 'bpanel__empty', text: 'Nothing available yet.' }),
      );
      return;
    }

    for (const row of rows) {
      const requirement = row.gated
        ? row.havePartnerUnits !== null && row.havePartnerUnits < row.requiresPartnerUnits
          ? `Needs ${row.requiresPartnerUnits} ${getBuilding(row.partnerId).name}`
          : `Needs ${row.requiresUnits} ${unitWord(building, row.requiresUnits)}` +
            ` (${row.haveUnits}/${row.requiresUnits})`
        : null;

      upgradeRoot.appendChild(
        el(
          'li',
          {
            class: `bpanel__upgrade${row.owned ? ' is-owned' : ''}${row.gated ? ' is-gated' : ''}`,
          },
          [
            el('div', { class: 'bpanel__upgrade-text' }, [
              el('strong', { text: row.name }),
              el('small', { text: row.blurb ?? effectText(row) }),
              // The visible-but-unaffordable hook (v2 §6): the requirement is
              // printed while it is unmet, so the next goal is always readable.
              requirement ? el('em', { class: 'bpanel__req', text: requirement }) : null,
            ]),
            row.owned
              ? el('span', { class: 'bpanel__owned-tick', text: 'Owned', 'aria-label': 'Owned' })
              : el('button', {
                type: 'button',
                class: 'bpanel__upgrade-buy',
                disabled: row.buyable ? null : '',
                text: formatNumber(row.cost),
                onclick: () => {
                  game.buyBuildingUpgrade(row.id);
                  update();
                },
              }),
          ],
        ),
      );
    }
  }

  /* ------------------------------------------------------------- breakdown */

  function renderBreakdown(bd) {
    clear(breakdownRoot);
    const line = (label, value) =>
      breakdownRoot.appendChild(
        el('li', {}, [el('span', { text: label }), el('b', { text: value })]),
      );

    line(
      `${bd.units} × ${formatNumber(bd.perUnit)}`,
      formatNumber(bd.units * bd.perUnit),
    );
    if (bd.flatBonus > 0) line('Buddy list sync', `+${formatNumber(bd.flatBonus)}`);
    if (bd.localUpgrades !== 1) line('Upgrades', `×${bd.localUpgrades}`);
    if (bd.chatMultiplier !== 1) line('Buddy milestones', `×${bd.chatMultiplier.toFixed(2)}`);
    if (bd.crossBuildingBonus) {
      line('Buddies', `+${Math.round(bd.crossBuildingBonus.amount * 100)}%`);
    }
    for (const synergy of bd.synergyBonus) {
      line(`Synergy · ${getBuilding(synergy.source).name}`, `+${(synergy.amount * 100).toFixed(1)}%`);
    }
    if (bd.minigameMultiplier !== 1) {
      line('Mini-game bonus', `×${bd.minigameMultiplier.toFixed(2)}`);
    }
    if (bd.incognitoMultiplier !== 1) {
      line('Incognito tax', `×${bd.incognitoMultiplier.toFixed(2)}`);
    }
    line('System multiplier', `×${bd.globalMultiplier.toFixed(2)}`);
    line('Total', `${formatNumber(bd.total)}/sec`);
  }

  /* --------------------------------------------------------------- update */

  const update = throttle(() => {
    const rows = game.buildingRows();
    const row = rows.find((r) => r.id === buildingId);
    if (!row) return;

    ref('units').textContent = formatNumber(row.units);
    ref('unit-label').textContent = unitWord(building, row.units);
    ref('rate').textContent = formatNumber(row.breakdown.total);

    const lock = ref('lock');
    lock.hidden = row.unlocked;
    if (!row.unlocked && row.lock) {
      lock.textContent =
        row.lock.reason === 'cpu-tier'
          ? `Needs a tier-${row.lock.at} CPU.`
          : `Unlocks at ${formatNumber(row.lock.at)} Buzz this run.`;
    }

    for (const [step, button] of buyButtons) {
      const amount = step === 'max' ? Number.MAX_SAFE_INTEGER : step;
      const cost =
        step === 'max'
          ? game.econ.affordableUnits(game.state, buildingId, amount).cost
          : game.econ.unitCostBulk(buildingId, row.units, amount);
      const affordable = cost > 0 && game.state.buzz >= cost;
      button.disabled = !row.unlocked || row.maxed || !affordable;
      ref(`cost-${step}`).textContent = row.maxed ? '—' : formatNumber(cost);
    }

    renderUpgrades(row.upgrades);
    renderBreakdown(row.breakdown);

    /* ------------------------------------------------------- mini-game */
    if (row.minigame && onPlayMinigame) {
      minigameRoot.hidden = false;
      const { unlocked, cooldownSeconds, config } = row.minigame;
      clear(minigameRoot);
      minigameRoot.appendChild(
        el('button', {
          type: 'button',
          class: 'bpanel__play',
          disabled: unlocked && cooldownSeconds <= 0 ? null : '',
          text: !unlocked
            ? `${config.title} — locked`
            : cooldownSeconds > 0
              ? `${config.title} — ${formatDuration(cooldownSeconds)}`
              : `Play ${config.title}`,
          onclick: () => onPlayMinigame(buildingId),
        }),
      );
      minigameRoot.appendChild(
        el('small', {
          class: 'bpanel__play-note',
          text: unlocked ? config.blurb : `Unlocked by the tier-3 upgrade.`,
        }),
      );
    } else {
      minigameRoot.hidden = true;
    }
  }, 250);

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);
  return () => {
    unsubscribe();
    clear(host);
    host.classList.remove('bpanel');
  };
}

function unitWord(building, count) {
  return count === 1 ? building.unitLabel : building.unitLabelPlural;
}

/** A one-line description of what an upgrade does, from its effect shape. */
function effectText(row) {
  switch (row.effect.kind) {
    case 'double':
      return `Doubles this building's output.`;
    case 'perBuddies':
      return `+${Math.round(row.effect.bonus * 100)}% per ${row.effect.per} buddies.`;
    case 'perBuilding':
      return `+${formatNumber(row.effect.flat)} Buzz/sec per building you own.`;
    case 'synergy':
      return 'Both buildings boost each other.';
    default:
      return '';
  }
}
