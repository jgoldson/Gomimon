import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let i = 0; i < 120; i++) { if (fn()) return; await pause(10); } assert.ok(fn(), 'Detector did not reach expected state'); }
for (const platform of ['reddit', 'x']) {
  test(`${platform}: upgrade resumes a manual check deferred until daily reset`, async () => {
    const html = platform === 'x' ? source('./tests/fixtures/x-home.html') : `<shreddit-post thingid="t3_billing"><h3 slot="title">A post about interesting things</h3><div slot="text-body">${'A normal sentence with enough words to analyze. '.repeat(8)}</div></shreddit-post>`;
    const dom = new JSDOM(html, { url: platform === 'x' ? 'https://x.com/home' : 'https://www.reddit.com/', runScripts: 'outside-only', pretendToBeVisual: true });
    try {
      const w = dom.window; w.console.info = () => {}; w.console.warn = () => {};
      const pending = []; let listener;
      w.chrome = { runtime: { getURL: path => `chrome-extension://gomimon/${path}`,
        onMessage: { addListener(fn) { listener = fn; } },
        sendMessage(message, callback) {
          if (message.type === 'GET_DETECTOR_SETTINGS') callback({ success: true, settings: { enabledPlatforms: ['reddit', 'x'], mode: 'manual', categories: [], sensitivity: 'strict' } });
          else if (message.type === 'ANALYZE_CONTENT') pending.push({ message, callback });
          else callback?.({ success: true });
        } }, storage: { onChanged: { addListener() {} } } };
      for (const file of ['platforms.js', 'detector/revision.js', `${platform === 'x' ? 'x' : 'reddit'}-detector.js`, 'detector/store.js', 'detector/policy.js', 'detector/scheduler.js', 'detector/renderer.js', 'content.js']) w.eval(source(`./${file}`));
      await until(() => w.document.querySelector('[data-gomimon-action="analyze"]'));
      w.document.querySelector('[data-gomimon-action="analyze"]').click();
      await until(() => pending.length === 1);
      pending[0].callback({ success: false, error: { code: 'QUOTA_EXCEEDED', scope: 'account', resetAt: new Date(Date.now()+86400000).toISOString(), message: 'Daily limit reached' } });
      await pause(20);
      listener({ type: 'DETECTOR_QUOTA_UPDATED', quota: { used: 1000, limit: 10000, remaining: 9000 } }, {}, () => {});
      await until(() => pending.length === 2);
      assert.equal(pending[1].message.itemKey, pending[0].message.itemKey);
      pending[1].callback({ success: true, revision: pending[1].message.revision, result: { label: 'low', aiProbability: .1, categoryProbabilities: {} } });
      await pause(20);
      assert.equal(pending.length, 2);
    } finally { dom.window.close(); }
  });
}
