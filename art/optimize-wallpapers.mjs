/**
 * Recompress the source wallpapers into the ones the game actually ships.
 *
 *   node art/optimize-wallpapers.mjs
 *
 * Reads art/wallpapers-src/*.jpg and writes two files per source into
 * src/assets/wallpapers/: `<name>.jpg` (the desktop, fitted to MAX_W×MAX_H at
 * QUALITY) and `<name>-thumb.jpg` (the swatch in Display Properties).
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
 * It uses whatever Chromium is already on the machine rather than adding an
 * image toolchain to the dependency tree — same argument, and the same
 * devtools plumbing, as art/render-thumbnail.mjs. This runs when the art
 * changes, which is roughly never.
 *
 * Point CHROME at a binary if it is not in one of the usual places.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const CANDIDATES = [
  process.env.CHROME,
  process.env.PLAYWRIGHT_BROWSERS_PATH && join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/opt/pw-browsers/chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const chrome = CANDIDATES.find((path) => existsSync(path));
if (!chrome) {
  console.error(`No Chromium found. Tried:\n  ${CANDIDATES.join('\n  ')}\nSet CHROME=/path/to/chrome.`);
  process.exit(1);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const sources = readdirSync(srcDir).filter((f) => /\.jpe?g$/i.test(f));
if (sources.length === 0) {
  console.error(`No .jpg files in ${srcDir}`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const port = 9333 + (process.pid % 500);
const profile = mkdtempSync(join(tmpdir(), 'aeroos-wall-'));
const browser = spawn(
  chrome,
  [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] },
);

async function endpoint() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((target) => target.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* not listening yet */
    }
    await wait(200);
  }
  throw new Error('Chromium never opened its devtools port');
}

try {
  const ws = new WebSocket(await endpoint());
  await new Promise((resolve_, reject) => {
    ws.onopen = resolve_;
    ws.onerror = reject;
  });

  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve_) => {
      const n = (id += 1);
      pending.set(n, resolve_);
      ws.send(JSON.stringify({ id: n, method, params }));
    });

  /**
   * The image goes in as a data: URI rather than a file:// URL. A headless
   * page navigated to about:blank cannot read the local disk, and granting it
   * that access to save one base64 round-trip is not a trade worth making.
   */
  async function encode(dataUri, maxW, maxH, quality) {
    const { result, exceptionDetails } = await send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        const img = new Image();
        img.src = ${JSON.stringify(dataUri)};
        await img.decode();
        const scale = Math.min(1, ${maxW} / img.naturalWidth, ${maxH} / img.naturalHeight);
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        return { w, h, data: canvas.toDataURL('image/jpeg', ${quality}).split(',')[1] };
      })()`,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? 'encode failed');
    return result.result.value;
  }

  let before = 0;
  let after = 0;
  const kb = (n) => `${Math.round(n / 1024)} kB`;

  for (const file of sources) {
    const raw = readFileSync(join(srcDir, file));
    const uri = `data:image/jpeg;base64,${raw.toString('base64')}`;
    const name = basename(file, extname(file));

    const full = await encode(uri, MAX_W, MAX_H, QUALITY);
    const thumb = await encode(uri, THUMB_W, THUMB_W, THUMB_QUALITY);

    const fullBytes = Buffer.from(full.data, 'base64');
    const thumbBytes = Buffer.from(thumb.data, 'base64');
    writeFileSync(join(outDir, `${name}.jpg`), fullBytes);
    writeFileSync(join(outDir, `${name}-thumb.jpg`), thumbBytes);

    before += raw.length;
    after += fullBytes.length + thumbBytes.length;
    console.log(
      `${file}  ${full.w}×${full.h}  ${kb(raw.length)} → ${kb(fullBytes.length)}` +
        `  (+ ${thumb.w}×${thumb.h} thumb, ${kb(thumbBytes.length)})`,
    );
  }

  const pct = Math.round((1 - after / before) * 100);
  console.log(`\nTotal ${(before / 1048576).toFixed(2)} MB → ${(after / 1048576).toFixed(2)} MB (−${pct}%)`);
  ws.close();
} finally {
  browser.kill();
}
