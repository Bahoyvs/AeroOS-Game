/**
 * Audio (AO-26, GDD 2).
 *
 * Everything is synthesised with WebAudio — no files to ship, nothing to fetch,
 * no CSP problems, and the whole soundtrack costs a few KB of code instead of
 * megabytes of MP3. That also means the "distortion layer as the system bloats"
 * (GDD 2 / AO-27) is a real knob rather than a second set of assets: a
 * waveshaper on the master bus whose curve follows system heat.
 *
 * Lives in ui/ rather than core/ because it is presentation, and because
 * AudioContext is a browser API that must not leak into the simulation.
 *
 * Autoplay policy: the context is created on the first real user gesture and
 * stays suspended until then, so nothing here can block or warn on boot.
 *
 * Portal mute: CrazyGames can mute the whole game from the site chrome, or
 * because an ad is about to play. That outranks `state.settings` — see
 * `applyPortalSettings`.
 *
 * ── Music ───────────────────────────────────────────────────────────────────
 * The background music used to be a single generative arpeggio in this file,
 * retuned per RetroAmp playlist (the old AMBIENT_PROFILES table). It is now a
 * real sequencer playing arranged songs: `src/data/music.js` holds the
 * songbook, `src/ui/music.js` holds the synthesis. This file still owns
 * everything *around* the music — the heat waveshaper, the portal mute, the
 * Nudge sidechain duck — so all of those apply on top of it unchanged.
 */

import { NUDGE_JUICE } from '../data/balance.js';
import { createMusicEngine } from './music.js';

const SEMITONE = 2 ** (1 / 12);
const note = (semitonesFromA4) => 440 * SEMITONE ** semitonesFromA4;

/** Master bus level when we are not muted. Named because the mute restores it. */
const MASTER_GAIN = 0.5;

/**
 * Music tone control, driven by heat: open when cool, muffled when cooking.
 * `COOL` is deliberately not "wide open" — the engine's own mastering stage
 * (see TONE in ui/music.js) does the fixed tone shaping, and leaving this at
 * 16 kHz on top of it made synth harmonics run flat to Nyquist, which is the
 * fatiguing part.
 */
const MUSIC_FILTER_COOL = 8500;
const MUSIC_FILTER_HOT = 1900;

