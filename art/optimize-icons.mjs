/**
 * Re-export the icon art at the size it is actually drawn.
 *
 *   node art/optimize-icons.mjs
 *
 * Two jobs, one browser:
 *
 * 1. `public/icons/*.png` — the app icons. They were 256×256 exports and the
 *    largest thing that has ever drawn one is a 32px desktop glyph, so nine
 *    tenths of every one of those files was pixels no player will see. Rewritten
 *    at 96px, which is 3× the largest display size and therefore still sharp on
 *    the densest phone, and still PNG: the paths are named as strings in
 *    src/data/apps.js and src/ui/notify.js, and a format change is a rename the
 *    saving does not pay for.
 *
 * 2. `src/assets/areochat_icons.png` — the buddy avatar sprite, 321 kB for
 *    twelve 32px chips. Written as WebP, because this one *is* named in exactly
 *    one place (styles/apps.css) and lossy compression with alpha is the whole
 *    point. The sprite is positioned in percentages against `background-size:
 *    300% 400%`, so its intrinsic size is not part of the layout — scaling it
 *    uniformly cannot move a chip off its cell.
 *
 * Idempotent: an already-shrunk file is left alone rather than re-encoded, since
 * the encoder never scales up. Run it when the art changes.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kb, withEncoder } from './lib/chromium.mjs';

/** 3× the 32px desktop glyph — the largest an app icon is ever drawn. */
const ICON_PX = 96;
/** The sprite is a 3×4 grid of 32px chips, so 3× is 96 per cell. */
const SPRITE_W = 288;
const SPRITE_QUALITY = 0.9;

const here = dirname(fileURLToPath(import.meta.url));
const iconDir = resolve(here, '..', 'public', 'icons');
const spritePath = resolve(here, '..', 'src', 'assets', 'areochat_icons.png');

/** Width and height out of a PNG's IHDR, without decoding the image. */
function pngSize(buffer) {
  return { w: buffer.readUInt32BE(16), h: buffer.readUInt32BE(20) };
}

await withEncoder(async (encode) => {
  let before = 0;
  let after = 0;

  for (const file of readdirSync(iconDir).filter((f) => /\.png$/i.test(f))) {
    const path = join(iconDir, file);
    const raw = readFileSync(path);
    const size = pngSize(raw);
    before += raw.length;

    if (size.w <= ICON_PX && size.h <= ICON_PX) {
      after += raw.length;
      console.log(`${file}  ${size.w}×${size.h}  ${kb(raw.length)} — already small enough`);
      continue;
    }

    const out = await encode(`data:image/png;base64,${raw.toString('base64')}`, {
      maxW: ICON_PX,
      maxH: ICON_PX,
      type: 'image/png',
    });
    const bytes = Buffer.from(out.data, 'base64');
    writeFileSync(path, bytes);
    after += bytes.length;
    console.log(
      `${file}  ${size.w}×${size.h} → ${out.w}×${out.h}  ${kb(raw.length)} → ${kb(bytes.length)}`,
    );
  }

  const spriteRaw = readFileSync(spritePath);
  const spriteSize = pngSize(spriteRaw);
  const sprite = await encode(`data:image/png;base64,${spriteRaw.toString('base64')}`, {
    maxW: SPRITE_W,
    maxH: (SPRITE_W * spriteSize.h) / spriteSize.w,
    quality: SPRITE_QUALITY,
  });
  const spriteBytes = Buffer.from(sprite.data, 'base64');
  const spriteOut = spritePath.replace(/\.png$/, '.webp');
  writeFileSync(spriteOut, spriteBytes);
  before += spriteRaw.length;
  after += spriteBytes.length;
  console.log(
    `areochat_icons.png  ${spriteSize.w}×${spriteSize.h} → ${sprite.w}×${sprite.h}  ` +
      `${kb(spriteRaw.length)} → ${kb(spriteBytes.length)} (areochat_icons.webp)`,
  );

  const pct = Math.round((1 - after / before) * 100);
  console.log(`\nTotal ${kb(before)} → ${kb(after)} (−${pct}%)`);
  // The source PNG is not deleted for us: it is checked in, and removing a
  // tracked file is a decision for whoever runs this, not for the script.
  if (statSync(spritePath, { throwIfNoEntry: false })) {
    console.log('\nareochat_icons.png is now unused — `git rm` it once the CSS points at .webp.');
  }
});
