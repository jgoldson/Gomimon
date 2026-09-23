import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('../website/index.html', import.meta.url), 'utf8');
const source = (await readFile(new URL('../website/app.js', import.meta.url), 'utf8'))
  .replace("import { config } from './config.js';", "const config = { apiBase: 'https://api.example.test', chromeStoreUrl: '' };");
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function setup(fetch) {
  const dom = new JSDOM(html, { url: 'https://gomimon.example/#leaderboard', runScripts: 'outside-only' });
  dom.window.matchMedia = () => ({ matches: true });
  dom.window.scrollTo = () => {};
  dom.window.fetch = fetch;
  dom.window.eval(source);
  return dom;
}
const response = entries => ({ ok: true, json: async () => ({ entries }) });

test('Nimbus-Gomi standings use its name and static image for reduced motion', async () => {
  const dom = setup(async () => response([{ rank: 1, name: 'Bubbles', evolution: 'nimbus-gomi', meals: 1000 }]));
  try {
    await tick();
    const rankings = dom.window.document.querySelector('#rankings');
    assert.match(rankings.textContent, /Nimbus-Gomi/);
    assert.equal(rankings.querySelector('img').getAttribute('src'), 'assets/nimbus-gomi.png');
  } finally { dom.window.close(); }
});

test('late responses cannot overwrite the newly selected period', async () => {
  const pending = [];
  const dom = setup(url => new Promise(resolve => pending.push({ url, resolve })));
  try {
    const doc = dom.window.document;
    doc.querySelector('[data-period="all_time"]').click();
    assert.match(pending[1].url, /period=all_time/);
    pending[1].resolve(response([{ rank: 1, name: 'All-time pet', evolution: 'baby', meals: 88 }]));
    await tick();
    pending[0].resolve(response([{ rank: 1, name: 'Stale weekly pet', evolution: 'baby', meals: 2 }]));
    await tick();
    assert.match(doc.querySelector('#rankings').textContent, /All-time pet/);
    assert.doesNotMatch(doc.querySelector('#rankings').textContent, /Stale weekly/);
    assert.equal(doc.querySelector('[data-period="all_time"]').getAttribute('aria-pressed'), 'true');
  } finally { dom.window.close(); }
});

test('request errors offer retry and empty results never fabricate standings', async () => {
  let fail = true;
  const dom = setup(async () => {
    if (fail) throw new Error('Offline');
    return response([]);
  });
  try {
    await tick();
    const doc = dom.window.document;
    assert.equal(doc.querySelector('#retry').hidden, false);
    assert.equal(doc.querySelector('#table-wrap').hidden, true);
    fail = false;
    doc.querySelector('#retry').click();
    await tick();
    assert.equal(doc.querySelector('#retry').hidden, true);
    assert.match(doc.querySelector('#board-status').textContent, /No meals/);
    assert.equal(doc.querySelectorAll('#rankings tr').length, 0);
  } finally { dom.window.close(); }
});

test('public names are text and unrecognized evolutions use a local fallback', async () => {
  const dom = setup(async () => response([{ rank: 1, name: '<img src=x onerror=alert(1)>', evolution: '../../remote', meals: 100 }]));
  try {
    await tick();
    const doc = dom.window.document;
    assert.equal(doc.querySelector('#rankings strong').textContent, '<img src=x onerror=alert(1)>');
    assert.equal(doc.querySelectorAll('[onerror]').length, 0);
    assert.equal(doc.querySelector('#rankings img').getAttribute('src'), 'assets/classic-gomi.svg');
  } finally { dom.window.close(); }
});

test('pricing agrees with the server offer and does not sell test subscriptions', () => {
  const dom = setup(async () => response([]));
  try {
    const pricing = dom.window.document.querySelector('#pricing');
    assert.match(pricing.textContent, /1,000/); assert.match(pricing.textContent, /10,000/);
    assert.match(pricing.textContent, /\$9\.99/); assert.match(pricing.textContent, /Coming soon/);
    assert.match(pricing.textContent, /midnight UTC/);
    assert.equal(pricing.querySelector('.pricing-plus a').getAttribute('href'), '#plus-details');
    assert.match(dom.window.document.querySelector('#plus-details').textContent, /Settings/);
    assert.equal(pricing.querySelectorAll('a[href*="stripe.com"]').length, 0);
  } finally { dom.window.close(); }
});
