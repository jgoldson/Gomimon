import { DEFAULT_STATS, DEFAULT_DETECTOR_SETTINGS } from '../../constants.js';
let stored, listener;
const sender = (url = 'https://x.com/home', tabId = 1) => ({ tab: { id: tabId, url }, url, frameId: 0 });
const dispatch = (message, origin = sender()) => new Promise(resolve => listener(message, origin, resolve));
beforeEach(async () => {
  jest.resetModules(); jest.useFakeTimers();
  stored = { ...DEFAULT_STATS, evolution: 'baby', onboardingStage: 'complete', detectorSettings: { ...DEFAULT_DETECTOR_SETTINGS }, detectorSessionToken: 'test-session' };
  chrome.storage.local.get.mockImplementation(async keys => typeof keys === 'string' ? { [keys]: stored[keys] } : { ...keys, ...stored });
  chrome.storage.local.set.mockImplementation(async values => Object.assign(stored, values));
  chrome.storage.local.remove.mockImplementation(async key => { delete stored[key]; });
  chrome.tabs.sendMessage = jest.fn(async () => ({ success: true }));
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, headers: { get: () => 'request-test' }, json: async () => ({ label: 'low', aiProbability: .1, categoryProbabilities: {}, quota: {} }) }));
  await import('../../background.js');
  listener = chrome.runtime.onMessage.addListener.mock.calls.at(-1)[0];
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test('only matching enabled platform senders can analyze', async () => {
  const request = { type: 'ANALYZE_CONTENT', platform: 'x', contentType: 'post', text: 'word '.repeat(10), quotedText: 'A quoted post', includeAi: true, categories: [] };
  for (const origin of [sender('https://example.com/home'), sender('https://reddit.com/'), sender('https://x.com/search'), { ...sender(), frameId: 1 }]) {
    const response = await dispatch(request, origin);
    expect(response.error.code).toBe('INVALID_SENDER');
  }
  expect(fetch).not.toHaveBeenCalled();
  const valid = await dispatch(request);
  expect(valid.success).toBe(true);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ platform: 'x', quotedText: 'A quoted post' });
  stored.detectorSettings.enabledPlatforms = ['reddit'];
  expect((await dispatch(request)).error.code).toBe('PLATFORM_DISABLED');
});

test('rejects empty platform settings and preserves the saved selection', async () => {
  const result = await dispatch({ type: 'SET_DETECTOR_SETTINGS', settings: { enabledPlatforms: [] } });
  expect(result.success).toBe(false);
  expect(result.error.message).toBe('Choose at least one platform.');
  expect(stored.detectorSettings.enabledPlatforms).toEqual(['reddit', 'x']);
});

test('automatic meals are deduplicated across X tabs and changed effect IDs', async () => {
  const request = { type: 'FEED_CONTENT', platform: 'x', itemKey: 'x-post-100', source: 'automatic', effectId: 'one', excerpt: 'A consumed post', categories: ['ads'] };
  const first = await dispatch(request);
  expect(first.success).toBe(true);
  expect(stored.feedCount).toBe(1);
  const again = await dispatch({ ...request, effectId: 'two' }, sender('https://x.com/home', 2));
  expect(again.deduplicated).toBe(true);
  expect(stored.slopHistoryV1).toHaveLength(1);
  expect(stored.slopHistoryV1[0]).toMatchObject({ excerpt: 'A consumed post', platform: 'x', source: 'automatic', categories: ['ads'] });
  expect(stored.feedCount).toBe(1);
});

test('queues and idempotently syncs leaderboard meals without blocking a feed', async () => {
  stored.leaderboardStateV1 = {
    accountKey: 'account-key-1', enabled: true, profileName: 'TestGomi'
  };
  global.fetch.mockImplementation(async url => ({
    ok: true,
    status: 200,
    headers: { get: () => 'request-test' },
    json: async () => url.includes('/v1/leaderboard/meals')
      ? { accepted: 1, duplicates: 0, lifetimeMeals: 1 }
      : { label: 'low', aiProbability: .1, categoryProbabilities: {}, quota: {} }
  }));
  const response = await dispatch({
    type: 'FEED_CONTENT', platform: 'x', itemKey: 'ranked-post', source: 'manual', effectId: 'meal-effect-0001'
  });
  expect(response.success).toBe(true);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  const request = fetch.mock.calls.find(([url]) => url.includes('/v1/leaderboard/meals'));
  expect(request).toBeDefined();
  expect(JSON.parse(request[1].body).events[0]).toMatchObject({
    id: 'meal-effect-0001', foodType: 'text', evolution: 'baby'
  });
  expect(stored.leaderboardPendingMealsV1['account-key-1']).toEqual([]);
});

