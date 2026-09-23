import { appendSlopHistory } from '../../slop-history.js';

test('keeps newest 100 meals and ignores repeated effect IDs', () => {
  let history = [];
  for (let i = 0; i < 105; i++) history = appendSlopHistory(history, { id: String(i), consumedAt: i, platform: 'reddit', source: 'automatic', excerpt: 'a meal' });
  expect(history).toHaveLength(100);
  expect(history[0].id).toBe('104');
  expect(history[99].id).toBe('5');
  expect(appendSlopHistory(history, { id: '104' })).toEqual(history);
});

test('bounds and normalizes local excerpts', () => {
  const [entry] = appendSlopHistory(null, { id: 'meal', excerpt: 'Hello\n  world ' + 'x'.repeat(400), source: 'category' });
  expect(entry.excerpt.startsWith('Hello world ')).toBe(true);
  expect(entry.excerpt).toHaveLength(280);
  expect(entry.source).toBe('automatic');
});

test('stores only known distinct categories and supports older unclassified meals', () => {
  expect(appendSlopHistory([], { id: '1', categories: ['ads', 'ai_content', 'sports', 'ads', '<script>', '__proto__'] })[0].categories).toEqual(['ads', 'ai_content', 'sports']);
  expect(appendSlopHistory([], { id: '2' })[0].categories).toEqual([]);
});
