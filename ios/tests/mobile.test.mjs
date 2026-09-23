import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const windows = [];
afterEach(() => { for (const window of windows.splice(0)) window.close(); });
const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
function setup(url = 'https://www.reddit.com/', wrap = false) {
  const dom = new JSDOM(source('../GomiMon/Resources/demo.html'), { url, runScripts: 'outside-only' });
  if (wrap) {
    const post = dom.window.document.querySelector('#demo-normal');
    const link = dom.window.document.createElement('a');
    link.href = '/comments/example'; post.before(link); link.append(post);
  }
  windows.push(dom.window);
  const messages = [];
  dom.window.webkit = { messageHandlers: { gomimon: { postMessage: message => messages.push(message) } } };
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ top: 100, bottom: 200 });
  for (const path of ['../../platforms.js', '../../detector/revision.js', '../../detector/policy.js', '../../reddit-detector.js', '../../x-detector.js', '../GomiMon/Resources/mobile.js']) dom.window.eval(source(path));
  return { dom, window: dom.window, document: dom.window.document, messages };
}
test('manual meals are reversible and restoring cannot farm repeat meals', () => {
  const { window, document, messages } = setup();
  const post = document.querySelector('#demo-normal');
  post.nextElementSibling.click();
  assert.equal(post.style.display, 'none');
  document.querySelector('.gomimon-eaten-placeholder').click();
  assert.equal(post.style.display, '');
  post.nextElementSibling.click();
  assert.equal(messages.filter(m => m.type === 'meal').length, 1);
  assert.deepEqual(Object.keys(messages.find(m => m.type === 'meal')).sort(), ['demo', 'key', 'reason', 'type']);
  window.close();
});
test('automatic feeding uses explicit ads, restores on disable, and respects Show post', () => {
  const { window, document, messages } = setup();
  window.GomiMonMobile.configure(true);
  assert.equal(document.querySelector('#demo-ad').style.display, 'none');
  assert.equal(document.querySelector('#demo-normal').style.display, '');
  window.GomiMonMobile.configure(false);
  assert.equal(document.querySelector('#demo-ad').style.display, '');
  window.GomiMonMobile.configure(true);
  assert.equal(messages.filter(m => m.type === 'meal').length, 1);
  assert.equal(document.querySelector('#demo-ad').style.display, 'none');
  document.querySelector('.gomimon-eaten-placeholder').click();
  window.GomiMonMobile.configure(true);
  assert.equal(document.querySelector('#demo-ad').style.display, '');
  window.close();
});
test('new infinite-scroll posts receive controls', async () => {
  const { window, document } = setup();
  const post = document.createElement('shreddit-post');
  post.id = 'new-post'; post.setAttribute('post-title', 'New post');
  document.body.append(post);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.ok(post.nextElementSibling.matches('.gomimon-post-marker'));
  window.close();
});
test('unrelated origins get no controls or bridge messages', () => {
  const { window, document, messages } = setup('https://reddit.com.attacker.example/');
  assert.equal(document.querySelector('.gomimon-post-marker'), null);
  assert.equal(messages.length, 0);
  window.close();
});

test('feed taps never reach Reddit capture handlers or activate a wrapping link', () => {
  const { window, document, messages } = setup();
  let navigations = 0;
  document.addEventListener('click', () => navigations++, true);
  const post = document.querySelector('#demo-normal');
  post.addEventListener('pointerdown', () => navigations++, true);
  post.addEventListener('click', () => navigations++, true);
  const button = post.nextElementSibling;
  button.dispatchEvent(new window.Event('pointerdown', { bubbles: true, cancelable: true }));
  button.click();
  assert.equal(navigations, 0);
  assert.equal(messages.filter(m => m.type === 'meal').length, 1);
  assert.equal(post.style.display, 'none');
  window.close();
});
test('ads wait until visible and late ad attributes are detected automatically', async () => {
  const { window, document, messages } = setup();
  const ad = document.querySelector('#demo-ad');
  ad.getBoundingClientRect = () => ({ top: 2000, bottom: 2400 });
  window.GomiMonMobile.configure(true);
  assert.equal(ad.style.display, '');
  ad.getBoundingClientRect = () => ({ top: 100, bottom: 400 });
  window.dispatchEvent(new window.Event('scroll'));
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(ad.style.display, 'none');
  document.querySelector('#demo-normal').setAttribute('is-promoted', 'true');
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(messages.filter(m => m.reason === 'ad').length, 2);
  window.close();
});

