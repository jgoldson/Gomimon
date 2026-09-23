import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { RUBRIC_VERSION } from './logic.js';

const sampleText = 'I have been thinking about this for a while and wanted to explain what happened in a little more detail. The answer was not obvious to me, but the small details changed how I see the situation and what I would do next.';

class FakeDb {
  constructor() {
    this.cache = null;
    this.used = 0;
    this.released = 0;
    this.profile = null;
    this.nameModeration = null;
    this.mealIds = new Set();
  }

  async findAccountBySession(token) {
    return token === 'valid-token'
      ? { id: 1, public_key: 'account-key-1', email: 'test@example.com', display_name: 'Test User' }
      : null;
  }

  async getUsage() {
    return { used: this.used, remaining: 100 - this.used, limit: 100, resetAt: '2026-09-21T00:00:00.000Z' };
  }

  async getCachedAnalysis() {
    return this.cache;
  }

  async reserveCheck() {
    this.used += 1;
    return { used: this.used, remaining: 100 - this.used };
  }

  async insertAnalysis({ result }) {
    this.cache = {
      label: result.label,
      evidence_status: result.evidenceStatus,
      ai_probability: result.aiProbability,
      evidence_probability: result.evidenceProbability,
      category_probabilities: result.categoryProbabilities || {},
      truncated: result.truncated,
      model: result.model,
      rubric_version: result.rubricVersion
    };
  }

  async releaseCheck() {
    this.used -= 1;
    this.released += 1;
  }

  async revokeSession() {}
  async deleteAccount() {}
  async getGomimonProfile() { return this.profile; }
  async isGomimonNameAvailable(accountId, nameKey) { return nameKey !== 'taken'; }
  async getNameModeration() { return this.nameModeration; }
  async putNameModeration(value) { this.nameModeration = value; }
  async reserveGomimonName(accountId, { name }) {
    this.profile = {
      name,
      leaderboardEnabled: this.profile?.leaderboardEnabled || false,
      lifetimeMeals: this.profile?.lifetimeMeals || 0,
      legacyImported: this.profile?.legacyImported || false,
      evolution: this.profile?.evolution || 'baby',
      joinedAt: this.profile?.joinedAt || null
    };
    return this.profile;
  }
  async joinLeaderboard(accountId, { feedCount, evolution }) {
    if (!this.profile) {
      const error = new Error('profile required');
      error.code = 'PROFILE_REQUIRED';
      throw error;
    }
    if (!this.profile.legacyImported) this.profile.lifetimeMeals += feedCount;
    Object.assign(this.profile, {
      leaderboardEnabled: true,
      legacyImported: true,
      evolution,
      joinedAt: this.profile.joinedAt || '2026-09-22T00:00:00.000Z'
    });
    return this.profile;
  }
  async leaveLeaderboard() {
    if (!this.profile) return null;
    this.profile.leaderboardEnabled = false;
    return this.profile;
  }
  async recordMealEvents(accountId, events) {
    if (!this.profile?.leaderboardEnabled) {
      const error = new Error('not joined');
      error.code = 'LEADERBOARD_NOT_JOINED';
      throw error;
    }
    let accepted = 0;
    for (const event of events) {
      if (!this.mealIds.has(event.id)) {
        this.mealIds.add(event.id);
        accepted += 1;
      }
    }
    this.profile.lifetimeMeals += accepted;
    return { accepted, duplicates: events.length - accepted, lifetimeMeals: this.profile.lifetimeMeals };
  }
  async getLeaderboard() {
    return this.profile?.leaderboardEnabled
      ? [{ rank: 1, name: this.profile.name, evolution: this.profile.evolution, meals: this.profile.lifetimeMeals }]
      : [];
  }
  async getLeaderboardRank() {
    return (await this.getLeaderboard())[0] || null;
  }
}

async function startApp(db, evaluate) {
  const server = createServer(createApp({ db, evaluate }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    server,
    request: (path, options = {}) => fetch(`http://127.0.0.1:${port}${path}`, options)
  };
}

let runningServer;
afterEach(async () => {
  if (runningServer) {
    await new Promise(resolve => runningServer.close(resolve));
    runningServer = undefined;
  }
});

test('reports database-backed health', async () => {
  const db = new FakeDb();
  const app = await startApp(db, async () => { throw new Error('should not run'); });
  runningServer = app.server;
  const response = await app.request('/healthz');
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
});

test('allows the detector correlation header through CORS', async () => {
  const db = new FakeDb();
  const app = await startApp(db, async () => { throw new Error('should not run'); });
  runningServer = app.server;
  const response = await app.request('/v1/analyze', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://example.chromiumapp.org',
      'Access-Control-Request-Headers': 'authorization,content-type,x-gomimon-request-id'
    }
  });
  assert.equal(response.status, 204);
  assert.match(response.headers.get('access-control-allow-headers'), /X-GomiMon-Request-ID/);
});

