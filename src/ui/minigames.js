import { MINIGAMES } from '../data/balance.js';
import { getBuilding } from '../data/buildings.js';
import { clear, el, setBar } from './dom.js';

/**
 * The five mini-games (GDD §B) and the window that hosts them.
 *
 * Everything in here obeys the mobile rule (GDD §F), which is not a nice-to-have
 * on a portal where most sessions are phones:
 *
 * - **No hover is ever load-bearing.** Every game is driven by pointer/touch
 *   events on elements that are at least 44px on their shortest side.
 * - **One thumb, portrait.** Nothing needs two simultaneous precise inputs, and
 *   nothing needs a drag longer than a thumb's reach — the tug-of-war uses two
 *   sliders that can be nudged one at a time.
 * - **No text is required to play.** The instruction line is a reminder, not a
 *   rulebook, because it is the first thing a small screen loses.
 *
 * Each game reports a normalised 0..1 score and nothing else. That is the only
 * contract `core/minigames.js` knows about, which is what lets five very
 * different mechanics share one reward curve.
 */

/* ------------------------------------------------------------------- host */

let openHost = null;

/**
 * Open a mini-game over the desktop.
 *
 * `onFinish` defaults to banking the round through the game object; the
 * Darknet Breach passes its own, because a phase-3 counter-attack is scored by
 * the same engine but paid out by `resolveBreach` instead.
 */
export function openMinigame(id, { game, onFinish = null, title = null } = {}) {
  closeMinigame();

  const config = MINIGAMES.games[id];
  if (!config) return null;

  const runner = RUNNERS[id];
  if (!runner) return null;

  const overlay = el('div', {
    class: 'minigame',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title ?? config.title,
  });

  const frame = el('div', { class: 'minigame__frame glass' });
  const head = el('div', { class: 'minigame__head' }, [
    el('strong', { text: title ?? config.title }),
    el('button', {
      type: 'button',
      class: 'minigame__close',
      'aria-label': 'Abandon round',
      text: '✕',
      onclick: () => finish({ score: 0, abandoned: true }),
    }),
  ]);

  const blurb = el('p', { class: 'minigame__blurb', text: config.blurb });
  const stage = el('div', { class: 'minigame__stage' });
  const bar = el('div', { class: 'meter__track minigame__timer' }, [
    el('div', { class: 'meter__fill', dataset: { role: 'timer' } }),
  ]);

  frame.append(head, blurb, stage, bar);
  overlay.append(frame);
  document.body.appendChild(overlay);

  let done = false;
  let stopGame = () => {};

  function finish(result) {
    if (done) return;
    done = true;
    stopGame();
    overlay.remove();
    openHost = null;

    if (result.abandoned) return;
    if (onFinish) onFinish(result);
    else game.finishMinigame(id, result);
  }

  stopGame = runner(stage, {
    config,
    timerFill: bar.querySelector('[data-role="timer"]'),
    finish,
  });

  openHost = { close: () => finish({ score: 0, abandoned: true }) };
  return openHost;
}

export function closeMinigame() {
  openHost?.close();
  openHost = null;
}

/**
 * A shared countdown. Every game but the sliding puzzle is on a clock, and one
 * implementation means one place for the bar and the deadline to agree.
 */
