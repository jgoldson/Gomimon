import { readFileSync } from 'node:fs';
import { DEFAULT_STATS } from '../../constants.js';

let stored;
let signedIn;
let savedSettings;
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const el = id => document.getElementById(id);

beforeEach(async () => {
  jest.resetModules();
  jest.useFakeTimers();
  document.documentElement.innerHTML = readFileSync(new URL('../../popup.html', import.meta.url), 'utf8');
  stored = { ...DEFAULT_STATS, petName: 'TestGomi', onboardingStage: 'hatch' };
  signedIn = false;
  savedSettings = { categories: [], mode: 'manual', sensitivity: 'strict', categoryStrength: 'conservative', enabledPlatforms: ['reddit', 'x'] };
  window.scrollTo = jest.fn();
  chrome.storage.local.get.mockImplementation(async defaults => ({ ...defaults, ...stored }));
  chrome.storage.local.set.mockImplementation(async values => Object.assign(stored, values));
  chrome.runtime.sendMessage.mockImplementation((message, callback) => {
    if (message.type === 'HATCH_PET') Object.assign(stored, { evolution: 'baby', petName: 'TestGomi', onboardingStage: 'platforms' });
    if (message.type === 'RESET_ONBOARDING') Object.assign(stored, DEFAULT_STATS, { onboardingStage: 'hatch' });
    if (message.type === 'DETECTOR_SIGN_IN') signedIn = true;
    if (message.type === 'SET_DETECTOR_SETTINGS') savedSettings = message.settings;
    callback({ success: true, signedIn, settings: savedSettings });
  });
  await import('../../popup.js');
  await flush();
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

async function hatchEgg() {
  if (el('onboardingPetName')) { el('onboardingPetName').value = 'TestGomi'; el('onboardingPetName').dispatchEvent(new Event('input')); }
  el('onboardingNext').click();
  jest.advanceTimersByTime(4800);
  await flush();
  expect(stored.onboardingStage).toBe('platforms');
  el('onboardingNext').click();
  await flush();
}

test('first visit hatches the egg, then requires a diet before activating the companion', async () => {
  expect(el('detectorCategoryControls').hidden).toBe(true);
  expect(el('onboardingCreature').hidden).toBe(false);
  expect(el('feedSummary').hidden).toBe(true);
  await hatchEgg();
  expect(stored.onboardingStage).toBe('diet');
  expect(el('petContainer').hidden).toBe(true);
  expect(document.querySelector('.detector-section').hidden).toBe(false);

  el('onboardingNext').click();
  await flush();
  expect(stored.onboardingStage).toBe('diet');
  expect(el('onboardingNotice').hidden).toBe(false);

  document.querySelector('[data-detector-category="ads"]').checked = true;
  el('onboardingNext').click();
  await flush();
  expect(stored.onboardingStage).toBe('account');
  expect(el('onboardingAccount').hidden).toBe(false);
  expect(el('detectorSignInButton').hidden).toBe(true);
  el('onboardingGoogle').click(); await flush();
  expect(stored.onboardingStage).toBe('complete');
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: 'SET_DETECTOR_SETTINGS', settings: expect.objectContaining({ categories: ['ads'] })
  }), expect.any(Function));
  expect(stored.evolution).toBe('baby');
  expect(el('onboardingFlow').hidden).toBe(true);
  expect(el('onboardingActions').hidden).toBe(true);
  expect(el('feedSummary').hidden).toBe(false);
});

test('reset returns to filter setup and can be used repeatedly', async () => {
  for (let i = 0; i < 2; i++) {
    await hatchEgg();
    document.querySelector('[data-detector-category="ads"]').checked = true;
    el('onboardingNext').click(); await flush();
    el('resetOnboarding').click(); await flush();
    expect(stored.onboardingStage).toBe('hatch');
    expect(stored.evolution).toBe('egg');
    expect(el('onboardingCreature').hidden).toBe(false);
    expect(el('detectorCategoryControls').hidden).toBe(true);
    expect(el('onboardingNameHelp').textContent).not.toContain('Looks good');
    expect(el('onboardingNext').disabled).toBe(true);
  }
});

