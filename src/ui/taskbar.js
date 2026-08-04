import { ALL_APPS, getApp } from '../data/apps.js';
import { formatClock, formatNumber } from '../core/format.js';
import { createTrayShield } from '../apps/shield99.js';
import { clear, el, setBar, throttle } from './dom.js';

/**
 * Taskbar + Start menu.
 *
 * On mobile this is the primary navigation hub, so each task button carries a
 * RAM bar underneath it — the PDA-mode requirement from GDD section 3.
 */
/** Even a tiny app keeps a visible sliver of bar. */
const MIN_RAM_BAR = 0.06;

export function createTaskbar({ root, game, wm, launch }) {
  root.classList.add('taskbar', 'glass');
  root.innerHTML = `
    <button type="button" class="start-button" data-role="start" aria-haspopup="true" aria-expanded="false">
      <span class="start-button__orb" aria-hidden="true"></span>
      <span class="start-button__text">Start</span>
    </button>
    <div class="taskbar__tasks" data-role="tasks"></div>
    <div class="tray glass">
      <span class="tray__buzz" data-role="tray-buzz">0</span>
      <span class="tray__clock" data-role="clock">--:--</span>
    </div>
  `;

  const tasksRoot = root.querySelector('[data-role="tasks"]');
  const clockNode = root.querySelector('[data-role="clock"]');
  const trayBuzz = root.querySelector('[data-role="tray-buzz"]');
  const startButton = root.querySelector('[data-role="start"]');

  /* ----------------------------------------------------------- start menu */

  const menu = el('div', { class: 'start-menu glass', hidden: '' });
  document.body.appendChild(menu);

  function renderStartMenu() {
    clear(menu);
    menu.append(
      el('div', { class: 'start-menu__header' }, [
        el('span', { class: 'start-menu__user', text: 'Baho_007' }),
        el('span', { class: 'start-menu__status', text: 'Online' }),
      ]),
    );

    const list = el('ul', { class: 'start-menu__list' });
    for (const app of ALL_APPS) {
      const entry = game.state.apps[app.id];
      const unlocked = game.econ.isAppUnlocked(game.state, app.id);
      if (!entry.installed && !unlocked) continue;
      // Matches the desktop: no hardware in the menu until it is revealed.
      if (app.system && !game.state.tutorial.hardwareRevealed) continue;

      const cost = app.install?.cost ?? 0;
      const affordable = game.state.buzz >= cost;
      const item = el(
        'li',
        {},
        el(
          'button',
          {
            type: 'button',
            class: `start-menu__item${entry.installed ? '' : ' is-purchase'}`,
            disabled: entry.installed || affordable ? null : 'disabled',
            onclick: () => {
              if (entry.installed) launch(app.id);
              else {
                const result = game.installApp(app.id);
                if (result.ok) {
                  game.notify(`${app.name} installed`, 'Ready on your desktop.', 'success');
                  launch(app.id);
                }
              }
              toggleMenu(false);
            },
          },
          [
            el('span', { class: 'start-menu__icon', 'aria-hidden': 'true', text: app.icon }),
            el('span', { class: 'start-menu__label' }, [
              el('strong', { text: app.name }),
              el('small', {
                text: entry.installed ? `${app.ram} MB` : `Install — ${formatNumber(cost)} Buzz`,
              }),
            ]),
          ],
        ),
      );
      list.appendChild(item);
    }
    menu.appendChild(list);
  }

  function toggleMenu(force) {
    const show = force ?? menu.hidden;
    if (show) renderStartMenu();
    menu.hidden = !show;
    startButton.setAttribute('aria-expanded', String(show));
    startButton.classList.toggle('is-active', show);
  }

  startButton.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu();
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target)) toggleMenu(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') toggleMenu(false);
  });

  /* --------------------------------------------------------------- tasks */

  const taskNodes = new Map();

  function addTask(id) {
    if (taskNodes.has(id)) return;
    const app = getApp(id);
    const button = el(
      'button',
      {
        type: 'button',
        class: 'task',
        dataset: { appId: id },
        title: app.name,
        onclick: () => wm.toggleMinimize(id),
      },
      [
        el('span', { class: 'task__icon', 'aria-hidden': 'true', text: app.icon }),
        el('span', { class: 'task__label', text: app.name }),
        el('span', { class: 'task__ram' }, el('span', { class: 'task__ram-fill' })),
      ],
    );
    tasksRoot.appendChild(button);
    taskNodes.set(id, button);
    updateTaskBars();
  }

  function removeTask(id) {
    taskNodes.get(id)?.remove();
    taskNodes.delete(id);
    updateTaskBars();
  }

  /**
   * Per-app RAM bars (AO-24, GDD 3). They read as "share of memory", but a
   * 32 MB app against 8 GB of RAM is 0.4% and would be an invisible sliver, so
   * every bar keeps a minimum width — the point is monitoring what is running,
   * not measuring it to the pixel. The real numbers are in the label.
   */
  function updateTaskBars() {
    const capacity = game.econ.ramCapacity(game.state) || 1;
    for (const [id, node] of taskNodes) {
      const mb = game.econ.appRam(game.state, id);
      const share = mb / capacity;
      setBar(node.querySelector('.task__ram-fill'), Math.max(share, MIN_RAM_BAR), {
        warn: 0.5,
        critical: 0.8,
      });
      node.setAttribute(
        'aria-label',
        `${getApp(id).name} — ${mb} MB of ${capacity} MB (${Math.round(share * 100)}%)`,
      );
      node.title = `${getApp(id).name} · ${mb} MB`;
    }
  }

  wm.on('focus', ({ id }) => {
    for (const [taskId, node] of taskNodes) node.classList.toggle('is-active', taskId === id);
  });
  wm.on('close', ({ id }) => removeTask(id));
  wm.on('minimize', ({ id, minimized }) => {
    taskNodes.get(id)?.classList.toggle('is-minimized', minimized);
    if (minimized) taskNodes.get(id)?.classList.remove('is-active');
  });

  game.bus.on(game.events.APP_OPENED, ({ id }) => addTask(id));
  game.bus.on(game.events.APP_CLOSED, ({ id }) => removeTask(id));
  game.bus.on(game.events.HARDWARE_BOUGHT, updateTaskBars);
  // A loaded playlist changes RetroAmp's footprint, so the bars must follow.
  game.bus.on(game.events.PLAYLIST_LOADED, updateTaskBars);
  game.bus.on(game.events.PLAYLIST_ENDED, updateTaskBars);

  // Shield99's tray icon (AO-22) lives left of the clock, like the real thing.
  const tray = createTrayShield({ root: root.querySelector('.tray'), game, launch });
  game.bus.on(game.events.APP_INSTALLED, tray.update);
  game.bus.on(game.events.APP_OPENED, tray.update);
  game.bus.on(game.events.APP_CLOSED, tray.update);
  game.bus.on(game.events.VIRUS, tray.update);
  game.bus.on(game.events.SCAN_DONE, tray.update);
  game.bus.on(game.events.PRESTIGE, tray.update);

  const update = throttle(() => {
    tray.update();
    clockNode.textContent = formatClock();
    trayBuzz.textContent = `${formatNumber(game.state.buzz)} Buzz`;
  }, 500);

  update();
  return {
    update,
    closeMenu: () => toggleMenu(false),
    /** Highlight a task button — used when an app wants attention (AO-10). */
    flag: (id, on) => taskNodes.get(id)?.classList.toggle('needs-attention', on),
  };
}
