// GomiMon Background Service Worker (Refactored)
// Handles pet state, timers, feeding logic with proper error handling

import {
  HUNGER_DECREASE_RATE,
  HUNGER_INCREASE_PER_FEED,
  GLITCH_INCREASE_PER_FEED,
  HUNGER_TICK_MINUTES,
  LOW_HUNGER_THRESHOLD,
  HIGH_GLITCH_THRESHOLD,
  GLITCH_CRASH_THRESHOLD,
  EGG_TO_BABY_FEEDS,
  BABY_TO_ADULT_FEEDS,
  DIET_DOMINANCE_THRESHOLD,
  MAX_FEEDS_PER_MINUTE,
  FEED_COOLDOWN_MS,
  EVOLUTION_NAMES,
  EVOLUTION_TREES,
  DEFAULT_STATS,
  FOOD_TYPES,
  ANIMATION_DURATION,
  VALIDATION_LIMITS,
  debugLog,
  sanitizeStats
} from './constants.js';

// State management
let offscreenDocumentPromise = null;
const injectedTabs = new Set();
const feedTimestamps = [];
let lastFeedTime = 0;

// Storage lock to prevent concurrent updates
const storageLock = {
  locked: false,
  queue: []
};

// Error reporting
function reportError(context, error) {
  console.error(`[GomiMon ${context}]`, error);

  // Store recent errors for debugging
  chrome.storage.local.get(['recentErrors']).then(({ recentErrors = [] }) => {
    recentErrors.push({
      context,
      message: error.message,
      stack: error.stack,
      timestamp: Date.now()
    });

    // Keep only last 10 errors
    if (recentErrors.length > VALIDATION_LIMITS.MAX_STORED_ERRORS) {
      recentErrors = recentErrors.slice(-VALIDATION_LIMITS.MAX_STORED_ERRORS);
    }

    chrome.storage.local.set({ recentErrors }).catch(e =>
      console.error('Failed to store error:', e)
    );
  }).catch(e => console.error('Failed to get errors:', e));
}

// Safe storage operations with locking
async function withStorageLock(operation) {
  return new Promise((resolve, reject) => {
    const execute = async () => {
      if (storageLock.locked) {
        storageLock.queue.push({ resolve, reject, operation });
        return;
      }

      storageLock.locked = true;
      try {
        const result = await operation();
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        storageLock.locked = false;

        // Process queue
        if (storageLock.queue.length > 0) {
          const next = storageLock.queue.shift();
          execute.call(null);
          withStorageLock(next.operation).then(next.resolve).catch(next.reject);
        }
      }
    };

    execute();
  });
}

// Get stats with defaults and validation
async function getStats() {
  try {
    const stats = await chrome.storage.local.get(DEFAULT_STATS);
    return sanitizeStats(stats);
  } catch (error) {
    reportError('getStats', error);
    return { ...DEFAULT_STATS };
  }
}

// Update stats safely
async function updateStats(updates) {
  return withStorageLock(async () => {
    const current = await getStats();
    const newStats = sanitizeStats({ ...current, ...updates, lastUpdate: Date.now() });
    await chrome.storage.local.set(newStats);
    return newStats;
  });
}

// Rate limiting for feeds
function checkRateLimit() {
  const now = Date.now();

  // Check cooldown
  if (now - lastFeedTime < FEED_COOLDOWN_MS) {
    debugLog('Feed cooldown active');
    return false;
  }

  // Check rate limit
  const oneMinuteAgo = now - 60000;

  // Remove old timestamps
  while (feedTimestamps.length > 0 && feedTimestamps[0] < oneMinuteAgo) {
    feedTimestamps.shift();
  }

  if (feedTimestamps.length >= MAX_FEEDS_PER_MINUTE) {
    debugLog('Rate limit exceeded');
    return false;
  }

  feedTimestamps.push(now);
  lastFeedTime = now;
  return true;
}

