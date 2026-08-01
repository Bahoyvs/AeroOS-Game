import { TICK_MS } from '../data/balance.js';

/**
 * Fixed-timestep simulation with a decoupled render pass.
 *
 * The simulation always advances in TICK_MS steps, so production maths is
 * frame-rate independent and identical on a 60Hz laptop and a 120Hz phone.
 * Rendering happens once per animation frame with whatever state exists.
 */
export function createGameLoop({ onTick, onRender, maxCatchUpMs = 2000 }) {
  let running = false;
  let rafId = null;
  let last = 0;
  let accumulator = 0;

  function frame(now) {
    if (!running) return;

    let delta = now - last;
    last = now;

    // A backgrounded tab can hand us a huge delta. Offline earnings handle
    // long absences; here we just refuse to spiral.
    if (delta > maxCatchUpMs) delta = maxCatchUpMs;
    accumulator += delta;

    while (accumulator >= TICK_MS) {
      onTick(TICK_MS / 1000);
      accumulator -= TICK_MS;
    }

    onRender();
    rafId = requestAnimationFrame(frame);
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      accumulator = 0;
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
    },
    get running() {
      return running;
    },
  };
}
