/**
 * Single source of truth for tuning numbers. Designers should be able to change
 * the feel of the game from this file alone — no formulas live here, only the
 * constants those formulas read (formulas are in src/core/economy.js).
 */

export const TICK_MS = 100; // simulation step; render is decoupled (rAF)

/**
 * The building model (GDD v2 §2). One cost curve and one milestone table for all
 * twelve — the per-building numbers (base cost, base production, unlock) live in
 * src/data/buildings.js, because those are a roster, and these are a rule.
 */
export const BUILDING = {
  /**
   * Geometric price curve, `unitCost = ceil(baseCost × costGrowth^owned)`.
   *
   * 1.15 is AeroChat's proven rate, kept for every building on purpose. It is
   * also the reason no bulk-buy button can break the economy: 100 units costs
   * ~5,500× the first one, so "buy Max" is a convenience, never an exploit.
   */
  costGrowth: 1.15,

  /**
   * Milestone multiplier — a step function of units *owned*, not a purchase
   * (GDD §2.2). The player never opens a shop for this; crossing a threshold
   * is a celebration, not a decision.
   *
   * Doubling per tier, and the same table for every building: the shape a
   * player learns on AeroChat at 25 buddies is the shape they can still read on
   * The Hive at 500 offerings. `at` must stay ascending — `milestoneMultiplier`
   * walks it and takes the last one reached.
   */
  milestones: [
    { at: 0, multiplier: 1 },
    { at: 25, multiplier: 2 },
    { at: 50, multiplier: 4 },
    { at: 100, multiplier: 8 },
    { at: 250, multiplier: 16 },
    { at: 500, multiplier: 32 },
  ],

  /**
   * A rail, not a design goal. The top milestone tier is "500+", so there is no
   * balance reason to stop — but an unbounded counter in a save is how a bulk
   * buy with a bad argument becomes an unreadable number and a 1 MB write. Well
   * clear of the last threshold.
   */
  maxUnits: 10_000,
};

/**
 * Legacy Level — the prestige layer (GDD §2.6).
 *
 * Worth `perLevel` per level, and computed as the sum of **two** terms, because
 * one curve cannot serve a twenty-order-of-magnitude economy:
 *
 *   level = earlyLevels(allTimeBuzz) + floor(cbrt(allTimeBuzz / divisor))
 *
 * **The late term** is the mechanism GDD §2.6 asks for, taken from Cookie
 * Clicker: reward linear in level, cost cubic, so the gap between levels widens
 * by itself and prestige never needs a hand-tuned schedule. `divisor` is sized
 * off the endgame, the one end of the curve that cannot be argued with — twelve
 * buildings at the top milestone make ~8e14 Buzz/sec, so finishing the content
 * means ~1e20-1e21 all-time Buzz, which is level 215-464.
 *
 * A first simulation pass (400k ticks of optimal buying) ran this term alone at
 * a divisor of 50,000 and reached **level 183,799 — a ×1,839 multiplier larger
 * than every other factor in the chain combined**. Hence 1e13.
 *
 * **The early term** is what stops that fix costing the first ten prestiges.
 * Sized for the endgame, the cubic term alone does not pay its first level
 * until 1e13 all-time Buzz — deep in phase 3 — so every wipe before that would
 * report "Legacy Level 0" on a screen whose entire job is announcing the level.
 * The early term is logarithmic instead of cubic, precisely because the span it
 * has to cover (5e3 -> 5e12) is nine orders of magnitude and a cubic crosses
 * three: each early level costs `earlyRatio`× the one before.
 *
 * The two are tuned to hand over seamlessly. `earlyAt` is
 * `PRESTIGE.minLifetimeBuzz`, so **the first Format C: a player ever presses
 * grants Legacy Level 1**; the tenth and last early level lands at 5e12, and
 * the cubic term pays its first at 1e13. No dead zone between them, and the
 * permanent +10 the early term contributes is a rounding error against an
 * endgame of +215%.
 *
 * Invariant, asserted by tests/legacy.test.js: the early term must cap at or
 * below where the late term starts paying, or the curve stalls in the gap.
 */
