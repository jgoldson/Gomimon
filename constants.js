// GomiMon Constants
// Shared configuration values used across the extension
import './platforms.js';
export const PLATFORMS = globalThis.GomiMonPlatforms;

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
export const BABY_TO_BUBBLE_FEEDS = 100;
export const BUBBLE_TO_ADULT_FEEDS = 1000;
export const DIET_DOMINANCE_THRESHOLD = 0.5;

// Rate Limiting
export const MAX_FEEDS_PER_MINUTE = 20;
export const FEED_COOLDOWN_MS = 500; // Minimum time between feeds

// Storage Constants
export const STORAGE_SCHEMA_VERSION = 2;
export const PET_NAME_MIN_LENGTH = 2;
export const PET_NAME_MAX_LENGTH = 24;
export const LEADERBOARD_PENDING_KEY = 'leaderboardPendingMealsV1';
export const LEADERBOARD_STATE_KEY = 'leaderboardStateV1';

// AI detector configuration
export const DETECTOR_API_URL = 'https://gomimon-api.goldentechlabs.com';
export const DETECTOR_MIN_WORDS = 30;
export const DETECTOR_MAX_CHARS = 8000;
export const DETECTOR_SETTINGS_KEY = 'detectorSettings';
export const DETECTOR_SESSION_KEY = 'detectorSessionToken';

export const DETECTOR_MODES = {
  MANUAL: 'manual',
  AUTOMATIC: 'automatic'
};

export const DETECTOR_SENSITIVITY_THRESHOLDS = {
  strict: 0.95,
  balanced: 0.90,
  relaxed: 0.80
};

// Category filters are deliberately separate from AI-authorship detection. The
// local ad check never needs the detector service; the remaining categories use
// independent TypeSafe judgments so several can match the same post.
export const DETECTOR_CATEGORY_DEFINITIONS = {
  politics: { label: 'Politics', remote: true },
  ads: { label: 'Ads', remote: false },
  promotions: { label: 'Promotions', remote: true },
  ragebait: { label: 'Ragebait', remote: true },
  celebrity_gossip: { label: 'Celebrity gossip', remote: true },
  sports: { label: 'Sports', remote: true },
  crypto: { label: 'Crypto', remote: true },
  // AI content uses the same authorship score that powers the detector, but is
  // opt-in here so it behaves like every other item in a GomiMon diet.
  ai_content: { label: 'AI content', remote: false }
};

export const DETECTOR_CATEGORY_IDS = Object.freeze(Object.keys(DETECTOR_CATEGORY_DEFINITIONS));
export const DETECTOR_CATEGORY_STRENGTH_THRESHOLDS = {
  conservative: 0.90,
  balanced: 0.80,
  aggressive: 0.70
};

export const DEFAULT_DETECTOR_SETTINGS = {
  enabledPlatforms: [...PLATFORMS.ids],
  mode: DETECTOR_MODES.MANUAL,
  sensitivity: 'strict',
  categories: [],
  categoryStrength: 'balanced',
  debug: false,
  showEatingAnimations: true,
  serviceUrl: DETECTOR_API_URL
};

// Evolution Names Mapping
export const EVOLUTION_NAMES = {
  egg: 'Egg',
  baby: 'Baby-Gomi',
  'bubble-gomi': 'Bubble-Gomi',
  'nimbus-gomi': 'Nimbus-Gomi',
  'typo-ling': 'Typo-ling',
  'muta-pixel': 'Muta-Pixel',
  'classic-gomi': 'Classic-Gomi',
  'null-sprite': 'Null-Sprite'
};

// Valid Evolution States
export const VALID_EVOLUTIONS = [
  'egg',
  'baby',
  'bubble-gomi',
  'nimbus-gomi',
  'typo-ling',
  'muta-pixel',
  'classic-gomi',
  'null-sprite'
];

