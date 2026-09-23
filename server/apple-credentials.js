import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export const APPLE_CREDENTIAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS gomimon_apple_credentials (
  id UUID PRIMARY KEY, account_id BIGINT NOT NULL REFERENCES gomimon_accounts(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL, sealed TEXT NOT NULL, UNIQUE(account_id, client_id)
);
CREATE TABLE IF NOT EXISTS gomimon_apple_revocations (
  id UUID PRIMARY KEY, sealed TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE OR REPLACE FUNCTION gomimon_queue_apple_revocation() RETURNS trigger AS $$
BEGIN
  INSERT INTO gomimon_apple_revocations(id, sealed)
    SELECT id, sealed FROM gomimon_apple_credentials WHERE account_id = OLD.id
    ON CONFLICT(id) DO NOTHING;
  RETURN OLD;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS gomimon_account_apple_revocation ON gomimon_accounts;
CREATE TRIGGER gomimon_account_apple_revocation BEFORE DELETE ON gomimon_accounts
  FOR EACH ROW EXECUTE FUNCTION gomimon_queue_apple_revocation();
`;
function key() {
  const value = Buffer.from(process.env.APPLE_TOKEN_ENCRYPTION_KEY || '', 'base64');
  if (value.length !== 32) throw new Error('Apple token encryption is not configured');
  return value;
}
export function sealAppleCredential(value) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from('gomimon-apple-credential-v1'));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}
export function openAppleCredential(sealed) {
  const [iv, tag, encrypted] = sealed.split('.').map(part => Buffer.from(part, 'base64url'));
  const cipher = createDecipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from('gomimon-apple-credential-v1')); cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(encrypted), cipher.final()]).toString('utf8'));
}
export function appleCredentialQueries(pool) {
  return {
    async saveAppleCredential(accountId, clientId, token) {
      // Never overwrite a valid revocation token with an absent one.
      if (!token) throw new Error('Apple did not supply a revocable credential');
      const { randomUUID } = await import('node:crypto');
      await pool.query(`INSERT INTO gomimon_apple_credentials(id, account_id, client_id, sealed)
        VALUES ($1,$2,$3,$4) ON CONFLICT(account_id,client_id) DO UPDATE SET sealed=EXCLUDED.sealed`,
      [randomUUID(), accountId, clientId, sealAppleCredential({ clientId, token })]);
    },
    async appleCredentialIds(accountId) {
      return (await pool.query('SELECT id FROM gomimon_apple_credentials WHERE account_id=$1', [accountId])).rows.map(row => row.id);
    },
    async pendingAppleRevocations(ids) {
      return Number((await pool.query('SELECT count(*) FROM gomimon_apple_revocations WHERE id=ANY($1::uuid[])', [ids])).rows[0].count);
    },
    async processAppleRevocations(revoke) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query('SELECT * FROM gomimon_apple_revocations WHERE next_attempt_at <= NOW() ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED');
        for (const row of rows) {
          try {
            await revoke(openAppleCredential(row.sealed));
            await client.query('DELETE FROM gomimon_apple_revocations WHERE id=$1', [row.id]);
          } catch {
            await client.query("UPDATE gomimon_apple_revocations SET attempts=attempts+1, next_attempt_at=NOW() + LEAST(86400, 60 * power(2, LEAST(attempts,10))) * interval '1 second' WHERE id=$1", [row.id]);
          }
        }
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }
  };
}
