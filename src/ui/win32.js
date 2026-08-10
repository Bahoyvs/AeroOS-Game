import { clear, el } from './dom.js';

/**
 * Win32 common controls.
 *
 * Every application in this era was assembled from the same handful of system
 * widgets — a menu bar, a tab strip, a spinner, a split button, a status bar —
 * and *that shared vocabulary is why period software looked coherent*. So these
 * live in one place and every app composes them differently.
 *
 * This is emphatically **not** the generic purchase panel coming back. Nothing
 * here knows what a building is, what a unit costs, or that this is an idle
 * game. They are the widgets; the fiction is what each app builds out of them.
 */

/* --------------------------------------------------------------- menu bar */

/**
 * A classic menu bar: `File  Edit  View  Help`.
 *
 * Behaves the way Windows menus did, which matters more than it sounds — once
 * one menu is open, *hovering* another opens it, and Escape closes everything.
 * A menu bar that needs a click per menu reads as a web imitation immediately.
 *
 * `menus` is `[{ label, items: [{ label, onSelect, disabled, checked } | 'separator'] }]`.
 */
export function menuBar(menus) {
  const bar = el('div', { class: 'w32-menubar', role: 'menubar' });
  let open = null;

  function closeAll() {
    if (!open) return;
    open.popup.remove();
    open.button.setAttribute('aria-expanded', 'false');
    open = null;
  }

  function openMenu(menu, button) {
    closeAll();
    const popup = el('div', { class: 'w32-menu', role: 'menu' });

    for (const item of menu.items) {
      if (item === 'separator') {
        popup.appendChild(el('div', { class: 'w32-menu__sep', role: 'separator' }));
        continue;
      }
      popup.appendChild(
        el('button', {
          type: 'button',
          class: `w32-menu__item${item.checked ? ' is-checked' : ''}`,
          role: 'menuitem',
          disabled: item.disabled ? '' : null,
          onclick: () => {
            closeAll();
            item.onSelect?.();
          },
        }, [
          el('span', { class: 'w32-menu__tick', 'aria-hidden': 'true', text: item.checked ? '✓' : '' }),
          el('span', { class: 'w32-menu__label', text: item.label }),
          item.hint ? el('span', { class: 'w32-menu__hint', text: item.hint }) : null,
        ]),
      );
    }

    // Positioned against the button rather than the bar, so a menu near the
    // right edge still lines up with the word that opened it.
    const rect = button.getBoundingClientRect();
    popup.style.left = `${rect.left}px`;
    popup.style.top = `${rect.bottom}px`;
    document.body.appendChild(popup);
    button.setAttribute('aria-expanded', 'true');
    open = { popup, button };
    popup.querySelector('button:not(:disabled)')?.focus();
  }

  for (const menu of menus) {
    const button = el('button', {
      type: 'button',
      class: 'w32-menubar__item',
      role: 'menuitem',
      'aria-haspopup': 'true',
      'aria-expanded': 'false',
      text: menu.label,
      onclick: (e) => {
        e.stopPropagation();
        if (open?.button === button) closeAll();
        else openMenu(menu, button);
      },
      // Windows behaviour: with a menu already down, sliding across the bar
      // opens each one in turn.
      onpointerenter: () => {
        if (open && open.button !== button) openMenu(menu, button);
      },
    });
    bar.appendChild(button);
  }

  const onOutside = (e) => {
    if (!open) return;
    if (open.popup.contains(e.target) || bar.contains(e.target)) return;
    closeAll();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') closeAll();
  };
  document.addEventListener('pointerdown', onOutside);
  document.addEventListener('keydown', onKey);

  bar.destroy = () => {
    closeAll();
    document.removeEventListener('pointerdown', onOutside);
    document.removeEventListener('keydown', onKey);
  };
  return bar;
}

/* -------------------------------------------------------------- tab strip */

/**
 * A tab control. Returns `{ el, panels, select, active }` where `panels` maps
 * each tab id to an empty `<div>` for the caller to fill.
 */