test('rejects detector requests without a session', async () => {
  const db = new FakeDb();
  const app = await startApp(db, async () => { throw new Error('should not run'); });
  runningServer = app.server;
  const response = await app.request('/v1/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType: 'post', text: sampleText })
  });
  assert.equal(response.status, 401);
});

test('serves the public leaderboard without a session', async () => {
  const db = new FakeDb();
  db.profile = {
    name: 'Byte Goblin', leaderboardEnabled: true, lifetimeMeals: 12,
    legacyImported: true, evolution: 'baby', joinedAt: '2026-09-22T00:00:00.000Z'
  };
  const app = await startApp(db, async () => { throw new Error('should not run'); });
  runningServer = app.server;
  const response = await app.request('/v1/leaderboard?period=all_time');
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(body.entries[0].name, 'Byte Goblin');
});

test('moderates and reserves a globally unique GomiMon name', async () => {
  const db = new FakeDb();
  let moderationCalls = 0;
  const app = await startApp(db, async () => { throw new Error('should not run'); });
  runningServer = app.server;
  // Replace the server so this test can inject the name judgement separately.
  await new Promise(resolve => runningServer.close(resolve));
  const moderated = createServer(createApp({
    db,
    evaluate: async () => { throw new Error('should not run'); },
    moderateName: async () => {
      moderationCalls += 1;
      return { allowed: true, appropriateProbability: 0.98, model: 'jev-test' };
    }
  }));
  await new Promise(resolve => moderated.listen(0, '127.0.0.1', resolve));
  runningServer = moderated;
  const base = `http://127.0.0.1:${moderated.address().port}`;
  const response = await fetch(`${base}/v1/gomimon/name`, {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '  Byte   Goblin  ' })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.gomimon.name, 'Byte Goblin');
  assert.equal(moderationCalls, 1);
});

