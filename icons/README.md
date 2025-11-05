# GomiMon Icons

This directory contains the extension icons. You need PNG files in the following sizes:
- icon16.png (16x16)
- icon48.png (48x48)
- icon128.png (128x128)

## Creating Icons

### Option 1: Use an online converter
1. Use the icon.svg file provided
2. Convert it to PNG at https://cloudconvert.com/svg-to-png
3. Create versions at 16px, 48px, and 128px

### Option 2: Use ImageMagick (if installed)
```bash
# Install ImageMagick (Ubuntu/Debian)
sudo apt-get install imagemagick

# Convert SVG to PNG
convert icon.svg -resize 16x16 icon16.png
convert icon.svg -resize 48x48 icon48.png
convert icon.svg -resize 128x128 icon128.png
```

### Option 3: Use a design tool
- Open icon.svg in Figma, Inkscape, or Adobe Illustrator
- Export as PNG at the required sizes

## Temporary Workaround

For development, you can use any PNG files with these names. The extension will work without proper icons, but Chrome may show warnings.
