import { describe, expect, it } from 'vitest';
import { createInitialState, resetForPrestige } from '../src/core/state.js';
import * as breach from '../src/core/breach.js';
import { BREACH } from '../src/data/balance.js';

/** Deterministic "randomness" — placement must never decide a test. */
const rng = () => 0.5;

function machine({ risky = 0, guard = 0 } = {}) {
  const s = createInitialState(0);
  s.buildings.lemonwire.units = risky;
  s.buildings.shield99.units = guard;
  return s;
}

/** Run the clock forward in one-second steps, like the real tick would. */
function run(state, seconds, out = []) {
  for (let i = 0; i < seconds; i += 1) {
    out.push(...breach.updateBreach(state, 1, rng, i * 1000));
  }
  return out;
}

describe('the risk ratio (GDD §C.2)', () => {
  it('is zero on a machine with nothing risky on it', () => {
    expect(breach.riskRatio(createInitialState(0))).toBe(0);
  });

  it('reads an unguarded machine as its full risky-unit count', () => {
    expect(breach.riskRatio(machine({ risky: 7, guard: 0 }))).toBe(7);
  });

  it('is divided down by Shield99 licences', () => {
    expect(breach.riskRatio(machine({ risky: 20, guard: 4 }))).toBe(5);
  });

  it('counts all three risky buildings', () => {
    const s = createInitialState(0);
    s.buildings.lemonwire.units = 2;
    s.buildings.adbar.units = 3;
    s.buildings.iotbotnet.units = 5;
    s.buildings.shield99.units = 2;
    expect(breach.riskRatio(s)).toBe(5);
  });
});

describe('escalation', () => {
  it('stays clear while the ratio is under the threshold', () => {
    const s = machine({ risky: 4, guard: 4 });
    run(s, 400);
    expect(s.event.breachPhase).toBe(0);
  });

  it('reaches phase 1 only after sustained exposure', () => {
    const s = machine({ risky: 50, guard: 1 });
    run(s, BREACH.phaseAtSeconds[0] - 5);
    expect(s.event.breachPhase).toBe(0);
    run(s, 10);
    expect(s.event.breachPhase).toBe(1);
  });

  it('climbs through all three phases if nothing is done', () => {
    const s = machine({ risky: 50, guard: 1 });
    const events = run(s, BREACH.phaseAtSeconds[2] + 10);
    expect(s.event.breachPhase).toBe(3);
    expect(events.some((e) => e.type === 'phase3')).toBe(true);
    expect(s.event.phase3).not.toBeNull();
  });

  it('de-escalates three times faster than it escalated', () => {
    const s = machine({ risky: 50, guard: 1 });
    run(s, BREACH.phaseAtSeconds[0] + 20);
    expect(s.event.breachPhase).toBe(1);

    // Buy enough guard to drop the live ratio under the threshold. The averaged
    // ratio lags by the length of the sampling window, deliberately — a phase
    // must not flip on the two seconds in the middle of a bulk purchase — so
    // flush the window before measuring the recovery rate.
    s.buildings.shield99.units = 50;
    run(s, BREACH.historyLength * BREACH.sampleSeconds);

    const before = s.event.aboveSeconds;
    run(s, 10);
    expect(before - s.event.aboveSeconds).toBeCloseTo(10 * BREACH.recoveryRate, 5);
  });

  it('eventually returns all the way to calm', () => {
    const s = machine({ risky: 50, guard: 1 });
    run(s, BREACH.phaseAtSeconds[1] + 30);
    expect(s.event.breachPhase).toBe(2);

    s.buildings.shield99.units = 50;
    run(s, 600);
    expect(s.event.breachPhase).toBe(0);
    expect(s.event.aboveSeconds).toBe(0);
  });

  /**
   * A save written at phase 3 must come back *with the dialog*, not merely with
   * the dressing. Arming only on the transition left a restored save pinned at
   * maximum corruption with nothing to click — a breach with no way out.
   */
  it('arms the full-screen event for a save restored already at phase 3', () => {
    const s = machine({ risky: 50, guard: 1 });
    s.event.aboveSeconds = BREACH.phaseAtSeconds[2] + 100;
    s.event.breachPhase = 3;
    s.event.phase3 = null;

    const events = breach.updateBreach(s, 1, rng, 0);
    expect(s.event.phase3).not.toBeNull();
    expect(events.some((e) => e.type === 'phase3')).toBe(true);
  });

  it('does not re-arm a full-screen event that is already on screen', () => {
    const s = machine({ risky: 50, guard: 1 });
    s.event.aboveSeconds = BREACH.phaseAtSeconds[2] + 100;
    s.event.breachPhase = 3;
    s.event.phase3 = { startedAt: 5 };

    const events = breach.updateBreach(s, 1, rng, 999);
    expect(events.some((e) => e.type === 'phase3')).toBe(false);
    expect(s.event.phase3.startedAt).toBe(5);
  });

  it('clears rogue processes when it falls back below phase 2', () => {
    const s = machine({ risky: 50, guard: 1 });
    run(s, BREACH.phaseAtSeconds[1] + 60);
    expect(s.event.rogueProcesses.length).toBeGreaterThan(0);

    s.buildings.shield99.units = 100;
    run(s, 400);
    expect(s.event.breachPhase).toBeLessThan(2);
    expect(s.event.rogueProcesses).toEqual([]);
  });
});

