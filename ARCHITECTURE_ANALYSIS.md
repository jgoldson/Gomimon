# GomiMon Architecture & Codebase Analysis

> This document describes the current implementation. The pet/evolution sections below remain useful product context; the shared detector architecture in sections 1A–1D is authoritative for lifecycle, API, privacy, and deployment behavior.

## Executive Summary
GomiMon is a **Chrome Extension (Manifest V3)** with a local virtual pet and an authenticated Reddit/X detector service. The detector sends selected platform text to the GomiMon API, which forwards it to TypeSafe and returns typed probabilities. Filtering is client-side and is driven by stable platform identity, the current content revision, current settings, and cached scores; feeding is an independent cosmetic/progress effect.

---

## 1. WEBAPP STRUCTURE & ORGANIZATION

### Architecture Type
- **Browser Extension plus authenticated API** (not a traditional webapp)
- **Manifest V3** - Modern Chrome extension standard
- **Local feed policy** - DOM extraction, identity, scheduling, hiding, and pet presentation run in the tab
- **Background broker** - The service worker owns authentication, cross-tab concurrency/rate budgets, score cache, and request correlation
- **Server-backed inference** - The API owns TypeSafe credentials, account quota, server throttling, hashed metadata, and the 24-hour server cache

### Key Components

```
Gomimon/
├── Manifest & Config
│   ├── manifest.json          # Extension configuration (permissions, permissions)
│   └── package.json           # NPM config for tests only
│
├── Background (Service Worker)
│   ├── background.js          # Core game logic, timers, feeding system
│   └── background.js.backup   # Backup of pre-refactor version
│
├── User Interface (Popup)
│   ├── popup.html             # Pet display UI
│   ├── popup.js               # Pet stats/rendering logic
│   └── content.css            # Purge animations
│
├── Web Integration
│   ├── reddit-detector.js     # Structured Reddit DOM adapter
│   ├── detector/              # Revision, store, policy, scheduler, renderer
│   ├── content.js             # Composition root for the tab detector
│   ├── detector-broker.js     # Service-worker score broker/cache
│   └── content.css            # Reversible detector presentation

├── Detector API
│   └── server/                # Authenticated Express API and TypeSafe adapter
│
├── Audio System
│   ├── offscreen.html         # Audio playback container
│   └── offscreen.js           # Sound effect player
│
├── Assets
│   ├── sprites/               # Pet graphics (SVG + animated GIFs)
│   ├── icons/                 # Extension icons (16, 48, 128px)
│   └── sounds/                # Audio effects (gulp.wav, evolve.wav)
│
└── Tests & Config
    ├── tests/                 # Automated test suite (unit, integration, e2e)
    ├── constants.js           # Shared game configuration
    └── Documentation files
```

## 1A. Shared detector ownership and lifecycle

The detector is intentionally split into small classic scripts for the content
side and one ES module for the service-worker broker. `content.js` is only the
composition root; it does not perform unrestricted DOM extraction or make
policy decisions inside render callbacks.

| Component | Owns | Does not own |
| --- | --- | --- |
| Reddit / X adapters | Stable identity, structured extraction, mount/recycle discovery | Requests, policy, pet progress |
| Post store | Immutable snapshots, revision-scoped scores, views, tab overrides | DOM mutation or HTTP |
| Tab scheduler | Viewport priority, bounded queue, dwell/retry timing | Classification decisions |
| Background broker | Authenticated transport, shared concurrency/rate budget, score cache, coalescing | Platform DOM or hide/show policy |
| Policy evaluator | Scores/preferences to hide/show reasons | Requests or pet mutations |
| Renderer | Reversible collapse panels/placeholders and diagnostics UI | Scheduling or reward accounting |
| Pet effect path | Existing progress/animation after a qualifying hide or explicit feed | Filter eligibility |

Each record is keyed by `reddit-{post|comment}-{thingid/fullname/permalink}`
and carries an immutable revision hash of the canonical assessment input. A
response is applied only when its item key and revision still match. Detached
views are cleaned up after five minutes (maximum 500 records), while reusable
score cache entries are independent of DOM lifetime.

Automatic mode scans visible and nearby posts/comments after a dwell period;
category filters remain feed-post-only, and local explicit ad matches do not need
the API. Pending, unsupported, insufficient, and failed items stay visible.
The tab-level Show override survives rerenders and SPA navigation until reload
or tab closure. A score cache hit can filter a remounted item even when the
network quota is exhausted.

### X adapter and platform contract

