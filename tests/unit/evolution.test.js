import { calculateEvolution, buildFeedUpdate } from '../../feed-logic.js';

const diet = { text: 800, image: 100, post: 100 };

describe('Evolution progression', () => {
  test.each([
    [9, 'egg', 'egg', false], [10, 'egg', 'baby', true],
    [99, 'baby', 'baby', false], [100, 'baby', 'bubble-gomi', true],
    [999, 'bubble-gomi', 'bubble-gomi', false],
    [1000, 'bubble-gomi', 'nimbus-gomi', true],
    [1001, 'nimbus-gomi', 'nimbus-gomi', false],
    [1000, 'baby', 'bubble-gomi', true], [1000, 'egg', 'baby', true],
    [-1, 'egg', 'egg', false]
  ])('%i meals: %s → %s', (count, current, evolution, justEvolved) => {
    expect(calculateEvolution(count, current, diet)).toEqual({ evolution, justEvolved });
  });

  test.each(['typo-ling', 'muta-pixel', 'classic-gomi', 'null-sprite'])(
    'preserves existing %s pets', evolution => {
      expect(calculateEvolution(2000, evolution, diet)).toEqual({ evolution, justEvolved: false });
    });

  test.each([{ text: 1000, image: 0, post: 0 }, { text: 0, image: 1000, post: 0 },
    { text: 0, image: 0, post: 1000 }, { text: 0, image: 0, post: 0 }])(
    'all diets reach the animated adult', diet => {
      expect(calculateEvolution(1000, 'bubble-gomi', diet).evolution).toBe('nimbus-gomi');
    });

  test('feeding through 1000 meals visits every stage exactly once', () => {
    let stats = { hunger: 100, glitch: 0, evolution: 'egg', feedCount: 0,
      diet: { text: 0, image: 0, post: 0 } };
    const milestones = [];
    for (let count = 1; count <= 1001; count++) {
      const result = buildFeedUpdate(stats, 'post', 'automatic');
      stats = { ...stats, ...result.updates };
      if (result.justEvolved) milestones.push([count, result.evolution]);
    }
    expect(milestones).toEqual([[10, 'baby'], [100, 'bubble-gomi'], [1000, 'nimbus-gomi']]);
  });
});
