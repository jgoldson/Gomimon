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

    await chrome.storage.local.set({
      hunger: newHunger,
      glitch: newGlitch,
      feedCount: newFeedCount,
      diet: newDiet,
      lastUpdate: Date.now()
    });

    console.log(`Fed GomiMon ${foodType}! Hunger: ${newHunger}, Glitch: ${newGlitch}, Total feeds: ${newFeedCount}`);

    // Clear hungry badge
    if (newHunger >= 30) {
      chrome.action.setBadgeText({ text: '' });
    }

    // Inject the purge script into the active tab
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });

      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['content.css']
      });

      console.log('Purge script injected');
    } catch (error) {
      console.error('Failed to inject purge script:', error);
    }

    // TODO: Play gulp sound effect
    // TODO: Animate toolbar icon
  }
});
