# GomiMon 👾

GomiMon is a virtual pet that eats posts from your social feeds. You choose what it eats: feed a post yourself, or opt into filters that check Reddit and X and hide matching posts. The changes affect only your view of the page. AI authorship labels are experimental estimates, not proof that a person used AI.

This repository contains the Chromium extension (version **0.4.0**), a Safari Web Extension, an iPhone browser prototype, the detector API, and a static website. The Chrome Web Store listing is still a draft; the Safari app has not been submitted to the App Store.

## Get started

### Chromium browsers

1. In Chrome, Edge, or Brave, open the extensions page and enable Developer mode.
2. Choose **Load unpacked** and select this repository's root directory. For a packaged development build, run `npm run package:extension` and load `dist/gomimon-extension` instead.
3. Open the toolbar popup. Name and hatch your pet, select Reddit, X, or both, choose its diet, and review the account step.
4. Browse a supported feed. Right-click a post and select **Feed to GomiMon** to feed it manually. Sign in with Google if you want server-backed AI or topic checks.

The production store package uses a different extension identity from the development build. Run `npm run package:store` and `npm run verify:store` before preparing a store upload; see [store/README.md](store/README.md) for the current draft and release checklist.

### Safari and iPhone

- **Safari on Mac, iPhone, or iPad:** Run `npm run package:safari`, then open the Xcode project under `safari/`. Enable the extension and grant website access in Safari. Safari supports Google and Apple sign-in; it asks for consent before remote text checks. Read [safari/README.md](safari/README.md) for signing, activation, and current verification limits.
- **Standalone iPhone prototype:** Open `ios/GomiMon.xcodeproj` and run the GomiMon scheme. This is a SwiftUI app with an embedded browser, separate from the Safari extension. Its pet progress and settings stay on that phone. Read [ios/README.md](ios/README.md).

## How feeding works

| Action | What happens |
| --- | --- |
| Manual feed | You select a post. GomiMon removes it from your local view, adds one meal and 20 hunger, and adds 5 glitch. |
| Automatic feed | A selected filter matches a visible feed item. GomiMon hides it locally and adds a meal and 20 hunger, without adding glitch. |
| Show post | Restores an automatically hidden post and exempts it for the current page session. |

Hunger falls by 1 every 15 minutes. At zero the pet starves; at 100 glitch it crashes and needs a reboot. The pet starts as an egg, becomes Baby-Gomi after 10 meals, Bubble-Gomi at 100, and Nimbus-Gomi at 1,000. Older diet-based forms remain supported for existing pets. The popup shows a local **Slop history** of the latest 100 meals; clearing it leaves the meal total and pet progress intact. Pet progress is local to each browser profile or app installation.

GomiMon's automatic detector runs on Reddit posts and comments and on the X **For You** and **Following** home feeds. It does not cover X profiles, search, post-detail threads, messages, or custom lists. Manual right-click feeding is also available on other pages where the browser exposes the context menu, though automatic detection is limited to Reddit and X.

### Choose a diet

- **AI content:** An opt-in authorship filter. Manual mode lets you request checks; Automatic mode checks eligible feed items. The AI sensitivity settings are Strict (95%), Balanced (90%), and Relaxed (80%).
- **Topics:** Politics, Promotions, Ragebait, Celebrity gossip, Sports, and Crypto use separate TypeSafe judgments. Their filter strengths are Conservative (90%), Balanced (80%), and Aggressive (70%).
- **Ads:** Explicit Reddit promoted markers and verified X Ad headers are recognized locally. This filter does not send post text to the detector service.

Unchecked categories remain visible. AI checks need at least 30 words of the author's own text on Reddit or 10 on X; shorter text can still be assessed for selected topics. Quoted text can provide topic context but does not count toward the AI word minimum. Images and video are not analyzed. When checks fail or are uncertain, GomiMon leaves the post visible.

## Account, privacy, and leaderboard

Google sign-in on Chromium, or Google/Apple sign-in in Safari, enables remote checks and an optional public leaderboard. The extension sends selected Reddit or X text and relevant quoted context to the GomiMon API, which calls TypeSafe. The API keeps credentials server-side and does not retain raw post text. It stores account and session records, usage counters, and hashed analysis metadata. The local extension cache keeps scores for up to 24 hours; sign-out and account deletion clear it. See [PRIVACY.md](PRIVACY.md) for consent, retention, account deletion, and billing details.

Free accounts receive 1,000 successful checks per UTC day. The proposed Plus tier is $9.99/month for 10,000 checks per day, but billing is sandbox-only and disabled in production; the public site marks it **Coming soon**.

Anyone can view the top 20 weekly or all-time GomiMons. Joining is optional and publishes the pet name, evolution, meal count, and rank. Names are reserved and checked for all-ages appropriateness. Leaving hides the profile while preserving its reserved name and score. Browser and iPhone pet progress do not sync through the account.

## Repository map

| Path | Purpose |
| --- | --- |
| `background.js`, `content.js`, `popup.*` | Extension service worker, feed integration, and pet UI |
| `detector/`, `detector-broker.js`, `reddit-detector.js`, `x-detector.js` | Feed extraction, filtering policy, scheduling, rendering, and score cache |
| `server/` | Express API, TypeSafe calls, authentication, quotas, leaderboard, and sandbox billing |
| `safari/` | Safari containing apps and extension projects |
| `ios/` | Standalone SwiftUI/WKWebView prototype |
| `website/` | Static marketing site and public leaderboard |
| `scripts/`, `store/`, `deploy/` | Packaging, store assets, and deployment instructions |

## Develop and verify

Install dependencies in the repository root and in `server/` with `npm install`. Configure the API from `server/.env.example`; keep actual credentials in ignored `.env` files. The detector service uses PostgreSQL and listens on `127.0.0.1:8090` by default. See [server/README.md](server/README.md) and [deploy/README.md](deploy/README.md).

```sh
npm test -- --runInBand
npm run test:detector
npm run test:website
npm run test:safari
cd server && npm test && npm run check
```

Run `npm run build:website` to assemble the static site and downloadable extension ZIP in `dist/website`; `npm run preview:website` serves it locally. See [website/README.md](website/README.md). Tests exercise detector logic and packaging, but live browser sign-in, site permissions, and store distribution need separate checks on the target platform.

For user instructions, see [USER_GUIDE.md](USER_GUIDE.md). For the detector's prompt evaluation and its limits, see [evaluation/authorship-prompt-v3.md](evaluation/authorship-prompt-v3.md).
