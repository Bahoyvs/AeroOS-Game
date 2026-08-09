import { CATEGORIES } from '../data/achievements.js';
import { clear, el, setBar, throttle } from '../ui/dom.js';

/**
 * The achievements window (GDD §D.3).
 *
 * Built as a Win32 properties page, not a card grid: a blue task-dialog
 * headline, a progress bar, and one **group box per category** holding a sunken
 * white **list view**. That is what a "here is everything you have collected"
 * screen looked like in 2007 — Explorer's details pane, not a dashboard.
 *
 * Locked badges are shown greyed rather than hidden, deliberately: the same
 * visibility rule the upgrade ladder follows (v2 §6). A trophy case with
 * invisible empty shelves gives the player nothing to aim at. Their
 * descriptions are visible too — there is no puzzle value in a secret
 * achievement in an idle game, and real retention value in "three days running"
 * being legible on day one.
 *
 * On a phone the same list view simply gets one column (`mobile.css`), which is
 * why this is a list rather than a grid in the first place: a list degrades to a
 * narrow screen without a second render path.
 */
export function mount(body, { game }) {
  body.classList.add('app-achievements');
  body.innerHTML = `
    <p class="instruction instruction-primary ach__headline" data-role="count"></p>
    <div class="ach__progress">
      <div class="meter__track"><div class="meter__fill" data-role="bar"></div></div>
      <span class="ach__percent" data-role="completion"></span>
    </div>
    <div class="ach__groups" data-role="groups"></div>
  `;

  const ref = (role) => body.querySelector(`[data-role="${role}"]`);
  const groupsRoot = ref('groups');
  let renderedKey = null;

  const update = throttle(() => {
    const summary = game.achievements();
    const percent = game.completionPercent();

    ref('count').textContent =
      `${summary.unlocked} of ${summary.total} badges earned`;
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
        el('fieldset', { class: 'ach__group' }, [
          el('legend', { text: `${meta.label} — ${earned} of ${rows.length}` }),
          el(
            'ul',
            { class: 'ach__list' },
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
                  el('span', {
                    class: 'ach__state',
                    text: row.unlocked ? 'Earned' : 'Locked',
                  }),
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
