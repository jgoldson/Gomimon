import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { registerSafariAuth } from './safari-auth.js';

for (const provider of ['apple', 'google']) test(`${provider}: Safari PKCE, callback replay, expiry and authenticated linking`, async t => {
  let auth, sessions = 0, links = 0, saved = 0, time = Date.now();
  const app = express(); app.use(express.json());
  const db = {
    findAccountBySession: async token => token === 'same' ? { id: 1 } : token === 'other' ? { id: 2 } : null,
    upsertAppleAccount: async () => ({ id: 1 }), upsertAccount: async () => ({ id: 1 }),
    linkAppleAccount: async () => { links++; }, linkGoogleAccount: async () => { links++; },
    saveAppleCredential: async () => { saved++; }, createSession: async () => { sessions++; return 'session'; }
  };
  const apple = { authorizationURL(params) { auth = params; return 'https://appleid.apple.com/auth/authorize'; }, async exchange(code, nonce) { assert.equal(nonce, auth.nonce); return { appleSubject: 'apple-user', clientId: 'web-id', refreshToken: 'refresh', email: 'relay@privaterelay.appleid.com' }; } };
  const google = { generateAuthUrl(params) { auth = params; return 'https://accounts.google.com/test'; }, getToken: async () => ({ tokens: { id_token: 'identity' } }), verifyIdToken: async () => ({ getPayload: () => ({ sub: 'google-user', email: 'user@example.com', email_verified: true, iss: 'https://accounts.google.com', nonce: auth.nonce }) }) };
  registerSafariAuth(app, { db, createGoogleClient: () => google, apple, signingKey: () => new TextEncoder().encode('k'.repeat(32)), now: () => time });
  app.get('/auth/google/callback', (req, res) => res.sendStatus(418));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const verifier = randomBytes(32).toString('base64url'), state = randomBytes(32).toString('base64url'), challenge = createHash('sha256').update(verifier).digest('base64url');
  const post = (path, body, token) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), redirect: 'manual' });
  const callback = (cancel = false) => {
    const params = new URLSearchParams({ state: auth.state, ...(cancel ? { error: 'access_denied' } : { code: 'code' }) });
    return provider === 'apple'
      ? fetch(base + '/auth/apple/web/callback', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params, redirect: 'manual' })
      : fetch(`${base}/auth/google/callback?${params}`, { redirect: 'manual' });
  };
  async function authorize(link) {
    const start = link ? await post('/v1/auth/safari/link/start', { provider, codeChallenge: challenge, state }, 'same') : await fetch(`${base}/auth/safari/start?provider=${provider}&code_challenge=${challenge}&state=${state}`, { redirect: 'manual' });
    assert.equal(start.status, link ? 200 : 302);
    const result = await callback(); assert.equal(result.status, 303);
    const url = new URL(result.headers.get('location'), base); assert.equal(url.searchParams.get('state'), state); assert.equal(url.searchParams.has('token'), false);
    assert.equal((await callback()).status, 400);
    return url.searchParams.get('code');
  }
  assert.equal((await post('/v1/auth/safari/link/start', { provider, codeChallenge: challenge, state })).status, 401);
  const code = await authorize();
  assert.equal((await post('/v1/auth/safari/exchange', { code, codeVerifier: 'z'.repeat(43) })).status, 400);
  assert.equal(sessions, 0);
  const result = await post('/v1/auth/safari/exchange', { code, codeVerifier: verifier }); assert.equal(result.status, 200); assert.equal((await result.json()).provider, provider);
  assert.equal((await post('/v1/auth/safari/exchange', { code, codeVerifier: verifier })).status, 400);
  const expired = await authorize(); time += 61000;
  assert.equal((await post('/v1/auth/safari/exchange', { code: expired, codeVerifier: verifier })).status, 400);
  const wrong = await authorize(true);
  assert.equal((await post('/v1/auth/safari/exchange', { code: wrong, codeVerifier: verifier }, 'other')).status, 401); assert.equal(links, 0);
  const linked = await authorize(true);
  assert.equal((await post('/v1/auth/safari/exchange', { code: linked, codeVerifier: verifier }, 'same')).status, 200); assert.equal(links, 1);
  assert.equal(saved, provider === 'apple' ? 2 : 0);
  await fetch(`${base}/auth/safari/start?provider=${provider}&code_challenge=${challenge}&state=${state}`, { redirect: 'manual' });
  const cancelled = await callback(true);
  assert.equal(cancelled.status, 303);
  const cancelledURL = new URL(cancelled.headers.get('location'), base);
  assert.equal(cancelledURL.searchParams.get('error'), 'cancelled');
  assert.equal(cancelledURL.searchParams.has('code'), false);
  assert.equal((await callback()).status, 400);
  assert.equal(sessions, 2);
  assert.equal((await fetch(`${base}/auth/google/callback?state=invalid`)).status, 418);
});