`platforms.js` is the shared registry for IDs, names, hosts, and AI word minimums. `enabledPlatforms` is stored with shared settings. Onboarding persists Hatch → platforms → diet → complete; no existing-user onboarding migration is required. X activates only at `/home` when For You or Following is selected, and cancels/detaches on navigation or disabling.

`x-detector.js` uses the displayed status ID, excludes nested quote cards as items, and separates `text` from `quotedText`. X requires 10 authored words; Reddit 30. Category checks can use quotes below this minimum. Rendered expansion changes the revision. Unknown layouts remain visible. Automatic feed effects deduplicate by platform/item identity across repeated appearances and tabs.

`/v1/analyze` accepts `platform: "reddit" | "x"` (omission defaults to Reddit) and optional `quotedText`. The background validates the platform against the sender tab. Revisions and both caches include platform and quoted context under `social-detector-v3` / `social-classifier-v2`. Existing sensitivity, request limits, and the 100/day account quota are shared. No X API or X-specific database table is used. Diagnostics include platform and never raw text or quotes.

## 1B. Request protocol and failure handling

The content side sends `protocolVersion`, `operationId`, `itemKey`, `revision`,
priority, and requested judgments. Responses are explicit `complete`,
`deferred`, or `error` results and carry operation/revision/request IDs. A
20-second content watchdog cancels a stalled operation. The broker allows two
in-flight HTTP analyses and at most 25 dispatches per minute across tabs,
coalesces identical requests, and defers rather than treating capacity as a
failure.

The API uses a five-second TypeSafe attempt timeout, at most one retry with a
one-second capped backoff, and a 12-second overall TypeSafe deadline. HTTP
requests have an 18-second deadline. Authentication, throttle, quota, and
transient failures carry structured retry/reset metadata. Expired server cache
rows are updated on conflict instead of being permanently blocked by an
insert-only conflict clause.

## 1C. Diagnostics and privacy

Content diagnostics retain a bounded ring of 200 events and expose item key,
revision prefix, operation/request IDs, extraction method/completeness,
character/word counts, queue wait, request duration, cache state, and policy
reason. They never log post text, credentials, or authorization headers. The
service-worker broker stores only numeric scores and model/rubric metadata in a
session/service/revision-scoped cache (24 hours, 1,000 entries, approximately
2 MB); it never stores post text.

For a live tab, inspect the page console for `[GomiMon Detector]` events. The
read-only `GET_DETECTOR_DIAGNOSTICS` message returns the current record,
scheduler, and event snapshot for tests/debugging. Inspect the service worker
for transport IDs and broker events, and inspect the API with the commands in
`server/README.md`.

## 1D. Release sequence

Deploy the API deadline/error/cache bundle first, verify `/healthz` and one
authenticated analysis, then package/reload the extension and refresh Reddit and X
tabs so old content scripts are replaced. Production server changes use the
GoldenTechLabs workflow in `deploy/README.md`: back up `/srv/gomimon`, restart
`gomimon-detector.service`, run health/log checks, and retain the prior bundle
for rollback. Do not change Caddy or production quotas as part of detector
refactors.

### UI Organization
- **Minimal popup-based UI**: 300x400px window
- **No dedicated settings page** yet
- **Single stat display**: Shows hunger and glitch meters
- **Modal/inline design**: Everything happens in the extension popup

---

## 2. PET SYSTEM IMPLEMENTATION

### Pet State Model (`constants.js`)
```javascript
DEFAULT_STATS = {
  hunger: 100,              // 0-100, depletes over time
  glitch: 0,                // 0-100, increases with feeding
  level: 1,                 // Currently unused (future feature)
  evolution: 'egg',         // Current pet form
  petName: '',              // User-selected companion name
  feedCount: 0,             // Lifetime feedings
  diet: {
    text: 0,                // Text-based posts fed
    image: 0,               // Image-based posts fed
    post: 0                 // Generic posts fed
  },
  lastUpdate: timestamp,    // Last modification time
  schemaVersion: 2          // Naming/leaderboard migration
}
```

### Naming and leaderboard

Hatching requires a locally validated `petName`. Existing hatched pets without one receive a naming prompt without losing progress. After Google sign-in, the API reserves a case-insensitive unique name following deterministic checks and a Jev all-ages Noul judgment.

Leaderboard participation is explicit. PostgreSQL stores private profiles, lifetime totals, and idempotent meal events. The public API exposes only rank, name, evolution, and meal count. Weekly ranks use events received since Monday 00:00 UTC; all-time ranks include a one-time import of local `feedCount`. The extension queues meal events by account and retries outside the durable local feed transaction.

