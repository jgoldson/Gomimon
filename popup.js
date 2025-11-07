// GomiMon Popup Script (Refactored)
// Displays the pet and its stats with proper error handling

import {
  LOW_HUNGER_THRESHOLD,
  HIGH_GLITCH_THRESHOLD,
  GLITCH_CRASH_THRESHOLD,
  EVOLUTION_NAMES,
  PET_SPRITES,
  DEFAULT_STATS,
  sanitizeStats,
  getPetSprite
} from './constants.js';

// Cached stats to prevent unnecessary updates
let cachedStats = null;

// Cached DOM elements
const elements = {};

// Cache DOM elements on load
function cacheElements() {
  elements.hungerBar = document.getElementById('hungerBar');
  elements.hungerValue = document.getElementById('hungerValue');
  elements.glitchBar = document.getElementById('glitchBar');
  elements.glitchValue = document.getElementById('glitchValue');
  elements.petSprite = document.getElementById('petSprite');
  elements.petContainer = document.getElementById('petContainer');
  elements.rebootButton = document.getElementById('rebootButton');
  elements.infoText = document.getElementById('infoText');
  elements.petName = document.getElementById('petName');
  elements.playSlopScholarButton = document.getElementById('playSlopScholarButton');
  elements.playSlopSwapButton = document.getElementById('playSlopSwapButton');
}

// Update the UI with current stats
async function updateUI() {
  try {
    // Get stats with defaults
    const rawStats = await chrome.storage.local.get(DEFAULT_STATS);
    const stats = sanitizeStats(rawStats);

    // Check if stats changed (avoid unnecessary DOM updates)
    const statsString = JSON.stringify(stats);
    if (statsString === cachedStats) {
      return; // No changes
    }
    cachedStats = statsString;

    // Update hunger bar
    elements.hungerBar.style.width = `${stats.hunger}%`;
    elements.hungerBar.setAttribute('aria-valuenow', stats.hunger);
    elements.hungerValue.textContent = stats.hunger;

    // Update glitch bar
    elements.glitchBar.style.width = `${stats.glitch}%`;
    elements.glitchBar.setAttribute('aria-valuenow', stats.glitch);
    elements.glitchValue.textContent = stats.glitch;

    // Check for crashed state
    if (stats.glitch >= GLITCH_CRASH_THRESHOLD) {
      elements.petContainer.classList.add('crashed');
      const evolution = stats.evolution || 'egg';
      const spriteUrl = getPetSprite(evolution, 'crashed');
      elements.petSprite.innerHTML = `<img src="${spriteUrl}" alt="Crashed pet" />`;
      elements.rebootButton.style.display = 'block';
      elements.infoText.textContent = '⚠️ SYSTEM ERROR: GomiMon has crashed!';
      elements.petName.textContent = 'ERROR.exe';
      // Disable minigame buttons when crashed
      elements.playSlopScholarButton.disabled = true;
      elements.playSlopScholarButton.title = 'Reboot your pet first!';
      elements.playSlopSwapButton.disabled = true;
      elements.playSlopSwapButton.title = 'Reboot your pet first!';
    }
    // Check for starved state
    else if (stats.hunger === 0) {
      elements.petContainer.classList.remove('crashed');
      const evolution = stats.evolution || 'egg';
      const spriteUrl = getPetSprite(evolution, 'starved');
      elements.petSprite.innerHTML = `<img src="${spriteUrl}" alt="Starved pet" />`;
      elements.rebootButton.style.display = 'none';
      elements.infoText.textContent = '💀 Your GomiMon is starving! Feed it some slop!';
      elements.petName.textContent = 'Null-Sprite';
      // Disable minigame buttons when starved
      elements.playSlopScholarButton.disabled = true;
      elements.playSlopScholarButton.title = 'Feed your pet first!';
      elements.playSlopSwapButton.disabled = true;
      elements.playSlopSwapButton.title = 'Feed your pet first!';
    }
    // Normal state
    else {
      elements.petContainer.classList.remove('crashed');
      elements.rebootButton.style.display = 'none';

      // Enable minigame buttons in normal state
      elements.playSlopScholarButton.disabled = false;
      elements.playSlopScholarButton.title = 'Play a trivia game with your pet!';
      elements.playSlopSwapButton.disabled = false;
      elements.playSlopSwapButton.title = 'Play a match-3 puzzle game!';

      // Determine evolution
      const evolution = stats.evolution || 'egg';

      // Update sprite (with fallback) - use idle animation
      const spriteUrl = getPetSprite(evolution, 'idle');
      const spriteName = EVOLUTION_NAMES[evolution] || 'GomiMon';
      elements.petSprite.innerHTML = `<img src="${spriteUrl}" alt="${spriteName}" />`;

      // Update pet name
      elements.petName.textContent = spriteName;

      // Update info text with diet breakdown
      const diet = stats.diet || { text: 0, image: 0, post: 0 };

      if (stats.hunger < LOW_HUNGER_THRESHOLD) {
        elements.infoText.innerHTML = '😰 Getting hungry! Find some AI slop!';
      } else if (stats.glitch > HIGH_GLITCH_THRESHOLD) {
        elements.infoText.innerHTML = '⚠️ High glitch level! Slow down!';
      } else {
        // Use textContent for diet numbers to prevent XSS
        elements.infoText.innerHTML = `
          <div>Total Feeds: <span class="feed-count">${stats.feedCount || 0}</span></div>
          <div class="diet-breakdown">
            📝 <span class="diet-value">${diet.text || 0}</span> |
            🖼️ <span class="diet-value">${diet.image || 0}</span> |
            📄 <span class="diet-value">${diet.post || 0}</span>
          </div>
        `;
      }
    }
  } catch (error) {
    console.error('[GomiMon Popup] Error updating UI:', error);

    // Show error state
    if (elements.infoText) {
      elements.infoText.textContent = 'Error loading pet data';
    }
  }
}