// Initialize extension
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  try {
    debugLog('Extension installed, reason:', reason);

    if (reason === 'install') {
      // First install
      await chrome.storage.local.set(DEFAULT_STATS);
      debugLog('Initialized with default stats:', DEFAULT_STATS);
    } else if (reason === 'update') {
      // Handle updates/migrations
      await migrateStorage();
    }

    // Create context menu
    await chrome.contextMenus.create({
      id: 'feedGomiMon',
      title: 'Feed to GomiMon 👾',
      contexts: ['all']
    });

    // Create hunger timer alarm
    await chrome.alarms.create('hungerTick', {
      periodInMinutes: HUNGER_TICK_MINUTES
    });

    debugLog('Extension initialized successfully');
  } catch (error) {
    reportError('onInstalled', error);
  }
});

// Handle browser startup - catch up on missed ticks
chrome.runtime.onStartup.addListener(async () => {
  try {
    debugLog('Browser startup detected');

    const stats = await getStats();
    const timeSinceUpdate = Date.now() - stats.lastUpdate;
    const missedTicks = Math.floor(timeSinceUpdate / (HUNGER_TICK_MINUTES * 60000));

    if (missedTicks > 0) {
      debugLog(`Catching up on ${missedTicks} missed hunger ticks`);
      const newHunger = Math.max(0, stats.hunger - (missedTicks * HUNGER_DECREASE_RATE));
      await updateStats({ hunger: newHunger });

      // Update badge if needed
      updateHungerBadge(newHunger);
    }
  } catch (error) {
    reportError('onStartup', error);
  }
});

// Storage migration
async function migrateStorage() {
  try {
    const data = await chrome.storage.local.get();
    const version = data.schemaVersion || 0;

    debugLog('Current schema version:', version);

    if (version < 1) {
      // Migration from version 0 to 1
      debugLog('Migrating from version 0 to 1');

      // Ensure all required fields exist
      const migrated = {
        ...DEFAULT_STATS,
        ...data,
        schemaVersion: 1
      };

      await chrome.storage.local.set(sanitizeStats(migrated));
      debugLog('Migration to version 1 complete');
    }

    if (version < 2) {
      // Migration from version 1 to 2 (egg type support)
      debugLog('Migrating from version 1 to 2');

      const currentData = await chrome.storage.local.get();

      // If they have an existing 'egg' or 'baby' or adult evolution,
      // default to egg1 type and update evolution accordingly
      let eggType = null;
      let evolution = currentData.evolution;

      if (currentData.evolution === 'egg') {
        eggType = 'egg1';
        evolution = 'egg1';
      } else if (currentData.evolution === 'baby') {
        eggType = 'egg1';
        evolution = 'baby1';
      } else if (currentData.evolution === 'typo-ling') {
        eggType = 'egg1';
        evolution = 'typo-ling1';
      } else if (currentData.evolution === 'muta-pixel') {
        eggType = 'egg1';
        evolution = 'muta-pixel1';
      } else if (currentData.evolution === 'classic-gomi') {
        eggType = 'egg1';
        evolution = 'classic-gomi1';
      }

      const migrated = {
        ...currentData,
        eggType,
        evolution,
        schemaVersion: 2
      };

      await chrome.storage.local.set(sanitizeStats(migrated));
      debugLog('Migration to version 2 complete');
    }
  } catch (error) {
    reportError('migrateStorage', error);
  }
}

// Update hunger badge
function updateHungerBadge(hunger) {
  try {
    if (hunger < LOW_HUNGER_THRESHOLD) {
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch (error) {
    reportError('updateHungerBadge', error);
  }
}

// Handle hunger timer
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'hungerTick') {
    try {
      debugLog('Hunger tick triggered');

      const stats = await getStats();
      const newHunger = Math.max(0, stats.hunger - HUNGER_DECREASE_RATE);

      await updateStats({ hunger: newHunger });

      debugLog('Hunger decreased to:', newHunger);

      // Update badge
      updateHungerBadge(newHunger);

      // Notify if starving
      if (newHunger === 0) {
        debugLog('Pet is starving!');
        // Could show notification here
      }
    } catch (error) {
      reportError('hungerTick', error);
    }
  }
});

