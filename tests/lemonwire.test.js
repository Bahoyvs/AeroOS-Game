import { describe, expect, it } from 'vitest';
import * as lw from '../src/core/lemonwire.js';
import * as econ from '../src/core/economy.js';
import { createGame } from '../src/core/game.js';
import { createMemoryStorage } from '../src/core/save.js';
import { createInitialState } from '../src/core/state.js';
import { LEMONWIRE } from '../src/data/balance.js';
import { FILES, getFile, riskLabel } from '../src/data/files.js';

/** LemonWire installed and open, with room on disk. */
function wired({ hdd = 3 } = {}) {
  const s = createInitialState(0);
  s.hardware.hdd = hdd;
  s.apps.lemonwire.installed = true;
  s.apps.lemonwire.open = true;
  return s;
}

const slots = (s) => econ.seedSlots(s);
const capacity = (s) => econ.storageCapacityGB(s);
const seed = (s, fileId) => lw.startSeeding(s, fileId, 0);

describe('the file list', () => {
  it('pairs risk with reward — the sketchy file is the dangerous one', () => {
    const sketchy = getFile('speed-boost');
    const safe = getFile('wallpapers');
    expect(sketchy.risk).toBeGreaterThan(safe.risk);
    expect(riskLabel(sketchy.risk)).toBe('extreme');
    expect(riskLabel(safe.risk)).toBe('low');
  });

  it('pays a premium for risk, all else being equal', () => {
    const risky = lw.seedWeight('speed-boost');
    const safe = lw.seedWeight('wallpapers');
    expect(risky.risk).toBeGreaterThan(safe.risk);
  });

  it('pays for rarity, not popularity', () => {
    // A swarm of six needs you; a swarm of 302 does not — and a swarm that big
    // around a 3 MB "speed boost" is bots, which is exactly why believing the
    // advertised seeder count would make the malware the best slot in the list.
    expect(lw.seedWeight('battlefront').demand).toBe(LEMONWIRE.maxDemandModifier);
    expect(lw.seedWeight('speed-boost').demand).toBe(LEMONWIRE.minDemandModifier);
    expect(lw.seedWeight('wallpapers').demand).toBe(LEMONWIRE.minDemandModifier);
  });

  it('pays something for every file in the list', () => {
    for (const file of FILES) expect(lw.seedWeight(file.id).total).toBeGreaterThan(0);
  });
});

describe('what a slot earns', () => {
  it('pays on a fresh machine, before a single buddy is bought', () => {
    const s = wired();
    expect(s.buildings.aerochat.units).toBe(0);
    expect(econ.seedRate(s, 'wallpapers', 0)).toBeGreaterThan(0);
  });

  it('keeps up as the buddy list grows', () => {
    const quiet = wired();
    const busy = wired();
    busy.buildings.aerochat.units = 200;
    expect(econ.seedRate(busy, 'wallpapers', 0)).toBeGreaterThan(
      econ.seedRate(quiet, 'wallpapers', 0),
    );
  });

  it('multiplies every slot at once with the connection', () => {
    const dialup = wired();
    const fibre = wired();
    fibre.lemonwire.connection = LEMONWIRE.connections.length - 1;

    const faster = econ.totalBandwidth(fibre) / econ.totalBandwidth(dialup);
    expect(faster).toBeGreaterThan(1);
    expect(econ.seedRate(fibre, 'anime', 0)).toBeCloseTo(econ.seedRate(dialup, 'anime', 0) * faster);
  });

  it('only earns while the window is open', () => {
    const s = wired();
    seed(s, 'battlefront');
    expect(econ.seedBuzzPerSecond(s, 0)).toBeGreaterThan(0);

    s.apps.lemonwire.open = false;
    expect(econ.seedBuzzPerSecond(s, 0)).toBe(0);
  });

  it('lands in the production total, so global multipliers apply to it', () => {
    const s = wired();
    seed(s, 'battlefront');
    const plain = econ.buzzPerSecond(s, 0);

    s.hardware.cpu = 3;
    expect(econ.buzzPerSecond(s, 0)).toBeGreaterThan(plain);
    expect(econ.buzzPerSecond(s, 0)).toBeCloseTo(
      econ.seedBuzzPerSecond(s, 0) * econ.globalMultiplier(s, 0),
    );
  });

  it('is reported as its own line in the rate breakdown, not as a factor', () => {
    const s = wired();
    s.buildings.aerochat.units = 20;
    s.apps.aerochat.open = true;
    seed(s, 'battlefront');

    const bd = econ.rateBreakdown(s, 0);
    expect(bd.seeds).toBeGreaterThan(0);
    // base × the factor chain is the AeroChat rate; seeding adds on top.
    expect(bd.base * bd.milestone * bd.buffs * bd.playlist * bd.cpu * bd.bloat + bd.seeds).toBeCloseTo(
      bd.total,
      6,
    );
  });
});

