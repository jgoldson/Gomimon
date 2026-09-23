import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { BillingError, billingConfig, billingPayload, GRACE_MS, PLUS_PRICE } from './billing-config.js';
import { logEvent } from './logging.js';

const terminal = new Set(['canceled', 'incomplete_expired']);
const idOf = value => typeof value === 'string' ? value : value?.id;
const iso = seconds => Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
const linePrice = line => idOf(line.pricing?.price_details?.price || line.price);

export function createBilling({ db, stripe, config = billingConfig(), now = Date.now } = {}) {
  const client = stripe || (config.enabled ? new Stripe(config.secretKey, { apiVersion: '2026-08-26.dahlia', timeout: 8000, maxNetworkRetries: 1 }) : null);
  let catalogPromise;
  function requireEnabled() {
    if (!config.enabled) throw new BillingError(503, 'BILLING_UNAVAILABLE', 'Subscriptions are not available yet.');
  }
  async function validateCatalog() {
    requireEnabled();
    if (!catalogPromise) catalogPromise = (async () => {
      const [price, portal] = await Promise.all([
        client.prices.retrieve(config.priceId), client.billingPortal.configurations.retrieve(config.portalConfiguration)
      ]);
      if (price.livemode !== false || !price.active || price.unit_amount !== PLUS_PRICE.amount ||
          price.currency !== PLUS_PRICE.currency || price.recurring?.interval !== 'month' ||
          price.recurring?.interval_count !== 1 || price.recurring?.usage_type !== 'licensed' ||
          portal.livemode !== false || !portal.active || !portal.features?.subscription_cancel?.enabled ||
          portal.features.subscription_cancel.mode !== 'at_period_end' ||
          !portal.features?.payment_method_update?.enabled || !portal.features?.invoice_history?.enabled ||
          portal.features?.subscription_update?.enabled || portal.features?.subscription_pause?.enabled) {
        throw new BillingError(503, 'BILLING_CONFIGURATION', 'Subscription configuration needs attention.');
      }
    })().catch(error => { catalogPromise = null; throw error; });
    return catalogPromise;
  }
  async function subscriptions(customer) {
    const list = await client.subscriptions.list({ customer, status: 'all', limit: 100, expand: ['data.latest_invoice'] });
    if (list.has_more) throw new BillingError(503, 'BILLING_REVIEW_REQUIRED', 'Billing history needs review.');
    if (list.data.some(sub => sub.livemode !== false || idOf(sub.customer) !== customer)) {
      throw new BillingError(503, 'BILLING_MODE_MISMATCH', 'Billing account configuration needs attention.');
    }
    return list.data;
  }
  async function cancelEverything(tx) {
    const row = tx.row;
    if (!row.customer_id) return;
    // List as well as checking the saved session: handles a Stripe success followed
    // by a local transaction failure before the session ID could be persisted.
    const sessions = await client.checkout.sessions.list({ customer: row.customer_id, status: 'open', limit: 100 });
    if (sessions.has_more) throw new Error('Too many open checkout sessions');
    for (const session of sessions.data) {
      try { await client.checkout.sessions.expire(session.id); }
      catch (error) {
        const current = await client.checkout.sessions.retrieve(session.id);
        if (current.status === 'open') throw error;
      }
    }
    for (const sub of await subscriptions(row.customer_id)) {
      if (!terminal.has(sub.status)) await client.subscriptions.cancel(sub.id, { prorate: false, invoice_now: false });
    }
    if ((await subscriptions(row.customer_id)).some(sub => !terminal.has(sub.status))) {
      throw new Error('Subscription cancellation is still pending');
    }
    await tx.save({ status: 'canceled', price_valid: false, grace_deadline: null, pending_checkout: null });
  }
  async function sync(tx, event) {
    const row = tx.row;
    if (row.deleting || row.deleted) {
      await cancelEverything(tx);
      await tx.save({ last_synced_at: new Date(now()).toISOString() });
      return;
    }
    if (!row.customer_id) return;
    const all = await subscriptions(row.customer_id);
    const ongoing = all.filter(sub => !terminal.has(sub.status));
    if (ongoing.length > 1) throw new BillingError(409, 'DUPLICATE_SUBSCRIPTION', 'Multiple subscriptions need billing support.');
    const sub = ongoing[0] || all.sort((a, b) => b.created - a.created)[0];
    if (!sub) {
      await tx.save({ status: 'none', price_valid: false, last_synced_at: new Date(now()).toISOString() });
      return;
    }
    const items = sub.items?.data || [];
    const valid = items.length === 1 && idOf(items[0].price) === config.priceId && items[0].quantity === 1;
    let paidThrough = row.subscription_id === sub.id ? row.paid_through : null;
    if (valid) {
      const invoices = await client.invoices.list({ subscription: sub.id, status: 'paid', limit: 100 });
      // Recent paid invoices suffice: keep the greatest verified coverage deadline.
      for (const invoice of invoices.data) {
        if (invoice.livemode !== false || invoice.status !== 'paid' || invoice.amount_paid < PLUS_PRICE.amount || invoice.currency !== 'usd') continue;
        for (const line of invoice.lines?.data || []) {
          if (linePrice(line) !== config.priceId || !Number.isFinite(line.period?.end) ||
              line.parent?.subscription_item_details?.proration || line.proration) continue;
          const end = iso(line.period.end);
          if (!paidThrough || Date.parse(end) > Date.parse(paidThrough)) paidThrough = end;
        }
      }
    }
    let invoice = sub.latest_invoice;
    if (typeof invoice === 'string') invoice = await client.invoices.retrieve(invoice);
    let grace = null;
    let failedInvoice = null;
    if (valid && paidThrough && invoice?.status === 'open' && invoice.billing_reason === 'subscription_cycle' &&
        ['active', 'past_due'].includes(sub.status) && (sub.status === 'past_due' || invoice.attempted)) {
      failedInvoice = invoice.id;
      const same = row.failed_invoice_id === invoice.id;
      const finalized = invoice.status_transitions?.finalized_at || invoice.created;
      const failure = event?.type === 'invoice.payment_failed' && event.data.object.id === invoice.id
        ? Math.min(event.created, finalized) : finalized;
      // Use invoice finalization as the conservative fallback if the failure event
      // was missed. Never extend grace on retries, replay, or late delivery.
      const start = failure * 1000;
      grace = new Date(Math.min(start + GRACE_MS,
        same && row.grace_deadline ? Date.parse(row.grace_deadline) : Infinity)).toISOString();
    }
    await tx.save({ subscription_id: sub.id, status: sub.status, price_valid: valid,
      paid_through: paidThrough, cancel_at_period_end: Boolean(sub.cancel_at_period_end),
      grace_deadline: grace, failed_invoice_id: failedInvoice,
      ...(!terminal.has(sub.status) ? { pending_checkout: null, checkout_attempt: null } : {}),
      last_synced_at: new Date(now()).toISOString() });
    logEvent('billing.synced', { status: sub.status, plan: billingPayload(row, config, now()).plan });
  }
  async function state(accountId) {
    return billingPayload(await db.getBilling?.(accountId), config, now());
  }
  async function checkout(account) {
    await validateCatalog();
    // Persist the intent before making external calls so failed transactions can
    // retry with the same Stripe idempotency key, including across processes.
    await db.withBillingAccount(account.public_key, async tx => {
      if (tx.row.deleting || tx.row.deleted) throw new BillingError(409, 'ACCOUNT_DELETING', 'Account deletion is in progress.');
      // Recover a session created before a failed local commit, including after
      // the intent ages out. Never rotate its idempotency key while it is open.
      if (tx.row.customer_id && !tx.row.pending_checkout) {
        const open = await client.checkout.sessions.list({ customer: tx.row.customer_id, status: 'open', limit: 100 });
        if (open.has_more || open.data.length > 1) throw new BillingError(409, 'BILLING_REVIEW_REQUIRED', 'Multiple checkout sessions need billing support.');
        if (open.data[0]) await tx.save({ pending_checkout: { id: open.data[0].id, expiresAt: open.data[0].expires_at * 1000 } });
      }
      if (!tx.row.pending_checkout && (!tx.row.checkout_attempt || (Date.parse(tx.row.checkout_started_at || '') + 3600000 <= now()))) {
        await tx.save({ checkout_attempt: randomUUID(), checkout_started_at: new Date(now()).toISOString(), pending_checkout: null });
      }
      if (!tx.row.customer_id) {
        const customer = await client.customers.create({ email: account.email, metadata: { gomimon_account: account.public_key } },
          { idempotencyKey: `gomimon-customer-${account.public_key}` });
        await tx.save({ customer_id: customer.id });
      }
    });
    const result = await db.withBillingAccount(account.public_key, async tx => {
      const row = tx.row;
      if (row.deleting || row.deleted) throw new BillingError(409, 'ACCOUNT_DELETING', 'Account deletion is in progress.');
      await sync(tx);
      if (row.subscription_id && !terminal.has(row.status) && row.status !== 'none') {
        throw new BillingError(409, 'SUBSCRIPTION_EXISTS', 'You already have a subscription. Use Manage billing.');
      }
      if (row.pending_checkout) {
        const existing = await client.checkout.sessions.retrieve(row.pending_checkout.id);
        if (existing.status === 'open') return { url: existing.url };
        await tx.save({ pending_checkout: null, checkout_attempt: null });
        return { retry: true };
      }
      const session = await client.checkout.sessions.create({ mode: 'subscription', customer: row.customer_id,
        client_reference_id: account.public_key, line_items: [{ price: config.priceId, quantity: 1 }],
        payment_method_types: ['card'], allow_promotion_codes: false,
        subscription_data: { metadata: { gomimon_account: account.public_key } },
        success_url: `${config.baseUrl}/billing/return?result=success`, cancel_url: `${config.baseUrl}/billing/return?result=cancel`
        // Stripe's default 24-hour expiry avoids a stale absolute timestamp on
        // delayed retries. All request parameters remain stable for idempotency.
      }, { idempotencyKey: `gomimon-checkout-${row.checkout_attempt}` });
      await tx.save({ pending_checkout: { id: session.id, expiresAt: session.expires_at * 1000 } });
      return { url: session.url };
    });
    if (result.retry) throw new BillingError(409, 'CHECKOUT_FINISHED', 'Checkout has finished. Refresh your plan before trying again.');
    return result;
  }
  async function portal(account) {
    await validateCatalog();
    return db.withBillingAccount(account.public_key, async tx => {
      if (!tx.row.customer_id || tx.row.deleted || tx.row.deleting) throw new BillingError(409, 'NO_BILLING_ACCOUNT', 'No billing account is available.');
      const session = await client.billingPortal.sessions.create({ customer: tx.row.customer_id,
        configuration: config.portalConfiguration, return_url: `${config.baseUrl}/billing/return?result=portal` });
      return { url: session.url };
    });
  }
  async function refresh(account) {
    requireEnabled();
    return db.withBillingAccount(account.public_key, async tx => {
      if (Date.parse(tx.row.last_refresh_at || '') + 5000 > now()) {
        throw new BillingError(429, 'BILLING_REFRESH_THROTTLED', 'Wait a few seconds before refreshing again.');
      }
      await sync(tx);
      await tx.save({ last_refresh_at: new Date(now()).toISOString() });
    });
  }
  async function deleteAccount(account) {
    const existing = await db.getBilling?.(account.id);
    if (existing?.customer_id) requireEnabled();
    // Persist the deletion barrier even if Stripe is temporarily unavailable.
    await db.withBillingAccount(account.public_key, tx => tx.save({ deleting: true }));
    return db.withBillingAccount(account.public_key, async tx => {
      await cancelEverything(tx);
      await tx.save({ deleted: true, deleting: true, price_valid: false });
      await tx.deleteAccount();
    });
  }
  async function webhook(raw, signature) {
    requireEnabled();
    let event;
    try { event = client.webhooks.constructEvent(raw, signature, config.webhookSecret); }
    catch { throw new BillingError(400, 'INVALID_STRIPE_SIGNATURE', 'Invalid webhook signature.'); }
    if (event.livemode !== false) throw new BillingError(400, 'BILLING_MODE_MISMATCH', 'Live events are not accepted.');
    const supported = ['checkout.session.completed', 'checkout.session.expired', 'customer.subscription.created',
      'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed'];
    if (!supported.includes(event.type)) return;
    const customerId = idOf(event.data.object.customer);
    if (!customerId) return;
    let owner = await db.findBillingCustomer(customerId);
    if (!owner) {
      // A customer can exist at Stripe before our transaction commits. Its metadata
      // locates the lock; only the persisted customer mapping can grant access.
      const customer = await client.customers.retrieve(customerId);
      const key = customer.metadata?.gomimon_account;
      if (!key) return; // Another product using the same Stripe sandbox.
      if (customer.livemode !== false) throw new Error('Customer mode mismatch');
      owner = { account_key: key };
    }
    await db.withBillingAccount(owner.account_key, async tx => {
      if (await tx.eventSeen(event.id)) return;
      if (!tx.row.customer_id) await tx.save({ customer_id: customerId });
      if (tx.row.customer_id !== customerId) throw new Error('Billing customer mapping conflicts');
      await sync(tx, event);
      if (event.type === 'checkout.session.expired' && tx.row.pending_checkout?.id === event.data.object.id) {
        await tx.save({ pending_checkout: null, checkout_attempt: null });
      }
      await tx.recordEvent(event.id);
    });
  }
  async function reconcile() {
    requireEnabled();
    let failures = 0;
    for (const key of await db.listBillingAccounts()) {
      try { await db.withBillingAccount(key, tx => sync(tx)); }
      catch { failures++; logEvent('billing.reconcile_failed', {}, 'error'); }
    }
    if (failures) throw new Error(`${failures} billing account(s) failed reconciliation`);
  }
  return { state, checkout, portal, refresh, webhook, deleteAccount, reconcile, validateCatalog, enabled: config.enabled };
}
