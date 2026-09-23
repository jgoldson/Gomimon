import test from 'node:test';
import assert from 'node:assert/strict';
import './detector/revision.js';
import './detector/store.js';
import './detector/policy.js';
import './detector/scheduler.js';

const { createPostStore } = globalThis.GomiMonDetectorModules.store;
const { evaluatePolicy, requestedJudgements } = globalThis.GomiMonDetectorModules.policy;
const { createScheduler } = globalThis.GomiMonDetectorModules.scheduler;

function snapshot(overrides = {}) {
  return {
    key: 'reddit-post-t3_one',
    contentType: 'post',
    text: 'A long enough stable snapshot for deterministic detector state tests.',
    title: 'A title',
    body: 'A long enough stable snapshot for deterministic detector state tests.',
    subreddit: 'r/test',
    flair: '',
    truncated: false,
    wordCount: 40,
    extractionStatus: 'ready',
    extractionMethod: 'post-title-body',
    isRedditAd: false,
    isDiscussionPage: false,
    ...overrides
  };
}

test('remounted views reuse the score for the same immutable revision', () => {
  const store = createPostStore({ now: (() => { let value = 0; return () => ++value; })() });
  const record = store.upsert(snapshot({ revision: 'revision-one' }));
  const firstView = {};
  const secondView = {};
  store.attachView(record.key, firstView);
  assert.equal(store.commitScores(record.key, 'revision-one', {
    label: 'high',
    aiProbability: 0.98,
    categoryProbabilities: {}
  }), true);

  store.detachView(record.key, firstView);
  store.upsert(snapshot({ revision: 'revision-one' }));
  store.attachView(record.key, secondView);
  const remounted = store.get(record.key);
  assert.equal(remounted.scores.aiProbability, 0.98);
  assert.equal(remounted.views.size, 1);
});

test('a changed revision rejects an old result and requests only missing judgments', () => {
  const store = createPostStore();
  const record = store.upsert(snapshot({ revision: 'revision-one' }));
  store.commitScores(record.key, 'revision-one', {
    label: 'high',
    aiProbability: 0.98,
    categoryProbabilities: { politics: 0.96 }
  });
  const changed = store.upsert(snapshot({ revision: 'revision-two', text: 'A changed snapshot with a different canonical assessment input.', wordCount: 35 }));

  assert.equal(changed.scores, null);
  assert.equal(store.commitScores(record.key, 'revision-one', {
    label: 'low',
    aiProbability: 0.01,
    categoryProbabilities: {}
  }), false);
  assert.deepEqual(requestedJudgements(changed, {
    mode: 'automatic',
    categories: ['politics'],
    categoryStrength: 'conservative'
  }), { includeAi: true, categories: ['politics'] });
});

test('policy keeps pending and errors visible, then hides only a qualifying score', () => {
  const record = {
    key: 'reddit-post-t3_policy',
    contentType: 'post',
    extractionStatus: 'ready',
    snapshot: { wordCount: 40, isDiscussionPage: false, isRedditAd: false },
    scores: null,
    override: false,
    manualHidden: false
  };
  const settings = { mode: 'automatic', sensitivity: 'strict', categories: [], categoryStrength: 'conservative' };
  assert.equal(evaluatePolicy(record, settings).action, 'show');
  record.analysisStatus = 'unavailable';
  assert.equal(evaluatePolicy(record, settings).action, 'show');
  record.scores = { aiProbability: 0.97, categoryProbabilities: {} };
  assert.equal(evaluatePolicy(record, settings).action, 'hide');
  record.override = true;
  assert.equal(evaluatePolicy(record, settings).reason, 'user_override');
});

test('explicit Reddit ads are blocked without text or scores while respecting settings and overrides', () => {
  const settings = { mode: 'manual', categories: ['reddit_ads'] };
  for (const extractionStatus of ['ready', 'settling', 'unsupported', 'empty']) {
    const record = createPostStore().upsert(snapshot({ isRedditAd: true, extractionStatus }));
    assert.equal(evaluatePolicy(record, settings).reason, 'ad');
    assert.equal(evaluatePolicy(record, { ...settings, categories: [] }).action, 'show');
    record.override = true;
    assert.equal(evaluatePolicy(record, settings).reason, 'user_override');
  }
  const discussionAd = createPostStore().upsert(snapshot({ isRedditAd: true, isDiscussionPage: true }));
  assert.equal(evaluatePolicy(discussionAd, settings).action, 'show');
});

