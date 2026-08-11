import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  activeCosmetics,
  allUnlocked,
  chooseCosmetic,
  cosmeticSummary,
  isCosmeticUnlocked,
  selectedCosmetic,
  takeNewlyUnlocked,
} from '../src/core/cosmetics.js';
import { createGame } from '../src/core/game.js';
import { createMemoryStorage } from '../src/core/save.js';
import { createInitialState } from '../src/core/state.js';
import { COSMETICS, TINTS, WALLPAPERS, getCosmetic } from '../src/data/cosmetics.js';
import { DEFRAG, PRESTIGE } from '../src/data/balance.js';

const fresh = () => createInitialState(0);

describe('the cosmetic roster', () => {
  it('starts each list with something that needs no unlock', () => {
    for (const list of [TINTS, WALLPAPERS]) {
      expect(list[0].unlock.kind).toBe('always');
      expect(isCosmeticUnlocked(fresh(), list[0])).toBe(true);
    }
  });

  it('locks everything else on a brand-new desktop', () => {
    const s = fresh();
    const locked = [...TINTS, ...WALLPAPERS].filter((item) => !isCosmeticUnlocked(s, item));
    expect(locked.length).toBe(TINTS.length + WALLPAPERS.length - 2);
  });

  it('gives every entry something the picker can label and draw', () => {
    for (const list of Object.values(COSMETICS)) {
      for (const item of list) {
        expect(item.label).toBeTruthy();
        expect(item.blurb).toBeTruthy();
      }
    }
    // A tint carries its own potted gradient; a wallpaper is a photograph, so
    // its chip is keyed off the id and the file is named only in themes.css.
    for (const tint of TINTS) expect(typeof tint.swatch).toBe('string');
    for (const wallpaper of WALLPAPERS) expect(wallpaper.swatch).toBeUndefined();
  });

  it('names every wallpaper after a file that is actually shipped', () => {
    // The id is the file stem, so a typo here is a desktop that paints nothing.
    const shipped = readdirSync(new URL('../src/assets/wallpapers/', import.meta.url));
    for (const wallpaper of WALLPAPERS) {
      expect(shipped).toContain(`${wallpaper.id}.webp`);
      expect(shipped).toContain(`${wallpaper.id}-thumb.webp`);
    }
  });

  it('paints every wallpaper and every thumbnail from the stylesheet', () => {
    // themes.css is the only place the files are referenced, which makes it the
    // one place a renamed wallpaper can be forgotten.
    const css = readFileSync(new URL('../src/styles/themes.css', import.meta.url), 'utf8');
    for (const wallpaper of WALLPAPERS) {
      expect(css).toContain(`--wall-${wallpaper.id}:`);
      expect(css).toContain(`--thumb-${wallpaper.id}:`);
      expect(css).toContain(`[data-wallpaper='${wallpaper.id}']`);
    }
  });
});

describe('unlock conditions', () => {
  it('opens Midnight Aero on lifetime Buzz', () => {
    const item = getCosmetic('tint', 'midnight');
    const s = fresh();
    s.lifetimeBuzz = item.unlock.at - 1;
    expect(isCosmeticUnlocked(s, item)).toBe(false);
    s.lifetimeBuzz = item.unlock.at;
    expect(isCosmeticUnlocked(s, item)).toBe(true);
  });

  it('opens Green Hill on the first Format C:', () => {
    const item = getCosmetic('wallpaper', 'green-hill');
    const s = fresh();
    expect(isCosmeticUnlocked(s, item)).toBe(false);
    s.prestigeCount = 1;
    expect(isCosmeticUnlocked(s, item)).toBe(true);
  });

  it('opens Toxic Green on Dollars actually spent, not Dollars earned', () => {
    const item = getCosmetic('tint', 'toxic');
    const s = fresh();
    s.dollars = 500;
    s.dollarsEarnedTotal = 500;
    expect(isCosmeticUnlocked(s, item)).toBe(false);
    s.dollarsSpentTotal = item.unlock.at;
    expect(isCosmeticUnlocked(s, item)).toBe(true);
  });

  it('reads every unlock off a counter that survives a Format C:', () => {
    // This is what makes it safe to derive rather than store: an unlock can
    // never be revoked, so a chosen cosmetic cannot vanish underneath anybody.
    const game = createGame({ storage: createMemoryStorage(), now: 0 });
    game.state.lifetimeBuzz = PRESTIGE.minLifetimeBuzz * 400;
    game.state.dollarsSpentTotal = 100;

    const before = cosmeticSummary(game.state);
    game.formatC();
    const after = cosmeticSummary(game.state);

    for (const kind of Object.keys(before)) {
      for (let i = 0; i < before[kind].length; i += 1) {
        if (before[kind][i].unlocked) expect(after[kind][i].unlocked).toBe(true);
      }
    }
  });

  it('correctly reports whether all cosmetics are unlocked', () => {
    const s = fresh();
    expect(allUnlocked(s)).toBe(false);
    s.lifetimeBuzz = 1e12;
    s.prestigeCount = 100;
    s.dollarsSpentTotal = 100000;
    s.event = { overflowsResolved: 100 };
    expect(allUnlocked(s)).toBe(true);
  });
});

