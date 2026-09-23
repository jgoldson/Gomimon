import { readFileSync } from 'node:fs';

test('extension reload removes stale controls and requests a refresh without more analysis', async () => {
  jest.useFakeTimers();
  chrome.runtime.id = 'gomimon';
  chrome.runtime.getURL.mockImplementation(path => `chrome-extension://gomimon/${path}`);
  chrome.runtime.sendMessage.mockImplementation((message, callback) => {
    callback({ success: true, settings: { mode: 'manual', categories: [] } });
  });
  document.body.innerHTML = '<shreddit-post thingid="t3_reload"><h3 slot="title">A short headline</h3></shreddit-post>';
  for (const path of ['detector/revision.js', 'reddit-detector.js', 'detector/store.js', 'detector/policy.js', 'detector/scheduler.js', 'detector/renderer.js', 'content.js']) {
    new Function(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'))();
  }
  await jest.advanceTimersByTimeAsync(1000);
  expect(document.querySelector('.gomimon-ai-panel')).not.toBeNull();
  chrome.runtime.id = undefined;
  chrome.runtime.getURL.mockImplementation(() => { throw new Error('Extension context invalidated.'); });
  await jest.advanceTimersByTimeAsync(500);
  expect(document.querySelector('.gomimon-ai-panel')).toBeNull();
  expect(document.querySelector('.gomimon-post-marker')).toBeNull();
  expect(document.querySelector('.gomimon-refresh-notice').textContent).toContain('Refresh this page');
  const count = chrome.runtime.sendMessage.mock.calls.length;
  await jest.advanceTimersByTimeAsync(3000);
  expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(count);
  expect(document.querySelectorAll('.gomimon-refresh-notice')).toHaveLength(1);
  document.body.innerHTML = '';
  jest.clearAllTimers();
  jest.useRealTimers();
});
