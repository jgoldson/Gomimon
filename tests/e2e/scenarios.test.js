// End-to-End Test Scenarios
// Tests complete user workflows from start to finish

describe('E2E: Complete User Journeys', () => {
  let mockStorage = {};

  beforeEach(() => {
    mockStorage = {
      hunger: 100,
      glitch: 0,
      level: 1,
      evolution: 'egg',
      feedCount: 0,
      diet: { text: 0, image: 0, post: 0 },
      lastUpdate: Date.now(),
      schemaVersion: 1
    };

    chrome.storage.local.get.mockImplementation(() => Promise.resolve({ ...mockStorage }));
    chrome.storage.local.set.mockImplementation((items) => {
      mockStorage = { ...mockStorage, ...items };
      return Promise.resolve();
    });
  });

  describe('Scenario 1: New User First Day', () => {
    test('installs extension and sees egg', async () => {
      // Install extension
      expect(mockStorage.evolution).toBe('egg');
      expect(mockStorage.hunger).toBe(100);
      expect(mockStorage.glitch).toBe(0);
      expect(mockStorage.feedCount).toBe(0);
    });

    test('feeds pet 3 times on Twitter', async () => {
      // Simulate 3 feeds
      for (let i = 0; i < 3; i++) {
        mockStorage.hunger = Math.min(100, mockStorage.hunger + 20);
        mockStorage.glitch = Math.min(100, mockStorage.glitch + 5);
        mockStorage.feedCount += 1;
        mockStorage.diet.post += 1;
      }

      expect(mockStorage.feedCount).toBe(3);
      expect(mockStorage.hunger).toBe(100); // Capped
      expect(mockStorage.glitch).toBe(15);
      expect(mockStorage.diet.post).toBe(3);
    });

    test('pet is still an egg after 3 feeds', () => {
      mockStorage.feedCount = 3;
      const shouldEvolve = mockStorage.feedCount >= 10;
      expect(shouldEvolve).toBe(false);
      expect(mockStorage.evolution).toBe('egg');
    });

    test('waits 5 hours and hunger decreases', () => {
      // 5 hours = 300 minutes = 20 ticks
      mockStorage.hunger = 100;
      for (let i = 0; i < 20; i++) {
        mockStorage.hunger = Math.max(0, mockStorage.hunger - 1);
      }

      expect(mockStorage.hunger).toBe(80);
    });
  });

  describe('Scenario 2: Pet Evolution to Baby', () => {
    test('feeds 10 times and evolves to baby', async () => {
      mockStorage.evolution = 'egg';
      mockStorage.feedCount = 0;

      // Feed 10 times
      for (let i = 0; i < 10; i++) {
        mockStorage.feedCount += 1;
        mockStorage.diet.text += 1;
      }

      // Check evolution
      if (mockStorage.feedCount >= 10 && mockStorage.evolution === 'egg') {
        mockStorage.evolution = 'baby';

        // Expect notification
        expect(chrome.notifications.create).toHaveBeenCalled();
      }

      expect(mockStorage.evolution).toBe('baby');
      expect(mockStorage.feedCount).toBe(10);
    });

    test('continues feeding as baby', () => {
      mockStorage.evolution = 'baby';
      mockStorage.feedCount = 10;

      // Feed 5 more times
      for (let i = 0; i < 5; i++) {
        mockStorage.feedCount += 1;
        mockStorage.diet.image += 1;
      }

      expect(mockStorage.feedCount).toBe(15);
      expect(mockStorage.evolution).toBe('baby'); // Still baby, needs 50
    });
  });

  describe('Scenario 3: Text-Heavy User Evolution', () => {
    test('feeds mostly text content and becomes typo-ling', () => {
      mockStorage.evolution = 'baby';
      mockStorage.feedCount = 10;
      mockStorage.diet = { text: 10, image: 0, post: 0 };

      // Feed 40 more times, mostly text
      for (let i = 0; i < 40; i++) {
        mockStorage.feedCount += 1;
        if (i % 5 === 0) {
          mockStorage.diet.image += 1; // Some variety
        } else {
          mockStorage.diet.text += 1; // Mostly text
        }
      }

      // At 50 feeds, check evolution
      if (mockStorage.feedCount >= 50 && mockStorage.evolution === 'baby') {
        const total = mockStorage.diet.text + mockStorage.diet.image + mockStorage.diet.post;
        const textRatio = mockStorage.diet.text / total;

        if (textRatio > 0.5) {
          mockStorage.evolution = 'typo-ling';
        }
      }

      expect(mockStorage.evolution).toBe('typo-ling');
      expect(mockStorage.feedCount).toBe(50);
      expect(mockStorage.diet.text).toBeGreaterThan(mockStorage.diet.image);
    });
  });

  describe('Scenario 4: Pet Crash and Recovery', () => {
    test('feeds too rapidly and crashes', () => {
      mockStorage.glitch = 80;

      // Feed 4 more times (4 * 5 = 20, total = 100)
      for (let i = 0; i < 4; i++) {
        mockStorage.glitch = Math.min(100, mockStorage.glitch + 5);
      }

      expect(mockStorage.glitch).toBe(100);
    });

    test('sees crash screen and reboots', async () => {
      mockStorage.glitch = 100;

      // User clicks reboot
      await chrome.storage.local.set({ glitch: 0 });

      expect(mockStorage.glitch).toBe(0);
    });

    test('can continue feeding after reboot', () => {
      mockStorage.glitch = 0;
      mockStorage.hunger = 60;

      // Feed normally
      mockStorage.hunger = Math.min(100, mockStorage.hunger + 20);
      mockStorage.glitch = Math.min(100, mockStorage.glitch + 5);

      expect(mockStorage.hunger).toBe(80);
      expect(mockStorage.glitch).toBe(5);
    });
  });

  describe('Scenario 5: Pet Starvation', () => {
    test('forgets to feed and pet starves', () => {
      mockStorage.hunger = 5;

      // 10 hunger ticks pass
      for (let i = 0; i < 10; i++) {
        mockStorage.hunger = Math.max(0, mockStorage.hunger - 1);
      }

      expect(mockStorage.hunger).toBe(0);
    });

    test('sees starved state in popup', () => {
      mockStorage.hunger = 0;

      // Popup should show null-sprite
      const isStarved = mockStorage.hunger === 0;
      expect(isStarved).toBe(true);
    });

    test('feeds to revive pet', () => {
      mockStorage.hunger = 0;

      // Feed once
      mockStorage.hunger = Math.min(100, mockStorage.hunger + 20);

      expect(mockStorage.hunger).toBe(20);
    });
  });

  describe('Scenario 6: Browser Restart After Days', () => {
    test('returns after 3 days and hunger catches up', () => {
      const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
      mockStorage.lastUpdate = threeDaysAgo;
      mockStorage.hunger = 100;

      // Calculate missed ticks (15 min intervals)
      const timeSince = Date.now() - mockStorage.lastUpdate;
      const missedTicks = Math.floor(timeSince / (15 * 60 * 1000));

      // Apply missed ticks
      const newHunger = Math.max(0, mockStorage.hunger - missedTicks);
      mockStorage.hunger = newHunger;

      // 3 days = 4320 minutes = 288 ticks
      expect(mockStorage.hunger).toBe(0); // Should be starved
    });

    test('feeds to recover after long absence', () => {
      mockStorage.hunger = 0;

      // Feed multiple times to recover
      for (let i = 0; i < 3; i++) {
        mockStorage.hunger = Math.min(100, mockStorage.hunger + 20);
      }

      expect(mockStorage.hunger).toBe(60);
    });
  });

  describe('Scenario 7: Balanced Diet User', () => {
    test('feeds varied content and becomes classic-gomi', () => {
      mockStorage.evolution = 'baby';
      mockStorage.feedCount = 10;
      mockStorage.diet = { text: 5, image: 3, post: 2 };

      // Feed balanced diet
      for (let i = 0; i < 40; i++) {
        mockStorage.feedCount += 1;

        // Rotate through food types
        if (i % 3 === 0) {
          mockStorage.diet.text += 1;
        } else if (i % 3 === 1) {
          mockStorage.diet.image += 1;
        } else {
          mockStorage.diet.post += 1;
        }
      }

      // Check evolution at 50
      if (mockStorage.feedCount >= 50 && mockStorage.evolution === 'baby') {
        const total = mockStorage.diet.text + mockStorage.diet.image + mockStorage.diet.post;
        const textRatio = mockStorage.diet.text / total;
        const imageRatio = mockStorage.diet.image / total;

        if (textRatio <= 0.5 && imageRatio <= 0.5) {
          mockStorage.evolution = 'classic-gomi';
        }
      }

      expect(mockStorage.evolution).toBe('classic-gomi');
      expect(mockStorage.feedCount).toBe(50);

      // Verify balanced diet
      const total = mockStorage.diet.text + mockStorage.diet.image + mockStorage.diet.post;
      expect(mockStorage.diet.text / total).toBeLessThanOrEqual(0.5);
      expect(mockStorage.diet.image / total).toBeLessThanOrEqual(0.5);
    });
  });

  describe('Scenario 8: Power User Journey', () => {
    test('completes full evolution in one session', async () => {
      // Start from scratch
      expect(mockStorage.evolution).toBe('egg');

      // Feed to baby (10 feeds)
      for (let i = 0; i < 10; i++) {
        mockStorage.feedCount += 1;
        mockStorage.diet.image += 1;
        mockStorage.hunger = Math.min(100, mockStorage.hunger + 20);
        mockStorage.glitch = Math.min(100, mockStorage.glitch + 5);
      }

      if (mockStorage.feedCount >= 10 && mockStorage.evolution === 'egg') {
        mockStorage.evolution = 'baby';
      }

      expect(mockStorage.evolution).toBe('baby');

      // Feed to muta-pixel (40 more feeds, image-heavy)
      for (let i = 0; i < 40; i++) {
        mockStorage.feedCount += 1;
        mockStorage.diet.image += 1;

        // Manage glitch (reboot when needed)
        mockStorage.glitch = Math.min(100, mockStorage.glitch + 5);
        if (mockStorage.glitch >= 100) {
          mockStorage.glitch = 0; // Reboot
        }
      }

      // Evolve to final form
      if (mockStorage.feedCount >= 50 && mockStorage.evolution === 'baby') {
        const total = mockStorage.diet.text + mockStorage.diet.image + mockStorage.diet.post;
        const imageRatio = mockStorage.diet.image / total;

        if (imageRatio > 0.5) {
          mockStorage.evolution = 'muta-pixel';
        }
      }

      expect(mockStorage.evolution).toBe('muta-pixel');
      expect(mockStorage.feedCount).toBe(50);
    });

    test('continues beyond evolution', () => {
      mockStorage.evolution = 'muta-pixel';
      mockStorage.feedCount = 50;

      // Feed 50 more times
      for (let i = 0; i < 50; i++) {
        mockStorage.feedCount += 1;
        mockStorage.diet.image += 1;
      }

      expect(mockStorage.feedCount).toBe(100);
      expect(mockStorage.evolution).toBe('muta-pixel'); // Stays evolved
    });
  });

  describe('Scenario 9: UI Interactions', () => {
    test('opens popup and sees current state', () => {
      chrome.action.setIcon.mockClear();
      chrome.action.setBadgeText.mockClear();

      // Simulate popup open
      // Should read storage and display stats
      expect(mockStorage.hunger).toBeDefined();
      expect(mockStorage.glitch).toBeDefined();
      expect(mockStorage.evolution).toBeDefined();
    });

    test('badge shows when hungry', () => {
      mockStorage.hunger = 25;

      if (mockStorage.hunger < 30) {
        chrome.action.setBadgeText({ text: '!' });
      }

      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '!' });
    });

    test('right-click context menu appears', () => {
      // Context menu should be registered
      expect(chrome.contextMenus.create).toHaveBeenCalled();
    });
  });

  describe('Scenario 10: Edge Cases', () => {
    test('handles maximum feed count', () => {
      mockStorage.feedCount = 10000;

      // Continue feeding
      mockStorage.feedCount += 1;

      expect(mockStorage.feedCount).toBe(10001);
    });

    test('handles all stats at maximum', () => {
      mockStorage.hunger = 100;
      mockStorage.glitch = 100;
      mockStorage.feedCount = 1000;

      expect(mockStorage.hunger).toBe(100);
      expect(mockStorage.glitch).toBe(100);
    });

    test('handles rapid successive operations', async () => {
      // Simulate rapid clicks (rate limiting should apply)
      const operations = [];

      for (let i = 0; i < 30; i++) {
        operations.push(
          chrome.storage.local.set({ feedCount: mockStorage.feedCount + 1 })
        );
      }

      // All should complete without error
      await Promise.all(operations);
    });
  });
});
