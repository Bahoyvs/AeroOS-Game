import { BUY_STEPS, getBuilding } from '../data/buildings.js';
import { formatNumber } from '../core/format.js';

/**
 * The building **view-model**. Headless on purpose — it renders nothing.
 *
 * This replaces the shared purchase panel that used to be appended to every
 * window. That panel was a generic idle-game shop wearing an OS costume: nine
 * apps, one "Buy 1 / Buy 10 / Max" block, and the software metaphor broken in
 * all of them.
 *
 * The split it enforces:
 *
 * - **Economy stays centralised.** Costs, bulk pricing, affordability, the unit
 *   cap, upgrade gating and the production breakdown are computed once, here,
 *   from `core/`. Twelve apps do not get twelve copies of "can I afford this".
 * - **Presentation is bespoke, always.** This module hands back a plain object.
 *   How it is drawn — an MSN "Add a Contact" split button, a render farm's blade
 *   allocation spinner, an antivirus licence dialog — belongs entirely to the
 *   app, because that is the only way the fiction survives.
 *
 * If you find yourself writing a `render()` in this file, the shop is growing
 * back.
 */

/** A stable label for a step, so apps can relabel without re-deriving amounts. */
const STEP_AMOUNT = (step, building) =>
  step === 'max' ? building.maxPerRun : step;

/**
 * @param game  the object from `createGame`
 * @param id    building id
 */