export function tabStrip(tabs, { onSelect = null } = {}) {
  const strip = el('div', { class: 'w32-tabs', role: 'tablist' });
  const bodies = el('div', { class: 'w32-tabs__bodies' });
  const panels = {};
  const buttons = {};
  let active = tabs[0]?.id ?? null;

  function select(id) {
    if (!panels[id]) return;
    active = id;
    for (const [key, button] of Object.entries(buttons)) {
      const on = key === id;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-selected', String(on));
      button.tabIndex = on ? 0 : -1;
      panels[key].hidden = !on;
    }
    onSelect?.(id);
  }

  for (const tab of tabs) {
    const panel = el('div', { class: 'w32-tabs__panel', role: 'tabpanel', id: `panel-${tab.id}` });
    panels[tab.id] = panel;
    bodies.appendChild(panel);

    const button = el('button', {
      type: 'button',
      class: 'w32-tabs__tab',
      role: 'tab',
      'aria-controls': `panel-${tab.id}`,
      text: tab.label,
      onclick: () => select(tab.id),
      onkeydown: (e) => {
        // Arrow keys move between tabs, as they do in a real tab control.
        const order = tabs.map((t) => t.id);
        const i = order.indexOf(tab.id);
        if (e.key === 'ArrowRight') select(order[(i + 1) % order.length]);
        if (e.key === 'ArrowLeft') select(order[(i - 1 + order.length) % order.length]);
      },
    });
    buttons[tab.id] = button;
    strip.appendChild(button);
  }

  const root = el('div', { class: 'w32-tabs__wrap' }, [strip, bodies]);
  select(active);
  return { el: root, panels, select, get active() { return active; } };
}

/* ---------------------------------------------------------------- spinner */

/**
 * An up-down control (a "spinner"): a numeric field with stepper arrows. The
 * genuine Win32 way to say "how many", and the reason a render farm can ask for
 * a blade count without the words "Buy 10" appearing anywhere.
 */
export function spinner({ value = 1, min = 1, max = 999, onChange = null, label = 'Quantity' }) {
  let current = clampTo(value, min, max);

  const field = el('input', {
    type: 'text',
    class: 'w32-spin__field',
    inputmode: 'numeric',
    'aria-label': label,
    value: String(current),
  });

  function set(next, notify = true) {
    current = clampTo(next, min, max);
    field.value = String(current);
    if (notify) onChange?.(current);
  }

  field.addEventListener('change', () => set(parseInt(field.value, 10) || min));
  field.addEventListener('blur', () => set(parseInt(field.value, 10) || min));

  const step = (delta) => set(current + delta);

  const root = el('div', { class: 'w32-spin' }, [
    field,
    el('div', { class: 'w32-spin__buttons' }, [
      el('button', { type: 'button', class: 'w32-spin__up', 'aria-label': `Increase ${label}`, onclick: () => step(1) }),
      el('button', { type: 'button', class: 'w32-spin__down', 'aria-label': `Decrease ${label}`, onclick: () => step(-1) }),
    ]),
  ]);

  return {
    el: root,
    get value() { return current; },
    set: (n) => set(n, false),
    setMax: (n) => { max = Math.max(min, n); if (current > max) set(max, false); },
  };
}

const clampTo = (n, min, max) => Math.min(max, Math.max(min, Math.round(n) || min));

/* ----------------------------------------------------------- split button */

/**
 * A split button: a default action on the left, a drop-down of variants on the
 * right. Exactly the control Office and Explorer used for "do the obvious
 * thing, or pick a variant" — which is the shape an idle game's buy button
 * wants, without ever having to say "×10".
 */
