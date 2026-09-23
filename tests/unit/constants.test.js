// Unit Tests for constants.js
// Tests all constant values and utility functions

import {
  HUNGER_DECREASE_RATE,
  HUNGER_INCREASE_PER_FEED,
  GLITCH_INCREASE_PER_FEED,
  LOW_HUNGER_THRESHOLD,
  HIGH_GLITCH_THRESHOLD,
  GLITCH_CRASH_THRESHOLD,
  EGG_TO_BABY_FEEDS,
  BUBBLE_TO_ADULT_FEEDS,
  DIET_DOMINANCE_THRESHOLD,
  DEFAULT_STATS,
  VALID_EVOLUTIONS,
  DEFAULT_DETECTOR_SETTINGS,
  DETECTOR_CATEGORY_STRENGTH_THRESHOLDS,
  sanitizeDetectorSettings,
  sanitizeStats,
  normalizePetName,
  validatePetName,
  debugLog
} from '../../constants.js';

describe('Constants', () => {
  describe('Game Balance Constants', () => {
    test('hunger decrease rate is positive', () => {
      expect(HUNGER_DECREASE_RATE).toBeGreaterThan(0);
    });

    test('hunger increase per feed is reasonable', () => {
      expect(HUNGER_INCREASE_PER_FEED).toBeGreaterThan(0);
      expect(HUNGER_INCREASE_PER_FEED).toBeLessThanOrEqual(100);
    });

    test('glitch increase per feed is positive', () => {
      expect(GLITCH_INCREASE_PER_FEED).toBeGreaterThan(0);
    });

    test('thresholds are within valid ranges', () => {
      expect(LOW_HUNGER_THRESHOLD).toBeGreaterThan(0);
      expect(LOW_HUNGER_THRESHOLD).toBeLessThan(100);
      expect(HIGH_GLITCH_THRESHOLD).toBeGreaterThan(0);
      expect(HIGH_GLITCH_THRESHOLD).toBeLessThan(100);
      expect(GLITCH_CRASH_THRESHOLD).toBe(100);
    });

    test('evolution feed counts are ascending', () => {
      expect(EGG_TO_BABY_FEEDS).toBeGreaterThan(0);
      expect(BUBBLE_TO_ADULT_FEEDS).toBeGreaterThan(EGG_TO_BABY_FEEDS);
    });

    test('diet dominance threshold is reasonable', () => {
      expect(DIET_DOMINANCE_THRESHOLD).toBeGreaterThan(0);
      expect(DIET_DOMINANCE_THRESHOLD).toBeLessThanOrEqual(1);
    });
  });

  describe('DEFAULT_STATS', () => {
    test('has all required fields', () => {
      expect(DEFAULT_STATS).toHaveProperty('hunger');
      expect(DEFAULT_STATS).toHaveProperty('glitch');
      expect(DEFAULT_STATS).toHaveProperty('level');
      expect(DEFAULT_STATS).toHaveProperty('evolution');
      expect(DEFAULT_STATS).toHaveProperty('feedCount');
      expect(DEFAULT_STATS).toHaveProperty('diet');
      expect(DEFAULT_STATS).toHaveProperty('lastUpdate');
      expect(DEFAULT_STATS).toHaveProperty('schemaVersion');
    });

    test('hunger starts at 100', () => {
      expect(DEFAULT_STATS.hunger).toBe(100);
    });

    test('glitch starts at 0', () => {
      expect(DEFAULT_STATS.glitch).toBe(0);
    });

    test('evolution starts as egg', () => {
      expect(DEFAULT_STATS.evolution).toBe('egg');
    });

    test('diet starts with all zeros', () => {
      expect(DEFAULT_STATS.diet.text).toBe(0);
      expect(DEFAULT_STATS.diet.image).toBe(0);
      expect(DEFAULT_STATS.diet.post).toBe(0);
    });
  });

  describe('VALID_EVOLUTIONS', () => {
    test('contains expected evolutions', () => {
      expect(VALID_EVOLUTIONS).toContain('egg');
      expect(VALID_EVOLUTIONS).toContain('baby');
      expect(VALID_EVOLUTIONS).toContain('typo-ling');
      expect(VALID_EVOLUTIONS).toContain('muta-pixel');
      expect(VALID_EVOLUTIONS).toContain('classic-gomi');
      expect(VALID_EVOLUTIONS).toContain('null-sprite');
    });

    test('has no duplicates', () => {
      const unique = [...new Set(VALID_EVOLUTIONS)];
      expect(unique.length).toBe(VALID_EVOLUTIONS.length);
    });
  });
});

