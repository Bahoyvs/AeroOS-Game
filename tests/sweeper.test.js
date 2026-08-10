import { describe, expect, it } from 'vitest';
import * as sweeper from '../src/core/sweeper.js';
import * as econ from '../src/core/economy.js';
import { createGame } from '../src/core/game.js';
import { createMemoryStorage } from '../src/core/save.js';
import { createInitialState } from '../src/core/state.js';
import { SWEEPER } from '../src/data/balance.js';

/** The app installed and open, which is all `canPlay` asks about. */
function arcade() {
  const s = createInitialState(0);
  s.apps.aerosweeper.installed = true;
  s.apps.aerosweeper.open = true;
  return s;
}

/** A deterministic rng, so a "random" minefield is the same one every run. */
function seeded(seed = 1) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

const dealt = (seed = 1) => sweeper.createRound(SWEEPER, seeded(seed));

/** Open squares until the board is swept or a mine ends it. */
function sweepEverything(round) {
  for (let row = 0; row < round.rows; row += 1) {
    for (let col = 0; col < round.cols; col += 1) {
      const result = sweeper.revealTile(round, row, col);
      if (result.hitMine || result.cleared) return result;
    }
  }
  return { revealed: [], hitMine: false, cleared: false };
}

describe('tokens', () => {
  it('starts full and stops the refill clock while it is', () => {
    const s = arcade();
    expect(s.sweeper.tokens).toBe(SWEEPER.maxTokens);
    expect(sweeper.updateTokens(s, 0)).toBe(0);
    expect(sweeper.secondsToNextToken(s, 0)).toBeNull();
  });

  it('starts the clock when the first token is spent', () => {
    const s = arcade();
    sweeper.spendToken(s, 1000);
    expect(s.sweeper.tokens).toBe(SWEEPER.maxTokens - 1);
    expect(sweeper.secondsToNextToken(s, 1000)).toBe(SWEEPER.refillSeconds);
  });

  /**
   * The wall clock is the point: a refill nobody was there to watch still
   * happened, exactly like offline earnings.
   */
  it('refills while the tab is closed, one token at a time', () => {
    const s = arcade();
    s.sweeper.tokens = 0;
    s.sweeper.nextTokenAt = SWEEPER.refillSeconds * 1000;

    const twoHours = SWEEPER.refillSeconds * 1000;
    expect(sweeper.updateTokens(s, twoHours - 1)).toBe(0);
    expect(sweeper.updateTokens(s, twoHours)).toBe(SWEEPER.tokensPerRefill);
    expect(sweeper.updateTokens(s, twoHours * 2)).toBe(SWEEPER.tokensPerRefill);
  });

  it('never banks more than the cap, however long the player is away', () => {
    const s = arcade();
    s.sweeper.tokens = 0;
    s.sweeper.nextTokenAt = 1;

    sweeper.updateTokens(s, SWEEPER.refillSeconds * 1000 * 500);
    expect(s.sweeper.tokens).toBe(SWEEPER.maxTokens);
    expect(s.sweeper.nextTokenAt).toBe(0);
  });

  it('refuses to deal a board with an empty account, and says why', () => {
    const s = arcade();
    s.sweeper.tokens = 0;
    expect(sweeper.canPlay(s)).toEqual({ ok: false, reason: 'no-tokens' });

    s.sweeper.tokens = 1;
    s.apps.aerosweeper.open = false;
    expect(sweeper.canPlay(s)).toEqual({ ok: false, reason: 'not-open' });
  });
});

