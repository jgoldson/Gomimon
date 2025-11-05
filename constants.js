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
export const STORAGE_SCHEMA_VERSION = 1;

// Evolution Names Mapping
export const EVOLUTION_NAMES = {
  egg: 'Egg',
  baby: 'Baby-Gomi',
  'typo-ling': 'Typo-ling',
  'muta-pixel': 'Muta-Pixel',
  'classic-gomi': 'Classic-Gomi',
  'null-sprite': 'Null-Sprite'
};

// Valid Evolution States
export const VALID_EVOLUTIONS = [
  'egg',
  'baby',
  'typo-ling',
  'muta-pixel',
  'classic-gomi',
  'null-sprite'
];

// Pet Sprite Paths - now with multiple animations per evolution
export const PET_SPRITES = {
  egg: {
    idle: 'sprites/animated/egg.gif',
    eat: 'sprites/animated/egg.gif',  // Can add egg_eat.gif later
    crashed: 'sprites/animated/crashed.gif',
    starved: 'sprites/animated/starved.gif'
  },
  baby: {
    idle: 'sprites/animated/baby1_idle.gif',
    eat: 'sprites/animated/baby1_eat.gif',
    crashed: 'sprites/animated/baby1_crashed.gif',
    starved: 'sprites/animated/baby1_starved.gif'
  },
  'typo-ling': {
    idle: 'sprites/animated/typo-ling.gif',
    eat: 'sprites/animated/typo-ling.gif',  // Can add specific animations later
    crashed: 'sprites/animated/crashed.gif',
    starved: 'sprites/animated/starved.gif'
  },
  'muta-pixel': {
    idle: 'sprites/animated/muta-pixel.gif',
    eat: 'sprites/animated/muta-pixel.gif',
    crashed: 'sprites/animated/crashed.gif',
    starved: 'sprites/animated/starved.gif'
  },
  'classic-gomi': {
    idle: 'sprites/animated/classic-gomi.gif',
    eat: 'sprites/animated/classic-gomi.gif',
    crashed: 'sprites/animated/crashed.gif',
    starved: 'sprites/animated/starved.gif'
  },
  'null-sprite': {
    idle: 'sprites/animated/starved.gif',
    eat: 'sprites/animated/starved.gif',
    crashed: 'sprites/animated/crashed.gif',
    starved: 'sprites/animated/starved.gif'
  }
};

// Helper function to get sprite for a given evolution and state
export function getPetSprite(evolution, state = 'idle') {
  const evolutionSprites = PET_SPRITES[evolution] || PET_SPRITES['baby'];

  // If the evolution sprites are an object with states
  if (typeof evolutionSprites === 'object' && !Array.isArray(evolutionSprites)) {
    return evolutionSprites[state] || evolutionSprites.idle;
  }

  // Fallback for old single-sprite format
  return evolutionSprites;
}

// Default Stats Object
export const DEFAULT_STATS = {
  hunger: 100,
  glitch: 0,
  level: 1,
  evolution: 'egg',
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
  return {
    hunger: Math.max(0, Math.min(100, Number(stats.hunger) || 0)),
    glitch: Math.max(0, Math.min(100, Number(stats.glitch) || 0)),
    level: Math.max(1, Number(stats.level) || 1),
    evolution: VALID_EVOLUTIONS.includes(stats.evolution) ? stats.evolution : 'egg',
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
