import { readFileSync } from 'node:fs';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('manual feeding removes an analyzed post without a placeholder or Show button', async () => {
  document.body.innerHTML = `<shreddit-post thingid="t3_feed">
    <h3 slot="title">A post title that is long enough to inspect</h3>
    <div slot="text-body">This is a deliberately long Reddit post body with enough words to pass the detector minimum while the response is pending.</div>
  </shreddit-post>`;
  chrome.runtime.getURL = jest.fn(path => `chrome-extension://gomimon/${path}`);
  window.matchMedia = jest.fn(() => ({ matches: false }));
  chrome.runtime.sendMessage.mockImplementation((message, callback) => {
    if (message.type === 'GET_DETECTOR_SETTINGS') {
      callback({ success: true, settings: { mode: 'manual', categories: [] } });
    } else if (message.type === 'ANALYZE_CONTENT') {
      callback({ result: { label: 'low', aiProbability: 0.18, categoryProbabilities: {} } });
    } else if (message.type === 'FEED_CONTENT') {
      callback({ success: true, evolution: 'baby' });
    }
  });
  for (const path of [
    'detector/revision.js', 'reddit-detector.js', 'detector/store.js',
    'detector/policy.js', 'detector/scheduler.js', 'detector/renderer.js', 'content.js'
  ]) {
    new Function(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'))();
  }
  await settle();
  document.querySelector('[data-gomimon-action="analyze"]').click();
  await settle();
  const post = document.querySelector('shreddit-post');
  post.getBoundingClientRect = () => ({ left: 100, top: 100, width: 500, height: 300, right: 600, bottom: 400 });
  jest.useFakeTimers();
  try {
    document.querySelector('[data-gomimon-action="feed"]').click();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector('.gomimon-pet-overlay')).not.toBeNull();
    expect(post.hidden).toBe(false);
    await jest.advanceTimersByTimeAsync(2400);
    expect(post.hidden).toBe(true);
    expect(post.classList.contains('gomimon-hidden-target')).toBe(true);
    expect(document.querySelector('.gomimon-pet-overlay')).toBeNull();
    expect(document.querySelector('.gomimon-filter-placeholder')).toBeNull();
    expect(document.querySelector('[data-gomimon-action="restore"]')).toBeNull();
    await jest.advanceTimersByTimeAsync(1000);
    expect(post.hidden).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});