// Pet Sprite Paths - now with multiple animations per evolution
export const PET_SPRITES = {
  egg: {
    idle: 'sprites/animated/egg1_idle.gif',
    eat: 'sprites/animated/egg1_idle.gif',  // Reuse the available egg idle loop until an eat animation exists
    crashed: 'sprites/crashed.svg',
    starved: 'sprites/starved.svg'
  },
  baby: {
    idle: 'sprites/animated/baby1_idle.gif',
    eat: 'sprites/animated/baby1_eat.gif',
    crashed: 'sprites/animated/baby1_crashed.gif',
    starved: 'sprites/animated/baby1_starved.gif'
  },
  'bubble-gomi': {
    idle: 'sprites/animated/bubble-gomi_idle.gif',
    eat: 'sprites/animated/bubble-gomi_eat.gif',
    celebrate: 'sprites/animated/bubble-gomi_celebrate.gif',
    sleep: 'sprites/animated/bubble-gomi_sleep.gif',
    crashed: 'sprites/crashed.svg',
    starved: 'sprites/starved.svg'
  },
  'nimbus-gomi': {
    idle: 'sprites/animated/nimbus-gomi_idle.gif',
    eat: 'sprites/animated/nimbus-gomi_eat.gif',
    celebrate: 'sprites/animated/nimbus-gomi_celebrate.gif',
    sleep: 'sprites/animated/nimbus-gomi_sleep.gif',
    crashed: 'sprites/crashed.svg',
    starved: 'sprites/starved.svg'
  },
  'typo-ling': {
    idle: 'sprites/typo-ling.svg',
    eat: 'sprites/typo-ling.svg',  // Can add specific animations later
    crashed: 'sprites/crashed.svg',
    starved: 'sprites/starved.svg'
  },
  'muta-pixel': {
    idle: 'sprites/muta-pixel.svg',
    eat: 'sprites/muta-pixel.svg',
    crashed: 'sprites/crashed.svg',
    starved: 'sprites/starved.svg'
  },
  'classic-gomi': {
    idle: 'sprites/classic-gomi.svg',
    eat: 'sprites/classic-gomi.svg',
    crashed: 'sprites/crashed.svg',
    starved: 'sprites/starved.svg'
  },
  'null-sprite': {
    idle: 'sprites/starved.svg',
    eat: 'sprites/starved.svg',
    crashed: 'sprites/crashed.svg',
    starved: 'sprites/starved.svg'
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
  petName: '',
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
  stats = stats || {};
  return {
    hunger: Math.max(0, Math.min(100, Number(stats.hunger) || 0)),
    glitch: Math.max(0, Math.min(100, Number(stats.glitch) || 0)),
    level: Math.max(1, Number(stats.level) || 1),
    evolution: VALID_EVOLUTIONS.includes(stats.evolution) ? stats.evolution : 'egg',
    petName: normalizePetName(stats.petName),
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

export function normalizePetName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function validatePetName(value) {
  const name = normalizePetName(value);
  const length = [...name].length;
  if (length < PET_NAME_MIN_LENGTH || length > PET_NAME_MAX_LENGTH) {
    return {
      valid: false,
      name,
      error: `Use ${PET_NAME_MIN_LENGTH}-${PET_NAME_MAX_LENGTH} characters.`
    };
  }
  if (!/^[\p{L}\p{N}](?:[\p{L}\p{N} _'’-]*[\p{L}\p{N}])?$/u.test(name)) {
    return {
      valid: false,
      name,
      error: 'Use letters, numbers, spaces, apostrophes, hyphens, or underscores.'
    };
  }
  return { valid: true, name, error: '' };
}

// Validate detector preferences before using them in the extension.
export function sanitizeDetectorSettings(settings) {
  const candidate = settings || {};
  const mode = Object.values(DETECTOR_MODES).includes(candidate.mode)
    ? candidate.mode
    : DEFAULT_DETECTOR_SETTINGS.mode;
  const sensitivity = Object.prototype.hasOwnProperty.call(
    DETECTOR_SENSITIVITY_THRESHOLDS,
    candidate.sensitivity
  )
    ? candidate.sensitivity
    : DEFAULT_DETECTOR_SETTINGS.sensitivity;
  const categories = Array.isArray(candidate.categories)
    ? [...new Set(candidate.categories.map(category => category === 'reddit_ads' ? 'ads' : category).filter(category => DETECTOR_CATEGORY_IDS.includes(category)))]
    : DEFAULT_DETECTOR_SETTINGS.categories;
  const requestedStrength = candidate.categoryStrength === 'cautious' ? 'conservative' : candidate.categoryStrength;
  const categoryStrength = Object.prototype.hasOwnProperty.call(
    DETECTOR_CATEGORY_STRENGTH_THRESHOLDS,
    requestedStrength
  )
    ? requestedStrength
    : DEFAULT_DETECTOR_SETTINGS.categoryStrength;
  const debug = candidate.debug === true;

  let serviceUrl = DEFAULT_DETECTOR_SETTINGS.serviceUrl;
  if (typeof candidate.serviceUrl === 'string') {
    try {
      const url = new URL(candidate.serviceUrl);
      if (url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        serviceUrl = url.toString().replace(/\/$/, '');
      }
    } catch (error) {
      debugLog('Invalid detector service URL, using default');
    }
  }

  const enabledPlatforms = PLATFORMS.normalize(candidate.enabledPlatforms);
  return { mode, sensitivity, categories, categoryStrength, debug, serviceUrl, enabledPlatforms,
    showEatingAnimations: candidate.showEatingAnimations !== false };
}
