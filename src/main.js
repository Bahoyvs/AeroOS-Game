import '7.css/dist/7.css';
import './styles/index.css';

import { mountApp } from './apps/registry.js';
import { createGame } from './core/game.js';
import { createGameLoop } from './core/loop.js';
import { formatDuration, formatNumber } from './core/format.js';
import { getApp } from './data/apps.js';
import { buddyAt } from './data/buddies.js';
import { getBonus } from './core/statusEvents.js';
import { HEAT } from './data/balance.js';
import { createAudio } from './ui/audio.js';
import { confirmFormat, createFormatSequence } from './ui/bsod.js';
import { createDesktop } from './ui/desktop.js';
import { createNotifier } from './ui/notify.js';
import { createTaskbar } from './ui/taskbar.js';
import { createTutorialCoach } from './ui/tutorial.js';
import { showWelcomeBack } from './ui/welcomeBack.js';
import { createWindowManager } from './ui/windowManager.js';

/**
 * Resolve the CrazyGames SDK before anything reads a setting from it. Save
 * storage and the portal's audio mute both come from it, and `SDK.data` does
 * not exist until init() resolves — so this has to finish before
 * `createGame()` picks a storage backend.
 *
 * Best-effort by design: off-portal the script is absent or init rejects, and
 * the game carries on with localStorage and its own audio settings.
 */
async function initPortalSdk() {
  const sdk = globalThis.CrazyGames?.SDK;
  if (!sdk) {
    console.info('[aeroos] CrazyGames SDK not present; running standalone');
    return null;
  }
  try {
    await sdk.init();
    return sdk;
  } catch (err) {
    console.warn('[aeroos] CrazyGames SDK init failed; running standalone', err);
    return null;
  }
}