export const LEGACY = {
  perLevel: 0.01,

  /** The late, endgame term. */
  divisor: 1e13,

  /** The early term: level 1 at `earlyAt`, then ×`earlyRatio` per level. */
  earlyAt: 5_000,
  earlyRatio: 10,
  earlyLevels: 10,
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
    status: 'is playing Crysis on max settings',
    label: 'LAN Party',
    kind: 'chat',
    magnitude: 0.25,
    durationSeconds: 60,
    weight: 30,
  },
  {
    id: 'soft-signals',
    status: 'is listening to AERO AMBIENCE',
    label: 'Aero Vibes',
    kind: 'global',
    magnitude: 0.15,
    durationSeconds: 90,
    weight: 25,
  },
  {
    id: 'serial-key',
    status: 'found a working keygen on LimeWire',
    label: 'PRO Version Unlocked',
    kind: 'click',
    magnitude: 1.0,
    durationSeconds: 45,
    weight: 20,
  },
  {
    id: 'burning-cd',
    status: 'is burning a mix CD with Nero',
    label: 'Nero Mix CD',
    kind: 'burst',
    magnitude: 45, // seconds of production, paid instantly
    durationSeconds: 0,
    weight: 15,
  },
  {
    id: 'forwarding',
    status: 'forwarded a cursed chain email',
    label: 'Chain Mail Panic',
    kind: 'chat',
    magnitude: 0.6,
    durationSeconds: 25,
    weight: 10,
  },
];

export const CLICK = {
  baseBuzz: 1, // Nudge button payout before CPU click power

  /**
   * The Nudge streak.
   *
   * An idle game's first thirty seconds are spent on one button, and until this
   * existed clicking it fast felt exactly like clicking it slowly — the only
   * *active* verb in the game had no feedback of its own. Consecutive clicks
   * inside `windowSeconds` build a streak worth `perClick` each, capped at
   * `maxBonus`, and the streak drops the moment the player stops.
   *
   * It is deliberately small and free to ignore: it is a reason to keep
   * clicking through the first minute, not a skill gate. The bonus starts on
   * the *second* click of a streak, so a single considered press pays exactly
   * what the button says it does.
   *
   * Wall clock, not simulation time — it measures the cadence of a real hand.
   */
  streak: {
    windowSeconds: 1.6,
    perClick: 0.05,
    maxBonus: 1, // +100% at 21 clicks in a row
    maxCount: 40, // rail: the counter cannot grow unbounded in a save
  },
};

/**
 * Nudge "juice" — the click/streak feedback layer (layered click sound, streak
 * pitch, sidechain ducking, glass flare, bubbles, ripple, gadget micro-shake).
 *
 * `audioEnabled`/`visualEnabled` are independent switches, same pattern as
 * `ADS.enabled` below: either half can ship, be A/B'd, or be pulled back
 * without touching the other.
 */
export const NUDGE_JUICE = {
  audioEnabled: true,
  visualEnabled: true,

  /** Pitch grows this fraction per streak click past the first, then rails. */
  pitchStepPerClick: 0.045,
  pitchCeiling: 1.5,

  /** Sidechain ducking on the music bus when a click lands. */
  duckDepth: 0.5, // fraction of the current music gain kept at the dip
  duckAttackSeconds: 0.05,
  duckReleaseSeconds: 0.15,

  /** Bubble particles per click, and the hard cap across all of them at once. */
  bubbleCount: 10,
  maxConcurrentParticles: 20,

  /** Streak count at which the gadget starts micro-shaking. */
  shakeStreakThreshold: 10,
};

