# Reddit and X beta verification — 2026-09-22

Implemented selectable Reddit/X platforms with shared settings, diet, account, and pet. X detection is limited to the standard For You/Following home feeds. AI eligibility is 10 authored words on X, 30 on Reddit; quotes are separate category context. Both revision/cache contracts were bumped.

## Evidence

- Inspected authenticated live X For You and Following DOM before selecting adapter anchors. Confirmed original/reposted status links, nested quote cards, explicit Ad headers, analytics-ID fallback, and show-more controls.
- `tests/fixtures/x-home.html` retains only synthetic text, author names, and IDs in the verified structure.
- `npm run test:detector`: 35 passing tests, including original/reposted/quoted/quote-only/media-only/ad cases, short-text boundaries, recycled elements, duplicate meals, navigation, stale replies, hide/restore, and disabling X.
- Server tests: 34 passing; `npm run check` passes. Covers legacy omitted platform, invalid platform, quote-only categories, cache separation, authentication and quota failures.
- Focused extension tests: 40 passing across onboarding, background platform validation, renderer, content, ads, and feeding.
- Full Jest run: three failures remain in unchanged legacy tests (`tests/e2e/scenarios.test.js` mock notification/context-menu assertions and `tests/unit/evolution.test.js` massive-feed helper expectation). New platform tests pass.
- Browser preview: actual popup modules with a local fake Chrome transport verified hatch → platforms → diet → complete, empty selection, persistence/resume, settings, X result controls, manual feed, and Show post restoration.
- Installed Chrome extension: reset development onboarding, completed hatch/platform/diet flow, rejected empty platforms, enabled both platforms with shared Ads diet. Temporary development pet: Crumb Goblin.
- Live Reddit analysis reached the deployed API and Jev successfully (HTTP 200). Diagnostics carried platform and metadata only.

## Release

The combined compatible API was deployed before reloading the extension. Public and loopback health checks pass. Server source/database rollback backup: `/srv/gomimon/backups/20260922T163541Z`.

X For You/Following extraction was inspected live in Codex’s browser, but installed-extension end-to-end X verification still requires signing into X in Chrome. Do not treat fixture results as validation of classifier accuracy on short posts. AI labels remain experimental.

Final merged UI: the separately requested design update extends onboarding to Hatch → Platforms → Diet → Account, preserving platform validation/disclosure and saved progress. Its focused onboarding tests and browser walkthrough passed. The final ZIP includes the completed onboarding stylesheet and account assets.