// Validate and sanitize context menu info
function validateContextInfo(info) {
  return {
    x: typeof info.x === 'number'
      ? Math.max(0, Math.min(info.x, VALIDATION_LIMITS.MAX_COORDINATE))
      : undefined,
    y: typeof info.y === 'number'
      ? Math.max(0, Math.min(info.y, VALIDATION_LIMITS.MAX_COORDINATE))
      : undefined,
    srcUrl: typeof info.srcUrl === 'string'
      ? info.srcUrl.substring(0, VALIDATION_LIMITS.MAX_URL_LENGTH)
      : undefined,
    selectionText: typeof info.selectionText === 'string'
      ? info.selectionText.substring(0, VALIDATION_LIMITS.MAX_SELECTION_TEXT)
      : undefined,
    frameId: info.frameId
  };
}

// Determine food type from context
function determineFoodType(info) {
  if (info.srcUrl) {
    return FOOD_TYPES.IMAGE;
  } else if (info.selectionText) {
    return FOOD_TYPES.TEXT;
  }
  return FOOD_TYPES.POST;
}

// Calculate evolution based on diet and egg type
function calculateEvolution(feedCount, currentEvolution, diet, eggType) {
  // Check if egg type is valid
  if (!eggType || !EVOLUTION_TREES[eggType]) {
    debugLog('Invalid egg type:', eggType);
    return { evolution: currentEvolution, justEvolved: false };
  }

  const evolutionTree = EVOLUTION_TREES[eggType];

  // Egg to Baby at 10 feeds
  if (feedCount >= EGG_TO_BABY_FEEDS && (currentEvolution === 'egg1' || currentEvolution === 'egg2' || currentEvolution === 'egg3')) {
    return { evolution: evolutionTree.baby, justEvolved: true };
  }

  // Baby to Adult at 50 feeds
  if (feedCount >= BABY_TO_ADULT_FEEDS && (currentEvolution === 'baby1' || currentEvolution === 'baby2' || currentEvolution === 'baby3')) {
    const total = diet.text + diet.image + diet.post;

    // Prevent division by zero
    if (total === 0) {
      debugLog('No diet data, defaulting to balanced evolution');
      return { evolution: evolutionTree.balanced, justEvolved: true };
    }

    // Determine evolution based on dominant food type
    const textRatio = diet.text / total;
    const imageRatio = diet.image / total;

    if (textRatio > DIET_DOMINANCE_THRESHOLD) {
      return { evolution: evolutionTree.textHeavy, justEvolved: true };
    } else if (imageRatio > DIET_DOMINANCE_THRESHOLD) {
      return { evolution: evolutionTree.imageHeavy, justEvolved: true };
    } else {
      return { evolution: evolutionTree.balanced, justEvolved: true };
    }
  }

  return { evolution: currentEvolution, justEvolved: false };
}

// Show evolution notification
async function showEvolutionNotification(evolution) {
  try {
    // Check if notifications permission is available
    const hasPermission = await chrome.permissions.contains({
      permissions: ['notifications']
    });

    if (!hasPermission) {
      debugLog('Notification permission not granted');
      return;
    }

    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '🎉 GomiMon Evolved!',
      message: `Your GomiMon evolved into ${EVOLUTION_NAMES[evolution]}!`,
      priority: 2
    });

    playSound('evolve');
  } catch (error) {
    reportError('showEvolutionNotification', error);
  }
}

// Validate tab before injection
async function validateTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);

    if (!tab) {
      debugLog('Tab not found:', tabId);
      return false;
    }

    if (tab.status !== 'complete') {
      debugLog('Tab not ready:', tabId);
      return false;
    }

    // Don't inject into chrome:// or extension pages
    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://'))) {
      debugLog('Cannot inject into chrome page:', tab.url);
      return false;
    }

    return true;
  } catch (error) {
    if (error.message && error.message.includes('No tab with id')) {
      debugLog('Tab was closed:', tabId);
    } else {
      reportError('validateTab', error);
    }
    return false;
  }
}

// Inject CSS into tab (only once per tab)
async function injectCSS(tabId) {
  if (injectedTabs.has(tabId)) {
    return true; // Already injected
  }

  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content.css']
    });

    injectedTabs.add(tabId);
    debugLog('CSS injected into tab:', tabId);
    return true;
  } catch (error) {
    reportError('injectCSS', error);
    return false;
  }
}

