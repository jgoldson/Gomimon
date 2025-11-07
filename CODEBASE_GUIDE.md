# GomiMon Codebase Quick Reference Guide

## File Purposes at a Glance

### Core Game Logic
| File | Lines | Purpose |
|------|-------|---------|
| `background.js` | 825 | Service worker: timers, storage, feeding logic, animations |
| `constants.js` | 164 | Game configuration, constants, helper functions |
| `popup.js` | 186 | UI rendering, stat display, user interaction |

### User Interface
| File | Purpose |
|------|---------|
| `popup.html` | Pet display UI (300x400px popup) |
| `content.js` | Legacy content script (mostly moved to background.js) |
| `content.css` | Post removal animations, pet overlay styles |

### Audio System
| File | Purpose |
|------|---------|
| `offscreen.html` | Audio playback container (Manifest V3 requirement) |
| `offscreen.js` | Sound effect player |
| `sounds/gulp.wav` | Feed sound effect |
| `sounds/evolve.wav` | Evolution sound effect |

### Configuration
| File | Purpose |
|------|---------|
| `manifest.json` | Extension permissions, metadata, entry points |
| `package.json` | NPM config for test suite only |

### Assets
| Directory | Purpose |
|-----------|---------|
| `sprites/` | Pet graphics (SVG static + animated GIFs) |
| `sprites/animated/` | Animated GIF sprites for pet states |
| `icons/` | Extension toolbar icons (16, 48, 128px) |

### Testing
| Directory | Purpose |
|-----------|---------|
| `tests/unit/` | Unit tests (constants, evolution logic) |
| `tests/integration/` | Integration tests (feeding, storage) |
| `tests/e2e/` | End-to-end scenario tests |
| `tests/setup.js` | Jest test configuration |

### Documentation
| File | Purpose |
|------|---------|
| `README.md` | User guide and feature overview |
| `USER_GUIDE.md` | Comprehensive user documentation |
| `GomiMon GDD.txt` | Original game design document |
| `IMPROVEMENTS.md` | v0.2.0 improvements and changes |
| `ARCHITECTURE_ANALYSIS.md` | Deep dive architecture documentation |
| `ARCHITECTURE_DIAGRAM.txt` | ASCII flow diagrams |

---

## Key Functions by File

### background.js - Service Worker Core

**Initialization:**
- `chrome.runtime.onInstalled` - Sets up extension on first install
- `chrome.runtime.onStartup` - Catches up on missed hunger ticks

**Game Logic:**
- `getStats()` - Safely retrieves pet stats from storage
- `updateStats(updates)` - Updates stats with storage locking
- `calculateEvolution(feedCount, evolution, diet)` - Determines pet evolution
- `checkRateLimit()` - Prevents feed spam (20/min, 500ms cooldown)

**Feeding System:**
- `chrome.contextMenus.onClicked` - Main feed handler
- `determineFoodType(info)` - Identifies text/image/post feed
- `validateContextInfo(info)` - Sanitizes right-click data
- `purgeAtCoordinates(info, evolution)` - Removes post and shows animation

**Feedback:**
- `showEvolutionNotification(evolution)` - Desktop notification on evolution
- `playSound(soundName)` - Plays gulp or evolve sound
- `animateIcon()` - Makes toolbar icon wiggle
- `updateHungerBadge(hunger)` - Shows "!" on hungry

**Post Detection:**
- `findParentPost(element)` - Smart DOM traversal for multi-platform support
  - Works on Twitter/X, Reddit, Facebook, generic sites

**Timers:**
- `chrome.alarms.onAlarm` - Hunger timer fires every 15 minutes
- `ensureOffscreenDocument()` - Creates audio playback context
- `closeOffscreenDocument()` - Cleans up to save resources

**Error Handling:**
- `reportError(context, error)` - Logs and stores errors
- Global error handlers for uncaught exceptions

---

### popup.js - UI Controller

**Initialization:**
- `initialize()` - Sets up event listeners and initial UI
- `cacheElements()` - Caches DOM references for performance

**State Display:**
- `updateUI()` - Main rendering function
  - Updates hunger/glitch bars
  - Changes pet sprite based on state
  - Shows appropriate messages
  - Handles crashed/starved states

**User Interactions:**
- `handleReboot()` - Listener for reboot button click

**Storage Listeners:**
- `chrome.storage.onChanged` - React to pet stat changes
- Fallback: 5-second interval poll

---

### constants.js - Configuration Hub

**Game Balance:**
- `HUNGER_DECREASE_RATE` = 1 per 15min
- `HUNGER_INCREASE_PER_FEED` = 20
- `GLITCH_INCREASE_PER_FEED` = 5

**Evolution Thresholds:**
- `EGG_TO_BABY_FEEDS` = 10
- `BABY_TO_ADULT_FEEDS` = 50
- `DIET_DOMINANCE_THRESHOLD` = 0.5 (50%)

**Validation:**
- `sanitizeStats(stats)` - Ensures all values are valid ranges
- `DEFAULT_STATS` - Template for new pet
- `VALID_EVOLUTIONS` - List of allowed evolution states

**Helpers:**
- `getPetSprite(evolution, state)` - Returns correct sprite path
- `debugLog()` - Conditional logging

---

## Critical Code Patterns

### State Management Pattern
```javascript
// Always use this for stats:
const stats = await getStats();              // Get validated stats
const newStats = { ...stats, hunger: 50 };  // Create new object
await updateStats(newStats);                // Atomic update with lock
```

