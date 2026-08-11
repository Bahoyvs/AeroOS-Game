import { PLAYLISTS, trackAt } from '../data/playlists.js';
import { formatDuration, formatNumber } from '../core/format.js';
import { motionIsReduced } from './../ui/motion.js';
import { createBuyControl, createCelebration, createLockedPanel, createMeter } from '../ui/building.js';
import { clear, el, throttle } from './../ui/dom.js';

/**
 * RetroAmp — building #2, and the playlist deck (AO-13, GDD v2 §4).
 *
 * The one app that does two unrelated things, and the redesign kept both on
 * purpose. Its **units** are tracks in the library, producing Buzz like any
 * other building. Its **playlists** are a global multiplier over everything the
 * OS makes. Those are different axes — a track pays, a playlist multiplies —
 * so unlike LemonWire's seed slots there was nothing here to fold together.
 *
 * The `w32-buy` costume is Winamp's own: **[+ ADD]**, the button that opened
 * "Add File / Add URL / Add Directory". The milestone moment is GDD §4's EQ
 * lights flaring, and the visualiser going wider with the tier.
 */

const BAR_COUNT = 14;
const EQ_COUNT = 10;
const TRACK_SECONDS = 32; // how long each fake track "plays" before the next

export function mount(body, { game }) {
  body.classList.add('app-retroamp');
  body.innerHTML = `
    <div class="amp__display">
      <div class="amp__marquee">
        <span class="amp__track" data-role="track">— no playlist —</span>
      </div>
      <div class="amp__readout">
        <span data-role="status">Stopped</span>
        <span data-role="boost">×1.00</span>
      </div>
      <div class="amp__viz" data-role="viz" aria-hidden="true"></div>
    </div>

    <div class="amp__eq" data-role="eq" aria-hidden="true"></div>

    <div data-role="meter"></div>
    <div data-role="buy"></div>
    <div data-role="locked"></div>

    <ul class="amp__playlists" data-role="playlists" aria-label="Playlists"></ul>

    <div class="amp__controls">
      <button type="button" class="amp__eject" data-role="eject" disabled>⏏ Eject</button>
      <span class="amp__ram" data-role="ram"></span>
    </div>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const viz = ref('viz');
  const eqRoot = ref('eq');
  const playlistRoot = ref('playlists');

  for (let i = 0; i < BAR_COUNT; i += 1) {
    viz.appendChild(el('span', { class: 'amp__bar' }));
  }

  // Ten EQ sliders, the shape Winamp's equaliser always had. They are lit by
  // the milestone tier rather than draggable — the flare is the celebration.
  for (let i = 0; i < EQ_COUNT; i += 1) {
    eqRoot.appendChild(el('span', { class: 'amp__eq-band' }, el('i', { class: 'amp__eq-led' })));
  }

  /* ------------------------------------------------------- the shared kit */

  const meter = createMeter({ game, buildingId: 'retroamp' });
  ref('meter').replaceWith(meter.root);

  const buy = createBuyControl({
    game,
    buildingId: 'retroamp',
    // Winamp's own button, down to the capitals.
    labels: { one: '+ ADD' },
  });
  buy.root.classList.add('amp__buy');
  ref('buy').replaceWith(buy.root);

  const locked = createLockedPanel({
    game,
    buildingId: 'retroamp',
    message: 'Scanning for media…',
  });
  ref('locked').replaceWith(locked.root);

  /** GDD §4: the EQ lights flare and the amp reports its own upgrade. */
  const celebration = createCelebration({
    game,
    buildingId: 'retroamp',
    host: body,
    render: ({ at, multiplier }) => [
      el('strong', { class: 'w32celebrate__title', text: 'EQ PRESET UNLOCKED' }),
      el('span', {
        class: 'w32celebrate__body',
        text: `${formatNumber(at)} tracks in the library — output ×${multiplier}.`,
      }),
    ],
  });

  ref('eject').addEventListener('click', () => {
    game.ejectPlaylist('ejected');
    update();
  });

  /* ------------------------------------------------------------ playlists */

  const rows = new Map();

  for (const playlist of PLAYLISTS) {
    const button = el(
      'button',
      {
        type: 'button',
        class: 'amp__playlist',
        dataset: { playlistId: playlist.id },
        onclick: () => {
          const result = game.loadPlaylist(playlist.id);
          if (!result.ok && result.reason === 'cooling-down') {
            game.notify(
              `${playlist.name} needs a rest`,
              `Ready again in ${formatDuration(result.seconds)}.`,
              'warn',
            );
          }
          update();
        },
      },
      [
        el('span', { class: 'amp__playlist-name', text: playlist.name }),
        el('span', { class: 'amp__playlist-genre', text: playlist.genre }),
        el('span', { class: 'amp__playlist-blurb', text: playlist.blurb }),
        el('span', { class: 'amp__playlist-meta' }, [
          el('em', {
            text: `+${Math.round(playlist.multiplier * 100)}% to everything`,
          }),
          el('small', {
            dataset: { role: `meta-${playlist.id}` },
            text: playlist.durationSeconds
              ? `${playlist.durationSeconds / 60} min · +${playlist.ram} MB`
              : 'runs until ejected',
          }),
        ]),
      ],
    );
    playlistRoot.appendChild(el('li', {}, button));
    rows.set(playlist.id, button);
  }

  /* --------------------------------------------------------------- update */

  const update = throttle(() => {
    const s = game.state;
    const { econ } = game;
    const now = Date.now();
    const loadedId = s.retroamp.playlist;
    const playing = loadedId !== null && s.apps.retroamp.open;
    const multiplier = econ.retroampMultiplier(s, now);
    const secondsLeft = econ.playlistSecondsLeft(s, now);

    if (loadedId) {
      const elapsed = Math.max(0, (now - s.retroamp.startedAt) / 1000);
      ref('track').textContent = trackAt(loadedId, Math.floor(elapsed / TRACK_SECONDS));
    } else {
      ref('track').textContent = '— no playlist —';
    }

    ref('status').textContent = !loadedId
      ? 'Stopped'
      : secondsLeft !== null
        ? `Playing · ${formatDuration(secondsLeft)} left`
        : 'Playing';
    ref('boost').textContent = `×${multiplier.toFixed(2)}`;
    ref('boost').classList.toggle('is-live', multiplier > 1);
    body.classList.toggle('is-playing', playing);

    const used = econ.playlistRam(s);
    ref('ram').textContent = used > 0 ? `Playlist: +${used} MB` : `${econ.ramFree(s)} MB free`;
    ref('eject').disabled = !loadedId;

    /* ------------------------------------------------- the building half */

    const unlocked = econ.isBuildingUnlocked(s, 'retroamp');
    locked.root.hidden = unlocked;
    buy.root.hidden = !unlocked;
    meter.root.hidden = !unlocked;
    if (unlocked) {
      const bd = econ.getProductionBreakdown(s, 'retroamp');
      meter.update();
      buy.update();
      // The EQ lights are the tier, so the celebration's flare has something
      // permanent to leave behind — the bands stay lit afterwards.
      const lit = Math.round((Math.log2(bd.milestoneMultiplier) / 5) * EQ_COUNT);
      [...eqRoot.children].forEach((band, i) => band.classList.toggle('is-lit', i < lit));
      // The marquee reports the library when nothing is playing, so the window
      // is never blank just because no playlist is loaded.
      if (!loadedId && bd.units > 0) {
        ref('track').textContent = `${formatNumber(bd.units)} tracks · ${formatNumber(bd.total)} Buzz/s`;
      }
    } else {
      locked.update();
    }

    for (const [id, button] of rows) {
      const cooling = econ.playlistCooldownLeft(s, id, now);
      button.classList.toggle('is-loaded', id === loadedId);
      button.classList.toggle('is-cooling', cooling > 0);
      button.disabled = cooling > 0 || id === loadedId;

      const meta = ref(`meta-${id}`);
      if (cooling > 0) meta.textContent = `cooling down · ${formatDuration(cooling)}`;
      else {
        const playlist = PLAYLISTS.find((p) => p.id === id);
        meta.textContent = playlist.durationSeconds
          ? `${playlist.durationSeconds / 60} min · +${playlist.ram} MB`
          : 'runs until ejected';
      }
    }
  }, 150);

  /**
   * The visualiser is cosmetic, so it animates on its own cheap interval rather
   * than doing DOM work inside the simulation tick.
   *
   * VIZ_MS matches `.amp__bar`'s transition exactly: each bar finishes travelling
   * as the next value arrives, so the bars are always in motion. Any shorter and
   * they move-then-hold, which is what reads as stuttering.
   *
   * Under reduced motion there is no transition to interpolate with, so this
   * would be fourteen bars teleporting eight times a second — worse than the
   * stillness the setting asked for. Settle them and stop.
   */
  const VIZ_MS = 120;
  let vizSettled = false;

  function settleViz() {
    for (const bar of viz.children) bar.style.transform = 'scaleY(0.12)';
  }

  const vizTimer = setInterval(() => {
    const playing = body.classList.contains('is-playing') && !motionIsReduced();
    if (!playing) {
      // Settle the bars once rather than leaving them frozen mid-bounce.
      if (vizSettled) return;
      vizSettled = true;
      settleViz();
      return;
    }
    vizSettled = false;
    for (const bar of viz.children) {
      bar.style.transform = `scaleY(${0.12 + Math.random() * 0.88})`;
    }
  }, VIZ_MS);

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);
  return () => {
    unsubscribe();
    celebration.destroy();
    clearInterval(vizTimer);
    clear(playlistRoot);
    body.classList.remove('app-retroamp', 'is-playing');
  };
}
