import { SWEEPER } from '../data/balance.js';

/**
 * AeroSweeper (Day 7): the simulation half.
 *
 * Two unrelated things live here because they are both "minesweeper without a
 * screen":
 *
 * 1. **The board.** A grid, a mine layout, and the flood fill that opens an
 *    area. Plain data and pure functions, so the whole game is testable in
 *    plain Node — no DOM, which is the same rule every other mechanic follows.
 * 2. **The tokens and the combo**, which are ordinary save state.
 *
 * The board is *not* part of `game.state`. A round lasts a minute or two and
 * means nothing once it is banked; what gets written back is the multiplier it
 * earned. Closing the window cashes out rather than persisting a half-swept
 * grid — see src/apps/aerosweeper.js.
 */

const NEIGHBOURS = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

/* ------------------------------------------------------------------ board */

/**
 * A covered board with **no mines on it yet**.
 *
 * `rng` is carried on the round because the layout is not decided until the
 * first click (see `revealTile`), and randomness in this codebase is injected
 * rather than reached for — `createGame({ rng })` owns it, hands it to the
 * round, and the mechanic never touches `Math.random` itself.
 */
export function createRound(config = SWEEPER, rng = Math.random) {
  const { rows, cols, mines } = config;
  return {
    rows,
    cols,
    mines,
    rng,
    phase: 'ready', // ready | live | lost | won
    seeded: false,
    revealedCount: 0,
    flags: 0,
    cells: Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ({
        mine: false,
        revealed: false,
        flagged: false,
        adjacent: 0,
      })),
    ),
  };
}

const inside = (round, row, col) =>
  row >= 0 && row < round.rows && col >= 0 && col < round.cols;

export const cellAt = (round, row, col) =>
  inside(round, row, col) ? round.cells[row][col] : null;

/** Squares that are not mines — what a full sweep has to open. */
export const safeCells = (round) => round.rows * round.cols - round.mines;

/** The counter every minesweeper has: mines, minus what the player has flagged. */
export const minesLeft = (round) => round.mines - round.flags;

/**
 * Lay the mines, avoiding the first click **and its neighbours**.
 *
 * Keeping the clicked square clear is the classic rule; keeping its neighbours
 * clear too is the modern one, and it is the better rule here. A first click
 * that lands on a "3" opens exactly one square and the round is a coin toss
 * from the start — this way the opening move always unfolds an area, and the
 * player always has something to reason about before they risk anything.
 */
function seedMines(round, safeRow, safeCol) {
  const forbidden = new Set([`${safeRow},${safeCol}`]);
  for (const [dr, dc] of NEIGHBOURS) forbidden.add(`${safeRow + dr},${safeCol + dc}`);

  const candidates = [];
  for (let row = 0; row < round.rows; row += 1) {
    for (let col = 0; col < round.cols; col += 1) {
      if (!forbidden.has(`${row},${col}`)) candidates.push([row, col]);
    }
  }

  // Partial Fisher-Yates: take the first `mines` of a shuffle, which is
  // uniform and needs no rejection loop (and so cannot hang on a dense board).
  const count = Math.min(round.mines, candidates.length);
  for (let i = 0; i < count; i += 1) {
    const j = i + Math.floor(round.rng() * (candidates.length - i));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    const [row, col] = candidates[i];
    round.cells[row][col].mine = true;
  }
  round.mines = count;

  for (let row = 0; row < round.rows; row += 1) {
    for (let col = 0; col < round.cols; col += 1) {
      if (round.cells[row][col].mine) continue;
      round.cells[row][col].adjacent = NEIGHBOURS.filter(
        ([dr, dc]) => cellAt(round, row + dr, col + dc)?.mine,
      ).length;
    }
  }
  round.seeded = true;
}

/**
 * Open a square. Returns every cell that came up, whether it was a mine, and
 * whether that finished the board.
 *
 * The flood fill is an explicit stack rather than recursion: identical
 * algorithm, no depth ceiling, and the board size is a balance constant that
 * somebody will eventually raise. It cannot uncover a mine, because it only
 * spreads from a square with zero adjacent mines.
 */
export function revealTile(round, row, col) {
  const nothing = { revealed: [], hitMine: false, cleared: false };
  if (round.phase === 'lost' || round.phase === 'won') return nothing;

  const cell = cellAt(round, row, col);
  if (!cell || cell.revealed || cell.flagged) return nothing;

  if (!round.seeded) seedMines(round, row, col);
  round.phase = 'live';

  if (cell.mine) {
    cell.revealed = true;
    round.phase = 'lost';
    return { revealed: [{ row, col }], hitMine: true, cleared: false };
  }

  const revealed = [];
  const stack = [[row, col]];
  while (stack.length > 0) {
    const [r, c] = stack.pop();
    const current = cellAt(round, r, c);
    if (!current || current.revealed || current.flagged || current.mine) continue;

    current.revealed = true;
    round.revealedCount += 1;
    revealed.push({ row: r, col: c });

    if (current.adjacent !== 0) continue;
    for (const [dr, dc] of NEIGHBOURS) stack.push([r + dr, c + dc]);
  }

  const cleared = round.revealedCount >= safeCells(round);
  if (cleared) round.phase = 'won';
  return { revealed, hitMine: false, cleared };
}