### Pet Evolution System

**Stages:**
1. **Egg** (feedCount 0-9): Starting form, animated sprite
2. **Baby-Gomi** (feedCount 10-99): Hatched form, more animated
3. **Bubble-Gomi** (feedCount 100-999): Mint slime with idle, eating, celebration, and sleep animations
4. **Nimbus-Gomi** (feedCount 1,000+): Animated adult with a bubble crest and curled tail

**Evolution Logic** (feed-logic.js)
- Shared manual, automatic, and category feeding progression
- Total meal thresholds: hatch at 10 (or onboarding), Bubble at 100, Nimbus at 1,000
- One stage per meal; existing legacy adult forms remain valid and unchanged
- Triggers evolution notifications with sound

### Pet States (Non-Evolution)
- **Normal**: Displaying regular sprite with animation
- **Crashed**: Glitch = 100, shows BSOD effect
- **Starved**: Hunger = 0, shows sad Null-Sprite form

### Sprite System (`constants.js`)

**Multi-state sprites per evolution:**
```javascript
PET_SPRITES = {
  egg: {
    idle: 'sprites/animated/egg1_idle.gif',
    eat: 'sprites/animated/egg1_idle.gif',
    crashed: 'sprites/animated/crashed.gif',
    starved: 'sprites/animated/starved.gif'
  },
  baby: {
    idle: 'sprites/animated/baby1_idle.gif',
    eat: 'sprites/animated/baby1_eat.gif',
    crashed: 'sprites/animated/baby1_crashed.gif',
    starved: 'sprites/animated/baby1_starved.gif'
  },
  // ... other evolutions
}
```

**Asset Types:**
- SVG sprites: Static/simple evolutions
- Animated GIFs: baby1 evolutions (4 states each)
- File format: `.gif` for animations

---

## 3. WHERE MINI-GAMES WOULD FIT

### Current Architecture for Mini-Games

The system is designed with extensibility in mind:

#### Option A: Popup-Based Mini-Game
```
popup.html (existing)
├── Main Pet Display Area
└── NEW: Modal/Tab for Mini-Games
    ├── Game Container
    ├── Game Controls
    └── Results/Rewards

popup.js (extend)
├── Existing: updateUI()
├── NEW: initializeMiniGame()
├── NEW: handleGameInteraction()
└── NEW: processGameResults()
```

**Pros:**
- Uses existing popup window
- Shares pet stats system
- No new infrastructure needed
- Player already familiar with interface

**Cons:**
- Limited space (300x400px)
- No fullscreen capability
- Competes with pet display

#### Option B: Dedicated Mini-Game Window
```
New file: minigame.html
New file: minigame.js
New file: minigame.css

manifest.json (extend)
├── Add web_accessible_resources for game assets
├── Add permissions for game storage
└── Update web_accessible_resources
```

**Pros:**
- Fullscreen capability
- More flexible UI
- Better for complex games
- Separate from main pet UI

**Cons:**
- New window management needed
- Must communicate with background.js
- More complex state management

#### Option C: Inline Game (Recommended for Slop Scholar)
```
popup.html
├── Pet Display (80% of popup)
└── Mini-Game Area (20% at bottom)
    └── "Play Game" button
       └── Launches to minigame.html in new window

OR

popup.html (modal approach)
├── Regular Pet View
└── NEW: Game Modal (toggles over pet)
```

### Storage & State Management for Mini-Games

**Currently Implemented:**
- `chrome.storage.local`: Pet stats
- Storage locking system: Prevents race conditions
- Sanitization: All values validated

**For Mini-Games, Extend With:**
```javascript
// Add to DEFAULT_STATS:
miniGames: {
  slopScholar: {
    highScore: 0,
    gamesPlayed: 0,
    bestAccuracy: 0,
    lastPlayed: timestamp,
    totalRewards: 0
  }
}

// New stats for each mini-game:
{
  name: string,          // Game identifier
  highScore: number,     // Best score ever
  lastScore: number,     // Most recent score
  gamesPlayed: number,   // Total attempts
  rewards: {
    hunger: 0,           // Stats earned
    glitch: 0,
    totalCredits: 0
  }
}
```

### Mini-Game Interaction Flow

```
1. User clicks "Play Game" in popup
2. background.js validates pet state (must not be crashed/starved)
3. Opens minigame.html in new window
4. Mini-game loads and reads pet stats
5. Player plays game
6. On completion:
   - Mini-game sends results to background.js via chrome.runtime.sendMessage()
   - background.js validates & applies rewards
   - Popup.js listens to storage changes and updates display
   - Mini-game closes
```

