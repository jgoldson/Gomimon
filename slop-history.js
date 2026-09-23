export const HISTORY_KEY = 'slopHistoryV1';
export const HISTORY_LIMIT = 100;

export const HISTORY_CATEGORY_LABELS = { ai_content: 'AI', ads: 'Ad', politics: 'Politics', promotions: 'Promotion', ragebait: 'Ragebait', celebrity_gossip: 'Celebrity gossip', sports: 'Sports', crypto: 'Crypto' };

export function appendSlopHistory(history, { id, consumedAt, platform, excerpt, source, categories }) {
  const entries = Array.isArray(history) ? history : [];
  if (entries.some(entry => entry.id === id)) return entries;
  return [{
    id, consumedAt,
    categories: [...new Set(Array.isArray(categories) ? categories : [])].filter(category => Object.hasOwn(HISTORY_CATEGORY_LABELS, category)),
    platform: typeof platform === 'string' ? platform.slice(0, 80) : 'Web',
    excerpt: typeof excerpt === 'string' ? excerpt.replace(/\s+/g, ' ').trim().slice(0, 280) : '',
    source: source === 'manual' ? 'manual' : 'automatic'
  }, ...entries].slice(0, HISTORY_LIMIT);
}
