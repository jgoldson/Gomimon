# GomiMon for Safari

Safari Web Extension for Mac, iPhone and iPad, sharing the repository's pet,
Reddit/X detectors, settings, popup, and account service. Minimum deployment:
iOS/iPadOS 17 and macOS 14. This is a separate containing app from `ios/`'s
WKWebView browser prototype. Pet progress/settings remain local to each Safari
profile; Google accounts and leaderboard identity use the existing service.

## Build and run

For a signed Mac development build, run `npm run build:safari:mac`. This refreshes web resources and builds with Apple Development signing. The installed test app is `/Users/jon/Applications/GomiMon Safari.app`.

For manual Xcode builds, run `npm run package:safari` from the repository root **before every Xcode build**.
Open `safari/GomiMon Safari/GomiMon Safari.xcodeproj` and select either
**GomiMon Safari (macOS)** or **GomiMon Safari (iOS)**. Both schemes are shared.
Signing uses the repository's development team, `72UJTW8297`; physical devices
and distribution need provisioning for the new app and extension bundle IDs.

```sh
npm run package:safari
xcodebuild -project 'safari/GomiMon Safari/GomiMon Safari.xcodeproj' \
  -scheme 'GomiMon Safari (macOS)' -derivedDataPath dist/safari-macos \
  CODE_SIGN_IDENTITY=- build
xcodebuild -project 'safari/GomiMon Safari/GomiMon Safari.xcodeproj' \
  -scheme 'GomiMon Safari (iOS)' -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath dist/safari-ios build
npm run test:safari
node --test server/mobile-auth.test.js server/safari-auth.test.js
```

The Xcode project references `dist/gomimon-safari` rather than duplicating web
sources. The ZIP is web resources only, not an installable Safari app. Chrome
packaging remains separate. If regenerating the project with Apple's converter,
run `ruby safari/configure-project.rb` afterward and preserve the customized host
instructions/handler. The converter's `type` warning is stale: module background
workers have been supported since Safari 16.4.

## Enable

- Mac: run the containing app, open Safari Settings → Extensions, enable GomiMon.
  For the ad-hoc development build, enable Safari's developer features and
  Safari Settings → Developer → Allow unsigned extensions (or Develop → Allow Unsigned Extensions on older Safari). A distribution build needs Apple signing.
- iPhone/iPad: run the iOS target, then Settings → Apps → Safari → Extensions →
  GomiMon. Enable it and grant website access.
- Allow Reddit, X/Twitter, and `gomimon-api.goldentechlabs.com`. Open GomiMon from
  Safari's toolbar/page menu, hatch a pet, select platforms/diet, and sign in.

## Safari sign-in

The Safari authentication routes were deployed on 2026-09-22 and their public endpoints verified. `/auth/safari/start`
uses Google's existing registered server callback, with a distinct signed OAuth
audience. `/auth/safari/complete` receives a one-minute, single-use code;
`/v1/auth/safari/exchange` requires the extension-held PKCE verifier. No session
token is placed in a URL. The background worker validates tab, origin, path,
state, and expiry; pending state survives worker suspension. Closing the login
tab or signing out clears it. Completion opens the normal popup as a tab.
Google completion and actual Safari site permissions require a hands-on check.

## Platform limits and release checks

Chrome's identity, offscreen audio and notification permissions are removed.
Background sound and desktop notifications are currently omitted in Safari.
Context-menu feeding is available where Safari exposes that API; iPhone/iPad
use the in-page detector controls. The app does not share the prototype's native
Apple sign-in or local progress. X mobile feed detection remains experimental.

Before release, verify onboarding, Google sign-in/cancellation, local ad hiding,
manual and automatic checks, restore, worker/browser restart, sign-out and
account deletion on real Safari for both platforms. Build success and mocked
security tests do not establish live Safari compatibility. The authentication routes are deployed; the app is not published to the App Store.

References: [Apple's extension guide](https://developer.apple.com/documentation/safariservices/creating-a-safari-web-extension)
and [Safari module-worker support](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/).

Verified locally on 2026-09-22: macOS ad-hoc build and iOS simulator build pass;
206 existing Jest tests, 45 detector tests, 63 server tests pass (2 optional
server database tests skipped). The added Safari client security test and popup
pending-login regression also pass. Real Safari activation/Google completion,
physical-device signing and App Store distribution are not verified yet.

## Signed Mac testing and later App Store release

On 2026-09-22, both macOS targets built with Apple Development signing for team
72UJTW8297. Deep/strict signature verification passed. The app was installed in
`~/Applications/GomiMon Safari.app`, launched, and its extension registered with
macOS. Enable it in Safari Settings → Extensions; this signed build replaces the
earlier ad-hoc testing build.

For a later Mac App Store release, refresh web resources, select the macOS
scheme and use Product → Archive in Xcode. Distribute through App Store Connect
with App Store signing, an app record for `com.goldentechlabs.gomimon.safari`,
listing assets/privacy disclosures, and App Review. Development signing is for
local testing, not the submitted distribution build. Finish live Safari testing
and make Google OAuth available to intended users before submission. No store
upload or submission has been performed.