export function splitButton({ label, onClick, items = [], hint = '' }) {
  let popup = null;

  function close() {
    popup?.remove();
    popup = null;
    drop.setAttribute('aria-expanded', 'false');
  }

  const main = el('button', {
    type: 'button',
    class: 'w32-split__main',
    onclick: () => onClick?.(),
  }, [
    el('span', { class: 'w32-split__label', text: label }),
    el('span', { class: 'w32-split__hint', text: hint }),
  ]);

  const drop = el('button', {
    type: 'button',
    class: 'w32-split__drop',
    'aria-haspopup': 'true',
    'aria-expanded': 'false',
    'aria-label': 'More options',
    onclick: (e) => {
      e.stopPropagation();
      if (popup) return close();

      popup = el('div', { class: 'w32-menu', role: 'menu' },
        items.map((item) =>
          el('button', {
            type: 'button',
            class: 'w32-menu__item',
            role: 'menuitem',
            disabled: item.disabled ? '' : null,
            onclick: () => { close(); item.onSelect?.(); },
          }, [
            el('span', { class: 'w32-menu__tick', 'aria-hidden': 'true' }),
            el('span', { class: 'w32-menu__label', text: item.label }),
            el('span', { class: 'w32-menu__hint', text: item.hint ?? '' }),
          ]),
        ));

      const rect = root.getBoundingClientRect();
      popup.style.left = `${rect.left}px`;
      // Opens upward: a split button at the foot of a window has no room below.
      popup.style.bottom = `${window.innerHeight - rect.top}px`;
      document.body.appendChild(popup);
      drop.setAttribute('aria-expanded', 'true');
    },
  });

  const root = el('div', { class: 'w32-split' }, [main, drop]);

  const onOutside = (e) => {
    if (popup && !popup.contains(e.target) && !root.contains(e.target)) close();
  };
  // Escape has to close it too. The popup is parented to <body> so it outlives
  // its window visually — without this, a drop-down left open when the player
  // switches apps floats over the next one until they happen to click.
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('pointerdown', onOutside);
  document.addEventListener('keydown', onKey);

  return {
    el: root,
    setLabel: (text) => { main.querySelector('.w32-split__label').textContent = text; },
    setHint: (text) => { main.querySelector('.w32-split__hint').textContent = text; },
    setItems: (next) => { items = next; },
    setDisabled: (on) => { main.disabled = on; },
    destroy: () => {
      close();
      document.removeEventListener('pointerdown', onOutside);
      document.removeEventListener('keydown', onKey);
    },
  };
}

/* ----------------------------------------------------------- status bar */

/** The sunken field strip along the bottom of a window. */
export function statusBar(fields) {
  const bar = el('div', { class: 'status-bar w32-status' });
  const nodes = {};
  for (const field of fields) {
    const node = el('p', { class: 'status-bar-field', text: field.text ?? '' });
    if (field.grow) node.classList.add('is-grow');
    nodes[field.id] = node;
    bar.appendChild(node);
  }
  return {
    el: bar,
    set(id, text) {
      const node = nodes[id];
      if (node && node.textContent !== text) node.textContent = text;
    },
  };
}

/* ---------------------------------------------------------------- dialog */

/**
 * A modal dialog: a real 7.css window over a dimmed desktop.
 *
 * `role`/`aria-modal` go on the *backdrop*, never the `.window` — 7.css hides
 * `.window[role=dialog]`, which would make the whole thing invisible.
 */
export function dialog({ title, width = 460, body, buttons = [], onClose = null }) {
  const previouslyFocused = document.activeElement;

  const frame = el('div', { class: 'w32-dialog__frame window' });
  const titleBar = el('div', { class: 'title-bar' }, [
    el('div', { class: 'title-bar-text', text: title }),
    el('div', { class: 'title-bar-controls' }, [
      el('button', { type: 'button', 'aria-label': 'Close', onclick: () => close() }),
    ]),
  ]);
  const content = el('div', { class: 'window-body w32-dialog__body' }, [body]);
  const footer = el('div', { class: 'w32-dialog__footer' },
    buttons.map((b) =>
      el('button', {
        type: 'button',
        class: b.primary ? 'w32-dialog__default' : '',
        onclick: () => b.onSelect?.(close),
        text: b.label,
      })));

  frame.append(titleBar, content, ...(buttons.length ? [footer] : []));
  frame.style.width = `${width}px`;

  const backdrop = el('div', {
    class: 'w32-dialog',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title,
  }, [frame]);

  function close() {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
    if (previouslyFocused?.focus) previouslyFocused.focus();
  }

  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key !== 'Tab') return;
    // A modal a stray Tab can escape is not a modal.
    const focusable = frame.querySelectorAll('button:not(:disabled), input, select, [tabindex="0"]');
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', onKey);

  document.body.appendChild(backdrop);
  (frame.querySelector('.w32-dialog__default') ?? frame.querySelector('button'))?.focus();

  return { el: backdrop, close };
}

