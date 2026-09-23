import { randomUUID } from 'node:crypto';

export const IDENTITY_SCHEMA_SQL = `
ALTER TABLE gomimon_accounts ALTER COLUMN google_subject DROP NOT NULL;
ALTER TABLE gomimon_accounts ADD COLUMN IF NOT EXISTS apple_subject TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS gomimon_accounts_apple_subject_idx ON gomimon_accounts(apple_subject);
`;

function conflict() {
  return Object.assign(new Error('This sign-in already belongs to another GomiMon account, or this account already has that provider linked. Sign in to the original account instead.'), { status: 409, code: 'IDENTITY_CONFLICT' });
}
export function identityQueries(pool) {
  async function link(accountId, provider, subject) {
    const column = provider === 'apple' ? 'apple_subject' : 'google_subject';
    try {
      const result = await pool.query(`UPDATE gomimon_accounts SET ${column} = $2, updated_at = NOW()
        WHERE id = $1 AND (${column} IS NULL OR ${column} = $2)
        RETURNING id, public_key, email, display_name`, [accountId, subject]);
      if (!result.rows[0]) throw conflict();
      return result.rows[0];
    } catch (error) { if (error.code === '23505') throw conflict(); throw error; }
  }
  return {
    async upsertAppleAccount({ appleSubject, email, displayName }) {
      // Apple may omit optional profile information on subsequent authorization.
      const existing = await pool.query('SELECT id, public_key, email, display_name FROM gomimon_accounts WHERE apple_subject = $1', [appleSubject]);
      if (existing.rows[0]) return existing.rows[0];
      if (!email) throw Object.assign(new Error('Apple did not supply a verified email for this new account. Try authorizing again.'), { status: 400 });
      const result = await pool.query(`INSERT INTO gomimon_accounts (public_key, apple_subject, email, display_name)
        VALUES ($1, $2, $3, $4) ON CONFLICT (apple_subject) DO UPDATE SET updated_at = NOW()
        RETURNING id, public_key, email, display_name`, [randomUUID(), appleSubject, email, displayName || null]);
      return result.rows[0];
    },
    linkAppleAccount: (id, profile) => link(id, 'apple', profile.appleSubject),
    linkGoogleAccount: (id, profile) => link(id, 'google', profile.googleSubject),
    async getAccountProviders(id) {
      const result = await pool.query('SELECT google_subject IS NOT NULL AS google, apple_subject IS NOT NULL AS apple FROM gomimon_accounts WHERE id = $1', [id]);
      const row = result.rows[0];
      return row ? ['apple', 'google'].filter(provider => row[provider]) : [];
    }
  };
}
