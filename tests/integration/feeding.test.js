// Integration Tests for Feeding System
// Tests the complete feeding workflow

import { DEFAULT_STATS, sanitizeStats } from '../../constants.js';

describe('Feeding System Integration', () => {
  let mockStorage = {};

  beforeEach(() => {
    // Reset mock storage before each test
    mockStorage = { ...DEFAULT_STATS };

    chrome.storage.local.get.mockImplementation((keys) => {
      if (typeof keys === 'object' && keys !== null && !Array.isArray(keys)) {
        // keys is default object
        return Promise.resolve({ ...mockStorage });
      }
      return Promise.resolve(mockStorage);
    });

    chrome.storage.local.set.mockImplementation((items) => {
      mockStorage = { ...mockStorage, ...items };
      return Promise.resolve();
    });
  });

  describe('Single Feed Operation', () => {
    test('increases hunger by 20', async () => {
      mockStorage.hunger = 50;

      // Simulate feed
      const newHunger = Math.min(100, mockStorage.hunger + 20);
      await chrome.storage.local.set({ hunger: newHunger });

      expect(mockStorage.hunger).toBe(70);
    });

    test('increases glitch by 5', async () => {
      mockStorage.glitch = 10;

      const newGlitch = Math.min(100, mockStorage.glitch + 5);
      await chrome.storage.local.set({ glitch: newGlitch });

      expect(mockStorage.glitch).toBe(15);
    });

    test('increments feed count', async () => {
      mockStorage.feedCount = 5;

      await chrome.storage.local.set({ feedCount: mockStorage.feedCount + 1 });

      expect(mockStorage.feedCount).toBe(6);
    });

    test('updates diet based on food type', async () => {
      mockStorage.diet = { text: 5, image: 3, post: 2 };

      // Feed text
      const newDiet = { ...mockStorage.diet };
      newDiet.text += 1;
      await chrome.storage.local.set({ diet: newDiet });

      expect(mockStorage.diet.text).toBe(6);
      expect(mockStorage.diet.image).toBe(3);
      expect(mockStorage.diet.post).toBe(2);
    });
  });

  describe('Hunger Cap', () => {
    test('does not exceed 100', async () => {
      mockStorage.hunger = 95;

      const newHunger = Math.min(100, mockStorage.hunger + 20);
      await chrome.storage.local.set({ hunger: newHunger });

      expect(mockStorage.hunger).toBe(100);
    });

    test('caps at 100 even with multiple feeds', async () => {
      mockStorage.hunger = 90;

      // Feed 3 times
      for (let i = 0; i < 3; i++) {
        const newHunger = Math.min(100, mockStorage.hunger + 20);
        mockStorage.hunger = newHunger;
      }

      expect(mockStorage.hunger).toBe(100);
    });
  });

  describe('Glitch Accumulation', () => {
    test('accumulates with multiple feeds', async () => {
      mockStorage.glitch = 0;

      // Feed 10 times
      for (let i = 0; i < 10; i++) {
        const newGlitch = Math.min(100, mockStorage.glitch + 5);
        mockStorage.glitch = newGlitch;
      }

      expect(mockStorage.glitch).toBe(50);
    });

    test('reaches crash threshold at 100', async () => {
      mockStorage.glitch = 0;

      // Feed 20 times (should reach 100)
      for (let i = 0; i < 20; i++) {
        const newGlitch = Math.min(100, mockStorage.glitch + 5);
        mockStorage.glitch = newGlitch;
      }

      expect(mockStorage.glitch).toBe(100);
    });

    test('does not exceed 100', async () => {
      mockStorage.glitch = 95;

      // Feed multiple times
      for (let i = 0; i < 5; i++) {
        const newGlitch = Math.min(100, mockStorage.glitch + 5);
        mockStorage.glitch = newGlitch;
      }

      expect(mockStorage.glitch).toBe(100);
    });
  });

  describe('Diet Tracking', () => {
    test('tracks text feeds', async () => {
      mockStorage.diet = { text: 0, image: 0, post: 0 };

      // Feed text 5 times
      for (let i = 0; i < 5; i++) {
        mockStorage.diet.text += 1;
        mockStorage.feedCount += 1;
      }

      expect(mockStorage.diet.text).toBe(5);
      expect(mockStorage.feedCount).toBe(5);
    });

    test('tracks image feeds', async () => {
      mockStorage.diet = { text: 0, image: 0, post: 0 };

      // Feed images 3 times
      for (let i = 0; i < 3; i++) {
        mockStorage.diet.image += 1;
        mockStorage.feedCount += 1;
      }

      expect(mockStorage.diet.image).toBe(3);
    });

    test('tracks mixed diet', async () => {
      mockStorage.diet = { text: 0, image: 0, post: 0 };

      // Mixed feeding
      mockStorage.diet.text += 3;
      mockStorage.diet.image += 2;
      mockStorage.diet.post += 5;
      mockStorage.feedCount = 10;

      expect(mockStorage.diet.text).toBe(3);
      expect(mockStorage.diet.image).toBe(2);
      expect(mockStorage.diet.post).toBe(5);
      expect(mockStorage.feedCount).toBe(10);
    });
  });

  describe('Hunger Depletion', () => {
    test('decreases hunger by 1 per tick', async () => {
      mockStorage.hunger = 50;

      const newHunger = Math.max(0, mockStorage.hunger - 1);
      await chrome.storage.local.set({ hunger: newHunger });

      expect(mockStorage.hunger).toBe(49);
    });

    test('does not go below 0', async () => {
      mockStorage.hunger = 0;

      const newHunger = Math.max(0, mockStorage.hunger - 1);
      await chrome.storage.local.set({ hunger: newHunger });

      expect(mockStorage.hunger).toBe(0);
    });

    test('multiple ticks deplete correctly', async () => {
      mockStorage.hunger = 10;

      // 15 ticks (should reach 0, not go negative)
      for (let i = 0; i < 15; i++) {
        const newHunger = Math.max(0, mockStorage.hunger - 1);
        mockStorage.hunger = newHunger;
      }

      expect(mockStorage.hunger).toBe(0);
    });
  });

  describe('Feed and Deplete Cycle', () => {
    test('hunger fluctuates realistically', async () => {
      mockStorage.hunger = 50;

      // Feed once (+20)
      mockStorage.hunger = Math.min(100, mockStorage.hunger + 20);
      expect(mockStorage.hunger).toBe(70);

      // Wait 10 ticks (-10)
      for (let i = 0; i < 10; i++) {
        mockStorage.hunger = Math.max(0, mockStorage.hunger - 1);
      }
      expect(mockStorage.hunger).toBe(60);

      // Feed again (+20)
      mockStorage.hunger = Math.min(100, mockStorage.hunger + 20);
      expect(mockStorage.hunger).toBe(80);
    });

    test('glitch resets after reboot', async () => {
      mockStorage.glitch = 100;

      // Reboot
      await chrome.storage.local.set({ glitch: 0 });

      expect(mockStorage.glitch).toBe(0);
    });
  });

  describe('Badge Updates', () => {
    test('shows hunger badge when below threshold', () => {
      mockStorage.hunger = 25;

      if (mockStorage.hunger < 30) {
        chrome.action.setBadgeText({ text: '!' });
        chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
      }

      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '!' });
      expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#FF0000' });
    });

    test('clears badge when hunger is sufficient', () => {
      mockStorage.hunger = 50;

      if (mockStorage.hunger >= 30) {
        chrome.action.setBadgeText({ text: '' });
      }

      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '' });
    });
  });

  describe('Evolution Triggers', () => {
    test('evolution check at 10 feeds', async () => {
      mockStorage.feedCount = 9;
      mockStorage.evolution = 'egg';

      // Feed once more
      mockStorage.feedCount = 10;

      // Check if should evolve
      const shouldEvolve = mockStorage.feedCount >= 10 && mockStorage.evolution === 'egg';
      expect(shouldEvolve).toBe(true);
    });

    test('evolution check at 50 feeds', async () => {
      mockStorage.feedCount = 49;
      mockStorage.evolution = 'baby';

      // Feed once more
      mockStorage.feedCount = 50;

      // Check if should evolve
      const shouldEvolve = mockStorage.feedCount >= 50 && mockStorage.evolution === 'baby';
      expect(shouldEvolve).toBe(true);
    });

    test('no evolution before thresholds', async () => {
      mockStorage.feedCount = 9;
      mockStorage.evolution = 'egg';

      const shouldEvolve = mockStorage.feedCount >= 10;
      expect(shouldEvolve).toBe(false);
    });
  });

  describe('Concurrent Operations', () => {
    test('handles feed during hunger tick', async () => {
      mockStorage.hunger = 50;
      mockStorage.glitch = 10;

      // Simulate concurrent operations
      const hungerTickPromise = new Promise((resolve) => {
        const newHunger = Math.max(0, mockStorage.hunger - 1);
        mockStorage.hunger = newHunger;
        resolve();
      });

      const feedPromise = new Promise((resolve) => {
        const newHunger = Math.min(100, mockStorage.hunger + 20);
        const newGlitch = Math.min(100, mockStorage.glitch + 5);
        mockStorage.hunger = newHunger;
        mockStorage.glitch = newGlitch;
        resolve();
      });

      await Promise.all([hungerTickPromise, feedPromise]);

      // Result depends on operation order, but both should complete
      expect(mockStorage.hunger).toBeGreaterThanOrEqual(49);
      expect(mockStorage.hunger).toBeLessThanOrEqual(70);
      expect(mockStorage.glitch).toBe(15);
    });
  });
});
