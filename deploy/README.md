# GomiMon detector deployment

## Authorship prompt v3 (2026-09-23)

Deployed a shorter authorship Noul that counts substantial AI rewriting while excluding minor proofreading and quoted material. Only the AI question in `server/typesafe.js` and `RUBRIC_VERSION` in `server/logic.js` were patched on the live host; the rubric is now `social-classifier-v3`. One Jev question, existing thresholds, and category behavior are retained. Local server tests and syntax checks passed; loopback/public health and a live TypeSafe check verified the release. [Evaluation results](../evaluation/authorship-prompt-v3.md) include the aggressive-threshold false-positive tradeoff.

Previous live files are backed up at `/srv/gomimon/backups/authorship-v3-20260923T145510Z`. Roll back by restoring `typesafe.js` and `logic.js` from that directory to `/srv/gomimon/server/`, restarting `gomimon-detector.service`, and verifying `/healthz`. The rubric change separates server cache entries; existing client results can remain until their local cache expires.

## Host layout

The detector API is designed for the shared GoldenTechLabs host and uses the isolated names below:

- source: `/srv/gomimon`
- environment: `/etc/gomimon.env`
- service: `gomimon-detector.service`
- database: `gomimon` with a dedicated `gomimon` role
- loopback port: `127.0.0.1:8090`
- public route: `gomimon-api.goldentechlabs.com`

Before enabling the route, configure a DNS record for `gomimon-api.goldentechlabs.com`, create Google OAuth credentials with the callback URL in `server/.env.example`, and set the stable Chrome extension redirect prefix after the production extension ID exists. Keep the TypeSafe key, OAuth secret, database password, and session secret only in `/etc/gomimon.env`.

Install `gomimon-detector.service.example` as the systemd unit and add `Caddyfile.gomimon.example` to the existing Caddy configuration only after backing up and validating that configuration. The service must pass `/healthz` before the extension is pointed at the public hostname.

## Extension identity checklist

- Keep a development extension key outside the repository and use its public key only in a development manifest if a stable unpacked ID is needed.
- Let the Chrome Web Store assign the production ID; do not reuse the development key for the store package.
- Add the exact production `https://<extension-id>.chromiumapp.org/` prefix to `CHROME_EXTENSION_REDIRECT_PREFIXES` before enabling Google sign-in. Preserve the existing development prefix while development builds remain in use.
- The Google OAuth client redirects to the API's `https://gomimon-api.goldentechlabs.com/auth/google/callback`, not directly to the extension. The API validates the extension redirect and returns the GomiMon session there after sign-in.
- Build the store upload with `npm run package:store` and check it with `npm run verify:store`. This produces `dist/gomimon-chrome-store.zip` without the development key or localhost permission. `npm run package:extension` retains the development identity for unpacked installs.
- After the first draft upload, obtain the store ID and its public key from the dashboard. To test sign-in before publication, put that public key in a separate local test copy of the store build and load it unpacked. Do not overwrite the development manifest or ship a private signing key.

## Public privacy notice

`PRIVACY.md` is the source; packaging runs `scripts/build-privacy.mjs` to generate `privacy.html`. The public notice is served from `/srv/gomimon/public/privacy.html` at `https://gomimon-api.goldentechlabs.com/privacy.html`. Publish that generated file when the notice changes, and compare the public response with the local file.

The route was added on 2026-09-22 with a validated Caddy reload. The previous configuration is backed up at `/srv/gomimon/backups/store-privacy-20260922T211125Z/Caddyfile`. The API reverse proxy and service remain in place.

## Billing sandbox

Stripe billing in this version is for a separate test environment only. Do not
enable it on the production detector. The hourly reconciliation unit/timer
examples are supplied but not installed. See [the billing runbook](../docs/stripe-billing.md).

## Mobile browser authentication

On 2026-09-22, `server/mobile-auth.js` and its two-line registration were deployed independently of other local backend changes. The running app's previous source is backed up at `/srv/gomimon/backups/mobile-auth-20260922T214329Z/app.js`.

Mobile login starts at `/auth/mobile/start` with a SHA-256 PKCE challenge and random client state, uses the already-registered Google server callback, and returns a short-lived one-use code to the fixed `gomimon://auth/callback` URI. `/v1/auth/mobile/exchange` requires the device-held verifier before creating a session. Pending codes are in memory; a restart requires unfinished sign-ins to restart. No environment or database changes were made. Public health, mobile Google redirect, rejected invalid exchange, and existing Chrome Google redirect were verified after the restart.

## Native Apple and linked providers

On 2026-09-22, Apple authentication and explicit Apple/Google linking were deployed with selective patches to the live app/db modules, keeping unrelated local billing work out of production. Source and a restricted PostgreSQL backup are at `/srv/gomimon/backups/apple-auth-20260922T220813Z`. The additive migration makes Google identity nullable and adds a unique Apple subject; existing account IDs and Google identities are preserved. No accounts are merged by email.

The native Apple audience defaults to `com.goldentechlabs.gomimon.prototype`; override with comma-separated `APPLE_CLIENT_IDS` if additional native bundle IDs are introduced. Apple signing capability is provisioned on the iOS app. Challenges are one-use and held in memory, so restarting the service invalidates pending sign-ins. Public health, Google mobile redirects, Apple challenges, invalid-token rejection, and unauthenticated linking rejection were verified after deployment.

## Native Google sign-in for iPhone

On 2026-09-22, GoogleSignIn 9.2.0 was added to the signed iOS app. A new iOS OAuth client for `com.goldentechlabs.gomimon.prototype` (team `72UJTW8297`) was created in the existing GomiMon AI Detector Google Cloud project. The app is configured with that iOS client and the existing detector web client. The server sets `GOOGLE_IOS_CLIENT_ID` and verifies signed ID tokens, audience, iOS authorized party, freshness, and a one-use nonce at `/v1/auth/google/native/*`.

Only the native module and two registration lines were deployed; the prior server app file and restricted env backup are at `/srv/gomimon/backups/native-google-20260922T223029Z`. Public health, native challenge and invalid-token rejection, Apple challenge, and the previous mobile Google redirect were checked after restart. The updated signed app was installed on Blue T-Phul; device launch requires the iPhone to be unlocked. Google Cloud reports OAuth access restricted to configured test users until its consent screen is published.

## Safari authentication

On 2026-09-22, Safari authentication was deployed as a selective patch to live
`app.js` plus the parameterized `mobile-auth.js`. Prior files are backed up at
`/srv/gomimon/backups/safari-auth-20260922T223400Z`. No environment, database,
proxy, or unrelated application changes were made. Only `gomimon-detector.service`
was restarted.

Routes: `/auth/safari/start`, `/auth/safari/complete`, and
`/v1/auth/safari/exchange`. The existing registered Google callback handles the
distinct `gomimon-safari` audience. CORS middleware now precedes authentication
routes so Safari exchange preflights receive the configured headers.

Public health, Safari and mobile Google redirects, signed cancellation callbacks,
invalid exchange rejection, Safari completion headers/page, and exchange CORS
preflight all passed. Successful real-account completion remains a Safari UI
test. OAuth access remains limited to configured Google test users.

Rollback: restore both backed-up files into `/srv/gomimon/server/`, then restart
`gomimon-detector.service` and verify `/healthz`.
