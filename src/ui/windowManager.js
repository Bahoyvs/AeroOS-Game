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
/**
 * Fallback width for the desktop icon column, used only when it cannot be
 * measured. The live width is read instead (see `iconColumnWidth`) because the
 * column *wraps*: with the full twelve-building roster installed it becomes two
 * columns, and a hard-coded 112 put every new window straight on top of the
 * second one — the icons were still on screen and still perfectly unreachable.
 */
const ICON_COLUMN_WIDTH = 112;
const EDGE_MARGIN = 8;
const SHEET_DISMISS_PX = 90; // drag a PDA modal down this far to dismiss it

/** Clamp that stays sane when max < min (a window dragged to the far edge). */
const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));

/**
 * Where focus goes when a desktop anchor hands it back. The Start button is the
 * one control that is always present and always means "you are out of whatever
 * you were in", which is exactly what Escape should buy you.
 */
const ESCAPE_TARGETS = ['#taskbar .start', '#taskbar button', '#icons button'];

export function createWindowManager({
  root,
  anchorRoot = null,
  iconRoot = null,
  mobileQuery = '(max-width: 820px)',
}) {
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

  /**
   * A desktop anchor (GDD §5): chrome-less, centred, and not closable by hand.
   *
   * "Un-closable" is a statement about the *fiction*, not about the player. The
   * accessibility contract (GDD §14.4) is written into this frame:
   *
   * - `tabindex="0"` — un-closable must never mean un-focusable. It is reachable
   *   by Tab like any other control.
   * - It lives in `#anchors`, which the document places after the taskbar, so
   *   the tab order is windows -> Start/taskbar/hardware -> here. Last, not
   *   first, and never a barrier in front of the OS.
   * - `aria-live="polite"` — a screen reader hears the level and rate change
   *   without having to go looking, and politely, so it never interrupts.
   * - Escape blurs it and hands focus back to the Start button (see below).
   *   Every other window uses Escape to minimise; this one cannot minimise, so
   *   Escape has to mean the same *thing* by a different mechanism, or the one
   *   window the player cannot dismiss is also the one they cannot leave.
   *
   * There is deliberately no focus trap, no `aria-modal`, and no inert on the
   * rest of the page. The Hive is the climax of a story about losing control of
   * your own machine; it is not licence to actually take a keyboard user's.
   */
  function buildAnchorFrame(app) {
    const el = document.createElement('section');
    el.className = 'window-anchor';
    el.dataset.appId = app.id;
    el.dataset.footprint = 'anchor';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', app.name);
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('tabindex', '0');
    el.innerHTML = '<div class="window-anchor__body aero-window__body"></div>';
    return el;
  }

  /** Escape out of an anchor: blur, then hand focus to the first OS control. */
  function escapeAnchor(el) {
    el.blur();
    for (const selector of ESCAPE_TARGETS) {
      const target = document.querySelector(selector);
      if (target) {
        target.focus();
        return true;
      }
    }
    // Nothing to hand off to (a stripped test page); blurring is still an exit.
    return false;
  }

  /** How wide the icon column actually is right now, wrapped columns included. */
  function iconColumnWidth() {
    const width = iconRoot?.getBoundingClientRect().width;
    return width > 0 ? Math.ceil(width) + 8 : ICON_COLUMN_WIDTH;
  }

  function initialRect(app) {
    const width = Math.min(app.window?.width ?? 360, window.innerWidth - 32);
    const height = Math.min(app.window?.height ?? 300, window.innerHeight - TASKBAR_HEIGHT - 32);
    const offset = (cascadeIndex++ % 6) * CASCADE_STEP;
    return {
      // Start right of the icon column so the first window never buries it.
      x: Math.max(12, Math.min(iconColumnWidth() + offset, window.innerWidth - width - 12)),
      y: Math.max(12, Math.min(36 + offset, window.innerHeight - height - TASKBAR_HEIGHT - 12)),
      width,
      height,
    };
  }

  function applyRect(entry) {
    const { el, rect } = entry;
    // Anchors are centred by the stylesheet and have no geometry of their own.
    if (entry.anchor || isMobile()) {
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
    // Anchors are outside the z-order competition — they live in their own
    // stacking container and never cover, or get covered by, a real window.
    if (entry.anchor) {
      handlers.emit('focus', { id });
      return;
    }
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

    const anchor = app.footprint === 'anchor';
    const el = anchor ? buildAnchorFrame(app) : buildFrame(app);
    const entry = { id: app.id, app, el, anchor, rect: initialRect(app), cleanup: null };
    windows.set(app.id, entry);

    if (anchor) {
      /**
       * The Escape catch (GDD §14.4). Handled here rather than in the app
       * module so the behaviour belongs to the *footprint* — any future anchor
       * inherits it, and a window that cannot be dismissed can never ship
       * without a way out.
       */
      el.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        escapeAnchor(el);
        handlers.emit('escape', { id: app.id });
      });
    } else {
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
    }

    applyRect(entry);
    (anchor ? (anchorRoot ?? root) : root).appendChild(el);
    // Next frame so the entry animation actually plays.
    requestAnimationFrame(() => el.classList.add('is-open'));

    const body = el.querySelector(anchor ? '.window-anchor__body' : '.aero-window__body');
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
    // An anchor has nowhere to minimise *to* — no task button, no title bar.
    // Refusing here rather than at every call site keeps the one rule in the
    // one place that owns footprints.
    if (entry.anchor) return;
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

  /**
   * Keep windows on screen when the viewport changes, and drop inline geometry
   * when crossing into PDA mode.
   *
   * Size before position, and both of them: this used to clamp only x/y, so a
   * window opened on a large viewport kept its width and height on a small one
   * and pushed its own bottom edge — AeroChat's buy row, AeroSweeper's cash-out —
   * off the screen, with the position clamp reporting everything as fine because
   * the *top-left corner* was still in bounds. Phones vary enough in aspect ratio
   * for that to happen without anybody rotating anything.
   *
   * The ceilings are the ones `initialRect()` uses, so a window that reflows onto
   * a smaller viewport ends up the size it would have opened at there. The
   * position clamp runs afterwards, on the new size, or a shrunk window would be
   * left positioned by geometry it no longer has.
   *
   * The vertical bound is the whole window rather than `dragBounds`'s "keep some
   * of the title bar reachable": dragging a window down behind the taskbar is a
   * choice the player made, a viewport that got shorter is not, and the bottom
   * edge is where an app puts the button the window is for.
   */
  const reflow = () => {
    for (const entry of windows.values()) {
      if (entry.anchor) continue; // centred by CSS; no geometry to clamp
      const { rect } = entry;
      rect.width = clamp(rect.width, MIN_WIDTH, window.innerWidth - 32);
      rect.height = clamp(rect.height, MIN_HEIGHT, window.innerHeight - TASKBAR_HEIGHT - 32);

      const { maxX } = dragBounds(rect);
      const maxY = window.innerHeight - TASKBAR_HEIGHT - rect.height - EDGE_MARGIN;
      rect.x = Math.max(0, Math.min(rect.x, maxX));
      rect.y = clamp(rect.y, 0, maxY);
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
    isAnchor: (id) => windows.get(id)?.anchor === true,
    body: (id) => {
      const entry = windows.get(id);
      if (!entry) return null;
      return entry.el.querySelector(entry.anchor ? '.window-anchor__body' : '.aero-window__body');
    },
    get openIds() {
      return [...windows.keys()];
    },
    /** Ids that behave like ordinary windows — task buttons, RAM bars, Alt-Tab. */
    get windowIds() {
      return [...windows.values()].filter((e) => !e.anchor).map((e) => e.id);
    },
    get isMobile() {
      return isMobile();
    },
    /** Subscribe to 'focus' | 'close' | 'minimize' | 'escape'. Unsubscribes. */
    on(event, fn) {
      return handlers.on(event, fn);
    },
  };
}
