# GomiMon for iPhone — browser prototype

Native SwiftUI + WKWebView, minimum iOS 17. Open `ios/GomiMon.xcodeproj`, choose the **GomiMon** scheme and an iPhone simulator, and Run. For a physical phone, select your development team in Signing & Capabilities first.

## Onboarding and use

The app now follows the extension's four-step setup, with the same artwork and category choices:

1. **Hatch:** name your companion (2–24 characters).
2. **Platforms:** choose Reddit, X, or both. X covers For You/Following at `/home` and remains experimental on mobile.
3. **Diet:** select Politics, Ads, Promotions, Ragebait, Celebrity gossip, Sports, Crypto, and/or AI content. Choose Conservative (90%), Balanced (80%), or Aggressive (70%). Unselected categories stay visible.
4. **Account:** explicitly allow text checks, then Continue with Apple or Google. The system authentication sheet signs in to **GomiMon**, separately from Reddit/X. Existing reserved GomiMon names are reused; new names use the same reservation/moderation endpoint as the extension. You can continue without an account, with manual feeding and selected local ad filtering only.

Automatic feeding applies the chosen diet to visible feed posts. It never implicitly adds AI content to your diet. AI checks require 30 authored words on Reddit or 10 on X; category checks can use shorter text. Images and videos are not analyzed. Discussion pages are excluded from automatic category filtering.

Use Browse to switch feeds. The separate **Feed this post to GomiMon** action bar supports manual feeding. **Show post** restores a post and exempts that item for the document session. Pausing Automatic or removing a category restores automatic hides that no longer match; manual hides remain until restored. Settings includes the full diet, platforms, account controls, and Review onboarding.

## Account and privacy

The mobile app uses the same detector service as the extension. Google authentication uses the official GoogleSignIn iOS SDK and its branded SwiftUI button, separately from the embedded Reddit browser. Apple uses the native AuthenticationServices sheet with a server-issued, one-use nonce and server verification of Apple’s signed identity token. Settings supports explicitly linking the other provider to the current account; matching email addresses never silently merge accounts. Native Google and Apple identity tokens are checked by the server against a one-use challenge before it creates a GomiMon session. Session tokens are kept in the device Keychain, never in the webpage or callback URL. Older prototype builds still use the server-signed, PKCE-bound Google browser handoff.

Only after setup, sign-in, explicit text-check consent, and enabling Automatic does the app send visible post text/context for selected checks. Local ad detection needs no service. The isolated script bridge checks main-frame origin and platform; it never reads login fields or private messages. The backend keeps the TypeSafe key and does not retain raw post text.

One analysis request runs at a time, at most 24 starts per minute, with server quotas respected. Results are cached in document memory (up to 1,000 scores), discarded after account changes, and checked against content revisions/settings before hiding. Errors leave content visible, show a status message, and back off; quota reset times are honored.

Pet meals and diet remain local to the iPhone app. Account/name are shared with the extension, but progress/settings are not synced. Existing prototype meal counts are preserved. The displayed pet grows from Baby to Bubble at 100 meals and Nimbus at 1,000; full hunger/glitch mechanics are not ported.

## Verification

```sh
node --test ios/tests/mobile.test.mjs server/mobile-auth.test.js
cd server && npm test
```

From the repository root:

```sh
xcodebuild -project ios/GomiMon.xcodeproj -scheme GomiMon \
  -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath ios/build build
```

Keep automatic code signing enabled, including simulator builds: unsigned builds fail Keychain writes with OSStatus -34018. The project uses team 72UJTW8297 and the Sign in with Apple and Keychain entitlements. Physical builds require that team’s development provisioning profile.

The project is checked in. Regenerate after adding files with `ruby ios/scripts/generate-project.rb` (requires the xcodeproj gem). Existing detectors, policy, platform definitions, and sprites are bundled directly from the extension source.

Debug launch argument `--keychain-smoke` verifies an isolated Keychain item’s write, read, update, and delete operations; results are stored in `keychainSmokeChecks`. It does not overwrite the real session.

Debug launch argument `--smoke` exercises local manual hide/restore and ad hide/restore in WKWebView; results and a timestamp are stored as `smokeChecks` and `smokeCheckedAt` in UserDefaults. The local practice feed does not send remote checks or count real meals.

Verified on 2026-09-22: signed simulator and physical-device builds pass; simulator Keychain write/read/update/delete pass. Server regression tests pass (58 passed, two optional database tests skipped); the identity migration/linking test also passes separately against temporary Postgres. The signed app is installed on Blue T-Phul. The native Google OAuth client and backend are configured and deployed. Real Apple/Google account completion remains a hands-on check; device launch was blocked while locked.

## Server addition

Native Google uses GoogleSignIn 9.2.0 through Swift Package Manager. The **iOS** OAuth client is registered in the GomiMon AI Detector Google Cloud project for bundle `com.goldentechlabs.gomimon.prototype` and team `72UJTW8297`. `GIDClientID` and its reversed URL scheme are in `ios/GomiMon/Info.plist`; `GIDServerClientID` is the existing web OAuth client. The detector service sets `GOOGLE_IOS_CLIENT_ID` to the iOS client ID. `server/google-native-auth.js` checks Google's token signature, web audience, iOS authorized party, email verification, expiry, freshness, and a one-use nonce before creating a GomiMon session or linking an existing account. The Google subject continues to match extension accounts.

The older system-browser Google flow remains in `server/mobile-auth.js` to preserve compatibility with already installed prototype builds; the current app calls only the native endpoint. Apple continues through `server/apple-auth.js`.

The app needs a signed build for Google SDK and GomiMon Keychain storage. Real provider sign-in must be exercised on an unlocked physical phone after the iOS OAuth client is registered.
