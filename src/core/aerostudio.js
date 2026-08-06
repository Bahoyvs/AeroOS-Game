import { AEROSTUDIO } from '../data/balance.js';

export function getUpgradeCost(upgradeId, currentLevel) {
  const def = AEROSTUDIO.upgrades[upgradeId];
  if (!def) throw new Error(`Unknown Aero Studio upgrade: ${upgradeId}`);
  return Math.ceil(def.baseCost * Math.pow(def.costGrowth, currentLevel));
}

export function getSpeedMultiplier(state) {
  let mult = 1;
  const up = state.aerostudio.upgrades;
  
  if (up.sidechainCompression > 0) {
    mult += AEROSTUDIO.upgrades.sidechainCompression.speedBonus * up.sidechainCompression;
  }
  if (up.arpeggiator > 0) {
    mult += AEROSTUDIO.upgrades.arpeggiator.speedBonus * up.arpeggiator;
  }
  if (up.environmentalFx > 0) {
    mult += AEROSTUDIO.upgrades.environmentalFx.speedBonus * up.environmentalFx;
  }
  
  return mult;
}

export function canBuyUpgrade(state, upgradeId) {
  const currentLevel = state.aerostudio.upgrades[upgradeId];
  if (currentLevel === undefined) return { ok: false, reason: 'unknown-upgrade' };
  
  const cost = getUpgradeCost(upgradeId, currentLevel);
  if (state.buzz < cost) return { ok: false, reason: 'too-expensive', cost };
  
  return { ok: true, cost };
}

export function buyUpgrade(state, upgradeId) {
  const check = canBuyUpgrade(state, upgradeId);
  if (!check.ok) return check;
  
  state.buzz -= check.cost;
  state.aerostudio.upgrades[upgradeId] += 1;
  
  return { ok: true, cost: check.cost };
}

export function startRender(state, projectName) {
  if (state.aerostudio.isRendering) return { ok: false, reason: 'already-rendering' };
  
  state.aerostudio.isRendering = true;
  state.aerostudio.currentProject = projectName || "Untitled Project";
  state.aerostudio.progress = 0;
  
  return { ok: true };
}

export function cancelRender(state) {
  if (!state.aerostudio.isRendering) return { ok: false, reason: 'not-rendering' };
  
  state.aerostudio.isRendering = false;
  state.aerostudio.currentProject = null;
  state.aerostudio.progress = 0;
  
  return { ok: true };
}

export function updateRender(state, dt) {
  if (!state.aerostudio.isRendering) return null;
  
  const multi = getSpeedMultiplier(state);
  
  const progressGained = dt * multi;
  state.aerostudio.progress += progressGained / AEROSTUDIO.baseRenderRequired;
  
  if (state.aerostudio.progress >= 1) {
    state.aerostudio.progress = 1;
    return { done: true, projectName: state.aerostudio.currentProject };
  }
  
  return { done: false };
}

export function finishRender(state) {
  state.aerostudio.isRendering = false;
  state.aerostudio.currentProject = null;
  state.aerostudio.progress = 0;
}