/** Boot the OS: wire the simulation to the shell and start the clock. */
async function boot() {
  const hostname = window.location.hostname;
  if (
    hostname !== 'localhost' &&
    hostname !== '127.0.0.1' &&
    !hostname.includes('crazygames.') &&
    !hostname.includes('poki.')
  ) {
    document.body.innerHTML = 'This game is only licensed to play on CrazyGames.com';
    return;
  }

  const sdk = await initPortalSdk();
  if (sdk) sdk.game.loadingStart();

  const game = createGame();
  const loaded = game.load();

  // Audio (AO-26). Synthesised, so there is nothing to preload; the context
  // only starts on the first real gesture, per the autoplay policy.
  const audio = createAudio({
    settings: () => game.state.settings,
    heat: () => game.econ.heatRatio(game.state),
    sdk,
  });
  document.addEventListener('pointerdown', () => audio.unlock());
  document.addEventListener('touchend', () => audio.unlock());
  document.addEventListener('keydown', () => audio.unlock());

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
        if (sdk) sdk.game.gameplayStop();
        const summary = await formatSequence.run(async () => {
          if (sdk) {
            await new Promise((resolve) => {
              sdk.ad.requestAd('midgame', {
                adFinished: resolve,
                adError: resolve,
                adStarted: () => {},
              });
            });
          }
          const result = game.formatC();
          return {
            dollars: result.dollars ?? 0,
            prestigeCount: game.state.prestigeCount,
            ramMB: game.econ.ramCapacity(game.state),
          };
        });
        if (sdk) sdk.game.gameplayStart();
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
    audio.play('chime');
    if (sdk) sdk.game.happytime();
  });

  // One place for every sound the simulation triggers (AO-26).
  const SOUNDS = {
    [game.events.BOT_BOUGHT]: 'buy',
    [game.events.APP_INSTALLED]: 'hdd',
    [game.events.APP_OPENED]: 'click',
    [game.events.OUT_OF_MEMORY]: 'error',
    [game.events.HARDWARE_BOUGHT]: 'coin',
    [game.events.STATUS_CLAIMED]: 'coin',
    [game.events.DOWNLOAD_STARTED]: 'hdd',
    [game.events.DOWNLOAD_DONE]: 'coin',
    [game.events.SCAN_DONE]: 'chime',
    [game.events.BURN_STARTED]: 'burn',
    [game.events.BURN_DONE]: 'chime',
    [game.events.DISC_PLAYED]: 'coin',
    [game.events.PLAYLIST_LOADED]: 'click',
  };
  for (const [event, sound] of Object.entries(SOUNDS)) {
    game.bus.on(event, () => audio.play(sound));
  }
  game.bus.on(game.events.VIRUS, ({ outcome }) =>
    audio.play(outcome === 'infected' ? 'virus' : 'chime'),
  );

  game.bus.on(game.events.SETTINGS, ({ settings }) => {
    audio.setEnabled({ sfx: settings.sfx !== false, bgm: settings.bgm !== false });
    if (settings.sfx !== false) audio.play('click');
  });

  game.bus.on(game.events.BUZZ_GAINED, ({ source }) => {
    if (source === 'nudge') audio.play('nudge');
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

  // Deleting is not instant, and the player has to learn that the first time.
  game.bus.on(game.events.FILE_DELETED, ({ file, secondsLeft }) => {
    notify({
      title: 'Moved to the Recycle Bin',
      body: `${file.name} still takes up its space for ${formatDuration(secondsLeft)}.`,
      tone: 'warn',
    });
  });

  game.bus.on(game.events.TRASH_EMPTIED, ({ file }) => {
    notify({
      title: 'Recycle Bin emptied',
      body: `${file.name} is gone — its disk space is free again.`,
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

  // AeroBurn (AO-29).
  game.bus.on(game.events.BURN_DONE, ({ cd }) => {
    notify({
      title: `${cd.name} burned`,
      body: 'It survives the next Format C:. Play it whenever you like.',
      tone: 'success',
    });
  });

  game.bus.on(game.events.DISC_PLAYED, ({ cd, buzz }) => {
    notify({
      title: `Playing ${cd.name}`,
      body: buzz > 0
        ? `+${formatNumber(buzz)} Buzz recovered.`
        : `+${Math.round(cd.buff.magnitude * 100)}% for ${cd.buff.durationSeconds / 60} minutes.`,
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
  
  if (sdk) sdk.game.gameplayStart();

  // Offline earnings get a dialog rather than a balloon (AO-28): a report that
  // fades in four seconds is a poor way to explain an HDD cap.
  const offline = game.offlineReport;
  if (offline?.buzz > 0) {
    showWelcomeBack({
      root: document.body,
      offline,
      hoursCap: offline.cappedHours,
      // Day 7 hangs the rewarded "2× offline Buzz" ad (GDD 8) off this seam.
      onDouble: sdk
        ? () => {
            sdk.game.gameplayStop();
            sdk.ad.requestAd('rewarded', {
              adFinished: () => {
                game.doubleOfflineBuzz();
                notify({
                  title: 'Welcome Back Bonus',
                  body: 'Offline earnings doubled.',
                  tone: 'success'
                });
                sdk.game.gameplayStart();
              },
              adError: () => {
                sdk.game.gameplayStart();
              },
              adStarted: () => {}
            });
          }
        : null,
      onClose: () => audio.unlock(),
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
      audio.update();
      maybeHitch();
    },
  });
  /**
   * The occasional stutter at critical heat (AO-27). Rare, short and purely
   * cosmetic — the machine is struggling, not broken.
   */
  let hitchCooldown = 0;
  function maybeHitch() {
    const now = performance.now();
    if (now < hitchCooldown) return;
    hitchCooldown = now + 900;

    const ratio = game.econ.heatRatio(game.state);
    if (ratio < 0.85 || Math.random() > HEAT.hitchChancePerSecond) return;

    document.body.classList.add('is-hitching');
    setTimeout(() => document.body.classList.remove('is-hitching'), 110);
  }

  if (sdk) {
    setInterval(() => {
      const hwTotal = game.state.hardware.cpu + game.state.hardware.ram + game.state.hardware.hdd;
      let percentage = (hwTotal / 30) * 100;
      if (hwTotal === 0) percentage = Math.min(10, (game.state.chat.bots / 100) * 10);
      percentage = Math.floor(Math.min(100, Math.max(0, percentage)));
      
      sdk.game.reportGameCompletedPercentage(percentage);
      sdk.game.setGameContext({
        bots: game.state.chat.bots,
        prestige: game.state.prestigeCount,
        cpu: game.state.hardware.cpu,
        ram: game.state.hardware.ram,
        hdd: game.state.hardware.hdd
      });
    }, 30000);
  }

  loop.start();

  // Never lose progress to a tab close or a phone switching apps.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) game.save();
  });
  window.addEventListener('pagehide', () => game.save());

  document.getElementById('boot')?.classList.add('is-done');
  if (sdk) sdk.game.loadingStop();

  // Handy during development; harmless in production.
  globalThis.AeroOS = { game, wm, launch, audio, sdk };
}

/** Boot failures are silent otherwise — an async boot() rejects into nothing. */
const start = () => void boot().catch((err) => console.error('[aeroos] boot failed', err));

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