// Handle reboot button click
async function handleReboot() {
  try {
    // Get current stats
    const stats = await chrome.storage.local.get(DEFAULT_STATS);

    // Reset glitch to 0
    await chrome.storage.local.set({
      ...stats,
      glitch: 0,
      lastUpdate: Date.now()
    });

    // Force cache invalidation
    cachedStats = null;

    // Update UI immediately
    await updateUI();
  } catch (error) {
    console.error('[GomiMon Popup] Error rebooting:', error);
  }
}

// Handle Slop Scholar button click
function handlePlaySlopScholar() {
  try {
    // Send message to background script to launch the game
    chrome.runtime.sendMessage({
      type: 'LAUNCH_MINIGAME',
      game: 'scholar'
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[GomiMon Popup] Error launching game:', chrome.runtime.lastError);
      } else {
        console.log('[GomiMon Popup] Game launched:', response);
      }
    });
  } catch (error) {
    console.error('[GomiMon Popup] Error launching Slop Scholar:', error);
  }
}

// Handle Slop Swap button click
function handlePlaySlopSwap() {
  try {
    // Send message to background script to launch the game
    chrome.runtime.sendMessage({
      type: 'LAUNCH_MINIGAME',
      game: 'swap'
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[GomiMon Popup] Error launching game:', chrome.runtime.lastError);
      } else {
        console.log('[GomiMon Popup] Game launched:', response);
      }
    });
  } catch (error) {
    console.error('[GomiMon Popup] Error launching Slop Swap:', error);
  }
}

// Initialize popup
function initialize() {
  try {
    // Cache DOM elements
    cacheElements();

    // Set up reboot button listener
    elements.rebootButton.addEventListener('click', handleReboot);

    // Set up minigame button listeners
    elements.playSlopScholarButton.addEventListener('click', handlePlaySlopScholar);
    elements.playSlopSwapButton.addEventListener('click', handlePlaySlopSwap);

    // Initial update
    updateUI();

    // Listen for storage changes instead of polling
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'local') {
        // Force cache invalidation when storage changes
        cachedStats = null;
        updateUI();
      }
    });

    // Fallback: Update every 5 seconds (less aggressive than before)
    setInterval(() => {
      // Only update if popup is visible
      if (document.visibilityState === 'visible') {
        updateUI();
      }
    }, 5000);

  } catch (error) {
    console.error('[GomiMon Popup] Initialization error:', error);
  }
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
