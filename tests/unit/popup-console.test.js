import { readFileSync } from 'node:fs';
import { DEFAULT_STATS, DEFAULT_DETECTOR_SETTINGS } from '../../constants.js';

let stored;
const el = id => document.getElementById(id);
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
async function update(values) {
  Object.assign(stored, values);
  jest.advanceTimersByTime(5000);
  await flush();
}

beforeEach(async () => {
  jest.resetModules();
  jest.useFakeTimers();
  document.documentElement.innerHTML = readFileSync(new URL('../../popup.html', import.meta.url), 'utf8');
  stored = { ...DEFAULT_STATS, evolution: 'baby', petName: 'Pocket Gomi', onboardingStage: 'complete',
    feedCount: 8, diet: { text: 6, image: 0, post: 2 } };
  window.scrollTo = jest.fn();
  chrome.storage.local.get.mockImplementation(async defaults => ({ ...defaults, ...stored }));
  chrome.storage.local.set.mockImplementation(async values => Object.assign(stored, values));
  chrome.runtime.sendMessage.mockImplementation((message, callback) => callback({
    success: true, signedIn: false, settings: DEFAULT_DETECTOR_SETTINGS, entries: []
  }));
  await import('../../popup.js');
  await flush();
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test('debug form switching updates the pet without changing progress', async () => {
  const before = JSON.parse(JSON.stringify(stored));
  const select = el('debugPetForm');
  expect(select.value).toBe('baby');
  expect([...select.options].map(option => option.value)).toContain('nimbus-gomi');
  select.value = 'nimbus-gomi';
  select.dispatchEvent(new Event('change'));
  await flush();
  expect(stored).toEqual({ ...before, evolution: 'nimbus-gomi' });
  expect(el('petSprite').querySelector('img').src).toContain('nimbus-gomi_celebrate.gif');
  expect(el('debugPetFormStatus').textContent).toContain('Nimbus-Gomi');
  expect(select.disabled).toBe(false);
});

test('failed debug changes restore the saved selection and allow retry', async () => {
  chrome.storage.local.set.mockRejectedValueOnce(new Error('Storage failed'));
  const select = el('debugPetForm');
  select.value = 'bubble-gomi';
  select.dispatchEvent(new Event('change'));
  await flush();
  expect(stored.evolution).toBe('baby');
  expect(select.value).toBe('baby');
  expect(select.disabled).toBe(false);
  expect(el('debugPetFormStatus').textContent).toContain('Could not switch');
});

test.each(['bubble-gomi', 'nimbus-gomi'])('%s celebrates evolution, eats, rests, and preserves emergency states', async evolution => {
  const sprite = () => el('petSprite').querySelector('img').getAttribute('src');
  const feedCount = evolution === 'bubble-gomi' ? 100 : 1000;
  await update({ evolution, feedCount });
  expect(sprite()).toContain(`${evolution}_celebrate.gif`);
  jest.advanceTimersByTime(1800); await flush();
  expect(sprite()).toContain(`${evolution}_idle.gif`);
  await update({ feedCount: feedCount + 1 });
  expect(sprite()).toContain(`${evolution}_eat.gif`);
  jest.advanceTimersByTime(1200); await flush();
  expect(sprite()).toContain(`${evolution}_idle.gif`);
  await update({ glitch: 90 });
  expect(sprite()).toContain(`${evolution}_sleep.gif`);
  await update({ glitch: 100 });
  expect(sprite()).toContain('/crashed.svg');
  await update({ glitch: 0, hunger: 0 });
  expect(sprite()).toContain('/starved.svg');
});

test('live feeding history survives hungry and crashed states; reboot restores the pet', async () => {
  expect(el('playSlopScholarButton')).toBeNull();
  expect(el('feedCount').textContent).toBe('8');
  expect(el('feedSummary').getAttribute('aria-label')).toBe('Slop removed');
  for (const id of ['textFeeds', 'imageFeeds', 'pageFeeds']) expect(el(id)).toBeNull();
  expect(el('infoText').hidden).toBe(true);

  await update({ hunger: 0, feedCount: 9, diet: { text: 6, image: 1, post: 2 } });
  expect(el('hungerBar').style.width).toBe('0%');
  expect(el('hungerBar').getAttribute('aria-valuenow')).toBe('0');
  expect(el('hungerState').textContent).toBe('EMPTY');
  expect(el('feedSummary').hidden).toBe(false);
  expect(el('feedCount').textContent).toBe('9');
  expect(el('infoText').hidden).toBe(false);

  await update({ hunger: 100, glitch: 100 });
  expect(el('glitchState').textContent).toBe('CRASHED');
  expect(el('rebootButton').style.display).toBe('block');
  expect(el('feedSummary').hidden).toBe(false);
  el('rebootButton').click(); await flush();
  expect(stored.glitch).toBe(0);
  expect(el('glitchBar').style.width).toBe('0%');
  expect(el('infoText').hidden).toBe(true);
  expect(el('rebootButton').style.display).toBe('none');
});

test('home-only content hides in settings and standings and restores on return', async () => {
  await update({ hunger: 0 });
  el('settingsButton').click();
  expect(el('feedSummary').hidden).toBe(true);
  expect(el('consoleFooter').hidden).toBe(true);
  expect(el('infoText').hidden).toBe(true);
  el('settingsCloseButton').click();
  expect(el('feedSummary').hidden).toBe(false);
  expect(el('infoText').hidden).toBe(false);
  el('leaderboardOpen').click(); await flush();
  expect(el('feedSummary').hidden).toBe(true);
  expect(el('consoleFooter').hidden).toBe(true);
  el('leaderboardClose').click();
  expect(el('feedSummary').hidden).toBe(false);
  expect(el('consoleFooter').hidden).toBe(false);
  expect(el('petName').textContent).toBe('Pocket Gomi');
});

test('settings preserves a name draft across refreshes and saves it explicitly', async () => {
  el('settingsButton').click();
  el('profileNameInput').value = 'New Pocket Name';
  el('profileNameInput').dispatchEvent(new Event('input'));
  jest.advanceTimersByTime(5000); await flush();
  expect(el('profileNameInput').value).toBe('New Pocket Name');
  expect(stored.petName).toBe('Pocket Gomi');
  el('profileNameSave').click(); await flush();
  expect(stored.petName).toBe('New Pocket Name');
  expect(el('profileStatus').textContent).toBe('Name saved in this browser.');
});

test('settings disclosures retain detector controls and account actions for signed-in users', async () => {
  chrome.runtime.sendMessage.mockImplementation((message, callback) => callback({
    success: true, signedIn: true, account: { email: 'test@example.com' },
    settings: message.settings || DEFAULT_DETECTOR_SETTINGS
  }));
  jest.advanceTimersByTime(5000); await flush();
  el('settingsButton').click();
  expect(el('settingsDetectorOptions').hidden).toBe(false);
  expect(el('settingsAdvanced').hidden).toBe(false);
  expect(el('detectorSignOutButton').hidden).toBe(false);
  expect(el('settingsDetectorOptions').contains(el('detectorMode'))).toBe(true);
  expect(el('settingsAdvanced').contains(el('detectorDeleteButton'))).toBe(true);
  expect(el('settingsAdvanced').contains(el('settingsDebugTools'))).toBe(true);
  el('detectorMode').value = 'automatic';
  el('detectorMode').dispatchEvent(new Event('change')); await flush();
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: 'SET_DETECTOR_SETTINGS', settings: expect.objectContaining({ mode: 'automatic' })
  }), expect.any(Function));
});

