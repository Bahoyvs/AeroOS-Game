import { PINBALL } from '../data/balance.js';
import { TABLE } from '../data/pinball.js';

/**
 * Galactic Pinball 3D (Day 7): the simulation half.
 *
 * Two unrelated things live here because they are both "pinball without a
 * screen":
 *
 * 1. **The table.** A ball, some walls, some bumpers and two flippers, stepped
 *    at a fixed substep. It is deliberately plain data + pure functions, so the
 *    renderer can be swapped (it is WebGL today) and so the physics can be
 *    tested in plain Node with no canvas — the same reason every other mechanic
 *    in core/ can be.
 * 2. **The tokens and the combo**, which are ordinary save state.
 *
 * The table is *not* part of `game.state`. A ball position is not progress: it
 * lasts twenty seconds, changes sixty times a second, and means nothing after
 * the ball drains. What gets written back is the one number the run produced.
 */

const RAD = Math.PI / 180;
const SUBSTEP = 1 / 240; // small enough that nothing tunnels at maxSpeed
const MAX_SUBSTEPS = 12; // a backgrounded tab resumes, it does not replay
const STUCK_SPEED = 5;
const STUCK_SECONDS = 2.5;
/** How much of a flipper's surface speed the ball takes with it. */
const FLIPPER_TRANSFER = 0.8;

/* ------------------------------------------------------------------ table */

/** A fresh table with no ball on it. Angles are converted to radians here. */
export function createTable() {
  return {
    phase: 'ready', // ready | live | drained
    hits: 0,
    plunger: 0, // 0..1, how far the launch spring is drawn back
    stuckFor: 0,
    ball: null,
    flippers: TABLE.flippers.map((f) => ({
      side: f.side,
      x: f.x,
      y: f.y,
      length: f.length,
      thickness: f.thickness,
      rest: f.rest * RAD,
      active: f.active * RAD,
      angle: f.rest * RAD,
      omega: 0,
      held: false,
    })),
  };
}

/** Draw the plunger back. Held down, it tops out rather than looping. */
export function chargePlunger(table, dt) {
  if (table.phase !== 'ready') return table.plunger;
  table.plunger = Math.min(1, table.plunger + dt / TABLE.launch.chargeSeconds);
  return table.plunger;
}

/** Let go. The ball leaves the lane at a speed the player chose. */
export function launchBall(table) {
  if (table.phase !== 'ready') return null;
  const { launch } = TABLE;
  const power = launch.minPower + (launch.maxPower - launch.minPower) * table.plunger;
  table.ball = { x: launch.x, y: launch.y, vx: 0, vy: -power };
  table.phase = 'live';
  table.plunger = 0;
  table.stuckFor = 0;
  return table.ball;
}

export function setFlipper(table, side, held) {
  const flipper = table.flippers.find((f) => f.side === side);
  if (flipper) flipper.held = held;
}

/**
 * Advance the table. Returns what the caller has to react to — how many
 * scoring bumpers were hit this frame, and whether the ball just drained.
 *
 * `dt` is real seconds; the integration is a fixed substep regardless, so the
 * physics behaves identically at 30, 60 and 144 fps.
 */
export function stepTable(table, dt) {
  let bumperHits = 0;
  let drained = false;
  // Which bumpers were touched, so the renderer can flash exactly those. Posts
  // are in here too: they are worth no combo but they still light up.
  const struck = [];

  const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.round(dt / SUBSTEP)));
  const h = Math.min(dt, MAX_SUBSTEPS * SUBSTEP) / steps;

  for (let i = 0; i < steps; i += 1) {
    stepFlippers(table, h);
    if (table.phase !== 'live' || !table.ball) continue;

    const ball = table.ball;
    ball.vy += TABLE.gravity * h;
    ball.x += ball.vx * h;
    ball.y += ball.vy * h;

    for (const wall of TABLE.walls) collideSegment(ball, wall);
    for (let b = 0; b < TABLE.bumpers.length; b += 1) {
      const bumper = TABLE.bumpers[b];
      if (!collideBumper(ball, bumper)) continue;
      bumperHits += bumper.points;
      if (!struck.includes(b)) struck.push(b);
    }
    for (const flipper of table.flippers) collideFlipper(ball, flipper);

    clampSpeed(ball);
    unstick(table, ball, h);

    if (ball.y > TABLE.drainY) {
      table.phase = 'drained';
      drained = true;
    }
  }

  table.hits += bumperHits;
  return { bumperHits, drained, struck };
}

