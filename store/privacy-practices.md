# Chrome Web Store privacy practices

These are prepared answers for review against the final uploaded package.

## Single purpose

GomiMon helps users filter unwanted social-feed posts by feeding them to a virtual pet. The pet, meal history, and optional leaderboard provide feedback and motivation for that feed-cleaning activity.

## Permission justifications

| Permission / host | Purpose |
| --- | --- |
| storage | Save pet progress, onboarding, settings, local meal history, the GomiMon sign-in session, and short-lived assessment scores. |
| alarms | Update pet hunger on a 15-minute schedule and handle elapsed time across browser sessions. |
| contextMenus | Provide the user-triggered “Feed to GomiMon” right-click action. |
| scripting | Apply the feeding animation and local removal when the user chooses the context-menu action; inject its bundled styles. |
| notifications | Notify the user when their pet evolves. |
| offscreen | Play bundled feeding/evolution audio from the extension service worker. |
| identity | Run Google sign-in using Chrome's web authentication flow and return the user to the extension. |
| Reddit | Read rendered posts/comments for user-selected assessment and apply local feed filters and feeding controls. |
| X / Twitter | Read rendered For You/Following posts, display assessments, and apply user-selected feed filters and feeding controls. |
| Facebook | Support the existing user-triggered right-click feeding action and its local animation/removal. No automatic Facebook detector is included. |
| gomimon-api.goldentechlabs.com | Authenticate users, request text assessments, manage account deletion, reserve pet names, and provide the optional leaderboard. |

No localhost permission is included in the store build. Web-accessible resources do not grant access to browse arbitrary websites.

## Remote code

No. Executable extension code is bundled. The API returns data (assessment probabilities/categories, account information, and leaderboard data). It does not supply executable JavaScript or WebAssembly.

## Data categories to disclose

- Personally identifiable information: Google account ID, email and display name; proposed/reserved pet name.
- Authentication information: GomiMon session token and server-side session metadata. GomiMon does not receive a Google password.
- Website content: selected rendered Reddit/X text, titles, and quoted-post context sent for assessment; short consumed-text excerpts kept in local history.
- User activity: meal events/counts and daily assessment usage associated with the account, and local filter preferences.

The service does not receive a general browsing-history feed. Locally generated item keys can include source post identifiers/URLs; inspect the final dashboard definition of Web history before certifying that category. Do not declare “no user data collected.”

## Data use

The data supports the extension's feed filtering, account access, model assessments, quotas, name moderation, and optional leaderboard. TypeSafe receives assessed text/context and proposed names for moderation. Google handles sign-in. Leaderboard visibility is opt-in.

Before certifying the dashboard's Limited Use statements, the publisher should verify that these answers also reflect its operational/provider arrangements, including provider retention and any use for model training. The repository does not establish TypeSafe's current contractual retention terms.

## Reviewer instructions

1. Install and open the extension; hatch and name a pet, select Reddit/X, and choose a diet.
2. Local Ads filtering uses explicit ad markers. Google sign-in enables remote checks and semantic categories.
3. Open Reddit or X's standard For You/Following feed. Use Check for AI on an eligible post. Brief posts show Not enough text. Model results are estimates.
4. Feed a post to update the pet and Slop history. For automatically filtered X posts, Show post restores the content.
5. Open Settings to adjust platforms/filters and account controls. Leaderboard participation is optional.

No paid entitlement is required. Production Google OAuth must be available to reviewers, not restricted to a private test-user list. Supply a dedicated test account only if reviewers cannot use their own Google account; do not include credentials in this repository.