test('failed diet save keeps the user on setup', async () => {
  await hatchEgg();
  document.querySelector('[data-detector-category="ads"]').checked = true;
  chrome.runtime.sendMessage.mockImplementation((message, callback) => callback({ success: false, error: 'Save failed' }));
  el('onboardingNext').click(); await flush();
  expect(stored.onboardingStage).toBe('diet');
  expect(el('detectorStatus').textContent).toBe('Save failed');
  expect(el('onboardingNext').disabled).toBe(false);
});

test('reopening during diet resumes without replaying the hatch', async () => {
  await hatchEgg();
  jest.resetModules();
  await import('../../popup.js'); await flush();
  expect(el('onboardingNext').textContent).toBe('Continue');
  expect(el('petContainer').hidden).toBe(true);
  expect(document.querySelector('.detector-section').hidden).toBe(false);
});

test('existing hatched pets skip first-time setup', async () => {
  delete stored.onboardingStage;
  stored.evolution = 'classic-gomi';
  jest.resetModules();
  await import('../../popup.js'); await flush();
  expect(stored.onboardingStage).toBe('complete');
  expect(el('onboardingActions').hidden).toBe(true);
  expect(el('petContainer').hidden).toBe(false);
});

test('completed onboarding keeps filter controls in settings until they are needed', async () => {
  await hatchEgg();
  document.querySelector('[data-detector-category="ads"]').checked = true;
  el('onboardingNext').click();
  await flush();

  el('onboardingGoogle').click(); await flush();
  expect(el('settingsButton').hidden).toBe(false);
  expect(el('settingsButton').getAttribute('aria-expanded')).toBe('false');
  expect(el('detectorSection').hidden).toBe(true);

  el('settingsButton').click();
  expect(el('settingsButton').getAttribute('aria-expanded')).toBe('true');
  expect(el('settingsButton').hidden).toBe(true);
  expect(el('detector-title').textContent).toBe('Settings');
  expect(el('detectorSection').hidden).toBe(false);
  expect(el('petContainer').hidden).toBe(true);
  expect(document.querySelector('.stats-grid').hidden).toBe(true);
  expect(el('feedSummary').hidden).toBe(true);
  expect(el('infoText').hidden).toBe(true);
  expect(el('detectorCategoryControls').hidden).toBe(false);
  expect(el('detectorCategoryStrength').value).toBe('conservative');
  expect(el('detectorDebugControl').hidden).toBe(false);
  expect(el('settingsDebugTools').hidden).toBe(false);

  chrome.runtime.sendMessage.mockImplementation((message, callback) => {
    callback({
      success: true,
      signedIn: true,
      account: { email: 'trainer@example.com' },
      quota: { remaining: 100, limit: 100 },
      settings: {
        categories: ['ads'],
        mode: 'automatic',
        sensitivity: 'balanced',
        categoryStrength: 'aggressive',
        debug: true
      }
    });
  });
  signedIn = false;
  el('detectorSignInButton').click();
  await flush();
  expect(el('detectorControls').hidden).toBe(false);
  expect(el('detectorMode').value).toBe('automatic');
  expect(el('detectorSensitivity').value).toBe('balanced');

  el('settingsCloseButton').click();
  expect(el('settingsButton').getAttribute('aria-expanded')).toBe('false');
  expect(el('settingsButton').hidden).toBe(false);
  expect(el('detector-title').textContent).toBe('Choose a diet');
  expect(el('detectorSection').hidden).toBe(true);
  expect(el('petContainer').hidden).toBe(false);
});

test('platform onboarding requires a choice and preserves its draft across refreshes', async () => {
  el('onboardingNext').click(); jest.advanceTimersByTime(4800); await flush();
  expect(stored.onboardingStage).toBe('platforms');
  expect(el('platformControls').hidden).toBe(false);
  const inputs = [...document.querySelectorAll('[data-platform]')];
  expect(inputs.map(input => input.checked)).toEqual([true, true]);
  inputs.forEach(input => { input.checked = false; input.dispatchEvent(new Event('change')); });
  el('onboardingNext').click(); await flush();
  expect(stored.onboardingStage).toBe('platforms');
  expect(el('platformNotice').hidden).toBe(false);
  jest.advanceTimersByTime(5000); await flush();
  expect(inputs.every(input => !input.checked)).toBe(true);
  inputs[1].checked = true; inputs[1].dispatchEvent(new Event('change'));
  el('onboardingNext').click(); await flush();
  expect(stored.onboardingStage).toBe('diet');
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_DETECTOR_SETTINGS', settings: expect.objectContaining({ enabledPlatforms: ['x'] }) }), expect.any(Function));
});