function stepFlippers(table, dt) {
  for (const flipper of table.flippers) {
    const target = flipper.held ? flipper.active : flipper.rest;
    const delta = target - flipper.angle;
    const step = TABLE.flipperSpeed * dt;
    if (Math.abs(delta) <= step) {
      flipper.omega = delta / dt;
      flipper.angle = target;
    } else {
      const direction = Math.sign(delta);
      flipper.omega = direction * TABLE.flipperSpeed;
      flipper.angle += direction * step;
    }
  }
}

/* -------------------------------------------------------------- collisions */

/**
 * Bounce off a surface whose normal is (nx, ny), unit length.
 *
 * The `vn > 0` guard is what keeps a ball resting on a wall from being kicked
 * every frame: a contact that is already separating is not a collision, it is
 * the frame after one.
 */
function reflect(ball, nx, ny, restitution, kick = 0) {
  const vn = ball.vx * nx + ball.vy * ny;
  if (vn > 0) return false;
  ball.vx -= (1 + restitution) * vn * nx;
  ball.vy -= (1 + restitution) * vn * ny;
  if (kick > 0) {
    ball.vx += nx * kick;
    ball.vy += ny * kick;
  }
  return true;
}

/**
 * Closest point on a segment to the ball, and the collision that follows.
 *
 * Returns the contact — normal and point — rather than a bare boolean, because
 * the flipper needs both to hand the ball its own speed, and returns it even
 * when `reflect` declines: a surface sweeping *into* a ball that is already
 * moving away is exactly the scoop shot, and dropping it there is what makes a
 * flipper feel like a wall.
 */
function collideSegment(ball, segment, radius = TABLE.ballRadius, restitution) {
  const [ax, ay] = segment.a;
  const [bx, by] = segment.b;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : clamp01(((ball.x - ax) * dx + (ball.y - ay) * dy) / lengthSq);
  const px = ax + dx * t;
  const py = ay + dy * t;

  let nx = ball.x - px;
  let ny = ball.y - py;
  const distance = Math.hypot(nx, ny);
  if (distance > radius) return null;

  if (distance === 0) {
    // Dead centre on the line: push along its normal rather than dividing by 0.
    const length = Math.sqrt(lengthSq) || 1;
    nx = -dy / length;
    ny = dx / length;
  } else {
    nx /= distance;
    ny /= distance;
  }

  // Positional correction first: a ball left overlapping re-collides forever.
  ball.x = px + nx * radius;
  ball.y = py + ny * radius;
  const bounced = reflect(ball, nx, ny, restitution ?? segment.bounce ?? TABLE.wallRestitution);
  return { nx, ny, px, py, bounced };
}

function collideBumper(ball, bumper) {
  const nx = ball.x - bumper.x;
  const ny = ball.y - bumper.y;
  const distance = Math.hypot(nx, ny);
  const contact = bumper.r + TABLE.ballRadius;
  if (distance > contact) return false;

  const ux = distance === 0 ? 0 : nx / distance;
  const uy = distance === 0 ? -1 : ny / distance;
  ball.x = bumper.x + ux * contact;
  ball.y = bumper.y + uy * contact;
  return reflect(ball, ux, uy, 0.72, bumper.kick);
}

/**
 * The flipper is a fat segment that happens to be rotating, so the contact test
 * is the wall test — but a *moving* surface has to hand the ball its own speed
 * as well, or a flipper swung at a ball merely stops it. That transfer is the
 * difference between a pinball table and a pinball-shaped screensaver.
 *
 * The transfer is projected onto the **contact normal**, which for a flipper is
 * perpendicular to its axis — the same direction the surface is sweeping. (The
 * radial direction from the pivot is the one direction the surface velocity has
 * no component along at all: ω × r is perpendicular to r by construction.)
 */
function collideFlipper(ball, flipper) {
  const tipX = flipper.x + Math.cos(flipper.angle) * flipper.length;
  const tipY = flipper.y + Math.sin(flipper.angle) * flipper.length;
  const segment = { a: [flipper.x, flipper.y], b: [tipX, tipY] };
  const radius = TABLE.ballRadius + flipper.thickness;

  const contact = collideSegment(ball, segment, radius, 0.35);
  if (!contact) return false;
  if (flipper.omega === 0) return true;

  // Velocity of the surface at the contact point: ω × r, in 2D. Further out
  // along the flipper is faster, which is why a tip shot is the strong one.
  const rx = contact.px - flipper.x;
  const ry = contact.py - flipper.y;
  const surfaceX = -flipper.omega * ry;
  const surfaceY = flipper.omega * rx;

  const along = surfaceX * contact.nx + surfaceY * contact.ny;
  if (along > 0) {
    ball.vx += contact.nx * along * FLIPPER_TRANSFER;
    ball.vy += contact.ny * along * FLIPPER_TRANSFER;
  }
  return true;
}

