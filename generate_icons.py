#!/usr/bin/env python3
"""Resize the ImageGen master into extension and Chrome Web Store icons.

Requires ImageMagick (`brew install imagemagick`).
"""
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'icons' / 'gomimon-master.png'


def main():
    magick = shutil.which('magick')
    if not magick:
        raise SystemExit('Install ImageMagick first: brew install imagemagick')
    if not SOURCE.is_file():
        raise SystemExit(f'Missing icon master: {SOURCE}')
    for size in (16, 32, 48, 128):
        target = ROOT / 'icons' / f'icon{size}.png'
        subprocess.run([
            magick, str(SOURCE), '-filter', 'Lanczos', '-resize', f'{size}x{size}',
            '-strip', str(target),
        ], check=True)
        print(f'Created {target.relative_to(ROOT)}')
    store_icon = ROOT / 'store' / 'assets' / 'icon-128.png'
    store_icon.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / 'icons' / 'icon128.png', store_icon)


if __name__ == '__main__':
    main()
