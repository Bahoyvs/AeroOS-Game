import { PINBALL } from '../data/balance.js';
import { TABLE } from '../data/pinball.js';
import {
  chargePlunger,
  createTable,
  launchBall,
  setFlipper,
  stepTable,
} from '../core/pinball.js';
import { formatDuration, formatNumber } from '../core/format.js';
import { el, throttle } from './../ui/dom.js';

/**
 * Galactic Pinball 3D (Day 7) — the presentation half.
 *
 * The physics is in src/core/pinball.js and knows nothing about this file. What
 * happens here is rendering and input, and both are shaped by one decision:
 * **the table is drawn with WebGL, not with DOM nodes.** A ball is a transform
 * change sixty times a second and five bumpers flash on top of it; as elements
 * that is a style recalculation and a paint per frame on the one screen in the
 * game that cannot afford either — and the roadmap's DoD for this app is 60 fps
 * on a mid-range phone with the desktop full of windows.
 *
 * PixiJS is loaded with a dynamic `import()`, so a renderer nobody has opened
 * yet is a separate chunk that never reaches the player. The rest of the OS
 * boots without it.
 *
 * Everything on screen is drawn in **table units** (see src/data/pinball.js) by
 * scaling one container, so the same table fits a 380px window and a phone.
 */

const COLOR = {
  space: 0x050b1c,
  rail: 0x7fe4ff,
  lane: 0x35507a,
  bumper: 0x1b7fd4,
  bumperHot: 0xd6ff8f,
  bumperRim: 0xa9f7ff,
  post: 0x46617a,
  flipper: 0xffd166,
  ball: 0xf2fbff,
  plunger: 0x6fd44a,
};

const FLASH_SECONDS = 0.18;

