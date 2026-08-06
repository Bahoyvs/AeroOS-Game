/** Small DOM helpers so UI modules stay readable without a framework. */

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Run at most once per `ms` — used to keep per-frame UI refreshes cheap. */
export function throttle(fn, ms) {
  let last = 0;
  return (...args) => {
    const now = performance.now();
    if (now - last < ms) return;
    last = now;
    fn(...args);
  };
}

/**
 * Fill a progress bar element, clamped, with a tone class for warn/critical.
 *
 * The ratio is published as a custom property and the stylesheet decides how to
 * draw it — `transform: scaleX()` for a plain bar (composited, so a full bar
 * costs the compositor a matrix and the main thread nothing), `clip-path` for
 * one with a striped overlay that must not be squashed with it.
 *
 * Whatever a fill uses, its transition must be no longer than the interval its
 * caller updates on. A 200ms transition rewritten every 100ms never reaches its
 * target: it is cancelled and restarted forever, which reads as a bar that
 * lags and stutters instead of one that moves.
 */
export function setBar(fillEl, ratio, { warn = 0.75, critical = 0.9 } = {}) {
  const r = Math.max(0, Math.min(ratio, 1));
  fillEl.style.setProperty('--fill', String(r));
  fillEl.classList.toggle('is-warn', r >= warn && r < critical);
  fillEl.classList.toggle('is-critical', r >= critical);
}