test('signed-out settings keeps advanced help accessible but hides account-only actions', () => {
  el('settingsButton').click();
  expect(el('settingsDetectorOptions').hidden).toBe(true);
  expect(el('settingsAdvanced').hidden).toBe(false);
  expect(el('detectorSignInButton').hidden).toBe(false);
  expect(el('detectorSignOutButton').hidden).toBe(true);
  expect(el('detectorDeleteButton').hidden).toBe(true);
});

test('slop opens saved history safely and returns focus to the counter', async () => {
  stored.slopHistoryV1 = [{ id: 'one', consumedAt: Date.now(), platform: 'reddit', source: 'manual', categories: ['ads', 'ai_content'], excerpt: '<img src=x onerror=alert(1)>' }];
  el('historyOpen').click(); await flush();
  expect(el('historySection').hidden).toBe(false);
  expect(el('feedSummary').hidden).toBe(true);
  expect(el('historyTotal').textContent).toBe('8');
  expect(el('historyList').textContent).toContain('<img src=x');
  expect(el('historyList').querySelector('img')).toBeNull();
  expect([...el('historyList').querySelectorAll('.history-categories span')].map(el => el.textContent)).toEqual(['Ad', 'AI']);
  el('historyClose').click();
  expect(el('historySection').hidden).toBe(true);
  expect(el('feedSummary').hidden).toBe(false);
  expect(document.activeElement).toBe(el('historyOpen'));
});