/** Plant or lift a flag. Flags cost nothing and are pure bookkeeping. */
export function toggleFlag(round, row, col) {
  const cell = cellAt(round, row, col);
  if (!cell || cell.revealed || round.phase === 'lost' || round.phase === 'won') return false;
  cell.flagged = !cell.flagged;
  round.flags += cell.flagged ? 1 : -1;
  return cell.flagged;
}

/** Where every mine was, so a lost board can show the player what got them. */
export function mineLocations(round) {
  const mines = [];
  for (let row = 0; row < round.rows; row += 1) {
    for (let col = 0; col < round.cols; col += 1) {
      if (round.cells[row][col].mine) mines.push({ row, col });
    }
  }
  return mines;
}

/* --------------------------------------------------------- tokens & combo */

/**
 * Tokens accrue on the **wall clock**, not on simulation time: a refill the
 * player was not there to see is exactly what this should pay out, the same
 * argument as offline earnings and the rewarded-ad cooldown (see
 * docs/ARCHITECTURE.md, "Two clocks"). Returns how many tokens were granted.
 */
export function updateTokens(state, now = Date.now()) {
  const sweeper = state.sweeper;
  if (sweeper.tokens >= SWEEPER.maxTokens) {
    sweeper.nextTokenAt = 0;
    return 0;
  }
  if (sweeper.nextTokenAt === 0) {
    sweeper.nextTokenAt = now + SWEEPER.refillSeconds * 1000;
    return 0;
  }

  let granted = 0;
  while (sweeper.nextTokenAt <= now && sweeper.tokens < SWEEPER.maxTokens) {
    const before = sweeper.tokens;
    sweeper.tokens = Math.min(SWEEPER.maxTokens, sweeper.tokens + SWEEPER.tokensPerRefill);
    granted += sweeper.tokens - before;
    sweeper.nextTokenAt += SWEEPER.refillSeconds * 1000;
  }
  if (sweeper.tokens >= SWEEPER.maxTokens) sweeper.nextTokenAt = 0;
  return granted;
}

/** Seconds until the next refill, or null when the player is already full. */
export function secondsToNextToken(state, now = Date.now()) {
  if (state.sweeper.tokens >= SWEEPER.maxTokens || state.sweeper.nextTokenAt === 0) return null;
  return Math.max(0, (state.sweeper.nextTokenAt - now) / 1000);
}

export function canPlay(state) {
  if (!state.apps.aerosweeper?.open) return { ok: false, reason: 'not-open' };
  if (state.sweeper.tokens <= 0) return { ok: false, reason: 'no-tokens' };
  return { ok: true };
}

/** Spend a token. The refill clock starts the moment the player drops below full. */
export function spendToken(state, now = Date.now()) {
  state.sweeper.tokens -= 1;
  if (state.sweeper.nextTokenAt === 0) {
    state.sweeper.nextTokenAt = now + SWEEPER.refillSeconds * 1000;
  }
  return state.sweeper.tokens;
}

export function addToken(state, count = 1) {
  state.sweeper.tokens = Math.min(SWEEPER.maxTokens, state.sweeper.tokens + count);
  if (state.sweeper.tokens >= SWEEPER.maxTokens) state.sweeper.nextTokenAt = 0;
  return state.sweeper.tokens;
}

/**
 * What a round of `tiles` safe squares is worth.
 *
 * Pure, and separate from applying it, for the same reason Shield99's loot is:
 * the UI has to show the running number *before* the player decides whether to
 * take it — a push-your-luck mechanic where the stake is invisible is just a
 * button that sometimes disappoints.
 */
export function comboFor(tiles, { hitMine = false, cleared = false } = {}) {
  const banked = Math.min(SWEEPER.maxCombo, Math.max(0, tiles) * SWEEPER.perTile);
  const withBonus = cleared ? banked * SWEEPER.clearBonus : banked;
  return {
    tiles: Math.max(0, tiles),
    magnitude: hitMine ? withBonus * SWEEPER.mineFraction : withBonus,
    durationSeconds: SWEEPER.cashOutSeconds,
    hitMine,
    cleared,
  };
}
