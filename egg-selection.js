// Egg Selection Logic
import { DEFAULT_STATS, EGG_INFO, debugLog } from './constants.js';

// Handle egg selection
async function selectEgg(eggType) {
  debugLog('Egg selected:', eggType);

  try {
    // Get current stats
    const stats = await chrome.storage.local.get(DEFAULT_STATS);

    // Update stats with chosen egg
    await chrome.storage.local.set({
      ...stats,
      eggType: eggType,
      evolution: eggType, // Start with the chosen egg
      lastUpdate: Date.now()
    });

    debugLog('Egg selection saved, redirecting to popup...');

    // Close this window and open the main popup
    window.close();
  } catch (error) {
    console.error('Failed to save egg selection:', error);
    alert('Failed to save your choice. Please try again.');
  }
}

// Add click handlers to egg options
function setupEventListeners() {
  const eggOptions = document.querySelectorAll('.egg-option');

  eggOptions.forEach(option => {
    // Click handler
    option.addEventListener('click', () => {
      const eggType = option.dataset.egg;
      selectEgg(eggType);
    });

    // Keyboard handler (Enter or Space)
    option.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const eggType = option.dataset.egg;
        selectEgg(eggType);
      }
    });
  });
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  debugLog('Egg selection screen loaded');
  setupEventListeners();
});
