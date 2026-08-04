import '7.css/dist/7.css';
import './styles/index.css';

import { mountApp } from './apps/registry.js';
import { createGame } from './core/game.js';
import { createGameLoop } from './core/loop.js';
import { formatDuration, formatNumber } from './core/format.js';
import { getApp } from './data/apps.js';
import { buddyAt } from './data/buddies.js';
import { getBonus } from './core/statusEvents.js';
import { confirmFormat, createFormatSequence } from './ui/bsod.js';
import { createDesktop } from './ui/desktop.js';
import { createNotifier } from './ui/notify.js';
import { createTaskbar } from './ui/taskbar.js';
import { createTutorialCoach } from './ui/tutorial.js';
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
    // Defence in depth: if the state believes the app is open but no window
    // exists, the two have drifted apart. Resync instead of dead-ending on an
    // icon that does nothing (and leaking the app's RAM forever).
    if (game.state.apps[id]?.open) {
      console.warn(`[aeroos] ${id} was open with no window; resyncing`);
      game.closeApp(id);
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
  wm.on('close', ({ id }) => game.closeApp(id));

  game.bus.on(game.events.OUT_OF_MEMORY, ({ id, needed, free }) => {
    notify({
      title: 'Out of memory',
      body: `${getApp(id).name} needs ${needed} MB but only ${free} MB is free. Close something or upgrade your RAM.`,
      tone: 'error',
    });
  });

  // Format C: (AO-17). The game announces the intent; the shell owns the
  // confirmation, the BSOD and the reboot screen, and calls formatC() at the
  // beat where the machine actually wipes.
  const formatSequence = createFormatSequence({
    root: document.body,
    reducedMotion: () =>
      game.state.settings.reducedMotion ||
      matchMedia('(prefers-reduced-motion: reduce)').matches,
  });

  game.bus.on(game.events.FORMAT_REQUESTED, ({ dollars }) => {
    if (formatSequence.busy) return;
    confirmFormat({
      root: document.body,
      dollars,
      onConfirm: async () => {
        const summary = await formatSequence.run(() => {
          const result = game.formatC();
          return {
            dollars: result.dollars ?? 0,
            prestigeCount: game.state.prestigeCount,
            ramMB: game.econ.ramCapacity(game.state),
          };
        });
        notify({
          title: 'Format complete',
          body: `Banked $${summary.dollars.toFixed(2)}. Spend it on hardware in My Computer.`,
          tone: 'success',
        });
      },
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

  // Status-message bonus events (AO-10). The taskbar flag matters most in PDA
  // mode, where AeroChat may be sitting behind another full-screen window.
  game.bus.on(game.events.STATUS_SPAWNED, ({ index, bonusId }) => {
    taskbar.flag('aerochat', true);
    notify({
      title: `${buddyAt(index).name} changed status`,
      body: `${getBonus(bonusId).status} — nudge back in AeroChat.`,
      tone: 'info',
    });
  });

  game.bus.on(game.events.STATUS_MISSED, () => taskbar.flag('aerochat', false));

  game.bus.on(game.events.STATUS_CLAIMED, ({ bonus, buzz }) => {
    taskbar.flag('aerochat', false);
    notify({
      title: bonus.label,
      body:
        bonus.kind === 'burst'
          ? `+${formatNumber(buzz)} Buzz.`
          : `+${Math.round(bonus.magnitude * 100)}% for ${bonus.durationSeconds}s.`,
      tone: 'success',
    });
  });

  const coach = createTutorialCoach({ root: document.getElementById('desktop'), game });

  // Onboarding (AO-12): each objective is announced, and the first bottleneck
  // hands the player their hardware.
  game.bus.on(game.events.TUTORIAL_STEP, ({ completed, done }) => {
    coach.update();
    desktop.renderIcons();
    if (done && completed.length > 0) {
      notify({
        title: 'You know the machine now',
        body: 'The desktop is yours. Format C: when the bloat gets bad.',
        tone: 'success',
      });
    }
  });

  game.bus.on(game.events.HARDWARE_REVEALED, () => {
    desktop.renderIcons();
    notify({
      title: 'System bottleneck',
      body: 'That is your hardware talking. My Computer is on the desktop now.',
      tone: 'warn',
    });
  });

  // RetroAmp (AO-13/AO-14).
  game.bus.on(game.events.PLAYLIST_LOADED, ({ playlist }) => {
    notify({
      title: `♪ ${playlist.name}`,
      body: playlist.durationSeconds
        ? `+${Math.round(playlist.multiplier * 100)}% to everything for ${playlist.durationSeconds / 60} minutes.`
        : `+${Math.round(playlist.multiplier * 100)}% to everything while it plays.`,
      tone: 'success',
    });
  });

  game.bus.on(game.events.PLAYLIST_ENDED, ({ playlist, reason }) => {
    if (reason !== 'burnt-out') return;
    notify({
      title: `${playlist.name} burnt out`,
      body: `Cooling down for ${playlist.cooldownSeconds / 60} minutes.`,
      tone: 'warn',
    });
  });

  // LemonWire + Shield99 (AO-21/AO-22).
  game.bus.on(game.events.DOWNLOAD_DONE, ({ file, payout }) => {
    notify({
      title: 'Download complete',
      body: `${file.name} — +${formatNumber(payout)} Buzz.`,
      tone: 'success',
    });
  });

  game.bus.on(game.events.VIRUS, ({ file, outcome }) => {
    const messages = {
      blocked: ['Shield99 blocked a threat', `${file.name} was quarantined on arrival.`, 'success'],
      rescued: [
        'Shield99 free trial saved you',
        `${file.name} was infected. That was your one free rescue — install and open Shield99 to stay covered.`,
        'warn',
      ],
      infected: [
        'Your machine is infected',
        'Production is halved and LemonWire is locked. Run a Shield99 deep scan to clean it — nothing you have earned is lost.',
        'error',
      ],
    };
    const [title, bodyText, tone] = messages[outcome];
    notify({ title, body: bodyText, tone });
    if (outcome === 'infected') taskbar.flag('shield99', true);
  });

  game.bus.on(game.events.SCAN_DONE, ({ cured }) => {
    taskbar.flag('shield99', false);
    notify({
      title: cured ? 'Machine cleaned' : 'Scan complete',
      body: cured ? 'Production is back to normal.' : 'No threats found.',
      tone: 'success',
    });
  });

  game.bus.on(game.events.MILESTONE, ({ at, multiplier }) => {
    notify({
      title: `${at} buddies online`,
      body: `AeroChat production is now ×${multiplier.toFixed(2)}.`,
      tone: 'success',
    });
  });

  // Restore whatever was open last session. A fresh save starts on AeroChat
  // alone — the clean desktop the scripted tutorial (AO-12) opens on.
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
  } else if (!loaded.loaded && game.state.tutorial.done) {
    // First-time players get the coach instead of a balloon telling them the
    // same thing twice.
    notify({ title: 'AeroOS is ready', body: 'Nudge for Buzz.', tone: 'info' });
  }

  const loop = createGameLoop({
    onTick: (dt) => game.tick(dt),
    onRender: () => {
      desktop.update();
      taskbar.update();
      coach.update();
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