describe('the board', () => {
  it('deals covered, unseeded and with nothing to find yet', () => {
    const round = dealt();
    expect(round.phase).toBe('ready');
    expect(round.seeded).toBe(false);
    expect(round.revealedCount).toBe(0);
    expect(sweeper.minesLeft(round)).toBe(SWEEPER.mines);
    expect(round.cells.flat().every((cell) => !cell.mine && !cell.revealed)).toBe(true);
  });

  /**
   * The rule that makes the opening move a move rather than a coin toss: the
   * first square *and its neighbours* are always clear, so the click always
   * unfolds an area to reason about.
   */
  it('never mines the first square or the ring around it', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const round = dealt(seed);
      const row = seed % round.rows;
      const col = (seed * 3) % round.cols;
      const result = sweeper.revealTile(round, row, col);

      expect(result.hitMine).toBe(false);
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          expect(sweeper.cellAt(round, row + dr, col + dc)?.mine ?? false).toBe(false);
        }
      }
      // A clear ring means a zero-adjacent square, so the flood fill always runs.
      expect(result.revealed.length).toBeGreaterThan(1);
    }
  });

  it('lays exactly the requested number of mines', () => {
    const round = dealt(7);
    sweeper.revealTile(round, 4, 4);
    expect(round.cells.flat().filter((cell) => cell.mine).length).toBe(SWEEPER.mines);
    expect(sweeper.mineLocations(round).length).toBe(SWEEPER.mines);
  });

  it('counts adjacent mines correctly for every square', () => {
    const round = dealt(3);
    sweeper.revealTile(round, 0, 0);

    for (let row = 0; row < round.rows; row += 1) {
      for (let col = 0; col < round.cols; col += 1) {
        const cell = round.cells[row][col];
        if (cell.mine) continue;
        let expected = 0;
        for (let dr = -1; dr <= 1; dr += 1) {
          for (let dc = -1; dc <= 1; dc += 1) {
            if (dr === 0 && dc === 0) continue;
            if (sweeper.cellAt(round, row + dr, col + dc)?.mine) expected += 1;
          }
        }
        expect(cell.adjacent).toBe(expected);
      }
    }
  });

  /** The flood fill only spreads from a zero, and a zero has no mine beside it. */
  it('never uncovers a mine while flooding', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const round = dealt(seed);
      const result = sweeper.revealTile(round, 4, 4);
      for (const { row, col } of result.revealed) {
        expect(round.cells[row][col].mine).toBe(false);
      }
    }
  });

  it('counts only safe squares, and stops counting once a mine ends the round', () => {
    const round = dealt(5);
    sweeper.revealTile(round, 4, 4);
    const banked = round.revealedCount;

    const mine = sweeper.mineLocations(round)[0];
    const result = sweeper.revealTile(round, mine.row, mine.col);

    expect(result.hitMine).toBe(true);
    expect(round.phase).toBe('lost');
    expect(round.revealedCount).toBe(banked); // the mine itself is not a square earned
  });

  it('ignores clicks once the round is over', () => {
    const round = dealt(5);
    sweeper.revealTile(round, 4, 4);
    const mine = sweeper.mineLocations(round)[0];
    sweeper.revealTile(round, mine.row, mine.col);

    const after = sweeper.revealTile(round, 0, 0);
    expect(after.revealed).toEqual([]);
    expect(sweeper.toggleFlag(round, 0, 0)).toBe(false);
  });

  it('will not open a flagged square — that is what a flag is for', () => {
    const round = dealt(9);
    sweeper.revealTile(round, 4, 4);

    const covered = [];
    for (let row = 0; row < round.rows; row += 1) {
      for (let col = 0; col < round.cols; col += 1) {
        if (!round.cells[row][col].revealed) covered.push([row, col]);
      }
    }
    const [row, col] = covered[0];

    expect(sweeper.toggleFlag(round, row, col)).toBe(true);
    expect(sweeper.minesLeft(round)).toBe(SWEEPER.mines - 1);
    expect(sweeper.revealTile(round, row, col).revealed).toEqual([]);

    sweeper.toggleFlag(round, row, col);
    expect(sweeper.minesLeft(round)).toBe(SWEEPER.mines);
  });

  it('declares a sweep when every safe square is open — and not before', () => {
    const round = dealt(11);
    // Flag the mines first so the sweep cannot walk onto one.
    sweeper.revealTile(round, 4, 4);
    for (const mine of sweeper.mineLocations(round)) {
      sweeper.toggleFlag(round, mine.row, mine.col);
    }

    const result = sweepEverything(round);
    expect(result.cleared).toBe(true);
    expect(round.phase).toBe('won');
    expect(round.revealedCount).toBe(sweeper.safeCells(round));
  });
});

