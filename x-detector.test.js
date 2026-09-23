import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const fixture = readFileSync(new URL('./tests/fixtures/x-home.html', import.meta.url), 'utf8');
export function xDom() {
  const dom = new JSDOM(fixture, { url: 'https://x.com/home', runScripts: 'outside-only', pretendToBeVisual: true });
  for (const path of ['platforms.js', 'detector/revision.js', 'x-detector.js']) dom.window.eval(readFileSync(new URL(path, import.meta.url), 'utf8'));
  return dom;
}
function withDom(fn) { const dom = xDom(); try { fn(dom.window, dom.window.GomiMonXDetector); } finally { dom.window.close(); } }

test('extracts own text, quote context and the original post identity separately', () => withDom((w, adapter) => {
  const items = adapter.findItems();
  assert.equal(items.length, 2);
  const post = adapter.describe(items[0]);
  assert.equal(post.key, 'x-post-100');
  assert.equal(post.wordCount, 10);
  assert.match(post.quotedText, /sports team/);
  assert.doesNotMatch(post.text, /sports|Reply|Views|Example author/);
  assert.equal(adapter.describe(items[1]).key, 'x-post-200');
  assert.equal(adapter.describe(items[1]).isAd, true);
}));

test('quote-only and media-only posts do not borrow words from other authors', () => withDom((w, adapter) => {
  const post = adapter.findItems()[0];
  post.querySelector('[data-testid="tweetText"]').remove();
  assert.equal(adapter.describe(post).wordCount, 0);
  assert.equal(adapter.describe(post).extractionStatus, 'ready');
  post.querySelector('div[role="link"]').remove();
  post.append(w.document.createElement('video'));
  assert.equal(adapter.describe(post).extractionStatus, 'empty');
}));

test('reposts keep original identity and nested quoted articles are never separate items', () => withDom((w, adapter) => {
  const post = adapter.findItems()[0];
  const before = adapter.describe(post);
  const socialContext = w.document.createElement('div');
  socialContext.dataset.testid = 'socialContext';
  socialContext.innerHTML = '<a href="/reposter">Another person reposted</a>';
  post.prepend(socialContext);
  assert.equal(adapter.describe(post).key, before.key);
  assert.equal(adapter.describe(post).text, before.text);
  const quote = post.querySelector('div[role="link"]');
  quote.innerHTML = '<article data-testid="tweet"><div data-testid="User-Name"><a href="/quoted/status/999"><time>2h</time></a></div><div data-testid="tweetText">Nested quote context</div></article>';
  assert.equal(adapter.findItems().length, 2);
  assert.equal(adapter.describe(post).key, before.key);
  assert.equal(adapter.describe(post).quotedText, 'Nested quote context');
  assert.equal(adapter.closestItem(quote.querySelector('[data-testid="tweetText"]')), post);
}));

test('explicit ad detection excludes ordinary prose and quoted ads', () => withDom((w, adapter) => {
  const post = adapter.findItems()[0];
  post.querySelector('[data-testid="tweetText"]').innerHTML = '<span>Ad</span>';
  assert.equal(adapter.describe(post).isAd, false);
  const ad = adapter.findItems()[1];
  ad.querySelector('[data-testid="User-Name"]').parentElement.querySelector('span').textContent = 'More';
  assert.equal(adapter.describe(ad).isAd, false);
}));

test('nested live X author wrappers still recognize only the explicit ad header', () => withDom((w, adapter) => {
  const ad = adapter.findItems()[1];
  const user = ad.querySelector('[data-testid="User-Name"]');
  const wrapper = w.document.createElement('div');
  wrapper.innerHTML = `<div><div>${user.outerHTML}</div></div>`;
  user.replaceWith(wrapper);
  assert.equal(adapter.describe(ad).isAd, true);

  // Neither an author called Ad nor body/card/quote text may replace the label.
  const label = [...ad.querySelectorAll('span')].find(node => node.textContent === 'Ad');
  label.remove();
  ad.querySelector('[data-testid="User-Name"]').innerHTML = '<span>Ad</span>';
  ad.querySelector('[data-testid="tweetText"]').innerHTML = '<span>Ad</span>';
  ad.querySelector('[data-testid="card.wrapper"]').innerHTML = '<span>Ad</span>';
  const quote = w.document.createElement('div');
  quote.setAttribute('role', 'link');
  quote.innerHTML = '<div data-testid="User-Name">Quoted author</div><span>Ad</span>';
  ad.append(quote);
  assert.equal(adapter.describe(ad).isAd, false);
}));

test('recycled identity and expanded text create distinct revisions', () => withDom((w, adapter) => {
  const post = adapter.findItems()[0];
  const original = adapter.describe(post);
  const more = w.document.createElement('button');
  more.dataset.testid = 'tweet-text-show-more-link'; post.append(more);
  const partial = adapter.describe(post);
  assert.equal(partial.truncated, true);
  assert.notEqual(partial.revision, original.revision);
  more.remove(); post.querySelector('[data-testid="tweetText"]').textContent += ' Expanded text.';
  assert.notEqual(adapter.describe(post).revision, partial.revision);
  post.querySelector('a[href*="/status/"]').href = '/next/status/300';
  assert.equal(adapter.describe(post).key, 'x-post-300');
}));

test('only standard home feeds activate; dialogs and unknown identities stay untouched', () => withDom((w, adapter) => {
  const post = adapter.findItems()[0];
  const dialog = w.document.createElement('div'); dialog.setAttribute('role', 'dialog');
  dialog.append(post.cloneNode(true)); w.document.body.append(dialog);
  assert.equal(adapter.findItems().length, 2);
  for (const path of ['/search', '/author', '/author/status/100', '/i/chat', '/compose/post']) {
    w.history.replaceState({}, '', path); assert.equal(adapter.findItems().length, 0);
  }
  w.history.replaceState({}, '', '/home');
  w.document.querySelector('[aria-selected="true"]').textContent = 'Custom list';
  assert.equal(adapter.findItems().length, 0);
  w.document.querySelector('[aria-selected="true"]').textContent = 'Following';
  assert.equal(adapter.findItems().length, 2);
  post.querySelectorAll('a[href*="/status/"]').forEach(node => node.remove());
  assert.equal(adapter.describe(post), null);
}));

test('GomiMon hiding and controls never change the extracted content', () => withDom((w, adapter) => {
  const post = adapter.findItems()[0]; const before = adapter.describe(post);
  post.hidden = true; post.setAttribute('aria-hidden', 'true'); post.classList.add('gomimon-hidden-target');
  const controls = w.document.createElement('div'); controls.className = 'gomimon-ai-panel'; controls.textContent = 'Check for AI Feed'; post.prepend(controls);
  assert.equal(adapter.describe(post).revision, before.revision);
}));