test('rejects a name when the semantic safety check does not pass', async () => {
  const db = new FakeDb();
  const server = createServer(createApp({
    db,
    evaluate: async () => { throw new Error('should not run'); },
    moderateName: async () => ({ allowed: false, appropriateProbability: 0.2, model: 'jev-test' })
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  runningServer = server;
  const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/gomimon/name`, {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Sneaky Name' })
  });
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error, 'NAME_NOT_ALLOWED');
});

test('returns NAME_CHECK_UNAVAILABLE without reserving a profile', async () => {
  const db = new FakeDb();
  const server = createServer(createApp({
    db,
    evaluate: async () => { throw new Error('should not run'); },
    moderateName: async () => { throw new Error('provider timeout'); }
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  runningServer = server;
  const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/gomimon/name`, {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Cloud Muncher' })
  });
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error, 'NAME_CHECK_UNAVAILABLE');
  assert.equal(db.profile, null);
});

test('reuses cached name moderation without another model request', async () => {
  const db = new FakeDb();
  let moderationCalls = 0;
  const server = createServer(createApp({
    db,
    evaluate: async () => { throw new Error('should not run'); },
    moderateName: async () => {
      moderationCalls += 1;
      return { allowed: true, appropriateProbability: 0.99, model: 'jev-test' };
    }
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  runningServer = server;
  const url = `http://127.0.0.1:${server.address().port}/v1/gomimon/name`;
  const options = {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Cache Critter' })
  };
  assert.equal((await fetch(url, options)).status, 200);
  assert.equal((await fetch(url, options)).status, 200);
  assert.equal(moderationCalls, 1);
});

test('throttles repeated uncached name moderation attempts per account', async () => {
  const db = new FakeDb();
  db.putNameModeration = async () => {};
  const server = createServer(createApp({
    db,
    evaluate: async () => { throw new Error('should not run'); },
    moderateName: async () => ({ allowed: true, appropriateProbability: 0.99, model: 'jev-test' })
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  runningServer = server;
  const url = `http://127.0.0.1:${server.address().port}/v1/gomimon/name`;
  const request = name => fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  for (let index = 0; index < 5; index += 1) {
    assert.equal((await request(`Critter ${index}`)).status, 200);
  }
  const response = await request('Critter 6');
  const body = await response.json();
  assert.equal(response.status, 429);
  assert.equal(body.error, 'NAME_CHECK_THROTTLED');
});

test('imports legacy progress once and deduplicates meal events', async () => {
  const db = new FakeDb();
  db.profile = {
    name: 'Trash Panda', leaderboardEnabled: false, lifetimeMeals: 0,
    legacyImported: false, evolution: 'baby', joinedAt: null
  };
  const app = await startApp(db, async () => { throw new Error('should not run'); });
  runningServer = app.server;
  const headers = { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' };
  const join = () => app.request('/v1/leaderboard/join', {
    method: 'POST', headers, body: JSON.stringify({ feedCount: 9, evolution: 'baby' })
  });
  assert.equal((await join()).status, 200);
  assert.equal((await join()).status, 200);
  assert.equal(db.profile.lifetimeMeals, 9);
  const meal = { events: [{ id: 'meal-event-0001', foodType: 'post', evolution: 'baby' }] };
  await app.request('/v1/leaderboard/meals', { method: 'POST', headers, body: JSON.stringify(meal) });
  const duplicate = await app.request('/v1/leaderboard/meals', { method: 'POST', headers, body: JSON.stringify(meal) });
  const body = await duplicate.json();
  assert.equal(body.duplicates, 1);
  assert.equal(db.profile.lifetimeMeals, 10);
});

test('returns insufficient for short content without consuming quota', async () => {
  const db = new FakeDb();
  const app = await startApp(db, async () => { throw new Error('should not run'); });
  runningServer = app.server;
  const response = await app.request('/v1/analyze', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType: 'comment', text: 'Too short to assess.' })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.label, 'insufficient');
  assert.equal(db.used, 0);
});

test('returns reset metadata when the account quota is exhausted', async () => {
  const db = new FakeDb();
  db.reserveCheck = async () => {
    const error = new Error('Daily analysis limit reached');
    error.code = 'ACCOUNT_QUOTA_EXCEEDED';
    throw error;
  };
  const app = await startApp(db, async () => { throw new Error('should not run'); });
  runningServer = app.server;
  const response = await app.request('/v1/analyze', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType: 'post', text: sampleText })
  });
  const body = await response.json();
  assert.equal(response.status, 429);
  assert.equal(body.error, 'QUOTA_EXCEEDED');
  assert.equal(body.scope, 'account');
  assert.equal(body.quota.limit, 100);
  assert.equal(body.resetAt, '2026-09-21T00:00:00.000Z');
  assert.equal(body.requestId, body.serverRequestId);
});

test('evaluates once and serves the second request from cache', async () => {
  const db = new FakeDb();
  let evaluations = 0;
  const app = await startApp(db, async () => {
    evaluations += 1;
    return {
      label: 'high',
      evidenceStatus: 'sufficient',
      aiProbability: 0.96,
      evidenceProbability: 0.9,
      truncated: false,
      model: 'jev-latest',
      rubricVersion: RUBRIC_VERSION
    };
  });
  runningServer = app.server;
  const options = {
    method: 'POST',
    headers: {
      Authorization: 'Bearer valid-token',
      'Content-Type': 'application/json',
      'X-GomiMon-Request-ID': 'debug-test-123'
    },
    body: JSON.stringify({ contentType: 'post', text: sampleText })
  };
  const first = await app.request('/v1/analyze', options);
  const second = await app.request('/v1/analyze', options);
  const firstBody = await first.json();
  const secondBody = await second.json();
  assert.equal(firstBody.label, 'high');
  assert.equal(first.headers.get('x-gomimon-request-id'), 'debug-test-123');
  assert.equal(secondBody.cached, true);
  assert.equal(evaluations, 1);
  assert.equal(db.used, 1);
});

test('deduplicates concurrent requests for the same account and content', async () => {
  const db = new FakeDb();
  let evaluations = 0;
  const app = await startApp(db, async () => {
    evaluations += 1;
    await new Promise(resolve => setTimeout(resolve, 15));
    return {
      label: 'low',
      evidenceStatus: 'sufficient',
      aiProbability: 0.08,
      evidenceProbability: 0.92,
      truncated: false,
      model: 'jev-1.13.0',
      rubricVersion: RUBRIC_VERSION
    };
  });
  runningServer = app.server;
  const makeOptions = () => ({
    method: 'POST',
    headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType: 'comment', text: sampleText })
  });

  const [first, second] = await Promise.all([
    app.request('/v1/analyze', makeOptions()),
    app.request('/v1/analyze', makeOptions())
  ]);
  const firstBody = await first.json();
  const secondBody = await second.json();
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(evaluations, 1);
  assert.equal(db.used, 1);
  assert.ok(firstBody.cached === false || secondBody.cached === false);
  assert.ok(firstBody.cached === true || secondBody.cached === true);
});

test('releases quota when TypeSafe fails', async () => {
  const db = new FakeDb();
  const app = await startApp(db, async () => { throw new Error('provider failed'); });
  runningServer = app.server;
  const response = await app.request('/v1/analyze', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType: 'post', text: sampleText })
  });
  assert.equal(response.status, 502);
  assert.equal(db.used, 0);
  assert.equal(db.released, 1);
});

