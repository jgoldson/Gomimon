import 'dotenv/config';
import Stripe from 'stripe';
if (process.env.NODE_ENV === 'production' || !/^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY || '')) {
  throw new Error('Use a Stripe test key in a development/test environment.');
}
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-08-26.dahlia', timeout: 10000, maxNetworkRetries: 1 });
const lookup = 'gomimon_plus_monthly_test_v1';
const prices = await stripe.prices.list({ lookup_keys: [lookup], active: true, limit: 1 });
let price = prices.data[0];
if (!price) {
  const product = await stripe.products.create({ name: 'GomiMon Plus', description: '10,000 checks per UTC day', metadata: { gomimon: 'test' } }, { idempotencyKey: 'gomimon-test-product-v1' });
  price = await stripe.prices.create({ product: product.id, currency: 'usd', unit_amount: 999,
    recurring: { interval: 'month' }, lookup_key: lookup }, { idempotencyKey: 'gomimon-test-price-v1' });
}
const settings = { business_profile: { headline: 'Manage your GomiMon Plus subscription' },
  features: { payment_method_update: { enabled: true }, invoice_history: { enabled: true },
    subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
    subscription_update: { enabled: false } }, metadata: { gomimon: 'test-v1' } };
const configs = await stripe.billingPortal.configurations.list({ limit: 100 });
const previous = configs.data.find(c => c.metadata?.gomimon === 'test-v1');
const portal = previous ? await stripe.billingPortal.configurations.update(previous.id, { ...settings, active: true })
  : await stripe.billingPortal.configurations.create(settings, { idempotencyKey: 'gomimon-test-portal-v1' });
console.log(`STRIPE_PLUS_PRICE_ID=${price.id}\nSTRIPE_PORTAL_CONFIGURATION_ID=${portal.id}`);
