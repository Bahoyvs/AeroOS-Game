import { CATEGORIES } from '../data/achievements.js';
import { clear, el, setBar, throttle } from '../ui/dom.js';

/**
 * The achievements window (GDD §D.3).
 *
 * An icon grid on the desktop and a single-column list on a phone, which is the
 * PDA pattern the rest of the shell already uses — the switch is a CSS grid
 * change in `mobile.css`, not a second render path here.
 *
 * Locked badges are shown greyed rather than hidden, deliberately: the same
 * visibility rule the upgrade ladder follows (v2 §6). A trophy case with
 * invisible empty shelves gives the player nothing to aim at.
 *
 * Descriptions of locked badges are *not* hidden either. There is no puzzle
 * value in a secret achievement in an idle game, and there is real retention
 * value in "three days running" being legible on day one.
 */
export function mount(body, { game }) {
  body.classList.add('app-achievements');
  body.innerHTML = `
    <header class="ach__head">
      <div class="ach__count">
        <strong data-role="count">0 / 0</strong>
        <small>badges earned</small>
      </div>
      <div class="ach__progress">
        <div class="meter__track"><div class="meter__fill" data-role="bar"></div></div>
        <small data-role="completion">0% complete</small>
      </div>
    </header>
    <div class="ach__groups" data-role="groups"></div>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const groupsRoot = ref('groups');
  let renderedKey = null;

  const update = throttle(() => {
    const summary = game.achievements();
    const percent = game.completionPercent();

    ref('count').textContent = `${summary.unlocked} / ${summary.total}`;
    ref('completion').textContent = `${percent}% complete`;
    setBar(ref('bar'), summary.total === 0 ? 0 : summary.unlocked / summary.total, {
      warn: 2,
      critical: 2,
    });

    // Only redraw when something actually changed — this window is open while
    // the tick runs, and rebuilding thirty nodes ten times a second to say
    // "still locked" is pure garbage collection.
    const key = summary.rows.map((r) => (r.unlocked ? '1' : '0')).join('');
    if (key === renderedKey) return;
    renderedKey = key;

    clear(groupsRoot);
    for (const [id, meta] of Object.entries(CATEGORIES)) {
      const rows = summary.rows.filter((r) => r.category === id);
      if (rows.length === 0) continue;

      const earned = rows.filter((r) => r.unlocked).length;
      groupsRoot.appendChild(
        el('section', { class: 'ach__group' }, [
          el('h4', { class: 'ach__group-title' }, [
            el('span', { text: meta.label }),
            el('small', { text: `${earned}/${rows.length}` }),
          ]),
          el(
            'ul',
            { class: 'ach__grid' },
            rows.map((row) =>
              el(
                'li',
                {
                  class: `ach__badge${row.unlocked ? ' is-unlocked' : ' is-locked'}`,
                  // The whole row is the accessible unit: a screen reader
                  // should hear "locked" before the name, not after the blurb.
                  'aria-label': `${row.unlocked ? 'Earned' : 'Locked'}: ${row.name}. ${row.blurb}`,
                },
                [
                  el('span', { class: 'ach__icon', 'aria-hidden': 'true' }, [
                    el('i', { class: `ach__glyph ach__glyph--${row.category}` }),
                  ]),
                  el('span', { class: 'ach__text' }, [
                    el('strong', { text: row.name }),
                    el('small', { text: row.blurb }),
                  ]),
                ],
              ),
            ),
          ),
        ]),
      );
    }
  }, 400);

  update();
  const unsubscribe = game.bus.on(game.events.TICK, update);
  const offEarned = game.bus.on(game.events.ACHIEVEMENT, () => {
    renderedKey = null;
    update();
  });

  return () => {
    unsubscribe();
    offEarned();
    body.classList.remove('app-achievements');
  };
}
