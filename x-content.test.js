import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, attempts = 100) { for (let i = 0; i < attempts; i++) { if (fn()) return; await pause(10); } assert.ok(fn(), 'Timed out waiting for detector'); }
async function setup(settings = {}) {
  const dom = new JSDOM(source('./tests/fixtures/x-home.html'), { url: 'https://x.com/home', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 100, top: 100, width: 500, height: 300, right: 600, bottom: 400 });
  w.console.info = () => {}; w.console.warn = () => {};
  const sent = [], pending = [];
  let listener;
  let currentSettings = { enabledPlatforms: ['reddit', 'x'], mode: 'manual', categories: [], sensitivity: 'strict', ...settings };
  w.chrome = {
    runtime: {
      getURL: path => `chrome-extension://gomimon/${path}`,
      onMessage: { addListener: fn => { listener = fn; } },
      sendMessage(message, callback) {
        sent.push(message);
        if (message.type === 'GET_DETECTOR_SETTINGS') callback({ success: true, settings: currentSettings });
        else if (message.type === 'ANALYZE_CONTENT') pending.push({ message, callback });
        else callback?.({ success: true, evolution: 'baby' });
      }
    }, storage: { onChanged: { addListener() {} } }
  };
  for (const file of ['platforms.js', 'detector/revision.js', 'x-detector.js', 'detector/store.js', 'detector/policy.js', 'detector/scheduler.js', 'detector/renderer.js', 'content.js']) w.eval(source(file));
  await until(() => listener);
  return {
    dom, w, sent, pending,
    changeSettings(next) { currentSettings = { ...currentSettings, ...next }; listener({ type: 'DETECTOR_SETTINGS_UPDATED', settings: currentSettings }, {}, () => {}); },
    diagnostics() { let result; listener({ type: 'GET_DETECTOR_DIAGNOSTICS' }, {}, value => { result = value; }); return result; }
  };
}
function result(job, probability = .99) { job.callback({ success: true, revision: job.message.revision, result: { label: 'high', aiProbability: probability, categoryProbabilities: {} } }); }

test('X manual analysis sends platform and separate quotes; disabling cancels and removes presentation', async () => {
  const ctx = await setup();
  try {
    const post = ctx.w.document.querySelector('article');
    post.querySelector('[data-gomimon-action="analyze"]').click();
    await until(() => ctx.pending.length === 1);
    assert.equal(ctx.pending[0].message.platform, 'x');
    assert.match(ctx.pending[0].message.quotedText, /sports/);
    ctx.changeSettings({ enabledPlatforms: ['reddit'] });
    assert.equal(ctx.w.document.querySelector('.gomimon-ai-panel'), null);
    assert.ok(ctx.sent.some(message => message.type === 'CANCEL_DETECTOR_ANALYSIS'));
    result(ctx.pending[0]); await pause(20);
    assert.equal(post.hidden, false);
    assert.equal(ctx.sent.filter(message => message.type === 'FEED_CONTENT').length, 0);
    ctx.changeSettings({ enabledPlatforms: ['reddit', 'x'] });
    assert.ok(post.querySelector('[data-gomimon-action="analyze"]'));
  } finally { ctx.dom.window.close(); }
});

for (const showEatingAnimations of [true, false]) test(`duplicate posts share one meal and restore with animations ${showEatingAnimations ? 'on' : 'off'}`, async () => {
  const ctx = await setup({ mode: 'automatic', showEatingAnimations });
  try {
    const post = ctx.w.document.querySelector('article');
    const duplicate = post.cloneNode(true); duplicate.querySelectorAll('.gomimon-ai-panel,.gomimon-post-marker').forEach(n => n.remove());
    post.parentElement.append(duplicate);
    await until(() => ctx.pending.some(job => job.message.itemKey === 'x-post-100'));
    result(ctx.pending.find(job => job.message.itemKey === 'x-post-100'));
    await until(() => post.hidden && duplicate.hidden, 750);
    assert.equal(ctx.sent.filter(message => message.type === 'FEED_CONTENT' && message.itemKey === 'x-post-100').length, 1);
    assert.equal(ctx.w.document.querySelectorAll('.gomimon-filter-placeholder').length, 2);
    ctx.w.document.querySelector('.gomimon-filter-placeholder button').click();
    assert.equal(post.hidden, false); assert.equal(duplicate.hidden, false);
    ctx.changeSettings({ sensitivity: 'relaxed' });
    assert.equal(post.hidden, false);
    assert.equal(ctx.w.document.querySelector('.gomimon-filter-placeholder'), null);
  } finally { ctx.dom.window.close(); }
});

