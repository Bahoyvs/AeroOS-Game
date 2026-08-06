import { describe, expect, it } from 'vitest';
import * as pinball from '../src/core/pinball.js';
import * as econ from '../src/core/economy.js';
import { createGame } from '../src/core/game.js';
import { createMemoryStorage } from '../src/core/save.js';
import { createInitialState } from '../src/core/state.js';
import { PINBALL } from '../src/data/balance.js';
import { TABLE } from '../src/data/pinball.js';

/** The table installed and open, which is all `canLaunch` asks about. */
function arcade() {
  const s = createInitialState(0);
  s.apps.pinball.installed = true;
  s.apps.pinball.open = true;
  return s;
}

/** Run the table for `seconds`, in the frames a real renderer would use. */
function play(table, seconds, { fps = 60, onFrame } = {}) {
  const dt = 1 / fps;
  let hits = 0;
  let drained = false;
  for (let i = 0; i < seconds * fps && !drained; i += 1) {
    onFrame?.(table, i * dt);
    const result = pinball.stepTable(table, dt);
    hits += result.bumperHits;
    drained = result.drained;
  }
  return { hits, drained };
}

describe('tokens', () => {
  it('starts full and stops the refill clock while it is', () => {
    const s = arcade();
    expect(s.pinball.tokens).toBe(PINBALL.maxTokens);
    expect(pinball.updateTokens(s, 0)).toBe(0);
    expect(s.pinball.nextTokenAt).toBe(0);
    expect(pinball.secondsToNextToken(s, 0)).toBeNull();
  });

  it('starts the clock when the first token is spent', () => {
    const s = arcade();
    pinball.spendToken(s, 1000);
    expect(s.pinball.tokens).toBe(PINBALL.maxTokens - 1);
    expect(pinball.secondsToNextToken(s, 1000)).toBe(PINBALL.refillSeconds);
  });

  /**
   * The wall clock is the point: a refill nobody was there to watch still
   * happened, exactly like offline earnings.
   */
  it('refills while the tab is closed', () => {
    const s = arcade();
    pinball.spendToken(s, 0);
    pinball.spendToken(s, 0);
    pinball.spendToken(s, 0);
    expect(s.pinball.tokens).toBe(0);

    const anHour = PINBALL.refillSeconds * 1000;
    expect(pinball.updateTokens(s, anHour - 1)).toBe(0);
    expect(pinball.updateTokens(s, anHour)).toBe(PINBALL.tokensPerRefill);
  });

  it('never banks more than the cap, however long the player is away', () => {
    const s = arcade();
    pinball.spendToken(s, 0);
    pinball.spendToken(s, 0);
    pinball.updateTokens(s, PINBALL.refillSeconds * 1000 * 500);
    expect(s.pinball.tokens).toBe(PINBALL.maxTokens);
    expect(s.pinball.nextTokenAt).toBe(0);
  });

  it('refuses to launch with an empty account, and says why', () => {
    const s = arcade();
    s.pinball.tokens = 0;
    expect(pinball.canLaunch(s)).toEqual({ ok: false, reason: 'no-tokens' });

    s.pinball.tokens = 1;
    s.apps.pinball.open = false;
    expect(pinball.canLaunch(s)).toEqual({ ok: false, reason: 'not-open' });
  });
});

describe('the combo a run is worth', () => {
  it('pays per bumper and caps', () => {
    expect(pinball.comboFor(0).magnitude).toBe(0);
    expect(pinball.comboFor(5).magnitude).toBeCloseTo(5 * PINBALL.comboPerBumper);
    expect(pinball.comboFor(10_000).magnitude).toBe(PINBALL.maxCombo);
    expect(pinball.comboFor(10_000).durationSeconds).toBe(PINBALL.maxComboSeconds);
  });

  it('is longer for a better ball, but never below the base window', () => {
    expect(pinball.comboFor(0).durationSeconds).toBe(PINBALL.comboSecondsBase);
    expect(pinball.comboFor(10).durationSeconds).toBeGreaterThan(
      pinball.comboFor(2).durationSeconds,
    );
  });
});

