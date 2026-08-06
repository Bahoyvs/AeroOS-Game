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

  /**
   * `action` turns a balloon into something the player can act on rather than
   * read and lose — "animations are off, turn them on" is useless as a
   * statement and useful as a button. Such a balloon also wants longer than the
   * default 4.5s, hence `duration`.
   */
  return function notify({ title, body, tone = 'info', action = null, duration = timeout }) {
    let iconName = 'MsMpRes_151.png';
    if (tone === 'success') iconName = 'MsMpRes_334.png';
    else if (tone === 'warn') iconName = 'MsMpRes_134.png';
    else if (tone === 'error') iconName = 'MsMpRes_132.png';

    const node = el('div', { class: `balloon balloon--${tone}`, role: 'status' }, [
      el('img', { class: 'balloon__icon', src: `${import.meta.env.BASE_URL}icons/${iconName}`, alt: tone }),
      el('div', { class: 'balloon__content' }, [
        el('div', { class: 'balloon__title', text: title }),
        body ? el('div', { class: 'balloon__body', text: body }) : null,
        action
          ? el('button', {
              type: 'button',
              class: 'balloon__action',
              text: action.label,
              onclick: () => {
                action.onClick();
                dismiss(node);
              },
            })
          : null,
      ]),
      el('div', { class: 'balloon__controls' }, [
        el('button', {
          class: 'balloon__close',
          'aria-label': 'Dismiss',
          text: '×',
          onclick: () => dismiss(node),
        }),
      ]),
    ]);

    root.appendChild(node);
    live.push(node);
    requestAnimationFrame(() => node.classList.add('is-visible'));

    while (live.length > max) dismiss(live[0]);
    if (duration > 0) setTimeout(() => dismiss(node), duration);
    return node;
  };
}
