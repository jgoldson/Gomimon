// GomiMon Constants
// Shared configuration values used across the extension

// Game Balance Constants
export const HUNGER_DECREASE_RATE = 1;
export const HUNGER_INCREASE_PER_FEED = 20;
export const GLITCH_INCREASE_PER_FEED = 5;
export const HUNGER_TICK_MINUTES = 15;
export const LOW_HUNGER_THRESHOLD = 30;
export const HIGH_GLITCH_THRESHOLD = 80;
export const GLITCH_CRASH_THRESHOLD = 100;

// Evolution Constants
export const EGG_TO_BABY_FEEDS = 10;
export const BABY_TO_ADULT_FEEDS = 50;
export const DIET_DOMINANCE_THRESHOLD = 0.5;

// Rate Limiting
export const MAX_FEEDS_PER_MINUTE = 20;
export const FEED_COOLDOWN_MS = 500; // Minimum time between feeds

// Storage Constants
export const STORAGE_SCHEMA_VERSION = 2; // Bumped for egg type support

// Egg Types
export const EGG_TYPES = {
  TYPE_1: 'egg1',
  TYPE_2: 'egg2',
  TYPE_3: 'egg3'
};

// Egg Names and Descriptions
export const EGG_INFO = {
  egg1: {
    name: 'Tech Egg',
    description: 'A digital egg crackling with data',
    color: '#667eea'
  },
  egg2: {
    name: 'Trash Egg',
    description: 'A grimy egg found in the junk heap',
    color: '#f093fb'
  },
  egg3: {
    name: 'Glitch Egg',
    description: 'A corrupted egg from the void',
    color: '#4facfe'
  }
};

// Evolution tree for each egg type
export const EVOLUTION_TREES = {
  egg1: {
    baby: 'baby1',
    textHeavy: 'typo-ling1',
    imageHeavy: 'muta-pixel1',
    balanced: 'classic-gomi1'
  },
  egg2: {
    baby: 'baby2',
    textHeavy: 'typo-ling2',
    imageHeavy: 'muta-pixel2',
    balanced: 'classic-gomi2'
  },
  egg3: {
    baby: 'baby3',
    textHeavy: 'typo-ling3',
    imageHeavy: 'muta-pixel3',
    balanced: 'classic-gomi3'
  }
};

// Evolution Names Mapping (includes all variants)
export const EVOLUTION_NAMES = {
  // Eggs
  egg1: 'Tech Egg',
  egg2: 'Trash Egg',
  egg3: 'Glitch Egg',

  // Babies
  baby1: 'Byte-Gomi',
  baby2: 'Trash-Gomi',
  baby3: 'Void-Gomi',

  // Text-heavy evolutions
  'typo-ling1': 'Data-Typo',
  'typo-ling2': 'Junk-Typo',
  'typo-ling3': 'Null-Typo',

  // Image-heavy evolutions
  'muta-pixel1': 'Pixel-Bot',
  'muta-pixel2': 'Pixel-Trash',
  'muta-pixel3': 'Pixel-Void',

  // Balanced evolutions
  'classic-gomi1': 'Cyber-Gomi',
  'classic-gomi2': 'Classic-Gomi',
  'classic-gomi3': 'Shadow-Gomi',

  // Special states
  'null-sprite': 'Null-Sprite',
  crashed: 'ERROR.exe'
};

// Valid Evolution States (all possible states)
export const VALID_EVOLUTIONS = [
  null, // No egg chosen yet
  'egg1', 'egg2', 'egg3',
  'baby1', 'baby2', 'baby3',
  'typo-ling1', 'typo-ling2', 'typo-ling3',
  'muta-pixel1', 'muta-pixel2', 'muta-pixel3',
  'classic-gomi1', 'classic-gomi2', 'classic-gomi3',
  'null-sprite'
];

// Pet Sprite Paths (updated for GIFs and multiple types)
export const PET_SPRITES = {
  // Eggs (GIFs)
  egg1: 'sprites/egg1.gif',
  egg2: 'sprites/egg2.gif',
  egg3: 'sprites/egg3.gif',

  // Babies (GIFs)
  baby1: 'sprites/baby1.gif',
  baby2: 'sprites/baby2.gif',
  baby3: 'sprites/baby3.gif',

  // Type 1 evolutions (Tech/Cyber theme)
  'typo-ling1': 'sprites/typo-ling1.gif',
  'muta-pixel1': 'sprites/muta-pixel1.gif',
  'classic-gomi1': 'sprites/classic-gomi1.gif',

  // Type 2 evolutions (Trash theme)
  'typo-ling2': 'sprites/typo-ling2.gif',
  'muta-pixel2': 'sprites/muta-pixel2.gif',
  'classic-gomi2': 'sprites/classic-gomi2.gif',

  // Type 3 evolutions (Glitch/Void theme)
  'typo-ling3': 'sprites/typo-ling3.gif',
  'muta-pixel3': 'sprites/muta-pixel3.gif',
  'classic-gomi3': 'sprites/classic-gomi3.gif',

  // Special states
  'null-sprite': 'sprites/starved.svg',
  crashed: 'sprites/crashed.svg'
};

// Default Stats Object
export const DEFAULT_STATS = {
  hunger: 100,
  glitch: 0,
  level: 1,
  evolution: null, // Will be set when user chooses egg
  eggType: null,   // egg1, egg2, or egg3
  feedCount: 0,
  diet: {
    text: 0,
    image: 0,
    post: 0
  },
  lastUpdate: Date.now(),
  schemaVersion: STORAGE_SCHEMA_VERSION
};

// Food Types
export const FOOD_TYPES = {
  TEXT: 'text',
  IMAGE: 'image',
  POST: 'post'
};

// Animation Durations (ms)
export const ANIMATION_DURATION = {
  PURGE: 500,
  ICON_WIGGLE: 300,
  BADGE_FLASH: 2000,
  OFFSCREEN_CLOSE_DELAY: 3000
};

// Debug Mode (set to false in production)
export const DEBUG_MODE = false;

// Validation Limits
export const VALIDATION_LIMITS = {
  MAX_COORDINATE: 10000,
  MAX_URL_LENGTH: 2048,
  MAX_SELECTION_TEXT: 1000,
  MAX_STORED_ERRORS: 10
};

// Helper function to log in debug mode
export function debugLog(...args) {
  if (DEBUG_MODE) {
    console.log('[GomiMon]', ...args);
  }
}

// Helper function to validate stats
export function sanitizeStats(stats) {
  // Validate eggType
  const validEggTypes = [null, 'egg1', 'egg2', 'egg3'];
  const eggType = validEggTypes.includes(stats.eggType) ? stats.eggType : null;

  return {
    hunger: Math.max(0, Math.min(100, Number(stats.hunger) || 0)),
    glitch: Math.max(0, Math.min(100, Number(stats.glitch) || 0)),
    level: Math.max(1, Number(stats.level) || 1),
    evolution: VALID_EVOLUTIONS.includes(stats.evolution) ? stats.evolution : null,
    eggType: eggType,
    feedCount: Math.max(0, Number(stats.feedCount) || 0),
    diet: {
      text: Math.max(0, Number(stats.diet?.text) || 0),
      image: Math.max(0, Number(stats.diet?.image) || 0),
      post: Math.max(0, Number(stats.diet?.post) || 0)
    },
    lastUpdate: Number(stats.lastUpdate) || Date.now(),
    schemaVersion: STORAGE_SCHEMA_VERSION
  };
}