### Storage Lock Pattern (Prevents Race Conditions)
```javascript
// Used by updateStats() automatically
async function withStorageLock(operation) {
  // Ensures only one storage op at a time
  // Queues others if another is running
}
```

### Event Listener Pattern
```javascript
// All major events use this:
chrome.alarms.onAlarm.addListener(async (alarm) => { ... });
chrome.contextMenus.onClicked.addListener(async (info, tab) => { ... });
chrome.storage.onChanged.addListener((changes, namespace) => { ... });
```

### Error Handling Pattern
```javascript
try {
  // operation
  debugLog('Success');
} catch (error) {
  reportError('context-name', error);  // Logs + stores error
}
```

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────┐
│                   BROWSER EVENT                      │
│     (Right-click or Hunger Timer)                    │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│           background.js EVENT HANDLER                │
│     (onClicked or onAlarm)                           │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│     getStats() → Retrieve from chrome.storage       │
│     Validate with sanitizeStats()                   │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│     CALCULATE CHANGES                                │
│     • updateStats({ hunger, glitch, ... })         │
│     • calculateEvolution()                           │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│     withStorageLock() → ATOMIC UPDATE                │
│     Sets new stats in chrome.storage.local           │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│     SIDE EFFECTS                                     │
│     • playSound()                                    │
│     • animateIcon()                                  │
│     • showEvolutionNotification()                    │
│     • purgeAtCoordinates() - inject script           │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│     chrome.storage.onChanged fires                  │
│     Popup.js listening                              │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│     popup.js updateUI()                              │
│     • getStats() → read new state                    │
│     • Compare with cached version                    │
│     • Update DOM if changed                          │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│          POPUP DISPLAY UPDATES                       │
│     User sees new pet, hunger, glitch               │
└─────────────────────────────────────────────────────┘
```

---

## Important Design Decisions

### Why No Framework?
- Browser extensions work better with vanilla JS
- Smaller bundle size (important for extensions)
- Simpler deployment (no build step needed)
- Easier debugging in extension environment

### Why ES6 Modules?
- Modern standard supported by Manifest V3
- Better code organization
- Avoids global namespace pollution
- Easier to test individual functions

### Why Popup-Based UI?
- Keeps pet always accessible
- Uses minimal resources
- Natural for Tamagotchi-style game
- Quick check-in gameplay loop

### Why Storage Locking?
- Browser extensions are event-driven
- Multiple events can fire simultaneously
- Storage updates must be sequential
- Prevents data loss from race conditions

### Why Offscreen Document for Audio?
- Manifest V3 doesn't allow audio in background
- Offscreen documents are lightweight audio-only contexts
- Cleaned up after use to save resources
- Proper pattern for modern extensions

---

## Testing Architecture

### Test Files Organization
```
tests/
├── unit/
│   ├── constants.test.js      # Validate constant definitions
│   └── evolution.test.js      # Test evolution logic
├── integration/
│   ├── storage.test.js        # Storage persistence
│   ├── feeding.test.js        # Feed system
│   └── rate-limiting.test.js  # Rate limit logic
├── e2e/
│   └── scenarios.test.js      # Full workflow tests
└── setup.js                   # Jest configuration
```

### Running Tests
```bash
npm test              # Run all tests
npm run test:unit     # Unit tests only
npm run test:integration  # Integration tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

### Coverage Requirements
- Minimum 70% coverage (set in package.json)
- Functions: 70%
- Lines: 70%
- Branches: 70%
- Statements: 70%

---

## Future Extensibility Points

### For Mini-Games
1. **Add mini-game stats** to DEFAULT_STATS in constants.js
2. **Create minigames/scholar/** directory
3. **Add button** to popup.html
4. **Handle window creation** in background.js
5. **Listen for results** in background.js
6. **Apply rewards** via updateStats()

### For New Evolutions
1. Add sprite to `sprites/animated/`
2. Add to PET_SPRITES in constants.js
3. Update evolution logic in background.js
4. Create evolution condition (e.g., specific diet ratio)
5. Add test cases

### For New Platforms
1. Update post detection in `findParentPost()`
2. Test selector patterns
3. Add to README.md supported sites
4. Verify with integration tests

---

## Debugging Tips

### Check Background Service Worker
1. Click extension icon → right-click → "Inspect service worker"
2. All game logic logs appear here
3. Check "Recent errors" in storage

### Check Popup
1. Right-click popup → "Inspect"
2. All UI logs appear here
3. Check cachedStats in console

### Check Storage
```javascript
// In DevTools console:
chrome.storage.local.get(null, (items) => console.log(items));
```

### Enable Debug Mode
```javascript
// In constants.js:
export const DEBUG_MODE = true;  // Changes to true
// All debugLog() calls will print
```

### Monitor Hunger Ticks
1. Open background inspector
2. Set timer to 1 minute: `HUNGER_TICK_MINUTES = 1`
3. Watch onAlarm fires every minute

---

## Version History

- **v0.2.0** (Current) - Major refactor, 111 tests, full documentation
- **v0.1.0** - Initial release with core features

---

## File Modification Checklist

When adding features, typically modify in this order:

1. **constants.js** - Add configuration
2. **background.js** - Add logic
3. **popup.html** - Add UI element
4. **popup.js** - Add UI handler
5. **content.css** - Add styling if needed
6. **tests/** - Add test coverage
7. **README.md** - Document feature

