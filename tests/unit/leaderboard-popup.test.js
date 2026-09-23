import { readFileSync } from 'node:fs';
import { DEFAULT_DETECTOR_SETTINGS, DEFAULT_STATS } from '../../constants.js';

let stored;
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const el = id => document.getElementById(id);

beforeEach(async () => {
  jest.resetModules();
  jest.useFakeTimers();
  document.documentElement.innerHTML = readFileSync(new URL('../../popup.html', import.meta.url), 'utf8');
  stored = {
    ...DEFAULT_STATS,
    evolution: 'baby',
    petName: 'Byte Goblin',
    feedCount: 14,
    onboardingStage: 'complete',
    detectorSettings: { ...DEFAULT_DETECTOR_SETTINGS }
  };
  window.scrollTo = jest.fn();
  window.confirm = jest.fn(() => true);
  chrome.storage.local.get.mockImplementation(async defaults => ({ ...defaults, ...stored }));
  chrome.storage.local.set.mockImplementation(async values => Object.assign(stored, values));
  chrome.runtime.sendMessage.mockImplementation((message, callback) => {
    if (message.type === 'GET_DETECTOR_ACCOUNT') {
      callback({
        success: true,
        signedIn: true,
        account: { accountKey: 'account-key-1', email: 'trainer@example.com' },
        gomimon: {
          name: 'Byte Goblin', leaderboardEnabled: true, lifetimeMeals: 14,
          legacyImported: true, evolution: 'baby'
        },
        quota: { remaining: 100, limit: 100 },
        settings: DEFAULT_DETECTOR_SETTINGS
      });
      return;
    }
    if (message.type === 'GET_LEADERBOARD') {
      callback({
        success: true,
        period: message.period,
        entries: [
          { rank: 1, name: 'Trash Panda', evolution: 'classic-gomi', meals: 21 },
          { rank: 2, name: 'Byte Goblin', evolution: 'baby', meals: 14 }
        ],
        me: { rank: 2, name: 'Byte Goblin', evolution: 'baby', meals: 14 }
      });
      return;
    }
    callback({ success: true, settings: DEFAULT_DETECTOR_SETTINGS });
  });
  await import('../../popup.js');
  await flush();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('opens weekly standings and renders public entries plus the current rank', async () => {
  el('leaderboardOpen').click();
  await flush();
  expect(el('leaderboardSection').hidden).toBe(false);
  expect(el('leaderboardList').textContent).toContain('Trash Panda');
  expect(el('leaderboardList').textContent).toContain('21 meals');
  expect(el('leaderboardMe').textContent).toContain('Your GomiMon');
  expect(el('leaderboardLeave').hidden).toBe(false);
});

test('switches to all-time standings through the same public view', async () => {
  el('leaderboardOpen').click();
  await flush();
  el('leaderboardAllTime').click();
  await flush();
  expect(el('leaderboardAllTime').getAttribute('aria-selected')).toBe('true');
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'GET_LEADERBOARD', period: 'all_time' }),
    expect.any(Function)
  );
});

test('prompts an existing unnamed pet without resetting its progress', async () => {
  stored.petName = '';
  jest.resetModules();
  await import('../../popup.js');
  await flush();
  expect(el('onboardingFlow').hidden).toBe(false);
  el('onboardingPetName').value = 'Gomi Chan';
  el('onboardingPetName').dispatchEvent(new Event('input'));
  el('onboardingNext').click();
  await flush();
  expect(stored.petName).toBe('Gomi Chan');
  expect(stored.feedCount).toBe(14);
  expect(stored.evolution).toBe('baby');
});
