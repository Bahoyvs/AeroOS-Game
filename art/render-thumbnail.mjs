/**
 * Render art/thumbnail.svg to a 1920×1080 PNG for the portal.
 *
 * Uses whatever Chromium is already on the machine rather than adding an image
 * toolchain to the dependency tree — this runs about twice a month, and a
 * headless screenshot of an SVG is exactly as good as a rasteriser for a file
 * with no filters a browser cannot do.
 *
 *   node art/render-thumbnail.mjs [--out art/thumbnail.png]
 *
 * It drives the browser over the devtools protocol rather than using
 * `--screenshot`, because that flag sizes its output to the *window* and then
 * pads the difference with the browser's own chrome — a 1920×1080 window
 * produces 1920×1080 of PNG with about ninety black pixels along the bottom and
 * the artwork squeezed above them. `Page.captureScreenshot` takes an explicit
 * clip and gives back exactly the frame asked for.
 *
 * Point CHROME at a binary if it is not in one of the usual places.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WIDTH = 1920;
const HEIGHT = 1080;

const here = dirname(fileURLToPath(import.meta.url));
const svg = resolve(here, 'thumbnail.svg');

const outFlag = process.argv.indexOf('--out');
const out = outFlag === -1 ? resolve(here, 'thumbnail.png') : resolve(process.argv[outFlag + 1]);

const CANDIDATES = [
  process.env.CHROME,
  process.env.PLAYWRIGHT_BROWSERS_PATH && join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium'),
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

const port = 9333 + (process.pid % 500);
const profile = mkdtempSync(join(tmpdir(), 'aeroos-thumb-'));
const browser = spawn(
  chrome,
  [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] },
);

/** The debugging endpoint is not up the instant the process is. */
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
      pending.get(message.id)(message.result ?? {});
      pending.delete(message.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve_) => {
      const n = (id += 1);
      pending.set(n, resolve_);
      ws.send(JSON.stringify({ id: n, method, params }));
    });

  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.navigate', { url: `file://${svg}` });
  // Fonts and the filter chain need a beat; there is no load event worth
  // racing on a single static SVG.
  await wait(1200);

  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 1 },
  });
  if (!data) throw new Error('Chromium returned no image');
  writeFileSync(out, Buffer.from(data, 'base64'));
  ws.close();
  console.log(`Wrote ${out} (${WIDTH}×${HEIGHT})`);
} finally {
  browser.kill();
}
