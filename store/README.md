# GomiMon 0.4.1 — Chrome Web Store release

## Files to use

- Upload: `dist/gomimon-chrome-store.zip` (run the build below).
- Listing text and image references: `store/listing.md`.
- Single purpose, permissions, data disclosures, and reviewer steps: `store/privacy-practices.md`.
- Public privacy URL: https://gomimon-api.goldentechlabs.com/privacy.html

```sh
npm test -- --runInBand
npm run test:detector
npm test --prefix server
npm run check --prefix server
npm run test:website
npm run package:store
npm run verify:store
```

The store archive excludes the development manifest key and localhost host permission. It contains no server, credentials, tests, or private key files. The separate development ZIP retains its stable development ID for sign-in.

## Completed during release preparation

- Replaced two mock-only failing assertions with tests that call the actual background installation and feeding handlers.
- Fixed X ad detection for the nested author/header structure observed in the live Following feed; added a regression test excluding author names, body text, quoted content, and link-card text.
- Generated the bundled privacy notice from one Markdown source, including Slop history and account/session details.
- Published the matching privacy notice on the existing API domain and verified HTTP 200, text/html, exact contents, and continued API health.
- Prepared a 1280×800 store screenshot, 440×280 promo tile, and 128×128 icon. The screenshot layout uses an existing capture with example pet data, not a fabricated app screen.
- Replaced the old placeholder toolbar icons with a GM badge matching the popup.

## Live Chrome verification (2026-09-22)

The installed development extension uses ID `dfibkhfmkipoiomphaljngiddekkifbh` and has an authenticated GomiMon session.

- X For You: eligible post check progressed through Checking content to Uncertain; manual Feed removed the post locally.
- X Following: GomiMon controls appeared; after the ad fix and extension/page reload, an explicit ad displayed Hidden: Ads; Show post restored the ad.
- These checks use the installed development identity. They do not establish that sign-in works for the production store identity, and do not establish model accuracy.
- Existing Chrome extension logs contain historical `feed_effect_failed` warnings from prior testing. The specific manual feed and automatic ad hide/restore checks above completed visually.

## Verification results

For the 0.4.1 package, 304 Jest tests, 47 detector tests, 66 server tests (3 skipped), and 5 website tests passed. Server syntax checks and git whitespace checks passed. The store verifier checked 71 packaged files against current source and verified the manifest and HTML/CSS/module references.

## Current store status

Draft: https://chrome.google.com/webstore/devconsole/e942669c-a62f-424f-8ada-027db4d1f9b6/ffbifkhfophelclnkmibepadfednkbnf/edit

- Production ID: `ffbifkhfophelclnkmibepadfednkbnf`; published version 0.4.0. Version 0.4.1 is the next upload.
- Uploaded ZIP SHA-256: `1df4c9f8311c18a83ef00a4ae9d2a1a32257999d7fa590fa14cf645d131aca83`.
- Saved: description, Social Networking category, English language, icon, screenshot, promo tile, privacy URL, all permission explanations, no remote code, reviewer setup instructions, and data categories (PII, authentication, user activity, website content).
- Distribution currently defaults to free, public, all regions. Billing remains disabled in production.
- The publisher explicitly confirmed all three data-use certifications on 2026-09-22. The Chrome Web Store dashboard now reports the item as Published - public.
- The production redirect prefix was added to the API allowlist while retaining the development ID. Both IDs returned HTTP 302 to accounts.google.com; API health stayed green. Configuration backup: `/srv/gomimon/backups/store-oauth-20260922T212728Z`.
- Public store key is saved in `store/production-public-key.pem`; its SHA-256-derived extension ID was verified. `dist/gomimon-store-id-test` is a separate unpacked copy with that public key for a production-ID login smoke test. The original development manifest is untouched.
- Production-ID OAuth smoke test passed on 2026-09-22 in Chrome using `dist/gomimon-store-id-test`: fresh onboarding, Google account selection, return to the production-ID extension habitat, and authenticated Settings with live account quota. The test pet was named `Store Test`; the test copy was disabled afterward to avoid duplicate feed processing. Store administration remains in the Codex sidebar. This verifies the publisher account's login, not Google's OAuth audience settings for every new user.

The production listing is public at https://chromewebstore.google.com/detail/ffbifkhfophelclnkmibepadfednkbnf. Keep `website/config.js` aligned with this verified URL.

## Asset rendering

The SVG layouts embed the existing UI capture and remain editable. On this Mac:

```sh
magick -font /System/Library/Fonts/Helvetica.ttc -background '#fff1b9' store/assets/screenshot-01.svg -alpha off PNG24:store/assets/screenshot-01.png
magick -font /System/Library/Fonts/Helvetica.ttc -background '#fff1b9' store/assets/promo-440x280.svg -alpha off PNG24:store/assets/promo-440x280.png
```

Run `python3 generate_icons.py` to resize the ImageGen master at `icons/gomimon-master.png` into the extension icons and `store/assets/icon-128.png`. The old `icons/icon.svg` is retained only as a legacy design.

Production billing inspection: `BILLING_ENABLED` is unset and no Stripe secret is configured on the deployed server. The new billing code is test-only and disabled in this release.

## Bubble-Gomi icon update (2026-09-22)

Uploaded the replacement 0.4.0 ZIP and saved the Bubble-Gomi store icon. The archive changes only icon PNGs (16/32/48/128) and manifest icon references relative to the tested release; newer unrelated workspace changes were deliberately excluded. ZIP integrity and unchanged non-icon file bytes were verified. Previous ZIP: `dist/gomimon-chrome-store-before-icon.zip`. At the time of this historical icon update, the draft was unsubmitted. A fresh full-source package build includes newer changes and requires separate validation.
