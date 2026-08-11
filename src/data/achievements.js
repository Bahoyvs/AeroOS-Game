/**
 * Achievements (GDD §D.2) — first-party achievement system.
 *
 * Locked badges are shown greyed out, and descriptions are open for retention value.
 * Every entry has a test predicate and a descriptive iconAsset placeholder for custom badge icons.
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
    iconAsset: 'public/icons/badges/badge_hello_world.png',
    iconLabel: 'First Buddy Icon',
    test: (s, api) => api.units('aerochat') >= 1,
  },
  {
    id: 'buddies-25',
    name: 'Popular',
    blurb: 'Reach 25 buddies and your first milestone bonus.',
    category: 'milestone',
    iconAsset: 'public/icons/badges/badge_popular.png',
    iconLabel: '25 Buddies Star',
    test: (s, api) => api.units('aerochat') >= 25,
  },
  {
    id: 'buddies-500',
    name: 'Buddy List Full',
    blurb: 'Fill the buddy list to its 500-contact ceiling.',
    category: 'milestone',
    iconAsset: 'public/icons/badges/badge_buddy_list_full.png',
    iconLabel: 'Full Buddy List Crown',
    test: (s, api) => api.units('aerochat') >= 500,
  },
  {
    id: 'first-format',
    name: 'Format C:',
    blurb: 'Wipe the machine for the first time.',
    category: 'milestone',
    big: true,
    iconAsset: 'public/icons/badges/badge_format_c.png',
    iconLabel: 'Format C: Disc',
    test: (s) => s.prestigeCount >= 1,
  },
  {
    id: 'formats-10',
    name: 'Serial Reinstaller',
    blurb: 'Run Format C: ten times.',
    category: 'milestone',
    iconAsset: 'public/icons/badges/badge_serial_reinstaller.png',
    iconLabel: '10x Format Ribbon',
    test: (s) => s.prestigeCount >= 10,
  },
  {
    id: 'first-legacy',
    name: 'System Profile Restored',
    blurb: 'Reach Legacy Level 1.',
    category: 'milestone',
    iconAsset: 'public/icons/badges/badge_system_restored.png',
    iconLabel: 'Legacy Level 1 Badge',
    test: (s, api) => api.legacyLevel() >= 1,
  },
  {
    id: 'legacy-10',
    name: 'Long Service',
    blurb: 'Reach Legacy Level 10.',
    category: 'milestone',
    iconAsset: 'public/icons/badges/badge_long_service.png',
    iconLabel: 'Legacy Level 10 Shield',
    test: (s, api) => api.legacyLevel() >= 10,
  },
  {
    id: 'fully-upgraded',
    name: 'Fully Patched',
    blurb: 'Buy every upgrade for a single building.',
    category: 'milestone',
    iconAsset: 'public/icons/badges/badge_fully_patched.png',
    iconLabel: 'Max Patch Gear',
    test: (s, api) => api.anyBuildingFullyUpgraded(),
  },
  {
    id: 'botnet-online',
    name: 'Smart Home',
    blurb: 'Bring your first BotNet node online.',
    category: 'milestone',
    iconAsset: 'public/icons/badges/badge_smart_home.png',
    iconLabel: 'BotNet Node Terminal',
    test: (s, api) => api.units('botnet') >= 1,
  },
  {
    id: 'cloud-migration',
    name: 'The Hive',
    blurb: 'Rack the first Hive node. The desktop era ends here.',
    category: 'milestone',
    big: true,
    iconAsset: 'public/icons/badges/badge_the_hive.png',
    iconLabel: 'The Hive Anchor',
    test: (s, api) => api.units('thehive') >= 1,
  },
  {
    id: 'buzz-million',
    name: 'Seven Figures',
    blurb: 'Earn a million Buzz all-time.',
    category: 'milestone',
    iconAsset: 'public/icons/badges/badge_seven_figures.png',
    iconLabel: '1 Million Buzz Coin',
    test: (s) => (s.allTimeBuzz ?? 0) >= 1e6,
  },
  {
    id: 'buzz-billion',
    name: 'Ten Figures',
    blurb: 'Earn a billion Buzz all-time.',
    category: 'milestone',
    iconAsset: 'public/icons/badges/badge_ten_figures.png',
    iconLabel: '1 Billion Buzz Diamond',
    test: (s) => (s.allTimeBuzz ?? 0) >= 1e9,
  },

  /* ------------------------------------------------------------ collector */
  {
    id: 'all-buildings',
    name: 'Full Roster',
    blurb: 'Own at least one unit of all twelve buildings.',
    category: 'collector',
    iconAsset: 'public/icons/badges/badge_full_roster.png',
    iconLabel: '12 Buildings Grid',
    test: (s, api) => api.ownedBuildingCount() >= 12,
  },
  {
    id: 'first-synergy',
    name: 'Better Together',
    blurb: 'Buy your first milestone boost.',
    category: 'collector',
    iconAsset: 'public/icons/badges/badge_better_together.png',
    iconLabel: 'Synergy Spark Link',
    test: (s, api) => api.synergyCount() >= 1,
  },
  {
    id: 'all-synergies',
    name: 'Fully Networked',
    blurb: 'Reach 25 units in all five early buildings.',
    category: 'collector',
    iconAsset: 'public/icons/badges/badge_fully_networked.png',
    iconLabel: '5 Synergy Stars',
    test: (s, api) => api.synergyCount() >= 5,
  },
  {
    id: 'all-cosmetics',
    name: 'Display Properties',
    blurb: 'Unlock every tint and every wallpaper.',
    category: 'collector',
    iconAsset: 'public/icons/badges/badge_display_properties.png',
    iconLabel: 'Display Color Palette',
    test: (s, api) => api.allCosmeticsUnlocked(),
  },
  {
    id: 'all-hardware',
    name: 'Maxed Out',
    blurb: 'Buy the top tier of every hardware track.',
    category: 'collector',
    iconAsset: 'public/icons/badges/badge_maxed_out.png',
    iconLabel: 'Max CPU/RAM Hardware Chip',
    test: (s, api) => api.allHardwareMaxed(),
  },

  /* ---------------------------------------------------------------- skill */
  {
    id: 'clean-sweep',
    name: 'Clean Sweep',
    blurb: 'Clear an AeroSweeper board without touching a mine.',
    category: 'skill',
    iconAsset: 'public/icons/badges/badge_clean_sweep.png',
    iconLabel: 'AeroSweeper Flag Trophy',
    test: (s) => (s.sweeper?.sweeps ?? 0) >= 1,
  },
  {
    id: 'big-combo',
    name: 'Nerves of Steel',
    blurb: 'Bank 40 safe squares in a single AeroSweeper round.',
    category: 'skill',
    iconAsset: 'public/icons/badges/badge_nerves_of_steel.png',
    iconLabel: '40 Combo Steel Shield',
    test: (s) => (s.sweeper?.bestTiles ?? 0) >= 40,
  },
  {
    id: 'overflow-resolved',
    name: 'Crisis Manager',
    blurb: 'Resolve your first Buffer Overflow crisis.',
    category: 'skill',
    big: true,
    iconAsset: 'public/icons/badges/badge_crisis_manager.png',
    iconLabel: 'Overflow Crisis Shield',
    test: (s) => (s.event?.overflowsResolved ?? 0) >= 1,
  },
  {
    id: 'overflow-resolved-3',
    name: 'Hardened Target',
    blurb: 'Resolve three Buffer Overflow crises.',
    category: 'skill',
    iconAsset: 'public/icons/badges/badge_hardened_target.png',
    iconLabel: '3x Crisis Hardened Medal',
    test: (s) => (s.event?.overflowsResolved ?? 0) >= 3,
  },

  /* ------------------------------------------------------------ retention */
  {
    id: 'welcome-back',
    name: 'Welcome Back',
    blurb: 'Return to a machine after time away.',
    category: 'retention',
    iconAsset: 'public/icons/badges/badge_welcome_back.png',
    iconLabel: 'Welcome Back Alarm Clock',
    test: (s) => (s.stats?.playtimeSeconds ?? 0) >= 600,
  },
  {
    id: 'airplane-mode',
    name: 'Quiet Desktop',
    blurb: 'Buy Airplane Mode to calm the internet.',
    category: 'retention',
    iconAsset: 'public/icons/badges/badge_quiet_desktop.png',
    iconLabel: 'Airplane Mode Toggle',
    test: (s) => s.event?.airplaneModeOwned === true,
  },
];

const BY_ID = new Map(ACHIEVEMENT_LIST.map((a) => [a.id, a]));

export function getAchievement(id) {
  return BY_ID.get(id) ?? null;
}

export function hasAchievement(id) {
  return BY_ID.has(id);
}

/** The curated moments that ring the portal's bell (GDD §D.3). */
export const BIG_ACHIEVEMENTS = ACHIEVEMENT_LIST.filter((a) => a.big).map((a) => a.id);
