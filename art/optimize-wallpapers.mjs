/**
 * Recompress the source wallpapers into the ones the game actually ships.
 *
 *   node art/optimize-wallpapers.mjs
 *
 * Reads art/wallpapers-src/*.jpg and writes two files per source into
 * src/assets/wallpapers/: `<name>.webp` (the desktop, fitted to MAX_W×MAX_H at
 * QUALITY) and `<name>-thumb.webp` (the swatch in Display Properties).
 *
 * The thumbnail is not an optimisation detail. The picker shows every
 * wallpaper at once, so without it, opening My Computer downloads the entire
 * set at full size — more bytes than the rest of the game put together, to
 * fill four chips eighteen pixels wide.
 *
 * Why this exists: the originals are 1920×1200 at ~2.1 MB each, which is
 * roughly six times what that resolution needs and eight megabytes of first
 * load for a game whose entire JS bundle is 55 kB gzipped. A portal counts a
 * load that never finishes as a session with no gameplay in it, and a desktop
 * wallpaper is the one asset that blocks the first frame.
 *
 * WebP rather than JPEG, which is where the last third of the weight went: the
 * same photograph at the same visual quality is 40-60% smaller, and every
 * browser that can run this game has decoded WebP for years. The output names
 * are the only thing styles/themes.css has to agree with.
 *
 * It uses whatever Chromium is already on the machine rather than adding an
 * image toolchain to the dependency tree — see art/lib/chromium.mjs. This runs
 * when the art changes, which is roughly never.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kb, withEncoder } from './lib/chromium.mjs';

const MAX_W = 1920;
const MAX_H = 1200;
/** 0.82 is where this set stops losing anything visible to the eye at 100%. */
const QUALITY = 0.82;

/** The swatch chip is 18px wide; 192 covers it on a 3× phone with room over. */
const THUMB_W = 192;
const THUMB_QUALITY = 0.72;

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, 'wallpapers-src');
const outDir = resolve(here, '..', 'src', 'assets', 'wallpapers');

const sources = readdirSync(srcDir).filter((f) => /\.jpe?g$/i.test(f));
if (sources.length === 0) {
  console.error(`No .jpg files in ${srcDir}`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

await withEncoder(async (encode) => {
  let before = 0;
  let after = 0;

  for (const file of sources) {
    const raw = readFileSync(join(srcDir, file));
    const uri = `data:image/jpeg;base64,${raw.toString('base64')}`;
    const name = basename(file, extname(file));

    const full = await encode(uri, { maxW: MAX_W, maxH: MAX_H, quality: QUALITY });
    const thumb = await encode(uri, { maxW: THUMB_W, maxH: THUMB_W, quality: THUMB_QUALITY });

    const fullBytes = Buffer.from(full.data, 'base64');
    const thumbBytes = Buffer.from(thumb.data, 'base64');
    writeFileSync(join(outDir, `${name}.webp`), fullBytes);
    writeFileSync(join(outDir, `${name}-thumb.webp`), thumbBytes);

    before += raw.length;
    after += fullBytes.length + thumbBytes.length;
    console.log(
      `${file}  ${full.w}×${full.h}  ${kb(raw.length)} → ${kb(fullBytes.length)}` +
        `  (+ ${thumb.w}×${thumb.h} thumb, ${kb(thumbBytes.length)})`,
    );
  }

  const pct = Math.round((1 - after / before) * 100);
  console.log(
    `\nTotal ${(before / 1048576).toFixed(2)} MB → ${(after / 1048576).toFixed(2)} MB (−${pct}%)`,
  );
});
