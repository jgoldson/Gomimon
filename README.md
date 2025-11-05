# GomiMon 👾

A virtual pet browser extension that "eats" AI-generated "slop" from your social media feeds!

## 🎉 Status: COMPLETE - All Milestones Implemented!

GomiMon is now **fully functional** with all planned features:

### ✅ Core Features (Milestones 1 & 2)
- ✓ Virtual pet system with hunger and glitch mechanics
- ✓ Right-click context menu feeding
- ✓ Advanced glitch-out animation for removed posts
- ✓ Smart post detection for Twitter/X, Reddit, Facebook
- ✓ Automatic hunger depletion timer (every 15 minutes)
- ✓ Badge notifications when hungry

### ✅ Polish & Effects (Milestone 3)
- ✓ Beautiful SVG pixel art sprites for all evolution stages
- ✓ Sound effects (gulp on feed, chime on evolution)
- ✓ Toolbar icon wiggle animation
- ✓ Crash state with Blue Screen of Death effect
- ✓ Starved state with pixelated Null-Sprite
- ✓ Reboot button with animations

### ✅ Evolution System (Milestone 4)
- ✓ Three-stage evolution system (Egg → Baby → Final form)
- ✓ Diet-based evolution paths (Text/Image/Balanced)
- ✓ Evolution notifications with sound
- ✓ Four unique final evolutions:
  - **Typo-ling** (text-heavy diet) 📝
  - **Muta-Pixel** (image-heavy diet) 🎨
  - **Classic-Gomi** (balanced diet) 🗑️
  - **Null-Sprite** (neglect) 💀
- ✓ Diet tracking and statistics display

## 🎮 Quick Start

1. **Install**: Load unpacked extension in Chrome
2. **Browse**: Visit Twitter, Reddit, or Facebook
3. **Feed**: Right-click on AI slop → "Feed to GomiMon 👾"
4. **Evolve**: Feed 10 times to hatch, 50 times for final form!

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

## 📊 Features Overview

### The Pet System
- **Hunger Meter**: Depletes 1 point every 15 minutes
- **Glitch-O-Meter**: Increases 5 points per feed (crash at 100!)
- **Evolution Stages**: Egg (0-9) → Baby (10-49) → Final Form (50+)
- **Diet Tracking**: Text, Image, and Post statistics

### The Feeding Loop
1. Spot AI-generated content on social media
2. Right-click and select "Feed to GomiMon 👾"
3. Watch the post glitch out and disappear
4. Hear satisfying sound effect
5. See toolbar icon wiggle
6. Check pet's updated stats

### Evolution Paths

Your final evolution depends on what you feed:

- **50%+ Text** → 📝 **Typo-ling**: Made of glitched typography
- **50%+ Images** → 🎨 **Muta-Pixel**: Surreal AI-art creature
- **Balanced Mix** → 🗑️ **Classic-Gomi**: Friendly trash monster
- **Neglect** → 💀 **Null-Sprite**: Sad pixelated ghost

### Risk vs Reward

- **Feed too little**: Pet starves (Hunger = 0) → Null-Sprite state
- **Feed too much**: Pet crashes (Glitch = 100) → Must reboot
- **Sweet spot**: Feed in small bursts, manage both meters

## 📁 Complete File Structure

```
Gomimon/
├── manifest.json          # Extension config with all permissions
├── background.js          # Service worker (timers, storage, logic)
├── popup.html            # Pet UI with animations
├── popup.js              # Pet display and stats
├── content.js            # Legacy - now inline in background
├── content.css           # Glitch animation styles
├── offscreen.html        # Audio playback document
├── offscreen.js          # Sound effect player
├── sprites/              # SVG pixel art
│   ├── egg.svg
│   ├── baby.svg
│   ├── typo-ling.svg
│   ├── muta-pixel.svg
│   ├── classic-gomi.svg
│   ├── starved.svg
│   └── crashed.svg
├── sounds/               # Generated sound effects
│   ├── gulp.wav
│   └── evolve.wav
├── icons/                # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── generate_icons.py     # Icon generator
├── generate_sounds.py    # Sound generator
├── GomiMon GDD.txt       # Original design document
├── README.md             # This file
└── USER_GUIDE.md         # Comprehensive user guide
```

