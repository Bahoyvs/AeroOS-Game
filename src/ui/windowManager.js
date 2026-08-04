import { createEventBus } from '../core/events.js';

/**
 * Window manager (AO-4).
 *
 * Desktop: windows are freely draggable, resizable and overlapping, with a
 * focus stack that decides z-order.
 * Mobile (PDA mode): dragging and resizing are disabled and a window becomes a
 * full-screen modal that slides up from the taskbar (GDD 3).
 *
 * Pointer events are used throughout so mouse, touch and pen behave the same.
 */

const MIN_WIDTH = 260;
const MIN_HEIGHT = 180;
const CASCADE_STEP = 28;
const TASKBAR_HEIGHT = 44;
const ICON_COLUMN_WIDTH = 112; // keeps cascaded windows clear of desktop icons
const EDGE_MARGIN = 8;
const SHEET_DISMISS_PX = 90; // drag a PDA modal down this far to dismiss it

/** Clamp that stays sane when max < min (a window dragged to the far edge). */
const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));

export function createWindowManager({ root, mobileQuery = '(max-width: 820px)' }) {
  const windows = new Map();
  const focusOrder = [];
  const media = globalThis.matchMedia?.(mobileQuery) ?? { matches: false, addEventListener() {} };
  let nextZ = 10;
  let cascadeIndex = 0;
  // A bus, not a single callback slot: both main.js (release the app's RAM) and
  // taskbar.js (drop the task button) listen for 'close', and an assignment-based
  // registry silently let whichever registered last win.
  const handlers = createEventBus();

  const isMobile = () => media.matches;

  /* ---------------------------------------------------------------- build */

  function buildFrame(app) {
    const el = document.createElement('section');
    el.className = 'window glass aero-window';
    el.dataset.appId = app.id;
    // Deliberately NOT role="dialog": 7.css treats `.window[role=dialog]` as a
    // :target-driven modal and keeps it visibility:hidden. These are non-modal
    // application windows, so a labelled region is both correct and visible.
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', app.name);
    el.innerHTML = `
      <div class="title-bar" data-drag-handle>
        <div class="title-bar-text">
          <img class="aero-window__icon" aria-hidden="true" src="${app.icon ?? ''}" alt="">
          ${app.name}
        </div>
        <div class="title-bar-controls">
          <button aria-label="Minimize" data-action="minimize"></button>
          <button aria-label="Close" data-action="close"></button>
        </div>
      </div>
      <div class="window-body has-space aero-window__body"></div>
      <div class="aero-window__resize" data-resize-handle aria-hidden="true"></div>
    `;
    return el;
  }

  function initialRect(app) {
    const width = Math.min(app.window?.width ?? 360, window.innerWidth - 32);
    const height = Math.min(app.window?.height ?? 300, window.innerHeight - TASKBAR_HEIGHT - 32);
    const offset = (cascadeIndex++ % 6) * CASCADE_STEP;
    return {
      // Start right of the icon column so the first window never buries it.
      x: Math.max(12, Math.min(ICON_COLUMN_WIDTH + offset, window.innerWidth - width - 12)),
      y: Math.max(12, Math.min(36 + offset, window.innerHeight - height - TASKBAR_HEIGHT - 12)),
      width,
      height,
    };
  }

  function applyRect(entry) {
    const { el, rect } = entry;
    if (isMobile()) {
      el.style.left = el.style.top = el.style.width = el.style.height = '';
      return;
    }
    el.style.left = `${rect.x}px`;
    el.style.top = `${rect.y}px`;
    el.style.width = `${rect.width}px`;
    el.style.height = `${rect.height}px`;
  }

  /* ---------------------------------------------------------------- focus */

  function focus(id) {
    const entry = windows.get(id);
    if (!entry) return;
    const i = focusOrder.indexOf(id);
    if (i !== -1) focusOrder.splice(i, 1);
    focusOrder.push(id);

    entry.el.style.zIndex = String(++nextZ);
    for (const [otherId, other] of windows) {
      other.el.classList.toggle('active', otherId === id);
      other.el.classList.toggle('inactive', otherId !== id);
    }
    handlers.emit('focus', { id });
  }

  /* ----------------------------------------------------------- drag/resize */

  function dragBounds(rect) {
    return {
      maxX: window.innerWidth - Math.min(rect.width, 80),
      maxY: window.innerHeight - TASKBAR_HEIGHT - 32,
    };
  }

  /**
   * PDA mode (AO-23): a full-screen modal is dismissed by dragging its title
   * bar down, the way a sheet behaves on a phone. Anything short of the
   * threshold springs back, so a stray touch never loses the window.
   */
  function beginSheetDrag(entry, event) {
    if (event.target.closest('.title-bar-controls')) return;

    const startY = event.clientY;
    let offset = 0;
    entry.el.setPointerCapture(event.pointerId);
    entry.el.classList.add('is-sheet-dragging');

    const move = (e) => {
      offset = Math.max(0, e.clientY - startY);
      entry.el.style.transform = `translateY(${offset}px)`;
    };
    const end = () => {
      entry.el.style.transform = '';
      entry.el.classList.remove('is-sheet-dragging');
      entry.el.removeEventListener('pointermove', move);
      entry.el.removeEventListener('pointerup', end);
      entry.el.removeEventListener('pointercancel', end);
      if (offset >= SHEET_DISMISS_PX) minimize(entry.id);
    };

    entry.el.addEventListener('pointermove', move);
    entry.el.addEventListener('pointerup', end);
    entry.el.addEventListener('pointercancel', end);
  }

  function beginDrag(entry, event) {
    if (isMobile()) {
      beginSheetDrag(entry, event);
      return;
    }
    if (event.button !== 0) return;
    if (event.target.closest('.title-bar-controls')) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { ...entry.rect };
    entry.el.classList.add('is-dragging');
    entry.el.setPointerCapture(event.pointerId);

    const move = (e) => {
      const { maxX, maxY } = dragBounds(entry.rect);
      entry.rect.x = Math.max(-entry.rect.width + 80, Math.min(origin.x + e.clientX - startX, maxX));
      entry.rect.y = Math.max(0, Math.min(origin.y + e.clientY - startY, maxY));
      applyRect(entry);
    };
    const end = () => {
      entry.el.classList.remove('is-dragging');
      entry.el.removeEventListener('pointermove', move);
      entry.el.removeEventListener('pointerup', end);
      entry.el.removeEventListener('pointercancel', end);
    };

    entry.el.addEventListener('pointermove', move);
    entry.el.addEventListener('pointerup', end);
    entry.el.addEventListener('pointercancel', end);
    event.preventDefault();
  }

  function beginResize(entry, event) {
    if (isMobile() || event.button !== 0) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { ...entry.rect };
    entry.el.classList.add('is-resizing');
    entry.el.setPointerCapture(event.pointerId);

    const move = (e) => {
      // Clamp to the desktop: a window larger than the screen just pushes its
      // own controls out of reach.
      const maxWidth = window.innerWidth - entry.rect.x - EDGE_MARGIN;
      const maxHeight = window.innerHeight - TASKBAR_HEIGHT - entry.rect.y - EDGE_MARGIN;

      entry.rect.width = clamp(origin.width + e.clientX - startX, MIN_WIDTH, maxWidth);
      entry.rect.height = clamp(origin.height + e.clientY - startY, MIN_HEIGHT, maxHeight);
      applyRect(entry);
      entry.onResize?.(entry.rect);
    };
    const end = () => {
      entry.el.classList.remove('is-resizing');
      entry.el.removeEventListener('pointermove', move);
      entry.el.removeEventListener('pointerup', end);
      entry.el.removeEventListener('pointercancel', end);
    };

    entry.el.addEventListener('pointermove', move);
    entry.el.addEventListener('pointerup', end);
    entry.el.addEventListener('pointercancel', end);
    event.preventDefault();
    event.stopPropagation();
  }

  /* ------------------------------------------------------------------ api */

  /**
   * Open a window for `app`. `mount(bodyEl, api)` renders the contents and may
   * return a cleanup function, which runs when the window closes.
   */
  function open(app, mount) {
    if (windows.has(app.id)) {
      restore(app.id);
      focus(app.id);
      return windows.get(app.id);
    }

    const el = buildFrame(app);
    const entry = { id: app.id, app, el, rect: initialRect(app), cleanup: null };
    windows.set(app.id, entry);

    el.querySelector('[data-drag-handle]').addEventListener('pointerdown', (e) => {
      focus(app.id);
      beginDrag(entry, e);
    });
    el.querySelector('[data-resize-handle]').addEventListener('pointerdown', (e) =>
      beginResize(entry, e),
    );
    el.addEventListener('pointerdown', () => focus(app.id));
    el.querySelector('[data-action="close"]').addEventListener('click', () => close(app.id));
    el.querySelector('[data-action="minimize"]').addEventListener('click', () => minimize(app.id));

    applyRect(entry);
    root.appendChild(el);
    // Next frame so the entry animation actually plays.
    requestAnimationFrame(() => el.classList.add('is-open'));

    const body = el.querySelector('.aero-window__body');
    entry.cleanup = mount?.(body, { close: () => close(app.id), focus: () => focus(app.id) }) ?? null;
    focus(app.id);
    return entry;
  }

  function close(id) {
    const entry = windows.get(id);
    if (!entry) return;
    entry.cleanup?.();
    entry.el.classList.remove('is-open');
    entry.el.addEventListener('transitionend', () => entry.el.remove(), { once: true });
    // Belt and braces: if the transition never fires, drop the node anyway.
    setTimeout(() => entry.el.remove(), 400);

    windows.delete(id);
    const i = focusOrder.indexOf(id);
    if (i !== -1) focusOrder.splice(i, 1);
    handlers.emit('close', { id });

    const top = focusOrder.at(-1);
    if (top) focus(top);
  }

  function minimize(id) {
    const entry = windows.get(id);
    if (!entry) return;
    entry.el.classList.add('is-minimized');
    entry.minimized = true;
    handlers.emit('minimize', { id, minimized: true });
    const next = focusOrder.filter((wid) => wid !== id && !windows.get(wid)?.minimized).at(-1);
    if (next) focus(next);
  }

  function restore(id) {
    const entry = windows.get(id);
    if (!entry) return;
    entry.el.classList.remove('is-minimized');
    entry.minimized = false;
    handlers.emit('minimize', { id, minimized: false });
    focus(id);
  }

  function toggleMinimize(id) {
    const entry = windows.get(id);
    if (!entry) return;
    if (entry.minimized) restore(id);
    else if (focusOrder.at(-1) === id) minimize(id);
    else focus(id);
  }

  // Keep windows on screen when the viewport changes, and drop inline geometry
  // when crossing into PDA mode.
  const reflow = () => {
    for (const entry of windows.values()) {
      const { maxX, maxY } = dragBounds(entry.rect);
      entry.rect.x = Math.max(0, Math.min(entry.rect.x, maxX));
      entry.rect.y = Math.max(0, Math.min(entry.rect.y, maxY));
      applyRect(entry);
    }
  };
  window.addEventListener('resize', reflow);
  media.addEventListener?.('change', reflow);

  return {
    open,
    close,
    focus,
    minimize,
    restore,
    toggleMinimize,
    isOpen: (id) => windows.has(id),
    isMinimized: (id) => windows.get(id)?.minimized === true,
    body: (id) => windows.get(id)?.el.querySelector('.aero-window__body') ?? null,
    get openIds() {
      return [...windows.keys()];
    },
    get isMobile() {
      return isMobile();
    },
    /** Subscribe to 'focus' | 'close' | 'minimize'. Returns an unsubscribe. */
    on(event, fn) {
      return handlers.on(event, fn);
    },
  };
}
