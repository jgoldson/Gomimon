#!/usr/bin/env python3
"""Compile ImageGen frames: uv run --with pillow python scripts/build-nimbus-gomi.py."""
from pathlib import Path
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "output/imagegen/nimbus-gomi-production"
DEST = ROOT / "sprites/animated"
sheet = Image.open(ART / "source-sheet.png").convert("RGBA")
assert sheet.width == sheet.height
# One common indexed palette keeps colors stable across GIF frames. Index 0
# is reserved for transparency; no dithering or interpolated edge pixels.
colors = ["000000", "082d38", "124b50", "24676a", "398b83", "59b6a2",
          "83ddbd", "a0edcb", "ddfacd", "ffffff", "f3b3a3", "c77d7d"]
palette = [int(c[i:i+2], 16) for c in colors for i in (0, 2, 4)]
palette += [0] * (768 - len(palette))
palette_image = Image.new("P", (1, 1))
palette_image.putpalette(palette)
cells = []
for row in range(4):
    cells.append([])
    for col in range(4):
        frame = sheet.crop(tuple(round(v * sheet.width / 4) for v in
                                 (col, row, col + 1, row + 1)))
        frame.putalpha(frame.getchannel("A").point(lambda a: 255 if a >= 192 else 0))
        bbox = frame.getbbox()
        assert bbox, (row, col)
        cells[row].append(frame.crop(bbox))

scale = 42 / max(frame.height for row in cells for frame in row)
states = {
    # Use all four adult poses; retain the same grounded canvas as Bubble-Gomi.
    "idle": (0, [0, 1, 2, 3], [650, 250, 650, 150]),
    "eat": (1, [0, 1, 2, 3], [200, 250, 350, 400]),
    "celebrate": (2, [0, 1, 2, 3], [200, 200, 250, 250]),
    "sleep": (3, [0, 1, 2, 3], [650, 650, 650, 650]),
}
contact = Image.new("RGBA", (512, 512))
report = {}
for row_number, (state, (row, order, timings)) in enumerate(states.items()):
    frames = []
    bounds = []
    for col, source_index in enumerate(order):
        source = cells[row][source_index]
        small = source.resize((round(source.width * scale), round(source.height * scale)),
                              Image.Resampling.NEAREST)
        indexed = small.convert("RGB").quantize(palette=palette_image, dither=Image.Dither.NONE)
        indexed = indexed.point(lambda index: max(1, index))
        indexed.paste(0, mask=small.getchannel("A").point(lambda a: 255 - a))
        # Anchor every grounded pose to y=47 in a shared 64px canvas.
        # Only the celebration hop intentionally leaves the ground.
        bottom = 44 if state == "celebrate" and col == 2 else 47
        canvas = Image.new("P", (64, 64), 0)
        canvas.putpalette(palette)
        canvas.paste(indexed, ((64 - small.width) // 2, bottom - small.height))
        canvas.info["transparency"] = 0
        frame = canvas.resize((128, 128), Image.Resampling.NEAREST)
        frame.info["transparency"] = 0
        bounds.append(frame.copy().convert("RGBA").getbbox())
        frames.append(frame)
        contact.paste(frame.copy().convert("RGBA"), (col * 128, row_number * 128))
    target = DEST / f"nimbus-gomi_{state}.gif"
    frames[0].save(target, save_all=True, append_images=frames[1:], duration=timings,
                   loop=0, transparency=0, disposal=2, optimize=False)
    with Image.open(target) as check:
        assert check.size == (128, 128) and check.n_frames == 4
        for i in range(check.n_frames):
            check.seek(i)
            assert check.convert("RGBA").getpixel((0, 0))[3] == 0
    if state == "idle":
        frames[0].save(DEST / "nimbus-gomi_static.gif", transparency=0)
        frames[0].save(ROOT / "website/assets/nimbus-gomi.png", transparency=0)
        (ROOT / "website/assets/nimbus-gomi_idle.gif").write_bytes(target.read_bytes())
    report[state] = {"bounds": bounds, "durations_ms": timings, "canvas": [128, 128]}
contact.save(ART / "aligned-frames.png")
(ART / "frame-report.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
