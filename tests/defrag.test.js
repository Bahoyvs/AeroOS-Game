import { describe, expect, it } from 'vitest';
import * as econ from '../src/core/economy.js';
import { createGame } from '../src/core/game.js';
import { createMemoryStorage, serialize } from '../src/core/save.js';
import { createInitialState } from '../src/core/state.js';
import { offlineBloat, updateDefrag } from '../src/core/defrag.js';
import { BLOAT, DEFRAG, OFFLINE, PRESTIGE, SAVE } from '../src/data/balance.js';

const owning = (bloat = 0) => {
  const s = createInitialState(0);
  s.defrag.owned = true;
  s.bloat = bloat;
  return s;
};

describe('Auto-Defrag, while somebody is watching', () => {
  it('does nothing at all until the machine is genuinely bad', () => {
    const s = owning(DEFRAG.startAt - 0.01);
    expect(updateDefrag(s, 1)).toBeNull();
    expect(s.defrag.active).toBe(false);
    expect(s.bloat).toBe(DEFRAG.startAt - 0.01);
  });

  it('never runs on a machine that has not bought it', () => {
    const s = createInitialState(0);
    s.bloat = 1;
    expect(updateDefrag(s, 1)).toBeNull();
    expect(s.bloat).toBe(1);
  });

  it('engages at the threshold and reports the bloat it found', () => {
    const s = owning(DEFRAG.startAt);
    const pass = updateDefrag(s, 0.1);
    expect(pass).toMatchObject({ started: true, from: DEFRAG.startAt });
    expect(s.defrag.passes).toBe(1);
  });

  it('sweeps back to zero and announces exactly one finish', () => {
    const s = owning(DEFRAG.startAt);
    updateDefrag(s, 0.1); // engage

    let finishes = 0;
    for (let i = 0; i < 2000; i += 1) {
      if (updateDefrag(s, 0.1)?.finished) finishes += 1;
    }

    expect(finishes).toBe(1);
    expect(s.bloat).toBe(0);
    expect(s.defrag.active).toBe(false);
  });

  it('clears far faster than a busy desktop can dirty the disk', () => {
    // A pass that loses the race would leave the machine pinned at 85% with a
    // permanent 5% tax on it — strictly worse than not owning the utility.
    const s = owning(DEFRAG.startAt);
    s.buildings.aerochat.units = 400;
    for (const app of Object.values(s.apps)) app.open = true;
    expect(DEFRAG.clearPerSecond).toBeGreaterThan(econ.bloatGain(s, 1) * 10);
  });

  it('taxes production while it runs, and only while it runs', () => {
    const s = owning(DEFRAG.startAt);
    expect(econ.defragPenalty(s)).toBe(1);
    updateDefrag(s, 0.1);
    expect(econ.defragPenalty(s)).toBeCloseTo(1 - DEFRAG.productionTax);
  });

  it('the tax is inside the rate the player is shown', () => {
    const s = owning(DEFRAG.startAt);
    s.buildings.aerochat.units = 20;
    s.apps.aerochat.open = true;

    const before = econ.buzzPerSecond(s, 0);
    updateDefrag(s, 0.1);
    // Bloat has not moved yet on the engaging tick, so the only difference is
    // the tax — which also means the breakdown still multiplies out.
    const during = econ.buzzPerSecond(s, 0);
    expect(during / before).toBeCloseTo(1 - DEFRAG.productionTax);

    const parts = econ.rateBreakdown(s, 0);
    expect(parts.defrag).toBeCloseTo(1 - DEFRAG.productionTax);
  });

  it('reports progress from where the pass actually began', () => {
    const s = owning(DEFRAG.startAt);
    updateDefrag(s, 0.1);
    expect(econ.defragProgress(s)).toBeCloseTo(0, 2);

    s.bloat = DEFRAG.startAt / 2;
    expect(econ.defragProgress(s)).toBeCloseTo(0.5, 2);
  });
});