describe('rogue processes (GDD §C.3, phase 2)', () => {
  it('skims a fraction of production per live process', () => {
    const s = createInitialState(0);
    expect(breach.rogueDrain(s)).toBe(0);
    s.event.rogueProcesses = [{ id: 1 }, { id: 2 }];
    expect(breach.rogueDrain(s)).toBeCloseTo(2 * BREACH.phase2.stealFraction);
  });

  it('can never drain the economy to a standstill', () => {
    const s = createInitialState(0);
    s.event.rogueProcesses = Array.from({ length: 200 }, (_, i) => ({ id: i }));
    expect(breach.rogueDrain(s)).toBeLessThan(1);
  });

  it('never spawns more than the cap', () => {
    const s = machine({ risky: 50, guard: 1 });
    run(s, BREACH.phaseAtSeconds[1] + 1000);
    expect(s.event.rogueProcesses.length).toBeLessThanOrEqual(BREACH.phase2.maxProcesses);
  });

  it('pays more than it was stealing when killed', () => {
    const s = createInitialState(0);
    s.event.rogueProcesses = [{ id: 42 }];
    const result = breach.popRogue(s, 42, 100);
    expect(result.ok).toBe(true);
    expect(result.buzz).toBeCloseTo(100 * BREACH.phase2.popRewardSeconds);
    expect(s.event.rogueProcesses).toEqual([]);
  });

  it('refuses to kill a process that is not there', () => {
    expect(breach.popRogue(createInitialState(0), 1, 100)).toMatchObject({ ok: false });
  });
});

describe('resolving a full breach (GDD §C.3, phase 3)', () => {
  function breached() {
    const s = createInitialState(0);
    s.buzz = 1000;
    s.lifetimeBuzz = 5000;
    s.allTimeBuzz = 5000;
    s.event.phase3 = { startedAt: 0 };
    s.event.breachPhase = 3;
    return s;
  }

  it('takes a slice of the wallet for a ransom', () => {
    const s = breached();
    const result = breach.resolveBreach(s, 'ransom');
    expect(result.lost).toBeCloseTo(1000 * BREACH.phase3.ransomFraction);
    expect(s.buzz).toBeCloseTo(1000 * (1 - BREACH.phase3.ransomFraction));
  });

  it('costs more to lose a fight than to pay up', () => {
    const paid = breach.resolveBreach(breached(), 'ransom').lost;
    const lost = breach.resolveBreach(breached(), 'lost').lost;
    expect(lost).toBeGreaterThan(paid);
  });

  it('costs nothing to win, and counts the win', () => {
    const s = breached();
    const result = breach.resolveBreach(s, 'fought');
    expect(result.lost).toBe(0);
    expect(s.buzz).toBe(1000);
    expect(s.event.survived).toBe(1);
  });

  it('never touches permanent progress, whatever the outcome', () => {
    for (const outcome of ['ransom', 'fought', 'lost']) {
      const s = breached();
      breach.resolveBreach(s, outcome);
      expect(s.lifetimeBuzz).toBe(5000);
      expect(s.allTimeBuzz).toBe(5000);
      expect(s.dollarsEarnedTotal).toBe(0);
    }
  });

  it('buys real peace — the pressure clock is reset, not merely the phase', () => {
    const s = breached();
    s.event.aboveSeconds = 9999;
    breach.resolveBreach(s, 'ransom');
    expect(s.event.breachPhase).toBe(0);
    expect(s.event.aboveSeconds).toBe(0);
    expect(s.event.phase3).toBeNull();
  });

  it('refuses when there is no breach to resolve', () => {
    expect(breach.resolveBreach(createInitialState(0), 'ransom')).toMatchObject({ ok: false });
  });
});

describe('Incognito Mode (GDD §C.5)', () => {
  it('costs Dollars and records the spend', () => {
    const s = createInitialState(0);
    s.dollars = BREACH.incognito.cost;
    expect(breach.buyIncognito(s).ok).toBe(true);
    expect(s.dollars).toBe(0);
    expect(s.dollarsSpentTotal).toBe(BREACH.incognito.cost);
    expect(breach.isIncognito(s)).toBe(true);
  });

  it('refuses when the player cannot afford it', () => {
    const s = createInitialState(0);
    expect(breach.buyIncognito(s)).toMatchObject({ ok: false, reason: 'too-expensive' });
  });

  it('silences a breach that is already running', () => {
    const s = machine({ risky: 50, guard: 1 });
    run(s, BREACH.phaseAtSeconds[1] + 60);
    expect(s.event.breachPhase).toBeGreaterThan(0);

    s.dollars = BREACH.incognito.cost;
    breach.buyIncognito(s);

    expect(s.event.breachPhase).toBe(0);
    expect(s.event.rogueProcesses).toEqual([]);
  });

  it('keeps the machine calm no matter how bad the ratio gets', () => {
    const s = machine({ risky: 500, guard: 1 });
    s.event.incognitoModeOwned = true;
    run(s, BREACH.phaseAtSeconds[2] * 2);
    expect(s.event.breachPhase).toBe(0);
    expect(s.event.rogueProcesses).toEqual([]);
  });

  it('survives a Format C:, because it was bought with Dollars', () => {
    const s = createInitialState(0);
    s.event.incognitoModeOwned = true;
    s.event.survived = 2;
    s.lifetimeBuzz = 1e6;
    const after = resetForPrestige(s, 1, 0);
    expect(after.event.incognitoModeOwned).toBe(true);
    expect(after.event.survived).toBe(2);
    // ...but the live crisis does not.
    expect(after.event.breachPhase).toBe(0);
    expect(after.event.rogueProcesses).toEqual([]);
  });
});