describe('Detector settings', () => {
  test('starts with category filters disabled and balanced strength', () => {
    expect(DEFAULT_DETECTOR_SETTINGS.categories).toEqual([]);
    expect(DEFAULT_DETECTOR_SETTINGS.categoryStrength).toBe('balanced');
    expect(DEFAULT_DETECTOR_SETTINGS.debug).toBe(false);
  });

  test('sanitizes category IDs and strength while preserving valid AI settings', () => {
    expect(sanitizeDetectorSettings({
      mode: 'automatic',
      sensitivity: 'balanced',
      categories: ['politics', 'unknown', 'politics', 'reddit_ads'],
      categoryStrength: 'aggressive',
      debug: true
    })).toMatchObject({
      mode: 'automatic',
      sensitivity: 'balanced',
      categories: ['politics', 'ads'],
      categoryStrength: 'aggressive',
      debug: true
    });
  });
});

describe('sanitizeStats', () => {
  test('clamps hunger to 0-100 range', () => {
    expect(sanitizeStats({ hunger: -10 }).hunger).toBe(0);
    expect(sanitizeStats({ hunger: 150 }).hunger).toBe(100);
    expect(sanitizeStats({ hunger: 50 }).hunger).toBe(50);
  });

  test('clamps glitch to 0-100 range', () => {
    expect(sanitizeStats({ glitch: -5 }).glitch).toBe(0);
    expect(sanitizeStats({ glitch: 200 }).glitch).toBe(100);
    expect(sanitizeStats({ glitch: 75 }).glitch).toBe(75);
  });

  test('converts invalid hunger to 0', () => {
    expect(sanitizeStats({ hunger: 'invalid' }).hunger).toBe(0);
    expect(sanitizeStats({ hunger: null }).hunger).toBe(0);
    expect(sanitizeStats({ hunger: undefined }).hunger).toBe(0);
    expect(sanitizeStats({ hunger: NaN }).hunger).toBe(0);
  });

  test('converts invalid glitch to 0', () => {
    expect(sanitizeStats({ glitch: 'bad' }).glitch).toBe(0);
    expect(sanitizeStats({ glitch: null }).glitch).toBe(0);
    expect(sanitizeStats({ glitch: undefined }).glitch).toBe(0);
  });

  test('validates evolution and defaults to egg for invalid', () => {
    expect(sanitizeStats({ evolution: 'baby' }).evolution).toBe('baby');
    expect(sanitizeStats({ evolution: 'invalid' }).evolution).toBe('egg');
    expect(sanitizeStats({ evolution: null }).evolution).toBe('egg');
    expect(sanitizeStats({ evolution: '' }).evolution).toBe('egg');
  });

  test('ensures feedCount is non-negative', () => {
    expect(sanitizeStats({ feedCount: -10 }).feedCount).toBe(0);
    expect(sanitizeStats({ feedCount: 0 }).feedCount).toBe(0);
    expect(sanitizeStats({ feedCount: 50 }).feedCount).toBe(50);
  });

  test('ensures level is at least 1', () => {
    expect(sanitizeStats({ level: 0 }).level).toBe(1);
    expect(sanitizeStats({ level: -5 }).level).toBe(1);
    expect(sanitizeStats({ level: 2 }).level).toBe(2);
  });

  test('sanitizes diet object', () => {
    const result = sanitizeStats({
      diet: { text: -5, image: 'bad', post: null }
    });
    expect(result.diet.text).toBe(0);
    expect(result.diet.image).toBe(0);
    expect(result.diet.post).toBe(0);
  });

  test('creates diet object if missing', () => {
    const result = sanitizeStats({});
    expect(result.diet).toBeDefined();
    expect(result.diet.text).toBe(0);
    expect(result.diet.image).toBe(0);
    expect(result.diet.post).toBe(0);
  });

  test('preserves valid stats', () => {
    const validStats = {
      hunger: 75,
      glitch: 25,
      level: 2,
      evolution: 'baby',
      feedCount: 15,
      diet: { text: 5, image: 7, post: 3 },
      lastUpdate: Date.now()
    };

    const result = sanitizeStats(validStats);
    expect(result.hunger).toBe(75);
    expect(result.glitch).toBe(25);
    expect(result.level).toBe(2);
    expect(result.evolution).toBe('baby');
    expect(result.feedCount).toBe(15);
    expect(result.diet.text).toBe(5);
    expect(result.diet.image).toBe(7);
    expect(result.diet.post).toBe(3);
  });

  test('handles empty object', () => {
    const result = sanitizeStats({});
    expect(result.hunger).toBe(0);
    expect(result.glitch).toBe(0);
    expect(result.level).toBe(1);
    expect(result.evolution).toBe('egg');
    expect(result.feedCount).toBe(0);
  });

  test('handles null and undefined', () => {
    expect(() => sanitizeStats(null)).not.toThrow();
    expect(() => sanitizeStats(undefined)).not.toThrow();
  });

  test('converts string numbers correctly', () => {
    const result = sanitizeStats({
      hunger: '50',
      glitch: '25',
      feedCount: '10'
    });
    expect(result.hunger).toBe(50);
    expect(result.glitch).toBe(25);
    expect(result.feedCount).toBe(10);
  });
});

