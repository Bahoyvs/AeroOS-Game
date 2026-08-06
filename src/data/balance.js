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

/**
 * LemonWire is a *seeding* app, not a download manager.
 *
 * A file put in a seed slot pays Buzz every second it is shared — no progress
 * bar to babysit, no completion event to wait for. What the player actually
 * decides is which files fill their slots, and that is a three-way trade:
 * bigger files eat the disk, rarer files (few seeders) pay more because the
 * swarm needs *them*, and riskier files pay more still while attracting the
 * threats Shield99 turns into loot.
 */
export const LEMONWIRE = {
  baseSeedSlots: 3,
  hddTiersPerSlot: 2, // every other HDD tier unlocks another slot
  maxSeedSlots: 5,

  /**
   * Per-seed income = (`flatBuzzPerSecond` + buddy rate × `shareOfChatRate`)
   * × the file's weight × bandwidth.
   *
   * The flat term is what makes the first seed feel like something on a fresh
   * machine; the share term is what keeps a seed relevant at 300 buddies. Both
   * are needed — a purely flat rate is dead weight by mid-game, and a purely
   * proportional one pays nothing when the player first installs the app.
   */
  flatBuzzPerSecond: 0.6,
  shareOfChatRate: 0.03,

  // File weight: size and risk both pay, and rarity pays most.
  weightPerGB: 0.35,
  riskPayoutBonus: 1.5,

  /**
   * Rarity premium. A file with 6 seeders needs *you*; one with 302 does not,
   * and a swarm that big around a 3 MB "speed boost" is bots anyway. Without
   * this the fat popular files would dominate every slot and the list would
   * have one right answer.
   */
  seedersPivot: 20,
  minDemandModifier: 0.5,
  maxDemandModifier: 2,

  /**
   * The connection. Bought with Buzz, kept for the run, and the only thing that
   * multiplies *every* slot at once — which is what makes it worth saving for
   * rather than filling one more slot.
   */
  connections: [
    { id: 'dialup', label: '56k Dial-up', multiplier: 1, cost: 0 },
    { id: 'isdn', label: 'ISDN 128k', multiplier: 1.6, cost: 6000 },
    { id: 'adsl', label: 'ADSL 1 Mbit', multiplier: 2.4, cost: 40000 },
    { id: 'fibre', label: 'Fibre 10 Mbit', multiplier: 3.5, cost: 250000 },
  ],

  // Purely cosmetic: the KB/s counter next to a slot. Period-accurate rather
  // than generous — a 56k line uploading at 12 KB/s is the joke.
  uploadKBpsPerWeight: 6,

  // Stopping a seed only moves the file to the trash; the space stays used
  // until this much simulation time has passed (AO: Trash Bin).
  trashSeconds: 300,
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

/**
 * Shield99's quarantine (the Day 5 refactor).
 *
 * Seeding attracts threats. With Shield99 installed they are *caught* and land
 * in quarantine as sealed files — the surprise box. Without it they run the
 * old safety net instead (free rescue, then a capped infection), which is what
 * keeps risky seeding a decision rather than free money.
 *
 * Extracting a quarantined file is worth ~15 minutes of the player's current
 * production, so it stays meaningful at every stage. A rewarded ad pays it in
 * full; `manualRewardFraction` is the always-available fallback, because a
 * player with an ad blocker must never be locked out of a mechanic.
 */
export const SHIELD99 = {
  minSpawnSeconds: 180,
  maxSpawnSeconds: 300,

  // Total risk across the seed slots shortens the wait, up to this much.
  riskUrgency: 1.5,
  maxUrgency: 3,

  maxQuarantine: 5, // a backlog, not a savings account
  adCooldownSeconds: 90,
  manualRewardFraction: 0.25,

  /**
   * The loot table. `weight` is the relative roll chance; the reward kinds map
   * onto systems that already exist — a Buzz burst measured in seconds of
   * production, a timed global buff, and a shove to the Aero Studio render.
   *
   * Names are deliberately silly period pastiche: this is a toy antivirus in a
   * toy OS, and nothing here should read as a real security warning.
   */
  threats: [
    {
      id: 'adware',
      name: 'Adware.Win32.Popupz',
      tier: 'Common',
      weight: 60,
      blurb: 'Seventeen toolbars in a trenchcoat. Somebody was paid per install.',
      reward: { kind: 'buzz', seconds: 900 },
    },
    {
      id: 'worm',
      name: 'Worm.LoveLetter.2005',
      tier: 'Rare',
      weight: 30,
      blurb: 'Mails itself to your whole buddy list. They all reply.',
      reward: { kind: 'buff', magnitude: 1, durationSeconds: 600 },
    },
    {
      id: 'trojan',
      name: 'Trojan.RenderFarm',
      tier: 'Epic',
      weight: 10,
      blurb: 'Stole your GPU cycles. Shield99 is stealing them back.',
      // No render running? Pay the equivalent in Buzz instead of nothing.
      reward: { kind: 'render', fraction: 0.25, fallbackSeconds: 1200 },
    },
  ],
};

export const AEROBURN = {
  maxDiscs: 5, // a shelf, not a warehouse — discs are a bridge, not a bank
};

/**
 * Galactic Pinball 3D (Day 7) — the one *active* mechanic in an idle game.
 *
 * Everything else in AeroOS pays for a decision and then runs itself. This pays
 * for aim: a ball kept alive off the bumpers turns into a click multiplier, and
 * the multiplier is worthless unless the player then goes and clicks. That is
 * the whole shape of it — the reward for playing well is a reason to play
 * *more*, not a lump of Buzz.
 *
 * Tokens are the pacing. They refill on the wall clock (a token earned
 * overnight is waiting in the morning, like offline earnings), and Buzz buys
 * one at the price of ten minutes of production — so the table is never a wall,
 * just a queue.
 */
export const PINBALL = {
  maxTokens: 3,
  tokensPerRefill: 3,
  refillSeconds: 3600,

  // Buying a token is priced in seconds of current production, so it stays
  // meaningful at every stage. The floor covers a machine producing nothing.
  buyTokenSeconds: 600,
  minTokenCost: 750,

  /**
   * The combo. It rides on the existing 'click' buff kind, so the Nudge button,
   * the rate breakdown and the buff list all pick it up without a second
   * multiplier system — and it expires on the wall clock like every other buff.
   */
  comboBuffId: 'pinball-combo',
  comboPerBumper: 0.4,
  maxCombo: 14, // +1400%: a great ball, not a broken one
  comboSecondsBase: 18,
  comboSecondsPerBumper: 1.4,
  maxComboSeconds: 90,

  // The consolation prize, in seconds of current production per bumper — a
  // terrible ball still pays something, or a wasted token is a wasted hour.
  buzzSecondsPerBumper: 5,
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

export const AEROSTUDIO = {
  // Payout multiplier: A finished render pays this many seconds of current production
  payoutSeconds: 14400, // 4 hours

  // A completely un-upgraded render at standard 1x production takes roughly this long in seconds
  // (Base speed is scaled by current production)
  baseRenderRequired: 7200,

  upgrades: {
    sidechainCompression: {
      baseCost: 75000,
      costGrowth: 1.5,
      speedBonus: 0.25,
    },
    arpeggiator: {
      baseCost: 250000,
      costGrowth: 1.8,
      speedBonus: 0.50,
    },
    environmentalFx: {
      baseCost: 1000000,
      costGrowth: 2.2,
      speedBonus: 1.0,
    }
  }
};
