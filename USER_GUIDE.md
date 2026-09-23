# GomiMon User Guide 👾

Welcome to GomiMon! This guide will help you understand and enjoy your virtual pet that eats AI-generated content from your social media feeds.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Understanding Your Pet](#understanding-your-pet)
3. [Feeding Your Pet](#feeding-your-pet)
4. [Pet States](#pet-states)
5. [Evolution System](#evolution-system)
6. [Tips & Strategies](#tips--strategies)
7. [Troubleshooting](#troubleshooting)

## Getting Started

### Installation

1. Download or clone the GomiMon extension
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked" and select the GomiMon folder
5. The GomiMon icon should appear in your toolbar!

### First Steps

When you first install GomiMon:
- Your pet starts as an **Egg** 🥚
- Hunger is at 100 (full)
- Glitch-O-Meter is at 0
- Feed count is 0

Click the GomiMon icon in your toolbar anytime to check on your pet!

## Understanding Your Pet

### Stats Explained

#### Hunger (0-100)
- **What it does**: Represents how hungry your pet is
- **How it changes**: Decreases by 1 point every 15 minutes automatically
- **Why it matters**: If it hits 0, your pet becomes a sad Null-Sprite

#### Glitch-O-Meter (0-100)
- **What it does**: Represents "indigestion" from eating junk content
- **How it changes**: Manual meals increase it by 5 points; automatic detector meals do not increase glitch
- **Why it matters**: If it hits 100, your pet crashes!

### The Pet Interface

When you click the GomiMon icon, you'll see:
- **Pet Name**: Shows current evolution stage
- **Pet Sprite**: Animated visual of your pet
- **Hunger Bar**: Pink gradient bar
- **Glitch-O-Meter**: Blue gradient bar
- **Info Text**: Tips, warnings, and stats
- **Reboot Button**: Only appears when crashed

## Feeding Your Pet

### How to Feed

1. Browse any social media site (Twitter/X, Reddit, Facebook, etc.)
2. When you see low-quality or AI-generated content:
   - Right-click anywhere on the post
   - Select **"Feed to GomiMon 👾"** from the menu
3. Watch the post glitch out and disappear!
4. Your pet's stats update automatically

### What Counts as Food?

Your pet can eat three types of content:

- **📝 Text**: Selected text or text-heavy posts
- **🖼️ Images**: Posts with images (AI art, memes, etc.)
- **📄 Posts**: Generic posts and content

The type of food affects your pet's evolution!

### Feeding Effects

Each time you feed:
- **Hunger** increases by +20 points
- **Glitch-O-Meter** increases by +5 points
- **Feed count** increases by +1
- A satisfying "gulp" sound plays
- The toolbar icon wiggles
- The post disappears with a glitch animation

## Reddit and X Detector

The detector estimates AI likelihood from text on Reddit posts/comments and X’s **For You and Following** timelines. Labels are experimental estimates, not proof of authorship. X profiles, search, post-detail threads, messages, composers, and custom lists are outside this release.

1. Name and hatch your GomiMon, choose **Reddit**, **X**, or both, then choose a diet. Both platforms are initially selected. Closing the popup saves your onboarding step.
2. Review the platform disclosure: text selected for analysis is sent through GomiMon to TypeSafe.
3. Sign in with Google for AI and semantic category checks. Choose Manual or Automatic AI mode and sensitivity in Settings.

Settings uses the same platform checkboxes and requires at least one selection. One account, pet, diet, mode, sensitivity, and daily allowance are shared across both platforms. Disabling a platform cancels pending checks, removes detector controls, and restores automatically hidden posts. Explicit right-click feeding remains available.

AI checks require **10 words of the author’s own text on X** and **30 on Reddit**. Shorter posts show **Not enough text** and can still be manually fed or checked for categories. Quoted-post text is category context; it does not make a short reaction eligible for AI detection. Quote-only posts can be categorized. The lower X minimum does not establish accuracy on short posts.

Only text already rendered is analyzed. Collapsed long posts are partial assessments. Expanding a post creates a new assessment revision; GomiMon never expands or opens posts itself. Images/video are excluded, but accompanying text may be assessed. Reposts use the original post identity; duplicate appearances do not earn duplicate automatic meals.

### Content filters

Choose AI content, Politics, Ads, Promotions, Ragebait, Celebrity gossip, Sports, or Crypto in your shared diet. Category strength can be Conservative (90%), Balanced (80%, default), or Aggressive (70%). **Ads** uses verified explicit platform markers locally; **Promotions** is a separate semantic category requiring sign-in. Semantic categories use one batched TypeSafe request and remain available below the AI word minimum.

Reddit category filters apply to feed/search cards, leaving comments and the main discussion post alone. On X they apply only to the two supported home feeds. X matches show a placeholder with **Show post**, which restores the post for the tab session. Reddit feed matches are hidden. Failed or unsupported checks leave posts visible. Successful automatic feeds add progress without glitch.

The shared default allowance is 1,000 analyses per account per UTC day. Cached results do not spend another analysis.

## GomiMon Names and Leaderboard

Choose a 2–24 character name while hatching. Letters, numbers, spaces, apostrophes, hyphens, and underscores are supported. The name remains local until you sign in; sign-in reserves it globally when available. Public names also pass deterministic guardrails and a TypeSafe Jev appropriateness check. If a name is taken or cannot be approved, detector sign-in and local pet progress continue normally while you choose another.

Open **View meal leaderboard** to browse weekly or all-time standings. Browsing does not require sign-in. Joining is explicit and publishes only your GomiMon’s name, evolution, and meal count. Your existing local feed total is imported into all-time standings once; weekly standings count meals recorded after joining and reset Monday at 00:00 UTC.

Leaderboard meal delivery retries in the background and never blocks feeding. Leaving immediately hides your GomiMon while keeping its score and reserved name for a later rejoin. Renaming a reserved pet requires sign-in. Deleting the GomiMon account removes the reservation, leaderboard profile, meal events, and detector account data.

## Pet States

### 😊 Healthy (Hunger 30-100, Glitch 0-80)
- Your pet is happy and healthy
- Keep feeding regularly
- Watch for evolution milestones

### 😰 Hungry (Hunger 0-29)
- A "!" badge appears on the toolbar
- Warning message in popup
- Feed your pet soon!

### ⚠️ High Glitch (Glitch 80-99)
- Warning that crash is imminent
- Consider letting glitch decay naturally
- Or risk it for faster growth!

### 💀 Starved (Hunger = 0)
- Pet becomes a pixelated Null-Sprite
- Stops growing
- Feed to revive!

### ❌ Crashed (Glitch = 100)
- Pet shows Blue Screen of Death
- Completely frozen
- Click "REBOOT" button to restore (resets glitch to 0)

## Evolution System

Your GomiMon evolves based on the total number of meals consumed!

### Evolution Stages

#### Stage 1: Egg 🥚
- **Duration**: 0-9 feeds
- **Description**: Your pet's starting form
- **Appearance**: Simple white egg

#### Stage 2: Baby-Gomi 👾
- **Unlocked at**: 10 feeds
- **Description**: Your pet hatches into a cute blob
- **Appearance**: Mint slime with a floating bubble tuft
- **Evolution notification**: "Your GomiMon evolved into Baby-Gomi!"

#### Stage 3: Bubble-Gomi
- **Unlocked at**: 100 feeds
- **Appearance**: Mint slime with little arms, feet, and a bubble crest
- **Animations**: Idle, eating, celebration on evolution, and sleep while resting at high glitch

#### Stage 4: Nimbus-Gomi
- **Unlocked at**: 1,000 total meals
- **Appearance**: A broad mint slime with larger arms, a cream belly, bubble crest, and curled tail
- **Animations**: Idle, eating, celebration on evolution, and sleep at high glitch

All food types count equally toward evolution. Existing adult forms stay unchanged.
A pet advances one stage per meal, including imported pets with high meal counts.

## Tips & Strategies

### Optimal Feeding Strategy

**For Beginners:**
- Feed whenever you see AI content
- Don't worry too much about the glitch meter
- Aim for 10 feeds to hatch your egg

**For Advanced Players:**
- Balance hunger vs. glitch carefully
- Let hunger drop to 30-40 before feeding sprees
- Feed in bursts of 4-5 posts (25 glitch max per session)
- Plan your diet for specific evolution

### Avoiding Crashes

- Never feed more than 5 posts in a row
- Watch the glitch meter carefully
- If glitch is above 80, wait before feeding
- Crashed pets lose time but no permanent progress

### Maximizing Growth

- Set a feeding schedule (every 2-3 hours)
- Use browser notifications to remember
- Feed during your normal browsing
- Target specific content for desired evolution

## Troubleshooting

### "Feed to GomiMon" doesn't appear
- Refresh the page
- Check you're on a supported site
- Reload the extension in chrome://extensions

### Post doesn't disappear
- The animation might be subtle on some sites
- Check that the post actually disappeared after 0.5s
- Some sites have complex layouts that resist removal

### Pet stats not updating
- Click the popup again to refresh
- Check browser console for errors
- Reload the extension

### Sound effects not playing
- Check browser sound settings
- Sound requires permissions
- Some browsers block audio by default

### Evolution not triggering
- Check your feed count in the popup
- Evolutions happen at feeds 10, 100, and 1,000 (onboarding can hatch your egg earlier)
- Try feeding one more time

### Stats reset unexpectedly
- Check if extension was updated
- Browser cache might have cleared
- Future updates will add cloud backup

## Advanced Features

### Keyboard Shortcuts
*Coming in future update*

### Statistics Dashboard
Check your popup info for:
- Total feed count
- Diet breakdown (text/image/post)
- Current evolution stage

### Achievements
*Coming in future update:*
- Speed feeder (100 feeds)
- Diet specialist (100 of one type)
- Crash survivor (recover from 10 crashes)

## Privacy & Ethics

### What GomiMon Does
- Modifies your local view of web pages
- Stores stats locally in your browser
- Sends selected Reddit or X text through the GomiMon detector service to TypeSafe
- Stores detector account, quota, and hashed result metadata on the service
- Only you see the modified feed

### What GomiMon Doesn't Do
- Doesn't affect other users
- Doesn't report or flag content
- Uses sign-in for AI/semantic checks; explicit Ads filtering runs locally
- Doesn't store raw post text after the detector request completes

### Ethical Use
- Use GomiMon to curate your own feed
- Respect content creators
- Remember: you decide what is "slop"
- Have fun and clean your digital space!

## Support

### Getting Help
- Check this guide first
- Read the README.md for technical info
- Check GitHub issues for known problems
- Open a new issue for bugs

### Contributing
GomiMon is open source! Contributions welcome:
- Better sprites
- New evolution paths
- Support for more websites
- Bug fixes and improvements

## Credits

- Created with ❤️ for fighting AI content overload
- Inspired by Tamagotchi virtual pets
- Built with Chrome Extension Manifest V3
- Pixel art sprites included

---

**Enjoy your GomiMon! Feed it well, avoid crashes, and watch it evolve!** 👾🗑️✨
