/**
 * The image encoder the art scripts share.
 *
 * There is no image toolchain in this repo's dependency tree and there does not
 * need to be one: every machine that can build this game already has a Chromium,
 * and a canvas resize plus `toDataURL` is exactly the operation these scripts
 * want. Same argument, and originally the same eighty lines of devtools
 * plumbing, as art/render-thumbnail.mjs — the plumbing lives here now so that
 * adding a second asset script does not mean maintaining a second copy of it.
 *
 * Point CHROME at a binary if it is not in one of the usual places.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function findChromium() {
  const chrome = CANDIDATES.find((path) => existsSync(path));
  if (!chrome) {
    console.error(
      `No Chromium found. Tried:\n  ${CANDIDATES.join('\n  ')}\nSet CHROME=/path/to/chrome.`,
    );
    process.exit(1);
  }
  return chrome;
}

/**
 * Run `job(encode)` against a headless Chromium, then close it.
 *
 * `encode(dataUri, { maxW, maxH, type, quality })` scales the image down to fit
 * the box — never up — and returns `{ w, h, data }`, `data` being base64 of the
 * re-encoded file. `type` is a MIME type the browser can write: 'image/webp',
 * 'image/jpeg' or 'image/png' (which ignores `quality`).
 */
export async function withEncoder(job) {
  const chrome = findChromium();
  const port = 9333 + (process.pid % 500);
  const profile = mkdtempSync(join(tmpdir(), 'aeroos-img-'));
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
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
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
      new Promise((resolve) => {
        const n = (id += 1);
        pending.set(n, resolve);
        ws.send(JSON.stringify({ id: n, method, params }));
      });

    /**
     * The image goes in as a data: URI rather than a file:// URL. A headless page
     * navigated to about:blank cannot read the local disk, and granting it that
     * access to save one base64 round-trip is not a trade worth making.
     */
    async function encode(dataUri, { maxW, maxH, type = 'image/webp', quality = 0.82 }) {
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
          const url = canvas.toDataURL(${JSON.stringify(type)}, ${quality});
          // A format the browser cannot write comes back as a PNG data URI, and
          // silently shipping a PNG named .webp is worse than failing here.
          if (!url.startsWith('data:' + ${JSON.stringify(type)})) {
            throw new Error('this Chromium cannot encode ' + ${JSON.stringify(type)});
          }
          return { w, h, data: url.split(',')[1] };
        })()`,
      });
      if (exceptionDetails) {
        throw new Error(exceptionDetails.exception?.description ?? 'encode failed');
      }
      return result.result.value;
    }

    const outcome = await job(encode);
    ws.close();
    return outcome;
  } finally {
    browser.kill();
  }
}

export const kb = (n) => `${Math.round(n / 1024)} kB`;