test('controls sit outside links that wrap a post', () => {
  const { window, document } = setup('https://www.reddit.com/', true);
  const post = document.querySelector('#demo-normal');
  const link = post.parentElement;
  const button = link.nextElementSibling;
  assert.equal(button.closest('a'), null);
  button.click();
  assert.equal(link.style.display, 'none');
  document.querySelector('.gomimon-eaten-placeholder').click();
  assert.equal(link.style.display, '');
  window.close();
});

function automatic(window, categories, extras = {}) {
  window.GomiMonMobile.configure({ automatic: true, categories, categoryStrength: 'balanced', enabledPlatforms: ['reddit'], remoteReady: true, accountScope: 'test', ...extras });
}
test('only chosen categories are requested and matching results hide a post', () => {
  const { window, document, messages } = setup();
  automatic(window, ['sports', 'crypto']);
  const request = messages.find(m => m.type === 'analyze');
  assert.deepEqual(Array.from(request.input.categories), ['sports', 'crypto']);
  assert.equal(request.input.includeAi, false);
  window.GomiMonMobile.receive(request.id, { categoryProbabilities: { sports: 0.85, crypto: 0.1 } });
  assert.equal(document.querySelector('#demo-normal').style.display, 'none');
  automatic(window, ['crypto']);
  assert.equal(document.querySelector('#demo-normal').style.display, '');
  window.close();
});
test('stale results cannot hide posts after changing diet or disabling checks', () => {
  const { window, document, messages } = setup();
  automatic(window, ['sports']);
  const request = messages.find(m => m.type === 'analyze');
  automatic(window, ['politics']);
  window.GomiMonMobile.receive(request.id, { categoryProbabilities: { sports: 1, politics: 1 } });
  assert.equal(document.querySelector('#demo-normal').style.display, '');
  assert.equal(messages.filter(m => m.type === 'meal').length, 0);
  window.close();
});
test('sign-in and consent gate remote checks while selected ads still work', () => {
  const { window, document, messages } = setup();
  automatic(window, ['sports', 'ads'], { remoteReady: false });
  assert.equal(messages.filter(m => m.type === 'analyze').length, 0);
  assert.equal(document.querySelector('#demo-ad').style.display, 'none');
  window.close();
});
test('strengths use extension thresholds and failures leave posts visible', () => {
  const { window, document, messages } = setup();
  automatic(window, ['sports'], { categoryStrength: 'conservative' });
  const request = messages.find(m => m.type === 'analyze');
  window.GomiMonMobile.receive(request.id, { categoryProbabilities: { sports: 0.85 } });
  assert.equal(document.querySelector('#demo-normal').style.display, '');
  automatic(window, ['sports'], { categoryStrength: 'balanced' });
  assert.equal(document.querySelector('#demo-normal').style.display, 'none');
  window.close();
});
test('unsupported AI-only short text spends no remote checks', () => {
  const { window, messages } = setup();
  automatic(window, ['ai_content']);
  assert.equal(messages.filter(m => m.type === 'analyze').length, 0);
  window.close();
});
test('failed checks stay visible and changing post contents rejects old results', () => {
  const { window, document, messages } = setup();
  automatic(window, ['sports']);
  const request = messages.find(m => m.type === 'analyze');
  document.querySelector('#demo-normal h2').textContent = 'A completely different post';
  window.GomiMonMobile.receive(request.id, { categoryProbabilities: { sports: 1 } });
  assert.equal(document.querySelector('#demo-normal').style.display, '');
  assert.equal(messages.filter(m => m.type === 'meal').length, 0);
  window.close();
});
test('failed checks never hide posts or immediately retry', () => {
  const { window, document, messages } = setup();
  automatic(window, ['sports']);
  const request = messages.find(m => m.type === 'analyze');
  window.GomiMonMobile.receive(request.id, { error: 'quota', retryAfterMs: 3600000 });
  automatic(window, ['sports']);
  assert.equal(document.querySelector('#demo-normal').style.display, '');
  assert.equal(messages.filter(m => m.type === 'analyze').length, 1);
  window.close();
});
