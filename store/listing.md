# Chrome Web Store listing

Name: GomiMon

Short description (manifest): Hide ragebait, ads, and AI slop on Reddit and X. A virtual pet eats it and grows.

Language: English

Category: Social Networking (saved in the store draft).

## Detailed description

Less ragebait. Fewer ads. A little monster to eat the rest.

GomiMon cleans up your Reddit and X feeds while you scroll. Pick the kinds of posts you're tired of, and your virtual pet eats them. Every meal helps it grow.

CHOOSE WHAT LEAVES YOUR FEED
Give your GomiMon a diet. It hides posts that match the categories you pick:
• Ragebait: inflammatory posts built to provoke a reaction
• AI content: text estimated to be AI-written
• Ads: clearly marked promoted posts
• Promotions: sales-focused and self-promotional content
• Topics to skip: politics, celebrity gossip, sports, and crypto

Set the filter strength, and change the diet anytime in Settings.

FEED IT WITH ONE TAP
Every post gets a Feed button. Tap it and GomiMon sits down to eat, sometimes at a candlelit table, and the post disappears from your view. Use automatic filtering, manual feeding, or both.

HATCH IT, NAME IT, WATCH IT EVOLVE
Hatch an egg and name your pet. Keep it fed and its glitch meter low. It evolves from Baby-Gomi to Bubble-Gomi at 100 meals and to Nimbus-Gomi at 1,000.

STAY IN CONTROL
• Slop history lists recent meals and stays in your browser
• Show post restores any automatically hidden X post
• Choose Reddit, X, or both
• The meal leaderboard is optional. If you join, it shows your pet's name, evolution, and meal count.

WHERE IT WORKS
Reddit posts and comments, plus the For You and Following home feeds on X. GomiMon reads text only, not images or video. AI checks need at least 30 words of the author's own text on Reddit or 10 on X; quoted text doesn't count.

PRIVACY AND ACCOUNTS
Manual feeding, your pet, and marked-ad filtering work without an account. AI and topic checks need Google sign-in, and include a daily allowance of free checks. When a check runs, the selected text goes through the GomiMon service to TypeSafe for assessment. Pet progress and Slop history stay in your browser. You can sign out or delete your GomiMon account in Settings.

AI and topic labels are estimates and can be wrong. GomiMon never proves who wrote a post, and it never posts, reports, or flags anything for you. It only changes what you see in your own browser.

## URLs

Privacy policy: https://gomimon-api.goldentechlabs.com/privacy.html

Homepage: leave blank until the marketing website has a verified public URL.

Support: use the Chrome Web Store Support hub initially; do not invent an email address.

## Assets

- assets/icon-128.png — 128×128 store icon; matches the extension icons.
- assets/chrome/screenshot-01-hero.png … screenshot-05-history.png — five 1280×800 screenshots, upload in order: hero, Feed button and eating animation, diet picker, evolution, Slop history and leaderboard.
- assets/chrome/promo-440x280.png — small promotional tile (replaces assets/promo-440x280.png).
- assets/chrome/marquee-1400x560.png — marquee promotional tile.
- Sources are in assets/chrome/src (HTML layouts using existing UI captures, sprite frames, and the bundled Fredoka and Silkscreen fonts). Re-render with assets/chrome/render.sh; the promo and marquee pages render at 440×280 and 1400×560.
- Legacy: assets/screenshot-01.png and assets/promo-440x280.png (0.4.1 listing).
- SVG sources are included for editing the store layouts. The screenshot capture is from output/imagegen/device-border/implemented-device-home.png, not a newly generated image of the app.

Before submission, compare the captured UI against the final package. Do not upload a stale screenshot after further UI changes.