## 🎨 Visual Features

- **Pixel Art Sprites**: Hand-crafted SVG sprites for each evolution
- **Glitch Animation**: Multi-stage CSS animation with color shifts
- **BSOD Effect**: Blue screen crash state with authentic glitch
- **Smooth Transitions**: All stat changes animate smoothly
- **Hover Effects**: Interactive sprite scaling
- **Badge Notifications**: "!" appears when pet is hungry

## 🔊 Audio Features

- **Gulp Sound**: Descending tone when feeding (0.3s)
- **Evolution Sound**: Ascending arpeggio on evolution (0.5s)
- **Offscreen Audio**: Proper Manifest V3 audio handling
- **Respect User Preferences**: Works with system audio settings

## 🌐 Supported Websites

Currently optimized for:
- **Twitter/X**: `<article>` detection
- **Reddit**: `shreddit-post` and data-testid detection
- **Facebook**: Story and article role detection
- **Generic**: Works on any site with fallback detection

## 🔧 Advanced Features

### Smart Post Detection
The extension intelligently finds the parent post container by:
1. Using click coordinates
2. Traversing DOM tree
3. Checking for platform-specific markers
4. Validating element size
5. Falling back gracefully

### Stats Persistence
- All stats saved in `chrome.storage.local`
- Survives browser restarts
- No data sent to servers
- Completely private

### Performance
- Minimal CPU usage
- Timers only run when needed
- CSS animations hardware-accelerated
- Sound effects cached

## 📖 Documentation

- **[USER_GUIDE.md](USER_GUIDE.md)**: Complete user guide with strategies
- **GomiMon GDD.txt**: Original game design document
- **This README**: Technical overview and quick start

## Development

### Testing

1. After making changes, go to `chrome://extensions`
2. Click the refresh icon on the GomiMon extension
3. Test your changes

### Debugging

- **Background Script**: Right-click extension icon → "Inspect service worker"
- **Popup**: Right-click popup → "Inspect"
- **Content Script**: Open DevTools on any webpage (F12)

### Regenerating Assets

```bash
# Regenerate icons (requires Pillow)
pip install Pillow
python3 generate_icons.py

# Regenerate sounds
python3 generate_sounds.py
```

## 🐛 Known Limitations

- Icons are placeholder PNGs (improve with `pip install Pillow`)
- Post detection may not work perfectly on all sites
- Some sites aggressively restore removed elements
- Evolution is one-way (no reset without reinstall)

## 🚀 Future Enhancements

Potential additions for v0.2:
- [ ] Cloud backup for stats
- [ ] Achievement system
- [ ] More evolution paths
- [ ] Customizable timers
- [ ] Export stats/screenshots
- [ ] Multiple pets
- [ ] Pet trading/sharing
- [ ] More sound effects
- [ ] Accessibility improvements

## 🤝 Contributing

We welcome contributions! Areas where you can help:
- Better sprite artwork
- Additional platform support
- Evolution path ideas
- Sound effect improvements
- Bug fixes
- Documentation improvements

## 📝 Version History

- **v0.1.0** (Current) - Initial release with all core features
  - All 4 milestones complete
  - Full evolution system
  - Sound effects
  - Pixel art sprites
  - Comprehensive documentation

## ⚖️ License

MIT License - Have fun and clean your feeds!

## 🎯 Credits

- Concept inspired by Tamagotchi virtual pets
- Built with Chrome Extension Manifest V3
- Created to combat AI content overload
- Pixel art sprites by GomiMon project
- Sound effects generated procedurally

---

**Ready to start? Install GomiMon and start feeding your pet today!** 👾

For detailed instructions, see **[USER_GUIDE.md](USER_GUIDE.md)**

**Note**: This extension modifies your local view of web pages only. It doesn't affect other users or send any data externally.
