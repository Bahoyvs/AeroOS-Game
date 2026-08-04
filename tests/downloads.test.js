import { describe, expect, it } from 'vitest';
import * as dl from '../src/core/downloads.js';
import * as econ from '../src/core/economy.js';
import { createGame } from '../src/core/game.js';
import { createMemoryStorage } from '../src/core/save.js';
import { createInitialState } from '../src/core/state.js';
import { LEMONWIRE, SECURITY } from '../src/data/balance.js';
import { FILES, getFile, riskLabel } from '../src/data/files.js';

/** LemonWire installed and open, with room on disk. */
function wired({ hdd = 3, shield = false, shieldOpen = false } = {}) {
  const s = createInitialState(0);
  s.hardware.hdd = hdd;
  s.apps.lemonwire.installed = true;
  s.apps.lemonwire.open = true;
  s.apps.shield99.installed = shield;
  s.apps.shield99.open = shieldOpen;
  return s;
}

const capacity = (s) => econ.storageCapacityGB(s);

describe('the file list', () => {
  it('pairs risk with reward — the sketchy file is the dangerous one', () => {
    const sketchy = getFile('speed-boost');
    const safe = getFile('wallpapers');
    expect(sketchy.risk).toBeGreaterThan(safe.risk);
    expect(riskLabel(sketchy.risk)).toBe('extreme');
    expect(riskLabel(safe.risk)).toBe('low');
  });

  it('pays more for size and for risk', () => {
    const rate = 10;
    const big = dl.payoutFor('battlefront', rate);
    const small = dl.payoutFor('wallpapers', rate);
    expect(big).toBeGreaterThan(small);

    // Same rate, and the risky file beats its size class.
    const perGB = (id) => dl.payoutFor(id, rate) / getFile(id).sizeGB;
    expect(perGB('cam-movie')).toBeGreaterThan(perGB('wallpapers'));
  });

  it('never pays nothing, even with no production running', () => {
    expect(dl.payoutFor('wallpapers', 0)).toBe(LEMONWIRE.minPayoutBuzz);
  });

  it('scales with the player output, so it stays relevant', () => {
    expect(dl.payoutFor('battlefront', 1000)).toBeGreaterThan(dl.payoutFor('battlefront', 10));
  });
});

describe('starting downloads', () => {
  it('refuses while LemonWire is closed', () => {
    const s = wired();
    s.apps.lemonwire.open = false;
    expect(dl.canDownload(s, 'wallpapers', capacity(s)).reason).toBe('not-open');
  });

  it('refuses more than the concurrent limit', () => {
    const s = wired();
    for (const file of FILES.slice(0, LEMONWIRE.maxConcurrent)) dl.startDownload(s, file.id);
    expect(dl.canDownload(s, 'battlefront', capacity(s)).reason).toBe('queue-full');
  });

  it('refuses a duplicate, and anything already owned', () => {
    const s = wired();
    dl.startDownload(s, 'wallpapers');
    expect(dl.canDownload(s, 'wallpapers', capacity(s)).reason).toBe('already-downloading');

    const t = wired();
    t.lemonwire.library.push('wallpapers');
    expect(dl.canDownload(t, 'wallpapers', capacity(t)).reason).toBe('already-have-it');
  });

  it('refuses what will not fit on the HDD', () => {
    const s = wired({ hdd: 0 });
    s.lemonwire.library.push('battlefront'); // 4 GB on a 4 GB disk
    const check = dl.canDownload(s, 'cam-movie', 4);
    expect(check).toMatchObject({ ok: false, reason: 'no-space' });
    expect(check.free).toBe(0);
  });

  it('allows it again once the disk is bigger', () => {
    const s = wired({ hdd: 0 });
    s.lemonwire.library.push('battlefront');
    expect(dl.canDownload(s, 'cam-movie', 20).ok).toBe(true);
  });

  it('counts in-flight downloads against the disk, not just finished ones', () => {
    const s = wired({ hdd: 0 });
    const before = dl.storageUsedGB(s);
    dl.startDownload(s, 'battlefront');
    expect(dl.storageUsedGB(s)).toBeCloseTo(before + 4);
  });

  it('frees space again when a download is cancelled or a file deleted', () => {
    const s = wired();
    const job = dl.startDownload(s, 'battlefront');
    dl.cancelDownload(s, job.id);
    expect(dl.storageUsedGB(s)).toBe(0);

    s.lemonwire.library.push('battlefront');
    expect(dl.deleteFile(s, 'battlefront').ok).toBe(true);
    expect(dl.storageUsedGB(s)).toBe(0);
    expect(dl.deleteFile(s, 'battlefront').reason).toBe('not-in-library');
  });
});

