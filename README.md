# GomiMon 👾

A virtual pet browser extension that "eats" AI-generated "slop" from your social media feeds!

## Current Status: Milestone 1 Complete ✓

The core pet functionality is now implemented! You can:
- ✓ Install the extension
- ✓ See your GomiMon pet with Hunger and Glitch meters
- ✓ Feed it by right-clicking on posts
- ✓ Watch posts disappear with a glitch animation
- ✓ See the pet evolve based on its diet
- ✓ Watch hunger deplete over time (every 15 minutes)

## Installation

### Chrome/Edge/Brave

1. Open your browser and go to extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`

2. Enable "Developer mode" (toggle in top right)

3. Click "Load unpacked"

4. Select the `Gomimon` folder

5. The GomiMon icon should appear in your toolbar!

## How to Use

1. **Meet Your Pet**: Click the GomiMon icon in your toolbar to see your pet

2. **Find Some Slop**: Browse social media (Twitter/X, Reddit, Facebook)

3. **Feed Your Pet**: When you see AI-generated content or low-quality posts:
   - Right-click anywhere on the post
   - Select "Feed to GomiMon 👾"
   - Watch the post glitch out and disappear!

4. **Monitor Stats**:
   - **Hunger**: Depletes over time (1 point every 15 minutes)
   - **Glitch-O-Meter**: Increases when fed (too much causes crash!)

5. **Avoid Crashes**: If Glitch hits 100, your pet crashes! Click "REBOOT" to revive it

6. **Watch It Grow**:
   - Feed it 10 times: Egg → Baby-Gomi
   - Feed it 50 times: Evolves based on diet
     - Text-heavy diet → Typo-ling 📝
     - Image-heavy diet → Muta-Pixel 🎨
     - Balanced diet → Classic-Gomi 🗑️

## Project Structure

```
Gomimon/
├── manifest.json          # Extension configuration
├── background.js          # Service worker (handles timers, storage, feeding)
├── popup.html            # Pet UI
├── popup.js              # Pet display logic
├── content.js            # Purge animation script
├── content.css           # Purge animation styles
├── icons/                # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── generate_icons.py     # Icon generation script
└── GomiMon GDD.txt       # Original game design document
```

## Development

### Testing

1. After making changes, go to `chrome://extensions`
2. Click the refresh icon on the GomiMon extension
3. Test your changes

### Debugging

- **Background Script**: Right-click extension icon → "Inspect service worker"
- **Popup**: Right-click popup → "Inspect"
- **Content Script**: Open DevTools on any webpage (F12)

### Next Steps (Milestone 2)

- [ ] Improve post detection for different websites
- [ ] Add sound effects (gulp sound)
- [ ] Add toolbar icon animation
- [ ] Better evolution sprites (replace emoji with pixel art)
- [ ] Fine-tune hunger/glitch balance

## Supported Sites

Currently works on:
- Twitter/X
- Reddit
- Facebook
- Any website (generic post detection)

## Known Issues

- Icons are placeholders (minimal PNGs) - create better icons with `pip install Pillow && python3 generate_icons.py`
- Post detection is basic - may not work perfectly on all sites
- No sound effects yet
- Evolution sprites are emoji placeholders

## Contributing

This is a work in progress! Feel free to:
- Improve post detection for specific sites
- Create better pixel art sprites
- Add sound effects
- Suggest new features

## License

MIT License - Have fun!

---

**Note**: This extension modifies your social media feed by hiding posts you choose to "feed" to your pet. This is a local modification and doesn't affect other users.