function countdown(seconds, fill, onEnd) {
  const startedAt = performance.now();
  let raf = 0;

  const step = (nowMs) => {
    const elapsed = (nowMs - startedAt) / 1000;
    const left = Math.max(0, seconds - elapsed);
    if (fill) setBar(fill, left / seconds, { warn: 2, critical: 2 });
    if (left <= 0) {
      onEnd();
      return;
    }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

/* -------------------------------------------------- 1. Bandwidth Tug-of-War */

/**
 * LemonWire. Two sliders, two drifting target bands, and a score that is simply
 * the fraction of the round spent with both inside their band.
 *
 * Sliders rather than a drag surface because a native `input[type=range]` is
 * already a 44px touch target with keyboard support and momentum on every
 * platform — reimplementing that badly is the classic way a mini-game becomes
 * unplayable on a phone.
 */
function bandwidthGame(stage, { config, timerFill, finish }) {
  stage.innerHTML = `
    <div class="mg-tug">
      <div class="mg-tug__lane" data-lane="up">
        <span class="mg-tug__label">Upload</span>
        <div class="mg-tug__track"><i class="mg-tug__band" data-role="band-up"></i></div>
        <input type="range" min="0" max="1000" value="500" data-role="slider-up" aria-label="Upload rate">
      </div>
      <div class="mg-tug__lane" data-lane="down">
        <span class="mg-tug__label">Download</span>
        <div class="mg-tug__track"><i class="mg-tug__band" data-role="band-down"></i></div>
        <input type="range" min="0" max="1000" value="500" data-role="slider-down" aria-label="Download rate">
      </div>
      <p class="mg-tug__score">In the green <b data-role="pct">0%</b></p>
    </div>
  `;

  const ref = (r) => stage.querySelector(`[data-role="${r}"]`);
  const lanes = ['up', 'down'].map((side) => ({
    slider: ref(`slider-${side}`),
    band: ref(`band-${side}`),
    target: 0.5,
    // Opposed drift directions, so the two hands never simply track together.
    dir: side === 'up' ? 1 : -1,
  }));

  let inBandSeconds = 0;
  let totalSeconds = 0;
  let last = performance.now();
  let raf = 0;

  const step = (nowMs) => {
    const dt = Math.min(0.05, (nowMs - last) / 1000);
    last = nowMs;
    totalSeconds += dt;

    let allInside = true;
    for (const lane of lanes) {
      lane.target += lane.dir * config.drift * dt;
      // Bounce rather than wrap: a band that teleports across the track is
      // unhittable and reads as a bug.
      if (lane.target <= 0.08 || lane.target >= 0.92) lane.dir *= -1;
      lane.target = Math.min(0.92, Math.max(0.08, lane.target));

      lane.band.style.setProperty('--pos', String(lane.target));
      lane.band.style.setProperty('--width', String(config.bandWidth));

      const value = Number(lane.slider.value) / 1000;
      const inside = Math.abs(value - lane.target) <= config.bandWidth / 2;
      lane.band.classList.toggle('is-hit', inside);
      if (!inside) allInside = false;
    }

    if (allInside) inBandSeconds += dt;
    ref('pct').textContent = `${Math.round((inBandSeconds / Math.max(0.001, totalSeconds)) * 100)}%`;
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);

  const stopClock = countdown(config.durationSeconds, timerFill, () => {
    const score = inBandSeconds / config.durationSeconds;
    finish({ score, perfect: score >= 0.95 });
  });

  return () => {
    cancelAnimationFrame(raf);
    stopClock();
  };
}

/* ---------------------------------------------------- 2. Firewall Defence */

/**
 * Shield99. Tap the threats before they reach the kernel — and the phase-3
 * breach's "fight back" option reuses this exact engine (GDD §C.3), which is
 * why the spawn rate and lifetime are parameters rather than constants.
 */
function firewallGame(stage, { config, timerFill, finish }) {
  stage.innerHTML = `
    <div class="mg-fire" data-role="field">
      <p class="mg-fire__score">Blocked <b data-role="hits">0</b> / <b data-role="seen">0</b></p>
    </div>
  `;
  const field = stage.querySelector('[data-role="field"]');
  const hitsEl = stage.querySelector('[data-role="hits"]');
  const seenEl = stage.querySelector('[data-role="seen"]');

  let hits = 0;
  let seen = 0;
  const timers = new Set();
  const target = config.targetsToCatch ?? null;

  function spawn() {
    seen += 1;
    seenEl.textContent = String(seen);

    const threat = el('button', {
      type: 'button',
      class: 'mg-fire__threat',
      'aria-label': 'Block threat',
      style: `--x:${0.08 + Math.random() * 0.84};--y:${0.18 + Math.random() * 0.7}`,
      onclick: () => {
        if (!threat.isConnected) return;
        hits += 1;
        hitsEl.textContent = String(hits);
        threat.remove();
        // A "fight back" round ends the moment the quota is met, so a player
        // who is winning is not made to wait out the clock.
        if (target && hits >= target) end();
      },
    });
    field.appendChild(threat);

    const kill = setTimeout(() => threat.remove(), config.targetLifetimeSeconds * 1000);
    timers.add(kill);
  }

  const spawner = setInterval(spawn, config.spawnEverySeconds * 1000);
  spawn();

  let ended = false;
  function end() {
    if (ended) return;
    ended = true;
    const score = target ? Math.min(1, hits / target) : hits / Math.max(1, seen);
    finish({ score, perfect: target ? hits >= target : hits === seen && seen > 0 });
  }

  const stopClock = countdown(config.durationSeconds, timerFill, end);

  return () => {
    clearInterval(spawner);
    for (const t of timers) clearTimeout(t);
    stopClock();
  };
}

/* ------------------------------------------------ 3. Fragmentation Puzzle */

/**
 * Registry Doctor. A 3×3 sliding puzzle — nine tiles, not sixteen, because a
 * 4×4 on a phone is a chore rather than a game.
 *
 * Shuffled by walking legal moves backwards from the solved state, so the board
 * is always solvable. Half of all random permutations of a sliding puzzle are
 * not, and handing the player an impossible board is the one failure a puzzle
 * cannot come back from.
 */
function fragmentGame(stage, { config, timerFill, finish }) {
  const n = config.size;
  const count = n * n;
  let tiles = Array.from({ length: count }, (_, i) => i); // `count - 1` is the gap
  const gapValue = count - 1;

  const neighbours = (index) => {
    const r = Math.floor(index / n);
    const c = index % n;
    const out = [];
    if (r > 0) out.push(index - n);
    if (r < n - 1) out.push(index + n);
    if (c > 0) out.push(index - 1);
    if (c < n - 1) out.push(index + 1);
    return out;
  };

  let gap = count - 1;
  for (let i = 0; i < config.shuffleMoves; i += 1) {
    const options = neighbours(gap);
    const pick = options[Math.floor(Math.random() * options.length)];
    [tiles[gap], tiles[pick]] = [tiles[pick], tiles[gap]];
    gap = pick;
  }

  stage.innerHTML = `<div class="mg-frag" data-role="board" style="--n:${n}"></div>
    <p class="mg-frag__score">Blocks in order <b data-role="ok">0</b>/${count - 1}</p>`;
  const board = stage.querySelector('[data-role="board"]');
  const okEl = stage.querySelector('[data-role="ok"]');

  let ended = false;

  function correctCount() {
    let ok = 0;
    for (let i = 0; i < count; i += 1) {
      if (tiles[i] === i && tiles[i] !== gapValue) ok += 1;
    }
    return ok;
  }

  function render() {
    clear(board);
    tiles.forEach((value, index) => {
      if (value === gapValue) {
        board.appendChild(el('span', { class: 'mg-frag__gap' }));
        return;
      }
      board.appendChild(
        el('button', {
          type: 'button',
          class: `mg-frag__tile${value === index ? ' is-home' : ''}`,
          text: String(value + 1),
          onclick: () => move(index),
        }),
      );
    });
    const ok = correctCount();
    okEl.textContent = String(ok);
    if (ok === count - 1) end();
  }

  function move(index) {
    if (!neighbours(gap).includes(index)) return;
    [tiles[gap], tiles[index]] = [tiles[index], tiles[gap]];
    gap = index;
    render();
  }

  function end() {
    if (ended) return;
    ended = true;
    const score = correctCount() / (count - 1);
    finish({ score, perfect: score >= 1 });
  }

  render();
  const stopClock = countdown(config.durationSeconds, timerFill, end);
  return stopClock;
}

/* ---------------------------------------------------------- 4. Latency Sync */

/**
 * VidChat. A rhythm game about a stuttering video call: tap on the beat.
 *
 * The hit window is generous (±220ms) on purpose. Precise rhythm on a
 * touchscreen fights both the hardware's input latency and the player's thumb,
 * and this is a bonus round in an idle game, not a music title.
 */
function latencyGame(stage, { config, timerFill, finish }) {
  stage.innerHTML = `
    <div class="mg-sync">
      <div class="mg-sync__screen" data-role="screen">
        <span class="mg-sync__pulse" data-role="pulse"></span>
      </div>
      <button type="button" class="mg-sync__tap" data-role="tap">Sync</button>
      <p class="mg-sync__score">On beat <b data-role="hits">0</b> / ${config.beats}</p>
    </div>
  `;

  const pulse = stage.querySelector('[data-role="pulse"]');
  const screen = stage.querySelector('[data-role="screen"]');
  const hitsEl = stage.querySelector('[data-role="hits"]');
  const tap = stage.querySelector('[data-role="tap"]');

  const beatMs = config.beatSeconds * 1000;
  const windowMs = config.windowSeconds * 1000;
  const startedAt = performance.now() + 900; // a bar of lead-in before beat one
  const claimed = new Set();
  let hits = 0;
  let raf = 0;

  const step = (nowMs) => {
    const beat = Math.round((nowMs - startedAt) / beatMs);
    const offset = Math.abs(nowMs - (startedAt + beat * beatMs));
    // The pulse is the *only* cue, so it has to read at a glance: it grows as
    // the beat approaches and snaps back after it.
    pulse.style.setProperty('--near', String(Math.max(0, 1 - offset / beatMs)));
    screen.classList.toggle('is-onbeat', offset < windowMs);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);

  function hit() {
    const nowMs = performance.now();
    const beat = Math.round((nowMs - startedAt) / beatMs);
    if (beat < 0 || beat >= config.beats || claimed.has(beat)) return;
    const offset = Math.abs(nowMs - (startedAt + beat * beatMs));
    if (offset > windowMs) return;

    claimed.add(beat);
    hits += 1;
    hitsEl.textContent = String(hits);
    screen.classList.add('is-hit');
    setTimeout(() => screen.classList.remove('is-hit'), 120);
  }

  tap.addEventListener('pointerdown', hit);
  const onKey = (e) => {
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      hit();
    }
  };
  window.addEventListener('keydown', onKey);

  const total = config.beats * config.beatSeconds + 1.4;
  const stopClock = countdown(total, timerFill, () => {
    const score = hits / config.beats;
    finish({ score, perfect: hits === config.beats });
  });

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    stopClock();
  };
}

