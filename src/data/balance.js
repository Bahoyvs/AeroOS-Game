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

  // Buddy-count milestones: every `milestoneEvery` buddies adds a flat
  // `milestoneBonus` to the AeroChat multiplier (additive, so 500 buddies is
  // ×2.6 rather than an exponential blow-up).
  milestoneEvery: 25,
  milestoneBonus: 0.08,
};

/**
 * Rotating status-message bonus events (AO-10, GDD 6).
 *
 * While AeroChat is open, a buddy occasionally posts a "hot" status. Clicking
 * it within the claim window applies the bonus below; ignoring it costs
 * nothing, so the mechanic rewards attention without punishing idling.
 */
export const STATUS_EVENT = {
  minIntervalSeconds: 40,
  maxIntervalSeconds: 85,
  claimWindowSeconds: 15,
  minBuddies: 1, // no events before the player has someone to hear from
  ambientRotationSeconds: 25, // how often ordinary statuses reshuffle
};

/**
 * Bonus table. `weight` is the relative roll chance; `kind` matches a buff kind
 * in src/core/buffs.js, except 'burst' which pays Buzz immediately instead.
 * Burst magnitude is measured in seconds of current production.
 */
export const STATUS_BONUSES = [
  {
    id: 'battlefront',
    status: 'is playing Star Wars Battlefront II',
    label: 'LAN night',
    kind: 'chat',
    magnitude: 0.25,
    durationSeconds: 60,
    weight: 30,
  },
  {
    id: 'soft-signals',
    status: 'is listening to SOFT SIGNALS',
    label: 'Good playlist',
    kind: 'global',
    magnitude: 0.15,
    durationSeconds: 90,
    weight: 25,
  },
  {
    id: 'serial-key',
    status: 'found a working serial key',
    label: 'Registered edition',
    kind: 'click',
    magnitude: 1.0,
    durationSeconds: 45,
    weight: 20,
  },
  {
    id: 'burning-cd',
    status: 'is burning you a mix CD',
    label: 'Mix CD',
    kind: 'burst',
    magnitude: 45, // seconds of production, paid instantly
    durationSeconds: 0,
    weight: 15,
  },
  {
    id: 'forwarding',
    status: 'forwarded this to 10 people',
    label: 'Chain mail',
    kind: 'chat',
    magnitude: 0.6,
    durationSeconds: 25,
    weight: 10,
  },
];

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

export const LEMONWIRE = {
  maxConcurrent: 3,
  gbPerSecond: 0.06, // a 4 GB ISO lands in a bit over a minute
  payoutSecondsPerGB: 45, // completion pays this many seconds of production per GB
  riskPayoutBonus: 1.5, // ...multiplied by (1 + risk * this), so danger pays
  minPayoutBuzz: 25, // an early download still feels like something
};

/**
 * The safety net (GDD 6): a virus must never ruin a run. Production is
 * multiplied by `productionFloor` and nothing stacks below it, LemonWire is
 * locked until cured, and nothing the player already earned is taken away.
 */
export const SECURITY = {
  productionFloor: 0.5,
  scanSeconds: 6,
  freeRescuesPerRun: 1,
};

export const AEROBURN = {
  maxDiscs: 5, // a shelf, not a warehouse — discs are a bridge, not a bank
};

/**
 * Prestige tension (AO-27, GDD 7). Heat is the visible face of bloat: it rises
 * with uptime and with what is running, and it is what makes the player *want*
 * to Format C: before the maths tells them to.
 */
export const HEAT = {
  idleC: 38, // a cold, freshly booted machine
  maxC: 94, // fans screaming, thermal throttle
  warnC: 70,
  criticalC: 85,
  perOpenApp: 2.5, // each running app adds a little baseline
  hitchChancePerSecond: 0.06, // at full bloat, how often the UI stutters
};

export const TUTORIAL = {
  // "Hardware stats remain hidden until the first system bottleneck" (GDD 7).
  // 0.9 is above AeroChat + RetroAmp on a stock machine (96/128 = 0.75), so the
  // reveal lands on the heavy playlist rather than on simply opening two apps.
  bottleneckRamRatio: 0.9,

  // A save at or past these numbers is not a first-time player.
  experiencedBuzz: 5000,
  experiencedBuddies: 10,
};

export const SAVE = {
  key: 'aeroos.save.v1',
  autosaveMs: 15000,
};
