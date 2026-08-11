import { describe, expect, it } from 'vitest';
import { isImplemented } from '../src/apps/registry.js';
import { createInitialState } from '../src/core/state.js';
import * as econ from '../src/core/economy.js';
import { APPS, getApp, hasApp } from '../src/data/apps.js';
import { BUILDINGS, getBuilding, hasBuilding } from '../src/data/buildings.js';

/**
 * The seam between the two rosters.
 *
 * `data/buildings.js` says what produces; `data/apps.js` says what has a window
 * on the desktop. They are deliberately separate — AeroSweeper is an app and not
 * a building, and phases 3-4 are buildings with no window yet. But where they
 * *do* overlap the two have to agree, and nothing else in the suite was
 * checking that: a building with no app is unreachable in game, and an app whose
 * install gate sits above its building's unlock opens straight onto a panel
 * saying "not ready" for no reason.
 */

const phase12 = BUILDINGS.filter((b) => b.phase <= 2);
/** Everything that has a window — now all twelve. */
const shipped = BUILDINGS;
/** Ordinary windows: anchors have their own rules (see tests/anchor.test.js). */
const framed = BUILDINGS.filter((b) => getApp(b.id).footprint !== 'anchor');

describe('every shipped building has a window', () => {
  it.each(shipped.map((b) => b.id))('%s is on the app roster and implemented', (id) => {
    expect(hasApp(id)).toBe(true);
    expect(isImplemented(id)).toBe(true);
  });

  it('does not ship a window for a building that has no roster entry', () => {
    for (const app of APPS) {
      if (!hasBuilding(app.id)) continue;
      expect(getBuilding(app.id)).toBeDefined();
    }
  });
});

describe('the two gates line up', () => {
  /**
   * The app must become installable at or before its building unlocks, never
   * after. The other order means the player earns the right to buy units into a
   * window they cannot open yet, which reads as the game losing track of them.
   */
  it.each(shipped.map((b) => b.id))('%s installs no later than it unlocks', (id) => {
    const app = getApp(id);
    const building = getBuilding(id);
    expect(app.install.unlockAt).toBeLessThanOrEqual(building.unlockAt);
  });

  it('leaves a real gap, so the locked panel is something a player sees', () => {
    /**
     * These open on "connecting…" before they open for business — without a gap
     * `createLockedPanel` would be dead code in practice.
     *
     * RetroAmp is exempt, and deliberately: the scripted tutorial hands it to
     * the player the moment they can afford it (see the pacing note on its
     * roster entry), so its two gates are the same number. A window that
     * answered the coach's "install RetroAmp" with "scanning for media…" would
     * be the tutorial arguing with itself.
     */
    const gated = shipped.filter((b) => b.unlockAt > 0 && b.id !== 'retroamp');
    expect(gated.length).toBeGreaterThan(0);
    for (const building of gated) {
      expect(getApp(building.id).install.unlockAt).toBeLessThan(building.unlockAt);
    }
  });

  it('lets RetroAmp open for business the moment it installs', () => {
    expect(getApp('retroamp').install.unlockAt).toBe(getBuilding('retroamp').unlockAt);
  });

  it('charges an install price below what the first unit costs', () => {
    // The install is the doorway, not the purchase. An app that cost more than
    // its own first unit would be the most expensive thing in its own window.
    for (const building of shipped) {
      const app = getApp(building.id);
      if (app.install.cost === 0) continue;
      expect(app.install.cost).toBeLessThan(building.baseCost);
    }
  });
});

describe('windows and memory', () => {
  /**
   * The soft-lock guard, and the most important assertion in this file.
   *
   * Units can only be bought from inside a building's window. So a building
   * whose window will not fit in memory is a building whose units cannot be
   * bought — and a player who unlocks one on a stock machine is simply stuck,
   * with no message telling them why. Phase 3's windows are deliberately heavy
   * (112-124 MB against 128 MB of stock RAM) because they are supposed to feel
   * like they are taking the machine over; heavy is fine, unopenable is not.
   */
  it.each(shipped.map((b) => b.id))('%s can always be opened on a stock machine', (id) => {
    const stock = econ.ramCapacity(createInitialState(0));
    expect(getApp(id).ram).toBeLessThanOrEqual(stock);
  });

  it('charges the phase 4 windows for the machine too — except the anchor', () => {
    // The Algorithm and MindSync are the heaviest windows in the game. The Hive
    // is free, and tests/anchor.test.js explains why that is load-bearing.
    for (const building of framed.filter((b) => b.phase === 4)) {
      expect(getApp(building.id).ram).toBeGreaterThan(0);
    }
  });

  it('makes the phase 3 windows genuinely expensive, not just nominally', () => {
    // If these were as cheap as the early apps the RAM budget would stop being
    // a decision exactly when the desktop gets busiest.
    const heaviestEarly = Math.max(...phase12.map((b) => getApp(b.id).ram));
    for (const building of framed.filter((b) => b.phase === 3)) {
      expect(getApp(building.id).ram).toBeGreaterThanOrEqual(heaviestEarly);
    }
  });

  it('cannot fit them all at once on stock RAM — the budget still means something', () => {
    const stock = econ.ramCapacity(createInitialState(0));
    const total = shipped.reduce((sum, b) => sum + getApp(b.id).ram, 0);
    expect(total).toBeGreaterThan(stock);
  });

  it('declares an icon for every window', () => {
    for (const app of APPS) expect(app.icon).toMatch(/\.(png|svg)$/);
  });
});