describe('taking a slot', () => {
  it('refuses while LemonWire is closed', () => {
    const s = wired();
    s.apps.lemonwire.open = false;
    expect(lw.canSeed(s, 'wallpapers', slots(s), capacity(s)).reason).toBe('not-open');
  });

  it('refuses more than the machine has slots for', () => {
    const s = wired();
    for (const file of FILES.slice(0, slots(s))) seed(s, file.id);
    expect(lw.canSeed(s, 'battlefront', slots(s), capacity(s)).reason).toBe('no-slots');
  });

  it('hands out more slots as the HDD grows', () => {
    const stock = wired({ hdd: 0 });
    const roomy = wired({ hdd: 5 });
    expect(slots(stock)).toBe(LEMONWIRE.baseSeedSlots);
    expect(slots(roomy)).toBeGreaterThan(slots(stock));
    expect(slots(roomy)).toBeLessThanOrEqual(LEMONWIRE.maxSeedSlots);
  });

  it('refuses a file it is already sharing', () => {
    const s = wired();
    seed(s, 'wallpapers');
    expect(lw.canSeed(s, 'wallpapers', slots(s), capacity(s)).reason).toBe('already-seeding');
  });

  it('refuses what will not fit on the HDD', () => {
    const s = wired({ hdd: 0 });
    seed(s, 'battlefront'); // 4 GB
    const check = lw.canSeed(s, 'cam-movie', slots(s), 4);
    expect(check).toMatchObject({ ok: false, reason: 'no-space' });
    expect(check.free).toBe(0);
  });

  it('counts what it is seeding against the disk', () => {
    const s = wired({ hdd: 0 });
    expect(lw.storageUsedGB(s)).toBe(0);
    seed(s, 'battlefront');
    expect(lw.storageUsedGB(s)).toBeCloseTo(4);
  });

  it('refuses while the machine is infected', () => {
    const s = wired();
    s.security.infection = { at: 0 };
    expect(lw.canSeed(s, 'wallpapers', slots(s), capacity(s)).reason).toBe('infected');
  });
});

describe('the Recycle Bin', () => {
  it('does not hand the space back when a seed is stopped', () => {
    const s = wired();
    const job = seed(s, 'battlefront');

    expect(lw.stopSeeding(s, job.id)).toMatchObject({
      ok: true,
      secondsLeft: LEMONWIRE.trashSeconds,
    });
    expect(s.lemonwire.activeSeeds).toEqual([]); // the slot is free immediately
    expect(lw.trashUsedGB(s)).toBe(4);
    expect(lw.storageUsedGB(s)).toBe(4); // ...the disk is not

    expect(lw.stopSeeding(s, job.id).reason).toBe('no-such-seed');
  });

  it('empties on simulation time, and only then frees the disk', () => {
    const s = wired();
    lw.stopSeeding(s, seed(s, 'battlefront').id);

    expect(lw.updateTrash(s, LEMONWIRE.trashSeconds - 1)).toEqual([]);
    expect(lw.storageUsedGB(s)).toBe(4);

    const emptied = lw.updateTrash(s, 1);
    expect(emptied).toHaveLength(1);
    expect(emptied[0].fileId).toBe('battlefront');
    expect(lw.storageUsedGB(s)).toBe(0);
  });

  it('blocks re-seeding a file that is still in the bin', () => {
    const s = wired();
    lw.stopSeeding(s, seed(s, 'wallpapers').id);

    expect(lw.canSeed(s, 'wallpapers', slots(s), capacity(s)).reason).toBe('in-trash');
    lw.updateTrash(s, LEMONWIRE.trashSeconds);
    expect(lw.canSeed(s, 'wallpapers', slots(s), capacity(s)).ok).toBe(true);
  });

  it('counts against the disk, so swapping cannot make room right now', () => {
    const s = wired({ hdd: 0 });
    lw.stopSeeding(s, seed(s, 'battlefront').id); // 4 GB on a 4 GB disk
    expect(lw.canSeed(s, 'cam-movie', slots(s), 4).reason).toBe('no-space');
  });
});