export function mount(body, { game, audio }) {
  body.classList.add('app-pinball');
  body.innerHTML = `
    <div class="pin__hud">
      <div class="pin__tokens">
        <span class="pin__token-pips" data-role="pips" aria-hidden="true"></span>
        <span class="pin__token-text" data-role="token-text"></span>
      </div>
      <button type="button" class="pin__buy" data-role="buy"></button>
    </div>

    <div class="pin__stage" data-role="stage" tabindex="0" aria-label="Pinball table">
      <p class="pin__fallback" data-role="fallback" hidden></p>
    </div>

    <div class="pin__readout">
      <span class="pin__hits"><strong data-role="hits">0</strong> bumpers</span>
      <span class="pin__combo" data-role="combo"></span>
    </div>

    <button type="button" class="pin__launch" data-role="launch">
      <span data-role="launch-label">Launch ball</span>
      <span class="pin__plunger"><span class="pin__plunger-fill" data-role="plunger"></span></span>
    </button>

    <p class="pin__hint">Hold to charge the plunger. Tap either side of the table — or ← → — for the flippers.</p>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const stage = ref('stage');
  const table = createTable();

  let disposed = false;
  let pixi = null;

  /* ----------------------------------------------------------------- input */

  /**
   * Which flipper a pointer means is decided by which half of the table it
   * lands on, so both can be held at once on a touch screen. Tracking by
   * pointerId is what makes that work — two thumbs are two pointers.
   */
  const pointers = new Map();

  function flipperFor(event) {
    const rect = stage.getBoundingClientRect();
    return event.clientX - rect.left < rect.width / 2 ? 'left' : 'right';
  }

  function onPointerDown(event) {
    stage.focus({ preventScroll: true });
    const side = flipperFor(event);
    pointers.set(event.pointerId, side);
    setFlipper(table, side, true);
    stage.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function onPointerUp(event) {
    const side = pointers.get(event.pointerId);
    if (!side) return;
    pointers.delete(event.pointerId);
    // Only release the flipper if no *other* finger is still holding it.
    if (![...pointers.values()].includes(side)) setFlipper(table, side, false);
  }

  const KEYS = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    a: 'left',
    d: 'right',
    z: 'left',
    m: 'right',
  };

  function onKeyDown(event) {
    const side = KEYS[event.key];
    if (side) {
      setFlipper(table, side, true);
      event.preventDefault();
      return;
    }
    if (event.key === ' ' || event.key === 'Enter') {
      charging = true;
      event.preventDefault();
    }
  }

  function onKeyUp(event) {
    const side = KEYS[event.key];
    if (side) setFlipper(table, side, false);
    if ((event.key === ' ' || event.key === 'Enter') && charging) release();
  }

  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointerup', onPointerUp);
  stage.addEventListener('pointercancel', onPointerUp);
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  stage.addEventListener('keydown', onKeyDown);
  stage.addEventListener('keyup', onKeyUp);

  /* ------------------------------------------------------------- the plunger */

  let charging = false;

  const launchButton = ref('launch');
  launchButton.addEventListener('pointerdown', (event) => {
    if (table.phase !== 'ready') return;
    charging = true;
    launchButton.setPointerCapture?.(event.pointerId);
  });
  launchButton.addEventListener('pointerup', () => release());
  launchButton.addEventListener('pointercancel', () => {
    charging = false;
    table.plunger = 0;
  });

  /**
   * Let the ball go. The token is only spent here, at the moment a ball
   * actually reaches the table — charging the plunger with an empty account
   * must not quietly cost anything.
   */
  function release() {
    if (!charging) return;
    charging = false;
    if (table.phase !== 'ready') return;

    const result = game.launchPinball();
    if (!result.ok) {
      table.plunger = 0;
      const messages = {
        'no-tokens': ['Out of tokens', 'They refill on the hour, or buy one with Buzz.'],
        'not-open': ['The table is closed', 'Open Galactic Pinball 3D first.'],
      };
      const [title, text] = messages[result.reason] ?? ['Cannot launch', ''];
      game.notify(title, text, 'warn');
      update();
      return;
    }

    table.hits = 0;
    launchBall(table);
    audio?.play('click');
    update();
  }

  /* ---------------------------------------------------------------- renderer */

  (async () => {
    let mod;
    try {
      mod = await import('pixi.js');
    } catch (err) {
      console.error('[pinball] renderer failed to load', err);
      showFallback('The 3D accelerator did not answer. Close and reopen the table.');
      return;
    }
    if (disposed) return;

    const { Application, Container, Graphics } = mod;
    const app = new Application();
    try {
      await app.init({
        resizeTo: stage,
        background: COLOR.space,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(2, globalThis.devicePixelRatio || 1),
      });
    } catch (err) {
      console.error('[pinball] renderer failed to start', err);
      showFallback('This machine has no 3D acceleration for the table.');
      return;
    }
    // The window may have been closed while the GPU was waking up.
    if (disposed) {
      app.destroy(true, { children: true });
      return;
    }

    pixi = app;
    stage.appendChild(app.canvas);
    app.canvas.classList.add('pin__canvas');

    const world = new Container();
    app.stage.addChild(world);

    // Static geometry is drawn once. Only the ball, the flippers and the
    // bumper flashes are touched per frame.
    const cabinet = new Graphics();
    drawCabinet(cabinet);
    world.addChild(cabinet);

    const bumperLayer = new Graphics();
    const flipperLayer = new Graphics();
    const ballLayer = new Graphics();
    world.addChild(bumperLayer, flipperLayer, ballLayer);

    const flashes = TABLE.bumpers.map(() => 0);

    function fit() {
      const { width, height } = app.screen;
      const scale = Math.min(width / TABLE.width, height / TABLE.height);
      world.scale.set(scale);
      world.x = (width - TABLE.width * scale) / 2;
      world.y = (height - TABLE.height * scale) / 2;
    }
    fit();
    app.renderer.on('resize', fit);

    app.ticker.add((ticker) => {
      // Seconds, clamped: a tab that was hidden resumes, it does not replay.
      const dt = Math.min(ticker.deltaMS, 100) / 1000;

      if (charging) chargePlunger(table, dt);
      const result = stepTable(table, dt);

      for (let i = 0; i < flashes.length; i += 1) {
        if (flashes[i] > 0) flashes[i] = Math.max(0, flashes[i] - dt);
      }
      for (const index of result.struck) flashes[index] = FLASH_SECONDS;
      if (result.bumperHits > 0) bump();
      if (result.drained) drain();

      drawBumpers(bumperLayer, flashes);
      drawFlippers(flipperLayer);
      drawBall(ballLayer);
      update();
    });

    update();
  })();

  function showFallback(message) {
    const node = ref('fallback');
    node.hidden = false;
    node.textContent = message;
    launchButton.disabled = true;
  }

  /* ------------------------------------------------------------- drawing */

  function drawCabinet(g) {
    g.clear();

    // The playfield, and the lane the ball is launched up.
    g.rect(4, 10, 82, 144).fill({ color: 0x0b1836, alpha: 0.9 });
    g.rect(86, 30, 10, 124).fill({ color: COLOR.lane, alpha: 0.22 });

    // A handful of stars. Fixed positions, not random: the table should look
    // the same every time it is opened, like a real cabinet's backglass.
    for (let i = 0; i < 26; i += 1) {
      const x = 6 + ((i * 37) % 78);
      const y = 14 + ((i * 53) % 132);
      g.circle(x, y, i % 5 === 0 ? 0.7 : 0.4).fill({ color: 0xffffff, alpha: 0.35 });
    }

    for (const wall of TABLE.walls) {
      g.moveTo(wall.a[0], wall.a[1]).lineTo(wall.b[0], wall.b[1]);
    }
    g.stroke({ width: 1.4, color: COLOR.rail, alpha: 0.85, cap: 'round' });

    // The drain, so it is obvious where a ball is lost.
    g.moveTo(24, 150).lineTo(76, 150);
    g.stroke({ width: 1, color: 0xd24b3f, alpha: 0.5 });
  }

  function drawBumpers(g, flashes) {
    g.clear();
    for (let i = 0; i < TABLE.bumpers.length; i += 1) {
      const bumper = TABLE.bumpers[i];
      const heat = flashes[i] / FLASH_SECONDS;
      const scoring = bumper.points > 0;
      const radius = bumper.r * (1 + heat * 0.12);

      g.circle(bumper.x, bumper.y, radius).fill({
        color: heat > 0 ? COLOR.bumperHot : scoring ? COLOR.bumper : COLOR.post,
        alpha: scoring ? 1 : 0.8,
      });
      if (scoring) {
        g.circle(bumper.x, bumper.y, radius).stroke({
          width: 1.2,
          color: COLOR.bumperRim,
          alpha: 0.5 + heat * 0.5,
        });
        // The wet highlight every Aero surface in this OS has.
        g.circle(bumper.x - radius * 0.3, bumper.y - radius * 0.35, radius * 0.3).fill({
          color: 0xffffff,
          alpha: 0.35,
        });
      }
    }
  }

  function drawFlippers(g) {
    g.clear();
    for (const flipper of table.flippers) {
      const tipX = flipper.x + Math.cos(flipper.angle) * flipper.length;
      const tipY = flipper.y + Math.sin(flipper.angle) * flipper.length;
      g.moveTo(flipper.x, flipper.y).lineTo(tipX, tipY);
      g.stroke({
        width: flipper.thickness * 2,
        color: flipper.held ? 0xfff3c4 : COLOR.flipper,
        cap: 'round',
      });
      g.circle(flipper.x, flipper.y, 1.6).fill({ color: 0x8a5b12 });
    }
  }

  function drawBall(g) {
    g.clear();
    if (table.phase === 'ready') {
      // The plunger, drawn as the spring it is compressing.
      const height = 12 * table.plunger;
      g.rect(88.5, 142 - height, 5, height + 2).fill({ color: COLOR.plunger, alpha: 0.8 });
      g.circle(TABLE.launch.x, TABLE.launch.y, TABLE.ballRadius).fill({ color: COLOR.ball });
      return;
    }
    if (!table.ball) return;
    g.circle(table.ball.x, table.ball.y, TABLE.ballRadius).fill({ color: COLOR.ball });
    g.circle(table.ball.x - 0.7, table.ball.y - 0.8, TABLE.ballRadius * 0.4).fill({
      color: 0xffffff,
      alpha: 0.9,
    });
  }

  /* --------------------------------------------------------------- events */

  // One click per bumper is a machine gun at ten hits a second; the throttle
  // keeps the table loud without turning it into noise.
  const bump = throttle(() => audio?.play('bumper'), 60);

  function drain() {
    const result = game.endPinballRun(table.hits);
    audio?.play(result.combo.magnitude > 0 ? 'coin' : 'error');
    table.phase = 'ready';
    table.ball = null;
    update();
  }

  /* --------------------------------------------------------------- update */

  const pips = ref('pips');
  const update = throttle(() => {
    const s = game.state;
    const now = Date.now();
    const combo = game.econ.pinballCombo(s, now);

    pips.textContent = '●'.repeat(s.pinball.tokens) + '○'.repeat(PINBALL.maxTokens - s.pinball.tokens);
    const seconds = game.pinballTokenSeconds(now);
    ref('token-text').textContent =
      seconds === null
        ? `${s.pinball.tokens} tokens · full`
        : `${s.pinball.tokens} left · +${PINBALL.tokensPerRefill} in ${formatDuration(Math.ceil(seconds))}`;

    const buy = ref('buy');
    const check = game.econ.canBuyPinballToken(s, now);
    buy.disabled = !check.ok;
    buy.textContent =
      s.pinball.tokens >= PINBALL.maxTokens
        ? 'Tokens full'
        : `Buy token · ${formatNumber(game.econ.pinballTokenCost(s, now))}`;

    ref('hits').textContent = String(table.hits);
    ref('combo').textContent = combo.active
      ? `NUDGE ×${combo.multiplier.toFixed(1)} · ${Math.ceil(combo.secondsLeft)}s`
      : table.phase === 'live'
        ? `worth ×${(1 + Math.min(PINBALL.maxCombo, table.hits * PINBALL.comboPerBumper)).toFixed(1)}`
        : `best ${s.pinball.bestHits}`;

    const ready = table.phase === 'ready';
    launchButton.disabled = !ready || s.pinball.tokens <= 0;
    ref('launch-label').textContent = ready
      ? s.pinball.tokens > 0
        ? 'Hold to launch'
        : 'No tokens left'
      : 'Ball in play';
    ref('plunger').style.setProperty('--fill', String(table.plunger));
  }, 100);

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);

  return () => {
    disposed = true;
    unsubscribe();
    stage.removeEventListener('pointerdown', onPointerDown);
    stage.removeEventListener('pointerup', onPointerUp);
    stage.removeEventListener('pointercancel', onPointerUp);
    stage.removeEventListener('keydown', onKeyDown);
    stage.removeEventListener('keyup', onKeyUp);
    // Destroying the Application takes the ticker, the canvas and every GPU
    // texture with it. Left behind, a closed window keeps rendering forever.
    pixi?.destroy(true, { children: true, texture: true });
    pixi = null;
    body.classList.remove('app-pinball');
  };
}
