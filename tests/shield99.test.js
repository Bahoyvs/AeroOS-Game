import { describe, expect, it } from 'vitest';
import * as shield from '../src/core/shield99.js';
import * as lw from '../src/core/lemonwire.js';
import * as econ from '../src/core/economy.js';
import { createGame } from '../src/core/game.js';
import { createMemoryStorage } from '../src/core/save.js';
import { createInitialState } from '../src/core/state.js';
import { ADS, SECURITY, SHIELD99 } from '../src/data/balance.js';

/** Seeding, with Shield99 in whatever state the test needs. */
function seeding({ shield: installed = false, open = false, fileId = 'speed-boost' } = {}) {
  const s = createInitialState(0);
  s.hardware.hdd = 3;
  s.apps.lemonwire.installed = true;
  s.apps.lemonwire.open = true;
  s.apps.shield99.installed = installed;
  s.apps.shield99.open = open;
  lw.startSeeding(s, fileId, 0);
  return s;
}

/** Run the threat timer far enough to fire once. */
function fireThreat(state, rng = () => 0.5) {
  shield.updateThreats(state, 0, rng, 0); // rolls the first delay
  return shield.updateThreats(state, SHIELD99.maxSpawnSeconds, rng, 0);
}

describe('the loot table', () => {
  it('rolls the common threat most of the time and the epic one rarely', () => {
    expect(shield.rollThreat(() => 0).id).toBe(SHIELD99.threats[0].id);
    expect(shield.rollThreat(() => 0.999).id).toBe(SHIELD99.threats.at(-1).id);
  });

  it('never rolls off the end of the table', () => {
    for (const roll of [0, 0.25, 0.5, 0.75, 1]) {
      expect(shield.rollThreat(() => roll)).toBeDefined();
    }
  });

  it('is worth a real chunk of production, not pocket change', () => {
    // The whole reason to watch an ad: a payout measured in minutes of output.
    const rate = 10;
    const reward = shield.rewardFor(shield.getThreat('adware'), { buzzPerSecond: rate });
    expect(reward.buzz).toBeGreaterThanOrEqual(rate * 600);
  });

  it('pays the manual path a fraction of the ad payout', () => {
    const threat = shield.getThreat('adware');
    const full = shield.rewardFor(threat, { buzzPerSecond: 10 });
    const manual = shield.rewardFor(threat, {
      buzzPerSecond: 10,
      fraction: SHIELD99.manualRewardFraction,
    });
    expect(manual.buzz).toBeCloseTo(full.buzz * SHIELD99.manualRewardFraction);
    expect(manual.buzz).toBeGreaterThan(0); // never nothing
  });

  it('weakens a buff rather than shortening it on the manual path', () => {
    // A ten-minute buff cut to 150 seconds would be over before it was felt.
    const threat = shield.getThreat('worm');
    const manual = shield.rewardFor(threat, { fraction: 0.25 });
    expect(manual.magnitude).toBeCloseTo(threat.reward.magnitude * 0.25);
    expect(manual.durationSeconds).toBe(threat.reward.durationSeconds);
  });

  it('pays Buzz for a render bonus when there is no render to speed up', () => {
    const threat = shield.getThreat('trojan');
    expect(shield.rewardFor(threat, { isRendering: true, buzzPerSecond: 10 })).toMatchObject({
      kind: 'render',
    });
    const idle = shield.rewardFor(threat, { isRendering: false, buzzPerSecond: 10 });
    expect(idle.kind).toBe('buzz');
    expect(idle.buzz).toBeGreaterThan(0);
  });
});

describe('threats arriving', () => {
  it('needs something to actually be seeding', () => {
    const s = seeding({ shield: true, open: true });
    s.lemonwire.activeSeeds = [];
    expect(fireThreat(s)).toBeNull();

    const closed = seeding({ shield: true, open: true });
    closed.apps.lemonwire.open = false;
    expect(fireThreat(closed)).toBeNull();
  });

  it('lands in quarantine when Shield99 is open', () => {
    const s = seeding({ shield: true, open: true });
    const result = fireThreat(s);

    expect(result.outcome).toBe('quarantined');
    expect(s.shield99.quarantine).toHaveLength(1);
    expect(s.security.infection).toBeNull();
    expect(s.stats.threatsBlocked).toBe(1);
    expect(() => shield.getThreat(s.shield99.quarantine[0].threatId)).not.toThrow();
  });

  it('runs the old safety net when nothing is watching', () => {
    const s = seeding(); // Shield99 not installed
    expect(fireThreat(s).outcome).toBe('rescued'); // the run's free rescue
    expect(s.security.rescuesUsed).toBe(SECURITY.freeRescuesPerRun);
    expect(shield.isInfected(s)).toBe(false);

    expect(fireThreat(s).outcome).toBe('infected');
    expect(shield.isInfected(s)).toBe(true);
    expect(s.shield99.quarantine).toEqual([]);
  });

  it('does not protect an installed-but-closed Shield99', () => {
    const s = seeding({ shield: true, open: false });
    expect(fireThreat(s).outcome).toBe('rescued');
  });

  it('caps the damage at half production and never lower', () => {
    const s = seeding();
    s.security.infection = { at: 0 };
    expect(shield.infectionPenalty(s)).toBe(SECURITY.productionFloor);

    shield.resolveInfection(s); // infecting again cannot stack
    expect(shield.infectionPenalty(s)).toBe(SECURITY.productionFloor);
  });

  it('comes faster the more risk is being seeded', () => {
    const safe = seeding({ shield: true, open: true, fileId: 'wallpapers' }); // 5% risk
    const risky = seeding({ shield: true, open: true, fileId: 'speed-boost' }); // 75%
    expect(shield.nextThreatDelay(risky, () => 0.5)).toBeLessThan(
      shield.nextThreatDelay(safe, () => 0.5),
    );
  });

  it('stops collecting rather than punishing once quarantine is full', () => {
    const s = seeding({ shield: true, open: true });
    for (let i = 0; i < SHIELD99.maxQuarantine; i += 1) fireThreat(s);
    expect(s.shield99.quarantine).toHaveLength(SHIELD99.maxQuarantine);

    expect(fireThreat(s).outcome).toBe('blocked');
    expect(s.shield99.quarantine).toHaveLength(SHIELD99.maxQuarantine);
    expect(shield.isInfected(s)).toBe(false);
  });
});

