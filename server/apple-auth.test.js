import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createHash } from 'node:crypto';
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from 'jose';
import { registerAppleAuth, verifyAppleIdentity } from './apple-auth.js';

const audience = 'com.goldentechlabs.gomimon.prototype';
const { privateKey, publicKey } = await generateKeyPair('RS256');
const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: 'test', alg: 'RS256', use: 'sig' }] });
const verify = token => verifyAppleIdentity(token, { keys, clientIds: [audience] });
async function token(nonce, extra = {}) {
  return new SignJWT({ sub: 'apple-user', email: 'same@example.com', email_verified: 'true', nonce, ...extra })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer(extra.iss || 'https://appleid.apple.com')
    .setAudience(extra.aud || audience).setIssuedAt().setExpirationTime(extra.exp || '5m').sign(privateKey);
}
test('Apple signature, issuer, audience and expiration are enforced', async () => {
  assert.equal((await verify(await token('nonce'))).sub, 'apple-user');
  for (const claims of [{ iss: 'https://attacker.example' }, { aud: 'another-app' }, { exp: Math.floor(Date.now()/1000) - 60 }]) {
    await assert.rejects(verify(await token('nonce', claims)));
  }
  const good = await token('nonce');
  await assert.rejects(verify(good.slice(0, -20) + 'a'.repeat(20)));
});
test('Apple challenges are one-use, expire, and link only to an authenticated destination', async t => {
  let time = Date.now(), created = 0, linked = 0, sessions = [];
  const app = express(); app.use(express.json());
  registerAppleAuth(app, { now: () => time, verifyIdentity: verify, db: {
    findAccountBySession: async token => token === 'google-session' ? { id: 1 } : token === 'other-session' ? { id: 3 } : null,
    getAccountProviders: async id => id === 1 ? ['google', 'apple'] : ['apple'],
    upsertAppleAccount: async profile => { assert.equal(profile.email, 'same@example.com'); created++; return { id: 2 }; },
    linkAppleAccount: async (id, profile) => { assert.equal(id, 1); assert.equal(profile.appleSubject, 'apple-user'); linked++; return { id }; },
    createSession: async id => { sessions.push(id); return `session-${id}`; }
  }});
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  async function post(path, body, auth) { return fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) }); }
  async function challenge(link = false, auth) { return post('/v1/auth/apple/challenge', { link }, auth); }
  async function exchange(c, auth, nonce = createHash('sha256').update(c.nonce).digest('hex')) { return post('/v1/auth/apple/exchange', { challengeId: c.challengeId, identityToken: await token(nonce) }, auth); }
  assert.equal((await challenge(true)).status, 401);
  const c = await (await challenge()).json();
  assert.equal((await exchange(c)).status, 200);
  assert.equal(created, 1); assert.deepEqual(sessions, [2]); // Equal emails never merge.
  assert.equal((await exchange(c)).status, 400);
  const wrong = await (await challenge()).json(); assert.equal((await exchange(wrong, null, 'wrong-nonce')).status, 400);
  const expired = await (await challenge()).json(); time += 300001; assert.equal((await exchange(expired)).status, 400);
  const swapped = await (await challenge(true, 'google-session')).json(); assert.equal((await exchange(swapped, 'other-session')).status, 401);
  const link = await (await challenge(true, 'google-session')).json(); assert.equal((await exchange(link, 'google-session')).status, 200);
  assert.equal(linked, 1); assert.deepEqual(sessions, [2, 1]);
});