### Recommendation for Slop Scholar
- **Location**: `minigame-scholar.html`, `minigame-scholar.js`
- **Storage key**: `miniGames.slopScholar`
- **Trigger**: New button in `popup.html` → "Play Slop Scholar"
- **Window management**: background.js handles window lifecycle
- **Rewards system**: Points convert to hunger (direct) or glitch (indirect)

---

## 4. UI FRAMEWORK

### Framework Analysis
**Not using a traditional UI framework!**

- No React, Vue, Angular, Svelte, etc.
- Pure **Vanilla JavaScript** (ES6 modules)
- **HTML5** with semantic markup
- **CSS3** with animations and gradients

### HTML Structure
```html
<!-- popup.html -->
<body>
  <div class="container">
    <div class="pet-name">GomiMon</div>
    <div class="pet-container">
      <div class="pet-sprite">
        <img src="sprites/egg.gif" />
      </div>
    </div>
    <div class="stats">
      <!-- Hunger bar with progress -->
      <!-- Glitch-O-Meter with progress -->
    </div>
    <button class="reboot-button" id="rebootButton">REBOOT</button>
    <div class="info"><!-- Info text --></div>
  </div>
  <script src="popup.js" type="module"></script>
</body>
```

### CSS Styling
- **CSS Grid**: Used for layout
- **Flexbox**: For alignment
- **CSS Animations**: Complex glitch effects
- **Gradients**: Purple/blue theme
- **Keyframes**: Fly-in, eat, fly-away, glitch-out

**Key Animation Classes:**
```css
@keyframes gomimon-fly-in { ... }      /* Pet flies in to eat */
@keyframes gomimon-eat { ... }         /* Chomping motion */
@keyframes gomimon-fly-away { ... }    /* Pet retreats */
@keyframes gomi-glitch-out { ... }     /* Post disappears */
@keyframes glitch { ... }              /* BSOD glitch effect */
```

### JavaScript Architecture

**Module System (ES6):**
```javascript
// constants.js - Exports game config
export const HUNGER_DECREASE_RATE = 1;
export const DEFAULT_STATS = { ... };

// popup.js - Main UI logic
import { DEFAULT_STATS, getPetSprite } from './constants.js';

// background.js - Game logic
import { HUNGER_TICK_MINUTES, updateStats } from './constants.js';
```

**Key Patterns:**
1. **Event-driven**: Listeners for storage changes, button clicks, alarms
2. **Async/await**: Promise-based Chrome API calls
3. **Caching**: DOM elements cached once, stats cached to prevent re-renders
4. **Polling fallback**: Storage change listener + 5-second interval

---

## 5. PET INTERACTIONS & MECHANICS

### Feeding System (Core Loop)

**User Action:**
1. Right-click any element on web page
2. Select "Feed to GomiMon 👾" from context menu

**Background Processing (`background.js:413-507`):**

```javascript
// Triggered by context menu click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // 1. Validate rate limits
  if (!checkRateLimit()) return;
  
  // 2. Get current stats
  const stats = await getStats();
  
  // 3. Calculate changes
  const newHunger = Math.min(100, stats.hunger + 20);
  const newGlitch = Math.min(100, stats.glitch + 5);
  const newFeedCount = stats.feedCount + 1;
  
  // 4. Determine food type (text/image/post)
  const foodType = determineFoodType(info);
  
  // 5. Update diet tracking
  const newDiet = { ...stats.diet };
  newDiet[foodType] += 1;
  
  // 6. Check for evolution
  const { evolution, justEvolved } = calculateEvolution(
    newFeedCount, 
    stats.evolution, 
    newDiet
  );
  
  // 7. Update storage
  await updateStats({
    hunger: newHunger,
    glitch: newGlitch,
    feedCount: newFeedCount,
    diet: newDiet,
    evolution
  });
  
  // 8. Show evolution notification if needed
  if (justEvolved) {
    await showEvolutionNotification(evolution);
  }
  
  // 9. Inject CSS and execute purge animation
  await injectCSS(tab.id);
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: purgeAtCoordinates,
    args: [info, evolution]
  });
  
  // 10. Play feedback
  playSound('gulp');
  animateIcon();
});
```

### Hunger System (Passive Mechanic)

**Timer-Based Depletion:**
- Alarm fires every **15 minutes**
- Decreases hunger by **1 point**
- Triggers "low hunger" badge at **<30 points**

