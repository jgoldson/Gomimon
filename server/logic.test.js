import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HIGH_THRESHOLD,
  LOW_THRESHOLD,
  MIN_WORDS,
  classifyJudgement,
  countWords,
  hashText,
  classifyCategoryJudgements,
  validateAnalysisInput
} from './logic.js';

const longHuman = 'I have been thinking about this for a while and wanted to explain what happened in a little more detail. The answer was not obvious to me, but the small details changed how I see the situation and what I would do next.';

test('normalizes and hashes equivalent text consistently', () => {
  assert.equal(hashText(' hello   world '), hashText('hello world'));
});

test('validates content type, word count, and truncation', () => {
  const result = validateAnalysisInput({ contentType: 'comment', text: longHuman });
  assert.equal(result.contentType, 'comment');
  assert.ok(result.words >= MIN_WORDS);
  assert.equal(result.truncated, false);
});

test('rejects invalid content input', () => {
  assert.throws(() => validateAnalysisInput({ contentType: 'post', text: '' }));
  assert.throws(() => validateAnalysisInput({ contentType: 'image', text: longHuman }));
});

test('uses the deterministic word gate instead of a model evidence veto', () => {
  const result = classifyJudgement({ aiProbability: HIGH_THRESHOLD });
  assert.equal(result.label, 'high');
  assert.equal(result.evidenceStatus, 'sufficient');
  assert.equal(result.evidenceProbability, null);
});

test('maps low, uncertain, and high probabilities', () => {
  assert.equal(classifyJudgement({ aiProbability: LOW_THRESHOLD - 0.01 }).label, 'low');
  assert.equal(classifyJudgement({ aiProbability: 0.5 }).label, 'uncertain');
  assert.equal(classifyJudgement({ aiProbability: HIGH_THRESHOLD }).label, 'high');
});

test('counts words without treating whitespace as content', () => {
  assert.equal(countWords('  one\n two\tthree '), 3);
  assert.equal(countWords(''), 0);
});

test('keeps the AI word gate while allowing short category checks', () => {
  const result = validateAnalysisInput({
    contentType: 'post',
    text: 'Election update',
    title: 'Election update',
    includeAi: true,
    categories: ['politics']
  });
  assert.equal(result.includeAi, false);
  assert.equal(result.aiInsufficient, true);
  assert.deepEqual(result.categoryIds, ['politics']);
});

test('isolates cache hashes by requested checks and normalized context', () => {
  const base = {
    contentType: 'post',
    text: 'A post with enough words to make a deterministic cache key while preserving the same authored content for comparison across requests.',
    includeAi: false,
    categories: ['politics']
  };
  const sameChecks = validateAnalysisInput({ ...base, categories: ['politics'] });
  const moreChecks = validateAnalysisInput({ ...base, categories: ['politics', 'sports'] });
  const differentContext = validateAnalysisInput({ ...base, subreddit: 'news' });
  assert.equal(sameChecks.contentHash, validateAnalysisInput({ ...base, categories: ['politics'] }).contentHash);
  assert.notEqual(sameChecks.contentHash, moreChecks.contentHash);
  assert.notEqual(sameChecks.contentHash, differentContext.contentHash);
});

test('validates category probabilities independently', () => {
  assert.deepEqual(
    classifyCategoryJudgements({ categoryIds: ['politics', 'sports'], categoryProbabilities: { politics: 0.9, sports: 0.1 } }),
    { politics: 0.9, sports: 0.1 }
  );
  assert.throws(() => classifyCategoryJudgements({ categoryIds: ['politics'], categoryProbabilities: { politics: 2 } }));
});

test('X has a 10-word authorship gate; Reddit retains 30 words', () => {
  for (const [platform, words, eligible] of [['x', 9, false], ['x', 10, true], ['reddit', 29, false], ['reddit', 30, true]]) {
    const input = validateAnalysisInput({ platform, contentType: 'post', text: 'word '.repeat(words) });
    assert.equal(input.includeAi, eligible, `${platform}: ${words}`);
    assert.equal(input.words, words);
  }
  assert.equal(validateAnalysisInput({ contentType: 'post', text: longHuman }).platform, 'reddit');
  for (const platform of ['facebook', '', ['x'], null]) {
    assert.throws(() => validateAnalysisInput({ platform, contentType: 'post', text: longHuman }), /platform/);
  }
});

test('quotes support categories without contributing to authored words or crossing cache contexts', () => {
  const base = { platform: 'x', contentType: 'post', text: '', quotedText: 'word '.repeat(40), categories: ['sports'] };
  const quoteOnly = validateAnalysisInput(base);
  assert.equal(quoteOnly.includeAi, false);
  assert.equal(quoteOnly.words, 0);
  assert.deepEqual(quoteOnly.categoryIds, ['sports']);
  assert.notEqual(quoteOnly.contentHash, validateAnalysisInput({ ...base, quotedText: 'Other quoted text' }).contentHash);
  assert.notEqual(quoteOnly.contentHash, validateAnalysisInput({ ...base, platform: 'reddit' }).contentHash);
  assert.equal(validateAnalysisInput({ ...base, text: 'Only my brief reaction' }).includeAi, false);
  for (const quotedText of [null, {}, ['quoted words']]) {
    assert.throws(() => validateAnalysisInput({ ...base, quotedText }), /quotedText/);
  }
});
