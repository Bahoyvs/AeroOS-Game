/**
 * Single source of truth for tuning numbers. Designers should be able to change
 * the feel of the game from this file alone — no formulas live here, only the
 * constants those formulas read (formulas are in src/core/economy.js).
 */

export const TICK_MS = 100; // simulation step; render is decoupled (rAF)

export const CHAT_BOT = {
  baseCost: 10, // Buzz for the first bot
  costGrowth: 1.15, // geometric price curve, standard idle pacing
  baseRate: 0.5, // Buzz/sec per bot before multipliers
  maxPerRun: 500,
};

export const CLICK = {
  baseBuzz: 1, // Nudge button payout before CPU click power
};

export const PRESTIGE = {
  // Dollars awarded on Format C: = scale * sqrt(lifetimeBuzz / divisor)
  scale: 1,
  divisor: 1000,
  minLifetimeBuzz: 5000, // below this, Format C: is refused
};

export const BLOAT = {
  // Bloat rises with installed software + uptime and drives the "system feels
  // slow, please prestige" pressure loop (GDD 7). 1.0 = fully bloated.
  perOpenAppPerMinute: 0.004,
  perBotPerMinute: 0.00006,
  productionPenaltyAtFull: 0.5, // at bloat 1.0 production is halved
  warnAt: 0.6,
  criticalAt: 0.85,
};

export const OFFLINE = {
  // Offline Buzz is deliberately worth less than being at the keyboard.
  efficiency: 0.5,
  minSeconds: 60, // ignore alt-tabs shorter than this
};

export const SAVE = {
  key: 'aeroos.save.v1',
  autosaveMs: 15000,
};
