import { describe, expect, it } from 'vitest';
import * as econ from '../src/core/economy.js';
import { swarm, swarmRisk, uploadKBps } from '../src/core/lemonwire.js';
import { createGame } from '../src/core/game.js';
import { createMemoryStorage } from '../src/core/save.js';
import { createInitialState } from '../src/core/state.js';
import { BUILDING, LEMONWIRE } from '../src/data/balance.js';
import { FILES, peerAt } from '../src/data/files.js';

/**
 * LemonWire after the Phase 2 fold-in.
 *
 * The old suite tested a mechanic that no longer exists: hand-filled seed slots
 * with their own income, their own disk accounting and their own Recycle Bin.
 * All of that became a *display* of building #5's unit count, so what is worth
 * testing now is the thing that could actually go wrong — that the swarm is
 * derived, deterministic, and carries no production of its own.
 */

const withPeers = (units) => {
  const s = createInitialState(0);
  s.buildings.lemonwire.units = units;
  s.runBuzz = Number.MAX_SAFE_INTEGER;
  return s;
};

describe('the swarm is derived', () => {
  it('gives every peer a file, deterministically', () => {
    for (const index of [0, 1, 7, 42, 300, 4999]) {
      const first = peerAt(index);
      expect(first).toBeDefined();
      expect(peerAt(index)).toBe(first);
    }
  });

  it('reaches for rarer files as the swarm grows', () => {
    // The old three-way trade (size / rarity / risk) survives as progression
    // rather than as a decision, so a big swarm must span more of the table
    // than a small one.
    const small = new Set(swarm(5).map((r) => r.file.id));
    const large = new Set(swarm(400).map((r) => r.file.id));
    expect(large.size).toBeGreaterThan(small.size);
  });

  it('accounts for every unit exactly once', () => {
    for (const units of [0, 1, 30, 250]) {
      const counted = swarm(units, FILES.length).reduce((sum, row) => sum + row.peers, 0);
      expect(counted).toBe(units);
    }
  });

  it('is ordered by how many peers share a file', () => {
    const rows = swarm(200, FILES.length);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1].peers).toBeGreaterThanOrEqual(rows[i].peers);
    }
  });

  it('caps the list so a swarm of five hundred is still readable', () => {
    expect(swarm(500, 4)).toHaveLength(4);
  });

  it('stores nothing — the whole swarm is a function of the unit count', () => {
    const s = withPeers(120);
    expect(s.lemonwire).toBeUndefined();
    expect(econ.lemonwireSwarm(s)).toEqual(swarm(120));
  });
});

describe('what the window shows', () => {
  it('fills the disk as peers arrive', () => {
    expect(econ.lemonwireDiskUsedGB(withPeers(0))).toBe(0);
    expect(econ.lemonwireDiskUsedGB(withPeers(50))).toBeGreaterThan(
      econ.lemonwireDiskUsedGB(withPeers(10)),
    );
  });

  it('carries more risk the deeper the swarm goes', () => {
    expect(swarmRisk(0)).toBe(0);
    expect(swarmRisk(300)).toBeGreaterThan(swarmRisk(20));
  });

  it('lights the connection bars off the milestone tier, not a purchase', () => {
    const first = econ.lemonwireConnection(withPeers(0));
    const later = econ.lemonwireConnection(withPeers(BUILDING.milestones[2].at));
    expect(first).toBe(LEMONWIRE.connections[0]);
    expect(LEMONWIRE.connections.indexOf(later)).toBeGreaterThan(0);
  });

  it('runs out of connection tiers rather than off the end of the table', () => {
    const maxed = econ.lemonwireConnection(withPeers(BUILDING.maxUnits));
    expect(maxed).toBe(LEMONWIRE.connections.at(-1));
  });

  it('always shows a non-zero upload rate for a file somebody is sharing', () => {
    for (const file of FILES) expect(uploadKBps(file.id, 1)).toBeGreaterThanOrEqual(1);
  });
});

describe('it is a building like the other eleven', () => {
  it('produces from units alone — the swarm is not a second income', () => {
    const s = withPeers(40);
    const bd = econ.getProductionBreakdown(s, 'lemonwire');
    expect(bd.own).toBe(bd.base * bd.milestoneMultiplier);
    expect(bd.own).toBeGreaterThan(0);
  });

  it('keeps paying with the window shut', () => {
    const s = withPeers(30);
    s.apps.lemonwire.open = false;
    const closed = econ.buzzPerSecond(s, 0);
    s.apps.lemonwire.open = true;
    expect(econ.buzzPerSecond(s, 0)).toBe(closed);
  });

  it('is bought through the same action as every other building', () => {
    const game = createGame({ storage: createMemoryStorage(), now: 0, rng: () => 0.5 });
    game.state.runBuzz = Number.MAX_SAFE_INTEGER;
    game.state.buzz = 1e12;

    const before = econ.buzzPerSecond(game.state, 0);
    expect(game.buyUnits('lemonwire', 5)).toMatchObject({ ok: true, count: 5 });
    expect(econ.buzzPerSecond(game.state, 0)).toBeGreaterThan(before);
    expect(econ.lemonwireSwarm(game.state).length).toBeGreaterThan(0);
  });

  it('clears with a Format C:, swarm and all', () => {
    const game = createGame({ storage: createMemoryStorage(), now: 0, rng: () => 0.5 });
    game.state.runBuzz = Number.MAX_SAFE_INTEGER;
    game.state.buzz = 1e12;
    game.buyUnits('lemonwire', 30);
    game.state.lifetimeBuzz = 1e7;

    game.formatC();
    expect(econ.unitsOf(game.state, 'lemonwire')).toBe(0);
    expect(econ.lemonwireSwarm(game.state)).toEqual([]);
  });
});