describe('transfer progress', () => {
  it('advances only while the window is open', () => {
    const s = wired();
    dl.startDownload(s, 'battlefront');
    s.apps.lemonwire.open = false;
    dl.updateDownloads(s, 100, () => 1);
    expect(s.lemonwire.queue[0].downloadedGB).toBe(0);
  });

  it('shares bandwidth between concurrent transfers', () => {
    const one = wired();
    dl.startDownload(one, 'battlefront');
    const solo = dl.speedPerJobGB(one);

    const many = wired();
    dl.startDownload(many, 'battlefront');
    dl.startDownload(many, 'cam-movie');
    expect(dl.speedPerJobGB(many)).toBeCloseTo(solo / 2);
  });

  it('completes and reports an ETA that shrinks', () => {
    const s = wired();
    const job = dl.startDownload(s, 'wallpapers');
    const etaAtStart = dl.secondsLeft(s, job);

    dl.updateDownloads(s, 1, () => 1);
    expect(dl.secondsLeft(s, job)).toBeLessThan(etaAtStart);
    expect(dl.progressOf(job)).toBeGreaterThan(0);

    const finished = dl.updateDownloads(s, 999, () => 1);
    expect(finished).toHaveLength(1);
    expect(s.lemonwire.queue).toHaveLength(0);
  });

  it('rolls infection against the file risk when it lands', () => {
    const safe = wired();
    dl.startDownload(safe, 'speed-boost');
    expect(dl.updateDownloads(safe, 999, () => 0.99)[0].infected).toBe(false);

    const doomed = wired();
    dl.startDownload(doomed, 'speed-boost');
    expect(dl.updateDownloads(doomed, 999, () => 0.01)[0].infected).toBe(true);
  });
});

describe('the safety net (GDD 6)', () => {
  it('real-time protection blocks the threat outright', () => {
    const s = wired({ shield: true, shieldOpen: true });
    expect(dl.resolveInfection(s).outcome).toBe('blocked');
    expect(dl.isInfected(s)).toBe(false);
    expect(s.security.rescuesUsed).toBe(0); // the free rescue is untouched
  });

  it('spends the free trial rescue on the first virus of a run', () => {
    const s = wired();
    expect(dl.resolveInfection(s).outcome).toBe('rescued');
    expect(dl.isInfected(s)).toBe(false);
    expect(s.security.rescuesUsed).toBe(SECURITY.freeRescuesPerRun);
  });

  it('infects only after the rescue is gone', () => {
    const s = wired();
    dl.resolveInfection(s); // rescued
    expect(dl.resolveInfection(s).outcome).toBe('infected');
    expect(dl.isInfected(s)).toBe(true);
  });

  it('caps the damage at half production and never lower', () => {
    const s = wired();
    s.security.infection = { at: 0 };
    expect(dl.infectionPenalty(s)).toBe(SECURITY.productionFloor);
    expect(SECURITY.productionFloor).toBe(0.5);

    // Infecting again cannot stack the penalty.
    dl.resolveInfection(s);
    expect(dl.infectionPenalty(s)).toBe(SECURITY.productionFloor);
  });

  it('halves production but takes nothing already earned', () => {
    const s = wired();
    s.chat.bots = 20;
    s.apps.aerochat.open = true;
    s.buzz = 5000;

    const healthy = econ.buzzPerSecond(s, 0);
    s.security.infection = { at: 0 };
    expect(econ.buzzPerSecond(s, 0)).toBeCloseTo(healthy * 0.5);
    expect(s.buzz).toBe(5000);
  });

  it('locks LemonWire while infected', () => {
    const s = wired();
    s.security.infection = { at: 0 };
    expect(dl.canDownload(s, 'wallpapers', capacity(s)).reason).toBe('infected');
  });
});

