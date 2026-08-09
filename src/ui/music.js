/**
 * Music engine (audio overhaul).
 *
 * Plays the songbook in `src/data/music.js`. Still 100% synthesised — nothing
 * is fetched and nothing is shipped but code — but where the old ambient loop
 * walked a pentatonic scale on a `setTimeout` per note, this is a real
 * sequencer: sample-accurate lookahead scheduling, arranged sections, drums,
 * a proper mixer with sends, and instruments that sound like instruments.
 *
 * Lives in `ui/` for the same reason `audio.js` does: AudioContext is a
 * browser API and must not leak into the simulation. `data/music.js` stays
 * pure so the songs themselves remain testable in Node.
 *
 * ── Why lookahead scheduling ────────────────────────────────────────────────
 * `setTimeout` fires whenever the main thread gets around to it, which on a
 * frame where the desktop is re-rendering can be 30 ms late. At 138 BPM a step
 * is 108 ms, so that lateness is audible as swing you didn't ask for — it is
 * most of why the old loop read as "ambient noise" rather than "music". Here a
 * 25 ms timer only *schedules*: every note is handed to WebAudio with an exact
 * `ctx.currentTime`-relative start, and the audio thread plays it on time even
 * if the main thread stalls.
 *
 * ── Cost ────────────────────────────────────────────────────────────────────
 * Voices are deliberately cheap: 3 oscillators max for the supersaw, one
 * shared noise buffer for every drum and hiss, one small generated impulse
 * response for the reverb (built lazily, on the first bar that needs it).
 * Nodes are created per note and left to be collected after `stop()`, which is
 * the normal WebAudio idiom and keeps the graph flat.
 */

import { SCALES, CHORDS, TRACKS, tracksFor, sectionBars, STEPS_PER_BAR } from '../data/music.js';

const LOOKAHEAD_S = 0.16; // how far ahead of the playhead we schedule
const TICK_MS = 25; // how often we top the schedule up

/**
 * Brightness. One place to make the whole soundtrack darker or brighter,
 * because "it's a bit shrill" is a mix note, not nine separate song bugs.
 *
 * Two things make synthesised music fatiguing in a way recorded music isn't:
 * sawtooth harmonics run flat all the way to Nyquist where a real instrument
 * rolls off, and a high note played at the same level as a low one is
 * perceived as much louder (the ear peaks around 3–4 kHz). So there are two
 * fixes here rather than one blanket lowpass, which would only muffle the bass.
 *
 * `masterCutoff` / `air*` shape the mix; `tilt*` makes individual notes quieter
 * as they climb, which is what keeps a lead's top octave from jumping out.
 * Raise `masterCutoff` toward 12000 and drop `airShelfDb` to 0 to get the
 * previous, brighter voicing back.
 */
export const TONE = {
  masterCutoff: 7400, // gentle lowpass over the whole mix
  airShelfHz: 3600, // the fatigue band: presence, sibilance, cymbal sizzle
  airShelfDb: -4.5,
  tiltFromHz: 700, // notes above this start losing level…
  tiltPerOctave: 0.34, // …by this fraction per octave…
  tiltFloor: 0.45, // …down to this much of nominal, never silent
};
const SEMITONE = 2 ** (1 / 12);
const hz = (semitonesFromA4) => 440 * SEMITONE ** semitonesFromA4;

/** Per-part defaults; a track's `mix` shallow-overrides these. */
const DEFAULT_MIX = {
  lead: { gain: 0.4, rev: 0.28, dly: 0.3 },
  arp: { gain: 0.3, rev: 0.24, dly: 0.2 },
  pad: { gain: 0.28, rev: 0.5, dly: 0.05 },
  bass: { gain: 0.5, rev: 0.03, dly: 0 },
  drums: { gain: 0.52, rev: 0.14, dly: 0.04 },
  fx: { gain: 0.3, rev: 0.4, dly: 0.2 },
};

const PARTS = ['lead', 'arp', 'pad', 'bass', 'drums', 'fx'];

/**
 * `createMusicEngine`
 *
 * @param ctx          a running AudioContext
 * @param destination  node to play into (audio.js passes its music bus, so the
 *                     heat waveshaper, portal mute and Nudge ducking all still
 *                     apply on top of whatever this produces)
 * @param heat         () => 0..1, the machine's temperature
 * @param playlist     () => playlist id or null, straight from RetroAmp
 */
