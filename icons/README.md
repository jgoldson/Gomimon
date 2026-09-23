# GomiMon icons

`gomimon-master.png` is the master created with the built-in ImageGen tool using
Bubble-Gomi as a character reference. See `generation-prompt.md` for the prompt.

Run `python3 generate_icons.py` with ImageMagick installed to generate the 16, 32,
48, and 128 pixel extension icons and `store/assets/icon-128.png`.
The manifest uses these PNGs for the toolbar and extension listing; notifications
use the 128 pixel icon. `icon.svg` is retained as the legacy monogram design.
