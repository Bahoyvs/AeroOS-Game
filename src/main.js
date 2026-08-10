import '7.css/dist/7.css';
import './styles/index.css';

import { mountApp } from './apps/registry.js';
import { createGame } from './core/game.js';
import { createGameLoop } from './core/loop.js';
import { formatDuration, formatNumber } from './core/format.js';
import { getApp } from './data/apps.js';
import { getBuilding } from './data/buildings.js';
import { buddyAt } from './data/buddies.js';
import { getBonus } from './core/statusEvents.js';
import { ADS, HEAT } from './data/balance.js';
import { createAds } from './ui/ads.js';
import { createAudio } from './ui/audio.js';
import { confirmFormat, createFormatSequence } from './ui/bsod.js';
import { createDesktop } from './ui/desktop.js';
import { createMotionPreference } from './ui/motion.js';
import { createNotifier } from './ui/notify.js';
import { createTaskbar } from './ui/taskbar.js';
import { createTheme } from './ui/theme.js';
import { createTutorialCoach } from './ui/tutorial.js';
import { showWelcomeBack } from './ui/welcomeBack.js';
import { createWindowManager } from './ui/windowManager.js';
import { mountDevPanel } from './ui/devPanel.js';

/** Resolve `promise`, or `fallback` if it takes longer than `ms`. */
function withTimeout(promise, ms, fallback = null) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]);
}

/**
 * Resolve the CrazyGames SDK before anything reads a setting from it. Save
 * storage and the portal's audio mute both come from it, and `SDK.data` does
 * not exist until init() resolves — so this has to finish before
 * `createGame()` picks a storage backend.
 *
 * Best-effort by design: off-portal the script is absent or init rejects, and
 * the game carries on with localStorage and its own audio settings.
 *
 * It is also the *only* thing boot is allowed to block on, and even then not
 * indefinitely. A portal handshake that never settles used to mean a desktop
 * that never appeared — indistinguishable, from the player's side, from a game
 * that does not work, and one of the ways a load ends without any gameplay.
 */
/**
 * Mirrors the `sdk` that `boot()` resolves, at module scope.
 *
 * `boot()` keeps its own local `sdk` for the rest of its body, but a boot
 * failure is caught *outside* boot() (see `start()` below) and that catch
 * handler has no way to reach a variable local to the function that just
 * threw. Boot failures are exactly the crashes this instrumentation exists
 * for — a session with zero gameplay — so this is the one piece of portal
 * state worth keeping a copy of at module scope.
 */
let portalSdk = null;

async function initPortalSdk() {
  const sdk = globalThis.CrazyGames?.SDK;
  if (!sdk) {
    console.info('[aeroos] CrazyGames SDK not present; running standalone');
    return null;
  }
  const ready = await withTimeout(
    sdk.init().then(() => true),
    SDK_INIT_TIMEOUT_MS,
    false,
  ).catch((err) => {
    console.warn('[aeroos] CrazyGames SDK init failed; running standalone', err);
    return false;
  });
  if (!ready) {
    console.warn('[aeroos] CrazyGames SDK did not initialise in time; booting anyway');
    return null;
  }
  portalSdk = sdk;
  return sdk;
}

/**
 * Everything that goes wrong, in one place.
 *
 * An uncaught error in a listener, a rejected promise nobody awaited, a boot that
 * throws — none of those leave a trace anywhere we can read once the game is on
 * the portal, which is why a crash rate can only be inferred from sessions that
 * end early. There is no telemetry endpoint to send them to and adding one is not
 * worth a network request, so they go where the portal will hand them back with
 * the rest of a support report: the game context (see `reportContext` below),
 * plus the console for anyone with devtools open.
 *
 * Deliberately at module scope and installed on import, so a failure *during*
 * boot is captured too — that is the class of failure that shows up as a load
 * with no gameplay in it.
 */
const crashes = { count: 0, last: null };

function reportError(kind, detail) {
  crashes.count += 1;
  // Trimmed: this ends up as a context value on a support report, not a log file.
  crashes.last = `${kind}: ${detail}`.slice(0, 180);
  console.error(`[aeroos] ${kind}`, detail);
}

window.addEventListener('error', (event) => {
  const where = event.filename ? ` (${event.filename}:${event.lineno})` : '';
  reportError('uncaught', `${event.message}${where}`);
});
window.addEventListener('unhandledrejection', (event) => {
  reportError('unhandled-rejection', String(event.reason));
});