describe('what a round is worth', () => {
  it('pays per safe square', () => {
    expect(sweeper.comboFor(0).magnitude).toBe(0);
    expect(sweeper.comboFor(12).magnitude).toBeCloseTo(12 * SWEEPER.perTile);
    expect(sweeper.comboFor(10_000).magnitude).toBe(SWEEPER.maxCombo);
  });

  /**
   * The decision the whole app is built on. Standing on a mine has to hurt
   * enough to make cashing out tempting and little enough to make one more
   * square tempting — half, not a wipe.
   */
  it('halves the multiplier on a mine rather than taking it', () => {
    const safe = sweeper.comboFor(20);
    const blown = sweeper.comboFor(20, { hitMine: true });

    expect(blown.magnitude).toBeCloseTo(safe.magnitude * SWEEPER.mineFraction);
    expect(blown.magnitude).toBeCloseTo(safe.magnitude / 2);
    expect(blown.magnitude).toBeGreaterThan(0);
    expect(blown.durationSeconds).toBe(safe.durationSeconds);
  });

  it('pays a bonus for clearing the board outright', () => {
    const swept = sweeper.comboFor(71, { cleared: true });
    expect(swept.magnitude).toBeCloseTo(71 * SWEEPER.perTile * SWEEPER.clearBonus);
  });

  it('runs for the same three minutes however the round ended', () => {
    expect(sweeper.comboFor(3).durationSeconds).toBe(SWEEPER.cashOutSeconds);
    expect(sweeper.comboFor(60, { cleared: true }).durationSeconds).toBe(SWEEPER.cashOutSeconds);
  });
});

describe('a finished round, through the game', () => {
  const game = () => {
    const g = createGame({ storage: createMemoryStorage(), now: 0, rng: seeded(4) });
    g.state.apps.aerosweeper.installed = true;
    g.state.apps.aerosweeper.open = true;
    return g;
  };

  it('spends a token to deal, and hands back a board carrying the injected rng', () => {
    const g = game();
    const result = g.startSweeperRound();

    expect(result.ok).toBe(true);
    expect(result.round.rows).toBe(SWEEPER.rows);
    expect(g.state.sweeper.tokens).toBe(SWEEPER.maxTokens - 1);

    // Deterministic rng in, deterministic minefield out — no Math.random.
    sweeper.revealTile(result.round, 0, 0);
    const layout = sweeper.mineLocations(result.round);
    expect(layout.length).toBe(SWEEPER.mines);
  });

  it('refuses to deal when there are no tokens', () => {
    const g = game();
    g.state.sweeper.tokens = 0;
    expect(g.startSweeperRound()).toEqual({ ok: false, reason: 'no-tokens' });
  });

  it('turns safe squares into a click buff — the multiplier is on the Nudge button', () => {
    const g = game();
    const before = g.econ.clickPower(g.state);

    g.startSweeperRound();
    g.endSweeperRound(15);

    const combo = g.econ.sweeperCombo(g.state);
    expect(combo.active).toBe(true);
    expect(combo.multiplier).toBeCloseTo(1 + 15 * SWEEPER.perTile);
    expect(g.econ.clickPower(g.state)).toBeCloseTo(before * combo.multiplier);
  });

  it('still pays half after a mine, and says so in the event', () => {
    const g = game();
    let payload = null;
    g.bus.on(g.events.SWEEPER_ENDED, (e) => (payload = e));

    g.endSweeperRound(20, { hitMine: true });

    expect(payload.combo.hitMine).toBe(true);
    expect(g.econ.sweeperCombo(g.state).multiplier).toBeCloseTo(
      1 + 20 * SWEEPER.perTile * SWEEPER.mineFraction,
    );
  });

  it('records the best round, counts sweeps, and does not buff an empty board', () => {
    const g = game();
    g.endSweeperRound(31);
    g.endSweeperRound(4);
    g.endSweeperRound(71, { cleared: true });

    expect(g.state.sweeper.bestTiles).toBe(71);
    expect(g.state.sweeper.rounds).toBe(3);
    expect(g.state.sweeper.sweeps).toBe(1);

    g.state.buffs = [];
    g.endSweeperRound(0);
    expect(g.econ.sweeperCombo(g.state).active).toBe(false);
  });

  it('prices a token in production, with a floor for a machine earning nothing', () => {
    const s = arcade();
    expect(econ.sweeperTokenCost(s)).toBe(SWEEPER.minTokenCost);

    s.buildings.aerochat.units = 400;
    s.apps.aerochat.open = true;
    const busy = econ.sweeperTokenCost(s);
    expect(busy).toBeGreaterThan(SWEEPER.minTokenCost);
    expect(busy).toBe(Math.ceil(econ.buzzPerSecond(s) * SWEEPER.buyTokenSeconds));
  });

  it('will not sell a token to a full account', () => {
    const g = game();
    g.state.buzz = 1e9;
    expect(g.buySweeperToken()).toEqual({ ok: false, reason: 'full' });

    g.startSweeperRound();
    const result = g.buySweeperToken();
    expect(result.ok).toBe(true);
    expect(g.state.sweeper.tokens).toBe(SWEEPER.maxTokens);
    expect(g.state.buzz).toBe(1e9 - result.cost);
  });
});