// Clean up closed tabs
chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
  debugLog('Tab removed from tracking:', tabId);
});

// Handle context menu clicks (feeding)
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'feedGomiMon') {
    return;
  }

  try {
    debugLog('Feed action triggered', { tab: tab.id, info });

    // Validate tab
    if (!tab || !tab.id || tab.id < 0) {
      throw new Error('Invalid tab');
    }

    if (!await validateTab(tab.id)) {
      return;
    }

    // Check rate limit
    if (!checkRateLimit()) {
      debugLog('Feed rejected due to rate limit');
      return;
    }

    // Validate input
    const safeInfo = validateContextInfo(info);
    const foodType = determineFoodType(safeInfo);

    debugLog('Food type:', foodType);

    // Get current stats
    const stats = await getStats();

    // Calculate new stats
    const newHunger = Math.min(100, stats.hunger + HUNGER_INCREASE_PER_FEED);
    const newGlitch = Math.min(100, stats.glitch + GLITCH_INCREASE_PER_FEED);
    const newFeedCount = stats.feedCount + 1;

    // Update diet
    const newDiet = { ...stats.diet };
    newDiet[foodType] = (newDiet[foodType] || 0) + 1;

    // Calculate evolution
    const { evolution, justEvolved } = calculateEvolution(
      newFeedCount,
      stats.evolution,
      newDiet,
      stats.eggType
    );

    // Update stats
    await updateStats({
      hunger: newHunger,
      glitch: newGlitch,
      feedCount: newFeedCount,
      diet: newDiet,
      evolution
    });

    debugLog('Stats updated:', {
      hunger: newHunger,
      glitch: newGlitch,
      feeds: newFeedCount,
      evolution
    });

    // Show evolution notification
    if (justEvolved) {
      await showEvolutionNotification(evolution);
    }

    // Clear hungry badge
    updateHungerBadge(newHunger);

    // Inject CSS if needed
    await injectCSS(tab.id);

    // Execute purge script
    await chrome.scripting.executeScript({
      target: {
        tabId: tab.id,
        frameIds: safeInfo.frameId ? [safeInfo.frameId] : undefined
      },
      func: purgeAtCoordinates,
      args: [safeInfo]
    });

    debugLog('Purge script executed');

    // Play sound and animate icon
    playSound('gulp');
    animateIcon();

  } catch (error) {
    reportError('feedGomiMon', error);
  }
});

// Function injected into page to purge element
function purgeAtCoordinates(info) {
  console.log('[GomiMon] Purging at coordinates', info);

  // Find element at click coordinates
  let targetElement = null;

  if (info.x !== undefined && info.y !== undefined) {
    targetElement = document.elementFromPoint(info.x, info.y);
  }

  if (!targetElement) {
    targetElement = document.activeElement;
  }

  if (!targetElement || targetElement === document.body) {
    console.warn('[GomiMon] Could not find target element');
    return;
  }

  // Find parent post container
  function findParentPost(element) {
    if (!element) return null;

    let current = element;
    let maxDepth = 15;
    let depth = 0;

    while (current && depth < maxDepth) {
      // Twitter/X - article elements
      if (current.tagName === 'ARTICLE') {
        return current;
      }

      // Reddit - post containers
      if (current.hasAttribute('data-testid')) {
        const testId = current.getAttribute('data-testid');
        if (testId && (testId.includes('post-container') ||
            testId.includes('post_') ||
            testId === 'post-content')) {
          return current;
        }
      }

      // Reddit - shreddit-post elements
      if (current.tagName === 'SHREDDIT-POST') {
        return current;
      }

      // Facebook - story containers
      if ((current.hasAttribute('data-ad-preview') ||
          current.hasAttribute('data-pagelet')) &&
          current.getAttribute('role') === 'article') {
        return current;
      }

      // Generic post patterns
      const classList = Array.from(current.classList || []);

      if (classList.some(c =>
        c.includes('post') ||
        c.includes('story') ||
        c.includes('feed-item') ||
        c.includes('timeline-item') ||
        c.includes('card')
      )) {
        // Make sure it's substantial
        if (current.offsetHeight > 50) {
          return current;
        }
      }

      // Check for role=article
      if (current.getAttribute('role') === 'article') {
        return current;
      }

      current = current.parentElement;
      depth++;
    }

    // Fallback: find reasonably-sized parent
    current = element;
    depth = 0;
    while (current && depth < 10) {
      if (current.offsetHeight > 100 && current.offsetHeight < window.innerHeight) {
        return current;
      }
      current = current.parentElement;
      depth++;
    }

    return element;
  }

  const postElement = findParentPost(targetElement);

  if (!postElement) {
    console.warn('[GomiMon] Could not find post element');
    return;
  }

  console.log('[GomiMon] Purging element', postElement);

  // Add purge animation class
  postElement.classList.add('gomi-purged');

  // Remove element after animation
  setTimeout(() => {
    try {
      postElement.remove();
      console.log('[GomiMon] Element removed');
    } catch (e) {
      console.error('[GomiMon] Failed to remove element:', e);
    }
  }, 500);
}

