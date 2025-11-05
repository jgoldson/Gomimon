// GomiMon Popup Script
// Displays the pet and its stats

// Pet sprites - SVG files
const petSprites = {
  egg: 'sprites/egg.svg',
  baby: 'sprites/baby.svg',
  'typo-ling': 'sprites/typo-ling.svg',
  'muta-pixel': 'sprites/muta-pixel.svg',
  'classic-gomi': 'sprites/classic-gomi.svg',
  'null-sprite': 'sprites/starved.svg',
  crashed: 'sprites/crashed.svg'
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
    petSprite.innerHTML = `<img src="${petSprites.crashed}" alt="Crashed" />`;
    rebootButton.style.display = 'block';
    infoText.textContent = '⚠️ SYSTEM ERROR: GomiMon has crashed!';
    petName.textContent = 'ERROR.exe';
  }
  // Check for starved state
  else if (stats.hunger === 0) {
    petContainer.classList.remove('crashed');
    petSprite.innerHTML = `<img src="${petSprites['null-sprite']}" alt="Starved" />`;
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

    // Evolution is now handled in background.js, just display current state
    petSprite.innerHTML = `<img src="${petSprites[evolution] || petSprites.baby}" alt="${evolution}" />`;

    // Update pet name based on evolution
    const evolutionNames = {
      egg: 'Egg',
      baby: 'Baby-Gomi',
      'typo-ling': 'Typo-ling',
      'muta-pixel': 'Muta-Pixel',
      'classic-gomi': 'Classic-Gomi'
    };
    petName.textContent = evolutionNames[evolution] || 'GomiMon';

    // Update info text with diet breakdown
    const diet = stats.diet || { text: 0, image: 0, post: 0 };

    if (stats.hunger < 30) {
      infoText.innerHTML = '😰 Getting hungry! Find some AI slop!';
    } else if (stats.glitch > 80) {
      infoText.innerHTML = '⚠️ High glitch level! Slow down!';
    } else {
      infoText.innerHTML = `
        <div>Total Feeds: ${stats.feedCount}</div>
        <div style="font-size: 10px; margin-top: 3px; opacity: 0.8;">
          📝 ${diet.text} | 🖼️ ${diet.image} | 📄 ${diet.post}
        </div>
      `;
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