/** How long the portal handshake may hold the desktop back. */
const SDK_INIT_TIMEOUT_MS = 3000;
/** ...and the ad-blocker probe, which nothing on the first screen needs. */
const ADS_INIT_TIMEOUT_MS = 1500;

/**
 * Where this build is licensed to run.
 *
 * The old check was a substring test against `location.hostname` that replaced
 * the whole document with one line of plain text on any miss. Three things
 * missed that should not have: an empty hostname (what a `srcdoc` or blob
 * iframe reports), a portal domain outside `.com`, and any context where the
 * game is framed by the portal from a different host. Each of those is a load
 * that reaches the player as a blank page and is counted as a session with no
 * gameplay in it.
 *
 * So the test is anchored rather than substring-based (`evilcrazygames.com.co`
 * no longer passes), and it looks at who framed us as well as where we are
 * served from.
 */
const PORTAL_HOST = /(^|\.)(crazygames|poki)\.[a-z]{2,}(\.[a-z]{2,})?$/i;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|.*\.local)$/i;

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function isLicensedHost() {
  const host = window.location.hostname;

  // An empty hostname means a srcdoc/blob/about: document — i.e. we are already
  // inside somebody's frame, and the ancestor check below is the real question.
  if (host && (LOCAL_HOST.test(host) || PORTAL_HOST.test(host))) return true;

  const ancestors = window.location.ancestorOrigins;
  if (ancestors) {
    for (const origin of ancestors) {
      if (PORTAL_HOST.test(hostOf(origin))) return true;
    }
  }

  /**
   * Last resort: who linked us here.
   *
   * This used to be gated on an empty hostname, which left out the case it is
   * most needed for — Firefox has never implemented `ancestorOrigins`, so the
   * one browser that cannot answer the ancestor question was also the only one
   * never allowed to answer it the other way, and a Firefox player framed from a
   * host we do not recognise by name would get the refusal page. A referrer is
   * weaker evidence than an ancestor origin, and it is used in the direction
   * where being wrong is survivable: it can only *grant* a licence, never revoke
   * one. Nothing depends on it today, which is why it is worth fixing before
   * something does.
   */
  return Boolean(document.referrer) && PORTAL_HOST.test(hostOf(document.referrer));
}

/** A refusal the player can read, rather than a wiped document. */
function showUnlicensed() {
  document.body.innerHTML = `
    <div class="unlicensed">
      <h1>AeroOS</h1>
      <p>This build is licensed to play on CrazyGames.</p>
      <p><a href="https://www.crazygames.com/" rel="noopener">Play it there →</a></p>
    </div>
  `;
}

