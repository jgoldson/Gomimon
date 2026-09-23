# GomiMon detector API

This service keeps the TypeSafe API key and Google OAuth credentials on the server. The extension sends only the selected Reddit or X text currently being assessed, optional post context for category checks, and a bearer session token.

## Local setup

1. Copy `.env.example` to `.env` and fill in the values.
2. Create the dedicated PostgreSQL database and user.
3. Run `npm install` inside this directory.
4. Start with `npm start`.

The service listens on `127.0.0.1:8090` by default. The extension's detector service URL can be pointed at this address during local development through `chrome.storage.local`.

The API stores Google account/session records, daily counters, hashed analysis metadata, private GomiMon profiles, and idempotent leaderboard meal events. It does not store post text. `POST /v1/analyze` accepts optional `categories` and `includeAi` fields, batches independent category judgments with the AI check, and caches each account/content/context/model/rubric result for 24 hours. Category strength is applied in the extension, so changing strength does not trigger a new inference.

`GET /v1/leaderboard` is public and returns only pet names, evolutions, ranks, and meal totals. Authenticated profile, join/leave, current-rank, and batched meal endpoints use the existing bearer session. Proposed globally reserved names pass deterministic validation and a Jev appropriateness Noul; decisions are cached by normalized-name hash for 30 days. Name checks have a separate per-account throttle and do not spend detector quota.

Successful analyses are limited to 1,000 per account per UTC day, with a separate server-wide daily ceiling and per-account request throttle. TypeSafe allows 5 seconds per attempt, one retry with a backoff capped at 1 second, and a 12-second overall deadline. The authenticated HTTP request has an 18-second deadline. Retry and quota responses include structured `retryAt`/`resetAt` metadata when available.

## Detector diagnostics

Analysis requests carry an `X-GomiMon-Request-ID`. The API logs request IDs, input size, cache/in-flight state, TypeSafe attempt timing, timeout/retry events, and final status without logging post text or credentials. On production, inspect them with:

```sh
journalctl -u gomimon-detector.service -f -o cat
```

The extension logs the same request IDs in the background service worker and supported page console.

The extension's background broker adds a score-only 24-hour cache and shared
two-request/25-per-minute limits across supported tabs. The API cache is
account-scoped and refreshes expired rows on conflict. Neither cache stores the
post text. Correlate `X-GomiMon-Request-ID` with the extension's
`serverRequestId`; logs include sizes, hashes, state, and timing but not raw
content or credentials.

## Production configuration

Use a dedicated environment file and service identity. Set `BASE_URL`, `DATABASE_URL`, `TYPESAFE_API_KEY`, `SESSION_SIGNING_SECRET`, Google OAuth credentials, and the stable extension redirect prefix. Put the API behind Caddy at `gomimon-api.goldentechlabs.com` and proxy to `127.0.0.1:8090`.

## Reddit and X contract

`POST /v1/analyze` accepts `platform: "reddit" | "x"`; omitted platform defaults to Reddit. `quotedText` is optional, bounded to 8,000 characters, and sent as labeled category context. The AI check assesses only authored `text`: 30 words for Reddit and 10 for X. Below the minimum, category checks still run and AI returns insufficient. Quote-only posts may request categories. Images and video are not analyzed.

Platform and quote context separate cache hashes. The assessment contract is `social-detector-v3`, and the classifier rubric is `social-classifier-v3`. Existing account quota (default 1,000/day), sensitivity thresholds, and request limits are unchanged. Diagnostics include platform and metadata only. Deploy the compatible API before reloading extension 0.4.0; legacy Reddit requests remain supported.

The v3 authorship prompt counts substantial AI rewriting, even when a person supplied real experiences, while excluding minor proofreading and quoted material. It retains one Jev Noul per AI check. See [the prompt evaluation](../evaluation/authorship-prompt-v3.md) for the measured gains and limitations. The rubric change invalidates server-side analysis cache entries; clients may retain previous results until their local cache expires.

## Stripe subscriptions (sandbox)

See [the billing runbook](../docs/stripe-billing.md) for configuration, test cards,
webhook forwarding, Postgres integration tests, reconciliation and launch gates.
Billing is off by default; this version rejects live keys and production billing.