describe('the table', () => {
  it('drops a ball down the drain when nothing stops it', () => {
    const table = pinball.createTable();
    pinball.launchBall(table);
    // Straight down the middle from mid-table, flippers untouched.
    table.ball = { x: 50, y: 100, vx: 0, vy: 20 };

    const { drained } = play(table, 5);
    expect(drained).toBe(true);
    expect(table.phase).toBe('drained');
  });

  it('scores a bumper and sends the ball back with more speed than it arrived', () => {
    const table = pinball.createTable();
    pinball.launchBall(table);
    const bumper = TABLE.bumpers[1];
    table.ball = { x: bumper.x, y: bumper.y + bumper.r + TABLE.ballRadius + 0.3, vx: 0, vy: -30 };

    const before = Math.hypot(table.ball.vx, table.ball.vy);
    const result = pinball.stepTable(table, 1 / 60);
    expect(result.bumperHits).toBe(1);
    expect(result.struck).toContain(1);
    expect(table.hits).toBe(1);
    expect(table.ball.vy).toBeGreaterThan(0); // sent back down
    expect(Math.hypot(table.ball.vx, table.ball.vy)).toBeGreaterThan(before);
  });

  it('does not pay combo for the posts — they only change the angle', () => {
    const table = pinball.createTable();
    pinball.launchBall(table);
    const post = TABLE.bumpers.find((b) => b.points === 0);
    table.ball = { x: post.x, y: post.y + post.r + TABLE.ballRadius + 0.3, vx: 0, vy: -30 };

    const result = pinball.stepTable(table, 1 / 60);
    expect(result.struck.length).toBe(1);
    expect(result.bumperHits).toBe(0);
  });

  /**
   * The whole point of the flippers: a swung one has to put energy *back into*
   * a falling ball. A flipper that merely stops the ball is a wall, and a table
   * made of walls has no skill in it.
   */
  it('a swung flipper sends a falling ball back up the table', () => {
    const table = pinball.createTable();
    pinball.launchBall(table);
    const flipper = table.flippers[0];
    // Dropped onto the middle of the left flipper, at rest.
    table.ball = { x: flipper.x + 10, y: flipper.y - 6, vx: 0, vy: 30 };

    let fastestUpward = 0;
    play(table, 0.6, {
      onFrame: (t, elapsed) => {
        // Let it land first, then flip: the kick comes from the sweep.
        if (elapsed > 0.15) pinball.setFlipper(t, 'left', true);
        fastestUpward = Math.min(fastestUpward, t.ball?.vy ?? 0);
      },
    });

    expect(table.phase).toBe('live');
    // Hard enough to reach the bumpers, not merely enough to stop the fall.
    expect(fastestUpward).toBeLessThan(-60);
  });

  /**
   * The lane has no floor. A plunge too weak to crest it drops the ball
   * straight back down and drains it, so the *weakest* launch has to make it
   * out — otherwise a token buys nothing and the player never learns why.
   */
  it('clears the plunger lane even at the weakest charge', () => {
    const table = pinball.createTable();
    pinball.launchBall(table); // plunger untouched: minimum power
    expect(table.ball.vy).toBe(-TABLE.launch.minPower);

    let reachedPlayfield = false;
    const { drained } = play(table, 4, {
      onFrame: (t) => {
        if (t.ball && t.ball.x < 84) reachedPlayfield = true;
      },
    });

    expect(reachedPlayfield).toBe(true);
    expect(drained).toBe(false); // still in play four seconds later
  });

  it('keeps the ball inside the cabinet no matter how hard it is launched', () => {
    const table = pinball.createTable();
    pinball.chargePlunger(table, 10); // fully drawn back
    expect(table.plunger).toBe(1);
    pinball.launchBall(table);

    play(table, 6, {
      onFrame: (t) => {
        if (!t.ball) return;
        expect(t.ball.x).toBeGreaterThan(-TABLE.ballRadius);
        expect(t.ball.x).toBeLessThan(TABLE.width + TABLE.ballRadius);
        expect(t.ball.y).toBeGreaterThan(-TABLE.ballRadius);
      },
    });
  });

  it('nudges a ball that has come to rest rather than eating the token', () => {
    const table = pinball.createTable();
    pinball.launchBall(table);
    // Wedged in the top-left corner with nowhere to fall.
    table.ball = { x: 6.2, y: 12.2, vx: 0, vy: 0 };
    table.stuckFor = 0;

    play(table, 4);
    expect(Math.hypot(table.ball?.vx ?? 0, table.ball?.vy ?? 0)).toBeGreaterThan(0);
  });
});

describe('a finished run, through the game', () => {
  const game = () => {
    const g = createGame({ storage: createMemoryStorage(), now: 0 });
    g.state.apps.pinball.installed = true;
    g.state.apps.pinball.open = true;
    return g;
  };

  it('spends a token to launch and refuses when there are none', () => {
    const g = game();
    expect(g.launchPinball().ok).toBe(true);
    expect(g.state.pinball.tokens).toBe(PINBALL.maxTokens - 1);

    g.state.pinball.tokens = 0;
    expect(g.launchPinball()).toEqual({ ok: false, reason: 'no-tokens' });
  });

  it('turns bumpers into a click buff — the multiplier is on the Nudge button', () => {
    const g = game();
    const before = g.econ.clickPower(g.state);

    g.launchPinball();
    g.endPinballRun(6);

    const combo = g.econ.pinballCombo(g.state);
    expect(combo.active).toBe(true);
    expect(combo.multiplier).toBeCloseTo(1 + 6 * PINBALL.comboPerBumper);
    expect(g.econ.clickPower(g.state)).toBeCloseTo(before * combo.multiplier);
  });

  it('records the best ball and does not buff a ball that hit nothing', () => {
    const g = game();
    g.endPinballRun(9);
    g.endPinballRun(2);

    expect(g.state.pinball.bestHits).toBe(9);
    expect(g.state.pinball.runs).toBe(2);

    g.state.buffs = [];
    g.endPinballRun(0);
    expect(g.econ.pinballCombo(g.state).active).toBe(false);
  });

  it('prices a token in production, with a floor for a machine earning nothing', () => {
    const s = arcade();
    expect(econ.pinballTokenCost(s)).toBe(PINBALL.minTokenCost);

    s.chat.bots = 400;
    s.apps.aerochat.open = true;
    const busy = econ.pinballTokenCost(s);
    expect(busy).toBeGreaterThan(PINBALL.minTokenCost);
    expect(busy).toBeCloseTo(
      Math.ceil(econ.buzzPerSecond(s) * PINBALL.buyTokenSeconds),
      0,
    );
  });

  it('will not sell a token to a full account', () => {
    const g = game();
    g.state.buzz = 1e9;
    expect(g.buyPinballToken()).toEqual({ ok: false, reason: 'full' });

    g.launchPinball();
    const result = g.buyPinballToken();
    expect(result.ok).toBe(true);
    expect(g.state.pinball.tokens).toBe(PINBALL.maxTokens);
    expect(g.state.buzz).toBe(1e9 - result.cost);
  });
});
