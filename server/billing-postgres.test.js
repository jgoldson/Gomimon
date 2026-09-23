import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import * as db from './db.js';
import { createBilling } from './billing.js';
import { fixture, config } from './test-support/billing-fixture.js';

test('Postgres billing integration', { skip: process.env.RUN_BILLING_POSTGRES !== 'true' }, async t => {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/gomimon_billing_test_[a-f0-9]+$/);
  const sql = new pg.Client({ connectionString: process.env.DATABASE_URL }); await sql.connect();
  t.after(async () => { await db.closeDb(); await sql.end(); });
  await db.initDb(); await db.initDb();
  const account = await db.upsertAccount({ googleSubject: randomUUID(), email: 'billing-test@example.test', displayName: 'Billing Test' });
  const f = fixture();
  const billing = createBilling({ db, stripe: f.stripe, config });
  const date = new Date().toISOString().slice(0, 10);
  await t.test('concurrent checkout persists one customer and one session', async () => {
    await Promise.all(Array.from({ length: 8 }, () => billing.checkout(account)));
    assert.equal(f.data.checkoutCreates, 1);
    assert.equal((await db.getBilling(account.id)).customer_id, 'cus_test');
  });
  await t.test('Free quota is atomic at its boundary; upgrade retains consumed usage', async () => {
    await sql.query('INSERT INTO gomimon_daily_usage VALUES ($1, $2, 998)', [account.id, date]);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => db.reserveCheck(account.id)));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 2);
    assert(results.filter(r => r.status === 'rejected').every(r => r.reason.code === 'ACCOUNT_QUOTA_EXCEEDED'));
    assert.equal((await db.getUsage(account.id)).remaining, 0);
    assert.equal((await sql.query('SELECT successful_checks FROM gomimon_server_usage WHERE usage_date=$1', [date])).rows[0].successful_checks, 2);
    f.paid(); await billing.refresh(account);
    const usage = await db.getUsage(account.id);
    assert.equal(usage.limit, 10000); assert.equal(usage.used, 1000); assert.equal(usage.remaining, 9000);
    assert.equal(usage.resetAt, new Date(Date.parse(date) + 86400000).toISOString());
  });
  await t.test('Plus boundary, failed analysis release, downgrade above Free allowance', async () => {
    await sql.query('UPDATE gomimon_daily_usage SET successful_checks=9998 WHERE account_id=$1', [account.id]);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => db.reserveCheck(account.id)));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 2);
    await db.releaseCheck(account.id, date); assert.equal((await db.getUsage(account.id)).remaining, 1);
    await db.withBillingAccount(account.public_key, tx => tx.save({ status: 'canceled' }));
    const usage = await db.getUsage(account.id); assert.equal(usage.limit, 1000); assert.equal(usage.remaining, 0); assert.equal(usage.used, 9999);
  });
  await t.test('global ceiling rolls back account reservations and rollover starts fresh', async () => {
    await sql.query('UPDATE gomimon_server_usage SET successful_checks=100000 WHERE usage_date=$1', [date]);
    await assert.rejects(db.reserveCheck(account.id), { code: 'SERVER_QUOTA_EXCEEDED' });
    assert.equal((await db.getUsage(account.id)).used, 9999);
    await sql.query("UPDATE gomimon_daily_usage SET usage_date=usage_date - 1 WHERE account_id=$1", [account.id]);
    assert.equal((await db.getUsage(account.id)).used, 0);
  });
  await t.test('simultaneous duplicate webhook events persist once', async () => {
    const e = f.event('invoice.paid', f.data.invoices[0]);
    await Promise.all(Array.from({ length: 5 }, () => billing.webhook(e.raw, e.signature)));
    assert.equal((await sql.query('SELECT count(*) FROM gomimon_billing_events WHERE event_id=$1', [e.value.id])).rows[0].count, '1');
    assert.equal((await billing.state(account.id)).plan, 'plus');
  });
  await t.test('failed transaction preserves durable intent and rolls back updates', async () => {
    const before = await db.getBilling(account.id);
    await assert.rejects(db.withBillingAccount(account.public_key, async tx => { await tx.save({ status: 'unpaid' }); throw new Error('rollback'); }));
    assert.equal((await db.getBilling(account.id)).status, before.status);
  });
  await t.test('deletion leaves a customer tombstone and late events cannot restore access', async () => {
    await billing.deleteAccount(account);
    assert.equal((await sql.query('SELECT 1 FROM gomimon_accounts WHERE id=$1', [account.id])).rowCount, 0);
    const tombstone = await db.findBillingCustomer('cus_test'); assert.equal(tombstone.deleted, true); assert.equal(tombstone.account_id, null);
    f.paid(); const e = f.event('customer.subscription.created', f.data.subscriptions[0]);
    await billing.webhook(e.raw, e.signature); assert.equal(f.data.subscriptions[0].status, 'canceled');
  });
});
