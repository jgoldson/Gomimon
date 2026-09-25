import { readFileSync } from 'node:fs';
import { DEFAULT_STATS } from '../../constants.js';
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const el = id => document.getElementById(id);
let stored, consent;
beforeEach(async () => {
  jest.resetModules(); jest.useFakeTimers();
  document.documentElement.innerHTML = readFileSync(new URL('../../popup.html', import.meta.url), 'utf8');
  chrome.runtime.getURL.mockImplementation(path => `safari-web-extension://test/${path}`);
  stored = { ...DEFAULT_STATS, evolution: 'baby', petName: 'TestGomi', onboardingStage: 'diet' };
  consent = false;
  let settings = { categories: [], mode: 'automatic', enabledPlatforms: ['reddit'], sensitivity: 'strict', categoryStrength: 'balanced' };
  window.scrollTo = jest.fn();
  chrome.storage.local.get.mockImplementation(async defaults => ({ ...defaults, ...stored }));
  chrome.storage.local.set.mockImplementation(async values => Object.assign(stored, values));
  chrome.runtime.sendMessage.mockImplementation((message, callback) => {
    if (message.type === 'SET_AI_CONSENT') consent = message.accepted;
    if (message.type === 'SET_DETECTOR_SETTINGS') settings = message.settings;
    callback({ success: true, signedIn: false, consent, providers: [], settings });
  });
  await import('../../popup.js'); await flush();
});
afterEach(() => {
  jest.clearAllTimers(); jest.useRealTimers();
  chrome.runtime.getURL.mockImplementation(path => `chrome-extension://test/${path}`);
});
test('Safari requires both consent and a filter, including ads-only diets', async () => {
  const next = async () => { el('onboardingNext').click(); await flush(); };
  const checkConsent = async accepted => {
    el('aiConsentCheckbox').checked = accepted;
    el('aiConsentCheckbox').dispatchEvent(new Event('change')); await flush();
  };
  await next(); expect(stored.onboardingStage).toBe('diet');
  await checkConsent(true);
  await next(); expect(stored.onboardingStage).toBe('diet');
  await checkConsent(false);
  const ads = document.querySelector('[data-detector-category="ads"]');
  ads.checked = true; ads.dispatchEvent(new Event('change'));
  await next(); expect(stored.onboardingStage).toBe('diet');
  expect(el('onboardingNotice').textContent).toContain('permission box');
  await checkConsent(true);
  await next(); expect(stored.onboardingStage).toBe('account');
});
