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
 */

import { NUDGE_JUICE } from '../data/balance.js';

const SEMITONE = 2 ** (1 / 12);
const note = (semitonesFromA4) => 440 * SEMITONE ** semitonesFromA4;

/** A minor-ish set that always sounds passable in any order. */
const SCALE = [-9, -7, -5, -2, 0, 3, 5, 7]; // A minor pentatonic-ish, two octaves

/** Master bus level when we are not muted. Named because the mute restores it. */
const MASTER_GAIN = 0.5;

export function createAudio({ settings, heat = () => 0, sdk = globalThis.CrazyGames?.SDK }) {
  let ctx = null;
  let master = null;
  let shaper = null;
  let sfxBus = null;
  let musicBus = null;
  let musicTimer = null;
  let step = 0;
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
    musicBus.gain.value = 0.22;

    sfxBus.connect(shaper);
    musicBus.connect(shaper);
    shaper.connect(master);
    master.connect(ctx.destination);
    return ctx;
  }

  /** Call from a click handler — browsers refuse to start audio otherwise. */
  function unlock() {
    const context = ensureContext();
    if (!context) return;
    if (context.state === 'suspended') context.resume();
    if (bgmOn() && !musicTimer) startMusic();
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
      tone({ freq: 660, type: 'square', decay: 0.08, peak: 0.18, slideTo: 990 });
      noise({ duration: 0.04, peak: 0.2, frequency: 3200 });
      return;
    }

    const { pitchStepPerClick, pitchCeiling } = NUDGE_JUICE;
    // The bonus starts on the second click, same rule as clickStreak() — a
    // single considered press sounds exactly like the button always has.
    const steps = Math.max(streakCount - 1, 0);
    const shift = Math.min(1 + steps * pitchStepPerClick, pitchCeiling);

    noise({ duration: 0.03, peak: 0.32, frequency: 2600 * shift, q: 0.7 });
    tone({ freq: 180 * shift, type: 'square', decay: 0.05, peak: 0.12 });
    tone({ freq: 1320 * shift, type: 'sine', decay: 0.055, peak: 0.14 });

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
   * A slow arpeggio over a held pad — "light retro synthwave" (GDD 2) with a
   * scheduler rather than a loop file, so it never repeats exactly and costs
   * nothing to ship.
   */
  function tickMusic() {
    if (!ctx || ctx.state !== 'running' || !bgmOn()) return;

    const heatNow = heat();
    const root = SCALE[step % SCALE.length];
    const octave = step % 16 < 8 ? 0 : 12;

    // Arpeggio voice.
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = note(root + octave - 12);
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    osc.connect(gain).connect(musicBus);
    osc.start();
    osc.stop(t + 0.4);

    // Every fourth step, a low pulse — the "driving" part when things heat up.
    if (step % 4 === 0) {
      const bass = ctx.createOscillator();
      const bassGain = ctx.createGain();
      bass.type = 'sawtooth';
      bass.frequency.value = note(root - 24);
      bassGain.gain.setValueAtTime(0.0001, t);
      bassGain.gain.exponentialRampToValueAtTime(0.1 + heatNow * 0.08, t + 0.02);
      bassGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      bass.connect(bassGain).connect(musicBus);
      bass.start();
      bass.stop(t + 0.55);
    }
    step += 1;
  }

  function startMusic() {
    if (musicTimer || !bgmOn()) return;
    const context = ensureContext();
    if (!context) return;
    musicTimer = setInterval(tickMusic, 340);
  }

  function stopMusic() {
    if (musicTimer) clearInterval(musicTimer);
    musicTimer = null;
  }

  /* ----------------------------------------------------------------- heat */

  /**
   * Called from the render loop. As the machine heats up the master bus is
   * pushed harder and detuned slightly — the audio equivalent of the desktop
   * desaturating (AO-27).
   */
  function update() {
    if (!ctx || ctx.state !== 'running') return;
    const value = Math.round(heat() * 20) / 20; // quantised, so we reshape rarely
    if (value === lastHeat) return;
    lastHeat = value;
    shaper.curve = makeCurve(value * 0.8);
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
    get context() {
      return ctx;
    },
    /** True while the portal has muted us, whatever `state.settings` says. */
    get portalMuted() {
      return portalMuted;
    },
    dispose() {
      stopMusic();
      try {
        sdk?.game?.removeSettingsChangeListener?.(applyPortalSettings);
      } catch {
        /* the listener was never registered */
      }
    },
  };
}
