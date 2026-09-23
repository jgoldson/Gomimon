export const BILLING_SCHEMA_SQL = `
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
`;