```javascript
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'hungerTick') {
    const stats = await getStats();
    const newHunger = Math.max(0, stats.hunger - HUNGER_DECREASE_RATE);
    await updateStats({ hunger: newHunger });
    updateHungerBadge(newHunger);
  }
});
```

### Glitch System (Risk/Reward)

**Mechanics:**
- Each feed adds **5 glitch points**
- At **100 glitch**: Pet crashes
- User must click "Reboot" button to reset
- Crash state shows BSOD visual effect

```javascript
// In popup.js
if (stats.glitch >= GLITCH_CRASH_THRESHOLD) {
  elements.petContainer.classList.add('crashed');
  // Show reboot button and error UI
}

// Reboot listener
async function handleReboot() {
  const stats = await chrome.storage.local.get(DEFAULT_STATS);
  await chrome.storage.local.set({
    ...stats,
    glitch: 0
  });
  await updateUI();
}
```

### Animation System (Feedback)

**Three-Stage Feeding Animation:**

1. **Fly-In** (600ms): Pet enters from corner toward post
   ```css
   @keyframes gomimon-fly-in {
     0% { transform: translate(-50%, -50%) scale(0.5) rotate(-15deg); opacity: 0; }
     100% { transform: translate(-50%, -50%) scale(1) rotate(0deg); opacity: 1; }
   }
   ```

2. **Eating** (400ms × 3 loops): Pet chomps at post
   ```css
   @keyframes gomimon-eat {
     0%, 100% { transform: translate(-50%, -50%) scale(1) rotate(0deg); }
     25% { transform: translate(-50%, -50%) scale(1.15) rotate(-5deg); }
     75% { transform: translate(-50%, -50%) scale(0.95) rotate(5deg); }
   }
   ```

3. **Fly-Away** (500ms): Pet retreats after eating
   ```css
   @keyframes gomimon-fly-away {
     0% { transform: translate(-50%, -50%) scale(1) rotate(0deg); opacity: 1; }
     100% { transform: translate(-50%, -50%) scale(0.3) rotate(25deg); opacity: 0; }
   }
   ```

**Post Removal Animation:**
```css
@keyframes gomi-glitch-out {
  0% { opacity: 1; transform: scale(1); }
  20% { opacity: 0.8; transform: scale(1.02) skew(-2deg, 1deg); filter: hue-rotate(90deg); }
  /* ... progressive glitch effect ... */
  100% { opacity: 0; transform: scale(0.3); height: 0; }
}
```

### Sound Effects

**Two sounds in system:**
- `gulp.wav` (500ms): Plays on feed
- `evolve.wav` (1s): Plays on evolution

**Implementation** (`background.js:788-814`):
```javascript
async function playSound(soundName) {
  // 1. Ensure offscreen document exists
  const created = await ensureOffscreenDocument();
  
  // 2. Send message to offscreen.js
  await chrome.runtime.sendMessage({
    action: 'playSound',
    sound: soundName
  });
  
  // 3. Close offscreen doc after 3 seconds (saves resources)
  setTimeout(() => closeOffscreenDocument(), 3000);
}
```

---

## 6. EXISTING GAME LOGIC & PATTERNS

### Core Systems Implemented

#### A. State Management
- **Storage-based**: All state in `chrome.storage.local`
- **Persistence**: Survives browser restart
- **Validation**: `sanitizeStats()` ensures safe values
- **Migrations**: Schema versioning system for future compatibility

#### B. Rate Limiting
```javascript
function checkRateLimit() {
  // Cooldown: 500ms minimum between feeds
  // Rate limit: Max 20 feeds per minute (sliding window)
}
```

#### C. Error Handling
- Global error handlers for uncaught exceptions
- Error reporting to storage (recent 10 errors kept)
- Try-catch blocks throughout
- Graceful fallbacks for missing elements

#### D. Smart Post Detection
Detects parent post container on multiple platforms:
- **Twitter/X**: `<article>` tags
- **Reddit**: `shreddit-post` elements or `data-testid` attributes
- **Facebook**: Article roles with specific attributes
- **Generic**: Fallback to large parent elements

#### E. Performance Optimizations
- DOM element caching (not queried repeatedly)
- Storage change listeners (not polling)
- CSS injection tracking (injected once per tab)
- Offscreen document cleanup (closes after use)
- Change detection (only updates UI if stats changed)