export function createAudio({
  settings,
  heat = () => 0,
  playlist = () => null,
  sdk = globalThis.CrazyGames?.SDK,
}) {
  let ctx = null;
  let master = null;
  let shaper = null;
  let sfxBus = null;
  let musicBus = null;
  let musicFilter = null;
  let music = null;
  let wantMusic = false;
  let lastHeat = -1;
  let portalMuted = false;
  // The gain `musicBus` is *supposed* to sit at, absent any duck in progress.
  // Ducking ramps away from and back to this rather than a hard-coded 0.22, so
  // it composes with the heat-driven fade in `update()` instead of fighting it.
  let musicBaseGain = 0.22;

  // The portal's mute is folded in here rather than checked at each call site,
  // so every existing gate (play, startMusic, unlock, setEnabled) honours it.
  const sfxOn = () => !portalMuted && settings().sfx !== false;
  const bgmOn = () => !portalMuted && settings().bgm !== false;

  /* --------------------------------------------------------------- engine */

  /**
   * Distortion curve. `amount` 0 is a straight wire; by 1 the signal is being
   * pushed hard, which is exactly what a machine at 94°C should sound like.
   */
  function makeCurve(amount) {
    const k = amount * 60;
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      const x = (i * 2) / n - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return curve;
  }

  function ensureContext() {
    if (ctx) return ctx;
    const AudioCtx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AudioCtx) return null;

    ctx = new AudioCtx();
    master = ctx.createGain();
    // The portal can already have muted us before the first gesture built this.
    master.gain.value = portalMuted ? 0 : MASTER_GAIN;

    shaper = ctx.createWaveShaper();
    shaper.curve = makeCurve(0);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.9;
    musicBus = ctx.createGain();
    musicBus.gain.value = musicBaseGain;

    // Heat closes this down (see `update`), so an overheating machine sounds
    // like it is playing music through a blanket before it sounds distorted.
    musicFilter = ctx.createBiquadFilter();
    musicFilter.type = 'lowpass';
    musicFilter.frequency.value = MUSIC_FILTER_COOL;
    musicFilter.Q.value = 0.7;

    sfxBus.connect(shaper);
    musicBus.connect(musicFilter).connect(shaper);
    shaper.connect(master);
    master.connect(ctx.destination);

    // `resume()` is asynchronous: a `startMusic()` that lands before the
    // context is actually running would otherwise silently do nothing.
    const onStateChange = () => {
      if (ctx.state === 'running' && wantMusic && bgmOn()) ensureMusic()?.start();
    };
    if (ctx.addEventListener) ctx.addEventListener('statechange', onStateChange);
    else ctx.onstatechange = onStateChange;

    return ctx;
  }

  /** Call from a click handler — browsers refuse to start audio otherwise. */
  function unlock() {
    const context = ensureContext();
    if (!context) return;
    if (context.state === 'suspended') context.resume();
    if (bgmOn()) startMusic();
  }

  /* ------------------------------------------------------------ primitives */

  function envelope(node, { attack = 0.005, decay = 0.12, peak = 1 }) {
    const t = ctx.currentTime;
    node.gain.cancelScheduledValues(t);
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), t + attack);
    node.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  function tone({ freq, type = 'square', decay = 0.12, peak = 0.3, bus = sfxBus, slideTo }) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + decay);
    }
    envelope(gain, { decay, peak });
    osc.connect(gain).connect(bus);
    osc.start();
    osc.stop(ctx.currentTime + decay + 0.05);
  }

  /** Filtered noise — the raw material for clicks, HDD chatter and fan hiss. */
  function noise({ duration = 0.08, peak = 0.2, frequency = 1800, q = 1, type = 'bandpass' }) {
    const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;

    const gain = ctx.createGain();
    envelope(gain, { attack: 0.002, decay: duration, peak });

    src.connect(filter).connect(gain).connect(sfxBus);
    src.start();
    src.stop(ctx.currentTime + duration + 0.02);
  }

  /* ------------------------------------------------------------------ SFX */

  const SFX = {
    // Deep, tactile mechanical click (GDD 2).
    click: () => {
      noise({ duration: 0.03, peak: 0.35, frequency: 2600, q: 0.7 });
      tone({ freq: 180, type: 'square', decay: 0.05, peak: 0.12 });
    },
    buy: () => {
      tone({ freq: 523, type: 'triangle', decay: 0.09, peak: 0.2 });
      setTimeout(() => ctx && tone({ freq: 784, type: 'triangle', decay: 0.12, peak: 0.2 }), 70);
    },
    error: () => {
      tone({ freq: 180, type: 'sawtooth', decay: 0.28, peak: 0.22, slideTo: 90 });
    },
    // Authentic HDD read/write chatter (GDD 2).
    hdd: () => {
      for (let i = 0; i < 5; i += 1) {
        setTimeout(
          () => ctx && noise({ duration: 0.022, peak: 0.18, frequency: 1200 + Math.random() * 2200, q: 4 }),
          i * 45 + Math.random() * 25,
        );
      }
    },
    chime: () => {
      [0, 4, 7, 12].forEach((semi, i) => {
        setTimeout(
          () => ctx && tone({ freq: note(semi - 5), type: 'triangle', decay: 0.5, peak: 0.16 }),
          i * 110,
        );
      });
    },
    bsod: () => {
      tone({ freq: 420, type: 'sawtooth', decay: 1.1, peak: 0.25, slideTo: 60 });
      noise({ duration: 0.9, peak: 0.1, frequency: 400, q: 0.5 });
    },
    burn: () => {
      // A CD writer spinning up: rising filtered noise plus a motor tone.
      noise({ duration: 0.5, peak: 0.14, frequency: 900, q: 0.8 });
      tone({ freq: 220, type: 'sawtooth', decay: 0.5, peak: 0.1, slideTo: 480 });
    },
    virus: () => {
      tone({ freq: 300, type: 'sawtooth', decay: 0.5, peak: 0.25, slideTo: 110 });
      setTimeout(() => ctx && tone({ freq: 240, type: 'square', decay: 0.4, peak: 0.2, slideTo: 80 }), 120);
    },
    coin: () => {
      tone({ freq: 880, type: 'square', decay: 0.07, peak: 0.16 });
      setTimeout(() => ctx && tone({ freq: 1320, type: 'square', decay: 0.16, peak: 0.16 }), 60);
    },
    // Squares turning over: a soft wooden knock, not another mouse click.
    tile: () => {
      tone({ freq: 880, type: 'triangle', decay: 0.05, peak: 0.12, slideTo: 1180 });
      noise({ duration: 0.02, peak: 0.12, frequency: 2000, q: 1.2 });
    },
  };

  function play(name) {
    if (!sfxOn()) return;
    const context = ensureContext();
    if (!context || context.state !== 'running') return;
    SFX[name]?.();
  }

  /**
   * The Nudge click (Faz 1.1/1.2, AO-5). Two layers on top of each other: a
   * thick, low mechanical thunk (filtered noise + a square-wave body) and a
   * short high sine "ding" — the same pairing as the AeroChat XP cue, so a
   * streak reads as "the click sound getting excited" rather than a new sound.
   *
   * `streakCount` is `clickStreak(state).count` from the click that just
   * landed — the same number the streak meter is already reading, so the pitch
   * and the meter always agree. It rails at `pitchCeiling` rather than
   * climbing with the streak's own (much higher) `maxCount`, so a long streak
   * stays energetic instead of turning shrill.
   */
  function playNudgeClick(streakCount = 0) {
    if (!sfxOn()) return;
    const context = ensureContext();
    if (!context || context.state !== 'running') return;

    // The kill switch reverts to the sound the button always made — not just
    // pitch/ducking switched off — so Faz 1 is a true independent toggle
    // (see NUDGE_JUICE.visualEnabled's equivalent on the CSS/DOM side).
    if (!NUDGE_JUICE.audioEnabled) {
      // Peaks trimmed ~30% below the original 0.18/0.2: this is the one sound
      // in the game a player hears on every single input, hundreds of times a
      // minute, so it is the one place "quieter" is worth more than "punchier".
      tone({ freq: 660, type: 'square', decay: 0.08, peak: 0.13, slideTo: 990 });
      noise({ duration: 0.04, peak: 0.14, frequency: 3200 });
      return;
    }

    const { pitchStepPerClick, pitchCeiling } = NUDGE_JUICE;
    // The bonus starts on the second click, same rule as clickStreak() — a
    // single considered press sounds exactly like the button always has.
    const steps = Math.max(streakCount - 1, 0);
    const shift = Math.min(1 + steps * pitchStepPerClick, pitchCeiling);

    // Same ~30% trim as the fallback above, split across the three stacked
    // layers so the relative balance (thunk vs. body vs. ding) is unchanged.
    noise({ duration: 0.03, peak: 0.22, frequency: 2600 * shift, q: 0.7 });
    tone({ freq: 180 * shift, type: 'square', decay: 0.05, peak: 0.085 });
    tone({ freq: 1320 * shift, type: 'sine', decay: 0.055, peak: 0.1 });

    duckMusic();
  }

  /**
   * Sidechain ducking (Faz 1.3): every Nudge click pulls the music bus down
   * and lets it spring back, the way a compressor ducks a pad under a kick.
   * Ramps relative to `musicBaseGain` — the level `update()` maintains for the
   * current heat — rather than to a fixed value, so ducking under a hot,
   * already-quiet mix still recovers to the *current* mix instead of jumping it
   * louder.
   */
  function duckMusic() {
    if (!ctx || ctx.state !== 'running' || !musicBus) return;
    const { duckDepth, duckAttackSeconds, duckReleaseSeconds } = NUDGE_JUICE;
    const t = ctx.currentTime;
    musicBus.gain.cancelScheduledValues(t);
    musicBus.gain.setValueAtTime(musicBus.gain.value, t);
    musicBus.gain.linearRampToValueAtTime(musicBaseGain * duckDepth, t + duckAttackSeconds);
    musicBus.gain.linearRampToValueAtTime(musicBaseGain, t + duckAttackSeconds + duckReleaseSeconds);
  }

  /* ------------------------------------------------------------------ BGM */

  /**
   * The sequencer is built once, lazily, and lives as long as the context
   * does. It reads `playlist()` itself and switches songs at the next bar
   * line, so RetroAmp needs no new wiring: the same getter that used to pick
   * an ambient profile now picks a rotation of songs.
   */
  function ensureMusic() {
    const context = ensureContext();
    if (!context) return null;
    if (!music) {
      music = createMusicEngine({
        ctx: context,
        destination: musicBus,
        heat,
        playlist,
      });
    }
    return music;
  }

  function startMusic() {
    if (!bgmOn()) return;
    wantMusic = true;
    const context = ensureContext();
    if (!context) return;
    const engine = ensureMusic();
    // Not running yet means the resume from `unlock()` is still in flight;
    // the statechange listener installed in `ensureContext` picks it up.
    if (context.state === 'running') engine?.start();
  }

  function stopMusic() {
    wantMusic = false;
    music?.stop();
  }

  /* ----------------------------------------------------------------- heat */

  /**
   * Called from the render loop. As the machine heats up the master bus is
   * pushed harder and the music is pulled down and closed off — the audio
   * equivalent of the desktop desaturating (AO-27).
   */
  function update() {
    if (!ctx || ctx.state !== 'running') return;
    const value = Math.round(heat() * 20) / 20; // quantised, so we reshape rarely
    if (value === lastHeat) return;
    lastHeat = value;
    shaper.curve = makeCurve(value * 0.8);
    musicFilter.frequency.setTargetAtTime(
      MUSIC_FILTER_COOL + (MUSIC_FILTER_HOT - MUSIC_FILTER_COOL) * value,
      ctx.currentTime,
      0.4,
    );
    musicBaseGain = 0.22 * (1 - value * 0.35);
    musicBus.gain.value = musicBaseGain;
  }

  function setEnabled({ sfx, bgm }) {
    if (bgm === false) stopMusic();
    if (bgm === true) startMusic();
    if (sfx === false && ctx) lastHeat = -1;
  }

  /* ---------------------------------------------------------------- portal */

  /**
   * CrazyGames' own audio setting. It wins over the in-game toggles, and it is
   * applied to the master gain rather than to `sfxOn()` alone — a scheduled
   * envelope keeps running otherwise, so an ad would start over a tail of
   * whatever was playing. Music is stopped outright rather than left silent,
   * since a muted scheduler is just a timer burning CPU.
   */
  function applyPortalSettings(portalSettings) {
    portalMuted = Boolean(portalSettings?.muteAudio);
    if (master) master.gain.value = portalMuted ? 0 : MASTER_GAIN;
    if (portalMuted) stopMusic();
    else if (bgmOn() && ctx?.state === 'running') startMusic();
  }

  // Optional chaining throughout: off-portal there is no SDK at all, and the
  // shape of one that failed to init is not worth asserting on.
  try {
    sdk?.game?.addSettingsChangeListener?.(applyPortalSettings);
    // The portal may already be muted before the first change event fires.
    applyPortalSettings(sdk?.game?.settings);
  } catch (err) {
    console.warn('[audio] portal audio settings unavailable', err);
  }

  return {
    unlock,
    play,
    playNudgeClick,
    update,
    startMusic,
    stopMusic,
    setEnabled,
    /** Jump to the next song in the current playlist's rotation. */
    skipTrack() {
      music?.skip();
    },
    /** `{ id, title, genre }` of the song playing, or null. For RetroAmp's display. */
    get nowPlaying() {
      return music?.nowPlaying ?? null;
    },
    get context() {
      return ctx;
    },
    /** True while the portal has muted us, whatever `state.settings` says. */
    get portalMuted() {
      return portalMuted;
    },
    dispose() {
      stopMusic();
      music?.dispose();
      music = null;
      try {
        sdk?.game?.removeSettingsChangeListener?.(applyPortalSettings);
      } catch {
        /* the listener was never registered */
      }
    },
  };
}