test('leaving home and switching to a custom list cancel work and remove controls', async () => {
  const ctx = await setup();
  try {
    const post = ctx.w.document.querySelector('article');
    post.querySelector('[data-gomimon-action="analyze"]').click();
    await until(() => ctx.pending.length === 1);
    ctx.w.history.pushState({}, '', '/author/status/100');
    await until(() => !post.querySelector('.gomimon-ai-panel'));
    result(ctx.pending[0]); await pause(20);
    assert.equal(post.hidden, false);
    ctx.w.history.pushState({}, '', '/home');
    await until(() => post.querySelector('.gomimon-ai-panel'));
    ctx.w.document.querySelector('[role="tab"][aria-selected="true"]').setAttribute('aria-selected', 'false');
    const tabs = ctx.w.document.querySelectorAll('[role="tab"]'); tabs[2].setAttribute('aria-selected', 'true');
    await until(() => !post.querySelector('.gomimon-ai-panel'));
    tabs[2].setAttribute('aria-selected', 'false'); tabs[1].setAttribute('aria-selected', 'true');
    await until(() => post.querySelector('.gomimon-ai-panel'));
  } finally { ctx.dom.window.close(); }
});

test('recycled post elements discard old scores and controls before a response arrives', async () => {
  const ctx = await setup();
  try {
    const post = ctx.w.document.querySelector('article');
    post.querySelector('[data-gomimon-action="analyze"]').click();
    await until(() => ctx.pending.length === 1);
    post.querySelector('a[href*="/status/"]').href = '/new/status/400';
    post.querySelector('[data-testid="tweetText"]').textContent = 'Another new post has enough words for the X detector.';
    await pause(20); result(ctx.pending[0]); await pause(20);
    assert.equal(post.hidden, false);
    assert.equal(post.querySelectorAll('.gomimon-ai-panel').length, 1);
    assert.equal(post.querySelector('.gomimon-ai-panel').dataset.gomimonPanelFor, 'x-post-400');
    assert.ok(post.querySelector('[data-gomimon-action="analyze"]'));
  } finally { ctx.dom.window.close(); }
});

test('local ads restore immediately when X is disabled', async () => {
  const ctx = await setup({ categories: ['ads'], showEatingAnimations: false });
  try {
    const ad = ctx.w.document.querySelector('[data-testid="placementTracking"] article');
    await until(() => ad.hidden);
    ctx.changeSettings({ enabledPlatforms: ['reddit'] });
    assert.equal(ad.hidden, false);
    assert.equal(ctx.w.document.querySelector('.gomimon-filter-placeholder'), null);
    assert.equal(ctx.w.document.querySelector('.gomimon-ai-panel'), null);
    assert.equal(ctx.pending.length, 0);
  } finally { ctx.dom.window.close(); }
});

test('a recycled element with temporarily missing identity loses its old presentation', async () => {
  const ctx = await setup();
  try {
    const post = ctx.w.document.querySelector('article');
    post.querySelector('[data-gomimon-action="analyze"]').click();
    await until(() => ctx.pending.length === 1);
    post.querySelectorAll('a[href*="/author/status/"]').forEach(link => link.removeAttribute('href'));
    await until(() => !post.querySelector('.gomimon-ai-panel'));
    result(ctx.pending[0]);
    await pause(20);
    assert.equal(post.hidden, false);
    assert.equal(post.querySelector('.gomimon-ai-panel'), null);
  } finally { ctx.dom.window.close(); }
});

test('a result arriving offscreen waits for viewport entry without feeding twice', async () => {
  const ctx = await setup({ mode: 'automatic', showEatingAnimations: true });
  try {
    const post = ctx.w.document.querySelector('article');
    await until(() => ctx.pending.some(job => job.message.itemKey === 'x-post-100'));
    let top = ctx.w.innerHeight + 200;
    post.getBoundingClientRect = () => ({ left: 100, top, width: 500, height: 300, right: 600, bottom: top + 300 });
    result(ctx.pending.find(job => job.message.itemKey === 'x-post-100'));
    await pause(20);
    assert.equal(post.hidden, false);
    assert.equal(ctx.w.document.querySelector('.gomimon-pet-overlay'), null);
    top = ctx.w.innerHeight - 20;
    ctx.w.document.dispatchEvent(new ctx.w.Event('scroll'));
    await until(() => ctx.w.document.querySelector('.gomimon-pet-overlay'));
    await until(() => post.hidden, 450);
    assert.equal(ctx.w.document.querySelector('.gomimon-pet-overlay'), null);
    assert.equal(ctx.sent.filter(message => message.type === 'FEED_CONTENT' && message.itemKey === 'x-post-100').length, 1);
  } finally { ctx.dom.window.close(); }
});
