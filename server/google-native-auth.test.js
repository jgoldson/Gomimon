import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { registerNativeGoogleAuth, verifyNativeGoogleIdentity } from './google-native-auth.js';

const web = 'web-client.apps.googleusercontent.com', ios = 'ios-client.apps.googleusercontent.com';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const client = new OAuth2Client();
client.getFederatedSignonCertsAsync = async () => ({ certs: { test: publicKey.export({ type: 'spki', format: 'pem' }) }, format: 'PEM' });
function idToken(payload = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test' })).toString('base64url');
  const b = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: web, azp: ios,
    sub: 'google-user', email: 'same@example.com', email_verified: true,
    iat: now, exp: now + 300, ...payload })).toString('base64url');
  const signature = createSign('RSA-SHA256').update(`${h}.${b}`).sign(privateKey).toString('base64url');
  return `${h}.${b}.${signature}`;
}
const verify = token => verifyNativeGoogleIdentity(token, { client, audience: web, iosClientId: ios });

test('Google native identity checks signature, audience, iOS client, freshness and email', async () => {
  assert.equal((await verify(idToken())).sub, 'google-user');
  for (const payload of [{ aud: 'other' }, { azp: 'other' }, { email_verified: false },
    { iat: Math.floor(Date.now()/1000) - 1000 }, { exp: Math.floor(Date.now()/1000) - 1000 }]) {
    await assert.rejects(verify(idToken(payload)));
  }
  const parts = idToken().split('.');
  const signature = Buffer.from(parts[2], 'base64url'); signature[0] ^= 1; parts[2] = signature.toString('base64url');
  await assert.rejects(verify(parts.join('.')));
});

test('native Google exchange binds nonce, is one-use and links only to the signed-in destination', async t => {
  let time = Date.now(), created = 0, linked = 0, sessions = [];
  const app = express(); app.use(express.json());
  registerNativeGoogleAuth(app, { now: () => time, configured: () => true, verifyIdentity: verify, db: {
    findAccountBySession: async token => token === 'apple-session' ? { id: 1 } : token === 'other-session' ? { id: 3 } : null,
    getAccountProviders: async () => ['google'],
    upsertAccount: async profile => { assert.equal(profile.googleSubject, 'google-user'); created++; return { id: 2 }; },
    linkGoogleAccount: async (id, profile) => { assert.equal(id, 1); assert.equal(profile.googleSubject, 'google-user'); linked++; return { id }; },
    createSession: async id => { sessions.push(id); return `session-${id}`; }
  }});
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  async function post(path, body, auth) { return fetch(base+path, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) }); }
  async function challenge(link = false, auth) { return post('/v1/auth/google/native/challenge', { link }, auth); }
  async function exchange(c, auth, nonce = c.nonce) { return post('/v1/auth/google/native/exchange', { challengeId: c.challengeId, identityToken: idToken({ nonce }) }, auth); }
  assert.equal((await challenge(true)).status, 401);
  const c = await (await challenge()).json(); assert.equal((await exchange(c)).status, 200);
  assert.equal(created, 1); assert.deepEqual(sessions, [2]);
  assert.equal((await exchange(c)).status, 400);
  const wrong = await (await challenge()).json(); assert.equal((await exchange(wrong, null, 'wrong')).status, 400);
  const expired = await (await challenge()).json(); time += 300001; assert.equal((await exchange(expired)).status, 400);
  const swap = await (await challenge(true, 'apple-session')).json(); assert.equal((await exchange(swap, 'other-session')).status, 401);
  const link = await (await challenge(true, 'apple-session')).json(); assert.equal((await exchange(link, 'apple-session')).status, 200);
  assert.equal(linked, 1); assert.deepEqual(sessions, [2, 1]);
});
