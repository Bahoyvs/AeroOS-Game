import { describe, expect, it } from 'vitest';
import { createGame } from '../src/core/game.js';
import { createMemoryStorage } from '../src/core/save.js';
import { CHAT_BOT, PRESTIGE } from '../src/data/balance.js';

const newGame = () => createGame({ storage: createMemoryStorage(), now: 0 });

describe('nudging', () => {
  it('grants Buzz and counts the click', () => {
    const game = newGame();
    const gained = game.nudge();
    expect(gained).toBeGreaterThan(0);
    expect(game.state.buzz).toBeCloseTo(gained);
    expect(game.state.lifetimeBuzz).toBeCloseTo(gained);
    expect(game.state.stats.nudges).toBe(1);
  });
});

describe('window/RAM lifecycle', () => {
  it('opening and closing an app moves memory in and out', () => {
    const game = newGame();
    expect(game.openApp('aerochat').ok).toBe(true);
    expect(game.econ.ramUsed(game.state)).toBe(32);
    expect(game.closeApp('aerochat').ok).toBe(true);
    expect(game.econ.ramUsed(game.state)).toBe(0);
  });

  it('emits an out-of-memory event instead of opening', () => {
    const game = newGame();
    game.state.apps.aerostudio.installed = true; // 192 MB vs 128 MB of RAM
    let event = null;
    game.bus.on(game.events.OUT_OF_MEMORY, (payload) => (event = payload));

    expect(game.openApp('aerostudio').ok).toBe(false);
    expect(event).toMatchObject({ id: 'aerostudio', needed: 192 });
    expect(game.state.apps.aerostudio.open).toBe(false);
  });
});

describe('buying', () => {
  it('spends Buzz on bots', () => {
    const game = newGame();
    game.state.buzz = 1000;
    const result = game.buyBots(3);
    expect(result.ok).toBe(true);
    expect(game.state.chat.bots).toBe(3);
    expect(game.state.buzz).toBeCloseTo(1000 - result.cost);
  });

  it('refuses bots the player cannot afford', () => {
    const game = newGame();
    expect(game.buyBots(1)).toEqual({ ok: false, reason: 'too-expensive' });
    expect(game.state.chat.bots).toBe(0);
  });

  it('installs an unlocked app and charges for it', () => {
    const game = newGame();
    game.state.runBuzz = 10_000;
    game.state.buzz = 10_000;
    expect(game.installApp('retroamp').ok).toBe(true);
    expect(game.state.apps.retroamp.installed).toBe(true);
    expect(game.state.buzz).toBe(10_000 - 250);
  });

  it('refuses locked apps', () => {
    const game = newGame();
    game.state.buzz = 1_000_000;
    expect(game.installApp('retroamp')).toEqual({ ok: false, reason: 'locked' });
  });

  it('spends Dollars on hardware', () => {
    const game = newGame();
    game.state.dollars = 100;
    const result = game.buyHardware('ram');
    expect(result.ok).toBe(true);
    expect(game.state.hardware.ram).toBe(1);
    expect(game.econ.ramCapacity(game.state)).toBe(256);
  });

  it('refuses hardware that is not affordable', () => {
    const game = newGame();
    expect(game.buyHardware('cpu')).toEqual({ ok: false, reason: 'too-expensive' });
  });
});

describe('ticking', () => {
  it('accumulates Buzz and bloat over time', () => {
    const game = newGame();
    game.openApp('aerochat');
    game.state.buzz = 10_000;
    game.buyBots(5);

    const before = game.state.buzz;
    for (let i = 0; i < 10; i += 1) game.tick(1);

    expect(game.state.buzz).toBeCloseTo(before + game.econ.buzzPerSecond(game.state) * 10, 0);
    expect(game.state.bloat).toBeGreaterThan(0);
    expect(game.state.stats.playtimeSeconds).toBeCloseTo(10);
  });

  it('keeps bloat within bounds no matter how long the tab is open', () => {
    const game = newGame();
    game.openApp('aerochat');
    for (let i = 0; i < 100_000; i += 1) game.tick(1);
    expect(game.state.bloat).toBe(1);
  });
});

describe('Format C:', () => {
  it('refuses when nothing is owed', () => {
    const game = newGame();
    expect(game.formatC()).toEqual({ ok: false, reason: 'not-worth-it' });
  });

  it('banks Dollars and wipes the run', () => {
    const game = newGame();
    game.state.lifetimeBuzz = PRESTIGE.minLifetimeBuzz * 100;
    game.state.buzz = 5000;
    game.state.chat.bots = 20;

    const result = game.formatC();
    expect(result.ok).toBe(true);
    expect(game.state.dollars).toBeCloseTo(result.dollars);
    expect(game.state.buzz).toBe(0);
    expect(game.state.chat.bots).toBe(0);
    expect(game.state.prestigeCount).toBe(1);
  });
});

describe('persistence', () => {
  it('saves and reloads through a shared storage', () => {
    const storage = createMemoryStorage();
    const first = createGame({ storage, now: 0 });
    first.state.buzz = 4321;
    first.state.chat.bots = 9;
    first.save();

    const second = createGame({ storage, now: 0 });
    expect(second.load().loaded).toBe(true);
    expect(second.state.chat.bots).toBe(9);
    expect(second.state.buzz).toBeGreaterThanOrEqual(4321);
  });

  it('grants offline Buzz for a long absence', () => {
    const storage = createMemoryStorage();
    const first = createGame({ storage, now: 0 });
    first.state.chat.bots = CHAT_BOT.maxPerRun;
    first.state.apps.aerochat.open = true;
    first.save();

    // Rewind the stored timestamp by an hour to simulate a closed tab.
    const stored = JSON.parse(storage.getItem('aeroos.save.v1'));
    stored.lastSeen -= 3_600_000;
    storage.setItem('aeroos.save.v1', JSON.stringify(stored));

    const second = createGame({ storage });
    const { offline } = second.load();
    expect(offline.buzz).toBeGreaterThan(0);
    expect(second.state.buzz).toBeCloseTo(offline.buzz);
  });

  it('reports no save on a fresh browser', () => {
    expect(newGame().load()).toEqual({ loaded: false });
  });
});
