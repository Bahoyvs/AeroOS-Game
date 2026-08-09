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
 * ## Why it is built out of 7.css's own parts
 *
 * The charter (GDD §A.2) says to build on `.glass` and 7.css rather than invent
 * a style system, and that is not a stylistic preference — it is the difference
 * between this reading as Windows and reading as a web app wearing a Vista
 * wallpaper. So the structure here is the genuine Win32/Aero vocabulary:
 *
 * - **`<fieldset><legend>`** is a *group box*, the panel Control Panel and every
 *   properties dialog of the era was built from. 7.css already styles it.
 * - **`.instruction-primary`** is the blue task-dialog headline Vista put at the
 *   top of a page to state what you are looking at.
 * - **A sunken white list well** (`has-container`'s treatment) holds the
 *   upgrades, because a list of purchasable things in 2007 was a *list view* —
 *   inset, white, with rows — not a stack of floating cards.
 * - **Rows carry a checkmark and a real button**, the Add/Remove Programs
 *   pattern, rather than a pastel "Owned" chip.
 *
 * Nothing here uses uppercase letter-spaced micro-labels. Those are a modern
 * dashboard idiom; Windows wrote "Buzz per second" in sentence case at 9pt.
 *
 * The panel never computes anything. Every figure it prints comes from
 * `game.productionBreakdown(id)`, which is the accessor `core/economy.js`
 * exposes for exactly this purpose.
 */
export function mountBuildingPanel(host, { game, buildingId, onPlayMinigame = null }) {
  const building = getBuilding(buildingId);
  host.classList.add('bpanel');
  host.innerHTML = `
    <fieldset class="bpanel__group">
      <legend>Production</legend>

      <p class="instruction instruction-primary bpanel__headline" data-role="headline"></p>
      <p class="bpanel__rate">
        Producing <b data-role="rate">0</b> Buzz per second
      </p>

      <p class="bpanel__lock" data-role="lock" hidden></p>

      <div class="bpanel__buy" data-role="buy" role="group" aria-label="Buy units"></div>
    </fieldset>

    <fieldset class="bpanel__group">
      <legend>Where this comes from</legend>
      <ul class="bpanel__breakdown" data-role="breakdown"></ul>
    </fieldset>

    <fieldset class="bpanel__group">
      <legend>Upgrades</legend>
      <ul class="bpanel__upgrades" data-role="upgrades"></ul>
      <div class="bpanel__minigame" data-role="minigame" hidden></div>
    </fieldset>
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
   *
   * Laid out as a Win32 button row: the label and the price sit on one line,
   * the way a real command button captions itself.
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
        el('span', { class: 'bpanel__buy-step', text: step === 'max' ? 'Max' : `Buy ${step}` }),
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
          ? `Requires ${row.requiresPartnerUnits} ${getBuilding(row.partnerId).name}`
          : `Requires ${row.requiresUnits} ${unitWord(building, row.requiresUnits)}` +
            ` — you have ${row.haveUnits}`
        : null;

      upgradeRoot.appendChild(
        el(
          'li',
          {
            class: `bpanel__upgrade${row.owned ? ' is-owned' : ''}${row.gated ? ' is-gated' : ''}`,
          },
          [
            // The Add/Remove Programs tick column: present when installed,
            // reserved when not, so the rows stay in one grid.
            el('span', {
              class: 'bpanel__tick',
              'aria-hidden': 'true',
              text: row.owned ? '✓' : '',
            }),
            el('span', { class: 'bpanel__upgrade-text' }, [
              el('strong', { text: row.name }),
              el('small', { text: row.blurb ?? effectText(row) }),
              // The visible-but-unaffordable hook (v2 §6): the requirement is
              // printed while it is unmet, so the next goal is always readable.
              requirement ? el('em', { class: 'bpanel__req', text: requirement }) : null,
            ]),
            row.owned
              ? el('span', { class: 'bpanel__installed', text: 'Installed' })
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
    const line = (label, value, cls = '') =>
      breakdownRoot.appendChild(
        el('li', { class: cls }, [el('span', { text: label }), el('b', { text: value })]),
      );

    line(
      `${formatNumber(bd.units)} ${unitWord(building, bd.units)} at ${formatNumber(bd.perUnit)} each`,
      formatNumber(bd.units * bd.perUnit),
    );
    if (bd.flatBonus > 0) line('Buddy list sync', `+${formatNumber(bd.flatBonus)}`);
    if (bd.localUpgrades !== 1) line('Upgrades', `×${bd.localUpgrades}`);
    if (bd.chatMultiplier !== 1) line('Buddy milestones', `×${bd.chatMultiplier.toFixed(2)}`);
    if (bd.crossBuildingBonus) {
      line('Buddies', `+${Math.round(bd.crossBuildingBonus.amount * 100)}%`);
    }
    for (const synergy of bd.synergyBonus) {
      line(`Synergy with ${getBuilding(synergy.source).name}`, `+${(synergy.amount * 100).toFixed(1)}%`);
    }
    if (bd.minigameMultiplier !== 1) {
      line('Mini-game bonus', `×${bd.minigameMultiplier.toFixed(2)}`);
    }
    if (bd.incognitoMultiplier !== 1) {
      line('Incognito tax', `×${bd.incognitoMultiplier.toFixed(2)}`);
    }
    line('System multiplier', `×${bd.globalMultiplier.toFixed(2)}`);
    line('Total', `${formatNumber(bd.total)} / sec`, 'is-total');
  }

  /* --------------------------------------------------------------- update */

  const update = throttle(() => {
    const rows = game.buildingRows();
    const row = rows.find((r) => r.id === buildingId);
    if (!row) return;

    ref('headline').textContent =
      `${formatNumber(row.units)} ${unitWord(building, row.units)}`;
    ref('rate').textContent = formatNumber(row.breakdown.total);

    const lock = ref('lock');
    lock.hidden = row.unlocked;
    if (!row.unlocked && row.lock) {
      lock.textContent =
        row.lock.reason === 'cpu-tier'
          ? `Requires a tier-${row.lock.at} processor.`
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
      // A disabled button still states its price. An em-dash tells the player
      // nothing, and the price is exactly what they are waiting to afford.
      ref(`cost-${step}`).textContent = row.maxed ? 'Full' : formatNumber(cost);
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
            ? `${config.title} (locked)`
            : cooldownSeconds > 0
              ? `${config.title} — ready in ${formatDuration(cooldownSeconds)}`
              : `Play ${config.title}`,
          onclick: () => onPlayMinigame(buildingId),
        }),
      );
      minigameRoot.appendChild(
        el('small', {
          class: 'bpanel__play-note',
          text: unlocked ? config.blurb : 'Unlocked by the tier-3 upgrade.',
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
      return "Doubles this building's output.";
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
