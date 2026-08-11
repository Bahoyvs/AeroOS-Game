import { CATEGORIES } from '../data/achievements.js';
import { clear, el, setBar, throttle } from '../ui/dom.js';

/**
 * The achievements window — Frutiger Aero / Windows Vista & 7 theme.
 *
 * Shows badge categories with progress bars, glossy Windows 7 glass styling,
 * and explicit asset placeholder indicators for every achievement icon.
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
    setBar(ref('bar'), summary.total === 0 ? 0 : summary.unlocked / summary.total);

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
            el('span', { text: meta.label.toUpperCase() }),
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
                  'aria-label': `${row.unlocked ? 'Earned' : 'Locked'}: ${row.name}. ${row.blurb}`,
                  title: `Icon asset: ${row.iconAsset ?? `badge_${row.id}.png`} (${row.iconLabel ?? row.name})`,
                },
                [
                  el('span', {
                    class: 'ach__icon',
                    'aria-hidden': 'true',
                    title: `Placeholder: ${row.iconAsset ?? `badge_${row.id}.png`}`,
                  }, [
                    el('span', {
                      class: 'ach__icon-placeholder',
                      text: (row.iconLabel ?? row.name).slice(0, 2).toUpperCase(),
                    }),
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
  }, 300);

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
