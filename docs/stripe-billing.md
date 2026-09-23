# GomiMon Stripe sandbox billing

## Offer and boundaries

Free includes 1,000 checks per UTC day. Plus costs USD $9.99/month and includes
10,000 checks per UTC day. Successful uncached AI/category analyses count, not
meals. Upgrades keep today's usage. There are no trials, annual plans, metered
charges, coupons, or automatic refunds. Card payments only.

Billing is disabled by default. This version rejects enabling billing under
`NODE_ENV=production` and rejects live keys/events. Production website pricing
says Coming soon. Do not point production accounts at the sandbox database.

## Local sandbox setup

1. Use a separate local/test Postgres database and the existing Google OAuth
   development setup. Copy `server/.env.example` to `server/.env`, configure the
   database, Google sign-in, session secret, and TypeSafe key. Set
   `NODE_ENV=development` and `BASE_URL=http://localhost:8090`.
2. Obtain a Stripe sandbox restricted API key from your Stripe Dashboard. Grant write access to Customers, Checkout Sessions, Subscriptions and Customer Portal, and read access to Prices and Invoices. Set
   `STRIPE_SECRET_KEY` locally, never in extension code or the repository.
3. In `server`, run `npm ci` and `npm run billing:setup:test`. This creates/reuses
   the sandbox Plus product, $9.99 monthly price, and a customer portal configured
   for payment updates, invoices, and cancellation at period end. Copy the two
   printed IDs into `server/.env`. The script refuses live keys.
4. Install the official Stripe CLI and authenticate it to the same sandbox. Run:

   ```sh
   stripe listen --events checkout.session.completed,checkout.session.expired,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed --forward-to localhost:8090/v1/billing/webhook
   ```

   Set `STRIPE_WEBHOOK_SECRET` to the listener's signing secret, then set
   `BILLING_ENABLED=true` and start the API with `npm start` from `server`.
   Keep the CLI forwarding while testing. A Dashboard webhook uses its own secret.
   Configure Dashboard webhook API version `2026-08-26.dahlia`, matching the pinned SDK API version.
5. Load the unpacked extension, point its detector service URL at the local API,
   sign in with the development Google account, and open Settings. Upgrade should
   show Test mode. Checkout opens a normal Stripe browser tab. Use Stripe's test
   cards only. Reopen Settings to synchronize the plan or select Refresh plan.

The service URL is stored in `detectorSettings.serviceUrl`. In the extension's
service-worker console, preserve the other settings when changing it:

```js
const saved = await chrome.storage.local.get('detectorSettings');
await chrome.storage.local.set({ detectorSettings: {
  ...saved.detectorSettings, serviceUrl: 'http://localhost:8090'
} });
```

Sign out before switching between test and production services. Never share a
session token, secret key, or Checkout URL in a bug report.

## Automated verification

From the repository root:

```sh
npm test
npm run test:detector
npm run test:website
npm --prefix server test
npm --prefix server run check
npm --prefix server run test:postgres
npm run build:website
```

The Postgres runner connects to local `postgres` as the current OS user, creates
a uniquely named disposable database, and removes only that database afterward.
Set `BILLING_TEST_ADMIN_URL` to another test administration connection if needed;
the role must be allowed to create databases. It never uses the production
`DATABASE_URL`. The integration suite checks migration reapplication, database
locks, quota concurrency, upgrades/downgrades, daily rollover, event deduplication,
transaction rollback, deletion and late events. The regular server suite uses
an injected Stripe client and authentic SDK webhook signatures, without network.

## Real Stripe sandbox acceptance

These checks require sandbox credentials and CLI forwarding; mocked tests are
not a replacement. Keep live mode disabled throughout.

- Pay using `4242 4242 4242 4242` with a future expiry and any test CVC. Confirm
  exactly one subscription, a paid invoice, Plus in `/v1/account`, and a 10,000
  limit without resetting used checks. Repeat clicks must not create a second
  subscription. A redirect alone must never grant access.
- Test authentication with Stripe's `4000 0025 0000 3155` test card. Complete and
  abandon authentication; only confirmed payment should grant Plus.
- Close Checkout without payment, reopen Upgrade, and confirm the session is
  reused. Expire it in the Dashboard and confirm a fresh session can be created.
- Upgrade after exhausting Free on both Reddit and X, with an open tab waiting
  for reset. Reopen Settings and confirm analysis resumes without a page reload.
- In Manage billing, update the payment method, inspect invoices, cancel at
  period end, and undo cancellation. Verify the popup dates and paid access.
- Use Stripe test clocks with a separate sandbox customer/subscription to advance
  renewal. Use Stripe's documented failing test payment methods. Confirm a failed
  renewal grants one three-day grace period, retries do not extend it, expiry
  applies Free limits, and successful payment restores Plus.
- Replay invoice and subscription events in reversed order. Disable forwarding,
  change the subscription in Stripe, then run reconciliation and verify repair.