export const PRESTIGE = {
  /**
   * Dollars awarded on Format C: = scale * sqrt(lifetimeBuzz / divisor)
   *
   * `divisor` is the *stock* machine's divisor, not a constant of the game. The
   * Mainboard track (src/data/hardware.js) divides it down as the player buys
   * into it — see `econ.prestigeDivisor()` — which is what unsticks the
   * mid-game: the square root means every doubling of the payout costs four
   * times the Buzz, so at some point the only way to move is to make the same
   * lifetime Buzz worth more.
   */
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
 * The Buffer Overflow crisis (GDD v2 §7) — the "Dead Internet" event.
 *
 * What it measures is not how *far* the player has got but what shape their
 * machine is: `feedRatio` is the units owned across the five automated feed
 * buildings against the three the player started with (the lists live in
 * src/data/buildings.js, because that split is a property of the roster).
 * Someone who keeps AeroChat, RetroAmp and ChainMail stocked never sees any of
 * this. Someone who rushes the algorithm and lets the early apps rot does, and
 * the remedy is the cheapest purchase in the game.
 *
 * Everything below is a *modifier on systems that already exist* — buffs, the
 * global multiplier chain, and bloat. Phase 6 adds no new mechanic to play,
 * which is why the whole event fits in one balance block and one core module.
 */
export const OVERFLOW = {
  /**
   * The master switch, same purpose as `ADS.enabled`: this is the one system in
   * the game that deliberately makes the desktop unpleasant, on a portal where
   * sessions are half an hour. If it reads badly in the wild it comes out in one
   * edit, and nothing else changes shape.
   */
  enabled: true,

  /**
   * The ratio is sampled on simulation time and only escalates when it has held
   * across `dwellSamples` consecutive samples — a minute of sustained pressure,
   * not one bulk buy. Without the dwell, buying 100 units of The Hive would flip
   * straight to a fullscreen crisis and the next purchase would flip it back.
   */
  sampleSeconds: 15,
  dwellSamples: 4,
  historyLength: 8, // two minutes of ratio, for the graph the UI can draw

  /**
   * The phases, ascending. Provisional like every number in the redesign —
   * GDD §14.1 defers to simulation, and this one wants a real playtest rather
   * than a tick loop, because what it is measuring is a habit.
   */
  phases: [
    { phase: 1, at: 1.5 }, // cosmetic: the wallpaper starts to tear
    { phase: 2, at: 3 }, //   economic: ghost notifications
    { phase: 3, at: 6 }, //   crisis: the machine asks the question
  ],

  /**
   * Ghost notifications. Balloons from apps that are not open, about things that
   * did not happen. Each one live costs `penaltyEach` of production — folded
   * into the global multiplier chain, so all twelve windows report it through
   * `getProductionBreakdown` without a single one of them knowing it exists.
   *
   * Dismissing one pays a small burst. Deliberately small: a tax the player can
   * only avoid by watching for balloons is the chore this phase was cut of
   * mini-games to avoid. Ghosts also expire on their own.
   */
  ghost: {
    spawnSecondsMin: 25,
    spawnSecondsMax: 55,
    frenzyFactor: 0.5, // at phase 3 they arrive twice as fast
    lifetimeSeconds: 45,
    penaltyEach: 0.04,
    maxLive: 5, // worst case ×0.815 — noticeable, never ruinous
    dismissSeconds: 10, // burst paid for silencing one, in seconds of production
  },

  /**
   * The binary choice, and the reason it is a choice at all.
   *
   * Doomscroll is the better play for the next three minutes and the worse one
   * for the rest of the run: it pays ×3 and dumps a quarter of a bloat bar onto
   * the machine, permanently, every time it is taken. Log Off costs half of two
   * minutes and buys ten minutes of quiet with nothing left behind.
   *
   * Both are ordinary modifiers on systems that were already here — an entry in
   * `state.buffs` and a number added to `state.bloat`.
   */
  logOff: {
    buffId: 'overflow-logoff',
    magnitude: -0.5,
    durationSeconds: 120,
    calmSeconds: 600, // the phase is held at `calmPhase` or below for this long
    calmPhase: 1,
  },
  doomscroll: {
    buffId: 'overflow-doomscroll',
    magnitude: 2, // ×3
    durationSeconds: 180,
    bloat: 0.25, // and this is what it actually costs
  },

  /**
   * Airplane Mode — the Dollar-priced opt-out (GDD §7.3). It caps the event at
   * its cosmetic phase forever, and taxes the five feed buildings for the
   * privilege. A player who wants the game to stop being unpleasant can buy
   * their way out; it costs them yield, which is the honest version of the
   * trade. Priced above Auto-Defrag because it is bought later and wanted more.
   */
  airplane: {
    cost: 60,
    capPhase: 1,
    feedTax: 0.05,
  },
};

/**
 * Auto-Defrag (see src/core/defrag.js for the why).
 *
 * A scheduled job, not a stat. It idles until bloat is genuinely bad, then runs
 * a visible pass that costs production while it works — the point is to stop a
 * machine seizing up, not to delete the pressure loop that makes Format C: feel
 * earned. Bought with Dollars, so it is meta-progression and outlives the wipe.
 */
export const DEFRAG = {
  cost: 25, // Dollars. Between the second and third Mainboard tier.

  /**
   * It engages at BLOAT.criticalAt on purpose: the player has already seen the
   * meter turn red, the desktop desaturate and the fans come up. Defragging
   * before that would mean they never learn what bloat is.
   */
  startAt: 0.85,
  stopAt: 0,

  /**
   * 0.85 -> 0 in about twelve seconds.
   *
   * The number this is measured against changed with the redesign. It used to
   * be "two orders of magnitude faster than a busy desktop dirties the disk",
   * where a busy desktop was seven windows and one building capped at 500
   * units — about 0.0004/s. Twelve buildings at their top milestone tier, with
   * every window open, dirty at **0.0067/s**: seventeen times faster, because
   * both terms of `bloatGain` grew with the roster.
   *
   * At the old 0.01 the margin was 1.5x. A pass would still technically finish,
   * but only just — and the failure mode is nasty and quiet: the machine sits
   * pinned near the critical threshold with a permanent 5% tax on it, which is
   * strictly worse than never buying the utility. tests/defrag.test.js asserts
   * a 10x margin against a *fully built* machine now, not a hand-picked one, so
   * this cannot rot again when phase 4 adds the last three buildings.
   */
  clearPerSecond: 0.07,

  /** What the pass costs while it runs. Small, visible, and never a surprise. */
  productionTax: 0.05,

  /**
   * The offline half: an absence may push bloat this far and no further. Half a
   * bar is still a real penalty for being away — production is down 25% — but
   * it is a machine the player can come back to and keep playing, rather than
   * one whose only remaining move is a Format C: they had not planned.
   */
  offlineCap: 0.5,
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
/**
 * LemonWire's swarm (building #5).
 *
 * These used to price a mechanic — hand-filled seed slots paying their own
 * income. They now price a *display*: which files the swarm is sharing and how
 * loudly, derived from the unit count (src/core/lemonwire.js). Nothing here
 * touches production any more; the milestone table does that, like every other
 * building.
 */
export const LEMONWIRE = {


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
   * The connection ladder. No longer bought — the tier is read off LemonWire's
   * milestone index, so the five green bars light up as the swarm grows
   * (GDD §4). `cost` is kept only because the labels read better with it gone
   * from the UI than from the data, and `multiplier` is now flavour.
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

};

/**
 * AeroSweeper (Day 7) — the one *active* mechanic in an idle game.
 *
 * Everything else in AeroOS pays for a decision and then runs itself. This pays
 * for nerve. Every safe square banks a little more click multiplier, and the
 * multiplier is worthless unless the player then goes and clicks — so the
 * reward for playing well is a reason to play *more*, not a lump of Buzz.
 *
 * The decision the board actually asks is when to stop. Cash out and the combo
 * is yours; keep going and it grows; hit a mine and half of it is gone. Half,
 * not four fifths: the point of the round is to tempt someone into one more
 * square, and a penalty that erases the session teaches them to stop early
 * instead.
 *
 * Tokens are the pacing. They refill on the wall clock (a token earned
 * overnight is waiting in the morning, like offline earnings), and Buzz buys
 * one, so the board is never a wall — just a queue.
 */
export const SWEEPER = {
  maxTokens: 3,
  tokensPerRefill: 1,
  refillSeconds: 7200, // one token every two hours

  // Buying a token is priced in seconds of current production, so it stays
  // meaningful at every stage. The floor covers a machine producing nothing.
  buyTokenSeconds: 900,
  minTokenCost: 1000,

  // The classic beginner board. 71 safe squares, so a perfect sweep is ×8.1.
  rows: 9,
  cols: 9,
  mines: 10,

  /**
   * The combo. It rides on the existing 'click' buff kind, so the Nudge button,
   * the rate breakdown and the buff list all pick it up without a second
   * multiplier system — and it expires on the wall clock like every other buff.
   */
  comboBuffId: 'sweeper-combo',
  perTile: 0.1,
  // A rail rather than a limit: the 9×9 board tops out well under this, but a
  // bigger board must not be able to hand out an unbounded multiplier.
  maxCombo: 12,
  cashOutSeconds: 180,

  /** What survives a mine. Forgiving on purpose — see the note above. */
  mineFraction: 0.5,
  /** Clearing all 71 squares is rare enough to be worth more than the sum. */
  clearBonus: 1.5,

  /**
   * Seconds of current production per safe square, paid on cash-out. A round
   * that ends badly still pays something, or a spent token is a wasted hour —
   * but deliberately less than the 900 seconds a bought token costs, so the
   * board is never a Buzz press. The multiplier is the prize.
   */
  buzzSecondsPerTile: 25,
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

/**
 * Ads (GDD 8, Day 8) — the numbers behind every placement in the game.
 *
 * Three rules shape this table, all of them from the portal's own monetization
 * guides, and all of them things the SDK cannot do for us:
 *
 * 1. **Rewards scale with the run.** Everything here is priced in *seconds of
 *    current production* or as an ordinary buff, never a flat lump of Buzz — a
 *    fixed "+500" is a jackpot at ten buddies and an insult at five hundred, and
 *    a button nobody presses earns nothing.
 * 2. **The economy is protected by caps, not by hiding the button.** Each
 *    placement has a daily allowance and a cooldown, and the daily gift pays
 *    less each time it is taken. A player who wants to watch six ads may; they
 *    just cannot watch sixty and skip the game.
 * 3. **Interstitials are paced by the SDK, not by us.** CrazyGames already
 *    enforces one midgame ad per three minutes with its own safeguards around
 *    game start and rewarded ads, and the guide is explicit that games should
 *    *not* add a second cooldown on top. What is left for us is the one thing
 *    the portal cannot know: whether this player has learned the game yet.
 */
export const ADS = {
  /**
   * The master switch for the whole ad system.
   *
   * It is `false` for the basic-launch submission, where the SDK's ad calls are
   * commented out in `src/ui/ads.js`. That is a business decision, but it has a
   * design consequence that must not be left to each call site: while ads
   * cannot run, **no rewarded button may render anywhere**. Two offers on the
   * gadget that answer every press with "ads are disabled" is worse than no
   * offers at all, and it is the first thing a new player touches.
   *
   * The same flag is what keeps "nothing is gated behind an ad" true: every
   * rewarded offer has an always-available path that does not need a video, so
   * switching this back to `true` (alongside uncommenting the SDK calls) adds
   * offers rather than unlocking content, with no other edits.
   */
  enabled: false,

  midgame: {
    /**
     * Day 1 retention protection. The first minutes decide whether anybody
     * comes back, so no interstitial fires until the player has finished
     * onboarding *and* spent real time in the game — in this session and
     * across the save.
     */
    minSessionSeconds: 300,
    minPlaytimeSeconds: 900,
    requireTutorialDone: true,

    /**
     * The warning. An idle game has no level boundary to hide an ad behind, so
     * the break announces itself and swallows clicks while it counts down —
     * otherwise it lands mid-Nudge and reads as an accidental-click trap.
     */
    countdownSeconds: 3,

    /** Never stack a break onto a break the player already chose to watch. */
    afterRewardedSeconds: 90,
  },

  /**
   * Rewarded placements. `perDay` is the daily allowance (UTC days, so it
   * rolls over while the tab is closed like every other wall-clock timer) and
   * `cooldownSeconds` is the pause between two watches of the *same* offer.
   */
  rewarded: {
    /** The clicker-guide staple: a tap multiplier the player switches on. */
    overclock: {
      perDay: 8,
      cooldownSeconds: 900,
      magnitude: 1, // +100% to everything
      durationSeconds: 600,
      buffId: 'ad-overclock',
    },

    /**
     * The daily gift, with the guide's diminishing returns: half, then a
     * quarter. Three watches are worth ~52 minutes of production in total, and
     * the fourth is worth coming back tomorrow for.
     */
    gift: {
      perDay: 3,
      cooldownSeconds: 1800,
      seconds: [1800, 900, 450],
      /**
       * A floor, for the same reason `SWEEPER.minTokenCost` has one: production
       * is *zero* on a freshly formatted machine, and a button offering "+0
       * Buzz" is worse than no button at all — it teaches the player that the
       * offers in this game are worthless.
       */
      minBuzz: 500,
    },

    /** Out of resources — the board is a queue, and this is the queue-jump. */
    sweeperToken: {
      perDay: 4,
      cooldownSeconds: 300,
    },


    /**
     * Loss aversion, at the one moment the player is about to hand over a run:
     * +50% on the Dollars a Format C: is about to bank. Paid as a *bonus*
     * rather than an advance — see resetForPrestige — so it cannot quietly
     * borrow from the next prestige.
     */
    formatBoost: {
      perDay: 6,
      cooldownSeconds: 0,
      multiplier: 1.5,
    },

    /** The welcome-back multiplier (GDD 8's "Internet Cafe Bonus"). */
    offlineDouble: {
      perDay: 6,
      cooldownSeconds: 0,
      multiplier: 2,
    },
  },

  /**
   * Banners. Placed on shop/menu surfaces only, never over the desktop, and
   * re-requested no more often than the portal's refresh cooldown allows — a
   * slot that is opened and closed five times in a minute asks for one ad.
   */
  banner: {
    refreshSeconds: 61,
    minWidth: 300,
    minHeight: 100,
  },
};