describe('scanning', () => {
  it('needs Shield99 installed and open', () => {
    const closed = wired({ shield: true });
    expect(dl.startScan(closed).reason).toBe('not-open');
    expect(dl.startScan(wired()).reason).toBe('not-installed');
  });

  it('runs on simulation time and cures the infection', () => {
    const s = wired({ shield: true, shieldOpen: true });
    s.security.infection = { at: 0 };

    expect(dl.startScan(s).ok).toBe(true);
    expect(dl.startScan(s).reason).toBe('already-scanning');

    expect(dl.updateScan(s, SECURITY.scanSeconds / 2)).toBeNull();
    expect(dl.scanProgress(s)).toBeCloseTo(0.5);
    expect(dl.isInfected(s)).toBe(true); // not cured until it finishes

    expect(dl.updateScan(s, SECURITY.scanSeconds / 2)).toMatchObject({ done: true, cured: true });
    expect(dl.isInfected(s)).toBe(false);
    expect(econ.buzzPerSecond(s, 0)).toBe(econ.buzzPerSecond(s, 0)); // no penalty left
  });

  it('is abandoned if Shield99 is closed mid-scan', () => {
    const s = wired({ shield: true, shieldOpen: true });
    dl.startScan(s);
    s.apps.shield99.open = false;

    expect(dl.updateScan(s, 1)).toMatchObject({ done: false, cancelled: true });
    expect(s.security.scan).toBeNull();
  });

  it('reports a clean scan as done but not cured', () => {
    const s = wired({ shield: true, shieldOpen: true });
    dl.startScan(s);
    expect(dl.updateScan(s, SECURITY.scanSeconds)).toMatchObject({ done: true, cured: false });
  });
});

describe('through the game', () => {
  const playing = (rng = () => 1) => {
    const game = createGame({ storage: createMemoryStorage(), rng });
    game.state.hardware.hdd = 3;
    game.state.hardware.ram = 2; // room for AeroChat + LemonWire + Shield99
    game.state.apps.lemonwire.installed = true;
    game.openApp('aerochat');
    game.state.buzz = 1e6;
    game.buyBots(20);
    game.openApp('lemonwire');
    return game;
  };

  it('a clean download pays out and lands in the library', () => {
    const game = playing(() => 1); // never infected
    let done = null;
    game.bus.on(game.events.DOWNLOAD_DONE, (payload) => (done = payload));

    game.startDownload('wallpapers');
    const before = game.state.buzz;
    for (let i = 0; i < 100 && game.state.lemonwire.queue.length > 0; i += 1) game.tick(1);

    expect(done.payout).toBeGreaterThan(0);
    expect(game.state.buzz).toBeGreaterThan(before);
    expect(game.state.lemonwire.library).toContain('wallpapers');
    expect(game.state.lemonwire.completed).toBe(1);
  });

  it('an infected download runs the whole safety net, then cures', () => {
    const game = playing(() => 0); // always infected
    const outcomes = [];
    game.bus.on(game.events.VIRUS, ({ outcome }) => outcomes.push(outcome));

    // First one is caught by the free trial rescue.
    game.startDownload('speed-boost');
    for (let i = 0; i < 100 && game.state.lemonwire.queue.length > 0; i += 1) game.tick(1);
    expect(outcomes).toEqual(['rescued']);
    expect(game.state.security.infection).toBeNull();

    // Second one infects.
    game.startDownload('wallpapers');
    for (let i = 0; i < 100 && game.state.lemonwire.queue.length > 0; i += 1) game.tick(1);
    expect(outcomes).toEqual(['rescued', 'infected']);

    const sick = game.econ.buzzPerSecond(game.state);
    expect(game.startDownload('anime').reason).toBe('infected');

    // Shield99 cleans it.
    game.state.apps.shield99.installed = true;
    game.openApp('shield99');
    expect(game.startScan().ok).toBe(true);

    let cured = null;
    game.bus.on(game.events.SCAN_DONE, (payload) => (cured = payload));
    for (let i = 0; i < 60 && game.state.security.scan; i += 1) game.tick(1);

    expect(cured).toEqual({ cured: true });
    expect(game.econ.buzzPerSecond(game.state)).toBeCloseTo(sick * 2, 0);
    expect(game.startDownload('anime').ok).toBe(true);
  });

  it('Format C: clears infections, downloads and the free rescue', () => {
    const game = playing(() => 0);
    game.state.security.infection = { at: 0 };
    game.state.security.rescuesUsed = 1;
    game.state.lemonwire.library.push('battlefront');
    game.state.lifetimeBuzz = 5_000_000;

    game.formatC();
    expect(game.state.security.infection).toBeNull();
    expect(game.state.security.rescuesUsed).toBe(0);
    expect(game.state.lemonwire.library).toEqual([]);
    expect(game.state.lemonwire.queue).toEqual([]);
  });

  it('survives a save and reload mid-transfer', () => {
    const storage = createMemoryStorage();
    const first = createGame({ storage, rng: () => 1 });
    first.state.hardware.hdd = 3;
    first.state.apps.lemonwire.installed = true;
    first.openApp('lemonwire');
    first.startDownload('battlefront');
    first.tick(5);
    first.save();

    const second = createGame({ storage, rng: () => 1 });
    second.load();
    expect(second.state.lemonwire.queue).toHaveLength(1);
    expect(second.state.lemonwire.queue[0].downloadedGB).toBeGreaterThan(0);
  });
});