test('settings rejects disabling the last platform without saving', async () => {
  await hatchEgg();
  document.querySelector('[data-detector-category="ads"]').checked = true;
  el('onboardingNext').click(); await flush(); el('onboardingGoogle').click(); await flush(); el('settingsButton').click();
  expect(el('platformControls').hidden).toBe(false);
  const inputs = [...document.querySelectorAll('[data-platform]')];
  inputs[0].checked = false; inputs[0].dispatchEvent(new Event('change')); await flush();
  chrome.runtime.sendMessage.mockClear();
  inputs[1].checked = false; inputs[1].dispatchEvent(new Event('change')); await flush();
  expect(el('platformNotice').textContent).toBe('Choose at least one platform.');
  expect(el('platformNotice').hidden).toBe(false);
  expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
});

async function reachAccount() {
  await hatchEgg();
  const ads = document.querySelector('[data-detector-category="ads"]');
  ads.checked = true;
  ads.dispatchEvent(new Event('change'));
  el('onboardingNext').click(); await flush();
  expect(stored.onboardingStage).toBe('account');
}

test('diet drafts and filter strength survive account refresh until Continue saves them', async () => {
  await hatchEgg();
  const input = document.querySelector('[data-detector-category="ragebait"]');
  input.checked = true; input.dispatchEvent(new Event('change'));
  el('detectorCategoryStrength').value = 'aggressive';
  el('detectorCategoryStrength').dispatchEvent(new Event('change'));
  jest.advanceTimersByTime(5000); await flush();
  expect(input.checked).toBe(true);
  expect(el('detectorCategoryStrength').value).toBe('aggressive');
  el('onboardingNext').click(); await flush();
  expect(savedSettings.categories).toEqual(['ragebait']);
  expect(savedSettings.categoryStrength).toBe('aggressive');
  expect(stored.onboardingStage).toBe('account');
});

test('cancelled account sign-in stays on the final step and permits a successful retry', async () => {
  await reachAccount();
  const normal = chrome.runtime.sendMessage.getMockImplementation();
  chrome.runtime.sendMessage.mockImplementation((message, callback) => {
    if (message.type === 'DETECTOR_SIGN_IN') return callback({ success: false, error: 'Sign-in cancelled. Try again.' });
    normal(message, callback);
  });
  el('onboardingGoogle').click(); await flush();
  expect(stored.onboardingStage).toBe('account');
  expect(el('onboardingAccountStatus').textContent).toContain('cancelled');
  expect(el('onboardingGoogle').disabled).toBe(false);
  expect(savedSettings.categories).toEqual(['ads']);
  chrome.runtime.sendMessage.mockImplementation(normal);
  el('onboardingGoogle').click(); await flush();
  expect(stored.onboardingStage).toBe('complete');
  expect(stored.detectorOnboardingSeen).toBe(true);
  expect(el('feedSummary').hidden).toBe(false);
});

test('account step resumes on reopen and completes when OAuth finished while popup was closed', async () => {
  await reachAccount();
  jest.resetModules(); await import('../../popup.js'); await flush();
  expect(el('onboardingAccount').hidden).toBe(false);
  expect(el('onboardingNext').hidden || el('onboardingActions').hidden).toBe(true);
  expect(document.querySelector('[data-step="account"]').getAttribute('aria-current')).toBe('step');
  signedIn = true;
  jest.resetModules(); await import('../../popup.js'); await flush();
  expect(stored.onboardingStage).toBe('complete');
  expect(el('onboardingAccount').hidden).toBe(true);
});

test('an already authenticated user finishes after diet without another sign-in', async () => {
  signedIn = true;
  await hatchEgg();
  document.querySelector('[data-detector-category="ads"]').checked = true;
  jest.advanceTimersByTime(5000); await flush();
  document.querySelector('[data-detector-category="ads"]').checked = true;
  el('onboardingNext').click(); await flush();
  expect(stored.onboardingStage).toBe('complete');
  expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DETECTOR_SIGN_IN' }), expect.any(Function));
});

