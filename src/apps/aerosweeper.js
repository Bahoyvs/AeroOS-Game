import { SWEEPER } from '../data/balance.js';
import {
  cellAt,
  comboFor,
  mineLocations,
  minesLeft,
  revealTile,
  toggleFlag,
} from '../core/sweeper.js';
import { formatDuration, formatNumber } from '../core/format.js';
import { el, throttle } from './../ui/dom.js';

/**
 * AeroSweeper (Day 7) — the presentation half.
 *
 * The board logic is in src/core/sweeper.js and knows nothing about this file.
 * What happens here is a CSS grid of 81 buttons, and the one decision that
 * shapes the module: **the tiles are built once and then patched**, never
 * re-rendered. A flood fill can turn over thirty squares in a single click, and
 * rebuilding the grid for each of them would throw away the button the player's
 * finger is still on.
 *
 * Closing the window cashes out rather than abandoning the round. The token is
 * already spent, and losing a swept board to a mis-tapped close button is the
 * kind of thing that makes a player stop opening the app at all.
 */

/** Long-press to flag on touch. Below this it is a reveal. */
const LONG_PRESS_MS = 400;

export function mount(body, { game, audio }) {
  body.classList.add('app-sweeper');
  body.innerHTML = `
    <div class="sw__hud">
      <div class="sw__tokens">
        <span class="sw__token-pips" data-role="pips" aria-hidden="true"></span>
        <span class="sw__token-text" data-role="token-text"></span>
      </div>
      <button type="button" class="sw__buy" data-role="buy"></button>
    </div>

    <div class="sw__status">
      <span class="sw__mines" data-role="mines" title="Mines left to find">💣 <strong>0</strong></span>
      <span class="sw__multiplier" data-role="multiplier">×1.0</span>
      <button type="button" class="sw__flag-toggle" data-role="flag-mode" aria-pressed="false">
        🚩 Flag
      </button>
    </div>

    <div class="sw__board" data-role="board" role="grid" aria-label="Minefield"></div>

    <p class="sw__banner" data-role="banner" hidden></p>

    <button type="button" class="sw__action" data-role="action"></button>

    <p class="sw__hint" data-role="hint"></p>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const boardRoot = ref('board');
  const actionButton = ref('action');
  const flagButton = ref('flag-mode');

  /** The live round, or null between rounds. Never persisted — see core. */
  let round = null;
  let flagMode = false;
  let tiles = [];

  /* ----------------------------------------------------------- the grid */

  boardRoot.style.setProperty('--cols', String(SWEEPER.cols));

  function buildGrid() {
    tiles = [];
    boardRoot.replaceChildren();
    for (let row = 0; row < SWEEPER.rows; row += 1) {
      for (let col = 0; col < SWEEPER.cols; col += 1) {
        const tile = el('button', {
          type: 'button',
          class: 'sw__tile',
          role: 'gridcell',
          'aria-label': `Row ${row + 1}, column ${col + 1}`,
          dataset: { row: String(row), col: String(col) },
        });
        boardRoot.appendChild(tile);
        tiles.push(tile);
      }
    }
  }

  const tileAt = (row, col) => tiles[row * SWEEPER.cols + col];

  /** Repaint one square from its cell. The only thing that touches the DOM. */
  function paint(row, col, { exploded = false } = {}) {
    if (!round) return;
    const cell = cellAt(round, row, col);
    const tile = tileAt(row, col);
    if (!cell || !tile) return;

    tile.classList.toggle('is-revealed', cell.revealed);
    tile.classList.toggle('is-flagged', cell.flagged && !cell.revealed);
    tile.classList.toggle('is-mine', cell.revealed && cell.mine);
    tile.classList.toggle('is-blast', exploded);
    tile.classList.remove('is-1', 'is-2', 'is-3', 'is-4', 'is-5', 'is-6', 'is-7', 'is-8');

    if (cell.revealed && cell.mine) {
      tile.textContent = '💣';
    } else if (cell.revealed && cell.adjacent > 0) {
      tile.textContent = String(cell.adjacent);
      tile.classList.add(`is-${cell.adjacent}`);
    } else if (cell.flagged) {
      tile.textContent = '🚩';
    } else {
      tile.textContent = '';
    }

    tile.setAttribute(
      'aria-label',
      `Row ${row + 1}, column ${col + 1}${
        cell.revealed
          ? cell.mine
            ? ': mine'
            : `: ${cell.adjacent} adjacent mines`
          : cell.flagged
            ? ': flagged'
            : ''
      }`,
    );
  }

  /* ------------------------------------------------------------- input */

  let pressTimer = null;
  let longPressed = false;

  function coordsOf(target) {
    const tile = target.closest('.sw__tile');
    if (!tile) return null;
    return { row: Number(tile.dataset.row), col: Number(tile.dataset.col) };
  }

  boardRoot.addEventListener('pointerdown', (event) => {
    const at = coordsOf(event.target);
    if (!at || !round || round.phase === 'lost' || round.phase === 'won') return;
    longPressed = false;
    // Touch has no right button, so a held tile plants the flag instead. The
    // toggle above does the same job for anyone who would rather not wait.
    pressTimer = setTimeout(() => {
      longPressed = true;
      flag(at.row, at.col);
    }, LONG_PRESS_MS);
  });

  const cancelPress = () => {
    clearTimeout(pressTimer);
    pressTimer = null;
  };
  boardRoot.addEventListener('pointerup', cancelPress);
  boardRoot.addEventListener('pointercancel', cancelPress);
  boardRoot.addEventListener('pointerleave', cancelPress);

  boardRoot.addEventListener('click', (event) => {
    cancelPress();
    if (longPressed) return; // the press already planted a flag
    const at = coordsOf(event.target);
    if (!at) return;
    if (flagMode) flag(at.row, at.col);
    else dig(at.row, at.col);
  });

  boardRoot.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const at = coordsOf(event.target);
    if (at) flag(at.row, at.col);
  });

  flagButton.addEventListener('click', () => {
    flagMode = !flagMode;
    flagButton.setAttribute('aria-pressed', String(flagMode));
    flagButton.classList.toggle('is-on', flagMode);
  });

  /* ------------------------------------------------------------ actions */

  function flag(row, col) {
    if (!round || round.phase === 'lost' || round.phase === 'won') return;
    toggleFlag(round, row, col);
    paint(row, col);
    audio?.play('click');
    update();
  }

  function dig(row, col) {
    if (!round || round.phase === 'lost' || round.phase === 'won') return;

    const result = revealTile(round, row, col);
    if (result.revealed.length === 0 && !result.hitMine) return;

    if (result.hitMine) {
      // Show the whole layout: a player who never sees where the mines were
      // learns nothing from the round they just lost.
      for (const mine of mineLocations(round)) {
        cellAt(round, mine.row, mine.col).revealed = true;
        paint(mine.row, mine.col, { exploded: mine.row === row && mine.col === col });
      }
      audio?.play('virus');
      finish({ hitMine: true });
      return;
    }

    for (const cell of result.revealed) paint(cell.row, cell.col);
    audio?.play('tile');

    if (result.cleared) {
      audio?.play('chime');
      finish({ cleared: true });
      return;
    }
    update();
  }

  /** Bank whatever the round is worth and go back to "ready". */
  function finish({ hitMine = false, cleared = false } = {}) {
    if (!round) return;
    const swept = round.revealedCount;
    const result = game.endSweeperRound(swept, { hitMine, cleared });
    round = null;

    const banner = ref('banner');
    banner.hidden = false;
    banner.classList.toggle('is-bad', hitMine);
    banner.classList.toggle('is-good', !hitMine);
    banner.textContent = hitMine
      ? `Mine. Half the combo survived — Nudge pays ×${(1 + result.combo.magnitude).toFixed(1)}.`
      : cleared
        ? `Board swept! ×${(1 + result.combo.magnitude).toFixed(1)} with the clear bonus.`
        : `Banked ${swept} squares — Nudge pays ×${(1 + result.combo.magnitude).toFixed(1)}.`;

    update();
  }

  actionButton.addEventListener('click', () => {
    if (round) {
      audio?.play('coin');
      finish();
      return;
    }

    const result = game.startSweeperRound();
    if (!result.ok) {
      const messages = {
        'no-tokens': ['Out of tokens', 'One arrives every two hours, or buy one with Buzz.'],
        'not-open': ['AeroSweeper is closed', 'Open it to play.'],
      };
      const [title, text] = messages[result.reason] ?? ['Cannot deal a board', ''];
      game.notify(title, text, 'warn');
      update();
      return;
    }

    round = result.round;
    ref('banner').hidden = true;
    buildGrid();
    audio?.play('hdd');
    update();
  });

  /* -------------------------------------------------------------- update */

  const update = throttle(() => {
    const s = game.state;
    const now = Date.now();
    const combo = game.econ.sweeperCombo(s, now);

    ref('pips').textContent =
      '●'.repeat(s.sweeper.tokens) + '○'.repeat(SWEEPER.maxTokens - s.sweeper.tokens);
    const seconds = game.sweeperTokenSeconds(now);
    ref('token-text').textContent =
      seconds === null
        ? `${s.sweeper.tokens} tokens · full`
        : `${s.sweeper.tokens} left · +1 in ${formatDuration(Math.ceil(seconds))}`;

    const buy = ref('buy');
    buy.disabled = !game.econ.canBuySweeperToken(s, now).ok;
    buy.textContent =
      s.sweeper.tokens >= SWEEPER.maxTokens
        ? 'Tokens full'
        : `Buy token · ${formatNumber(game.econ.sweeperTokenCost(s, now))}`;

    // The stake, always visible: a push-your-luck round where the player cannot
    // see what they are risking is just a button that sometimes disappoints.
    const swept = round?.revealedCount ?? 0;
    const stake = comboFor(swept);
    ref('mines').querySelector('strong').textContent = round ? String(minesLeft(round)) : '—';
    ref('multiplier').textContent = round
      ? `×${(1 + stake.magnitude).toFixed(1)}`
      : combo.active
        ? `×${combo.multiplier.toFixed(1)} · ${Math.ceil(combo.secondsLeft)}s`
        : `best ${s.sweeper.bestTiles}`;
    ref('multiplier').classList.toggle('is-live', Boolean(round) || combo.active);

    actionButton.disabled = !round && s.sweeper.tokens <= 0;
    actionButton.classList.toggle('is-cashout', Boolean(round));
    actionButton.textContent = round
      ? `Cash out ×${(1 + stake.magnitude).toFixed(1)}`
      : s.sweeper.tokens > 0
        ? 'Deal a board · 1 token'
        : 'No tokens left';

    flagButton.disabled = !round;
    ref('hint').textContent = round
      ? `Every safe square is +${SWEEPER.perTile.toFixed(1)}×. A mine halves what you have banked. Right-click or hold to flag.`
      : `Cash out any time for ${SWEEPER.cashOutSeconds / 60} minutes of that multiplier on the Nudge button.`;
  }, 100);

  buildGrid();
  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);

  return () => {
    unsubscribe();
    cancelPress();
    // The token is already spent, so an unfinished board is banked rather than
    // binned. Closing the window is a decision to stop, not a forfeit.
    if (round) finish();
    body.classList.remove('app-sweeper');
  };
}