export function createMusicEngine({
  ctx,
  destination,
  heat = () => 0,
  playlist = () => null,
  random = Math.random,
}) {
  /* ------------------------------------------------------------------ mixer */

  const out = ctx.createGain();
  out.gain.value = 0; // faded in by start(), so a track never begins with a click
  out.connect(destination);

  // Tone shaping sits *after* the compressor on purpose: compressing a bright
  // signal and then darkening it is what a mastering chain does. Darkening
  // first would just make the compressor push the highs back up.
  const airShelf = ctx.createBiquadFilter();
  airShelf.type = 'highshelf';
  airShelf.frequency.value = TONE.airShelfHz;
  airShelf.gain.value = TONE.airShelfDb;
  airShelf.connect(out);

  const tame = ctx.createBiquadFilter();
  tame.type = 'lowpass';
  tame.frequency.value = TONE.masterCutoff;
  tame.Q.value = 0.4; // no resonance — a peak here is the exact thing we're removing
  tame.connect(airShelf);

  // Glue. Without it the drop of a trance track and the empty bar before it
  // differ by ~12 dB and the player reaches for the volume slider.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 14;
  comp.ratio.value = 3.5;
  comp.attack.value = 0.005;
  comp.release.value = 0.2;
  comp.connect(tame);

  const dry = ctx.createGain();
  dry.connect(comp);

  // Reverb and delay are built on demand — a track with no sends never pays
  // for the impulse response.
  let reverb = null;
  let delay = null;

  function getReverb() {
    if (reverb) return reverb;
    const convolver = ctx.createConvolver();
    convolver.buffer = makeImpulse(1.9, 2.6);
    const ret = ctx.createGain();
    ret.gain.value = 0.85;
    convolver.connect(ret).connect(comp);
    reverb = convolver;
    return reverb;
  }

  function getDelay() {
    if (delay) return delay;
    const node = ctx.createDelay(1.5);
    node.delayTime.value = 0.35; // retuned per track to a dotted 8th
    const feedback = ctx.createGain();
    feedback.gain.value = 0.33;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2800;
    const ret = ctx.createGain();
    ret.gain.value = 0.6;
    node.connect(damp).connect(feedback).connect(node);
    damp.connect(ret).connect(comp);
    delay = node;
    return delay;
  }

  /** Noise-burst impulse response: a plausible hall for about 40 lines less than a file. */
  function makeImpulse(seconds, decay) {
    const frames = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, frames, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < frames; i += 1) {
        data[i] = (random() * 2 - 1) * (1 - i / frames) ** decay;
      }
    }
    return buffer;
  }

  // One white-noise buffer, reused by every hat, snare, riser and hiss.
  let noiseBuffer = null;
  function getNoise() {
    if (noiseBuffer) return noiseBuffer;
    const frames = Math.floor(ctx.sampleRate * 2);
    noiseBuffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = random() * 2 - 1;
    return noiseBuffer;
  }

  function noiseSource(time, duration) {
    const src = ctx.createBufferSource();
    src.buffer = getNoise();
    src.loop = true;
    src.start(time, random() * 1.5, duration + 0.05);
    return src;
  }

  // Per-part bus with fixed dry/reverb/delay sends.
  const buses = {};
  for (const part of PARTS) {
    const bus = ctx.createGain();
    const rev = ctx.createGain();
    const dly = ctx.createGain();
    bus.connect(dry);
    bus.connect(rev);
    bus.connect(dly);
    buses[part] = { bus, rev, dly, revConnected: false, dlyConnected: false };
  }

  function applyMix(track) {
    for (const part of PARTS) {
      const conf = { ...DEFAULT_MIX[part], ...(track.mix?.[part] ?? {}) };
      const slot = buses[part];
      slot.bus.gain.value = conf.gain;
      slot.rev.gain.value = conf.rev;
      slot.dly.gain.value = conf.dly;
      if (conf.rev > 0 && !slot.revConnected) {
        slot.rev.connect(getReverb());
        slot.revConnected = true;
      }
      if (conf.dly > 0 && !slot.dlyConnected) {
        slot.dly.connect(getDelay());
        slot.dlyConnected = true;
      }
    }
    if (delay) {
      // Dotted eighth: the trance/garage delay, and harmless everywhere else.
      delay.delayTime.setTargetAtTime((60 / track.bpm) * 0.75, ctx.currentTime, 0.05);
    }
  }

  /* ------------------------------------------------------------ envelopes */

  /**
   * ADSR onto a gain node. Returns the time the note is fully silent, which is
   * what every caller passes to `osc.stop()` — nodes must be told to stop or
   * they stay alive and, with a few hundred per minute, that adds up.
   */
  function env(gain, time, duration, { a = 0.006, d = 0.08, s = 0.7, r = 0.12, peak = 1 }) {
    const sustain = Math.max(peak * s, 0.0001);
    const hold = Math.max(duration, a + d);
    const g = gain.gain;
    g.setValueAtTime(0.0001, time);
    g.linearRampToValueAtTime(Math.max(peak, 0.0001), time + a);
    g.linearRampToValueAtTime(sustain, time + a + d);
    g.setValueAtTime(sustain, time + hold);
    g.exponentialRampToValueAtTime(0.0001, time + hold + r);
    return time + hold + r + 0.02;
  }

  /** Heat detunes the whole rig slightly sharp — a machine straining. */
  const heatDetune = () => heat() * 14;
  const heatCutoff = (base) => Math.max(300, base * (1 - heat() * 0.3));

  /* ------------------------------------------------------------- voices */

  function vSupersaw(bus, freq, time, dur, vel) {
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 1.1;
    const cutoff = heatCutoff(2500);
    filter.frequency.setValueAtTime(cutoff * 0.45, time);
    filter.frequency.linearRampToValueAtTime(cutoff, time + 0.09);
    filter.frequency.setTargetAtTime(cutoff * 0.5, time + dur * 0.6, 0.25);
    const stop = env(gain, time, dur, { a: 0.014, d: 0.12, s: 0.85, r: 0.22, peak: vel * 0.3 });
    for (const cents of [-14, 0, 15]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = cents + heatDetune();
      osc.connect(filter);
      osc.start(time);
      osc.stop(stop);
    }
    filter.connect(gain).connect(bus);
  }

  function vSaw(bus, freq, time, dur, vel) {
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = heatCutoff(2200);
    filter.Q.value = 1;
    const stop = env(gain, time, dur, { a: 0.01, d: 0.1, s: 0.8, r: 0.18, peak: vel * 0.28 });
    for (const cents of [-8, 9]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = cents + heatDetune();
      osc.connect(filter);
      osc.start(time);
      osc.stop(stop);
    }
    filter.connect(gain).connect(bus);
  }

  function vSquare(bus, freq, time, dur, vel) {
    const gain = ctx.createGain();
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    osc.detune.value = heatDetune();
    // A raw square is nothing but odd harmonics and is the harshest waveform
    // available; tracking a lowpass a few harmonics up keeps the chiptune
    // character without the upper partials that cause the fatigue.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(heatCutoff(freq * 6), 6000);
    lp.Q.value = 0.7;
    const stop = env(gain, time, dur, { a: 0.004, d: 0.05, s: 0.6, r: 0.08, peak: vel * 0.22 });
    osc.connect(lp).connect(gain).connect(bus);
    osc.start(time);
    osc.stop(stop);
  }

  /** Filter-swept saw with a fast decay — the trance/garage pluck. */
  function vPluck(bus, freq, time, dur, vel) {
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2.2;
    const top = heatCutoff(3400);
    filter.frequency.setValueAtTime(top, time);
    filter.frequency.exponentialRampToValueAtTime(Math.max(320, top * 0.12), time + Math.min(dur, 0.4) + 0.1);
    const stop = env(gain, time, Math.min(dur, 0.25), { a: 0.002, d: 0.06, s: 0.2, r: 0.16, peak: vel * 0.3 });
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    osc.detune.value = heatDetune();
    osc.connect(filter);
    osc.start(time);
    osc.stop(stop);
    filter.connect(gain).connect(bus);
  }

  /** Two-operator FM electric piano. The Rhodes sound the chillout tracks live on. */
  function vEp(bus, freq, time, dur, vel) {
    const gain = ctx.createGain();
    const carrier = ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.value = freq;

    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = freq * 2;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(freq * 2.4, time);
    modGain.gain.exponentialRampToValueAtTime(freq * 0.08, time + 0.5);
    mod.connect(modGain).connect(carrier.frequency);

    const stop = env(gain, time, dur, { a: 0.004, d: 0.35, s: 0.35, r: 0.5, peak: vel * 0.34 });
    carrier.connect(gain).connect(bus);
    carrier.start(time);
    carrier.stop(stop);
    mod.start(time);
    mod.stop(stop);
  }

  /** FM bell, inharmonic ratio. Glass, chimes, the boot-up motif. */
  function vBell(bus, freq, time, dur, vel) {
    const gain = ctx.createGain();
    const carrier = ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.value = freq;

    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = freq * 2;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(freq * 1.3, time);
    modGain.gain.exponentialRampToValueAtTime(freq * 0.05, time + 0.7);
    mod.connect(modGain).connect(carrier.frequency);

    const stop = env(gain, time, dur, { a: 0.003, d: 0.5, s: 0.25, r: 0.8, peak: vel * 0.3 });
    carrier.connect(gain).connect(bus);
    carrier.start(time);
    carrier.stop(stop);
    mod.start(time);
    mod.stop(stop);
  }

  function vPad(bus, freq, time, dur, vel) {
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = heatCutoff(1900);
    filter.Q.value = 0.8;
    const stop = env(gain, time, dur, { a: 0.5, d: 0.4, s: 0.85, r: 0.9, peak: vel * 0.18 });
    for (const cents of [-9, 10]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = cents + heatDetune();
      osc.connect(filter);
      osc.start(time);
      osc.stop(stop);
    }
    filter.connect(gain).connect(bus);
  }

  function vSub(bus, freq, time, dur, vel) {
    const gain = ctx.createGain();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.04, time);
    osc.frequency.exponentialRampToValueAtTime(freq, time + 0.04);
    // A little edge so it survives phone speakers, which reproduce none of the sine.
    const edge = ctx.createOscillator();
    edge.type = 'triangle';
    edge.frequency.value = freq * 2;
    const edgeGain = ctx.createGain();
    edgeGain.gain.value = 0.12;
    const stop = env(gain, time, dur, { a: 0.006, d: 0.09, s: 0.75, r: 0.1, peak: vel * 0.5 });
    osc.connect(gain);
    edge.connect(edgeGain).connect(gain);
    gain.connect(bus);
    osc.start(time);
    osc.stop(stop);
    edge.start(time);
    edge.stop(stop);
  }

  /** Detuned saw pair through a low filter — the garage/hard-trance reese. */
  function vReese(bus, freq, time, dur, vel) {
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = heatCutoff(900);
    filter.Q.value = 3;
    const stop = env(gain, time, dur, { a: 0.008, d: 0.08, s: 0.8, r: 0.1, peak: vel * 0.34 });
    for (const cents of [-18, 19]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = cents + heatDetune();
      osc.connect(filter);
      osc.start(time);
      osc.stop(stop);
    }
    filter.connect(gain).connect(bus);
  }

  // One shared distortion curve for the guitar voice.
  let chugCurve = null;
  function getChugCurve() {
    if (chugCurve) return chugCurve;
    const n = 1024;
    chugCurve = new Float32Array(n);
    const k = 42;
    for (let i = 0; i < n; i += 1) {
      const x = (i * 2) / n - 1;
      chugCurve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return chugCurve;
  }

  /** Palm-muted distorted guitar: saw + square, clipped, then scooped. */
  function vChug(bus, freq, time, dur, vel) {
    const gain = ctx.createGain();
    const pre = ctx.createGain();
    pre.gain.value = 3;
    const shaper = ctx.createWaveShaper();
    shaper.curve = getChugCurve();
    const post = ctx.createBiquadFilter();
    post.type = 'lowpass';
    post.frequency.value = heatCutoff(3000);
    post.Q.value = 1;
    const body = ctx.createBiquadFilter();
    body.type = 'highpass';
    body.frequency.value = 80;

    const stop = env(gain, time, Math.min(dur, 0.3), { a: 0.002, d: 0.05, s: 0.45, r: 0.06, peak: vel * 0.26 });
    for (const [type, detune] of [['sawtooth', -6], ['square', 7]]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      osc.detune.value = detune + heatDetune();
      osc.connect(pre);
      osc.start(time);
      osc.stop(stop);
    }
    pre.connect(shaper).connect(post).connect(body).connect(gain).connect(bus);
  }

  const VOICES = {
    supersaw: vSupersaw,
    saw: vSaw,
    square: vSquare,
    pluck: vPluck,
    ep: vEp,
    bell: vBell,
    pad: vPad,
    sub: vSub,
    reese: vReese,
    chug: vChug,
  };

  /* -------------------------------------------------------------- drums */

  function drumKick(time, vel) {
    const gain = ctx.createGain();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, time);
    osc.frequency.exponentialRampToValueAtTime(48, time + 0.09);
    gain.gain.setValueAtTime(vel * 0.9, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.34);
    osc.connect(gain).connect(buses.drums.bus);
    osc.start(time);
    osc.stop(time + 0.36);

    // Beater click, so it reads on laptop speakers with no low end at all.
    const click = ctx.createGain();
    click.gain.setValueAtTime(vel * 0.18, time);
    click.gain.exponentialRampToValueAtTime(0.0001, time + 0.02);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1200;
    const src = noiseSource(time, 0.03);
    src.connect(hp).connect(click).connect(buses.drums.bus);
    src.stop(time + 0.04);
  }

  function drumSnare(time, vel) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vel * 0.5, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1650;
    bp.Q.value = 0.8;
    const src = noiseSource(time, 0.2);
    src.connect(bp).connect(gain).connect(buses.drums.bus);
    src.stop(time + 0.22);

    const body = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    body.type = 'triangle';
    body.frequency.setValueAtTime(210, time);
    body.frequency.exponentialRampToValueAtTime(150, time + 0.08);
    bodyGain.gain.setValueAtTime(vel * 0.3, time);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);
    body.connect(bodyGain).connect(buses.drums.bus);
    body.start(time);
    body.stop(time + 0.14);
  }

  function drumClap(time, vel) {
    for (const [i, offset] of [0, 0.011, 0.023].entries()) {
      const gain = ctx.createGain();
      const peak = vel * (i === 2 ? 0.45 : 0.28);
      gain.gain.setValueAtTime(peak, time + offset);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + offset + (i === 2 ? 0.18 : 0.03));
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1500;
      bp.Q.value = 1.2;
      const src = noiseSource(time + offset, 0.2);
      src.connect(bp).connect(gain).connect(buses.drums.bus);
      src.stop(time + offset + 0.2);
    }
  }

  function drumHat(time, vel, open = false) {
    const dur = open ? 0.26 : 0.045;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vel * (open ? 0.15 : 0.12), time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6600;
    const src = noiseSource(time, dur + 0.05);
    src.connect(hp).connect(gain).connect(buses.drums.bus);
    src.stop(time + dur + 0.05);
  }

  function drumCrash(time, vel) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vel * 0.15, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 1.3);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 4200;
    const src = noiseSource(time, 1.4);
    src.connect(hp).connect(gain).connect(buses.drums.bus);
    src.stop(time + 1.4);
  }

  const DRUMS = {
    kick: drumKick,
    snare: drumSnare,
    clap: drumClap,
    hat: (t, v) => drumHat(t, v, false),
    open: (t, v) => drumHat(t, v, true),
    crash: drumCrash,
  };

  /* ------------------------------------------------------------------ fx */

  function fxRiser(time, duration) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.14, time + duration);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration + 0.12);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3;
    bp.frequency.setValueAtTime(400, time);
    bp.frequency.exponentialRampToValueAtTime(6200, time + duration);
    const src = noiseSource(time, duration + 0.2);
    src.connect(bp).connect(gain).connect(buses.fx.bus);
    src.stop(time + duration + 0.2);
  }

  function fxDownlifter(time, duration) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.16, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2;
    bp.frequency.setValueAtTime(7000, time);
    bp.frequency.exponentialRampToValueAtTime(200, time + duration);
    const src = noiseSource(time, duration + 0.1);
    src.connect(bp).connect(gain).connect(buses.fx.bus);
    src.stop(time + duration + 0.1);
  }

  function fxImpact(time) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 1.2);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, time);
    osc.frequency.exponentialRampToValueAtTime(32, time + 0.5);
    osc.connect(gain).connect(buses.fx.bus);
    osc.start(time);
    osc.stop(time + 1.25);
    drumCrash(time, 0.9);
  }

  /** Modem-ish texture for the ambient boot track. Two warbling tones, filtered. */
  function fxNoise(time) {
    for (const [i, freq] of [1180, 1650, 980].entries()) {
      const gain = ctx.createGain();
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time + i * 0.22);
      osc.frequency.linearRampToValueAtTime(freq * 1.3, time + i * 0.22 + 0.2);
      gain.gain.setValueAtTime(0.0001, time + i * 0.22);
      gain.gain.linearRampToValueAtTime(0.05, time + i * 0.22 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + i * 0.22 + 0.24);
      osc.connect(gain).connect(buses.fx.bus);
      osc.start(time + i * 0.22);
      osc.stop(time + i * 0.22 + 0.3);
    }
  }

  /* ----------------------------------------------------------- sequencer */

  let track = null;
  let arrIndex = 0;
  let barInSection = 0;
  let stepInBar = 0;
  let nextStepTime = 0;
  let timer = null;
  let running = false;
  let activePlaylist = null;
  let rotation = [];
  let rotationIndex = 0;

  const secondsPerStep = () => 60 / track.bpm / 4;

  /** Swing pushes every other 16th late — the difference between garage and a drum machine. */
  function swingOffset(step) {
    return step % 2 === 1 ? (track.swing ?? 0) * secondsPerStep() * 0.5 : 0;
  }

  function section() {
    return track.sections[track.arrangement[arrIndex]];
  }

  function chordNow(sec) {
    const [type, rootOffset] = sec.chords[barInSection % sec.chords.length];
    return { tones: CHORDS[type] ?? CHORDS.min, root: track.root + rootOffset };
  }

  /** Scale degree → semitones from A4, wrapping octaves in both directions. */
  function degreeToSemi(degree) {
    const scale = SCALES[track.scale] ?? SCALES.minor;
    const len = scale.length;
    const octave = Math.floor(degree / len);
    const index = ((degree % len) + len) % len;
    return track.root + scale[index] + octave * 12;
  }

  const octaveOf = (part) => track.octaves?.[part] ?? 0;

  /**
   * Equal-level notes are not equal-loudness notes: the ear is most sensitive
   * around 3–4 kHz, so the top of a lead line reads as significantly louder
   * and sharper than its root even though the gain is identical. Rolling level
   * off as pitch climbs is the fix a mixing engineer would reach for, and it
   * keeps the melody intact — unlike folding high notes down an octave, which
   * would silently rewrite the tune.
   */
  function levelTilt(freq) {
    if (freq <= TONE.tiltFromHz) return 1;
    const octavesAbove = Math.log2(freq / TONE.tiltFromHz);
    return Math.max(TONE.tiltFloor, 1 - octavesAbove * TONE.tiltPerOctave);
  }

  function playVoice(part, semi, time, durSteps, vel = 1) {
    const name = track.voices?.[part] ?? 'pluck';
    const fn = VOICES[name] ?? vPluck;
    const dur = Math.max(durSteps * secondsPerStep() - 0.015, 0.04);
    const freq = hz(semi);
    fn(buses[part].bus, freq, time, dur, vel * levelTilt(freq));
  }

  /** A lane may be one pattern or one per bar; bars cycle through the array. */
  function laneStep(lane, bar, step) {
    if (!lane) return '-';
    const pattern = Array.isArray(lane) ? lane[bar % lane.length] : lane;
    return pattern?.[step] ?? '-';
  }

  function scheduleStep(time) {
    const sec = section();
    const absStep = barInSection * STEPS_PER_BAR + stepInBar;
    const chord = chordNow(sec);

    // Drums
    if (sec.drums) {
      for (const [lane, fn] of Object.entries(DRUMS)) {
        const hit = laneStep(sec.drums[lane], barInSection, stepInBar);
        if (hit === 'x') fn(time, 1);
        else if (hit === '.') fn(time, 0.45);
      }
    }

    // Pad — one sustained chord per bar.
    if (sec.pad && stepInBar === 0) {
      const bars = sectionBars(sec);
      const dur = STEPS_PER_BAR;
      for (const tone of chord.tones) {
        playVoice('pad', chord.root + tone + octaveOf('pad'), time, dur, 1);
      }
      // Silence the analyser: `bars` is read to keep pad length honest if a
      // section ever ends mid-bar.
      void bars;
    }

    // Chord-relative parts
    for (const part of ['bass', 'arp']) {
      const events = sec[part];
      if (!events) continue;
      for (const [step, offset, dur] of events) {
        if (step !== absStep) continue;
        playVoice(part, chord.root + offset + octaveOf(part), time, dur, 1);
      }
    }

    // Melody
    if (sec.lead) {
      for (const [step, degree, dur] of sec.lead) {
        if (step !== absStep) continue;
        playVoice('lead', degreeToSemi(degree) + octaveOf('lead'), time, dur, 1);
      }
    }

    // One-shots
    if (sec.fx) {
      for (const [step, kind] of sec.fx) {
        if (step !== absStep) continue;
        const barSeconds = STEPS_PER_BAR * secondsPerStep();
        if (kind === 'riser') fxRiser(time, barSeconds);
        else if (kind === 'downlifter') fxDownlifter(time, barSeconds * 0.75);
        else if (kind === 'impact') fxImpact(time);
        else if (kind === 'noise') fxNoise(time);
      }
    }
  }

  function advance() {
    nextStepTime += secondsPerStep();
    stepInBar += 1;
    if (stepInBar < STEPS_PER_BAR) return;

    stepInBar = 0;
    barInSection += 1;
    if (barInSection < sectionBars(section())) {
      // A bar line is the only place we allow the playlist to change tracks:
      // switching mid-bar is the one thing that makes generative music sound
      // broken rather than varied.
      checkPlaylist();
      return;
    }

    barInSection = 0;
    arrIndex += 1;
    if (arrIndex >= track.arrangement.length) {
      nextTrack();
      return;
    }
    checkPlaylist();
  }

  function pickRotation(playlistId, { advanceIndex = true } = {}) {
    const ids = tracksFor(playlistId);
    if (ids !== rotation) {
      rotation = ids;
      rotationIndex = Math.floor(random() * ids.length);
    } else if (advanceIndex) {
      rotationIndex = (rotationIndex + 1) % ids.length;
    }
    activePlaylist = playlistId;
    return TRACKS[rotation[rotationIndex]] ?? TRACKS['aero-bloom'];
  }

  function loadTrack(next) {
    track = next;
    arrIndex = 0;
    barInSection = 0;
    stepInBar = 0;
    applyMix(track);
  }

  function nextTrack() {
    loadTrack(pickRotation(playlist() ?? 'default'));
  }

  /** Playlist changed under us: finish the bar, then start that playlist's music. */
  function checkPlaylist() {
    const current = playlist() ?? 'default';
    if (current === activePlaylist) return;
    const next = pickRotation(current, { advanceIndex: false });
    if (next.id === track?.id) {
      activePlaylist = current;
      return;
    }
    drumCrash(nextStepTime, 0.7);
    loadTrack(next);
  }

  function tick() {
    if (!running) return;
    const horizon = ctx.currentTime + LOOKAHEAD_S;
    // Guard: if the tab was frozen the clock jumped far ahead of us. Re-anchor
    // rather than scheduling thousands of notes into the past.
    if (nextStepTime < ctx.currentTime - 1) nextStepTime = ctx.currentTime + 0.05;
    let guard = 0;
    while (nextStepTime < horizon && guard < 256) {
      scheduleStep(nextStepTime + swingOffset(stepInBar));
      advance();
      guard += 1;
    }
    timer = setTimeout(tick, TICK_MS);
  }

  /* -------------------------------------------------------------- public */

  function start() {
    if (running || ctx.state !== 'running') return;
    running = true;
    if (!track) loadTrack(pickRotation(playlist() ?? 'default', { advanceIndex: false }));
    nextStepTime = ctx.currentTime + 0.1;
    out.gain.cancelScheduledValues(ctx.currentTime);
    out.gain.setValueAtTime(Math.max(out.gain.value, 0.0001), ctx.currentTime);
    out.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.6);
    tick();
  }

  function stop() {
    running = false;
    if (timer) clearTimeout(timer);
    timer = null;
    // Fade rather than cut: notes already scheduled would otherwise keep
    // ringing over whatever comes next (an ad, a BSOD).
    try {
      out.gain.cancelScheduledValues(ctx.currentTime);
      out.gain.setValueAtTime(out.gain.value, ctx.currentTime);
      out.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.35);
    } catch {
      /* context already closed */
    }
  }

  return {
    start,
    stop,
    get playing() {
      return running;
    },
    /** For the RetroAmp "now playing" line, if you ever want to show it. */
    get nowPlaying() {
      return track ? { id: track.id, title: track.title, genre: track.genre } : null;
    },
    /** Skip to the next track in the current rotation immediately. */
    skip() {
      if (!track) return;
      drumCrash(ctx.currentTime, 0.6);
      nextTrack();
    },
    dispose() {
      stop();
      try {
        out.disconnect();
      } catch {
        /* already gone */
      }
    },
  };
}