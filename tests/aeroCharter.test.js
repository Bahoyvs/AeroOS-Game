import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The Aero visual charter, as a test (GDD §A.1, §G phase 6).
 *
 * §A.1 is written as a list of patterns that are "an automatic rejection in
 * code review". A list nobody runs is a list nobody follows, so it is a test —
 * the same reasoning behind every other rule in this codebase that is enforced
 * rather than documented.
 *
 * Two deliberate limits on how strict this is:
 *
 * - **It only reads our own source.** 7.css is the baseline the charter says to
 *   build on, and `node_modules` is not ours to police.
 * - **It looks for things that are unambiguously wrong**, not for things that
 *   are usually wrong. A false positive here would train people to add
 *   exemptions, and an exemption list is how a charter dies.
 */

const SRC = new URL('../src/', import.meta.url).pathname;

function walk(dir, ext, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, ext, out);
    else if (ext.some((e) => name.endsWith(e))) out.push(path);
  }
  return out;
}

const cssFiles = walk(SRC, ['.css']);
const jsFiles = walk(SRC, ['.js']);
const allFiles = [...cssFiles, ...jsFiles];

const read = (path) => ({ path: path.slice(SRC.length), text: readFileSync(path, 'utf8') });

/** Strip block comments — the charter is *discussed* in comments constantly. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the Aero visual charter (GDD §A.1)', () => {
  it('has source files to check', () => {
    expect(cssFiles.length).toBeGreaterThan(5);
    expect(jsFiles.length).toBeGreaterThan(20);
  });

  /**
   * Banned: pill-shaped buttons. Aero's are rounded rectangles at ~3-4px.
   *
   * `border-radius: 999px` (and friends) is the idiom for a pill, and it is
   * only legitimate on things that are genuinely circular — progress tracks,
   * status dots, the boot bar — so those are matched by name rather than
   * exempted wholesale.
   */
  it('uses no pill-shaped buttons', () => {
    const offenders = [];
    for (const { path, text } of cssFiles.map(read)) {
      for (const block of code(text).split('}')) {
        if (!/border-radius:\s*(999px|9999px|50rem|100vmax)/.test(block)) continue;
        const selector = block.split('{')[0].trim();

        /**
         * Match on the *last* BEM segment, not the whole selector. A capsule
         * meter inside a button (`.nudge-button__streak`) is a bar that happens
         * to live in a control called "button", and flagging it would be the
         * kind of false positive that gets a charter check switched off.
         */
        const leaf = selector.split(/[\s>,]+/).pop().split('__').pop();
        // The Start orb is a circle in the real Windows 7 too, so it is the one
        // genuinely round control the charter's "no pills" rule does not mean.
        if (/dot|pip|bar|track|fill|badge|orb|start|ripple|bubble|boot/i.test(leaf)) continue;
        if (/button|\bbtn\b|buy|play|stop|tap|close/i.test(leaf)) {
          offenders.push(`${path}: ${selector}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * Banned: the *Material* elevation signature. Aero's own shadows are fine.
   *
   * The first version of this rule was too broad — it rejected soft shadows
   * outright, which would have blocked the Frutiger Aero gloss the design
   * calls for. Aero absolutely used shadow and glow; what it never did was
   * float a flat surface on a big blurry cloud.
   *
   * So the test now distinguishes them by structure rather than by softness:
   *
   * - **Allowed unconditionally: any declaration containing `inset`.** An Aero
   *   surface pairs its outer shadow with an inner highlight — that pairing is
   *   what makes it read as a lit, bevelled object rather than a card hovering
   *   over a page. If the inset is there, the surface has thickness.
   * - **Allowed: directional shadows.** A non-zero vertical offset means light
   *   is coming from somewhere, which is the whole idea.
   * - **Allowed: tight rim glows** (blur <= 12px), the Aero focus/hover halo.
   * - **Rejected: blur >= 16px with no offset and no inset anywhere in the
   *   declaration** — a centred cloud under a flat shape, which is the Material
   *   tell and nothing else.
   */
  it('uses no Material-style elevation shadows', () => {
    const offenders = [];
    for (const { path, text } of cssFiles.map(read)) {
      for (const match of code(text).matchAll(/box-shadow:\s*([^;]+);/g)) {
        const value = match[1];
        // An inset companion means this is a lit surface, not an elevation.
        if (value.includes('inset')) continue;

        for (const layer of value.split(/,(?![^(]*\))/)) {
          const lengths = [...layer.matchAll(/(-?[\d.]+)px/g)].map((m) => Number(m[1]));
          if (lengths.length < 3) continue;
          const [x, y, blur] = lengths;
          if (blur < 16) continue; // tight shadow or rim glow: Aero's own
          if (Math.abs(y) > 0 || Math.abs(x) > 0) continue; // directional: lit
          offenders.push(`${path}: ${layer.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * Required: purchases look like purchases.
   *
   * The counterpart to the visual rules — a screen can satisfy every "no modern
   * pattern" check and still fail as a game by making transactions invisible.
   * The buy tile carries four redundant signals (icon, effect, cart glyph, the
   * literal word BUY) and an affordability sliver, and this asserts they are
   * all still there.
   */
  it('makes purchases unmistakable', () => {
    const css = readFileSync(join(SRC, 'styles/win32.css'), 'utf8');
    for (const part of ['.w32-buy__cart', '.w32-buy__badge', '.w32-buy__effect', '.w32-buy__sliver']) {
      expect(css).toContain(part);
    }

    const js = readFileSync(join(SRC, 'ui/win32.js'), 'utf8');
    // The word itself, not a text-transform — a caps label the CSS cannot lose.
    expect(js).toContain("'BUY'");
    // And every tile is wired to the shared tooltip.
    expect(js).toMatch(/attachTooltip\(node, \(\) => current\?\.tooltip/);
  });

  /**
   * Banned: thin/light sans-serif weights. The charter calls for Segoe UI and
   * Tahoma with a *bold* hierarchy — 100-300 is the modern look it rules out.
   */
  it('uses no thin or light font weights', () => {
    const offenders = [];
    for (const { path, text } of cssFiles.map(read)) {
      for (const match of code(text).matchAll(/font-weight:\s*([^;]+);/g)) {
        const weight = Number(match[1].trim());
        if (Number.isFinite(weight) && weight < 300) offenders.push(`${path}: ${match[1].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * Banned: the uppercase, letter-spaced micro-label.
   *
   * Not on §A.1's list by name, and it should have been — it is the single
   * loudest tell of a modern analytics dashboard, and the first build of the
   * building panel was covered in it ("BUDDIES", "BUZZ/SEC", "UPGRADES").
   * Windows wrote "Buzz per second" in sentence case at 9pt and put section
   * names in a group-box legend.
   *
   * Tracking on a *large* display string is a different thing and stays legal:
   * a terminal ransom headline and a scareware alert both genuinely used it.
   * What is banned is the combination — small, uppercase, tracked, faded.
   */
  it('uses no uppercase letter-spaced micro-labels', () => {
    const offenders = [];
    for (const { path, text } of cssFiles.map(read)) {
      for (const block of code(text).split('}')) {
        if (!/text-transform:\s*uppercase/.test(block)) continue;
        if (!/letter-spacing:/.test(block)) continue;

        // Only small text: the idiom is a caption pretending to be a label.
        const size = /font-size:\s*([\d.]+)(rem|pt|px)/.exec(block);
        if (!size) continue;
        const [, value, unit] = size;
        const rem = unit === 'rem' ? +value : unit === 'pt' ? +value / 12 : +value / 16;
        if (rem >= 0.85) continue;

        offenders.push(`${path}: ${block.split('{')[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * Required: the panels the v2 systems added are built from Win32 parts.
   *
   * A charter made only of prohibitions can be satisfied by a flat design that
   * simply avoids the banned tokens. This asserts the positive half — the two
   * densest new surfaces use group boxes and sunken list wells, which is what
   * makes them read as Windows rather than as a styled web page.
   */
  it('builds the new panels from group boxes and list wells', async () => {
    const panel = readFileSync(join(SRC, 'ui/buildingPanel.js'), 'utf8');
    const achievements = readFileSync(join(SRC, 'apps/achievements.js'), 'utf8');

    for (const source of [panel, achievements]) {
      expect(source).toMatch(/<fieldset|'fieldset'/);
      expect(source).toMatch(/<legend|'legend'/);
      expect(source).toMatch(/instruction-primary/);
    }

    const css = readFileSync(join(SRC, 'styles/retention.css'), 'utf8');
    // The sunken white well: inset shadow over white with a hard 1px border.
    expect(css).toMatch(/box-shadow:\s*inset 1px 1px 2px/);
  });

  /** Every font stack has to start from the period-correct system fonts. */
  it('names Segoe UI or Tahoma in every font stack', () => {
    const offenders = [];
    for (const { path, text } of cssFiles.map(read)) {
      for (const match of code(text).matchAll(/font-family:\s*([^;]+);/g)) {
        const stack = match[1].trim();
        if (/inherit|var\(|monospace|Lucida Console|Courier New|Comic Sans/i.test(stack)) continue;
        if (!/Segoe UI|Tahoma/i.test(stack)) offenders.push(`${path}: ${stack}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * Banned: Unicode emoji. The charter asks for period-correct MSN-style
   * emoticon art instead, and the shell draws its glyphs in CSS.
   *
   * The two exceptions are the classic Windows control glyphs — a multiplication
   * sign for close, a skull for a rogue process — which are typographic
   * characters rather than emoji and render as monochrome text.
   */
  /**
   * Banned: Unicode emoji (§A.1 asks for period-correct MSN-style emoticon art
   * instead, and the shell draws its own glyphs in CSS).
   *
   * This is a **ratchet, not a clean bill of health.** The apps that shipped
   * before the charter existed use emoji throughout, and swapping ~29 of them
   * for drawn icons is the art task §G phase 6 calls the biggest one in the
   * project — not something to rush inside a refactor and leave unverified.
   *
   * So the rule is enforced where it can be enforced honestly: no *new* file
   * may introduce emoji, and the existing debt may only shrink. Delete names
   * from `EMOJI_DEBT` as their glyphs are redrawn; the count assertion fails if
   * the list is out of date in either direction, so it cannot quietly rot.
   *
   * The allowed set is not an exemption for emoji — those are typographic
   * characters (a multiplication sign for close, a skull, a star) that render
   * monochrome as text and are exactly what a 2000s UI would have used.
   */
  const EMOJI_DEBT = new Set([
    // apps/aerostudio.js paid its debt off when the NLE rewrite landed — the
    // clapperboard, party-popper and hourglass went with the old markup.
    'apps/aerosweeper.js',
    'apps/lemonwire.js',
    // apps/shield99.js paid its debt off with the Norton 2004 rewrite — the
    // shield, biohazard and tier glyphs are all CSS now.
    'apps/system.js',
    'main.js',
    'ui/ads.js',
    'ui/bsod.js',
    'ui/desktop.js',
    'ui/devPanel.js',
    'ui/taskbar.js',
    'ui/welcomeBack.js',
  ]);

  const ALLOWED_GLYPHS = new Set(['✕', '×', '☠', '✦', '★', '✓', '!']);
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F000}-\u{1F02F}]/gu;

  function filesWithEmoji() {
    const found = new Set();
    for (const { path, text } of allFiles.map(read)) {
      for (const match of code(text).matchAll(EMOJI)) {
        if (ALLOWED_GLYPHS.has(match[0])) continue;
        found.add(path);
      }
    }
    return found;
  }

  it('introduces no emoji in any file that does not already have them', () => {
    const offenders = [...filesWithEmoji()].filter((path) => !EMOJI_DEBT.has(path));
    expect(offenders).toEqual([]);
  });

  it('keeps the emoji debt list honest — it may shrink, never grow', () => {
    const found = filesWithEmoji();
    // A file cleaned up but left in the list would let a future regression in.
    const stale = [...EMOJI_DEBT].filter((path) => !found.has(path));
    expect(stale).toEqual([]);
    expect(found.size).toBeLessThanOrEqual(EMOJI_DEBT.size);
  });

  it('keeps every new retention-system module emoji-free', () => {
    // The modules this charter shipped alongside. These are the proof the rule
    // is workable, and they must never appear in the debt list above.
    const NEW = [
      'ui/buildingPanel.js',
      'ui/minigames.js',
      'ui/breach.js',
      'ui/tray.js',
      'ui/crazygames.js',
      'apps/achievements.js',
      'apps/vidchat.js',
      'apps/registrydoctor.js',
      'apps/geopage.js',
      'styles/retention.css',
    ];
    const dirty = [...filesWithEmoji()];
    expect(NEW.filter((path) => dirty.includes(path))).toEqual([]);
  });

  /**
   * Banned: a dark theme as the *default*. Aero's default is bright glass; a
   * dark option is allowed only as a cosmetic unlock (§A.1, last row).
   *
   * "Salvaged System" is that unlock, and this asserts it stays one: it must
   * carry a real unlock condition, and it must not be what a fresh install
   * boots into.
   */
  it('keeps the dark theme an unlock rather than the default', async () => {
    const { DEFAULT_COSMETICS, TINTS } = await import('../src/data/cosmetics.js');
    const dark = TINTS.find((t) => t.id === 'salvaged');

    expect(dark).toBeDefined();
    expect(dark.unlock.kind).not.toBe('always');
    expect(DEFAULT_COSMETICS.tint).not.toBe('salvaged');
  });

  /**
   * Banned: a hamburger menu. There is no markup for one, so this guards the
   * name — the moment somebody reaches for the pattern, they will call it that.
   */
  it('has no hamburger menu', () => {
    const offenders = allFiles
      .map(read)
      .filter(({ text }) => /hamburger|\bburger-menu\b/i.test(code(text)))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  /**
   * Banned: iOS-style toggle switches. The charter asks for classic checkboxes
   * and three-state buttons, which is what the settings rows already use.
   */
  it('has no iOS-style toggle switches', () => {
    const offenders = allFiles
      .map(read)
      .filter(({ text }) => /switch__(thumb|track)|toggle-switch|ios-switch/i.test(code(text)))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  /**
   * Required, not merely un-banned: reduced motion is resolved onto
   * `<html data-motion>` by `ui/motion.js`, so a raw media query would ignore
   * the player's own in-game setting. This is a standing repo rule as well as
   * a charter one — see CLAUDE.md.
   */
  it('never queries prefers-reduced-motion without deferring to data-motion', () => {
    const offenders = [];
    for (const { path, text } of cssFiles.map(read)) {
      for (const match of code(text).matchAll(/@media[^{]*prefers-reduced-motion[^{]*\{([\s\S]*?)\n\}/g)) {
        /**
         * One legitimate use: the pre-hydration fallback. Before `ui/motion.js`
         * has stamped `<html data-motion>`, the OS preference is all there is —
         * so a query guarded by `:root:not([data-motion])` is honouring the
         * player's setting rather than overriding it, and steps aside the
         * instant that setting exists.
         */
        if (/:root:not\(\[data-motion\]\)/.test(match[1])) continue;
        offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });
});