/** Boot the OS: wire the simulation to the shell and start the clock. */
async function boot() {
  if (!isLicensedHost()) {
    showUnlicensed();
    return;
  }

  const sdk = await initPortalSdk();

  /**
   * The portal's gameplay lifecycle, in one place and idempotent.
   *
   * These calls are how CrazyGames measures whether a load turned into a
   * session, and they were previously made from four call sites with no shared
   * idea of the current state — so a tab that was hidden during a Format C:
   * could send two `gameplayStart()`s and no `gameplayStop()`, or the reverse.
   * Tracking the state here means every path reports the truth, and reporting
   * the same thing twice costs nothing.
   */
  const gameplay = (() => {
    let playing = false;
    let loadingDone = false;
    const call = (name) => {
      try {
        sdk?.game?.[name]?.();
      } catch (err) {
        console.warn(`[aeroos] portal ${name}() failed`, err);
      }
    };
    return {
      loading() {
        call('loadingStart');
      },
      loaded() {
        if (loadingDone) return;
        loadingDone = true;
        call('loadingStop');
      },
      start() {
        // Gameplay cannot begin before loading has been reported as finished:
        // the portal reads these as a sequence, not as two independent flags.
        if (!loadingDone || playing) return;
        playing = true;
        call('gameplayStart');
      },
      stop() {
        if (!playing) return;
        playing = false;
        call('gameplayStop');
      },
    };
  })();

  gameplay.loading();

  const game = createGame();
  const loaded = game.load();

  /**
   * A name to put at the top of the buddy list. The portal's copy is nicer, but
   * it is a *label* — nothing about the first minute depends on it, and it used
   * to be a second blocking round-trip in front of the desktop. Boot with the
   * guest name and swap it in if and when the portal answers.
   */
  if (!game.state.username) {
    game.setUsername(buddyAt(Math.floor(Math.random() * 500)).name);
    if (sdk) {
      withTimeout(sdk.user.getUser(), SDK_INIT_TIMEOUT_MS)
        .then((user) => {
          if (user?.username) game.setUsername(user.username);
        })
        .catch((err) => console.warn('[aeroos] CrazyGames user fetch failed', err));
    }
  }

  // Whether the desktop animates at all. Stamped on <html> before the first
  // window opens, so nothing plays a transition the player has switched off.
  const motion = createMotionPreference({ game });

  // ...and what it looks like. Same shape, same reason: one writer, one
  // attribute, and the stylesheet never reads game state.
  const theme = createTheme({ game });

  // Audio (AO-26). Synthesised, so there is nothing to preload; the context
  // only starts on the first real gesture, per the autoplay policy.
  const audio = createAudio({
    settings: () => game.state.settings,
    heat: () => game.econ.heatRatio(game.state),
    // Faz 1.4: which RetroAmp playlist (if any) is actually paying right now
    // — the same rule `retroampMultiplier` uses, so the ambient bed and the
    // Buzz multiplier always agree on whether a playlist is "live".
    playlist: () => game.econ.activePlaylist(game.state),
    sdk,
  });
  document.addEventListener('pointerdown', () => audio.unlock());
  document.addEventListener('touchend', () => audio.unlock());
  document.addEventListener('keydown', () => audio.unlock());

  const wm = createWindowManager({ root: document.getElementById('windows') });
  const notify = createNotifier(document.getElementById('toasts'));
  game.bus.on(game.events.NOTIFY, notify);

  /**
   * Every ad in the game goes through this adapter (GDD 8). It resolves whether
   * ads can run at all — off-portal, or behind an ad blocker, they cannot — and
   * every placement asks it rather than reaching for the SDK itself, so a
   * blocked player is shown a game with no dead buttons in it.
   */
  const ads = createAds({ sdk, game, notify });
  // Bounded, and off the critical path either way: nothing on the first screen
  // is an ad, and the offer row re-reads `ads.available` on its own timer.
  withTimeout(ads.init(), ADS_INIT_TIMEOUT_MS).catch((err) =>
    console.warn('[aeroos] ad init failed; assuming ads are available', err),
  );

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
    // Apps get the audio bus too: AeroSweeper turns over thirty squares in one
    // click, which is far too fast and too transient for the event bus.
    wm.open(app, (body) => mountApp(id, body, { game, wm, audio, ads }));
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
    reducedMotion: motion.isReduced,
  });

  game.bus.on(game.events.FORMAT_REQUESTED, ({ dollars }) => {
    if (formatSequence.busy) return;
    confirmFormat({
      root: document.body,
      dollars,
      /**
       * The payout boost (GDD 8). This is the strongest rewarded placement in
       * an idle game — the player is one click from cashing in a whole run, so
       * "+50% on that" is asked at the exact moment it is worth the most. It
       * offers itself only when the boost is available and unclaimed; the
       * dialog renders no button otherwise.
       */
      boost: ads.available && game.adOffer('formatBoost').ok
        ? {
            multiplier: ADS.rewarded.formatBoost.multiplier,
            run: async () => {
              const claimed = await ads.claim('formatBoost');
              return claimed ? game.formatPayout() : null;
            },
          }
        : null,
      onConfirm: async () => {
        gameplay.stop();
        const summary = await formatSequence.run(async () => {
          // The interstitial goes *inside* the sequence, behind the stop
          // screen: the machine is visibly dead, so the break costs the player
          // nothing they were doing. No countdown here — the BSOD is already
          // the warning that nothing is running.
          await ads.midgame('format', { silent: true });
          const result = game.formatC();
          return {
            dollars: result.dollars ?? 0,
            bonus: result.bonus ?? 0,
            prestigeCount: game.state.prestigeCount,
            ramMB: game.econ.ramCapacity(game.state),
          };
        });
        gameplay.start();
        notify({
          title: 'Format complete',
          body: `Banked $${(summary.dollars + summary.bonus).toFixed(2)}${
            summary.bonus > 0 ? ` (including a $${summary.bonus.toFixed(2)} sponsor bonus)` : ''
          }. Spend it on hardware in My Computer.`,
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
    [game.events.UNITS_BOUGHT]: 'buy',
    [game.events.APP_INSTALLED]: 'hdd',
    [game.events.APP_OPENED]: 'click',
    [game.events.OUT_OF_MEMORY]: 'error',
    [game.events.HARDWARE_BOUGHT]: 'coin',
    [game.events.STATUS_CLAIMED]: 'coin',
    [game.events.SEED_STARTED]: 'hdd',
    [game.events.BANDWIDTH_UPGRADED]: 'buy',
    [game.events.QUARANTINE_CLAIMED]: 'coin',
    [game.events.SCAN_DONE]: 'chime',
    [game.events.BURN_STARTED]: 'burn',
    [game.events.BURN_DONE]: 'chime',
    [game.events.DISC_PLAYED]: 'coin',
    [game.events.PLAYLIST_LOADED]: 'click',
    [game.events.SWEEPER_TOKEN]: 'chime',
    [game.events.DEFRAG_INSTALLED]: 'hdd',
    [game.events.DEFRAG_STARTED]: 'hdd',
    [game.events.DEFRAG_DONE]: 'chime',
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
    // Read the streak *after* nudge() has already advanced it, so the pitch
    // the player hears matches the meter they're looking at (AO-5, Faz 1.2).
    if (source === 'nudge') audio.playNudgeClick(game.econ.clickStreak(game.state).count);
  });

  const desktop = createDesktop({
    iconRoot: document.getElementById('icons'),
    gadgetRoot: document.getElementById('gadget-slot'),
    game,
    launch,
    ads,
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

  /**
   * A desktop where nothing moves looks broken, not accessible. If motion is
   * off only because the OS asked for it, say so and offer the one click that
   * changes it — silently rendering a still image of an animated game is the
   * worse failure. An explicit 'reduced' choice gets no nagging.
   */
  if (game.state.settings.motion === 'auto' && motion.isReduced()) {
    console.info('[aeroos] system asks for reduced motion; desktop animations are off');
    notify({
      title: 'Animations are off',
      body: 'Your system asks for reduced motion, so the desktop is holding still.',
      tone: 'info',
      duration: 0,
      action: {
        label: 'Turn animations on',
        onClick: () => game.setSettings({ motion: 'full' }),
      },
    });
  }

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
  game.bus.on(game.events.BANDWIDTH_UPGRADED, ({ connection }) => {
    notify({
      title: `${connection.label} connected`,
      body: `Every seed slot now pays ×${connection.multiplier}.`,
      tone: 'success',
    });
  });

  // Stopping a seed is not instant, and the player has to learn that the first
  // time: the slot frees immediately, the disk does not.
  game.bus.on(game.events.SEED_STOPPED, ({ file, secondsLeft }) => {
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

  /**
   * The catch. This is the balloon the whole lootbox loop hangs off, so it says
   * what was caught and where it went — a threat the player never notices is a
   * reward they never open.
   */
  game.bus.on(game.events.THREAT_QUARANTINED, ({ threat }) => {
    taskbar.flag('shield99', true);
    notify({
      title: 'Shield99: 1 threat moved to Quarantine',
      body: `${threat.name} is sealed and waiting. Open Shield99 to extract it.`,
      tone: 'success',
    });
  });

  game.bus.on(game.events.QUARANTINE_CLAIMED, ({ threat, reward, viaAd }) => {
    taskbar.flag('shield99', game.state.shield99.quarantine.length > 0);
    const payout =
      reward.kind === 'buzz'
        ? `+${formatNumber(reward.buzz)} Buzz`
        : reward.kind === 'buff'
          ? `+${Math.round(reward.magnitude * 100)}% to everything for ${reward.durationSeconds / 60} minutes`
          : `your render jumped ${Math.round(reward.renderFraction * 100)}%`;
    notify({
      title: `${threat.name} disinfected`,
      body: viaAd ? `${payout}.` : `${payout} — the full payload needs the ad.`,
      tone: 'success',
    });
  });

  game.bus.on(game.events.VIRUS, ({ outcome }) => {
    const messages = {
      blocked: ['Shield99 blocked a threat', 'Quarantine is full — clear it to keep collecting.', 'info'],
      rescued: [
        'Shield99 free trial saved you',
        'A threat got through while nothing was watching. That was your one free rescue — install and open Shield99 to stay covered.',
        'warn',
      ],
      infected: [
        'Your machine is infected',
        'Production is halved and sharing is suspended. Run a Shield99 deep scan to clean it — nothing you have earned is lost.',
        'error',
      ],
    };
    const [title, bodyText, tone] = messages[outcome];
    notify({ title, body: bodyText, tone });
    if (outcome === 'infected') taskbar.flag('shield99', true);
  });

  game.bus.on(game.events.SCAN_DONE, ({ cured }) => {
    // The flag belongs to whatever still needs attention: a cured machine with
    // files in quarantine is still asking to be opened.
    taskbar.flag('shield99', game.state.shield99.quarantine.length > 0);
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

  /**
   * AeroSweeper (Day 7). The balloon is the handoff: the round is banked, the
   * combo is running, and the thing to do with it is go and click.
   */
  game.bus.on(game.events.SWEEPER_ENDED, ({ tiles, combo, buzz }) => {
    if (tiles === 0) {
      notify({
        title: 'Round over',
        body: 'That board never opened. The first square is always safe — start there.',
        tone: 'warn',
      });
      return;
    }
    notify({
      title: combo.hitMine
        ? `Mine at ${tiles} squares`
        : combo.cleared
          ? 'Board swept'
          : `${tiles} squares banked`,
      body: `Nudge pays ×${(1 + combo.magnitude).toFixed(1)} for ${Math.round(
        combo.durationSeconds / 60,
      )} minutes${buzz > 0 ? `, plus ${formatNumber(buzz)} Buzz` : ''}.${
        combo.hitMine ? ' Half of it survived the blast.' : ''
      }`,
      tone: combo.hitMine ? 'warn' : 'success',
    });
    if (sdk && combo.cleared) sdk.game.happytime();

    /**
     * A banked round is the closest thing this game has to a level ending: the
     * board is gone, the reward is on screen and nothing is being clicked. That
     * is the natural break the interstitial guide asks for — and the SDK, not
     * this call site, decides whether it has been long enough.
     */
    if (tiles > 0) ads.midgame('sweeper-round');
  });

  game.bus.on(game.events.SWEEPER_TOKEN, ({ granted, bought }) => {
    if (bought) return; // the player just paid for it; they know
    taskbar.flag('aerosweeper', true);
    notify({
      title: `${granted} sweeper ${granted === 1 ? 'token' : 'tokens'}`,
      body: 'A fresh board is waiting. Safe squares multiply the Nudge button.',
      tone: 'info',
    });
  });

  game.bus.on(game.events.SWEEPER_STARTED, () => taskbar.flag('aerosweeper', false));

  // The other natural break: a four-hour render has just been collected, which
  // is a milestone screen in everything but name — and the portal's own idea of a
  // good moment, which is what happytime() reports.
  game.bus.on(game.events.RENDER_CLAIMED, () => {
    if (sdk) sdk.game.happytime();
    ads.midgame('render-collected');
  });

  /**
   * One place to announce every rewarded payout, so a new placement gets its
   * balloon for free and none of them can drift into inventing their own copy.
   * The Format C: boost is deliberately silent here — the confirm dialog it was
   * bought from restates the new figure, which is a better answer than a
   * balloon behind it.
   */
  game.bus.on(game.events.AD_REWARD, ({ id, reward }) => {
    if (id === 'formatBoost' || id === 'offlineDouble') return;
    const bodies = {
      buzz: () => `+${formatNumber(reward.buzz)} Buzz.`,
      buff: () =>
        `+${Math.round(reward.magnitude * 100)}% to everything for ${
          reward.durationSeconds / 60
        } minutes.`,
      token: () => 'A fresh board is waiting in AeroSweeper.',
      render: () => `The render jumped ${Math.round(reward.renderFraction * 100)}%.`,
    };
    notify({
      title: id === 'gift' ? 'Sponsor bonus collected' : 'Thanks for watching',
      body: bodies[reward.kind]?.() ?? 'Reward applied.',
      tone: 'success',
    });
    audio.play('coin');
  });

  /**
   * Auto-Defrag. Two balloons, both of them load-bearing: the machine has
   * started taking 5% of production without being asked, and the player is
   * owed the sentence that says why — and then the one that says it is over
   * and the bloat they were watching climb is gone.
   */
  game.bus.on(game.events.DEFRAG_STARTED, ({ from }) => {
    notify({
      title: 'Auto-Defrag started',
      body: `System bloat hit ${Math.round(from * 100)}%. Sweeping it back to zero — production is down 5% until it finishes.`,
      tone: 'info',
    });
  });

  game.bus.on(game.events.DEFRAG_DONE, () => {
    notify({
      title: 'Defrag complete',
      body: 'The disk is contiguous and the machine is quiet again.',
      tone: 'success',
    });
  });

  /**
   * A cosmetic unlock is a reward with no mechanical payload, so the balloon is
   * the entire reward — and it carries the one click that spends it, because
   * "something is available in a settings panel" is not something anybody acts
   * on later.
   */
  game.bus.on(game.events.COSMETIC_UNLOCKED, ({ item }) => {
    notify({
      title: `${item.label} unlocked`,
      body: item.blurb,
      tone: 'success',
      action: {
        label: 'Use it',
        onClick: () => game.setCosmetic(item.kind, item.id),
      },
    });
  });

  /**
   * A milestone is the only thing a purchase can announce now (GDD §2.3), so
   * this is the hook the per-building celebrations will hang off in Phase 2.
   * Until they exist it stays a balloon — but a balloon in the building's own
   * language, counting the building's own unit, not AeroChat's buddies.
   */
  game.bus.on(game.events.MILESTONE, ({ id, at, multiplier, minigameUnlocked }) => {
    const building = getBuilding(id);
    notify({
      title: `${at} ${building.units}`,
      body: minigameUnlocked
        ? `${building.name} is now ×${multiplier} — and ${building.minigame.title} is unlocked.`
        : `${building.name} production is now ×${multiplier}.`,
      tone: 'success',
    });
  });

  // Restore whatever was open last session.
  const previouslyOpen = Object.entries(game.state.apps)
    .filter(([, entry]) => entry.open)
    .map(([id]) => id);
  for (const entry of Object.values(game.state.apps)) entry.open = false;

  /**
   * The first screen of a brand-new save has exactly one thing on it.
   *
   * AeroChat used to be opened for them, so the very first frame a new player
   * saw was an icon column, a taskbar, a gadget and a 340×420 buddy-list window
   * — four surfaces, and no indication which of them was the game. Now the
   * desktop opens bare, the spotlight rings the Nudge button, and AeroChat
   * arrives *as the payoff for the first click*: the first thing the player
   * does causes a visible thing to happen, which is the entire job of the
   * opening ten seconds.
   *
   * Only for a genuinely untouched save. Anything else — a reload, a returning
   * player, a finished tour — restores as before.
   */
  const firstRun =
    !loaded.loaded &&
    !game.state.tutorial.done &&
    game.state.tutorial.step === 0 &&
    game.state.stats.nudges === 0;

  if (previouslyOpen.length > 0) previouslyOpen.forEach(launch);
  else if (!firstRun) launch('aerochat');
  else {
    const stop = game.bus.on(game.events.BUZZ_GAINED, ({ source }) => {
      if (source !== 'nudge') return;
      stop();
      launch('aerochat');
    });
  }

  // Offline earnings get a dialog rather than a balloon (AO-28): a report that
  // fades in four seconds is a poor way to explain an HDD cap.
  const offline = game.offlineReport;
  if (offline?.buzz > 0) {
    showWelcomeBack({
      root: document.body,
      offline,
      hoursCap: offline.cappedHours,
      /**
       * The "Internet Cafe Bonus" (GDD 8) — the highest-converting placement an
       * idle game has, because the player is looking at earnings they nearly
       * left on the table. The dialog renders no button when ads cannot run.
       */
      multiplier: ADS.rewarded.offlineDouble.multiplier,
      onDouble:
        ads.available && game.adOffer('offlineDouble').ok
          ? async () => {
              const watched = await ads.rewarded('offlineDouble');
              if (!watched) return;
              const result = game.doubleOfflineBuzz();
              if (!result.ok) return;
              notify({
                title: 'Internet Cafe bonus',
                body: `Your buddies kept the machine warm — +${formatNumber(result.buzz)} Buzz.`,
                tone: 'success',
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
      // The coach itself is throttled to 200 ms, but the ring it draws is
      // attached to a window the player may be dragging right now.
      coach.refreshSpotlight();
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
    /**
     * What the portal knows about this session.
     *
     * Two additions beyond the progress numbers, both there to be read back
     * against a support report rather than to change anything in the game:
     *
     * - `orientation`, because mobile orientation is locked to Portrait at the
     *   submission level and this is the only way to confirm the lock is actually
     *   holding. Anything other than a portrait reading on a phone means players
     *   are still landing in a viewport shape the layout is not built for.
     * - the crash counters, because an error nobody catches is otherwise
     *   indistinguishable from a player who simply left.
     * - `userAgent`, because the SDK has no separate crash/error channel to
     *   correlate against — `setGameContext` is the only read-back path there
     *   is (confirmed against the SDK's own docs: no `reportError`/`logEvent`
     *   equivalent exists). Without it, a rising error count has no way to
     *   answer "on what browser or device", which is the first thing worth
     *   knowing about a crash-rate trend.
     *
     * Reported once immediately as well as on the interval: a session that breaks
     * in its first thirty seconds is precisely the session worth hearing about,
     * and it would never reach the first tick.
     */
    const reportContext = () => {
      const hwTotal = game.state.hardware.cpu + game.state.hardware.ram + game.state.hardware.hdd;
      let percentage = (hwTotal / 30) * 100;
      if (hwTotal === 0) percentage = Math.min(10, (game.econ.buddyCount(game.state) / 100) * 10);
      percentage = Math.floor(Math.min(100, Math.max(0, percentage)));

      sdk.game.reportGameCompletedPercentage(percentage);
      sdk.game.setGameContext({
        bots: game.econ.buddyCount(game.state),
        prestige: game.state.prestigeCount,
        cpu: game.state.hardware.cpu,
        ram: game.state.hardware.ram,
        hdd: game.state.hardware.hdd,
        orientation: globalThis.screen?.orientation?.type ?? 'unknown',
        viewport: `${window.innerWidth}×${window.innerHeight}`,
        userAgent: globalThis.navigator?.userAgent ?? 'unknown',
        errors: crashes.count,
        lastError: crashes.last ?? '',
      });
    };

    // Wrapped, like the gameplay lifecycle calls: a portal method that is absent
    // or throws must not take a 30-second interval — or the boot — down with it.
    const safeReport = () => {
      try {
        reportContext();
      } catch (err) {
        console.warn('[aeroos] portal context report failed', err);
      }
    };

    safeReport();
    setInterval(safeReport, 30000);
  }

  loop.start();

  // Never lose progress to a tab close or a phone switching apps.
  // Also strictly required by CrazyGames to pause gameplay state when backgrounded.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      game.save();
      gameplay.stop();
    } else {
      gameplay.start();
    }
  });
  window.addEventListener('pagehide', () => game.save());

  // Fade the splash out, then take it off the page. Left in place it is an
  // invisible full-screen layer whose scanning bar keeps animating — and
  // therefore keeps being composited — for the rest of the session.
  const bootScreen = document.getElementById('boot');
  if (bootScreen) {
    bootScreen.classList.add('is-done');
    bootScreen.addEventListener('transitionend', () => bootScreen.remove(), { once: true });
    setTimeout(() => bootScreen.remove(), 1000);
  }

  /**
   * The portal's funnel is built out of these four calls, and the order matters
   * as much as the fact of making them: loading has to *stop* before gameplay
   * can *start*. This used to announce gameplay a hundred lines before it
   * reported the load as finished, which is not a sequence the portal can make
   * sense of — a game that never cleanly starts gameplay is a game whose
   * conversion is undercounted no matter how good the first minute is.
   */
  gameplay.loaded();
  gameplay.start();

  // Handy during development; harmless in production.
  globalThis.AeroOS = { game, wm, launch, audio, motion, theme, sdk, ads };
  mountDevPanel({ game });
}

/** Boot failures are silent otherwise — an async boot() rejects into nothing. */
const start = () =>
  void boot().catch((err) => {
    reportError('boot-failed', err?.stack ?? err);
    // Best-effort, and deliberately not routed through `reportContext` further
    // down this file: that closure never gets built if boot() throws before
    // reaching it, which is precisely the case here.
    try {
      portalSdk?.game?.setGameContext({
        errors: crashes.count,
        lastError: crashes.last ?? '',
        userAgent: globalThis.navigator?.userAgent ?? 'unknown',
      });
    } catch (contextErr) {
      console.warn('[aeroos] portal context report failed', contextErr);
    }
  });

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
