import { describe, expect, it } from 'vitest';
import { MOTION_LABELS, MOTION_MODES, resolveMotion } from '../src/ui/motion.js';

/**
 * The resolution rule is the whole reason the setting is three-state: 'auto'
 * defers to the OS, and the other two override it in either direction. Getting
 * this backwards is what makes every animation in the game vanish.
 */
describe('motion preference', () => {
  it("follows the OS on 'auto'", () => {
    expect(resolveMotion('auto', true)).toBe('reduced');
    expect(resolveMotion('auto', false)).toBe('full');
  });

  it("lets 'full' override an OS that asks for reduced motion", () => {
    expect(resolveMotion('full', true)).toBe('full');
  });

  it("lets 'reduced' override an OS that does not", () => {
    expect(resolveMotion('reduced', false)).toBe('reduced');
  });

  it('treats a missing or unknown setting as auto', () => {
    expect(resolveMotion(undefined, true)).toBe('reduced');
    expect(resolveMotion(undefined, false)).toBe('full');
    expect(resolveMotion('nonsense', false)).toBe('full');
  });

  it('has a label for every mode', () => {
    for (const mode of MOTION_MODES) expect(MOTION_LABELS[mode]).toBeTruthy();
  });
});