#### F. Storage Locking System
Prevents race conditions when feed happens during hunger tick:
```javascript
const storageLock = { locked: false, queue: [] };

async function withStorageLock(operation) {
  // Ensures sequential execution
  // Queues operations if another is in progress
}
```

### Configuration Constants (`constants.js`)

```javascript
// Game Balance
HUNGER_DECREASE_RATE = 1              // Per 15 minutes
HUNGER_INCREASE_PER_FEED = 20         // Per feed
GLITCH_INCREASE_PER_FEED = 5          // Per feed
HUNGER_TICK_MINUTES = 15              // Timer interval
LOW_HUNGER_THRESHOLD = 30             // Show badge
HIGH_GLITCH_THRESHOLD = 80            // Show warning
GLITCH_CRASH_THRESHOLD = 100          // Crash state

// Evolution
EGG_TO_BABY_FEEDS = 10
BABY_TO_BUBBLE_FEEDS = 100
BUBBLE_TO_ADULT_FEEDS = 1000
DIET_DOMINANCE_THRESHOLD = 0.5        // 50% threshold

// Rate Limiting
MAX_FEEDS_PER_MINUTE = 20
FEED_COOLDOWN_MS = 500

// Animation Durations
ANIMATION_DURATION = {
  PURGE: 500,
  ICON_WIGGLE: 300,
  BADGE_FLASH: 2000,
  OFFSCREEN_CLOSE_DELAY: 3000
}
```

### Testing Infrastructure

**Test Framework**: Jest with jest-chrome for Chrome API mocking

**Test Types:**
- **Unit Tests**: Constants, evolution logic (`tests/unit/`)
- **Integration Tests**: Feeding, storage (`tests/integration/`)
- **E2E Tests**: End-to-end scenarios (`tests/e2e/`)

**Coverage Target**: 70% (set in package.json)

---

## 7. RECOMMENDED ARCHITECTURE FOR "SLOP SCHOLAR" MINI-GAME

### Structure

```
├── minigames/
│   ├── scholar/
│   │   ├── minigame-scholar.html      # Game UI
│   │   ├── minigame-scholar.js        # Game logic
│   │   ├── minigame-scholar.css       # Game styles
│   │   └── scholar-constants.js       # Game-specific config
│   └── [future games]
│
├── constants.js                        # Extended with miniGame stats
└── background.js                      # Add mini-game reward handling
```

### Key Integration Points

1. **Launch Point** (popup.html):
   ```html
   <button id="playScholarButton" class="mini-game-button">
     Play Slop Scholar
   </button>
   ```

2. **Window Management** (background.js):
   ```javascript
   chrome.runtime.onMessage.addListener((msg) => {
     if (msg.action === 'openMiniGame') {
       chrome.windows.create({
         url: chrome.runtime.getURL('minigames/scholar/minigame-scholar.html'),
         type: 'popup',
         width: 800,
         height: 600
       });
     }
   });
   ```

3. **Reward System** (background.js):
   ```javascript
   // When game finishes, apply rewards
   async function applyMiniGameReward(gameName, rewards) {
     const stats = await getStats();
     await updateStats({
       hunger: Math.min(100, stats.hunger + rewards.hunger),
       glitch: Math.min(100, stats.glitch + rewards.glitch),
       miniGames: {
         ...stats.miniGames,
         [gameName]: {
           ...stats.miniGames[gameName],
           lastScore: rewards.score,
           highScore: Math.max(...),
           gamesPlayed: ...
         }
       }
    });
   }
   ```

4. **Stats Extension** (constants.js):
   ```javascript
   export const DEFAULT_STATS = {
     // ... existing stats
     miniGames: {
       slopScholar: {
         highScore: 0,
         gamesPlayed: 0,
         bestAccuracy: 0,
         lastPlayed: 0,
         totalPointsEarned: 0
       }
     }
   };
   ```

---

## Summary

**Key Takeaways for Mini-Game Implementation:**

1. **Pure JavaScript**: No framework dependencies - use vanilla JS
2. **Event-Driven**: Use chrome.runtime.sendMessage() for communication
3. **Storage-Based State**: Extend DEFAULT_STATS in constants.js
4. **Window Management**: background.js handles creating game windows
5. **Reward System**: Modify pet stats via chrome.storage.local
6. **Rate Limiting**: Already in place - use for game access too
7. **Error Handling**: Wrap game logic in try-catch like main code
8. **Testing**: Create game-specific tests in `tests/unit/scholar.test.js`

The architecture is well-designed for extension, with clear separation of concerns and established patterns for state management, validation, and error handling.
