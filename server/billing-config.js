export const PLUS_PRICE = Object.freeze({ amount: 999, currency: 'usd', interval: 'month' });
export const GRACE_MS = 3 * 24 * 60 * 60 * 1000;
export const PLUS_DAILY_LIMIT = 10000;

export class BillingError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function billingConfig(env = process.env) {
  if (env.BILLING_ENABLED !== 'true') return { enabled: false };
  if (!['development', 'test'].includes(env.NODE_ENV || 'development')) throw new Error('Test billing requires NODE_ENV=development or test');
  if (!/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY || '') ||
      !env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_') ||
      !env.STRIPE_PLUS_PRICE_ID?.startsWith('price_') ||
      !env.STRIPE_PORTAL_CONFIGURATION_ID?.startsWith('bpc_')) {
    throw new Error('Test billing requires test credentials, webhook secret, monthly price and portal configuration');
  }
  const base = new URL(env.BASE_URL || 'http://localhost:8090');
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/' ||
      (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname)))) {
    throw new Error('Billing BASE_URL must be an HTTPS origin or local HTTP origin');
  }
  return { enabled: true, secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    priceId: env.STRIPE_PLUS_PRICE_ID, portalConfiguration: env.STRIPE_PORTAL_CONFIGURATION_ID, baseUrl: base.origin };
}

// Entitlements have hard deadlines; a missed event must never grant indefinite access.
export function billingEntitlement(row, now = Date.now()) {
  if (!row || row.deleting || row.deleted || !row.price_valid) return 'free';
  const paidUntil = Date.parse(row.paid_through || '');
  if (row.status === 'active' && paidUntil > now) return 'plus';
  if (['active', 'past_due'].includes(row.status) && paidUntil > 0 &&
      Date.parse(row.grace_deadline || '') > now) return 'plus';
  return 'free';
}

export function billingPayload(row, config, now = Date.now()) {
  return { available: config.enabled, mode: config.enabled ? 'test' : 'disabled',
    plan: billingEntitlement(row, now), status: row?.status || 'none', price: PLUS_PRICE,
    dailyLimit: PLUS_DAILY_LIMIT, paidThrough: row?.paid_through || null,
    cancelAtPeriodEnd: Boolean(row?.cancel_at_period_end), graceDeadline: row?.grace_deadline || null,
    hasCustomer: Boolean(row?.customer_id), checkoutPending: Boolean(row?.pending_checkout),
    deleting: Boolean(row?.deleting) };
}