describe('choosing one', () => {
  it('applies an unlocked choice', () => {
    const s = fresh();
    s.prestigeCount = 1;
    expect(chooseCosmetic(s, 'wallpaper', 'green-hill')).toMatchObject({ ok: true });
    expect(s.cosmetics.wallpaper).toBe('green-hill');
    expect(activeCosmetics(s).wallpaper.id).toBe('green-hill');
  });

  it('refuses a locked one, and says why', () => {
    const s = fresh();
    expect(chooseCosmetic(s, 'tint', 'midnight')).toEqual({ ok: false, reason: 'locked' });
    expect(s.cosmetics.tint).toBe('aqua');
  });

  it('refuses ids and kinds it does not have', () => {
    const s = fresh();
    expect(chooseCosmetic(s, 'tint', 'nope')).toEqual({ ok: false, reason: 'unknown-cosmetic' });
    expect(chooseCosmetic(s, 'ringtone', 'aqua')).toEqual({ ok: false, reason: 'unknown-kind' });
  });

  it('falls back to the default for a stored id it cannot honour', () => {
    // A retired cosmetic, or a save edited by hand. The desktop still has to be
    // drawable, so this can never resolve to nothing.
    const s = fresh();
    s.cosmetics.tint = 'midnight'; // stored but not unlocked
    expect(selectedCosmetic(s, 'tint').id).toBe('aqua');

    s.cosmetics.wallpaper = 'from-a-future-version';
    expect(selectedCosmetic(s, 'wallpaper').id).toBe('blue-lagoon');
  });

  it('the choice outlives a Format C:', () => {
    const game = createGame({ storage: createMemoryStorage(), now: 0 });
    game.state.lifetimeBuzz = PRESTIGE.minLifetimeBuzz * 400;
    game.state.dollarsSpentTotal = 5;
    expect(game.setCosmetic('wallpaper', 'moonlit-peak').ok).toBe(true);

    game.formatC();
    expect(game.state.cosmetics.wallpaper).toBe('moonlit-peak');
    expect(game.activeCosmetics().wallpaper.id).toBe('moonlit-peak');
  });
});

describe('announcing an unlock', () => {
  it('reports each newcomer exactly once', () => {
    const s = fresh();
    expect(takeNewlyUnlocked(s)).toEqual([]); // the defaults are not news

    s.lifetimeBuzz = getCosmetic('tint', 'midnight').unlock.at;
    const first = takeNewlyUnlocked(s);
    expect(first.map((item) => item.id)).toEqual(['midnight']);
    expect(takeNewlyUnlocked(s)).toEqual([]);
  });

  it('rides on the tick, so a Buzz threshold arrives when it is earned', () => {
    const game = createGame({ storage: createMemoryStorage(), now: 0 });
    const seen = [];
    game.bus.on(game.events.COSMETIC_UNLOCKED, ({ item }) => seen.push(item.id));

    game.state.lifetimeBuzz = getCosmetic('tint', 'midnight').unlock.at;
    game.tick(0.1);
    game.tick(0.1);

    expect(seen).toEqual(['midnight']);
  });

  it('a purchase can hand over a cosmetic on the spot', () => {
    const game = createGame({ storage: createMemoryStorage(), now: 0 });
    const seen = [];
    game.bus.on(game.events.COSMETIC_UNLOCKED, ({ item }) => seen.push(item.id));

    game.state.dollars = DEFRAG.cost;
    game.buyDefrag();

    expect(seen).toContain('toxic');
  });
});
