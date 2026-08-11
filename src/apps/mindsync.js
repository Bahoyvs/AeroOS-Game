import { formatNumber } from '../core/format.js';
import { motionIsReduced } from './../ui/motion.js';
import { createBuyControl, createCelebration, createLockedPanel, createMeter } from '../ui/building.js';
import { clear, el, throttle } from './../ui/dom.js';

/**
 * MindSync — building #11 (GDD v2 §4, §5, §9).
 *
 * Retro sci-fi, and the one place the GDD grants a WebGL exception. §5 is
 * specific about the shape of it: **WebGL on the desktop, an automatic CSS/SVG
 * fallback on mobile** — same design, cheaper implementation, so the exception
 * never costs a phone its frame rate.
 *
 * The fallback is not a degraded mode bolted on afterwards. It is chosen first
 * (`shouldUseGL`) and both paths draw the same thing: concentric waveforms
 * converging on a point, one node per frequency the player has tuned. If the
 * GL context fails to create — a blocked context, a lost one, an old driver —
 * the CSS path takes over silently, because a black rectangle is a worse
 * outcome than a simpler animation.
 *
 * The `w32-buy` costume is GDD §4's "Tune Frequency": clickable nodes on the
 * ring rather than a shop row.
 */

const WAVE_COLOURS = ['#7c3bd6', '#5ce1ff', '#b06cff', '#ff6ec7'];

/**
 * Should this run the GL path?
 *
 * Mobile never does — that is the §9 requirement, and it is decided on the
 * viewport rather than on a user-agent string, because the thing that actually
 * matters is how many pixels a small GPU is being asked to fill. Reduced motion
 * never does either: a shader loop that respects "reduce motion" by rendering a
 * still frame is a GPU context held open to draw nothing.
 */
function shouldUseGL(mobileQuery = '(max-width: 820px)') {
  if (motionIsReduced()) return false;
  if (globalThis.matchMedia?.(mobileQuery)?.matches) return false;
  return true;
}

