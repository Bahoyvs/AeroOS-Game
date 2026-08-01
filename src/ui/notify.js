import { el } from './dom.js';

/**
 * Taskbar balloon notifications — the mid-2000s "speech bubble from the tray"
 * pattern. Also the surface the Day 7 rewarded-ad popups will reuse.
 */
export function createNotifier(root, { timeout = 4500, max = 3 } = {}) {
  const live = [];

  function dismiss(node) {
    node.classList.remove('is-visible');
    setTimeout(() => node.remove(), 250);
    const i = live.indexOf(node);
    if (i !== -1) live.splice(i, 1);
  }

  return function notify({ title, body, tone = 'info' }) {
    const node = el('div', { class: `balloon balloon--${tone}`, role: 'status' }, [
      el('div', { class: 'balloon__title', text: title }),
      body ? el('div', { class: 'balloon__body', text: body }) : null,
      el('button', {
        class: 'balloon__close',
        'aria-label': 'Dismiss',
        text: '×',
        onclick: () => dismiss(node),
      }),
    ]);

    root.appendChild(node);
    live.push(node);
    requestAnimationFrame(() => node.classList.add('is-visible'));

    while (live.length > max) dismiss(live[0]);
    setTimeout(() => dismiss(node), timeout);
    return node;
  };
}
