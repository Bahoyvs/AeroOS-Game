import { clear, el, setBar, throttle } from '../ui/dom.js';
import { mountBuildingPanel } from '../ui/buildingPanel.js';
import { openMinigame } from '../ui/minigames.js';

/**
 * Registry Doctor — 2000s "speed up your PC!" scareware (GDD §A.4).
 *
 * The joke has to land without becoming the thing it parodies, so two rules:
 * the health meter is always *red*, whatever the player does, and the "Repair
 * All" button is honest about being a joke — it finds a fresh batch of problems
 * every time, because that is exactly what the real ones did.
 *
 * Nothing in this window can alarm somebody who did not read the label: the
 * problem names are visibly absurd, and there is no dialog anywhere that
 * resembles a real system warning.
 */
export function mount(body, { game }) {
  body.classList.add('app-registry');
  body.innerHTML = `
    <div class="rd__banner">
      <div class="rd__gauge">
        <div class="meter__track"><div class="meter__fill is-critical" data-role="health"></div></div>
        <strong data-role="verdict">CRITICAL</strong>
      </div>
      <p class="rd__found"><b data-role="found">0</b> problems detected on this computer</p>
    </div>

    <ul class="rd__list" data-role="problems"></ul>
    <button type="button" class="rd__repair" data-role="repair">Repair All Now</button>
    <p class="rd__smallprint">Repairs are cosmetic. Problems are also cosmetic.</p>

    <div data-role="panel"></div>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);

  const PARTS = [
    ['Orphaned registry key', 'HKLM\\SOFTWARE\\Classes\\.aero'],
    ['Invalid ActiveX entry', 'CLSID {8E7A-4C1B-9F02}'],
    ['Obsolete file extension', '.wmz handler missing'],
    ['Broken shared DLL', 'MSVBVM60.DLL refcount 0'],
    ['Startup item not found', 'C:\\PROGRA~1\\TOOLBAR\\tb.exe'],
    ['Fragmented COM entry', 'InprocServer32'],
    ['Empty registry hive', 'HKCU\\Software\\Aero'],
    ['Deprecated font mapping', 'MS Sans Serif → Tahoma'],
  ];

  /** A fresh batch of nonsense. Deterministic count, arbitrary contents. */
  function reseed() {
    const problems = ref('problems');
    clear(problems);
    const take = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < take; i += 1) {
      const [name, detail] = PARTS[Math.floor(Math.random() * PARTS.length)];
      problems.appendChild(
        el('li', { class: 'rd__problem' }, [
          el('span', { class: 'rd__problem-icon', 'aria-hidden': 'true', text: '!' }),
          el('span', {}, [el('strong', { text: name }), el('small', { text: detail })]),
        ]),
      );
    }
    return take;
  }

  let found = reseed() * 527 + 113;

  ref('repair').addEventListener('click', () => {
    // It "repairs", then immediately finds more. That is the entire bit.
    found = reseed() * 531 + 97;
    ref('found').textContent = found.toLocaleString();
    game.notify(
      'Repair complete',
      'Your computer is now 0% faster. New problems were detected.',
      'info',
    );
  });

  const update = throttle(() => {
    const units = game.units('registrydoctor');
    ref('found').textContent = found.toLocaleString();
    // The meter creeps *up* with how much of the product you own. More
    // licences, more problems — the business model, drawn as a bar.
    setBar(ref('health'), Math.min(1, 0.55 + units / 400), { warn: 0, critical: 0 });
    ref('verdict').textContent = units > 0 ? 'CRITICAL' : 'SCAN REQUIRED';
  }, 500);

  const panelCleanup = mountBuildingPanel(ref('panel'), {
    game,
    buildingId: 'registrydoctor',
    onPlayMinigame: (id) => openMinigame(id, { game }),
  });

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);

  return () => {
    unsubscribe();
    panelCleanup();
    body.classList.remove('app-registry');
  };
}