/**
 * The left-hand category list Vista/XP options dialogs used, paired with a
 * stack of pages. Returns `{ el, pages, select }`.
 */
export function categoryList(categories, { onSelect = null } = {}) {
  const list = el('ul', { class: 'w32-cats', role: 'tablist' });
  const stack = el('div', { class: 'w32-cats__stack' });
  const pages = {};
  const buttons = {};
  let active = categories[0]?.id ?? null;

  function select(id) {
    if (!pages[id]) return;
    active = id;
    for (const [key, button] of Object.entries(buttons)) {
      const on = key === id;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-selected', String(on));
      pages[key].hidden = !on;
    }
    onSelect?.(id);
  }

  for (const category of categories) {
    const page = el('div', { class: 'w32-cats__page', role: 'tabpanel' });
    pages[category.id] = page;
    stack.appendChild(page);

    const button = el('button', {
      type: 'button',
      class: 'w32-cats__item',
      role: 'tab',
      text: category.label,
      onclick: () => select(category.id),
    });
    buttons[category.id] = button;
    list.appendChild(el('li', {}, button));
  }

  const root = el('div', { class: 'w32-cats__wrap' }, [list, stack]);
  select(active);
  return { el: root, pages, select };
}

/* --------------------------------------------------------------- tooltip */

/**
 * One tooltip for the whole shell.
 *
 * Every purchase, upgrade and derived number attaches to this. It exists
 * because the apps had drifted into being *simulations* rather than game
 * screens: production breakdowns and multiplier chains were printed on the
 * page, which is period-accurate and unreadable. The rule now is that the
 * screen shows the final number and the tooltip shows the working.
 *
 * `getContent()` is called on each show, not once at attach time, so a tooltip
 * always reflects the tick it was opened on.
 */
let tipEl = null;
let tipOwner = null;

function ensureTip() {
  if (tipEl) return tipEl;
  tipEl = el('div', { class: 'w32-tip', role: 'tooltip', hidden: '' });
  document.body.appendChild(tipEl);
  return tipEl;
}

function hideTip() {
  if (!tipEl) return;
  tipEl.hidden = true;
  tipOwner = null;
}

/**
 * Render and place the tooltip against `anchor`.
 *
 * Prefers below-right, flips above or left when that would leave the viewport.
 * A tooltip that hangs off a 390px screen is worse than no tooltip.
 */
function showTip(anchor, content) {
  if (!content) return;
  const tip = ensureTip();
  clear(tip);

  if (content.title) tip.appendChild(el('strong', { class: 'w32-tip__title', text: content.title }));
  if (content.body) tip.appendChild(el('p', { class: 'w32-tip__body', text: content.body }));
  if (content.gain) tip.appendChild(el('p', { class: 'w32-tip__gain', text: content.gain }));

  if (content.rows?.length) {
    tip.appendChild(
      el('dl', { class: 'w32-tip__rows' },
        content.rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])),
    );
  }
  if (content.note) tip.appendChild(el('p', { class: 'w32-tip__note', text: content.note }));

  tip.hidden = false;
  tipOwner = anchor;

  const a = anchor.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  const margin = 8;

  let left = a.left;
  if (left + t.width > window.innerWidth - margin) left = window.innerWidth - t.width - margin;
  if (left < margin) left = margin;

  let top = a.bottom + 6;
  if (top + t.height > window.innerHeight - margin) top = a.top - t.height - 6;
  if (top < margin) top = margin;

  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

/**
 * Attach the shared tooltip to an element.
 *
 * Pointer *and* focus, so a keyboard player gets the same explanation, and
 * `touchstart` is deliberately not bound: on a phone the tap is the purchase,
 * and a tooltip that eats the first tap would make every tile need two.
 */
