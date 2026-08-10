import { ALL_APPS, getApp } from '../data/apps.js';
import { formatClock, formatNumber } from '../core/format.js';
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

    const inner = el('div', { class: 'start-menu__inner' });

    // --- Left Pane (Apps) ---
    const leftPane = el('div', { class: 'start-menu__left' });
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
            // The onboarding spotlight points at this row by id once the menu
            // is open (src/ui/tutorial.js).
            dataset: { appId: app.id },
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
            el('img', { class: 'start-menu__icon', 'aria-hidden': 'true', src: app.icon, alt: '' }),
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
    leftPane.appendChild(list);

    // --- Right Pane (System Links) ---
    const rightPane = el('div', { class: 'start-menu__right' });

    const sysList = el('ul', { class: 'start-menu__sys-list' });
    const sysLinks = [
      { label: game.state.username || 'Danielp', bold: true, divider: true },
      { label: 'Documents' },
      { label: 'Pictures' },
      { label: 'Music' },
      { label: 'Games', divider: true },
      // The one link in this pane that names a window the game actually has.
      // The rest are period set dressing; this one is the route to My Computer
      // when a full-screen PDA sheet is covering the desktop icon, and the
      // onboarding tour points at it.
      { label: 'Computer', appId: 'system' },
      { label: 'Control Panel', divider: true },
      { label: 'Devices and Printers' },
      { label: 'Default Programs' },
      { label: 'Help and Support' },
    ];

    for (const link of sysLinks) {
      const liClass = `start-menu__sys-item${link.divider ? ' has-divider' : ''}${
        link.bold ? ' is-bold' : ''
      }`;
      const li = el('li', { class: liClass }, [
        el(
          'button',
          {
            type: 'button',
            class: 'start-menu__sys-btn',
            dataset: link.appId ? { appId: link.appId } : {},
            onclick: link.appId
              ? () => {
                  launch(link.appId);
                  toggleMenu(false);
                }
              : null,
          },
          link.label,
        ),
      ]);
      sysList.appendChild(li);
    }

    rightPane.appendChild(sysList);

    inner.appendChild(leftPane);
    inner.appendChild(rightPane);

    menu.appendChild(inner);
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
        el('img', { class: 'task__icon', 'aria-hidden': 'true', src: app.icon, alt: '' }),
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

  /**
   * Sound toggle (AO-26). Generated audio still needs an off switch, and the
   * tray is where a mid-2000s OS put it.
   */
  const trayRoot = root.querySelector('.tray');
  const audioButton = el('button', {
    type: 'button',
    class: 'tray__audio',
    onclick: () => {
      const muted = game.state.settings.sfx === false && game.state.settings.bgm === false;
      game.setSettings({ sfx: muted, bgm: muted });
      updateAudioButton();
    },
  });
  trayRoot.prepend(audioButton);

  function updateAudioButton() {
    const { sfx, bgm } = game.state.settings;
    const muted = sfx === false && bgm === false;
    audioButton.textContent = muted ? '🔇' : '🔊';
    audioButton.title = muted ? 'Sound off — click to unmute' : 'Sound on — click to mute';
    audioButton.setAttribute('aria-label', audioButton.title);
    audioButton.dataset.muted = String(muted);
  }
  updateAudioButton();
  game.bus.on(game.events.SETTINGS, updateAudioButton);

  /**
   * Animation toggle, next to the sound toggle and for the same reason: a
   * player whose OS asks for reduced motion gets a desktop where nothing moves,
   * and the fix has to be one visible click away — not buried in My Computer
   * behind a hardware unlock. Writes an explicit mode; 'auto' stays reachable
   * from the Display panel.
   */
  const motionButton = el('button', {
    type: 'button',
    class: 'tray__motion',
    onclick: () => {
      const reduced = document.documentElement.dataset.motion === 'reduced';
      game.setSettings({ motion: reduced ? 'full' : 'reduced' });
      updateMotionButton();
    },
  });
  trayRoot.prepend(motionButton);

  function updateMotionButton() {
    const reduced = document.documentElement.dataset.motion === 'reduced';
    motionButton.textContent = reduced ? '⏸' : '▶';
    motionButton.title = reduced
      ? 'Animations off — click to turn them on'
      : 'Animations on — click to turn them off';
    motionButton.setAttribute('aria-label', motionButton.title);
    motionButton.dataset.reduced = String(reduced);
  }
  updateMotionButton();
  // After createMotionPreference, which also listens for SETTINGS and is
  // registered first, so data-motion is already current when this reads it.
  game.bus.on(game.events.SETTINGS, updateMotionButton);
  globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.(
    'change',
    updateMotionButton,
  );

  const update = throttle(() => {
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
