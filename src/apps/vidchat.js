import { el, throttle } from '../ui/dom.js';
import { mountBuildingPanel } from '../ui/buildingPanel.js';
import { openMinigame } from '../ui/minigames.js';

/**
 * VidChat — early webcam messenger (GDD §A.4).
 *
 * The reference is an MSN/Yahoo video call circa 2004, and the detail that
 * carries it is the *bad* picture: a deliberately low frame rate and visible
 * blocking. That is period-accurate and it is also the cheap option — the
 * "webcam" is a CSS gradient stack stepped on a slow interval, so there is no
 * video element, no decoder and no per-frame cost. A real `<video>` here would
 * be both less authentic and more expensive.
 *
 * Everything economic is the shared building panel; this module is chrome.
 */
export function mount(body, { game }) {
  body.classList.add('app-vidchat');
  body.innerHTML = `
    <div class="vc__stage">
      <div class="vc__remote" data-role="remote">
        <span class="vc__noise" aria-hidden="true"></span>
        <span class="vc__label" data-role="peer">connecting…</span>
      </div>
      <div class="vc__self" aria-hidden="true"><span class="vc__noise"></span></div>
      <div class="vc__hud">
        <span class="vc__fps" data-role="fps">-- fps</span>
        <span class="vc__dot" data-role="dot"></span>
      </div>
    </div>
    <div data-role="panel"></div>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const remote = ref('remote');

  const PEERS = ['xX_dial_up_Xx', 'brb_mum_needs_phone', 'CamGirl2004', 'l33t_hax0r_99', 'aunt_sue'];
  let peerIndex = 0;

  /**
   * The stutter. Stepping a CSS variable on an interval rather than animating
   * it is the entire trick: it *reads* as a dropped-frame video precisely
   * because it is not smooth, and it costs one style write every 130ms.
   */
  const stutter = setInterval(() => {
    remote.style.setProperty('--jitter', String(Math.random()));
    remote.style.setProperty('--shift', String((Math.random() - 0.5) * 6));
  }, 130);

  const rotate = setInterval(() => {
    peerIndex = (peerIndex + 1) % PEERS.length;
    ref('peer').textContent = PEERS[peerIndex];
  }, 9000);
  ref('peer').textContent = PEERS[0];

  const update = throttle(() => {
    const units = game.units('vidchat');
    // Frames per second as a diegetic readout of how built-out the building is:
    // one channel is a slideshow, two hundred is nearly watchable.
    const fps = units === 0 ? 0 : Math.min(30, 4 + Math.log2(units + 1) * 3);
    ref('fps').textContent = `${fps.toFixed(0)} fps`;
    ref('dot').classList.toggle('is-live', units > 0);
    remote.classList.toggle('is-offline', units === 0);
  }, 500);

  const panelCleanup = mountBuildingPanel(ref('panel'), {
    game,
    buildingId: 'vidchat',
    onPlayMinigame: (id) => openMinigame(id, { game }),
  });

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);

  return () => {
    unsubscribe();
    clearInterval(stutter);
    clearInterval(rotate);
    panelCleanup();
    body.classList.remove('app-vidchat');
  };
}