describe('Auto-Defrag, while nobody is', () => {
  it('caps what an absence may add rather than clearing it', () => {
    expect(offlineBloat(owning(0.1), 0.1, 5)).toBe(DEFRAG.offlineCap);
  });

  it('leaves an unprotected machine to seize solid', () => {
    const s = createInitialState(0);
    expect(offlineBloat(s, 0.1, 5)).toBe(1);
  });

  it('cannot hand back bloat the player had already run up', () => {
    // A ceiling, not a reset: closing the tab at 90% must not be a free defrag.
    expect(offlineBloat(owning(0.9), 0.9, 5)).toBe(0.9);
  });

  it('a long absence leaves a machine that is still playable', () => {
    const s = owning(0.2);
    s.buildings.aerochat.units = 120;
    s.apps.aerochat.open = true;
    s.apps.lemonwire.open = true;

    // Twelve hours of that would pin an unprotected desktop at 100%.
    expect(0.2 + econ.bloatGain(s, 12 * 3600)).toBeGreaterThan(1);
    const after = offlineBloat(s, s.bloat, econ.bloatGain(s, 12 * 3600));
    expect(after).toBe(DEFRAG.offlineCap);
    // Half a bar is a real penalty, not a locked machine.
    expect(econ.bloatPenalty({ ...s, bloat: after })).toBeGreaterThan(
      BLOAT.productionPenaltyAtFull,
    );
  });

  it('the load path applies the cap to a real save', () => {
    const storage = createMemoryStorage();
    const seed = createInitialState(0);
    seed.defrag.owned = true;
    seed.buildings.aerochat.units = 50;
    seed.apps.aerochat.open = true;
    seed.buzz = 1000;
    storage.setItem(SAVE.key, serialize(seed));

    const away = Date.now() - 24 * 3600 * 1000;
    const stored = JSON.parse(storage.getItem(SAVE.key));
    storage.setItem(SAVE.key, JSON.stringify({ ...stored, lastSeen: away }));

    const game = createGame({ storage });
    game.load();
    expect(game.state.bloat).toBeLessThanOrEqual(DEFRAG.offlineCap);
    expect(OFFLINE.minSeconds).toBeLessThan(24 * 3600); // the report really ran
  });
});

describe('buying it', () => {
  const rich = () => {
    const game = createGame({ storage: createMemoryStorage(), now: 0 });
    game.state.dollars = DEFRAG.cost * 2;
    return game;
  };

  it('costs Dollars and counts toward what has been spent', () => {
    const game = rich();
    const result = game.buyDefrag();

    expect(result).toMatchObject({ ok: true, cost: DEFRAG.cost });
    expect(game.state.dollars).toBeCloseTo(DEFRAG.cost);
    expect(game.state.dollarsSpentTotal).toBeCloseTo(DEFRAG.cost);
    expect(game.state.defrag.owned).toBe(true);
  });

  it('refuses a wallet that cannot cover it, and refuses a second copy', () => {
    const game = createGame({ storage: createMemoryStorage(), now: 0 });
    expect(game.buyDefrag()).toEqual({ ok: false, reason: 'too-expensive' });

    game.state.dollars = DEFRAG.cost;
    game.buyDefrag();
    expect(game.buyDefrag()).toEqual({ ok: false, reason: 'already-owned' });
    expect(game.state.dollars).toBe(0);
  });

  it('survives a Format C:, without carrying a live pass through it', () => {
    const game = rich();
    game.buyDefrag();
    game.state.bloat = DEFRAG.startAt;
    game.tick(0.1);
    expect(game.state.defrag.active).toBe(true);

    game.state.lifetimeBuzz = PRESTIGE.minLifetimeBuzz * 400;
    game.formatC();

    expect(game.state.defrag.owned).toBe(true);
    expect(game.state.defrag.active).toBe(false);
    expect(game.state.bloat).toBe(0);
  });
});
