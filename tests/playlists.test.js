import { describe, expect, it } from 'vitest';
import * as econ from '../src/core/economy.js';
import { createGame } from '../src/core/game.js';
import { createMemoryStorage } from '../src/core/save.js';
import { createInitialState } from '../src/core/state.js';
import { PLAYLISTS, getPlaylist, trackAt } from '../src/data/playlists.js';

const SOFT = getPlaylist('soft-signals');
const HEAVY = getPlaylist('iron-overdrive');

/** A state with RetroAmp installed and open. */
function withRetroAmp(extra = {}) {
  const s = createInitialState(0);
  s.apps.retroamp.installed = true;
  s.apps.retroamp.open = true;
  return Object.assign(s, extra);
}

describe('the playlist table', () => {
  it('has one permanent playlist and one timed burst (AO-14)', () => {
    expect(SOFT.durationSeconds).toBeNull();
    expect(SOFT.cooldownSeconds).toBe(0);
    expect(HEAVY.durationSeconds).toBe(300);
    expect(HEAVY.cooldownSeconds).toBeGreaterThan(HEAVY.durationSeconds);
  });

  it('makes the heavy playlist the memory-hungry one', () => {
    expect(HEAVY.multiplier).toBeGreaterThan(SOFT.multiplier);
    expect(HEAVY.ram).toBeGreaterThan(SOFT.ram);
  });

  it('rejects unknown ids and wraps track indices', () => {
    expect(() => getPlaylist('nope')).toThrow();
    expect(trackAt('soft-signals', SOFT.tracks.length)).toBe(SOFT.tracks[0]);
    expect(trackAt('soft-signals', -1)).toBe(SOFT.tracks.at(-1));
  });
});

describe('the multiplier', () => {
  it('is neutral with nothing loaded', () => {
    expect(econ.retroampMultiplier(withRetroAmp(), 0)).toBe(1);
  });

  it('applies while the playlist plays', () => {
    const s = withRetroAmp();
    s.retroamp.playlist = 'soft-signals';
    expect(econ.retroampMultiplier(s, 0)).toBeCloseTo(1 + SOFT.multiplier);
  });

  it('stops paying when RetroAmp is closed, so its RAM cannot be dodged', () => {
    const s = withRetroAmp();
    s.retroamp.playlist = 'soft-signals';
    s.apps.retroamp.open = false;
    expect(econ.retroampMultiplier(s, 0)).toBe(1);
  });

  it('stops paying the moment a timed playlist burns out', () => {
    const s = withRetroAmp();
    s.retroamp.playlist = 'iron-overdrive';
    s.retroamp.endsAt = 10_000;
    expect(econ.retroampMultiplier(s, 9_999)).toBeCloseTo(1 + HEAVY.multiplier);
    expect(econ.retroampMultiplier(s, 10_000)).toBe(1);
  });

  it('multiplies everything the OS produces', () => {
    const s = withRetroAmp();
    s.apps.aerochat.open = true;
    s.buildings.aerochat.units = 10;
    const before = econ.buzzPerSecond(s, 0);
    s.retroamp.playlist = 'iron-overdrive';
    s.retroamp.endsAt = 1e12;
    expect(econ.buzzPerSecond(s, 0)).toBeCloseTo(before * (1 + HEAVY.multiplier));
  });
});

describe('memory', () => {
  it('charges the playlist on top of RetroAmp itself', () => {
    const s = withRetroAmp();
    expect(econ.ramUsed(s)).toBe(64);
    s.retroamp.playlist = 'iron-overdrive';
    expect(econ.ramUsed(s)).toBe(64 + HEAVY.ram);
    expect(econ.appRam(s, 'retroamp')).toBe(64 + HEAVY.ram);
  });

  it('refuses the heavy playlist on a stock machine — the intended bottleneck', () => {
    const s = withRetroAmp();
    s.apps.aerochat.open = true; // 32 + 64 = 96 of 128
    const check = econ.canLoadPlaylist(s, 'iron-overdrive', 0);
    expect(check).toMatchObject({ ok: false, reason: 'out-of-memory' });
  });

  it('allows it once the player has bought more RAM', () => {
    const s = withRetroAmp();
    s.apps.aerochat.open = true;
    s.hardware.ram = 2; // 512 MB
    expect(econ.canLoadPlaylist(s, 'iron-overdrive', 0).ok).toBe(true);
  });

  it('only charges the difference when swapping playlists', () => {
    const s = withRetroAmp();
    s.hardware.ram = 1; // 256 MB
    s.apps.aerochat.open = true;
    s.retroamp.playlist = 'iron-overdrive';
    // Swapping down to the free playlist is always possible.
    expect(econ.canLoadPlaylist(s, 'soft-signals', 0).ok).toBe(true);
  });

  it('refuses to load while RetroAmp is closed', () => {
    const s = withRetroAmp();
    s.apps.retroamp.open = false;
    expect(econ.canLoadPlaylist(s, 'soft-signals', 0).reason).toBe('not-open');
  });

  it('refuses to reload what is already playing', () => {
    const s = withRetroAmp();
    s.retroamp.playlist = 'soft-signals';
    expect(econ.canLoadPlaylist(s, 'soft-signals', 0).reason).toBe('already-loaded');
  });
});

