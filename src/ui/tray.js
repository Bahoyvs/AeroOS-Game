import { BUILDINGS, TRAY_BUILDINGS } from '../data/buildings.js';
import { formatNumber } from '../core/format.js';
import { clear, el } from './dom.js';
import { mountBuildingPanel } from './buildingPanel.js';

/**
 * Tray buildings (patch §1.2 / GDD §A.3).
 *
 * AdBar, IoT Botnet and Cloud Mainframe never open a window. They are adware, a
 * botnet and a rented datacentre — things that run in the background by
 * definition — so they live in the system tray next to the clock, exactly where
 * Windows 7 put its background processes.
 *
 * That is a theme decision that happens to pay for itself twice:
 *
 * - **It is where the late game lands.** These three are the last steps on the
 *   roster, so the buildings most likely to be on screen at once are the ones
 *   with no window, no drag handling and no per-frame layout.
 * - **It caps the Full Window count** without a rule anybody has to remember.
 *
 * On a phone the same icons sit in the PDA status strip (GDD §F) rather than
 * opening a full-screen sheet, so the desktop and the phone agree about what
 * these buildings are.
 */
export function createTrayBuildings({ root, game }) {
  const host = el('div', { class: 'tray-buildings' });
  root.prepend(host);

  const buttons = new Map();
  let openPopover = null;

  for (const id of TRAY_BUILDINGS) {
    const building = BUILDINGS.find((b) => b.id === id);
    const button = el('button', {
      type: 'button',
      class: 'tray-building',
      dataset: { building: id },
      'aria-label': building.name,
      'aria-expanded': 'false',
      title: building.name,
      onclick: (e) => {
        e.stopPropagation();
        toggle(id, button);
      },
    }, [
      el('span', { class: 'tray-building__icon', 'aria-hidden': 'true' }),
      el('span', { class: 'tray-building__badge', dataset: { role: `badge-${id}` } }),
    ]);
    host.appendChild(button);
    buttons.set(id, button);
  }

  /* -------------------------------------------------------------- popover */

  function close() {
    if (!openPopover) return;
    openPopover.cleanup?.();
    openPopover.node.remove();
    buttons.get(openPopover.id)?.setAttribute('aria-expanded', 'false');
    openPopover = null;
  }

  /**
   * A popover, not a window: the whole point of the category is that these
   * never enter the window manager. It is anchored to the tray icon and closes
   * on outside click or Escape, like every other tray flyout in the shell.
   */
  function toggle(id, button) {
    if (openPopover?.id === id) {
      close();
      return;
    }
    close();

    const building = BUILDINGS.find((b) => b.id === id);
    const node = el('div', {
      class: 'tray-popover glass',
      role: 'dialog',
      'aria-label': building.name,
    }, [
      el('div', { class: 'tray-popover__head' }, [
        el('strong', { text: building.name }),
        el('button', {
          type: 'button',
          class: 'tray-popover__close',
          'aria-label': 'Close',
          text: '✕',
          onclick: close,
        }),
      ]),
      el('p', { class: 'tray-popover__blurb', text: building.blurb }),
    ]);

    const panelHost = el('div');
    node.appendChild(panelHost);
    document.body.appendChild(node);

    // Anchor above the tray, clamped into the viewport so a narrow phone in
    // portrait never pushes it off-screen.
    const rect = button.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 16);
    node.style.width = `${width}px`;
    const left = Math.min(
      Math.max(8, rect.left + rect.width / 2 - width / 2),
      window.innerWidth - width - 8,
    );
    node.style.left = `${left}px`;
    node.style.bottom = `${window.innerHeight - rect.top + 8}px`;

    const cleanup = mountBuildingPanel(panelHost, { game, buildingId: id });
    button.setAttribute('aria-expanded', 'true');
    openPopover = { id, node, cleanup };
    node.querySelector('button')?.focus();
  }

  const onOutside = (e) => {
    if (!openPopover) return;
    if (openPopover.node.contains(e.target)) return;
    if (host.contains(e.target)) return;
    close();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('pointerdown', onOutside);
  document.addEventListener('keydown', onKey);

  /* --------------------------------------------------------------- update */

  function update() {
    for (const [id, button] of buttons) {
      const unlocked = game.econ.isBuildingUnlocked
        ? game.econ.isBuildingUnlocked(game.state, id)
        : true;
      const units = game.units(id);
      // A locked tray building is hidden rather than greyed: the tray is a
      // dense, always-on strip, and three permanent dead icons next to the
      // clock is clutter the roster panel already communicates better.
      button.hidden = !unlocked;
      const badge = button.querySelector(`[data-role="badge-${id}"]`);
      badge.textContent = units > 0 ? formatNumber(units) : '';
      badge.hidden = units <= 0;
      button.classList.toggle('is-idle', units <= 0);
    }
  }

  update();

  return {
    update,
    destroy() {
      close();
      document.removeEventListener('pointerdown', onOutside);
      document.removeEventListener('keydown', onKey);
      clear(host);
      host.remove();
    },
  };
}