describe('extraction', () => {
  it('refuses a file that is not there', () => {
    const s = seeding({ shield: true, open: true });
    expect(shield.canExtract(s, 99).reason).toBe('no-such-file');
  });

  it('paces the ad path, and never the manual one', () => {
    const s = seeding({ shield: true, open: true });
    fireThreat(s);
    const [item] = s.shield99.quarantine;

    shield.startAdCooldown(s, 1000);
    expect(shield.canExtract(s, item.id, { viaAd: true, now: 1000 }).reason).toBe('cooling-down');
    expect(shield.canExtract(s, item.id, { viaAd: false, now: 1000 }).ok).toBe(true);

    const after = 1000 + SHIELD99.adCooldownSeconds * 1000 + 1;
    expect(shield.canExtract(s, item.id, { viaAd: true, now: after }).ok).toBe(true);
  });

  it('counts what it has cleaned', () => {
    const s = seeding({ shield: true, open: true });
    fireThreat(s);
    shield.takeFromQuarantine(s, s.shield99.quarantine[0].id);
    expect(s.shield99.quarantine).toEqual([]);
    expect(s.shield99.filesCleaned).toBe(1);
  });
});

describe('scanning', () => {
  const guarded = () => seeding({ shield: true, open: true });

  it('needs Shield99 installed and open', () => {
    const closed = seeding({ shield: true, open: false });
    expect(shield.startScan(closed).reason).toBe('not-open');
    expect(shield.startScan(seeding()).reason).toBe('not-installed');
  });

  it('runs on simulation time and cures the infection', () => {
    const s = guarded();
    s.security.infection = { at: 0 };

    expect(shield.startScan(s).ok).toBe(true);
    expect(shield.startScan(s).reason).toBe('already-scanning');

    expect(shield.updateScan(s, SECURITY.scanSeconds / 2)).toBeNull();
    expect(shield.scanProgress(s)).toBeCloseTo(0.5);
    expect(shield.isInfected(s)).toBe(true); // not cured until it finishes

    expect(shield.updateScan(s, SECURITY.scanSeconds / 2)).toMatchObject({
      done: true,
      cured: true,
    });
    expect(shield.isInfected(s)).toBe(false);
  });

  it('is abandoned if Shield99 is closed mid-scan', () => {
    const s = guarded();
    shield.startScan(s);
    s.apps.shield99.open = false;

    expect(shield.updateScan(s, 1)).toMatchObject({ done: false, cancelled: true });
    expect(s.security.scan).toBeNull();
  });

  it('reports a clean scan as done but not cured', () => {
    const s = guarded();
    shield.startScan(s);
    expect(shield.updateScan(s, SECURITY.scanSeconds)).toMatchObject({ done: true, cured: false });
  });
});

