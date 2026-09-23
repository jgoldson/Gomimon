import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { billingEntitlement } from '../billing-config.js';

export const config = { enabled: true, secretKey: 'sk_test_fake', webhookSecret: 'whsec_test',
  priceId: 'price_plus', portalConfiguration: 'bpc_test', baseUrl: 'http://localhost:8090' };
export function fixture() {
  const account = { id: 1, public_key: randomUUID(), email: 'test@example.test' };
  const row = { account_key: account.public_key, account_id: 1, status: 'none' };
  const events = new Set();
  let queue = Promise.resolve();
  const db = {
    row, events, deleted: false, failSave: false,
    async getBilling() { return row; },
    async findBillingCustomer(id) { return row.customer_id === id ? row : null; },
    async listBillingAccounts() { return [account.public_key]; },
    async findAccountBySession(token) { return token === 'valid-token' && !db.deleted ? account : null; },
    async getGomimonProfile() { return null; },
    async getUsage() { const limit = billingEntitlement(row) === 'plus' ? 10000 : 1000; return { used: 0, remaining: limit, limit }; },
    async withBillingAccount(key, fn) {
      const before = queue;
      let release;
      queue = new Promise(resolve => { release = resolve; });
      await before;
      const backup = structuredClone(row);
      const oldEvents = new Set(events);
      try {
        return await fn({ row,
          async save(patch) { if (db.failSave) throw new Error('Database unavailable'); Object.assign(row, patch); },
          async eventSeen(id) { return events.has(id); },
          async recordEvent(id) { if (db.failEvent) throw new Error('Event commit failed'); events.add(id); },
          async deleteAccount() { db.deleted = true; row.account_id = null; }
        });
      } catch (error) {
        for (const key of Object.keys(row)) delete row[key];
        Object.assign(row, backup);
        events.clear(); for (const id of oldEvents) events.add(id);
        throw error;
      } finally { release(); }
    }
  };
  const sdk = new Stripe('sk_test_fake');
  const data = { customers: new Map(), sessions: [], subscriptions: [], invoices: [], checkoutCreates: 0, calls: [], failCancel: false };
  const stripe = {
    webhooks: sdk.webhooks,
    prices: { async retrieve() { return { id: config.priceId, livemode: false, active: true, unit_amount: 999, currency: 'usd', recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } }; } },
    customers: {
      async create(params, opts) { data.calls.push(['customer', params, opts]); const c = { id: 'cus_test', livemode: false, ...params }; data.customers.set(c.id, c); return c; },
      async retrieve(id) { return data.customers.get(id); }
    },
    subscriptions: {
      async list({ customer }) { if (data.failSync) throw new Error('Stripe unavailable'); return { data: data.subscriptions.filter(s => s.customer === customer) }; },
      async cancel(id) { if (data.failCancel) throw new Error('Cancellation failed'); const sub = data.subscriptions.find(s => s.id === id); sub.status = 'canceled'; return sub; }
    },
    invoices: {
      async list({ subscription }) { return { data: data.invoices.filter(i => i.subscription === subscription) }; },
      async retrieve(id) { return data.invoices.find(i => i.id === id); }
    },
    checkout: { sessions: {
      async create(params, opts) {
        data.calls.push(['checkout', params, opts]);
        const previous = data.sessions.find(s => s.key === opts.idempotencyKey);
        if (previous) return previous;
        data.checkoutCreates++;
        const session = { id: `cs_${data.checkoutCreates}`, customer: params.customer, status: 'open', livemode: false,
          url: 'https://checkout.stripe.com/c/pay/test', expires_at: params.expires_at ?? Math.floor(Date.now() / 1000) + 86400, key: opts.idempotencyKey };
        data.sessions.push(session); return session;
      },
      async retrieve(id) { return data.sessions.find(s => s.id === id); },
      async list({ customer, status }) { return { data: data.sessions.filter(s => s.customer === customer && s.status === status) }; },
      async expire(id) { data.sessions.find(s => s.id === id).status = 'expired'; }
    } },
    billingPortal: {
      configurations: { async retrieve() { return { active: true, livemode: false, features: {
        subscription_cancel: { enabled: true, mode: 'at_period_end' }, payment_method_update: { enabled: true }, invoice_history: { enabled: true }
      } }; } },
      sessions: { async create(params) { data.calls.push(['portal', params]); return { url: 'https://billing.stripe.com/p/session/test' }; } }
    }
  };
  function paid({ end = Math.floor(Date.now() / 1000) + 86400 * 30, status = 'active' } = {}) {
    const invoice = { id: 'in_paid', subscription: 'sub_test', customer: 'cus_test', livemode: false, status: 'paid', currency: 'usd', amount_paid: 999,
      lines: { data: [{ pricing: { price_details: { price: config.priceId } }, period: { end } }] } };
    const sub = { id: 'sub_test', customer: 'cus_test', created: Math.floor(Date.now()/1000), livemode: false, status,
      items: { data: [{ price: { id: config.priceId }, quantity: 1 }] }, latest_invoice: invoice, cancel_at_period_end: false };
    data.invoices = [invoice]; data.subscriptions = [sub]; return sub;
  }
  function event(type, object, extra = {}) {
    const value = { id: `evt_${randomUUID()}`, type, livemode: false, created: Math.floor(Date.now()/1000), data: { object }, ...extra };
    const raw = JSON.stringify(value);
    const signature = sdk.webhooks.generateTestHeaderString({ payload: raw, secret: config.webhookSecret });
    return { raw: Buffer.from(raw), signature, value };
  }
  return { account, db, stripe, data, row, paid, event };
}