describe('pet names', () => {
  test('normalizes whitespace and accepts friendly Unicode names', () => {
    expect(normalizePetName('  Gomi   Chan  ')).toBe('Gomi Chan');
    expect(validatePetName('Müller-2')).toEqual({ valid: true, name: 'Müller-2', error: '' });
    expect(validatePetName('O’Gomi')).toEqual({ valid: true, name: 'O’Gomi', error: '' });
  });

  test('rejects names that are too short or contain unsupported punctuation', () => {
    expect(validatePetName('A').valid).toBe(false);
    expect(validatePetName('Bad!Name').valid).toBe(false);
  });
});

describe('debugLog', () => {
  test('does not throw errors', () => {
    expect(() => debugLog('test message')).not.toThrow();
    expect(() => debugLog('multiple', 'arguments', 123)).not.toThrow();
  });

  test('accepts various argument types', () => {
    expect(() => debugLog('string')).not.toThrow();
    expect(() => debugLog(123)).not.toThrow();
    expect(() => debugLog({ key: 'value' })).not.toThrow();
    expect(() => debugLog(['array'])).not.toThrow();
    expect(() => debugLog(null)).not.toThrow();
  });
});


test('category strengths use the revised thresholds and migrate the legacy conservative choice', () => {
  expect(DETECTOR_CATEGORY_STRENGTH_THRESHOLDS).toEqual({ conservative: .90, balanced: .80, aggressive: .70 });
  expect(sanitizeDetectorSettings({ categoryStrength: 'cautious' }).categoryStrength).toBe('conservative');
  expect(sanitizeDetectorSettings({}).categoryStrength).toBe('balanced');
});

 test('eating animation preference defaults on and preserves an explicit off', () => {
  expect(sanitizeDetectorSettings({}).showEatingAnimations).toBe(true);
  expect(sanitizeDetectorSettings({ showEatingAnimations: false }).showEatingAnimations).toBe(false);
  expect(sanitizeDetectorSettings({ showEatingAnimations: 'false' }).showEatingAnimations).toBe(true);
});