describe('the game actions', () => {
  const ready = () => {
    const game = createGame({ storage: createMemoryStorage(), rng: () => 0 });
    game.state.hardware.ram = 2; // room for the heavy playlist
    game.state.apps.retroamp.installed = true;
    game.openApp('retroamp');
    return game;
  };

  it('loads a playlist and starts the countdown', () => {
    const game = ready();
    const result = game.loadPlaylist('iron-overdrive');
    expect(result.ok).toBe(true);
    expect(game.state.retroamp.playlist).toBe('iron-overdrive');
    expect(game.state.retroamp.endsAt).toBeGreaterThan(Date.now());
    expect(econ.playlistSecondsLeft(game.state)).toBeGreaterThan(0);
  });

  it('leaves a permanent playlist with no end time', () => {
    const game = ready();
    game.loadPlaylist('soft-signals');
    expect(game.state.retroamp.endsAt).toBe(0);
    expect(econ.playlistSecondsLeft(game.state)).toBeNull();
  });

  it('burns out on the tick and starts cooling down', () => {
    const game = ready();
    game.loadPlaylist('iron-overdrive');

    let ended = null;
    game.bus.on(game.events.PLAYLIST_ENDED, (payload) => (ended = payload));
    game.state.retroamp.endsAt = Date.now() - 1;
    game.tick(1);

    expect(ended).toMatchObject({ reason: 'burnt-out' });
    expect(game.state.retroamp.playlist).toBeNull();
    expect(econ.playlistCooldownLeft(game.state, 'iron-overdrive')).toBeGreaterThan(0);
    expect(game.loadPlaylist('iron-overdrive')).toMatchObject({ reason: 'cooling-down' });
  });

  /**
   * Regression: swapping to another playlist used to overwrite the loaded one
   * without ever ejecting it, so the heavy burst never burnt out, never started
   * its cooldown, and could be re-loaded immediately — an unlimited ×3.
   */
  it('swapping away from the burst still owes its cooldown', () => {
    const game = ready();
    game.loadPlaylist('iron-overdrive');
    game.state.retroamp.startedAt = Date.now() - HEAVY.durationSeconds * 1000; // used it all

    game.loadPlaylist('soft-signals');
    expect(game.state.retroamp.playlist).toBe('soft-signals');
    expect(econ.playlistCooldownLeft(game.state, 'iron-overdrive')).toBeGreaterThan(0);
    expect(game.loadPlaylist('iron-overdrive')).toMatchObject({ reason: 'cooling-down' });
  });

  it('ejecting by hand owes cooldown too, so it cannot be re-loaded at once', () => {
    const game = ready();
    game.loadPlaylist('iron-overdrive');
    game.state.retroamp.startedAt = Date.now() - HEAVY.durationSeconds * 1000;

    game.ejectPlaylist('ejected');
    expect(econ.playlistCooldownLeft(game.state, 'iron-overdrive')).toBeGreaterThan(0);
    expect(game.loadPlaylist('iron-overdrive').reason).toBe('cooling-down');
  });

  it('charges cooldown in proportion to the burst actually used', () => {
    const game = ready();
    game.loadPlaylist('iron-overdrive');
    // Swap away a fifth of the way in.
    game.state.retroamp.startedAt = Date.now() - (HEAVY.durationSeconds / 5) * 1000;
    game.ejectPlaylist('ejected');

    const owed = econ.playlistCooldownLeft(game.state, 'iron-overdrive');
    expect(owed).toBeGreaterThan(0);
    expect(owed).toBeCloseTo(HEAVY.cooldownSeconds / 5, 0);
    // The duty cycle is preserved: a fifth of the burst costs a fifth of the rest.
    expect(owed / (HEAVY.durationSeconds / 5)).toBeCloseTo(
      HEAVY.cooldownSeconds / HEAVY.durationSeconds,
      1,
    );
  });

  it('the permanent playlist never owes a cooldown', () => {
    const game = ready();
    game.loadPlaylist('soft-signals');
    game.ejectPlaylist('ejected');
    expect(econ.playlistCooldownLeft(game.state, 'soft-signals')).toBe(0);
    expect(game.loadPlaylist('soft-signals').ok).toBe(true);
  });

  it('refuses to eject nothing', () => {
    expect(ready().ejectPlaylist()).toEqual({ ok: false, reason: 'nothing-loaded' });
  });

  it('an out-of-memory load reveals the hardware', () => {
    const game = createGame({ storage: createMemoryStorage(), rng: () => 0 });
    game.state.apps.retroamp.installed = true;
    game.openApp('aerochat');
    game.openApp('retroamp');

    let revealed = false;
    game.bus.on(game.events.HARDWARE_REVEALED, () => (revealed = true));
    expect(game.loadPlaylist('iron-overdrive').reason).toBe('out-of-memory');
    expect(revealed).toBe(true);
    expect(game.state.tutorial.hardwareRevealed).toBe(true);
  });

  it('survives a save and reload, unlike a buff', () => {
    const storage = createMemoryStorage();
    const first = createGame({ storage });
    first.state.hardware.ram = 2;
    first.state.apps.retroamp.installed = true;
    first.openApp('retroamp');
    first.loadPlaylist('soft-signals');
    first.save();

    const second = createGame({ storage });
    second.load();
    second.openApp('retroamp');
    expect(second.state.retroamp.playlist).toBe('soft-signals');
    expect(econ.retroampMultiplier(second.state)).toBeCloseTo(1 + SOFT.multiplier);
  });

  it('is wiped by Format C:', () => {
    const game = ready();
    game.loadPlaylist('soft-signals');
    game.state.lifetimeBuzz = 1e7;
    game.formatC();
    expect(game.state.retroamp.playlist).toBeNull();
    expect(game.state.retroamp.cooldownUntil).toEqual({});
  });

  it('every playlist is loadable given enough memory', () => {
    for (const playlist of PLAYLISTS) {
      const game = ready();
      expect(game.loadPlaylist(playlist.id).ok).toBe(true);
    }
  });
});
