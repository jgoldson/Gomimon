import {
  BUBBLE_TO_ADULT_FEEDS,
  BABY_TO_BUBBLE_FEEDS,
  EGG_TO_BABY_FEEDS,
  GLITCH_INCREASE_PER_FEED,
  HUNGER_INCREASE_PER_FEED
} from './constants.js';

// The feed calculation is shared by manual and automatic meals so their pet
// behavior cannot drift apart.
export function calculateEvolution(feedCount, currentEvolution, diet) {
  if (feedCount >= EGG_TO_BABY_FEEDS && currentEvolution === 'egg') {
    return { evolution: 'baby', justEvolved: true };
  }

  // Advance one stage per meal, even for imported high-count pets.
  if (feedCount >= BABY_TO_BUBBLE_FEEDS && currentEvolution === 'baby') {
    return { evolution: 'bubble-gomi', justEvolved: true };
  }
  if (feedCount >= BUBBLE_TO_ADULT_FEEDS && currentEvolution === 'bubble-gomi') {
    return { evolution: 'nimbus-gomi', justEvolved: true };
  }

  return { evolution: currentEvolution, justEvolved: false };
}

export function buildFeedUpdate(stats, foodType, source = 'manual') {
  const diet = { ...stats.diet };
  diet[foodType] = (diet[foodType] || 0) + 1;
  const feedCount = stats.feedCount + 1;
  const { evolution, justEvolved } = calculateEvolution(feedCount, stats.evolution, diet);

  return {
    updates: {
      hunger: Math.min(100, stats.hunger + HUNGER_INCREASE_PER_FEED),
      glitch: source === 'automatic' || source === 'category'
        ? stats.glitch
        : Math.min(100, stats.glitch + GLITCH_INCREASE_PER_FEED),
      feedCount,
      diet,
      evolution
    },
    evolution,
    justEvolved
  };
}