test('runs category-only checks for short posts and batches requested categories', async () => {
  const db = new FakeDb();
  let received;
  let evaluations = 0;
  const app = await startApp(db, async input => {
    evaluations += 1;
    received = input;
    return {
      label: null,
      evidenceStatus: 'unrequested',
      aiProbability: null,
      evidenceProbability: null,
      categoryProbabilities: { politics: 0.97, sports: 0.04 },
      truncated: false,
      model: 'jev-latest',
      rubricVersion: RUBRIC_VERSION
    };
  });
  runningServer = app.server;
  const response = await app.request('/v1/analyze', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contentType: 'post',
      text: 'Election update',
      title: 'Election update',
      body: '',
      includeAi: false,
      categories: ['sports', 'politics']
    })
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(received.includeAi, false);
  assert.deepEqual(received.categoryIds, ['politics', 'sports']);
  assert.equal(result.label, null);
  assert.equal(result.categoryProbabilities.politics, 0.97);
  assert.equal(db.used, 1);

  const cachedResponse = await app.request('/v1/analyze', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contentType: 'post',
      text: 'Election update',
      title: 'Election update',
      includeAi: false,
      categories: ['politics', 'sports']
    })
  });
  const cached = await cachedResponse.json();
  assert.equal(cached.cached, true);
  assert.equal(cached.categoryProbabilities.sports, 0.04);
  assert.equal(evaluations, 1);
});

test('passes X authored text and quote context through the authenticated API', async () => {
  const db = new FakeDb(); let observed;
  const app = await startApp(db, async input => {
    observed = input;
    return { label: 'low', evidenceStatus: 'sufficient', aiProbability: .1, categoryProbabilities: { sports: .99 }, truncated: false, model: 'jev-latest', rubricVersion: RUBRIC_VERSION };
  });
  runningServer = app.server;
  const text = 'Here are ten authored words for checking our new detector.';
  const response = await app.request('/v1/analyze', {
    method: 'POST', headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform: 'x', contentType: 'post', text, quotedText: 'A sports team won the match.', categories: ['sports'] })
  });
  assert.equal(response.status, 200);
  assert.equal(observed.platform, 'x'); assert.equal(observed.words, 10);
  assert.equal(observed.includeAi, true); assert.equal(observed.text, text);
  assert.equal(observed.quotedText, 'A sports team won the match.');
});

test('rejects invalid platforms before inference or quota and accepts quote-only categories', async () => {
  const db = new FakeDb(); let observed;
  const app = await startApp(db, async input => {
    observed = input;
    return { label: 'insufficient', evidenceStatus: 'insufficient', aiProbability: null, categoryProbabilities: { sports: .99 }, truncated: false, model: 'jev-latest', rubricVersion: RUBRIC_VERSION };
  });
  runningServer = app.server;
  const request = body => app.request('/v1/analyze', { method: 'POST', headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const bad = await request({ platform: 'facebook', contentType: 'post', text: sampleText });
  assert.equal(bad.status, 400); assert.equal(observed, undefined); assert.equal(db.used, 0);
  const quote = await request({ platform: 'x', contentType: 'post', text: '', quotedText: sampleText, categories: ['sports'] });
  assert.equal(quote.status, 200); assert.equal(observed.includeAi, false); assert.equal(observed.words, 0);
});


test('server capacity is distinguishable from an account upgrade limit', async () => {
  const db = new FakeDb();
  db.reserveCheck = async () => { throw Object.assign(new Error('Server capacity reached'), { code: 'SERVER_QUOTA_EXCEEDED' }); };
  const app = await startApp(db, async () => { throw new Error('should not run'); });
  runningServer = app.server;
  const response = await app.request('/v1/analyze', { method: 'POST',
    headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType: 'post', text: sampleText }) });
  const body = await response.json();
  assert.equal(response.status, 429); assert.equal(body.error, 'QUOTA_EXCEEDED');
  assert.equal(body.scope, 'server'); assert.equal(body.quota.remaining, 100);
});