test('cancelling deferred work returns the record to an idle-owned state', async () => {
  const dropped = [];
  const scheduler = createScheduler({
    setTimer: (callback, delay) => setTimeout(callback, delay),
    clearTimer: timer => clearTimeout(timer),
    execute: async () => ({ state: 'deferred', retryAt: Date.now() + 10000, reason: 'capacity' }),
    canRun: () => true,
    onDrop: (job, reason) => dropped.push({ job, reason })
  });

  scheduler.enqueue({
    itemKey: 'reddit-post-t3_deferred',
    revision: 'revision-one',
    contentType: 'post',
    includeAi: true,
    categories: [],
    source: 'automatic'
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  scheduler.cancelItem('reddit-post-t3_deferred', 'out_of_view');
  assert.equal(scheduler.diagnostics().deferred, 0);
  assert.equal(dropped.at(-1).reason, 'out_of_view');
});

test('platform registry and policy agree on AI eligibility independently of quotes', async () => {
  await import('./platforms.js');
  const { PLATFORM_MIN_WORDS } = await import('./server/logic.js');
  for (const [platform, minimum] of Object.entries(PLATFORM_MIN_WORDS)) {
    assert.equal(globalThis.GomiMonPlatforms.registry[platform].minAiWords, minimum);
    for (const words of [minimum - 1, minimum]) {
      const record = createPostStore().upsert(snapshot({ platform, wordCount: words, quotedText: 'quote '.repeat(100) }));
      const request = requestedJudgements(record, { mode: 'automatic', categories: ['sports'] });
      assert.equal(request.includeAi, words >= minimum);
      assert.deepEqual(request.categories, ['sports']);
    }
  }
});

test('short title-only subreddit posts still request politics classification', () => {
  const store = createPostStore();
  const record = store.upsert(snapshot({ body: '', wordCount: 23, extractionMethod: 'post-title' }));
  assert.deepEqual(requestedJudgements(record, { mode: 'manual', categories: ['politics'] }), {
    includeAi: false, categories: ['politics']
  });
});

test('meal history retains manual AI and ad evidence despite show overrides', () => {
  const { historyCategories } = globalThis.GomiMonDetectorModules.policy;
  const settings = { mode: 'manual', categories: [], sensitivity: 'strict' };
  const ai = { snapshot: snapshot(), scores: { label: 'high', aiProbability: .98 }, override: true };
  assert.deepEqual(historyCategories(ai, settings, evaluatePolicy(ai, settings)), ['ai_content']);
  const ad = { snapshot: snapshot({ isAd: true }), override: true };
  assert.deepEqual(historyCategories(ad, settings, evaluatePolicy(ad, settings)), ['ads']);
  assert.deepEqual(historyCategories({ snapshot: snapshot() }, settings), []);
});

test('quota restoration resumes account-deferred manual checks but preserves server waits', async () => {
  const timers = new Map(); let timerId = 0; const calls = [], completed = [], deferred = [];
  let restored = false;
  const scheduler = createScheduler({ canRun: () => true,
    setTimer(fn) { timers.set(++timerId, fn); return timerId; }, clearTimer(id) { timers.delete(id); },
    async execute(job) { calls.push(job.itemKey); if (restored) return { result: 'ok' };
      throw Object.assign(new Error('Quota'), { code: 'QUOTA_EXCEEDED', scope: job.itemKey, resetAt: new Date(Date.now() + 86400000).toISOString() }); },
    onComplete: job => completed.push(job.itemKey), onDeferred: (job, outcome) => deferred.push(outcome)
  });
  scheduler.enqueue({ itemKey: 'account', revision: '1', source: 'manual' });
  scheduler.enqueue({ itemKey: 'server', revision: '1', source: 'manual' });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(deferred.length, 2); restored = true; scheduler.resumeAccountQuotaDeferred();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(completed, ['account']); assert.equal(calls.filter(x => x === 'server').length, 1);
  assert.equal(scheduler.diagnostics().deferred, 1); scheduler.cancelAll();
});