test('hatching requires and stores a locally valid GomiMon name', async () => {
  Object.assign(stored, { evolution: 'egg', petName: '', onboardingStage: 'hatch' });
  expect((await dispatch({ type: 'HATCH_PET', petName: '!' }, {})).success).toBe(false);
  const response = await dispatch({ type: 'HATCH_PET', petName: '  Byte   Goblin ' }, {});
  expect(response.success).toBe(true);
  expect(stored.petName).toBe('Byte Goblin');
  expect(stored.onboardingStage).toBe('platforms');
});

test('only popup can clear history, without changing feed count', async () => {
  stored.slopHistoryV1 = [{ id: 'saved' }]; stored.feedCount = 5;
  expect((await dispatch({ type: 'CLEAR_SLOP_HISTORY' })).success).toBe(false);
  expect(stored.slopHistoryV1).toHaveLength(1);
  expect((await dispatch({ type: 'CLEAR_SLOP_HISTORY' }, { url: chrome.runtime.getURL('popup.html') })).success).toBe(true);
  expect(stored.slopHistoryV1).toEqual([]);
  expect(stored.feedCount).toBe(5);
});

test('account sync reserves the onboarding name instead of restoring an old profile name', async () => {
  Object.assign(stored, { evolution: 'egg', onboardingStage: 'hatch' });
  await dispatch({ type: 'HATCH_PET', petName: 'Trash Panda' }, {});
  fetch.mockImplementation(async (url, options) => ({
    ok: true, status: 200, headers: { get: () => 'test' },
    json: async () => url.endsWith('/v1/gomimon/name')
      ? { gomimon: { name: JSON.parse(options.body).name } }
      : { account: { accountKey: 'test' }, gomimon: { name: 'Crumb Goblin' } }
  }));
  const result = await dispatch({ type: 'GET_DETECTOR_ACCOUNT' }, {});
  expect(result.gomimon.name).toBe('Trash Panda');
  expect(stored.petName).toBe('Trash Panda');
  expect(stored.pendingPetName).toBeNull();
});

test('failed name reservation preserves the onboarding choice across subsequent account syncs', async () => {
  Object.assign(stored, { petName: 'Trash Panda', pendingPetName: 'Trash Panda', onboardingStage: 'complete' });
  fetch.mockImplementation(async url => ({
    ok: !url.endsWith('/v1/gomimon/name'), status: url.endsWith('/v1/gomimon/name') ? 409 : 200,
    headers: { get: () => 'test' },
    json: async () => url.endsWith('/v1/gomimon/name')
      ? { error: { code: 'NAME_TAKEN', message: 'Name already taken.' } }
      : { account: { accountKey: 'test' }, gomimon: { name: 'Crumb Goblin' } }
  }));
  for (let i = 0; i < 2; i++) {
    const result = await dispatch({ type: 'GET_DETECTOR_ACCOUNT' }, {});
    expect(result.nameError).toBeTruthy();
    expect(stored.petName).toBe('Trash Panda');
    expect(stored.pendingPetName).toBe('Trash Panda');
  }
});

test('billing actions reject content scripts and open only Stripe URLs from the popup', async () => {
  chrome.runtime.id = 'gomimon'; chrome.tabs.create = jest.fn(async () => ({}));
  for (const type of ['BILLING_CHECKOUT', 'BILLING_PORTAL', 'BILLING_REFRESH']) {
    expect((await dispatch({ type })).error.code).toBe('INVALID_SENDER');
  }
  expect(fetch).not.toHaveBeenCalled();
  fetch.mockImplementation(async url => ({ ok: true, status: 200, headers: { get: () => 'test' }, json: async () => url.endsWith('/checkout')
    ? { url: 'https://checkout.stripe.com/c/pay/test' } : { account: { accountKey: 'billing-user' } } }));
  const origin = { id: 'gomimon', url: chrome.runtime.getURL('popup.html') };
  expect((await dispatch({ type: 'BILLING_CHECKOUT' }, origin)).success).toBe(true);
  expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://checkout.stripe.com/c/pay/test' });
  expect(stored.gomimonBillingPending.accountKey).toBe('billing-user');
  fetch.mockImplementation(async () => ({ ok: true, status: 200, headers: { get: () => '' }, json: async () => ({ url: 'https://checkout.stripe.com.evil.test/pay' }) }));
  expect((await dispatch({ type: 'BILLING_CHECKOUT' }, origin)).success).toBe(false);
  expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
});
