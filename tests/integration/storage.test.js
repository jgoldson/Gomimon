// Integration Tests for Storage Operations
// Tests chrome.storage interactions and data persistence

import { DEFAULT_STATS, sanitizeStats } from '../../constants.js';

describe('Storage Integration', () => {
  let mockStorage = {};

  beforeEach(() => {
    mockStorage = {};

    chrome.storage.local.get.mockImplementation((keys) => {
      if (typeof keys === 'object' && keys !== null && !Array.isArray(keys)) {
        // Merge defaults with stored data
        return Promise.resolve({ ...keys, ...mockStorage });
      }
      return Promise.resolve(mockStorage);
    });

    chrome.storage.local.set.mockImplementation((items) => {
      mockStorage = { ...mockStorage, ...items };
      return Promise.resolve();
    });

    chrome.storage.local.clear.mockImplementation(() => {
      mockStorage = {};
      return Promise.resolve();
    });
  });

  describe('Initialization', () => {
    test('creates default stats on first install', async () => {
      await chrome.storage.local.set(DEFAULT_STATS);

      const result = await chrome.storage.local.get(DEFAULT_STATS);
      expect(result.hunger).toBe(100);
      expect(result.glitch).toBe(0);
      expect(result.evolution).toBe('egg');
      expect(result.feedCount).toBe(0);
    });

    test('preserves existing data on reload', async () => {
      const existingData = {
        ...DEFAULT_STATS,
        hunger: 75,
        glitch: 20,
        feedCount: 15
      };

      await chrome.storage.local.set(existingData);
      const result = await chrome.storage.local.get(DEFAULT_STATS);

      expect(result.hunger).toBe(75);
      expect(result.glitch).toBe(20);
      expect(result.feedCount).toBe(15);
    });
  });

  describe('Data Validation', () => {
    test('sanitizes invalid data on read', async () => {
      const invalidData = {
        hunger: -50,
        glitch: 150,
        evolution: 'invalid',
        feedCount: -10
      };

      await chrome.storage.local.set(invalidData);
      const result = await chrome.storage.local.get(DEFAULT_STATS);
      const sanitized = sanitizeStats(result);

      expect(sanitized.hunger).toBe(0);
      expect(sanitized.glitch).toBe(100);
      expect(sanitized.evolution).toBe('egg');
      expect(sanitized.feedCount).toBe(0);
    });

    test('handles missing fields gracefully', async () => {
      const partialData = {
        hunger: 50
        // Missing other fields
      };

      await chrome.storage.local.set(partialData);
      const result = await chrome.storage.local.get(DEFAULT_STATS);

      // Should merge with defaults
      expect(result.hunger).toBeDefined();
      expect(result.glitch).toBeDefined();
      expect(result.evolution).toBeDefined();
    });

    test('handles corrupt data', async () => {
      const corruptData = {
        hunger: 'not a number',
        glitch: null,
        evolution: {},
        diet: 'should be object'
      };

      await chrome.storage.local.set(corruptData);
      const result = await chrome.storage.local.get(DEFAULT_STATS);
      const sanitized = sanitizeStats(result);

      expect(typeof sanitized.hunger).toBe('number');
      expect(typeof sanitized.glitch).toBe('number');
      expect(typeof sanitized.evolution).toBe('string');
      expect(typeof sanitized.diet).toBe('object');
    });
  });

  describe('Atomic Updates', () => {
    test('updates single field without affecting others', async () => {
      await chrome.storage.local.set(DEFAULT_STATS);

      // Update only hunger
      const current = await chrome.storage.local.get(DEFAULT_STATS);
      await chrome.storage.local.set({ ...current, hunger: 80 });

      const result = await chrome.storage.local.get(DEFAULT_STATS);
      expect(result.hunger).toBe(80);
      expect(result.glitch).toBe(0);
      expect(result.evolution).toBe('egg');
    });

    test('updates multiple fields atomically', async () => {
      await chrome.storage.local.set(DEFAULT_STATS);

      const current = await chrome.storage.local.get(DEFAULT_STATS);
      await chrome.storage.local.set({
        ...current,
        hunger: 60,
        glitch: 25,
        feedCount: 5
      });

      const result = await chrome.storage.local.get(DEFAULT_STATS);
      expect(result.hunger).toBe(60);
      expect(result.glitch).toBe(25);
      expect(result.feedCount).toBe(5);
    });
  });

  describe('Schema Migration', () => {
    test('adds schemaVersion to old data', async () => {
      const oldData = {
        hunger: 75,
        glitch: 10,
        // No schemaVersion
      };

      await chrome.storage.local.set(oldData);
      const result = await chrome.storage.local.get(DEFAULT_STATS);

      // Should have default schemaVersion
      expect(result.schemaVersion).toBeDefined();
    });

    test('preserves schemaVersion on updates', async () => {
      const data = {
        ...DEFAULT_STATS,
        schemaVersion: 1
      };

      await chrome.storage.local.set(data);

      // Update some stats
      const current = await chrome.storage.local.get(DEFAULT_STATS);
      await chrome.storage.local.set({ ...current, hunger: 90 });

      const result = await chrome.storage.local.get(DEFAULT_STATS);
      expect(result.schemaVersion).toBe(1);
    });
  });

  describe('Storage Change Listeners', () => {
    test('listeners receive change notifications', () => {
      const listener = jest.fn();
      chrome.storage.onChanged.addListener(listener);

      expect(chrome.storage.onChanged.addListener).toHaveBeenCalledWith(listener);
    });

    test('can remove listeners', () => {
      const listener = jest.fn();
      chrome.storage.onChanged.addListener(listener);
      chrome.storage.onChanged.removeListener(listener);

      expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledWith(listener);
    });
  });

  describe('Storage Limits', () => {
    test('handles large diet values', async () => {
      const largeData = {
        ...DEFAULT_STATS,
        feedCount: 10000,
        diet: {
          text: 5000,
          image: 3000,
          post: 2000
        }
      };

      await chrome.storage.local.set(largeData);
      const result = await chrome.storage.local.get(DEFAULT_STATS);

      expect(result.feedCount).toBe(10000);
      expect(result.diet.text).toBe(5000);
    });

    test('handles maximum stat values', async () => {
      const maxData = {
        ...DEFAULT_STATS,
        hunger: 100,
        glitch: 100,
        level: Number.MAX_SAFE_INTEGER,
        feedCount: Number.MAX_SAFE_INTEGER
      };

      await chrome.storage.local.set(maxData);
      const result = await chrome.storage.local.get(DEFAULT_STATS);

      expect(result.hunger).toBe(100);
      expect(result.glitch).toBe(100);
    });
  });

  describe('Error Handling', () => {
    test('handles storage.get failures', async () => {
      chrome.storage.local.get.mockRejectedValueOnce(new Error('Storage unavailable'));

      try {
        await chrome.storage.local.get(DEFAULT_STATS);
        fail('Should have thrown error');
      } catch (error) {
        expect(error.message).toBe('Storage unavailable');
      }
    });

    test('handles storage.set failures', async () => {
      chrome.storage.local.set.mockRejectedValueOnce(new Error('Quota exceeded'));

      try {
        await chrome.storage.local.set(DEFAULT_STATS);
        fail('Should have thrown error');
      } catch (error) {
        expect(error.message).toBe('Quota exceeded');
      }
    });

    test('handles concurrent access', async () => {
      await chrome.storage.local.set(DEFAULT_STATS);

      // Simulate multiple concurrent reads
      const reads = Array(10).fill(null).map(() =>
        chrome.storage.local.get(DEFAULT_STATS)
      );

      const results = await Promise.all(reads);
      results.forEach(result => {
        expect(result).toBeDefined();
        expect(result.hunger).toBeDefined();
      });
    });
  });

  describe('lastUpdate Timestamp', () => {
    test('updates timestamp on every change', async () => {
      const before = Date.now();
      await chrome.storage.local.set({ ...DEFAULT_STATS, lastUpdate: Date.now() });

      const result = await chrome.storage.local.get(DEFAULT_STATS);
      const after = Date.now();

      expect(result.lastUpdate).toBeGreaterThanOrEqual(before);
      expect(result.lastUpdate).toBeLessThanOrEqual(after);
    });

    test('calculates time since last update', async () => {
      const pastTime = Date.now() - (60 * 60 * 1000); // 1 hour ago
      await chrome.storage.local.set({ ...DEFAULT_STATS, lastUpdate: pastTime });

      const result = await chrome.storage.local.get(DEFAULT_STATS);
      const timeSince = Date.now() - result.lastUpdate;

      expect(timeSince).toBeGreaterThan(60 * 60 * 1000 - 1000); // ~1 hour
    });
  });
});