/** Minimal GL: one full-quad shader, no libraries, no buffers to speak of. */
function createGLRenderer(canvas) {
  const gl =
    canvas.getContext('webgl', { antialias: false, depth: false, alpha: true }) ??
    canvas.getContext('experimental-webgl');
  if (!gl) return null;

  const vs = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
  const fs = `
    precision mediump float;
    uniform vec2 res; uniform float t; uniform float rings; uniform float intensity;
    void main() {
      vec2 uv = (gl_FragCoord.xy - 0.5 * res) / min(res.x, res.y);
      float d = length(uv);
      // Concentric waves travelling inward, one crest per tuned frequency.
      float w = sin(d * rings * 6.2831 - t * 1.6);
      float glow = smoothstep(0.62, 0.0, d);
      float band = smoothstep(0.35, 1.0, abs(w)) * glow;
      vec3 core = mix(vec3(0.09, 0.04, 0.18), vec3(0.69, 0.42, 1.0), glow * intensity);
      vec3 col = core + vec3(0.36, 0.88, 1.0) * band * intensity * 0.55;
      gl_FragColor = vec4(col, 1.0);
    }`;

  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
  };
  const v = compile(gl.VERTEX_SHADER, vs);
  const f = compile(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;

  const program = gl.createProgram();
  gl.attachShader(program, v);
  gl.attachShader(program, f);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(program, 'res');
  const uT = gl.getUniformLocation(program, 't');
  const uRings = gl.getUniformLocation(program, 'rings');
  const uIntensity = gl.getUniformLocation(program, 'intensity');

  return {
    draw(time, rings, intensity) {
      const w = canvas.clientWidth || 1;
      const h = canvas.clientHeight || 1;
      // Cap the backing store: this is a background, not a render target, and
      // a retina canvas here buys nothing a player can see.
      const dpr = Math.min(globalThis.devicePixelRatio ?? 1, 1.5);
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uT, time);
      gl.uniform1f(uRings, rings);
      gl.uniform1f(uIntensity, intensity);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    destroy() {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

export function mount(body, { game }) {
  body.classList.add('app-mindsync');
  body.innerHTML = `
    <div class="ms__bar">
      <span class="ms__wordmark">MINDSYNC</span>
      <span class="ms__mode" data-role="mode"></span>
    </div>

    <div class="ms__stage" data-role="stage">
      <canvas class="ms__canvas" data-role="canvas" aria-hidden="true"></canvas>
      <div class="ms__css" data-role="css" aria-hidden="true">
        <span class="ms__ring"></span><span class="ms__ring"></span>
        <span class="ms__ring"></span><span class="ms__ring"></span>
        <span class="ms__core"></span>
      </div>
      <div class="ms__nodes" data-role="nodes"></div>
    </div>

    <div class="ms__readout">
      <span data-role="status">No carrier frequency.</span>
      <span data-role="rate"></span>
    </div>

    <div data-role="meter"></div>
    <div data-role="buy"></div>
    <div data-role="locked"></div>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const canvas = ref('canvas');
  const nodesRoot = ref('nodes');

  /* ------------------------------------------------------- the shared kit */

  const meter = createMeter({ game, buildingId: 'mindsync' });
  ref('meter').replaceWith(meter.root);

  const buy = createBuyControl({
    game,
    buildingId: 'mindsync',
    labels: { one: 'Tune Frequency' },
    onBought: () => renderNodes(true),
  });
  buy.root.classList.add('ms__buy');
  ref('buy').replaceWith(buy.root);

  const locked = createLockedPanel({
    game,
    buildingId: 'mindsync',
    message: 'Searching for a carrier…',
  });
  ref('locked').replaceWith(locked.root);

  const celebration = createCelebration({
    game,
    buildingId: 'mindsync',
    host: body,
    render: ({ multiplier, minigameUnlocked }) => [
      el('strong', { class: 'w32celebrate__title', text: 'NEW WAVEFORM ACQUIRED' }),
      el('span', { class: 'w32celebrate__body', text: `Carrier locked. Amplitude ×${multiplier}.` }),
      ...(minigameUnlocked
        ? [el('em', { class: 'w32celebrate__extra', text: 'Frequency drift unlocked' })]
        : []),
    ],
  });

  /* --------------------------------------------------------------- render */

  let renderer = shouldUseGL() ? createGLRenderer(canvas) : null;
  const usingGL = renderer !== null;
  // One flag, both paths: the stylesheet shows the canvas or the CSS rings.
  body.classList.toggle('is-gl', usingGL);
  canvas.hidden = !usingGL;
  ref('css').hidden = usingGL;

  let raf = null;
  let rings = 3;
  let intensity = 0.35;

  if (usingGL) {
    const start = performance.now();
    const frame = () => {
      renderer.draw((performance.now() - start) / 1000, rings, intensity);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }

  /* ---------------------------------------------------------------- nodes */

  let nodeKey = null;

  function renderNodes(force = false) {
    const bd = game.econ.getProductionBreakdown(game.state, 'mindsync');
    const tier = bd.milestoneMultiplier;
    const count = bd.units === 0 ? 0 : Math.min(8, 2 + Math.floor(Math.log2(tier)));
    if (!force && count === nodeKey) return;
    nodeKey = count;

    clear(nodesRoot);
    for (let i = 0; i < count; i += 1) {
      const angle = (i / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2;
      nodesRoot.appendChild(
        el('span', {
          class: 'ms__node',
          style: `--nx:${(50 + Math.cos(angle) * 36).toFixed(2)}%;--ny:${(50 + Math.sin(angle) * 36).toFixed(2)}%;--nc:${WAVE_COLOURS[i % WAVE_COLOURS.length]}`,
        }),
      );
    }
  }

  /* --------------------------------------------------------------- update */

  const update = throttle(() => {
    const s = game.state;
    const { econ } = game;
    const unlocked = econ.isBuildingUnlocked(s, 'mindsync');

    locked.root.hidden = unlocked;
    buy.root.hidden = !unlocked;
    meter.root.hidden = !unlocked;
    ref('mode').textContent = usingGL ? 'GL' : 'SAFE';
    if (!unlocked) {
      locked.update();
      return;
    }

    const bd = econ.getProductionBreakdown(s, 'mindsync');
    const tier = bd.milestoneMultiplier;
    rings = 2 + Math.log2(Math.max(1, tier)) * 1.6;
    intensity = Math.min(1, 0.3 + Math.log2(Math.max(1, tier)) * 0.16);
    // The CSS path reads the same two numbers, so both renderers stay in step.
    body.style.setProperty('--ms-intensity', intensity.toFixed(3));
    body.style.setProperty('--ms-rings', String(Math.round(rings)));

    ref('status').textContent =
      bd.units === 0
        ? 'No carrier frequency.'
        : `${formatNumber(bd.units)} frequencies in phase`;
    ref('rate').textContent = bd.total > 0 ? `+${formatNumber(bd.total)} Buzz/s` : '';

    meter.update();
    buy.update();
    renderNodes();
  }, 150);

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);
  return () => {
    unsubscribe();
    if (raf !== null) cancelAnimationFrame(raf);
    // Release the GL context explicitly. Browsers cap how many a page may hold,
    // and a window the player opens and closes a dozen times must not spend
    // them — the fallback would then be permanent for the rest of the session.
    renderer?.destroy();
    renderer = null;
    celebration.destroy();
    body.classList.remove('app-mindsync', 'is-gl');
  };
}

export { shouldUseGL };