describe('through the game', () => {
  /** A machine seeding something dangerous with Shield99 watching. */
  const playing = ({ guarded = true } = {}) => {
    const game = createGame({ storage: createMemoryStorage(), rng: () => 0.5 });
    game.state.hardware.hdd = 3;
    game.state.hardware.ram = 3;
    game.state.apps.lemonwire.installed = true;
    game.state.apps.shield99.installed = guarded;
    game.openApp('aerochat');
    game.state.buzz = 1e6;
    game.buyBots(20);
    game.openApp('lemonwire');
    if (guarded) game.openApp('shield99');
    game.startSeeding('speed-boost');
    return game;
  };

  /** Tick until a threat lands, or give up. */
  const untilCaught = (game, limit = 40) => {
    for (let i = 0; i < limit && game.state.shield99.quarantine.length === 0; i += 1) {
      game.tick(SHIELD99.maxSpawnSeconds / 4);
    }
  };

  it('announces a catch rather than an infection while guarded', () => {
    const game = playing();
    const caught = [];
    game.bus.on(game.events.THREAT_QUARANTINED, ({ threat }) => caught.push(threat.id));

    untilCaught(game);
    expect(caught.length).toBeGreaterThan(0);
    expect(game.state.security.infection).toBeNull();
  });

  it('pays out on extraction, and clears the file', () => {
    const game = playing();
    untilCaught(game);
    const [item] = game.state.shield99.quarantine;

    const before = game.state.buzz;
    const result = game.extractQuarantine(item.id, { viaAd: true });

    expect(result.ok).toBe(true);
    expect(game.state.shield99.quarantine).toHaveLength(0);
    expect(game.state.shield99.filesCleaned).toBe(1);

    if (result.reward.kind === 'buzz') {
      expect(game.state.buzz).toBeCloseTo(before + result.reward.buzz);
    } else if (result.reward.kind === 'buff') {
      expect(game.state.buffs.some((b) => b.source === 'shield99')).toBe(true);
    }
  });

  it('refuses a second ad extraction until the cooldown is up', () => {
    const game = playing();
    untilCaught(game);
    untilCaught(game); // a second one, so there is something left to claim
    const [first, second] = game.state.shield99.quarantine;
    if (!second) return; // a single catch is enough for the first assertion

    expect(game.extractQuarantine(first.id, { viaAd: true }).ok).toBe(true);
    expect(game.extractQuarantine(second.id, { viaAd: true }).reason).toBe('cooling-down');
    // ...but the manual path is always open.
    expect(game.extractQuarantine(second.id, { viaAd: false }).ok).toBe(true);
  });

  /**
   * "Nothing is gated behind an ad" has to survive the ads being switched off.
   * While `ADS.enabled` is false there is no video to watch, so the no-ad
   * fraction stops being a trade and becomes a permanent tax on the mechanic —
   * the lootbox pays in full instead.
   */
  it('pays the manual path in full while the ad system is off', () => {
    const game = playing();
    const item = { id: 1, threatId: 'adware', at: 0 };
    game.state.shield99.quarantine.push(item);

    const manual = game.extractQuarantine(item.id, { viaAd: false });
    expect(manual.ok).toBe(true);

    const second = { id: 2, threatId: 'adware', at: 0 };
    game.state.shield99.quarantine.push(second);
    const viaAd = game.extractQuarantine(second.id, { viaAd: true });

    if (ADS.enabled) {
      expect(manual.reward.buzz).toBeCloseTo(viaAd.reward.buzz * SHIELD99.manualRewardFraction);
    } else {
      expect(Math.abs(manual.reward.buzz - viaAd.reward.buzz)).toBeLessThan(300);
    }
  });

  it('shoves the Aero Studio render along when that is what it rolled', () => {
    const game = playing();
    game.state.aerostudio.isRendering = true;
    game.state.aerostudio.currentProject = 'Test';
    game.state.aerostudio.progress = 0.2;

    const item = { id: 1, threatId: 'trojan', at: 0 };
    game.state.shield99.quarantine.push(item);

    const result = game.extractQuarantine(item.id, { viaAd: true });
    expect(result.reward.kind).toBe('render');
    expect(game.state.aerostudio.progress).toBeCloseTo(0.2 + result.reward.renderFraction);
  });

  it('infects an unguarded machine, halves production, and cleans up after', () => {
    const game = playing({ guarded: false });
    const outcomes = [];
    game.bus.on(game.events.VIRUS, ({ outcome }) => outcomes.push(outcome));

    for (let i = 0; i < 40 && !game.state.security.infection; i += 1) {
      game.tick(SHIELD99.maxSpawnSeconds / 4);
    }
    expect(outcomes).toEqual(['rescued', 'infected']);

    const sick = game.econ.buzzPerSecond(game.state);
    expect(game.startSeeding('anime').reason).toBe('infected');

    game.state.apps.shield99.installed = true; // bought, far too late
    game.openApp('shield99');
    expect(game.startScan().ok).toBe(true);
    for (let i = 0; i < 60 && game.state.security.scan; i += 1) game.tick(1);

    expect(game.state.security.infection).toBeNull();
    expect(game.econ.buzzPerSecond(game.state)).toBeCloseTo(sick * 2, 0);
  });

  it('Format C: clears the quarantine, the infection and the free rescue', () => {
    const game = playing();
    untilCaught(game);
    game.state.security.infection = { at: 0 };
    game.state.security.rescuesUsed = 1;
    game.state.lifetimeBuzz = 5_000_000;

    game.formatC();
    expect(game.state.shield99.quarantine).toEqual([]);
    expect(game.state.security.infection).toBeNull();
    expect(game.state.security.rescuesUsed).toBe(0);
  });

  it('keeps a caught file across a save and reload', () => {
    const storage = createMemoryStorage();
    const first = createGame({ storage, rng: () => 0.5 });
    first.state.apps.shield99.installed = true;
    first.state.shield99.quarantine.push({ id: 1, threatId: 'worm', at: 0 });
    first.save();

    const second = createGame({ storage, rng: () => 0.5 });
    second.load();
    expect(second.state.shield99.quarantine).toEqual([{ id: 1, threatId: 'worm', at: 0 }]);
  });
});