export function createBuildingView(game, id) {
  const building = getBuilding(id);

  /**
   * One snapshot of everything an app could need to draw. Call it from the
   * app's own throttled update — it is cheap (a few reads over numbers already
   * in memory) and deliberately allocates a fresh object, so an app can diff
   * against its own previous snapshot without this module keeping state.
   */
  function read() {
    const row = game.buildingRows().find((r) => r.id === id);
    if (!row) return null;

    const units = row.units;
    const word = units === 1 ? building.unitLabel : building.unitLabelPlural;

    /** Purchase options, priced. Apps choose the labels and the control. */
    const steps = BUY_STEPS.map((step) => {
      const amount = STEP_AMOUNT(step, building);
      const cost =
        step === 'max'
          ? game.econ.affordableUnits(game.state, id, amount).cost
          : game.econ.unitCostBulk(id, units, amount);
      const count =
        step === 'max' ? game.econ.affordableUnits(game.state, id, amount).count : step;
      return {
        step,
        amount,
        count,
        cost,
        affordable: count > 0 && cost > 0 && game.state.buzz >= cost,
        disabled: !row.unlocked || row.maxed || count === 0 || game.state.buzz < cost,
      };
    });

    /**
     * Upgrades, with one `state` string rather than three booleans — apps
     * switch on it to pick a plugin slot's look, a checkbox's look, a licence
     * row's look. Keeping the three-way decision here is what stops each app
     * re-deriving "gated but affordable" slightly differently.
     */
    const upgrades = row.upgrades.map((u) => ({
      id: u.id,
      name: u.name,
      blurb: u.blurb ?? effectText(u),
      cost: u.cost,
      kind: u.kind,
      tier: u.tier ?? null,
      state: u.owned ? 'owned' : u.gated ? 'gated' : u.affordable ? 'buyable' : 'unaffordable',
      requirement: u.gated ? requirementText(u, building) : null,
      haveUnits: u.haveUnits,
      requiresUnits: u.requiresUnits,
    }));

    /**
     * The breakdown as labelled lines. Every source that touches this
     * building's output appears here — the "no multiplier acts invisibly" rule
     * (patch §4.1) survives the redesign, it just gets drawn as a mixer strip,
     * a throughput readout or a status bar instead of a generic table.
     */
    const bd = row.breakdown;
    const lines = [];
    const push = (key, label, value) => lines.push({ key, label, value });

    push('base', `${units} ${word} at ${fmt(bd.perUnit)} each`, fmt(units * bd.perUnit));
    if (bd.flatBonus > 0) push('flat', 'Buddy list sync', `+${fmt(bd.flatBonus)}`);
    if (bd.localUpgrades !== 1) push('upgrades', 'Upgrades', `×${bd.localUpgrades}`);
    if (bd.chatMultiplier !== 1) push('chat', 'Buddy milestones', `×${bd.chatMultiplier.toFixed(2)}`);
    if (bd.crossBuildingBonus) {
      push('cross', 'Buddies', `+${Math.round(bd.crossBuildingBonus.amount * 100)}%`);
    }
    for (const s of bd.synergyBonus) {
      push(`synergy:${s.source}`, `Synergy with ${getBuilding(s.source).name}`,
        `+${(s.amount * 100).toFixed(1)}%`);
    }
    if (bd.minigameMultiplier !== 1) {
      push('minigame', 'Mini-game bonus', `×${bd.minigameMultiplier.toFixed(2)}`);
    }
    if (bd.incognitoMultiplier !== 1) {
      push('incognito', 'Incognito tax', `×${bd.incognitoMultiplier.toFixed(2)}`);
    }
    push('system', 'System multiplier', `×${bd.globalMultiplier.toFixed(2)}`);
    push('total', 'Total', `${fmt(bd.total)} / sec`);

    return {
      id,
      name: building.name,
      unitWord: word,
      unitLabel: building.unitLabel,
      unitLabelPlural: building.unitLabelPlural,
      units,
      maxPerRun: building.maxPerRun,
      maxed: row.maxed,
      unlocked: row.unlocked,
      lock: row.lock,
      lockText: lockText(row.lock),
      production: bd.total,
      steps,
      upgrades,
      lines,
      raw: bd,
      minigame: row.minigame
        ? { ...row.minigame, ready: row.minigame.unlocked && row.minigame.cooldownSeconds <= 0 }
        : null,
    };
  }

  return {
    building,
    read,
    /** `step` is a member of BUY_STEPS: 1, 10, 100 or 'max'. */
    buy: (step) => game.buyBuildingUnits(id, STEP_AMOUNT(step, building)),
    /**
     * Buy an arbitrary quantity. The stepped `BUY_STEPS` are a *UI convention*
     * for apps that want buttons; an app with a spinner — a render farm
     * allocating blades, a licence dialog with a seat count — asks for the
     * number the player actually typed.
     */
    buyAmount: (amount) => game.buyBuildingUnits(id, Math.max(1, Math.floor(amount))),
    /** What `amount` more units would cost right now. */
    costOf: (amount) =>
      game.econ.unitCostBulk(id, game.econ.unitsOf(game.state, id), Math.max(1, Math.floor(amount))),
    /** How many the wallet can actually cover, for a "fill" action. */
    affordable: () => game.econ.affordableUnits(game.state, id, building.maxPerRun),
    buyUpgrade: (upgradeId) => game.buyBuildingUpgrade(upgradeId),
  };
}

const fmt = formatNumber;

function lockText(lock) {
  if (!lock) return null;
  return lock.reason === 'cpu-tier'
    ? `Requires a tier-${lock.at} processor.`
    : `Unlocks at ${formatNumber(lock.at)} Buzz this run.`;
}

function requirementText(u, building) {
  if (u.havePartnerUnits !== null && u.havePartnerUnits < u.requiresPartnerUnits) {
    return `Requires ${u.requiresPartnerUnits} ${getBuilding(u.partnerId).name}`;
  }
  const word = u.requiresUnits === 1 ? building.unitLabel : building.unitLabelPlural;
  return `Requires ${u.requiresUnits} ${word} — you have ${u.haveUnits}`;
}

function effectText(u) {
  switch (u.effect.kind) {
    case 'double':
      return "Doubles this building's output.";
    case 'perBuddies':
      return `+${Math.round(u.effect.bonus * 100)}% per ${u.effect.per} buddies.`;
    case 'perBuilding':
      return `+${formatNumber(u.effect.flat)} Buzz/sec per building you own.`;
    case 'synergy':
      return 'Both buildings boost each other.';
    default:
      return '';
  }
}