export function attachTooltip(node, getContent) {
  const show = () => showTip(node, getContent());
  const hide = () => {
    if (tipOwner === node) hideTip();
  };
  node.addEventListener('pointerenter', show);
  node.addEventListener('pointerleave', hide);
  node.addEventListener('focus', show);
  node.addEventListener('blur', hide);
  node.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  return () => {
    hide();
    node.removeEventListener('pointerenter', show);
    node.removeEventListener('pointerleave', hide);
    node.removeEventListener('focus', show);
    node.removeEventListener('blur', hide);
  };
}

/**
 * A number with its working hidden behind it: the value, a dotted underline,
 * and the whole derivation in the tooltip.
 */
export function explainedValue(text, getContent, { className = '' } = {}) {
  const node = el('span', {
    class: `w32-explain ${className}`.trim(),
    // Focusable so a keyboard reaches the explanation, but deliberately *not*
    // `role="button"`: it performs no action, and 7.css styles `[role=button]`
    // as a full raised control — which turned this figure into a grey box.
    tabindex: '0',
    'aria-label': `${text} — show details`,
    text,
  });
  attachTooltip(node, getContent);
  return node;
}

/**
 * The `[?]` helper: a small round glass button beside an app's headline that
 * says, in two sentences, what this app is *for* in the economy. New players
 * were being handed twelve programs and no explanation of any of them.
 */
export function helpButton(getContent) {
  const node = el('button', {
    type: 'button',
    class: 'w32-help',
    'aria-label': 'What does this app do?',
    text: '?',
    onclick: (e) => {
      e.preventDefault();
      if (tipOwner === node) hideTip();
      else showTip(node, getContent());
    },
  });
  attachTooltip(node, getContent);
  return node;
}

/* -------------------------------------------------------------- buy tile */

/**
 * The purchase tile — the control that makes an idle-game transaction legible.
 *
 * Text links failed the only job that mattered: a player could not tell that
 * "Import a contact list" was a purchase. Every tile now carries the same four
 * signals, so a transaction is recognisable before a single word is read:
 *
 *   [icon] [name + what it gives you]        [cart · BUY · price]
 *   ▁▁▁▁▁▁▁▁▁▁▁▁▁▁ affordability sliver ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁
 *
 * The sliver is the piece doing the most work. It fills as your Buzz
 * approaches the price, so "can I afford this yet" is answered at a glance
 * without reading any number — and it reads as an ordinary progress bar, so it
 * costs nothing in period accuracy.
 *
 * `spec` is `{ icon, name, effect, cost, progress, state, tooltip, onSelect }`
 * where `state` is 'buyable' | 'unaffordable' | 'locked' | 'maxed' | 'owned'.
 */
export function buyTile(spec) {
  const icon = el('span', { class: 'w32-buy__icon', 'aria-hidden': 'true' });
  const name = el('strong', { class: 'w32-buy__name' });
  const effect = el('span', { class: 'w32-buy__effect' });
  const cost = el('b', { class: 'w32-buy__cost' });
  const verb = el('span', { class: 'w32-buy__verb' });
  const fill = el('i', { class: 'w32-buy__fill' });

  const node = el('button', { type: 'button', class: 'w32-buy' }, [
    icon,
    el('span', { class: 'w32-buy__text' }, [name, effect]),
    el('span', { class: 'w32-buy__badge' }, [
      el('span', { class: 'w32-buy__cart', 'aria-hidden': 'true' }),
      el('span', { class: 'w32-buy__badge-text' }, [verb, cost]),
    ]),
    el('span', { class: 'w32-buy__sliver', 'aria-hidden': 'true' }, fill),
  ]);

  let current = null;
  const detach = attachTooltip(node, () => current?.tooltip ?? null);

  function update(next) {
    current = { ...current, ...next };
    const { state = 'buyable' } = current;

    if (current.icon) icon.dataset.icon = current.icon;
    if (current.name != null) name.textContent = current.name;
    if (current.effect != null) effect.textContent = current.effect;

    const label =
      state === 'owned' ? 'OWNED' : state === 'maxed' ? 'FULL' : state === 'locked' ? 'LOCKED' : 'BUY';
    verb.textContent = label;
    cost.textContent = state === 'owned' || state === 'maxed' ? '' : (current.cost ?? '');

    node.disabled = state !== 'buyable';
    node.dataset.state = state;
    // The sliver is meaningless once a thing is owned or capped, so it empties
    // rather than sitting full and implying there is something left to reach.
    fill.style.setProperty(
      '--fill',
      String(state === 'buyable' || state === 'unaffordable' ? Math.min(1, Math.max(0, current.progress ?? 0)) : 0),
    );

    node.setAttribute(
      'aria-label',
      `${current.name}. ${current.effect ?? ''} ${
        state === 'owned' ? 'Already owned.' : state === 'maxed' ? 'At maximum.' : `Costs ${current.cost}.`
      }`,
    );
  }

  node.addEventListener('click', () => spec.onSelect?.());
  update(spec);

  return { el: node, update, destroy: detach };
}

