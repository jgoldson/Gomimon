// GomiMon Background Service Worker
// Handles pet state, timers, and feeding logic

// Initialize the extension on install
chrome.runtime.onInstalled.addListener(async () => {
  console.log('GomiMon installed!');

  // Set default pet stats
  const defaultStats = {
    hunger: 100,
    glitch: 0,
    level: 1,
    evolution: 'egg',
    feedCount: 0,
    diet: {
      text: 0,
      image: 0,
      post: 0
    },
    lastUpdate: Date.now()
  };

  await chrome.storage.local.set(defaultStats);

  // Create the context menu item
  chrome.contextMenus.create({
    id: 'feedGomiMon',
    title: 'Feed to GomiMon 👾',
    contexts: ['all']
  });

  // Create the hunger timer alarm (every 15 minutes)
  chrome.alarms.create('hungerTick', {
    periodInMinutes: 15
  });

  console.log('GomiMon initialized with stats:', defaultStats);
});

// Handle the hunger timer
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'hungerTick') {
    const stats = await chrome.storage.local.get();

    // Decrease hunger by 1
    let newHunger = Math.max(0, stats.hunger - 1);

    // Update stats
    await chrome.storage.local.set({
      hunger: newHunger,
      lastUpdate: Date.now()
    });

    console.log('Hunger tick - New hunger level:', newHunger);

    // Update badge if hungry
    if (newHunger < 30) {
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }

    // If starved, could trigger notification here
    if (newHunger === 0) {
      console.log('GomiMon is starving!');
    }
  }
});

// Handle context menu clicks (feeding)
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'feedGomiMon') {
    const stats = await chrome.storage.local.get();

    // Determine food type based on what was clicked
    let foodType = 'post';
    if (info.srcUrl) {
      foodType = 'image';
    } else if (info.selectionText) {
      foodType = 'text';
    }

    // Update stats
    const hungerIncrease = 20;
    const glitchIncrease = 5;

    const newHunger = Math.min(100, stats.hunger + hungerIncrease);
    const newGlitch = Math.min(100, stats.glitch + glitchIncrease);
    const newFeedCount = stats.feedCount + 1;

    // Update diet tracking
    const newDiet = { ...stats.diet };
    newDiet[foodType] = (newDiet[foodType] || 0) + 1;

    // Check for evolution
    let evolution = stats.evolution || 'egg';
    let justEvolved = false;

    if (newFeedCount === 10 && evolution === 'egg') {
      evolution = 'baby';
      justEvolved = true;
    } else if (newFeedCount === 50 && evolution === 'baby') {
      const total = newDiet.text + newDiet.image + newDiet.post;
      if (newDiet.text / total > 0.5) {
        evolution = 'typo-ling';
      } else if (newDiet.image / total > 0.5) {
        evolution = 'muta-pixel';
      } else {
        evolution = 'classic-gomi';
      }
      justEvolved = true;
    }

    await chrome.storage.local.set({
      hunger: newHunger,
      glitch: newGlitch,
      feedCount: newFeedCount,
      diet: newDiet,
      evolution: evolution,
      lastUpdate: Date.now()
    });

    console.log(`Fed GomiMon ${foodType}! Hunger: ${newHunger}, Glitch: ${newGlitch}, Total feeds: ${newFeedCount}`);

    // Show evolution notification
    if (justEvolved) {
      const evolutionNames = {
        baby: 'Baby-Gomi',
        'typo-ling': 'Typo-ling',
        'muta-pixel': 'Muta-Pixel',
        'classic-gomi': 'Classic-Gomi'
      };
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: '🎉 GomiMon Evolved!',
        message: `Your GomiMon evolved into ${evolutionNames[evolution]}!`
      });
      playSound('evolve');
    }

    // Clear hungry badge
    if (newHunger >= 30) {
      chrome.action.setBadgeText({ text: '' });
    }

    // Inject CSS first (if not already injected)
    try {
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['content.css']
      });
    } catch (error) {
      // CSS might already be injected, that's okay
    }

    // Inject the purge script with click coordinates
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: info.frameId ? [info.frameId] : undefined },
        func: purgeAtCoordinates,
        args: [{ x: info.x, y: info.y, srcUrl: info.srcUrl, selectionText: info.selectionText }]
      });

      console.log('Purge script executed');

      // Play gulp sound effect
      playSound('gulp');

      // Animate toolbar icon
      animateIcon();

    } catch (error) {
      console.error('Failed to inject purge script:', error);
    }
  }
});

// Function to be injected into the page
function purgeAtCoordinates(info) {
  console.log('GomiMon: Purging at coordinates', info);

  // Find element at click coordinates
  let targetElement = null;

  if (info.x !== undefined && info.y !== undefined) {
    targetElement = document.elementFromPoint(info.x, info.y);
  }

  if (!targetElement) {
    // Fallback: find the most recently interacted element
    targetElement = document.activeElement;
  }

  if (!targetElement || targetElement === document.body) {
    console.warn('GomiMon: Could not find target element');
    return;
  }

  // Find the parent post container
  function findParentPost(element) {
    if (!element) return null;

    let current = element;
    let maxDepth = 15;
    let depth = 0;

    while (current && depth < maxDepth) {
      // Twitter/X - article elements or main post divs
      if (current.tagName === 'ARTICLE') {
        return current;
      }

      // Reddit - post containers
      if (current.hasAttribute('data-testid')) {
        const testId = current.getAttribute('data-testid');
        if (testId.includes('post-container') ||
            testId.includes('post_') ||
            testId === 'post-content') {
          return current;
        }
      }

      // Reddit - shreddit-post elements
      if (current.tagName === 'SHREDDIT-POST') {
        return current;
      }

      // Facebook - story containers
      if (current.hasAttribute('data-ad-preview') ||
          current.hasAttribute('data-pagelet')) {
        if (current.getAttribute('role') === 'article') {
          return current;
        }
      }

      // Generic post patterns
      const classList = Array.from(current.classList || []);
      const classString = classList.join(' ');

      if (classList.some(c =>
        c.includes('post') ||
        c.includes('story') ||
        c.includes('feed-item') ||
        c.includes('timeline-item') ||
        c.includes('card')
      )) {
        // Make sure it's substantial enough
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

    // If we can't find a post, use a reasonable sized parent
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
    console.warn('GomiMon: Could not find post element');
    return;
  }

  console.log('GomiMon: Purging element', postElement);

  // Add purge animation class
  postElement.classList.add('gomi-purged');

  // Remove element after animation
  setTimeout(() => {
    postElement.remove();
    console.log('GomiMon: Element removed');
  }, 500);
}

// Animate the toolbar icon
function animateIcon() {
  let count = 0;
  const interval = setInterval(() => {
    const offset = count % 2 === 0 ? [0, -2] : [0, 2];
    chrome.action.setIcon({
      path: {
        16: 'icons/icon16.png',
        48: 'icons/icon48.png',
        128: 'icons/icon128.png'
      }
    });
    count++;
    if (count >= 6) {
      clearInterval(interval);
    }
  }, 50);
}

// Play sound effect using offscreen document
async function playSound(soundName) {
  try {
    // Create offscreen document if it doesn't exist
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    if (existingContexts.length === 0) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Playing sound effects for user feedback'
      });
    }

    // Send message to play sound
    setTimeout(() => {
      chrome.runtime.sendMessage({
        action: 'playSound',
        sound: soundName
      }).catch(err => console.log('Sound playback error:', err));
    }, 100);
  } catch (error) {
    console.log('Sound not available:', error);
  }
}
