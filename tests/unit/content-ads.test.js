import { readFileSync } from 'node:fs';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('blocks native and dynamically inserted ads without remote analysis, including late ad metadata', async () => {
  document.body.innerHTML = `
    <shreddit-ad-post id="native-ad"><span>Ad</span></shreddit-ad-post>
    <shreddit-post thingid="organic"><h3 slot="title">Ads with 0 followers</h3></shreddit-post>
  `;
  chrome.runtime.sendMessage.mockImplementation((message, callback) => {
    if (message.type === 'GET_DETECTOR_SETTINGS') {
      callback({ success: true, settings: { mode: 'manual', categories: ['reddit_ads'], showEatingAnimations: false } });
    }
  });
  for (const path of [
    'detector/revision.js', 'reddit-detector.js', 'detector/store.js',
    'detector/policy.js', 'detector/scheduler.js', 'detector/renderer.js', 'content.js'
  ]) {
    new Function(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'))();
  }
  await settle();
  expect(document.querySelector('#native-ad').hidden).toBe(true);
  const organic = document.querySelector('shreddit-post');
  expect(organic.hidden).toBe(false);

  const inserted = document.createElement('shreddit-ad-post');
  inserted.id = 'inserted-ad';
  document.body.appendChild(inserted);
  await settle();
  await settle();
  expect(inserted.hidden).toBe(true);

  organic.setAttribute('sponsored', '');
  await settle();
  await settle();
  expect(organic.hidden).toBe(true);
  organic.removeAttribute('sponsored');
  await settle();
  await settle();
  expect(organic.hidden).toBe(false);
  expect(chrome.runtime.sendMessage.mock.calls.some(([message]) =>
    message.type === 'ANALYZE_REDDIT_CONTENT'
  )).toBe(false);
});
