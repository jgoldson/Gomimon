#!/usr/bin/env python3
"""
GomiMon Sprite Sheet Extractor
Extracts frames from sprite sheets and creates animated GIFs for the pet
"""

from PIL import Image
import os
import glob

# Configuration
SPRITE_SOURCE = "sprites/freeSlimePack/PNG"
OUTPUT_DIR = "sprites/animated"
FRAME_SIZE = 32  # Each frame is 32x32 pixels in the sprite sheet
ROWS = 4
COLS = 6
TOTAL_FRAMES = 24

# Animation mapping
# Map slime animations to GomiMon evolution stages
SPRITE_MAPPING = {
    # Egg stage - use Slime1 Idle (slow, gentle)
    'egg': {
        'slime': 'Slime1',
        'animation': 'Idle',
        'duration': 150,  # ms per frame
        'scale': 3  # Make it 96x96
    },

    # Baby stage - use Slime1 Walk
    'baby': {
        'slime': 'Slime1',
        'animation': 'Walk',
        'duration': 100,
        'scale': 3
    },

    # Typo-ling (text-heavy) - use Slime2 (different color)
    'typo-ling': {
        'slime': 'Slime2',
        'animation': 'Run',
        'duration': 80,
        'scale': 3
    },

    # Muta-pixel (image-heavy) - use Slime3
    'muta-pixel': {
        'slime': 'Slime3',
        'animation': 'Run',
        'duration': 80,
        'scale': 3
    },

    # Classic-gomi (balanced) - use Slime1 Run
    'classic-gomi': {
        'slime': 'Slime1',
        'animation': 'Run',
        'duration': 80,
        'scale': 3
    },

    # Starved state - use Death animation
    'starved': {
        'slime': 'Slime1',
        'animation': 'Death',
        'duration': 150,
        'scale': 3
    },

    # Crashed state - use Hurt animation
    'crashed': {
        'slime': 'Slime1',
        'animation': 'Hurt',
        'duration': 100,
        'scale': 3
    }
}

def extract_frames_from_sheet(sheet_path, frame_size=32, rows=4, cols=6):
    """Extract individual frames from a sprite sheet"""
    print(f"  Loading sheet: {os.path.basename(sheet_path)}")

    sheet = Image.open(sheet_path)
    frames = []

    for row in range(rows):
        for col in range(cols):
            # Calculate frame position
            left = col * frame_size
            top = row * frame_size
            right = left + frame_size
            bottom = top + frame_size

            # Extract frame
            frame = sheet.crop((left, top, right, bottom))

            # Check if frame is not empty (has non-transparent pixels)
            if frame.mode == 'RGBA':
                bbox = frame.getbbox()
                if bbox:  # Frame has content
                    frames.append(frame)

    print(f"  Extracted {len(frames)} frames")
    return frames

def scale_frame(frame, scale_factor):
    """Scale frame using nearest neighbor for pixel art"""
    new_size = (frame.width * scale_factor, frame.height * scale_factor)
    return frame.resize(new_size, Image.NEAREST)

def create_animated_gif(frames, output_path, duration=100, scale=3):
    """Create an animated GIF from frames"""
    if not frames:
        print(f"  Warning: No frames to create GIF")
        return

    # Scale all frames
    scaled_frames = [scale_frame(frame, scale) for frame in frames]

    # Save as animated GIF
    scaled_frames[0].save(
        output_path,
        save_all=True,
        append_images=scaled_frames[1:],
        duration=duration,
        loop=0,
        disposal=2,  # Clear previous frame
        optimize=False  # Keep quality high
    )

    print(f"  Created: {output_path} ({len(frames)} frames, {duration}ms)")

def main():
    """Main extraction process"""
    print("GomiMon Sprite Sheet Extractor")
    print("=" * 50)

    # Create output directory
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Process each evolution stage
    for evolution, config in SPRITE_MAPPING.items():
        print(f"\nProcessing: {evolution}")
        print(f"  Slime: {config['slime']}, Animation: {config['animation']}")

        # Find the sprite sheet
        pattern = f"{SPRITE_SOURCE}/{config['slime']}/{config['animation']}/*_full.png"
        sheet_files = glob.glob(pattern)

        if not sheet_files:
            print(f"  ERROR: Could not find sprite sheet at {pattern}")
            continue

        sheet_path = sheet_files[0]

        # Extract frames
        frames = extract_frames_from_sheet(sheet_path, FRAME_SIZE, ROWS, COLS)

        if frames:
            # Create animated GIF
            output_path = os.path.join(OUTPUT_DIR, f"{evolution}.gif")
            create_animated_gif(
                frames,
                output_path,
                duration=config['duration'],
                scale=config['scale']
            )
        else:
            print(f"  ERROR: No frames extracted for {evolution}")

    print("\n" + "=" * 50)
    print("✓ Sprite extraction complete!")
    print(f"✓ Animated GIFs saved to: {OUTPUT_DIR}/")
    print("\nNext steps:")
    print("1. Check the generated GIFs in the sprites/animated/ folder")
    print("2. Run the extension and feed your GomiMon to see the new sprites!")

if __name__ == "__main__":
    main()
