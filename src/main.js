import '7.css/dist/7.css';
import './styles/index.css';

import { mountApp } from './apps/registry.js';
import { createGame } from './core/game.js';
import { createGameLoop } from './core/loop.js';
import { formatDuration, formatNumber } from './core/format.js';
import { getApp } from './data/apps.js';
import { createDesktop } from './ui/desktop.js';
import { createNotifier } from './ui/notify.js';
import { createTaskbar } from './ui/taskbar.js';
import { createWindowManager } from './ui/windowManager.js';

/** Boot the OS: wire the simulation to the shell and start the clock. */
function boot() {
  const game = createGame();
  const loaded = game.load();

  const wm = createWindowManager({ root: document.getElementById('windows') });
  const notify = createNotifier(document.getElementById('toasts'));
  game.bus.on(game.events.NOTIFY, notify);

  /** Opening an app = a state change plus a window. Both, or neither. */
  function launch(id) {
    const app = getApp(id);
    if (wm.isOpen(id)) {
      wm.toggleMinimize(id);
      return;
    }
    const result = game.openApp(id);
    if (!result.ok) {
      if (result.reason === 'out-of-memory') return; // handled by the OOM listener
      if (result.reason === 'not-installed') {
        notify({ title: `${app.name} is not installed`, body: 'Install it from Start.', tone: 'warn' });
      }
      return;
    }
    wm.open(app, (body) => mountApp(id, body, { game, wm }));
  }

  // Closing a window must release its memory, however it was closed.
  wm.on('close', (id) => game.closeApp(id));

  game.bus.on(game.events.OUT_OF_MEMORY, ({ id, needed, free }) => {
    notify({
      title: 'Out of memory',
      body: `${getApp(id).name} needs ${needed} MB but only ${free} MB is free. Close something or upgrade your RAM.`,
      tone: 'error',
    });
  });

  game.bus.on(game.events.PRESTIGE, () => {
    for (const id of wm.openIds) wm.close(id);
    launch('aerochat');
  });

  const desktop = createDesktop({
    iconRoot: document.getElementById('icons'),
    gadgetRoot: document.getElementById('gadget-slot'),
    game,
    launch,
  });
  const taskbar = createTaskbar({ root: document.getElementById('taskbar'), game, wm, launch });

  // Restore whatever was open last session; a fresh save starts on AeroChat
  // alone, which is where the scripted tutorial (Day 7) will pick up.
  const previouslyOpen = Object.entries(game.state.apps)
    .filter(([, entry]) => entry.open)
    .map(([id]) => id);
  for (const entry of Object.values(game.state.apps)) entry.open = false;
  if (previouslyOpen.length > 0) previouslyOpen.forEach(launch);
  else launch('aerochat');

  const offline = game.offlineReport;
  if (offline?.buzz > 0) {
    notify({
      title: 'Welcome back',
      body: `Your buddies kept chatting for ${formatDuration(offline.seconds)} — ${formatNumber(offline.buzz)} Buzz.${offline.capped ? ' Upgrade your HDD to bank more.' : ''}`,
      tone: 'success',
    });
    game.clearOfflineReport();
  } else if (!loaded.loaded) {
    notify({
      title: 'AeroOS is ready',
      body: 'Add a buddy in AeroChat, then nudge for Buzz.',
      tone: 'info',
    });
  }

  const loop = createGameLoop({
    onTick: (dt) => game.tick(dt),
    onRender: () => {
      desktop.update();
      taskbar.update();
    },
  });
  loop.start();

  // Never lose progress to a tab close or a phone switching apps.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) game.save();
  });
  window.addEventListener('pagehide', () => game.save());

  document.getElementById('boot')?.classList.add('is-done');

  // Handy during development; harmless in production.
  globalThis.AeroOS = { game, wm, launch };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