test('history explains missing old details and clears without resetting progress', async () => {
  el('historyOpen').click(); await flush();
  expect(el('historyStatus').textContent).toContain('Earlier meals');
  stored.slopHistoryV1 = [{ id: 'one', consumedAt: Date.now(), excerpt: 'Saved meal', source: 'manual' }];
  el('historyClose').click(); el('historyOpen').click(); await flush();
  window.confirm = jest.fn(() => true);
  chrome.runtime.sendMessage.mockImplementation((message, callback) => {
    if (message.type === 'CLEAR_SLOP_HISTORY') stored.slopHistoryV1 = [];
    callback({ success: true });
  });
  el('historyClear').click(); await flush();
  expect(stored.slopHistoryV1).toEqual([]);
  expect(stored.feedCount).toBe(8);
  expect(el('historyList').children).toHaveLength(0);
});

async function showBilling(billing, extra = {}) {
  chrome.runtime.sendMessage.mockImplementation((message, callback) => callback({ success: true, signedIn: true,
    account: { accountKey: 'one', email: 'test@example.test' }, quota: { remaining: 1000, limit: 1000 },
    gomimon: { name: 'Pocket Gomi' }, settings: DEFAULT_DETECTOR_SETTINGS, billing, ...extra }));
  await update({});
  el('settingsButton').click(); await flush();
}
test('Free plan offers test checkout and a manual refresh in Settings', async () => {
  await showBilling({ available: true, mode: 'test', plan: 'free', status: 'none' });
  expect(el('billingSettings').hidden).toBe(false);
  expect(el('billingUpgrade').hidden).toBe(false);
  expect(el('billingDescription').textContent).toContain('Test mode');
  el('billingUpgrade').click(); await flush();
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'BILLING_CHECKOUT' }, expect.any(Function));
  expect(el('billingStatus').textContent).toContain('new tab');
});
test('Plus cancellation shows its end date and customer portal', async () => {
  await showBilling({ available: true, plan: 'plus', status: 'active', hasCustomer: true, cancelAtPeriodEnd: true, paidThrough: '2026-10-22T00:00:00Z' });
  expect(el('billingPlan').textContent).toBe('GomiMon Plus');
  expect(el('billingUpgrade').hidden).toBe(true);
  expect(el('billingManage').hidden).toBe(false);
  expect(el('billingDescription').textContent).toContain('Plus ends');
});
test('server exhaustion never offers an upgrade as a remedy', async () => {
  await showBilling({ available: true, plan: 'free', status: 'none' }, { quotaBlock: { scope: 'server' } });
  expect(el('billingUpgrade').hidden).toBe(true);
  expect(el('billingDescription').textContent).toContain('service is at capacity');
});
test('failed renewal explains Free limits and keeps Manage billing available', async () => {
  await showBilling({ available: true, plan: 'free', status: 'past_due', hasCustomer: true, graceDeadline: '2026-01-01T00:00:00Z' });
  expect(el('billingDescription').textContent).toContain('Free limits apply');
  expect(el('billingManage').hidden).toBe(false);
  expect(el('billingUpgrade').hidden).toBe(true);
});
test('disabled billing advertises coming soon without checkout', async () => {
  await showBilling({ available: false, plan: 'free', status: 'none' });
  expect(el('billingUpgrade').hidden).toBe(true);
  expect(el('billingDescription').textContent).toContain('coming soon');
});