function clampSpeed(ball) {
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed > TABLE.maxSpeed) {
    ball.vx = (ball.vx / speed) * TABLE.maxSpeed;
    ball.vy = (ball.vy / speed) * TABLE.maxSpeed;
  }
}

/**
 * Real tables have a nudge for this, and so does this one — automatically. A
 * ball can come to rest in a corner where gravity and a wall cancel out, and a
 * player watching a motionless ball has lost a token to a bug, not to a game.
 */
function unstick(table, ball, dt) {
  if (Math.hypot(ball.vx, ball.vy) > STUCK_SPEED) {
    table.stuckFor = 0;
    return;
  }
  table.stuckFor += dt;
  if (table.stuckFor < STUCK_SECONDS) return;
  table.stuckFor = 0;
  ball.vx += ball.x < TABLE.width / 2 ? 18 : -18;
  ball.vy -= 10;
}

const clamp01 = (value) => Math.max(0, Math.min(1, value));

/* --------------------------------------------------------- tokens & combo */

/**
 * Tokens accrue on the **wall clock**, not on simulation time: a refill the
 * player was not there to see is exactly what this should pay out, the same
 * argument as offline earnings and the rewarded-ad cooldown (see
 * docs/ARCHITECTURE.md, "Two clocks"). Returns how many tokens were granted.
 */
export function updateTokens(state, now = Date.now()) {
  const pinball = state.pinball;
  if (pinball.tokens >= PINBALL.maxTokens) {
    pinball.nextTokenAt = 0;
    return 0;
  }
  if (pinball.nextTokenAt === 0) {
    pinball.nextTokenAt = now + PINBALL.refillSeconds * 1000;
    return 0;
  }

  let granted = 0;
  while (pinball.nextTokenAt <= now && pinball.tokens < PINBALL.maxTokens) {
    const before = pinball.tokens;
    pinball.tokens = Math.min(PINBALL.maxTokens, pinball.tokens + PINBALL.tokensPerRefill);
    granted += pinball.tokens - before;
    pinball.nextTokenAt += PINBALL.refillSeconds * 1000;
  }
  if (pinball.tokens >= PINBALL.maxTokens) pinball.nextTokenAt = 0;
  return granted;
}

/** Seconds until the next refill, or null when the player is already full. */
export function secondsToNextToken(state, now = Date.now()) {
  if (state.pinball.tokens >= PINBALL.maxTokens || state.pinball.nextTokenAt === 0) return null;
  return Math.max(0, (state.pinball.nextTokenAt - now) / 1000);
}

export function canLaunch(state) {
  if (!state.apps.pinball?.open) return { ok: false, reason: 'not-open' };
  if (state.pinball.tokens <= 0) return { ok: false, reason: 'no-tokens' };
  return { ok: true };
}

/** Spend a token. The refill clock starts the moment the player drops below full. */
export function spendToken(state, now = Date.now()) {
  state.pinball.tokens -= 1;
  if (state.pinball.nextTokenAt === 0) {
    state.pinball.nextTokenAt = now + PINBALL.refillSeconds * 1000;
  }
  return state.pinball.tokens;
}

export function addToken(state, count = 1) {
  state.pinball.tokens = Math.min(PINBALL.maxTokens, state.pinball.tokens + count);
  if (state.pinball.tokens >= PINBALL.maxTokens) state.pinball.nextTokenAt = 0;
  return state.pinball.tokens;
}

/**
 * What a run of `hits` bumpers is worth. Pure and separate from applying it,
 * for the same reason Shield99's loot is: the UI wants to show the number
 * before the player has earned it, and the tests want to assert on it.
 */
export function comboFor(hits) {
  const magnitude = Math.min(PINBALL.maxCombo, hits * PINBALL.comboPerBumper);
  const durationSeconds = Math.min(
    PINBALL.maxComboSeconds,
    PINBALL.comboSecondsBase + hits * PINBALL.comboSecondsPerBumper,
  );
  return { hits, magnitude, durationSeconds };
}