// Animate toolbar icon with badge
function animateIcon() {
  try {
    let count = 0;
    const interval = setInterval(() => {
      const badge = count % 2 === 0 ? '◉' : '◎';
      chrome.action.setBadgeText({ text: badge });
      chrome.action.setBadgeBackgroundColor({ color: '#667eea' });

      count++;
      if (count >= 6) {
        clearInterval(interval);
        // Restore hunger badge if needed
        getStats().then(stats => {
          if (stats.hunger < LOW_HUNGER_THRESHOLD) {
            chrome.action.setBadgeText({ text: '!' });
            chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
          } else {
            chrome.action.setBadgeText({ text: '' });
          }
        }).catch(err => reportError('animateIcon-restore', err));
      }
    }, 100);
  } catch (error) {
    reportError('animateIcon', error);
  }
}

// Ensure offscreen document exists
async function ensureOffscreenDocument() {
  // Check if API is available
  if (!chrome.offscreen) {
    debugLog('Offscreen API not available');
    return false;
  }

  // Return existing promise if already creating
  if (offscreenDocumentPromise) {
    return offscreenDocumentPromise;
  }

  try {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    if (existingContexts.length > 0) {
      debugLog('Offscreen document already exists');
      return true;
    }

    debugLog('Creating offscreen document');
    offscreenDocumentPromise = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Playing sound effects for user feedback'
    });

    await offscreenDocumentPromise;
    debugLog('Offscreen document created');

    return true;
  } catch (error) {
    offscreenDocumentPromise = null;
    reportError('ensureOffscreenDocument', error);
    return false;
  }
}

// Close offscreen document after delay
async function closeOffscreenDocument() {
  if (!chrome.offscreen) {
    return;
  }

  try {
    await chrome.offscreen.closeDocument();
    offscreenDocumentPromise = null;
    debugLog('Offscreen document closed');
  } catch (error) {
    // Document might already be closed or never opened
    offscreenDocumentPromise = null;
    debugLog('Offscreen document close failed (might already be closed)');
  }
}

// Play sound effect
async function playSound(soundName) {
  try {
    const created = await ensureOffscreenDocument();

    if (!created) {
      debugLog('Could not create offscreen document for sound');
      return;
    }

    // Send message to play sound
    await chrome.runtime.sendMessage({
      action: 'playSound',
      sound: soundName
    });

    debugLog('Sound played:', soundName);

    // Close document after delay to free resources
    setTimeout(() => {
      closeOffscreenDocument();
    }, ANIMATION_DURATION.OFFSCREEN_CLOSE_DELAY);

  } catch (error) {
    reportError('playSound', error);
  }
}

// Global error handlers
self.addEventListener('error', (event) => {
  reportError('global-error', event.error || new Error(event.message));
});

self.addEventListener('unhandledrejection', (event) => {
  reportError('unhandled-rejection', event.reason || new Error('Unhandled promise rejection'));
});

debugLog('Background service worker initialized');
