import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { decodeJwt } from 'jose';
import { registerMobileAuth } from './mobile-auth.js';

test('mobile auth binds verified Google login to PKCE, expires codes and consumes them once', async t => {
  let oauth, time = Date.now(), sessions = 0;
  const client = {
    generateAuthUrl(params) { oauth = params; return 'https://accounts.google.com/test'; },
    async getToken() { return { tokens: { id_token: 'test' } }; },
    async verifyIdToken() { return { getPayload: () => ({ sub: 'test', email: 'test@example.com', email_verified: true, iss: 'https://accounts.google.com', nonce: oauth.nonce }) }; }
  };
  const app = express(); app.use(express.json());
  registerMobileAuth(app, { db: { upsertAccount: async () => ({ id: 1 }), createSession: async () => { sessions++; return 'test-session'; } }, createGoogleClient: () => client, signingKey: () => new TextEncoder().encode('a'.repeat(32)), now: () => time });
  app.get('/auth/google/callback', (req, res) => res.status(418).end());
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const verifier = randomBytes(32).toString('base64url'), state = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  async function authorization() {
    const start = await fetch(`${base}/auth/mobile/start?code_challenge=${challenge}&state=${state}`, { redirect: 'manual' });
    assert.equal(start.status, 302);
    assert.equal(decodeJwt(oauth.state).aud, 'gomimon-mobile');
    const callback = await fetch(`${base}/auth/google/callback?state=${oauth.state}&code=test`, { redirect: 'manual' });
    assert.equal(callback.status, 302);
    const url = new URL(callback.headers.get('location'));
    assert.equal(url.origin, 'null'); assert.equal(url.host, 'auth');
    assert.equal(url.searchParams.get('token'), null);
    assert.equal(url.searchParams.get('state'), state);
    return url.searchParams.get('code');
  }
  async function exchange(code, codeVerifier) {
    return fetch(`${base}/v1/auth/mobile/exchange`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, codeVerifier }) });
  }
  assert.equal((await fetch(`${base}/auth/mobile/start?code_challenge=bad&state=bad`)).status, 400);
  const code = await authorization();
  assert.equal((await exchange(code, 'b'.repeat(43))).status, 400);
  assert.equal(sessions, 0);
  const valid = await exchange(code, verifier);
  assert.equal(valid.status, 200); assert.equal((await valid.json()).token, 'test-session');
  assert.equal((await exchange(code, verifier)).status, 400); assert.equal(sessions, 1);
  const expired = await authorization(); time += 61000;
  assert.equal((await exchange(expired, verifier)).status, 400);
  assert.equal((await fetch(`${base}/auth/google/callback?state=invalid`)).status, 418);
});

test('linking Google requires the same authenticated account and PKCE before changing identities', async t => {
  let oauth, linked = 0, created = 0;
  const app = express(); app.use(express.json());
  registerMobileAuth(app, { signingKey: () => new TextEncoder().encode('s'.repeat(32)), db: {
    findAccountBySession: async token => token === 'apple-session' ? { id: 10 } : token === 'other-session' ? { id: 11 } : null,
    upsertAccount: async () => { created++; return { id: 20 }; },
    linkGoogleAccount: async (id, profile) => { assert.equal(id, 10); assert.equal(profile.googleSubject, 'google-sub'); linked++; },
    createSession: async id => `session-${id}`
  }, createGoogleClient: () => ({
    generateAuthUrl(params) { oauth = params; return 'https://accounts.google.com/test'; },
    async getToken() { return { tokens: { id_token: 'test' } }; },
    async verifyIdToken() { return { getPayload: () => ({ sub: 'google-sub', email: 'test@example.com', email_verified: true, iss: 'https://accounts.google.com', nonce: oauth.nonce }) }; }
  }) });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const verifier = randomBytes(32).toString('base64url');
  const payload = { codeChallenge: createHash('sha256').update(verifier).digest('base64url'), state: randomBytes(32).toString('base64url') };
  const post = (path, body, auth) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) });
  assert.equal((await post('/v1/auth/mobile/link/start', payload)).status, 401);
  async function authorize() {
    const start = await post('/v1/auth/mobile/link/start', payload, 'apple-session');
    const { ticket } = await start.json();
    assert.equal((await fetch(`${base}/auth/mobile/start?link_ticket=${ticket}`, { redirect: 'manual' })).status, 302);
    const callback = await fetch(`${base}/auth/google/callback?state=${oauth.state}&code=test`, { redirect: 'manual' });
    assert.equal(callback.status, 302);
    assert.equal(linked, 0); assert.equal(created, 0);
    return new URL(callback.headers.get('location')).searchParams.get('code');
  }
  const stolen = await authorize();
  assert.equal((await post('/v1/auth/mobile/exchange', { code: stolen, codeVerifier: verifier }, 'other-session')).status, 401);
  const code = await authorize();
  assert.equal((await post('/v1/auth/mobile/exchange', { code, codeVerifier: 'z'.repeat(43) }, 'apple-session')).status, 400);
  assert.equal(linked, 0);
  const success = await post('/v1/auth/mobile/exchange', { code, codeVerifier: verifier }, 'apple-session');
  assert.equal(success.status, 200); assert.equal((await success.json()).token, 'session-10'); assert.equal(linked, 1);
});
