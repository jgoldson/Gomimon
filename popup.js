// GomiMon Popup Script
// Displays the pet and its stats

// Pet sprites for different evolutions
const petSprites = {
  egg: '🥚',
  baby: '👾',
  'typo-ling': '📝',
  'muta-pixel': '🎨',
  'classic-gomi': '🗑️',
  'null-sprite': '💀',
  crashed: '❌'
};

// Update the UI with current stats
async function updateUI() {
  const stats = await chrome.storage.local.get();

  const hungerBar = document.getElementById('hungerBar');
  const hungerValue = document.getElementById('hungerValue');
  const glitchBar = document.getElementById('glitchBar');
  const glitchValue = document.getElementById('glitchValue');
  const petSprite = document.getElementById('petSprite');
  const petContainer = document.getElementById('petContainer');
  const rebootButton = document.getElementById('rebootButton');
  const infoText = document.getElementById('infoText');
  const petName = document.getElementById('petName');

  // Update hunger bar
  hungerBar.style.width = `${stats.hunger}%`;
  hungerValue.textContent = stats.hunger;

  // Update glitch bar
  glitchBar.style.width = `${stats.glitch}%`;
  glitchValue.textContent = stats.glitch;

  // Check for crashed state
  if (stats.glitch >= 100) {
    petContainer.classList.add('crashed');
    petSprite.textContent = petSprites.crashed;
    rebootButton.style.display = 'block';
    infoText.textContent = '⚠️ SYSTEM ERROR: GomiMon has crashed!';
    petName.textContent = 'ERROR.exe';
  }
  // Check for starved state
  else if (stats.hunger === 0) {
    petContainer.classList.remove('crashed');
    petSprite.textContent = petSprites['null-sprite'];
    rebootButton.style.display = 'none';
    infoText.textContent = '💀 Your GomiMon is starving! Feed it some slop!';
    petName.textContent = 'Null-Sprite';
  }
  // Normal state
  else {
    petContainer.classList.remove('crashed');
    rebootButton.style.display = 'none';

    // Determine evolution
    let evolution = stats.evolution || 'egg';

    // Check if ready to evolve from egg
    if (stats.feedCount >= 10 && evolution === 'egg') {
      evolution = 'baby';
      await chrome.storage.local.set({ evolution: 'baby' });
    }

    // Check for further evolution at 50 feeds
    if (stats.feedCount >= 50 && evolution === 'baby') {
      const diet = stats.diet || { text: 0, image: 0, post: 0 };
      const total = diet.text + diet.image + diet.post;

      if (diet.text / total > 0.5) {
        evolution = 'typo-ling';
      } else if (diet.image / total > 0.5) {
        evolution = 'muta-pixel';
      } else {
        evolution = 'classic-gomi';
      }

      await chrome.storage.local.set({ evolution });
    }

    petSprite.textContent = petSprites[evolution] || petSprites.baby;

    // Update pet name based on evolution
    const evolutionNames = {
      egg: 'Egg',
      baby: 'Baby-Gomi',
      'typo-ling': 'Typo-ling',
      'muta-pixel': 'Muta-Pixel',
      'classic-gomi': 'Classic-Gomi'
    };
    petName.textContent = evolutionNames[evolution] || 'GomiMon';

    // Update info text
    if (stats.hunger < 30) {
      infoText.textContent = '😰 Getting hungry! Find some AI slop!';
    } else if (stats.glitch > 80) {
      infoText.textContent = '⚠️ High glitch level! Slow down!';
    } else {
      infoText.textContent = `Feeds: ${stats.feedCount} | Level: ${stats.level}`;
    }
  }
}

// Handle reboot button click
document.getElementById('rebootButton').addEventListener('click', async () => {
  await chrome.storage.local.set({
    glitch: 0,
    lastUpdate: Date.now()
  });

  updateUI();
});

// Initialize UI when popup opens
document.addEventListener('DOMContentLoaded', updateUI);

// Update UI every second while popup is open
setInterval(updateUI, 1000);
