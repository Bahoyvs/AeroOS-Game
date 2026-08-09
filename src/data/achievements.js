/**
 * Achievements (GDD §D.2) — first-party, because they have to be.
 *
 * The CrazyGames SDK has no achievement API. What it has is `happytime()` (a
 * celebration hook the docs explicitly ask you to use *sparingly*) and
 * `reportGameCompletedPercentage()`. So the list lives here, the badges live in
 * our own save and our own window, and only three curated moments ever ring the
 * portal's bell — see the `big` flag below and `ui/crazygames.js`.
 *
 * Every entry is a **predicate over ordinary state**, never a stored flag. Same
 * rule as cosmetics and goals, for the same three reasons: no migration when the
 * list changes, no badge that can get stuck locked, and a threshold can be
 * re-tuned without touching anybody's save. The only thing persisted is *when*
 * each one was earned.
 *
 * `test(state, api)` receives a small helper surface rather than importing
 * `core/` — data must not depend on the modules that read it.
 */

export const CATEGORIES = {
  milestone: { label: 'Milestones', blurb: 'The road markers.' },
  collector: { label: 'Collector', blurb: 'Everything, in every colour.' },
  skill: { label: 'Skill', blurb: 'Earned with your hands.' },
  retention: { label: 'Habit', blurb: 'For coming back.' },
};

