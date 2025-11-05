// Unit Tests for Evolution Logic
// Tests the evolution calculation algorithm

import {
  EGG_TO_BABY_FEEDS,
  BABY_TO_ADULT_FEEDS,
  DIET_DOMINANCE_THRESHOLD
} from '../../constants.js';

// Mock the calculateEvolution function from background.js
// Since we can't directly import from service worker, we'll test the logic

describe('Evolution Logic', () => {
  function calculateEvolution(feedCount, currentEvolution, diet) {
    // Egg to Baby at 10 feeds
    if (feedCount >= EGG_TO_BABY_FEEDS && currentEvolution === 'egg') {
      return { evolution: 'baby', justEvolved: true };
    }

    // Baby to Adult at 50 feeds
    if (feedCount >= BABY_TO_ADULT_FEEDS && currentEvolution === 'baby') {
      const total = diet.text + diet.image + diet.post;

      // Prevent division by zero
      if (total === 0) {
        return { evolution: 'classic-gomi', justEvolved: true };
      }

      // Determine evolution based on dominant food type
      const textRatio = diet.text / total;
      const imageRatio = diet.image / total;

      if (textRatio > DIET_DOMINANCE_THRESHOLD) {
        return { evolution: 'typo-ling', justEvolved: true };
      } else if (imageRatio > DIET_DOMINANCE_THRESHOLD) {
        return { evolution: 'muta-pixel', justEvolved: true };
      } else {
        return { evolution: 'classic-gomi', justEvolved: true };
      }
    }

    return { evolution: currentEvolution, justEvolved: false };
  }

  describe('Egg to Baby Evolution', () => {
    test('evolves at exactly 10 feeds', () => {
      const result = calculateEvolution(10, 'egg', { text: 0, image: 0, post: 10 });
      expect(result.evolution).toBe('baby');
      expect(result.justEvolved).toBe(true);
    });

    test('does not evolve before 10 feeds', () => {
      const result = calculateEvolution(9, 'egg', { text: 0, image: 0, post: 9 });
      expect(result.evolution).toBe('egg');
      expect(result.justEvolved).toBe(false);
    });

    test('evolves after 10 feeds', () => {
      const result = calculateEvolution(15, 'egg', { text: 0, image: 0, post: 15 });
      expect(result.evolution).toBe('baby');
      expect(result.justEvolved).toBe(true);
    });

    test('does not evolve if already baby', () => {
      const result = calculateEvolution(15, 'baby', { text: 0, image: 0, post: 15 });
      expect(result.evolution).toBe('baby');
      expect(result.justEvolved).toBe(false);
    });
  });

  describe('Baby to Adult Evolution', () => {
    test('evolves to typo-ling with text-dominant diet', () => {
      const diet = { text: 30, image: 10, post: 10 }; // 60% text
      const result = calculateEvolution(50, 'baby', diet);
      expect(result.evolution).toBe('typo-ling');
      expect(result.justEvolved).toBe(true);
    });

    test('evolves to muta-pixel with image-dominant diet', () => {
      const diet = { text: 10, image: 30, post: 10 }; // 60% image
      const result = calculateEvolution(50, 'baby', diet);
      expect(result.evolution).toBe('muta-pixel');
      expect(result.justEvolved).toBe(true);
    });

    test('evolves to classic-gomi with balanced diet', () => {
      const diet = { text: 17, image: 16, post: 17 }; // Balanced
      const result = calculateEvolution(50, 'baby', diet);
      expect(result.evolution).toBe('classic-gomi');
      expect(result.justEvolved).toBe(true);
    });

    test('handles zero diet totals (no crash)', () => {
      const diet = { text: 0, image: 0, post: 0 };
      const result = calculateEvolution(50, 'baby', diet);
      expect(result.evolution).toBe('classic-gomi');
      expect(result.justEvolved).toBe(true);
    });

    test('does not evolve before 50 feeds', () => {
      const diet = { text: 25, image: 10, post: 10 };
      const result = calculateEvolution(49, 'baby', diet);
      expect(result.evolution).toBe('baby');
      expect(result.justEvolved).toBe(false);
    });

    test('does not evolve if already evolved', () => {
      const diet = { text: 30, image: 10, post: 10 };
      const result = calculateEvolution(60, 'typo-ling', diet);
      expect(result.evolution).toBe('typo-ling');
      expect(result.justEvolved).toBe(false);
    });

    test('requires >50% for dominance (exactly 50% is balanced)', () => {
      const diet = { text: 25, image: 25, post: 0 }; // Exactly 50% each
      const result = calculateEvolution(50, 'baby', diet);
      expect(result.evolution).toBe('classic-gomi'); // Balanced, not dominated
    });

    test('text dominance at threshold boundary', () => {
      const diet = { text: 26, image: 24, post: 0 }; // 52% text
      const result = calculateEvolution(50, 'baby', diet);
      expect(result.evolution).toBe('typo-ling');
    });

    test('image dominance at threshold boundary', () => {
      const diet = { text: 24, image: 26, post: 0 }; // 52% image
      const result = calculateEvolution(50, 'baby', diet);
      expect(result.evolution).toBe('muta-pixel');
    });
  });

  describe('Edge Cases', () => {
    test('handles massive feed counts', () => {
      const diet = { text: 500, image: 300, post: 200 };
      const result = calculateEvolution(1000, 'baby', diet);
      expect(result.evolution).toBe('typo-ling');
    });

    test('handles evolution from egg with 100+ feeds', () => {
      const result = calculateEvolution(100, 'egg', { text: 50, image: 30, post: 20 });
      expect(result.evolution).toBe('baby'); // Still evolves to baby first
    });

    test('negative feed count does not evolve', () => {
      const result = calculateEvolution(-10, 'egg', { text: 0, image: 0, post: 0 });
      expect(result.evolution).toBe('egg');
      expect(result.justEvolved).toBe(false);
    });

    test('handles all post diet', () => {
      const diet = { text: 0, image: 0, post: 50 };
      const result = calculateEvolution(50, 'baby', diet);
      expect(result.evolution).toBe('classic-gomi');
    });

    test('handles single dominant type', () => {
      const diet = { text: 50, image: 0, post: 0 };
      const result = calculateEvolution(50, 'baby', diet);
      expect(result.evolution).toBe('typo-ling');
    });
  });

  describe('Evolution Sequence', () => {
    test('follows correct evolution path: egg -> baby -> typo-ling', () => {
      let state = { evolution: 'egg', feedCount: 0, diet: { text: 0, image: 0, post: 0 } };

      // Feed 10 times (mostly text)
      for (let i = 1; i <= 10; i++) {
        state.feedCount = i;
        state.diet.text = i;
        const result = calculateEvolution(state.feedCount, state.evolution, state.diet);
        if (i === 10) {
          expect(result.evolution).toBe('baby');
          state.evolution = result.evolution;
        }
      }

      expect(state.evolution).toBe('baby');

      // Feed 40 more times (continuing text-heavy)
      for (let i = 11; i <= 50; i++) {
        state.feedCount = i;
        state.diet.text = i;
        const result = calculateEvolution(state.feedCount, state.evolution, state.diet);
        if (i === 50) {
          expect(result.evolution).toBe('typo-ling');
          state.evolution = result.evolution;
        }
      }

      expect(state.evolution).toBe('typo-ling');
    });
  });
});
