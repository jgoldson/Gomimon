import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sealAppleCredential, openAppleCredential, APPLE_CREDENTIAL_SCHEMA_SQL, appleCredentialQueries } from './apple-credentials.js';
import pg from 'pg';
process.env.APPLE_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
test('Apple credentials are encrypted and tampering is rejected', () => {
  const credential = { clientId: 'web', token: 'secret-refresh-token' };
  const sealed = sealAppleCredential(credential);
  assert.equal(sealed.includes(credential.token), false); assert.deepEqual(openAppleCredential(sealed), credential);
  const parts = sealed.split('.'); const bytes = Buffer.from(parts[2], 'base64url'); bytes[0] ^= 1; parts[2] = bytes.toString('base64url');
  assert.throws(() => openAppleCredential(parts.join('.')));
});
test('account deletion atomically queues encrypted revocation, retries outages and removes completed jobs', { skip: process.env.RUN_APPLE_CREDENTIAL_POSTGRES !== 'true' }, async t => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL }); t.after(() => pool.end());
  await pool.query('CREATE TABLE gomimon_accounts(id BIGSERIAL PRIMARY KEY); INSERT INTO gomimon_accounts DEFAULT VALUES');
  await pool.query(APPLE_CREDENTIAL_SCHEMA_SQL); await pool.query(APPLE_CREDENTIAL_SCHEMA_SQL);
  const api = appleCredentialQueries(pool);
  await api.saveAppleCredential(1, 'web', 'refresh');
  const ids = await api.appleCredentialIds(1); assert.equal(ids.length, 1);
  // Test the database trigger, independent of which client deletes the account.
  await pool.query('DELETE FROM gomimon_accounts WHERE id=1');
  assert.equal((await api.appleCredentialIds(1)).length, 0); assert.equal(await api.pendingAppleRevocations(ids), 1);
  await api.processAppleRevocations(async () => { throw new Error('Apple unavailable'); });
  assert.equal(await api.pendingAppleRevocations(ids), 1);
  assert.equal((await pool.query('SELECT attempts FROM gomimon_apple_revocations')).rows[0].attempts, 1);
  await pool.query('UPDATE gomimon_apple_revocations SET next_attempt_at=NOW()');
  // New query instance simulates restart; token survives only as ciphertext.
  await appleCredentialQueries(pool).processAppleRevocations(async value => assert.deepEqual(value, { clientId: 'web', token: 'refresh' }));
  assert.equal(await api.pendingAppleRevocations(ids), 0);
});
