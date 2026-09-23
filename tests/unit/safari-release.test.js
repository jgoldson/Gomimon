import { DEFAULT_STATS, DEFAULT_DETECTOR_SETTINGS } from '../../constants.js';
let stored, listener;
const popup = { id: 'test', url: 'safari-web-extension://test/popup.html' };
const site = { tab: { id: 1, url: 'https://x.com/home' }, url: 'https://x.com/home', frameId: 0 };
const dispatch = (message, sender = popup) => new Promise(resolve => listener(message, sender, resolve));
const analysis = { type: 'ANALYZE_CONTENT', platform: 'x', contentType: 'post', text: 'word '.repeat(12), includeAi: true, categories: [] };
beforeEach(async () => {
  jest.resetModules(); jest.useFakeTimers();
  chrome.runtime.getURL.mockImplementation(path => `safari-web-extension://test/${path}`);
  chrome.runtime.id = 'test';
  stored = { ...DEFAULT_STATS, petName: 'LocalBuddy', evolution: 'baby', onboardingStage: 'complete', detectorSettings: { ...DEFAULT_DETECTOR_SETTINGS }, detectorSessionToken: 'session' };
  chrome.storage.local.get.mockImplementation(async key => typeof key === 'string' ? { [key]: stored[key] } : { ...key, ...stored });
  chrome.storage.local.set.mockImplementation(async values => Object.assign(stored, values));
  chrome.storage.local.remove.mockImplementation(async key => { delete stored[key]; });
  chrome.tabs.sendMessage = jest.fn(async () => ({}));
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ label: 'low', aiProbability: .1, categoryProbabilities: {}, account: { accountKey: 'one' }, quota: {}, providers: ['google'] }) }));
  await import('../../background.js'); listener = chrome.runtime.onMessage.addListener.mock.calls.at(-1)[0];
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); chrome.runtime.getURL.mockImplementation(path => `chrome-extension://test/${path}`); });
test('Safari refuses analysis and name moderation before explicit consent, including legacy versions', async () => {
  for (const consent of [undefined, { version: 0, accepted: true }, { version: 1, accepted: false }]) {
    stored.gomimonAIConsent = consent;
    const result = await dispatch(analysis, site); expect(result.success).toBe(false);
  }
  await dispatch({ type: 'GET_DETECTOR_ACCOUNT' });
  expect(fetch.mock.calls.filter(([url]) => /analyze|gomimon\/name/.test(url))).toHaveLength(0);
});
test('only extension UI can grant consent; withdrawal prevents subsequent requests', async () => {
  expect((await dispatch({ type: 'SET_AI_CONSENT', accepted: true }, site)).success).toBe(false);
  expect(stored.gomimonAIConsent).toBeUndefined();
  expect((await dispatch({ type: 'SET_AI_CONSENT', accepted: true })).consent).toBe(true);
  expect((await dispatch(analysis, site)).success).toBe(true);
  const count = fetch.mock.calls.length;
  expect((await dispatch({ type: 'SET_AI_CONSENT', accepted: false })).consent).toBe(false);
  expect((await dispatch({ ...analysis, text: 'different '.repeat(12) }, site)).success).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(count);
});
test('Safari refuses all paid billing actions', async () => {
  for (const type of ['BILLING_CHECKOUT', 'BILLING_PORTAL', 'BILLING_REFRESH']) expect((await dispatch({ type })).success).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
