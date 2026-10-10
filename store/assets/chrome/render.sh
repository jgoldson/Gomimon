#!/bin/sh
# Renders the Chrome Web Store screenshots from src/*.html at 1280x800.
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for page in src/0*.html; do
  name=$(basename "$page" .html)
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=1280,800 --virtual-time-budget=2000 \
    --screenshot="$PWD/screenshot-$name.png" "file://$PWD/$page" >/dev/null 2>&1
  magick "screenshot-$name.png" -alpha off PNG24:"screenshot-$name.png"
done
