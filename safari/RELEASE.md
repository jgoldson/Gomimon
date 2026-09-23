# macOS 1.0 release preparation

Status: preparation in progress; not uploaded to TestFlight or submitted for review.
Public release and iPhone/iPad submission are excluded. Release type is MANUAL.

## Registered identities

- Team: Golden Labs LLC, `72UJTW8297`.
- App: `com.goldentechlabs.gomimon.safari`; extension: `.Extension`.
- App Store Connect app: `6815279239`, GomiMon, macOS only, en-US.
- Version: `1.0`; selected build: `1` (no existing builds when inspected).
- Version record: `b3e134d3-cbc6-4c31-a8b7-3206d2cd6766`.
- Apple Services ID: `com.goldentechlabs.gomimon.web`.
- Apple primary identity: `com.goldentechlabs.gomimon.prototype`.
- Authorized domain: `gomimon-api.goldentechlabs.com`.
- Apple callback: `https://gomimon-api.goldentechlabs.com/auth/apple/web/callback`.
- Active Sign in with Apple key ID: `D7M3U4YMX6` (verified GomiMon primary only).
- Earlier keys `Y8GMS468P4` and `9YQ8ZSW24Z` no longer appeared in the portal when the user-created key was verified.

Never commit private keys, encryption keys, account tokens, or environment files.
The user downloaded the active key; it was validated and moved from Downloads to
`~/.config/apple/keys/AuthKey_D7M3U4YMX6.p8`, with mode 0600.
Backend key: `/srv/gomimon/secrets/apple-signin.p8`, root:gomimon mode 0640.
Encryption key is separately stored in `/etc/gomimon.env` and is not in source.

## Implemented locally

Apple/Google Safari onboarding and settings; explicit authenticated provider
linking; one-use PKCE exchange; Apple form-post callback; encrypted Apple
revocation credentials and durable retry records; versioned remote-processing
consent with withdrawal; Safari billing controls disabled; privacy updates;
containing-app enablement instructions. Native and Chrome behavior is retained.

Production deployed on 2026-09-23. Source hashes matched the inspected production
files before selective replacement. Backup of source, env, public files and a
validated PostgreSQL dump: `/srv/gomimon/backups/apple-release-20260923`.
Only GomiMon was restarted. Unrelated local billing code was not deployed.
Public checks: health 200, Google/Apple starts 302 to the correct provider and
callback, Apple cancellation 303 to completion, invalid exchange 400, privacy 200.
Both Apple credential/revocation tables exist. This is endpoint verification,
not a successful live provider sign-in or token revocation.

## Verification completed

- Jest: 303 passing tests across 16 suites.
- Server: 66 passing, 3 optional database tests skipped in the full run.
- Separate real PostgreSQL revocation test: encryption, additive migration,
  deletion trigger, outage retry, and retry after a new worker instance passed.
- Safari client security test passed.
- Detector suite: 47 passing.
- Safari web auth tests: Apple/Google form-post or query callbacks, cancellation,
  PKCE mismatch, replay, expiry, and authenticated linking passed with mocked
  providers. These are not live provider authentication results.
- Apple altool validation: VERIFY SUCCEEDED with no errors.
- Release archive built after the latest app/resource changes.
- App Store export succeeded; package signature is Golden Labs LLC's Mac
  Developer Installer distribution certificate. Deep/strict archive signature
  verification passed.

Artifacts (ignored build outputs):
`dist/GomiMon-Safari-1.0-1.xcarchive` and
`dist/GomiMon-AppStore-1.0-1/GomiMon Safari.pkg`.
Description, promotional text, and keywords saved in the App Store draft.

## Required release gates

1. Secure Apple private key installation and separate encryption key; source/env
   and database backups; selective additive production deployment; public health
   and auth route verification.
2. Complete Google Branding and publish OAuth beyond the current Testing audience.
3. Live installed Safari checks: Apple/Google success/cancellation, Hide My Email,
   linking/conflicting identities, sign-out, deletion and actual revocation;
   activation/permissions, onboarding, Reddit/X checks, hide/restore, worker and
   browser restart, denied permissions, no remote processing before consent or
   after withdrawal.
4. Public support/privacy URLs, actual Mac screenshots, age rating, availability,
   free pricing, privacy and encryption declarations, review contact/access.
5. Apple package validation, upload, processing, existing internal TestFlight
   testers only, installation and repeated core Safari smoke tests.
6. Submit tested build for App Review with manual release. Record build and status.

Do not mark mocked tests as hands-on Safari/provider verification. No current
result establishes live Apple authentication or TestFlight behavior.

Live testing checkpoint: updated Apple Development build installed at
`~/Applications/GomiMon Safari.app` and deep/strict verification passed.
Removed duplicate Debug-build plug-in registration; installed copy remains.
Safari was restarted and its prior 18-tab window restored. Safari Settings shows
one GomiMon entry, currently off; automated enable clicks did not change its state.
User asked to enable it manually and complete Apple sign-in. No successful live
Apple sign-in is claimed yet.