describe('the connection', () => {
  it('starts on dial-up and charges Buzz to move up', () => {
    const s = wired();
    expect(lw.connectionAt(s.lemonwire.connection).multiplier).toBe(1);
    expect(lw.canUpgradeConnection(s).reason).toBe('too-expensive');

    s.buzz = 1e9;
    const result = lw.upgradeConnection(s);
    expect(result.ok).toBe(true);
    expect(s.buzz).toBe(1e9 - result.cost);
    expect(econ.totalBandwidth(s)).toBeGreaterThan(1);
  });

  it('runs out of tiers rather than off the end of the table', () => {
    const s = wired();
    s.buzz = 1e12;
    while (lw.canUpgradeConnection(s).ok) lw.upgradeConnection(s);
    expect(lw.canUpgradeConnection(s).reason).toBe('maxed');
    expect(lw.nextConnection(s.lemonwire.connection)).toBeNull();
  });
});

describe('through the game', () => {
  const playing = () => {
    const game = createGame({ storage: createMemoryStorage(), rng: () => 0.99 });
    game.state.hardware.hdd = 3;
    game.state.hardware.ram = 2; // room for AeroChat + LemonWire + Shield99
    game.state.apps.lemonwire.installed = true;
    game.openApp('aerochat');
    game.state.buzz = 1e6;
    game.buyUnits('aerochat', 20);
    game.openApp('lemonwire');
    return game;
  };

  it('a seeded file starts paying on the next tick', () => {
    const game = playing();
    const before = game.econ.buzzPerSecond(game.state);

    expect(game.startSeeding('battlefront').ok).toBe(true);
    expect(game.econ.buzzPerSecond(game.state)).toBeGreaterThan(before);

    const buzz = game.state.buzz;
    game.tick(1);
    expect(game.state.buzz).toBeGreaterThan(buzz);
  });

  it('counts the bytes it has shared, for the window to show', () => {
    const game = playing();
    game.startSeeding('battlefront');
    game.tick(60);
    expect(game.state.lemonwire.activeSeeds[0].uploadedMB).toBeGreaterThan(0);
  });

  it('empties the bin on the tick and announces the space', () => {
    const game = playing();
    const emptied = [];
    game.bus.on(game.events.TRASH_EMPTIED, ({ file }) => emptied.push(file.id));

    const { seed: started } = game.startSeeding('battlefront');
    expect(game.stopSeeding(started.id).ok).toBe(true);

    game.tick(LEMONWIRE.trashSeconds - 1);
    expect(emptied).toEqual([]);
    game.tick(1);
    expect(emptied).toEqual(['battlefront']);
  });

  it('Format C: clears the slots, the bin and the connection', () => {
    const game = playing();
    game.startSeeding('battlefront');
    game.upgradeConnection();
    game.state.lifetimeBuzz = 5_000_000;

    game.formatC();
    expect(game.state.lemonwire.activeSeeds).toEqual([]);
    expect(game.state.lemonwire.trash).toEqual([]);
    expect(game.state.lemonwire.connection).toBe(0);
  });

  it('survives a save and reload mid-share', () => {
    const storage = createMemoryStorage();
    const first = createGame({ storage, rng: () => 0.99 });
    first.state.hardware.hdd = 3;
    first.state.apps.lemonwire.installed = true;
    first.openApp('lemonwire');
    first.startSeeding('battlefront');
    first.tick(5);
    first.save();

    const second = createGame({ storage, rng: () => 0.99 });
    second.load();
    expect(second.state.lemonwire.activeSeeds).toHaveLength(1);
    expect(second.state.lemonwire.activeSeeds[0].fileId).toBe('battlefront');
  });
});