- Delete an account with pending Checkout and with active Plus. Verify open
  sessions expire, subscriptions cancel immediately, the account disappears,
  and a replayed late event cannot restore paid access.

References: https://docs.stripe.com/testing,
https://docs.stripe.com/billing/testing/test-clocks,
https://docs.stripe.com/webhooks.

## API and synchronization

`GET /v1/account` retains its existing fields and adds `billing` with availability,
mode, effective plan, Stripe status, price (999 cents USD/month), Plus daily limit,
paid-through date, cancellation flag, grace deadline, customer/pending-checkout
flags, and deletion status. Account and billing responses are not cached.

Authenticated POST endpoints `/v1/billing/checkout`, `/v1/billing/portal`, and
`/v1/billing/refresh` accept an empty body. Options, return URLs and Stripe IDs are
chosen server-side. Refresh is limited to once per five seconds per account and
returns the account payload. The extension's pending flow retries at most six
times within 90 seconds and offers manual refresh afterward.

`POST /v1/billing/webhook` uses the unparsed request body and a verified Stripe
signature. Successful handling and event deduplication commit atomically. A
per-account Postgres advisory lock serializes Stripe actions across API processes.
Durable checkout intent plus Stripe idempotency handles external-call retries.
Checkout uses Stripe's default 24-hour session expiry to avoid stale absolute
expiration timestamps. Open sessions are recovered before an intent is rotated,
including when Stripe succeeded but the local database commit failed.
Current Stripe subscriptions/invoices are retrieved instead of trusting stale
event snapshots. A paid invoice for the configured price establishes coverage.
Unpaid, canceled, paused, trial, and incomplete states do not grant access.

Renewal failure keeps access for at most three days from invoice finalization,
used as a conservative anchor even when the first delivered failure is a retry.
An earlier failure timestamp can shorten this window. Later retries never move
the deadline forward. Access is checked against local
deadlines for every quota reservation; no incoming webhook is needed to expire it.

`QUOTA_EXCEEDED` remains compatible with older clients and now includes `scope`
(`account` or `server`) and `quota`. Only account waits resume after an upgrade.
Per-minute and server-wide safety limits still apply to Plus.

## Reconciliation and operations

Run `npm run billing:reconcile` from `server` using the same test environment as
the API. It checks all known Stripe customers, repairs current entitlement state,
and re-cancels subscriptions associated with deletion tombstones. A nonzero exit
means at least one account could not synchronize. It never silently marks a
failed synchronization successful.

For a deployed **test environment**, adapt the supplied
`deploy/gomimon-billing-reconcile.service.example` and `.timer.example` to its
service user, source path, and separate test environment file. Install and enable
the timer with systemd so it runs hourly, including after downtime. This task does
not install these units or modify the shared production service.

Watch `billing.synced`, `billing.reconcile_failed`, `billing.reconcile_error`,
HTTP 5xx rates, and Stripe webhook delivery failures. Logs omit full payloads,
credentials and payment details. If several nonterminal subscriptions or an
unexpected price are found, resolve them in the sandbox Dashboard; checkout
must not create another subscription to conceal the problem.

## Before a separate live launch

Validate provider cost using actual billed TypeSafe usage with representative
AI/category combinations, retries, text sizes and cache-hit rates. At the supplied
$0.01/1,000-check estimate, maximum Plus usage costs about $3 per 30 days. This is
an estimate, not a measurement. Free accounts and the shared 100,000-check daily
ceiling also need capacity planning before sales.

A live launch requires a deliberate change to the test-only guard, separate live
customer data and credentials, a live monthly price and portal configuration,
live webhook registration/signature secret, tax decisions/configuration, billing
terms, a review of invoice/refund handling, production monitoring and a final live
smoke test. Remove Coming soon only when live billing is available. Never merely
substitute a live key into this test-mode deployment.

## Configured sandbox (2026-09-22)

The connected account is Golden Labs LLC sandbox (`acct_1UIbGNFCtTbw3kIH`).
Created and verified through the Stripe MCP connection:

- Product: `prod_VJEHmxc1oNwwxS` (GomiMon Plus).
- Monthly USD 999-cent price: `price_1UIbooFCtTbw3kIHqilK5DSh`.
- Lookup key: `gomimon_plus_monthly_test_v1`.
- Portal: `bpc_1UIbooFCtTbw3kIHBD7DErpQ`, with payment updates, invoice history,
  and cancellation at period end; subscription updates and public portal login disabled.

The ignored local `server/.env` contains these resource IDs. Billing stays disabled
until the sandbox API key, CLI webhook signing secret and local database are ready.
MCP authorization does not provide the application's runtime API key.
The official CLI can be run with `npx --yes @stripe/cli` if `stripe` is not installed.
Use a restricted test key and a separate test database. No live resources were created.
