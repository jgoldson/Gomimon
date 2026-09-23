import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createBilling } from './billing.js';
import { billingConfig, billingEntitlement, GRACE_MS } from './billing-config.js';
import { createApp } from './app.js';
import { fixture, config } from './test-support/billing-fixture.js';
const setup = now => { const f = fixture(); return { ...f, billing: createBilling({ db: f.db, stripe: f.stripe, config, ...(now ? { now } : {}) }) }; };
async function deliver(f, type, object, extra) { const e = f.event(type, object, extra); await f.billing.webhook(e.raw, e.signature); return e; }

test('defaults off, rejects live credentials and production test checkout', () => {
  assert.deepEqual(billingConfig({}), { enabled: false });
  const env = { BILLING_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_WEBHOOK_SECRET: 'whsec_test', STRIPE_PLUS_PRICE_ID: 'price_plus', STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_test' };
  assert.equal(billingConfig(env).enabled, true);
  for (const patch of [{ STRIPE_SECRET_KEY: 'sk_live_fake' }, { NODE_ENV: 'production' }, { BASE_URL: 'http://public.example' }]) assert.throws(() => billingConfig({ ...env, ...patch }));
});
test('concurrent checkout reuses one customer and session, with server-owned options', async () => {
  const f = setup(); const results = await Promise.all(Array.from({ length: 8 }, () => f.billing.checkout(f.account)));
  assert.equal(new Set(results.map(r => r.url)).size, 1); assert.equal(f.data.checkoutCreates, 1);
  assert.equal(f.data.calls.filter(c => c[0] === 'customer').length, 1);
  const params = f.data.calls.find(c => c[0] === 'checkout')[1];
  assert.deepEqual(params.line_items, [{ price: 'price_plus', quantity: 1 }]);
  assert.deepEqual(params.payment_method_types, ['card']);
  assert.equal((await f.billing.state(1)).plan, 'free');
});
test('rejects incorrect price and immediate portal cancellation', async () => {
  const f = setup(); f.stripe.prices.retrieve = async () => ({ active: true, livemode: false, unit_amount: 499 });
  await assert.rejects(f.billing.checkout(f.account), { code: 'BILLING_CONFIGURATION' });
  const g = setup(); g.stripe.billingPortal.configurations.retrieve = async () => ({ active: true, livemode: false, features: { subscription_cancel: { enabled: true, mode: 'immediately' } } });
  await assert.rejects(g.billing.checkout(g.account), { code: 'BILLING_CONFIGURATION' });
});
test('abandoned checkout stays free and expired checkout can be retried', async () => {
  const f = setup(); await f.billing.checkout(f.account); const session = f.data.sessions[0]; session.status = 'expired';
  await deliver(f, 'checkout.session.expired', session); await f.billing.checkout(f.account);
  assert.equal(f.data.checkoutCreates, 2); assert.equal((await f.billing.state(1)).plan, 'free');
});
test('paid invoice grants Plus, prevents second subscription and opens owned portal', async () => {
  const f = setup(); await f.billing.checkout(f.account); f.paid();
  await deliver(f, 'checkout.session.completed', { customer: 'cus_test' });
  assert.equal((await f.billing.state(1)).plan, 'plus');
  await assert.rejects(f.billing.checkout(f.account), { code: 'SUBSCRIPTION_EXISTS' });
  assert.match((await f.billing.portal(f.account)).url, /billing.stripe.com/);
  assert.equal(f.data.calls.find(c => c[0] === 'portal')[1].customer, 'cus_test');
});
test('authentication-required and unpaid active subscriptions never grant Plus', async () => {
  const f = setup(); await f.billing.checkout(f.account); const sub = f.paid({ status: 'incomplete' }); f.data.invoices = [];
  await deliver(f, 'customer.subscription.created', sub); assert.equal((await f.billing.state(1)).plan, 'free');
  sub.status = 'active'; await deliver(f, 'customer.subscription.updated', sub); assert.equal((await f.billing.state(1)).plan, 'free');
});
test('invalid signatures and live events are rejected', async () => {
  const f = setup(); await assert.rejects(f.billing.webhook(Buffer.from('{}'), 'invalid'), { code: 'INVALID_STRIPE_SIGNATURE' });
  const e = f.event('invoice.paid', { customer: 'cus_test' }, { livemode: true });
  await assert.rejects(f.billing.webhook(e.raw, e.signature), { code: 'BILLING_MODE_MISMATCH' });
});
test('duplicates and reversed events use current Stripe state', async () => {
  const f = setup(); await f.billing.checkout(f.account); const sub = f.paid();
  const e = await deliver(f, 'invoice.paid', f.data.invoices[0]); await f.billing.webhook(e.raw, e.signature);
  assert.equal(f.db.events.size, 1); sub.status = 'canceled';
  await deliver(f, 'customer.subscription.updated', { customer: 'cus_test', status: 'active' }, { created: 1 });
  assert.equal((await f.billing.state(1)).plan, 'free');
});
test('failed event persistence rolls back and retries successfully', async () => {
  const f = setup(); await f.billing.checkout(f.account); f.paid(); const e = f.event('invoice.paid', f.data.invoices[0]); f.db.failEvent = true;
  await assert.rejects(f.billing.webhook(e.raw, e.signature)); assert.equal(f.db.events.size, 0); assert.equal(f.row.status, 'none');
  f.db.failEvent = false; await f.billing.webhook(e.raw, e.signature); assert.equal((await f.billing.state(1)).plan, 'plus');
});
test('renewal grants three days, retries never extend grace, payment restores Plus', async () => {
  let current = Math.floor(Date.now()/1000)*1000; const start = current;
  const f = setup(() => current); await f.billing.checkout(f.account); const sub = f.paid({ end: start/1000 });
  const failed = { id: 'in_failed', customer: 'cus_test', status: 'open', billing_reason: 'subscription_cycle', created: start/1000, status_transitions: { finalized_at: start/1000 } };
  sub.status = 'past_due'; sub.latest_invoice = failed;
  await deliver(f, 'invoice.payment_failed', failed, { created: start/1000 }); assert.equal((await f.billing.state(1)).plan, 'plus');
  const deadline = f.row.grace_deadline; current += 2*86400000;
  await deliver(f, 'invoice.payment_failed', failed, { created: current/1000 }); assert.equal(f.row.grace_deadline, deadline);
  current = start + GRACE_MS; assert.equal((await f.billing.state(1)).plan, 'free');
  f.paid({ end: current/1000 + 30*86400 }); await deliver(f, 'invoice.paid', f.data.invoices[0]);
  assert.equal((await f.billing.state(1)).plan, 'plus'); assert.equal(f.row.grace_deadline, null);
});
test('scheduled cancellation keeps access until deadline without another event', async () => {
  let current = Date.now(); const f = setup(() => current); await f.billing.checkout(f.account);
  const sub = f.paid({ end: Math.floor(current/1000) + 60 }); sub.cancel_at_period_end = true;
  await deliver(f, 'customer.subscription.updated', sub);
  assert.equal((await f.billing.state(1)).plan, 'plus'); assert.equal((await f.billing.state(1)).cancelAtPeriodEnd, true);
  current += 61000; assert.equal((await f.billing.state(1)).plan, 'free');
});
test('refresh and reconciliation repair missed events; refresh throttles', async () => {
  const f = setup(); await f.billing.checkout(f.account); f.paid(); await f.billing.refresh(f.account);
  assert.equal((await f.billing.state(1)).plan, 'plus');
  await assert.rejects(f.billing.refresh(f.account), { code: 'BILLING_REFRESH_THROTTLED' });
  f.data.subscriptions[0].status = 'canceled'; await f.billing.reconcile(); assert.equal((await f.billing.state(1)).plan, 'free');
  f.data.failSync = true; await assert.rejects(f.billing.reconcile(), /failed reconciliation/);
});
test('deletion expires sessions, cancels subscriptions and cleans late events', async () => {
  const f = setup(); await f.billing.checkout(f.account); f.paid(); await f.billing.deleteAccount(f.account);
  assert.equal(f.db.deleted, true); assert.equal(f.row.deleted, true); assert.equal(f.data.sessions[0].status, 'expired');
  assert.equal(f.data.subscriptions[0].status, 'canceled'); f.paid();
  await deliver(f, 'customer.subscription.created', f.data.subscriptions[0]); assert.equal(f.data.subscriptions[0].status, 'canceled');
  await assert.rejects(f.billing.checkout(f.account), { code: 'ACCOUNT_DELETING' });
});
test('failed cancellation preserves account and deletion barrier for retry', async () => {
  const f = setup(); await f.billing.checkout(f.account); f.paid(); f.data.failCancel = true;
  await assert.rejects(f.billing.deleteAccount(f.account)); assert.equal(f.db.deleted, false); assert.equal(f.row.deleting, true);
  await assert.rejects(f.billing.checkout(f.account), { code: 'ACCOUNT_DELETING' });
  f.data.failCancel = false; await f.billing.deleteAccount(f.account); assert.equal(f.db.deleted, true);
});
test('unsupported price, deleted account, unpaid and trial states fail closed', () => {
  const row = { status: 'active', price_valid: true, paid_through: new Date(Date.now()+10000).toISOString() };
  assert.equal(billingEntitlement(row), 'plus');
  for (const patch of [{ price_valid: false }, { deleting: true }, { deleted: true }, { status: 'unpaid' }, { status: 'trialing' }, { paid_through: null }]) assert.equal(billingEntitlement({ ...row, ...patch }), 'free');
});
test('HTTP auth, client-option rejection, raw-body signature and account response', async t => {
  const f = setup(); const server = createServer(createApp({ db: f.db, stripe: f.stripe, billingConfig: config }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, auth = true) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer valid-token' } : {}) }, body: JSON.stringify(body) });
  assert.equal((await post('/v1/billing/checkout', {}, false)).status, 401);
  for (const action of ['checkout', 'portal', 'refresh']) assert.equal((await post(`/v1/billing/${action}`, { customer: 'cus_other' })).status, 400);
  assert.equal((await post('/v1/billing/checkout', {})).status, 200); f.paid(); const e = f.event('invoice.paid', f.data.invoices[0]);
  assert.equal((await fetch(`${base}/v1/billing/webhook`, { method: 'POST', body: e.raw, headers: { 'content-type': 'application/json', 'stripe-signature': e.signature } })).status, 200);
  const response = await fetch(`${base}/v1/account`, { headers: { authorization: 'Bearer valid-token' } });
  assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal((await response.json()).billing.plan, 'plus');
  assert.doesNotMatch(await (await fetch(`${base}/billing/return?result=%3Cscript%3E`)).text(), /<script>/);
});

test('checkout retry after a local save failure recovers the session after intent rollover', async () => {
  let current = Date.now(); const f = setup(() => current);
  const create = f.stripe.checkout.sessions.create; let failOnce = true;
  f.stripe.checkout.sessions.create = async (...args) => {
    const result = await create(...args);
    if (failOnce) { failOnce = false; f.db.failSave = true; }
    return result;
  };
  await assert.rejects(f.billing.checkout(f.account));
  assert.equal(f.data.checkoutCreates, 1); assert.equal(f.row.pending_checkout, null);
  f.db.failSave = false; current += 2*3600000; await f.billing.checkout(f.account);
  assert.equal(f.data.checkoutCreates, 1);
  const calls = f.data.calls.filter(c => c[0] === 'checkout');
  assert.equal(calls.length, 1);
  assert.equal(f.row.pending_checkout.id, f.data.sessions[0].id);
});

test('first observed renewal retry cannot extend grace beyond original invoice failure window', async () => {
  const start = Math.floor(Date.now()/1000)*1000; let current = start;
  const f = setup(() => current); await f.billing.checkout(f.account);
  const sub = f.paid({ end: start/1000 });
  const failed = { id: 'in_failed', customer: 'cus_test', status: 'open', billing_reason: 'subscription_cycle',
    created: start/1000, status_transitions: { finalized_at: start/1000 } };
  sub.status = 'past_due'; sub.latest_invoice = failed;
  current += 2*86400000;
  await deliver(f, 'invoice.payment_failed', failed, { created: current/1000 });
  assert.equal(Date.parse(f.row.grace_deadline), start + GRACE_MS);
  current = start + GRACE_MS;
  assert.equal((await f.billing.state(1)).plan, 'free');
});

test('checkout can retry after 31 minutes without an invalid absolute expiration', async () => {
  let current = Date.now(); const f = setup(() => current);
  const create = f.stripe.checkout.sessions.create; let failOnce = true;
  f.stripe.checkout.sessions.create = async (...args) => {
    if (failOnce) { failOnce = false; throw new Error('Stripe unavailable before creation'); }
    assert.equal(args[0].expires_at, undefined);
    return create(...args);
  };
  await assert.rejects(f.billing.checkout(f.account));
  const attempt = f.row.checkout_attempt;
  current += 31*60000;
  await f.billing.checkout(f.account);
  assert.equal(f.row.checkout_attempt, attempt);
  assert.equal(f.data.checkoutCreates, 1);
});

test('a late event recovers customer mapping after deletion and cancels its subscription', async () => {
  const f = setup(); await f.billing.checkout(f.account); f.paid();
  f.row.customer_id = null; f.row.deleted = true; f.row.deleting = true;
  await deliver(f, 'customer.subscription.created', f.data.subscriptions[0]);
  assert.equal(f.row.customer_id, 'cus_test'); assert.equal(f.data.subscriptions[0].status, 'canceled');
});
