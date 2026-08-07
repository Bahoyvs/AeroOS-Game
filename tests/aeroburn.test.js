import { describe, expect, it } from 'vitest';
import * as burner from '../src/core/aeroburn.js';
import * as econ from '../src/core/economy.js';
import { buffMultiplier } from '../src/core/buffs.js';
import { createGame } from '../src/core/game.js';
import { createMemoryStorage } from '../src/core/save.js';
import { createInitialState, resetForPrestige } from '../src/core/state.js';
import { AEROBURN } from '../src/data/balance.js';
import { CD_TYPES, getCD } from '../src/data/cds.js';

const MIX = getCD('mix');
const OC = getCD('overclock');

/** AeroBurn installed, open, and enough Buzz to burn. */
function burning(buzz = 1e6) {
  const s = createInitialState(0);
  s.apps.aeroburn.installed = true;
  s.apps.aeroburn.open = true;
  s.buzz = buzz;
  return s;
}

describe('the disc table (AO-29)', () => {
  it('offers discs that store value and discs that store time', () => {
    // The count is deliberately not pinned — the shelf can grow — but both
    // kinds have to exist, or AeroBurn is a savings account rather than a
    // choice about what to carry across the wipe.
    expect(CD_TYPES.some((cd) => cd.recovery > 0)).toBe(true);
    expect(CD_TYPES.some((cd) => cd.buff)).toBe(true);

    expect(MIX.recovery).toBeGreaterThan(0);
    expect(MIX.recovery).toBeLessThan(1); // burning always costs something
    expect(OC.buff.durationSeconds).toBeGreaterThan(0);
    expect(OC.cost).toBeGreaterThan(MIX.cost);
  });

  it('never gives a disc back more than was burned onto it', () => {
    for (const cd of CD_TYPES) {
      expect(cd.cost).toBeGreaterThan(0);
      expect(cd.burnSeconds).toBeGreaterThan(0);
      if (cd.recovery !== undefined) expect(cd.recovery).toBeLessThan(1);
    }
  });
});

describe('burning', () => {
  it('needs the window open, the Buzz, and a free slot', () => {
    const closed = burning();
    closed.apps.aeroburn.open = false;
    expect(burner.canBurn(closed, 'mix').reason).toBe('not-open');

    expect(burner.canBurn(burning(0), 'mix').reason).toBe('too-expensive');

    const full = burning();
    full.aeroburn.discs = Array.from({ length: AEROBURN.maxDiscs }, () => ({ typeId: 'mix', spent: 1 }));
    expect(burner.canBurn(full, 'mix').reason).toBe('shelf-full');
  });

  it('charges the Buzz up front', () => {
    const s = burning(MIX.cost + 500);
    burner.startBurn(s, 'mix');
    expect(s.buzz).toBe(500);
    expect(s.aeroburn.burning.spent).toBe(MIX.cost);
  });

  it('refuses a second burn while one is running', () => {
    const s = burning();
    burner.startBurn(s, 'mix');
    expect(burner.canBurn(s, 'mix').reason).toBe('already-burning');
  });

  it('advances on simulation time and pauses when the window closes', () => {
    const s = burning();
    burner.startBurn(s, 'mix');

    burner.updateBurn(s, MIX.burnSeconds / 2);
    expect(burner.burnProgress(s)).toBeCloseTo(0.5);

    s.apps.aeroburn.open = false;
    burner.updateBurn(s, 999);
    expect(s.aeroburn.burning).not.toBeNull(); // paused, not lost

    s.apps.aeroburn.open = true;
    const disc = burner.updateBurn(s, MIX.burnSeconds);
    expect(disc).toMatchObject({ typeId: 'mix', spent: MIX.cost });
    expect(s.aeroburn.discs).toHaveLength(1);
    expect(s.aeroburn.burning).toBeNull();
  });
});

describe('playing a disc', () => {
  it('MIX pays back its stored Buzz, minus the burn loss', () => {
    const s = burning();
    s.aeroburn.discs.push({ typeId: 'mix', spent: 10_000 });

    const result = burner.playDisc(s, 0, 0);
    expect(result.buzz).toBeCloseTo(10_000 * MIX.recovery);
    expect(result.buzz).toBeLessThan(10_000);
    expect(s.aeroburn.discs).toHaveLength(0);
  });

  it('OVERCLOCK applies its buff instead of paying Buzz', () => {
    const s = burning();
    s.aeroburn.discs.push({ typeId: 'overclock', spent: OC.cost });

    const result = burner.playDisc(s, 0, 0);
    expect(result.buzz).toBe(0);
    expect(buffMultiplier(s, 'global', 0)).toBeCloseTo(1 + OC.buff.magnitude);
    expect(s.aeroburn.discs).toHaveLength(0);
  });

  it('refuses an empty slot or a closed window', () => {
    const s = burning();
    expect(burner.playDisc(s, 0, 0).reason).toBe('no-disc');
    s.apps.aeroburn.open = false;
    expect(burner.playDisc(s, 0, 0).reason).toBe('not-open');
  });
});

describe('surviving Format C: — the whole point', () => {
  it('carries discs through the wipe', () => {
    const s = burning();
    s.aeroburn.discs.push({ typeId: 'mix', spent: 9000 }, { typeId: 'overclock', spent: OC.cost });
    s.aeroburn.burned = 2;
    s.lifetimeBuzz = 5_000_000;

    const after = resetForPrestige(s, 10, 0);
    expect(after.aeroburn.discs).toEqual(s.aeroburn.discs);
    expect(after.aeroburn.burned).toBe(2);
  });

  it('does not carry an unfinished burn — the Buzz was already spent', () => {
    const s = burning();
    burner.startBurn(s, 'mix');
    s.lifetimeBuzz = 5_000_000;

    expect(resetForPrestige(s, 10, 0).aeroburn.burning).toBeNull();
  });

  it('copies discs rather than sharing them with the old state', () => {
    const s = burning();
    s.aeroburn.discs.push({ typeId: 'mix', spent: 9000 });
    const after = resetForPrestige(s, 10, 0);

    after.aeroburn.discs[0].spent = 1;
    expect(s.aeroburn.discs[0].spent).toBe(9000);
  });

  it('a disc burned before a wipe still pays out after it', () => {
    const game = createGame({ storage: createMemoryStorage(), now: 0 });
    game.state.apps.aeroburn.installed = true;
    game.openApp('aeroburn');
    game.state.buzz = 1e6;
    game.state.lifetimeBuzz = 5_000_000;

    game.startBurn('mix');
    for (let i = 0; i < MIX.burnSeconds + 2; i += 1) game.tick(1);
    expect(game.state.aeroburn.discs).toHaveLength(1);

    game.formatC();
    expect(game.state.buzz).toBe(0); // the run is wiped...
    expect(game.state.aeroburn.discs).toHaveLength(1); // ...but the disc is not
    // The burner survives too, or the disc would be unreachable exactly when
    // the boost is supposed to help.
    expect(game.state.apps.aeroburn.installed).toBe(true);
    expect(game.state.apps.aerochat.installed).toBe(true);
    expect(game.state.apps.lemonwire.installed).toBe(false); // everything else goes

    game.openApp('aeroburn');
    const result = game.playDisc(0);
    expect(result.ok).toBe(true);
    expect(game.state.buzz).toBeCloseTo(MIX.cost * MIX.recovery);
  });
});
