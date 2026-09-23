import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createSafariAuth } from './safari-auth.js';

test('Safari login survives worker restart and rejects wrong tab, origin, state and replay', async () => {
  const data = {}; let startUrl, exchanges = 0, completed = 0, destination;
  const api = {
    storage: { local: { async get(key) { return { [key]: data[key] }; }, async set(value) { Object.assign(data, value); }, async remove(key) { delete data[key]; } } },
    runtime: { getURL: path => `safari-web-extension://test/${path}` },
    tabs: { onUpdated: { addListener() {} }, onRemoved: { addListener() {} }, async create({ url }) { startUrl = new URL(url); return { id: 7 }; }, async update(id, value) { destination = value.url; } }
  };
  const options = { api, crypto: webcrypto, complete: async token => { assert.equal(token, 'session'); completed++; }, fetch: async (url, options) => {
    exchanges++;
    const body = JSON.parse(options.body);
    const challenge = Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(body.codeVerifier))).toString('base64url');
    assert.equal(challenge, startUrl.searchParams.get('code_challenge'));
    return { ok: true, json: async () => ({ token: 'session', provider: 'google', linked: false }) };
  } };
  await createSafariAuth(options).start('https://api.example.com');
  const auth = createSafariAuth(options);
  const url = `https://api.example.com/auth/safari/complete?code=code&state=${startUrl.searchParams.get('state')}`;
  await auth.updated(8, { url });
  await auth.updated(7, { url: url.replace('api.example.com', 'evil.example.com') });
  await auth.updated(7, { url: url + 'wrong' });
  assert.equal(exchanges, 0);
  await auth.updated(7, { url });
  assert.equal(exchanges, 1); assert.equal(completed, 1);
  assert.equal(destination, 'safari-web-extension://test/popup.html');
  await auth.updated(7, { url }); assert.equal(exchanges, 1);
  await assert.rejects(auth.start('http://api.example.com'));
  await auth.start('https://api.example.com'); await auth.cancel();
  await auth.updated(7, { url }); assert.equal(exchanges, 1);
});
