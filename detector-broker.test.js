import test from 'node:test';
import assert from 'node:assert/strict';
import { createDetectorBroker } from './detector-broker.js';

function makeStorage(seed = {}) {
  const values = { ...seed };
  return {
    values,
    async get(key) {
      return { [key]: values[key] };
    },
    async set(items) {
      Object.assign(values, items);
    }
  };
}

function input(overrides = {}) {
  return {
    operationId: `operation-${Math.random().toString(36).slice(2)}`,
    itemKey: 'reddit-post-t3_shared',
    revision: 'reddit-detector-v2:revision-one',
    contentType: 'post',
    text: 'A sufficiently long post body that is used only by the mocked transport.',
    title: 'A title',
    body: 'A sufficiently long post body that is used only by the mocked transport.',
    includeAi: true,
    categories: [],
    ...overrides
  };
}

function scores(overrides = {}) {
  return {
    label: 'high',
    evidenceStatus: 'sufficient',
    aiProbability: 0.97,
    evidenceProbability: null,
    categoryProbabilities: {},
    truncated: false,
    model: 'jev-latest',
    rubricVersion: 'reddit-classifier-v1',
    ...overrides
  };
}

test('coalesces identical requests and stores scores without Reddit text', async () => {
  const storage = makeStorage();
  let requestCount = 0;
  const broker = createDetectorBroker({
    storage,
    getSessionNamespace: async () => 'account-hash',
    getServiceUrl: async () => 'https://detector.example',
    request: async () => {
      requestCount += 1;
      return { payload: scores(), requestId: 'http-1', serverRequestId: 'server-1' };
    }
  });

  const [first, second] = await Promise.all([
    broker.analyze(input({ operationId: 'one' })),
    broker.analyze(input({ operationId: 'two' }))
  ]);

  assert.equal(requestCount, 1);
  assert.equal(first.state, 'complete');
  assert.equal(second.state, 'complete');
  assert.equal(first.result.aiProbability, 0.97);
  assert.equal(second.operationId, 'two');
  assert.equal(storage.values.detectorScoreCacheV1.version, 1);
  assert.doesNotMatch(JSON.stringify(storage.values.detectorScoreCacheV1), /sufficiently long|A title/);

  const cached = await broker.analyze(input({ operationId: 'cached' }));
  assert.equal(cached.cached, true);
  assert.equal(requestCount, 1);
});

test('merges separately requested AI and category judgments for one revision', async () => {
  const storage = makeStorage();
  const requests = [];
  const broker = createDetectorBroker({
    storage,
    getSessionNamespace: async () => 'account-hash',
    getServiceUrl: async () => 'https://detector.example',
    request: async request => {
      requests.push({ includeAi: request.includeAi, categories: request.categories });
      return {
        payload: request.includeAi
          ? scores({ categoryProbabilities: {} })
          : scores({ label: null, aiProbability: null, categoryProbabilities: { politics: 0.96 } })
      };
    }
  });

  const category = await broker.analyze(input({
    operationId: 'category',
    includeAi: false,
    categories: ['politics']
  }));
  const ai = await broker.analyze(input({ operationId: 'ai', includeAi: true, categories: [] }));

  assert.deepEqual(requests, [
    { includeAi: false, categories: ['politics'] },
    { includeAi: true, categories: [] }
  ]);
  assert.equal(category.result.categoryProbabilities.politics, 0.96);
  assert.equal(ai.result.categoryProbabilities.politics, 0.96);
  assert.equal(ai.result.aiProbability, 0.97);
});

test('returns deferred when the shared background concurrency budget is full', async () => {
  const storage = makeStorage();
  let resolveFirst;
  const broker = createDetectorBroker({
    storage,
    maxConcurrent: 1,
    getSessionNamespace: async () => 'account-hash',
    getServiceUrl: async () => 'https://detector.example',
    request: () => new Promise(resolve => {
      resolveFirst = resolve;
    })
  });

  const first = broker.analyze(input({ operationId: 'first' }));
  await new Promise(resolve => setTimeout(resolve, 0));
  const deferred = await broker.analyze(input({
    operationId: 'second',
    itemKey: 'reddit-post-t3_other'
  }));

  assert.equal(deferred.state, 'deferred');
  assert.equal(deferred.reason, 'concurrency');
  resolveFirst({ payload: scores() });
  const completed = await first;
  assert.equal(completed.state, 'complete');
});

test('sign-out cancellation prevents a late response from repopulating the cache', async () => {
  const storage = makeStorage();
  let resolveRequest;
  const broker = createDetectorBroker({
    storage,
    getSessionNamespace: async () => 'account-hash',
    getServiceUrl: async () => 'https://detector.example',
    request: () => new Promise(resolve => {
      resolveRequest = resolve;
    })
  });
  const pending = broker.analyze(input({ operationId: 'late' }));
  await new Promise(resolve => setTimeout(resolve, 0));
  broker.cancelAll('signed_out');
  await assert.rejects(pending, error => error.code === 'UNAUTHENTICATED');
  resolveRequest({ payload: scores() });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(storage.values.detectorScoreCacheV1, undefined);
});

test('platform and quoted content isolate scores even with an identical supplied revision', async () => {
  let count = 0;
  const storage = makeStorage();
  const broker = createDetectorBroker({ storage, getSessionNamespace: async () => 'account', getServiceUrl: async () => 'https://example.com', request: async () => { count++; return { payload: scores() }; } });
  for (const overrides of [{ platform: 'reddit' }, { platform: 'x' }, { platform: 'x', quotedText: 'A different quote' }]) await broker.analyze(input(overrides));
  assert.equal(count, 3);
  const cached = await broker.analyze(input({ platform: 'x', quotedText: 'A different quote' }));
  assert.equal(cached.cached, true);
  assert.equal(count, 3);
  assert.doesNotMatch(JSON.stringify(storage.values), /A different quote/);
});