export const ACHIEVEMENT_LIST = [
  /* ------------------------------------------------------------ milestone */
  {
    id: 'first-buddy',
    name: 'Hello, World',
    blurb: 'Add your first buddy.',
    category: 'milestone',
    test: (s, api) => api.units('aerochat') >= 1,
  },
  {
    id: 'buddies-25',
    name: 'Popular',
    blurb: 'Reach 25 buddies and your first milestone bonus.',
    category: 'milestone',
    test: (s, api) => api.units('aerochat') >= 25,
  },
  {
    id: 'buddies-500',
    name: 'Buddy List Full',
    blurb: 'Fill the buddy list to its 500-contact ceiling.',
    category: 'milestone',
    test: (s, api) => api.units('aerochat') >= 500,
  },
  {
    id: 'first-format',
    name: 'Format C:',
    blurb: 'Wipe the machine for the first time.',
    category: 'milestone',
    big: true, // one of the three portal celebrations
    test: (s) => s.prestigeCount >= 1,
  },
  {
    id: 'formats-10',
    name: 'Serial Reinstaller',
    blurb: 'Run Format C: ten times.',
    category: 'milestone',
    test: (s) => s.prestigeCount >= 10,
  },
  {
    id: 'first-legacy',
    name: 'System Profile Restored',
    blurb: 'Reach Legacy Level 1.',
    category: 'milestone',
    test: (s, api) => api.legacyLevel() >= 1,
  },
  {
    id: 'legacy-10',
    name: 'Long Service',
    blurb: 'Reach Legacy Level 10.',
    category: 'milestone',
    test: (s, api) => api.legacyLevel() >= 10,
  },
  {
    id: 'fully-upgraded',
    name: 'Fully Patched',
    blurb: 'Buy every upgrade for a single building.',
    category: 'milestone',
    test: (s, api) => api.anyBuildingFullyUpgraded(),
  },
  {
    id: 'botnet-online',
    name: 'Smart Home',
    blurb: 'Bring your first IoT Botnet device online.',
    category: 'milestone',
    test: (s, api) => api.units('iotbotnet') >= 1,
  },
  {
    id: 'cloud-migration',
    name: 'The Cloud',
    blurb: 'Rack the first Cloud Mainframe. The desktop era ends here.',
    category: 'milestone',
    big: true,
    test: (s, api) => api.units('cloudmainframe') >= 1,
  },
  {
    id: 'buzz-million',
    name: 'Seven Figures',
    blurb: 'Earn a million Buzz all-time.',
    category: 'milestone',
    test: (s) => (s.allTimeBuzz ?? 0) >= 1e6,
  },
  {
    id: 'buzz-billion',
    name: 'Ten Figures',
    blurb: 'Earn a billion Buzz all-time.',
    category: 'milestone',
    test: (s) => (s.allTimeBuzz ?? 0) >= 1e9,
  },

  /* ------------------------------------------------------------ collector */
  {
    id: 'all-buildings',
    name: 'Full Roster',
    blurb: 'Own at least one unit of all twelve buildings.',
    category: 'collector',
    test: (s, api) => api.ownedBuildingCount() >= 12,
  },
  {
    id: 'first-synergy',
    name: 'Better Together',
    blurb: 'Buy your first synergy upgrade.',
    category: 'collector',
    test: (s, api) => api.synergyCount() >= 1,
  },
  {
    id: 'all-synergies',
    name: 'Fully Networked',
    blurb: 'Buy all five synergy upgrades.',
    category: 'collector',
    test: (s, api) => api.synergyCount() >= 5,
  },
  {
    id: 'all-cosmetics',
    name: 'Display Properties',
    blurb: 'Unlock every tint and every wallpaper.',
    category: 'collector',
    test: (s, api) => api.allCosmeticsUnlocked(),
  },
  {
    id: 'all-hardware',
    name: 'Maxed Out',
    blurb: 'Buy the top tier of every hardware track.',
    category: 'collector',
    test: (s, api) => api.allHardwareMaxed(),
  },
  {
    id: 'legacy-slots',
    name: 'Nothing Left Behind',
    blurb: 'Own all three Legacy Slots.',
    category: 'collector',
    test: (s) => (s.legacy?.slots?.length ?? 0) >= 3,
  },

  /* ---------------------------------------------------------------- skill */
  {
    id: 'clean-sweep',
    name: 'Clean Sweep',
    blurb: 'Clear an AeroSweeper board without touching a mine.',
    category: 'skill',
    test: (s) => (s.sweeper?.sweeps ?? 0) >= 1,
  },
  {
    id: 'big-combo',
    name: 'Nerves of Steel',
    blurb: 'Bank 40 safe squares in a single AeroSweeper round.',
    category: 'skill',
    test: (s) => (s.sweeper?.bestTiles ?? 0) >= 40,
  },
  {
    id: 'perfect-minigame',
    name: 'Flawless',
    blurb: 'Finish any mini-game with a perfect score.',
    category: 'skill',
    test: (s) => (s.stats?.perfectMinigames ?? 0) >= 1,
  },
  {
    id: 'all-minigames',
    name: 'Five of Twelve',
    blurb: 'Play all five mini-games at least once.',
    category: 'skill',
    test: (s, api) => api.minigamesPlayedCount() >= 5,
  },
  {
    id: 'breach-survived',
    name: 'Counter-Attack',
    blurb: 'Fight off a full Darknet Breach instead of paying the ransom.',
    category: 'skill',
    big: true,
    test: (s) => (s.event?.survived ?? 0) >= 1,
  },
  {
    id: 'breach-survived-3',
    name: 'Hardened Target',
    blurb: 'Fight off three full breaches.',
    category: 'skill',
    test: (s) => (s.event?.survived ?? 0) >= 3,
  },

  /* ------------------------------------------------------------ retention */
  {
    id: 'welcome-back',
    name: 'Welcome Back',
    blurb: 'Return to a machine you left running for a day.',
    category: 'retention',
    test: (s, api) => (s.stats?.longestAwayHours ?? 0) >= api.returnAfterHours,
  },
  {
    id: 'weekend-warrior',
    name: 'Weekend Warrior',
    blurb: 'Log in three days running.',
    category: 'retention',
    test: (s, api) => (s.stats?.dayStreak ?? 0) >= api.streakDays,
  },
  {
    id: 'week-streak',
    name: 'Daily Driver',
    blurb: 'Log in seven days running.',
    category: 'retention',
    test: (s) => (s.stats?.dayStreak ?? 0) >= 7,
  },
  {
    id: 'incognito',
    name: 'Nothing to See',
    blurb: 'Buy Incognito Mode and silence the darknet for good.',
    category: 'retention',
    test: (s) => s.event?.incognitoModeOwned === true,
  },
];

const BY_ID = new Map(ACHIEVEMENT_LIST.map((a) => [a.id, a]));

export function getAchievement(id) {
  return BY_ID.get(id) ?? null;
}

export function hasAchievement(id) {
  return BY_ID.has(id);
}

/** The three curated moments that ring the portal's bell (GDD §D.3). */
export const BIG_ACHIEVEMENTS = ACHIEVEMENT_LIST.filter((a) => a.big).map((a) => a.id);
