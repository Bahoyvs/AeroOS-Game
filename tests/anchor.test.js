import { describe, expect, it } from 'vitest';
import { shouldUseGL } from '../src/apps/mindsync.js';
import { getApp } from '../src/data/apps.js';
import { BUILDINGS, getBuilding } from '../src/data/buildings.js';

/**
 * The desktop-anchor footprint, and the accessibility contract it carries
 * (GDD v2 §5, §14.4).
 *
 * `createWindowManager` needs a DOM, and `core/` deliberately has none — so the
 * behavioural half of this contract is verified in a real browser instead
 * (a keyboard walk: Tab reaches the orb last, Escape hands focus back to Start).
 * What is asserted here is everything that can rot *without* a browser: the
 * roster shape that makes the footprint reachable at all, and the rules that a
 * future building copying The Hive would have to keep.
 */

const anchors = BUILDINGS.filter((b) => getApp(b.id)?.footprint === 'anchor');

describe('the anchor footprint', () => {
  it('is used by exactly one building, and it is the last one', () => {
    // If a second building ever takes this footprint, the tab-order reasoning
    // in windowManager (one anchor, last in the document) needs revisiting
    // rather than inheriting by accident.
    expect(anchors).toHaveLength(1);
    expect(anchors[0].id).toBe('thehive');
    expect(anchors[0]).toBe(BUILDINGS.at(-1));
  });

  it('costs no RAM, so the memory budget can never refuse to open it', () => {
    /**
     * The Hive cannot be closed, minimised, or re-opened from a task button.
     * If the RAM budget could refuse it, the player would unlock the final
     * building and simply never see it — a soft-lock that appRoster's
     * "openable on a stock machine" test cannot catch, because the failure is
     * that the window never appears rather than that it is too big.
     */
    expect(getApp('thehive').ram).toBe(0);
  });

  it('still charges Buzz to install and to unlock, like every other building', () => {
    // Free of RAM is not free of the economy.
    const app = getApp('thehive');
    const building = getBuilding('thehive');
    expect(app.install.cost).toBeGreaterThan(0);
    expect(app.install.unlockAt).toBeLessThan(building.unlockAt);
    expect(app.install.cost).toBeLessThan(building.baseCost);
  });
});

describe('MindSync renderer selection (GDD §5, §9)', () => {
  const withMatchMedia = (matches, fn) => {
    const original = globalThis.matchMedia;
    globalThis.matchMedia = () => ({ matches, addEventListener() {}, removeEventListener() {} });
    try {
      return fn();
    } finally {
      globalThis.matchMedia = original;
    }
  };

  const withMotion = (value, fn) => {
    const had = globalThis.document !== undefined;
    if (!had) {
      globalThis.document = { documentElement: { dataset: { motion: value } } };
    }
    try {
      return fn();
    } finally {
      if (!had) delete globalThis.document;
    }
  };

  it('takes the cheap path on a mobile viewport', () => {
    // The WebGL exception is desktop-only by design: a shader loop is exactly
    // what a phone cannot afford, and §9 makes the fallback automatic.
    withMotion('full', () => {
      expect(withMatchMedia(true, () => shouldUseGL())).toBe(false);
    });
  });

  it('takes the GL path on a desktop viewport', () => {
    withMotion('full', () => {
      expect(withMatchMedia(false, () => shouldUseGL())).toBe(true);
    });
  });

  it('takes the cheap path under reduced motion, whatever the viewport', () => {
    // A shader loop that honours "reduce motion" by drawing a still frame is a
    // GPU context held open to render nothing.
    withMotion('reduced', () => {
      expect(withMatchMedia(false, () => shouldUseGL())).toBe(false);
    });
  });
});