test('account continuation requires confirmed authentication and blocks duplicate clicks', async () => {
  await reachAccount();
  const normal = chrome.runtime.sendMessage.getMockImplementation();
  let respond;
  chrome.runtime.sendMessage.mockImplementation((message, callback) => {
    if (message.type === 'DETECTOR_SIGN_IN') { respond = callback; return; }
    normal(message, callback);
  });
  chrome.runtime.sendMessage.mockClear();
  el('onboardingGoogle').click(); el('onboardingGoogle').click();
  expect(el('onboardingGoogle').disabled).toBe(true);
  expect(chrome.runtime.sendMessage.mock.calls.filter(([message]) => message.type === 'DETECTOR_SIGN_IN')).toHaveLength(1);
  respond({ success: true }); await flush();
  expect(stored.onboardingStage).toBe('account');
  expect(el('onboardingAccountStatus').textContent).toContain('not completed');
  expect(el('onboardingGoogle').disabled).toBe(false);
});

test('hatch holds setup through the reveal and ignores duplicate activation', async () => {
  el('onboardingNext').click();
  expect(el('onboardingPetName').disabled).toBe(true);
  expect(el('onboardingNext').getAttribute('aria-busy')).toBe('true');
  jest.advanceTimersByTime(3200);
  await flush();
  expect(stored.evolution).toBe('egg');
  expect(el('onboardingCopy').textContent).toBe('Hello, TestGomi!');
  el('onboardingNext').click();
  jest.advanceTimersByTime(1600);
  await flush();
  expect(stored.evolution).toBe('baby');
  expect(chrome.runtime.sendMessage.mock.calls.filter(([message]) => message.type === 'HATCH_PET')).toHaveLength(1);
  expect(el('onboardingCreature').classList.contains('is-hatching')).toBe(false);
  expect(el('onboardingPetName').disabled).toBe(false);
  expect(el('onboardingNext').hasAttribute('aria-busy')).toBe(false);
});

test('reduced motion uses a brief quiet reveal', async () => {
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = jest.fn(() => ({ matches: true }));
  try {
    el('onboardingNext').click();
    expect(el('onboardingCreature').classList.contains('is-hatch-quiet')).toBe(true);
    jest.advanceTimersByTime(900);
    await flush();
    expect(stored.onboardingStage).toBe('platforms');
    expect(el('onboardingCreature').classList.contains('is-hatch-quiet')).toBe(false);
  } finally {
    window.matchMedia = originalMatchMedia;
  }
});

test('Safari tab sign-in stays pending without showing a failed login', async () => {
  await hatchEgg();
  document.querySelector('[data-detector-category="ads"]').checked = true;
  el('onboardingNext').click(); await flush();
  const previous = chrome.runtime.sendMessage.getMockImplementation();
  chrome.runtime.sendMessage.mockImplementation((message, callback) => {
    if (message.type === 'DETECTOR_SIGN_IN') return callback({ success: true, pending: true, signedIn: false });
    previous(message, callback);
  });
  el('onboardingGoogle').click(); await flush();
  expect(stored.onboardingStage).toBe('account');
  expect(el('onboardingAccountStatus').textContent).toContain('new Safari tab');
  expect(el('onboardingGoogle').disabled).toBe(false);
});

test('eating animations can be chosen during onboarding and changed in settings', async () => {
  await hatchEgg();
  expect(el('showEatingAnimations').checked).toBe(true);
  el('showEatingAnimations').checked = false;
  el('showEatingAnimations').dispatchEvent(new Event('change'));
  document.querySelector('[data-detector-category="ads"]').checked = true;
  el('onboardingNext').click();
  await flush();
  expect(savedSettings.showEatingAnimations).toBe(false);
  el('onboardingGoogle').click();
  await flush();
  el('settingsButton').click();
  expect(el('detectorCategoryControls').hidden).toBe(false);
  expect(el('showEatingAnimations').checked).toBe(false);
  el('showEatingAnimations').checked = true;
  el('showEatingAnimations').dispatchEvent(new Event('change'));
  await flush();
  expect(savedSettings.showEatingAnimations).toBe(true);
});
