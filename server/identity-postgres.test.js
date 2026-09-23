import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { IDENTITY_SCHEMA_SQL, identityQueries } from './identity-db.js';

test('provider migration preserves Google identities; linking is unique and never merges by email', { skip: process.env.RUN_IDENTITY_POSTGRES !== 'true' }, async t => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL }); t.after(() => pool.end());
  await pool.query(`CREATE TABLE gomimon_accounts(id BIGSERIAL PRIMARY KEY, public_key TEXT UNIQUE NOT NULL,
    google_subject TEXT NOT NULL UNIQUE, email TEXT NOT NULL, display_name TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    INSERT INTO gomimon_accounts(public_key,google_subject,email) VALUES ('legacy','google-original','shared@example.com');`);
  await pool.query(IDENTITY_SCHEMA_SQL); await pool.query(IDENTITY_SCHEMA_SQL);
  const api = identityQueries(pool);
  assert.deepEqual(await api.getAccountProviders(1), ['google']);
  const apple = await api.upsertAppleAccount({ appleSubject: 'apple-original', email: 'shared@example.com' });
  assert.notEqual(String(apple.id), '1');
  assert.equal((await api.upsertAppleAccount({ appleSubject: 'apple-original' })).id, apple.id);
  await assert.rejects(api.linkAppleAccount(1, { appleSubject: 'apple-original' }), e => e.code === 'IDENTITY_CONFLICT');
  await api.linkAppleAccount(1, { appleSubject: 'apple-linked' });
  assert.deepEqual(await api.getAccountProviders(1), ['apple', 'google']);
  await assert.rejects(api.linkAppleAccount(1, { appleSubject: 'apple-replacement' }), e => e.code === 'IDENTITY_CONFLICT');
  await api.linkGoogleAccount(apple.id, { googleSubject: 'google-linked' });
  await assert.rejects(api.linkGoogleAccount(apple.id, { googleSubject: 'google-original' }), e => e.code === 'IDENTITY_CONFLICT');
  const concurrent = await Promise.all(Array.from({ length: 5 }, () => api.upsertAppleAccount({ appleSubject: 'concurrent', email: 'other@example.com' })));
  assert.equal(new Set(concurrent.map(row => row.id)).size, 1);
  const legacy = (await pool.query('SELECT google_subject, public_key FROM gomimon_accounts WHERE id = 1')).rows[0];
  assert.deepEqual(legacy, { google_subject: 'google-original', public_key: 'legacy' });
});
