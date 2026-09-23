import { APPLE_CREDENTIAL_SCHEMA_SQL, appleCredentialQueries } from './apple-credentials.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { IDENTITY_SCHEMA_SQL, identityQueries } from './identity-db.js';
import { BILLING_SCHEMA_SQL } from './billing-schema.js';
import { billingEntitlement, PLUS_DAILY_LIMIT } from './billing-config.js';

const { Pool } = pg;
let pool;

export function dailyCheckLimit() {
  return Number(process.env.DAILY_CHECK_LIMIT || 1000);
}

export function serverDailyCheckLimit() {
  return Number(process.env.SERVER_DAILY_CHECK_LIMIT || 100000);
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS gomimon_accounts (
  id BIGSERIAL PRIMARY KEY,
  public_key TEXT UNIQUE,
  google_subject TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

${IDENTITY_SCHEMA_SQL}
${APPLE_CREDENTIAL_SCHEMA_SQL}
ALTER TABLE gomimon_accounts ADD COLUMN IF NOT EXISTS public_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS gomimon_accounts_public_key_idx ON gomimon_accounts(public_key);

CREATE TABLE IF NOT EXISTS gomimon_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES gomimon_accounts(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gomimon_sessions_account_idx ON gomimon_sessions(account_id);
CREATE INDEX IF NOT EXISTS gomimon_sessions_expiry_idx ON gomimon_sessions(expires_at);

CREATE TABLE IF NOT EXISTS gomimon_daily_usage (
  account_id BIGINT NOT NULL REFERENCES gomimon_accounts(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL,
  successful_checks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, usage_date)
);

CREATE TABLE IF NOT EXISTS gomimon_server_usage (
  usage_date DATE PRIMARY KEY,
  successful_checks INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS gomimon_analysis_cache (
  account_id BIGINT NOT NULL REFERENCES gomimon_accounts(id) ON DELETE CASCADE,
  content_hash CHAR(64) NOT NULL,
  model_key TEXT NOT NULL,
  model TEXT NOT NULL,
  rubric_version TEXT NOT NULL,
  label TEXT,
  evidence_status TEXT NOT NULL,
  ai_probability DOUBLE PRECISION,
  evidence_probability DOUBLE PRECISION,
  category_probabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  truncated BOOLEAN NOT NULL DEFAULT FALSE,
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, content_hash, model_key, rubric_version)
);

CREATE INDEX IF NOT EXISTS gomimon_analysis_cache_expiry_idx ON gomimon_analysis_cache(analyzed_at);

CREATE TABLE IF NOT EXISTS gomimon_profiles (
  account_id BIGINT PRIMARY KEY REFERENCES gomimon_accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  leaderboard_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  lifetime_meals BIGINT NOT NULL DEFAULT 0 CHECK (lifetime_meals >= 0),
  legacy_imported_at TIMESTAMPTZ,
  evolution TEXT NOT NULL DEFAULT 'baby',
  joined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS gomimon_profiles_name_key_idx ON gomimon_profiles(name_key);
CREATE INDEX IF NOT EXISTS gomimon_profiles_leaderboard_idx
  ON gomimon_profiles(leaderboard_enabled, lifetime_meals DESC);

CREATE TABLE IF NOT EXISTS gomimon_meal_events (
  account_id BIGINT NOT NULL REFERENCES gomimon_accounts(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  food_type TEXT NOT NULL,
  evolution TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, event_id)
);

CREATE INDEX IF NOT EXISTS gomimon_meal_events_weekly_idx
  ON gomimon_meal_events(received_at, account_id);

CREATE TABLE IF NOT EXISTS gomimon_name_moderation_cache (
  name_hash CHAR(64) NOT NULL,
  rubric_version TEXT NOT NULL,
  allowed BOOLEAN NOT NULL,
  appropriate_probability DOUBLE PRECISION NOT NULL,
  model TEXT NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (name_hash, rubric_version)
);

CREATE INDEX IF NOT EXISTS gomimon_name_moderation_cache_expiry_idx
  ON gomimon_name_moderation_cache(checked_at);

-- Keep a cache stable when the SDK resolves an alias such as jev-latest to a
-- concrete provider version. These statements are safe for a fresh database
-- and migrate the first schema revision in place.
ALTER TABLE gomimon_analysis_cache ADD COLUMN IF NOT EXISTS model_key TEXT;
UPDATE gomimon_analysis_cache SET model_key = 'jev-latest' WHERE model_key IS NULL;
ALTER TABLE gomimon_analysis_cache ALTER COLUMN model_key SET DEFAULT 'jev-latest';
ALTER TABLE gomimon_analysis_cache ALTER COLUMN model_key SET NOT NULL;
ALTER TABLE gomimon_analysis_cache ALTER COLUMN evidence_probability DROP NOT NULL;
ALTER TABLE gomimon_analysis_cache ALTER COLUMN ai_probability DROP NOT NULL;
ALTER TABLE gomimon_analysis_cache ALTER COLUMN label DROP NOT NULL;
ALTER TABLE gomimon_analysis_cache ADD COLUMN IF NOT EXISTS category_probabilities JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE gomimon_analysis_cache DROP CONSTRAINT IF EXISTS gomimon_analysis_cache_pkey;
ALTER TABLE gomimon_analysis_cache ADD CONSTRAINT gomimon_analysis_cache_pkey
  PRIMARY KEY (account_id, content_hash, model_key, rubric_version);
` + BILLING_SCHEMA_SQL;

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not configured');
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
  }
  return pool;
}

function utcDate() {
  return new Date().toISOString().slice(0, 10);
}

function tokenHash(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function initDb() {
  await getPool().query(SCHEMA_SQL);
  const missingKeys = await getPool().query(
    'SELECT id FROM gomimon_accounts WHERE public_key IS NULL'
  );
  for (const row of missingKeys.rows) {
    await getPool().query(
      'UPDATE gomimon_accounts SET public_key = $1 WHERE id = $2 AND public_key IS NULL',
      [randomUUID(), row.id]
    );
  }
  await getPool().query('ALTER TABLE gomimon_accounts ALTER COLUMN public_key SET NOT NULL');
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

export async function upsertAccount({ googleSubject, email, displayName }) {
  const result = await getPool().query(
    `INSERT INTO gomimon_accounts (public_key, google_subject, email, display_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (google_subject) DO UPDATE SET
       email = EXCLUDED.email,
       display_name = EXCLUDED.display_name,
       updated_at = NOW()
     RETURNING id, public_key, email, display_name`,
    [randomUUID(), googleSubject, email, displayName || null]
  );
  return result.rows[0];
}

export async function createSession(accountId) {
  const token = randomBytes(32).toString('base64url');
  await getPool().query(
    `INSERT INTO gomimon_sessions (token_hash, account_id, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
    [tokenHash(token), accountId]
  );
  return token;
}

export async function findAccountBySession(token) {
  if (!token) return null;
  const result = await getPool().query(
    `SELECT a.id, a.public_key, a.email, a.display_name
       FROM gomimon_sessions s
       JOIN gomimon_accounts a ON a.id = s.account_id
      WHERE s.token_hash = $1 AND s.expires_at > NOW()`
    , [tokenHash(token)]
  );
  return result.rows[0] || null;
}

export async function revokeSession(token) {
  if (!token) return;
  await getPool().query('DELETE FROM gomimon_sessions WHERE token_hash = $1', [tokenHash(token)]);
}

export async function deleteAccount(accountId) {
  await getPool().query('DELETE FROM gomimon_accounts WHERE id = $1', [accountId]);
}

function profilePayload(row) {
  if (!row) return null;
  return {
    name: row.name,
    leaderboardEnabled: row.leaderboard_enabled === true,
    lifetimeMeals: Number(row.lifetime_meals || 0),
    legacyImported: Boolean(row.legacy_imported_at),
    evolution: row.evolution,
    joinedAt: row.joined_at || null
  };
}

export async function getGomimonProfile(accountId) {
  const result = await getPool().query(
    `SELECT name, leaderboard_enabled, lifetime_meals, legacy_imported_at, evolution, joined_at
       FROM gomimon_profiles
      WHERE account_id = $1`,
    [accountId]
  );
  return profilePayload(result.rows[0]);
}

export async function isGomimonNameAvailable(accountId, nameKey) {
  const result = await getPool().query(
    `SELECT 1 FROM gomimon_profiles WHERE name_key = $1 AND account_id <> $2 LIMIT 1`,
    [nameKey, accountId]
  );
  return result.rowCount === 0;
}

export async function reserveGomimonName(accountId, { name, nameKey }) {
  try {
    const result = await getPool().query(
      `INSERT INTO gomimon_profiles (account_id, name, name_key)
       VALUES ($1, $2, $3)
       ON CONFLICT (account_id) DO UPDATE SET
         name = EXCLUDED.name,
         name_key = EXCLUDED.name_key,
         updated_at = NOW()
       RETURNING name, leaderboard_enabled, lifetime_meals, legacy_imported_at, evolution, joined_at`,
      [accountId, name, nameKey]
    );
    return profilePayload(result.rows[0]);
  } catch (error) {
    if (error?.code === '23505') {
      error.code = 'NAME_TAKEN';
    }
    throw error;
  }
}

export async function getNameModeration({ nameHash, rubricVersion }) {
  const result = await getPool().query(
    `SELECT allowed, appropriate_probability, model, checked_at
       FROM gomimon_name_moderation_cache
      WHERE name_hash = $1 AND rubric_version = $2
        AND checked_at > NOW() - INTERVAL '30 days'`,
    [nameHash, rubricVersion]
  );
  if (!result.rows[0]) return null;
  return {
    allowed: result.rows[0].allowed === true,
    appropriateProbability: Number(result.rows[0].appropriate_probability),
    model: result.rows[0].model,
    checkedAt: result.rows[0].checked_at
  };
}

export async function putNameModeration({ nameHash, rubricVersion, allowed, appropriateProbability, model }) {
  await getPool().query(
    `INSERT INTO gomimon_name_moderation_cache
       (name_hash, rubric_version, allowed, appropriate_probability, model)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (name_hash, rubric_version) DO UPDATE SET
       allowed = EXCLUDED.allowed,
       appropriate_probability = EXCLUDED.appropriate_probability,
       model = EXCLUDED.model,
       checked_at = NOW()`,
    [nameHash, rubricVersion, allowed, appropriateProbability, model]
  );
}

export async function joinLeaderboard(accountId, { feedCount, evolution }) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT legacy_imported_at FROM gomimon_profiles WHERE account_id = $1 FOR UPDATE`,
      [accountId]
    );
    if (!current.rows[0]) {
      const error = new Error('Reserve a GomiMon name before joining');
      error.code = 'PROFILE_REQUIRED';
      throw error;
    }
    const importMeals = current.rows[0].legacy_imported_at ? 0 : feedCount;
    const result = await client.query(
      `UPDATE gomimon_profiles
          SET leaderboard_enabled = TRUE,
              lifetime_meals = lifetime_meals + $2,
              legacy_imported_at = COALESCE(legacy_imported_at, NOW()),
              evolution = $3,
              joined_at = COALESCE(joined_at, NOW()),
              updated_at = NOW()
        WHERE account_id = $1
        RETURNING name, leaderboard_enabled, lifetime_meals, legacy_imported_at, evolution, joined_at`,
      [accountId, importMeals, evolution]
    );
    await client.query('COMMIT');
    return profilePayload(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function leaveLeaderboard(accountId) {
  const result = await getPool().query(
    `UPDATE gomimon_profiles
        SET leaderboard_enabled = FALSE, updated_at = NOW()
      WHERE account_id = $1
      RETURNING name, leaderboard_enabled, lifetime_meals, legacy_imported_at, evolution, joined_at`,
    [accountId]
  );
  return profilePayload(result.rows[0]);
}

export async function recordMealEvents(accountId, events) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const profile = await client.query(
      `SELECT leaderboard_enabled FROM gomimon_profiles WHERE account_id = $1 FOR UPDATE`,
      [accountId]
    );
    if (!profile.rows[0]?.leaderboard_enabled) {
      const error = new Error('Join the leaderboard before recording meals');
      error.code = 'LEADERBOARD_NOT_JOINED';
      throw error;
    }
    let accepted = 0;
    for (const event of events) {
      const inserted = await client.query(
        `INSERT INTO gomimon_meal_events (account_id, event_id, food_type, evolution)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (account_id, event_id) DO NOTHING`,
        [accountId, event.id, event.foodType, event.evolution]
      );
      accepted += inserted.rowCount;
    }
    const latestEvolution = events.at(-1)?.evolution || 'baby';
    const updated = await client.query(
      `UPDATE gomimon_profiles
          SET lifetime_meals = lifetime_meals + $2,
              evolution = $3,
              updated_at = NOW()
        WHERE account_id = $1
        RETURNING lifetime_meals`,
      [accountId, accepted, latestEvolution]
    );
    await client.query('COMMIT');
    return {
      accepted,
      duplicates: events.length - accepted,
      lifetimeMeals: Number(updated.rows[0]?.lifetime_meals || 0)
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function leaderboardScoreSql(period) {
  if (period === 'weekly') {
    return `SELECT p.account_id, p.name, p.evolution, COUNT(e.event_id)::BIGINT AS meals
              FROM gomimon_profiles p
              LEFT JOIN gomimon_meal_events e
                ON e.account_id = p.account_id
               AND e.received_at >= (date_trunc('week', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
             WHERE p.leaderboard_enabled = TRUE
             GROUP BY p.account_id, p.name, p.evolution`;
  }
  return `SELECT p.account_id, p.name, p.evolution, p.lifetime_meals AS meals
            FROM gomimon_profiles p
           WHERE p.leaderboard_enabled = TRUE`;
}

function leaderboardRow(row) {
  return {
    rank: Number(row.rank),
    name: row.name,
    evolution: row.evolution,
    meals: Number(row.meals || 0)
  };
}

export async function getLeaderboard(period, limit = 20) {
  const result = await getPool().query(
    `WITH scores AS (${leaderboardScoreSql(period)}),
     ranked AS (
       SELECT account_id, name, evolution, meals,
              RANK() OVER (ORDER BY meals DESC) AS rank
         FROM scores
     )
     SELECT rank, name, evolution, meals
       FROM ranked
      ORDER BY rank ASC, LOWER(name) ASC, name ASC
      LIMIT $1`,
    [limit]
  );
  return result.rows.map(leaderboardRow);
}

export async function getLeaderboardRank(accountId, period) {
  const result = await getPool().query(
    `WITH scores AS (${leaderboardScoreSql(period)}),
     ranked AS (
       SELECT account_id, name, evolution, meals,
              RANK() OVER (ORDER BY meals DESC) AS rank
         FROM scores
     )
     SELECT rank, name, evolution, meals
       FROM ranked
      WHERE account_id = $1`,
    [accountId]
  );
  return result.rows[0] ? leaderboardRow(result.rows[0]) : null;
}

export async function getCachedAnalysis({ accountId, contentHash, modelKey, rubricVersion }) {
  const result = await getPool().query(
    `SELECT label, evidence_status, ai_probability, evidence_probability,
            category_probabilities,
            truncated, analyzed_at, model, rubric_version
       FROM gomimon_analysis_cache
      WHERE account_id = $1
        AND content_hash = $2
        AND model_key = $3
        AND rubric_version = $4
        AND analyzed_at > NOW() - INTERVAL '24 hours'`,
    [accountId, contentHash, modelKey, rubricVersion]
  );
  return result.rows[0] || null;
}

export async function insertAnalysis({ accountId, contentHash, modelKey, result }) {
  await getPool().query(
    `INSERT INTO gomimon_analysis_cache
       (account_id, content_hash, model_key, model, rubric_version, label,
        evidence_status, ai_probability, evidence_probability, category_probabilities, truncated)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (account_id, content_hash, model_key, rubric_version) DO UPDATE SET
       model = EXCLUDED.model,
       label = EXCLUDED.label,
       evidence_status = EXCLUDED.evidence_status,
       ai_probability = EXCLUDED.ai_probability,
       evidence_probability = EXCLUDED.evidence_probability,
       category_probabilities = EXCLUDED.category_probabilities,
       truncated = EXCLUDED.truncated,
       analyzed_at = NOW()`,
    [
      accountId,
      contentHash,
      modelKey,
      result.model,
      result.rubricVersion,
      result.label,
      result.evidenceStatus,
      result.aiProbability,
      result.evidenceProbability,
      JSON.stringify(result.categoryProbabilities || {}),
      result.truncated
    ]
  );
}

export async function reserveCheck(accountId) {
  const client = await getPool().connect();
  const date = utcDate();
  try {
    await client.query('BEGIN');
    const billing = await client.query('SELECT * FROM gomimon_billing WHERE account_id = $1 FOR SHARE', [accountId]);
    const limit = billingEntitlement(billing.rows[0]) === 'plus' ? PLUS_DAILY_LIMIT : dailyCheckLimit();
    const serverResult = await client.query(
      `INSERT INTO gomimon_server_usage (usage_date, successful_checks)
       VALUES ($1, 1)
       ON CONFLICT (usage_date) DO UPDATE
         SET successful_checks = gomimon_server_usage.successful_checks + 1
       WHERE gomimon_server_usage.successful_checks < $2
       RETURNING successful_checks`,
      [date, serverDailyCheckLimit()]
    );
    if (serverResult.rowCount === 0) {
      const error = new Error('Server analysis limit reached');
      error.code = 'SERVER_QUOTA_EXCEEDED';
      throw error;
    }

    const accountResult = await client.query(
      `INSERT INTO gomimon_daily_usage (account_id, usage_date, successful_checks)
       VALUES ($1, $2, 1)
       ON CONFLICT (account_id, usage_date) DO UPDATE
         SET successful_checks = gomimon_daily_usage.successful_checks + 1
       WHERE gomimon_daily_usage.successful_checks < $3
       RETURNING successful_checks`,
      [accountId, date, limit]
    );
    if (accountResult.rowCount === 0) {
      await client.query(
        `UPDATE gomimon_server_usage
            SET successful_checks = GREATEST(0, successful_checks - 1)
          WHERE usage_date = $1`,
        [date]
      );
      const error = new Error('Daily analysis limit reached');
      error.code = 'ACCOUNT_QUOTA_EXCEEDED';
      throw error;
    }

    await client.query('COMMIT');
    return {
      usageDate: date,
      used: accountResult.rows[0].successful_checks,
      limit,
      remaining: Math.max(0, limit - accountResult.rows[0].successful_checks)
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function releaseCheck(accountId, usageDate = utcDate()) {
  const date = usageDate;
  await getPool().query(
    `UPDATE gomimon_daily_usage
        SET successful_checks = GREATEST(0, successful_checks - 1)
      WHERE account_id = $1 AND usage_date = $2`,
    [accountId, date]
  );
  await getPool().query(
    `UPDATE gomimon_server_usage
        SET successful_checks = GREATEST(0, successful_checks - 1)
      WHERE usage_date = $1`,
    [date]
  );
}

export async function getUsage(accountId) {
  const date = utcDate();
  const billing = await getBilling(accountId);
  const limit = billingEntitlement(billing) === 'plus' ? PLUS_DAILY_LIMIT : dailyCheckLimit();
  const result = await getPool().query(
    `SELECT COALESCE(successful_checks, 0) AS successful_checks
       FROM gomimon_daily_usage
      WHERE account_id = $1 AND usage_date = $2`,
    [accountId, date]
  );
  const used = Number(result.rows[0]?.successful_checks || 0);
  const reset = new Date(`${date}T00:00:00.000Z`);
  reset.setUTCDate(reset.getUTCDate() + 1);
  return {
    used,
    remaining: Math.max(0, limit - used),
    limit,
    resetAt: reset.toISOString()
  };
}


export async function getBilling(accountId) {
  const result = await getPool().query('SELECT * FROM gomimon_billing WHERE account_id = $1', [accountId]);
  return result.rows[0] || null;
}

export async function findBillingCustomer(customerId) {
  const result = await getPool().query('SELECT * FROM gomimon_billing WHERE customer_id = $1', [customerId]);
  return result.rows[0] || null;
}

export async function listBillingAccounts() {
  const result = await getPool().query('SELECT account_key FROM gomimon_billing WHERE customer_id IS NOT NULL');
  return result.rows.map(row => row.account_key);
}

// The transaction and advisory lock span Stripe calls. Stripe calls have bounded
// timeouts. Both webhooks and user requests take this same cross-process lock.
export async function withBillingAccount(accountKey, fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 17))', [accountKey]);
    await client.query(`INSERT INTO gomimon_billing (account_key, account_id)
      SELECT public_key, id FROM gomimon_accounts WHERE public_key = $1
      ON CONFLICT (account_key) DO NOTHING`, [accountKey]);
    const result = await client.query('SELECT * FROM gomimon_billing WHERE account_key = $1 FOR UPDATE', [accountKey]);
    const row = result.rows[0];
    if (!row) throw new Error('Billing account no longer exists');
    const tx = {
      row,
      async save(patch) {
        const allowed = new Set(['customer_id', 'subscription_id', 'status', 'price_valid', 'paid_through',
          'cancel_at_period_end', 'grace_deadline', 'failed_invoice_id', 'pending_checkout', 'checkout_attempt',
          'checkout_started_at', 'last_synced_at', 'last_refresh_at', 'deleting', 'deleted']);
        const keys = Object.keys(patch);
        if (!keys.length) return;
        if (keys.some(key => !allowed.has(key))) throw new Error('Invalid billing field');
        await client.query(`UPDATE gomimon_billing SET ${keys.map((key, i) => `${key} = $${i + 2}`).join(', ')} WHERE account_key = $1`,
          [accountKey, ...keys.map(key => patch[key])]);
        Object.assign(row, patch);
      },
      async eventSeen(id) {
        return (await client.query('SELECT 1 FROM gomimon_billing_events WHERE event_id = $1', [id])).rowCount > 0;
      },
      async recordEvent(id) {
        await client.query('INSERT INTO gomimon_billing_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
      },
      async deleteAccount() {
        await client.query('DELETE FROM gomimon_accounts WHERE id = $1', [row.account_id]);
        row.account_id = null;
      }
    };
    const value = await fn(tx);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

// Provider identities share the same account, sessions, pet profile and quota.
export const upsertAppleAccount = input => identityQueries(getPool()).upsertAppleAccount(input);
export const linkAppleAccount = (id, input) => identityQueries(getPool()).linkAppleAccount(id, input);
export const linkGoogleAccount = (id, input) => identityQueries(getPool()).linkGoogleAccount(id, input);
export const getAccountProviders = id => identityQueries(getPool()).getAccountProviders(id);

export const saveAppleCredential = (...args) => appleCredentialQueries(getPool()).saveAppleCredential(...args);
export const appleCredentialIds = (...args) => appleCredentialQueries(getPool()).appleCredentialIds(...args);
export const pendingAppleRevocations = (...args) => appleCredentialQueries(getPool()).pendingAppleRevocations(...args);
export const processAppleRevocations = (...args) => appleCredentialQueries(getPool()).processAppleRevocations(...args);