/** A group of buy tiles with consistent spacing. */
export function buyList(tiles = []) {
  return el('div', { class: 'w32-buys' }, tiles);
}

/**
 * The task pane — XP's "I want to..." list, and the control MSN Messenger put
 * its verbs in.
 *
 * A list of *links* with a small icon each, under a collapsible header. This is
 * how a 2004 client asked you to do something; a row of buttons is not. It is
 * also why it suits an idle game so well: "Add a Contact" with a price beside it
 * is a sentence, where "Buy ×10" is a shop.
 *
 * `items` is `[{ id, label, hint, disabled, icon, onSelect }]`.
 */
export function taskPane({ title, items = [], collapsed = false }) {
  const list = el('ul', { class: 'w32-tasks__list' });
  const rows = new Map();

  const header = el('button', {
    type: 'button',
    class: 'w32-tasks__header',
    'aria-expanded': String(!collapsed),
    onclick: () => {
      const open = root.classList.toggle('is-collapsed');
      header.setAttribute('aria-expanded', String(!open));
    },
  }, [
    el('span', { class: 'w32-tasks__title', text: title }),
    el('span', { class: 'w32-tasks__chevron', 'aria-hidden': 'true' }),
  ]);

  const root = el('div', { class: `w32-tasks${collapsed ? ' is-collapsed' : ''}` }, [header, list]);

  function render(next) {
    if (next) items = next;
    clear(list);
    rows.clear();
    for (const item of items) {
      const link = el('button', {
        type: 'button',
        class: `w32-tasks__item${item.disabled ? ' is-disabled' : ''}`,
        disabled: item.disabled ? '' : null,
        onclick: () => item.onSelect?.(),
      }, [
        el('span', { class: `w32-tasks__icon w32-tasks__icon--${item.icon ?? 'add'}`, 'aria-hidden': 'true' }),
        el('span', { class: 'w32-tasks__label', text: item.label }),
        el('span', { class: 'w32-tasks__hint', text: item.hint ?? '' }),
      ]);
      list.appendChild(el('li', {}, link));
      rows.set(item.id, link);
    }
  }
  render();

  return {
    el: root,
    render,
    /** Update one row's price and enabled state without rebuilding the list. */
    update(id, { hint, disabled } = {}) {
      const row = rows.get(id);
      if (!row) return;
      if (hint !== undefined) row.querySelector('.w32-tasks__hint').textContent = hint;
      if (disabled !== undefined) {
        row.disabled = disabled;
        row.classList.toggle('is-disabled', disabled);
      }
    },
  };
}

/** A group box with a legend — the panel Control Panel was built from. */
export function groupBox(legend, children = []) {
  return el('fieldset', { class: 'w32-group' }, [el('legend', { text: legend }), ...[].concat(children)]);
}

/** A sunken white list well, the Explorer details-pane container. */
export function listView(children = [], { className = '' } = {}) {
  return el('ul', { class: `w32-list ${className}`.trim() }, [].concat(children));
}

export { clear, el };