/* ------------------------------------------------------------ 5. Perfect Burn */

/**
 * AeroBurn. The classic "stop it in the green band", three times.
 *
 * One button, one decision, no dexterity floor — the most phone-friendly shape
 * a timing game has, which is why it is the one attached to a late building
 * whose players may well be on a bus.
 */
function burnGame(stage, { config, timerFill, finish }) {
  stage.innerHTML = `
    <div class="mg-burn">
      <div class="mg-burn__disc" data-role="disc"></div>
      <div class="mg-burn__track">
        <i class="mg-burn__band" data-role="band"></i>
        <i class="mg-burn__head" data-role="head"></i>
      </div>
      <button type="button" class="mg-burn__stop" data-role="stop">Write</button>
      <p class="mg-burn__score">Pass <b data-role="pass">1</b> / ${config.passes}
        · landed <b data-role="landed">0</b></p>
    </div>
  `;

  const head = stage.querySelector('[data-role="head"]');
  const band = stage.querySelector('[data-role="band"]');
  const disc = stage.querySelector('[data-role="disc"]');
  const passEl = stage.querySelector('[data-role="pass"]');
  const landedEl = stage.querySelector('[data-role="landed"]');
  const stopBtn = stage.querySelector('[data-role="stop"]');

  let pass = 0;
  let landed = 0;
  let target = 0.5;
  let raf = 0;
  let ended = false;
  const startedAt = performance.now();

  function placeBand() {
    // Never right at an edge, where the sweep is slowest and the shot is free.
    target = 0.2 + Math.random() * 0.6;
    band.style.setProperty('--pos', String(target));
    band.style.setProperty('--width', String(config.bandWidth));
  }
  placeBand();

  const position = (nowMs) => {
    // A triangle wave: sweeps right, then back, at a constant speed. A sine
    // would slow at the ends and quietly make the edges the easy shot.
    const t = ((nowMs - startedAt) / 1000 / config.sweepSeconds) % 2;
    return t <= 1 ? t : 2 - t;
  };

  const step = (nowMs) => {
    head.style.setProperty('--pos', String(position(nowMs)));
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);

  function write() {
    if (ended) return;
    const hit = Math.abs(position(performance.now()) - target) <= config.bandWidth / 2;
    if (hit) {
      landed += 1;
      landedEl.textContent = String(landed);
      disc.classList.add('is-hit');
      setTimeout(() => disc.classList.remove('is-hit'), 160);
    }
    pass += 1;
    if (pass >= config.passes) {
      end();
      return;
    }
    passEl.textContent = String(pass + 1);
    placeBand();
  }

  function end() {
    if (ended) return;
    ended = true;
    finish({ score: landed / config.passes, perfect: landed === config.passes });
  }

  stopBtn.addEventListener('pointerdown', write);
  const onKey = (e) => {
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      write();
    }
  };
  window.addEventListener('keydown', onKey);

  // A generous outer clock, so an idle round cannot hang the overlay forever.
  const stopClock = countdown(config.passes * config.sweepSeconds * 6, timerFill, end);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    stopClock();
  };
}

const RUNNERS = {
  lemonwire: bandwidthGame,
  shield99: firewallGame,
  registrydoctor: fragmentGame,
  vidchat: latencyGame,
  aeroburn: burnGame,
};

/** The building each runner belongs to, for the launcher labels. */
export function minigameTitle(id) {
  return `${getBuilding(id).name} · ${MINIGAMES.games[id]?.title ?? ''}`;
}
