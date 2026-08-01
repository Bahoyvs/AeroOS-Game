import { el } from './../ui/dom.js';

/**
 * Rendered for apps whose mechanic is scheduled for a later day of the build
 * week. The window, RAM cost and taskbar behaviour are real — only the body is
 * a stub, so replacing it with the real app is a one-file change plus one line
 * in src/apps/registry.js.
 */
export function mount(body, { app }) {
  body.classList.add('app-placeholder');
  body.append(
    el('div', { class: 'placeholder' }, [
      el('span', { class: 'placeholder__glyph', 'aria-hidden': 'true', text: app.icon }),
      el('h3', { class: 'placeholder__title', text: app.name }),
      el('p', { class: 'placeholder__blurb', text: app.blurb }),
      el('p', { class: 'placeholder__day', text: `Scheduled for Day ${app.day} — see docs/ROADMAP.md` }),
      el('p', { class: 'placeholder__ram', text: `Reserves ${app.ram} MB of memory while open.` }),
    ]),
  );
  return () => body.classList.remove('app-placeholder');
}
