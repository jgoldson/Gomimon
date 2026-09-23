CREATE TABLE IF NOT EXISTS gomimon_accounts (
  id BIGSERIAL PRIMARY KEY,
  public_key TEXT UNIQUE,
  google_subject TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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



CREATE TABLE IF NOT EXISTS gomimon_billing (
  account_key TEXT PRIMARY KEY,
  account_id BIGINT UNIQUE REFERENCES gomimon_accounts(id) ON DELETE SET NULL,
  customer_id TEXT UNIQUE,
  subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'none',
  price_valid BOOLEAN NOT NULL DEFAULT FALSE,
  paid_through TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  grace_deadline TIMESTAMPTZ,
  failed_invoice_id TEXT,
  pending_checkout JSONB,
  checkout_attempt TEXT,
  checkout_started_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  last_refresh_at TIMESTAMPTZ,
  deleting BOOLEAN NOT NULL DEFAULT FALSE,
  deleted BOOLEAN NOT NULL DEFAULT FALSE
);
ALTER TABLE gomimon_billing ADD COLUMN IF NOT EXISTS checkout_started_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS gomimon_billing_events (
  event_id TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
