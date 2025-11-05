#!/usr/bin/env python3
"""
Generate placeholder PNG icons for the GomiMon extension
"""

try:
    from PIL import Image, ImageDraw, ImageFont
    has_pil = True
except ImportError:
    has_pil = False
    print("PIL not available. Creating minimal placeholder files...")

def create_icon_with_pil(size):
    """Create an icon using PIL"""
    # Create a gradient background
    img = Image.new('RGB', (size, size), color='#764ba2')
    draw = ImageDraw.Draw(img)

    # Draw a circle in the center
    margin = size // 4
    draw.ellipse([margin, margin, size - margin, size - margin],
                 fill='#667eea', outline='white', width=max(1, size // 32))

    # Try to add emoji or text
    try:
        font_size = size // 2
        # Note: This may not work without proper emoji font
        draw.text((size // 2, size // 2), "👾", fill='white', anchor='mm')
    except:
        # Fallback: draw a simple shape
        center = size // 2
        draw.rectangle([center - size // 6, center - size // 8,
                       center + size // 6, center + size // 8],
                      fill='white')

    return img

def create_minimal_icon(size):
    """Create a minimal valid PNG without PIL"""
    # This creates a minimal 1x1 red PNG
    # It's a valid PNG but very basic - just for development
    png_data = (
        b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01'
        b'\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf'
        b'\xc0\x00\x00\x00\x03\x00\x01\x00\x00\x00\x00IEND\xaeB`\x82'
    )
    return png_data

def main():
    sizes = [16, 48, 128]

    for size in sizes:
        filename = f'icons/icon{size}.png'

        if has_pil:
            try:
                img = create_icon_with_pil(size)
                img.save(filename, 'PNG')
                print(f"✓ Created {filename} with PIL")
            except Exception as e:
                print(f"✗ Error creating {filename}: {e}")
        else:
            # Create minimal placeholder
            with open(filename, 'wb') as f:
                f.write(create_minimal_icon(size))
            print(f"✓ Created minimal {filename} (replace with proper icon later)")

    print("\nIcons created! For better icons:")
    print("1. Install PIL: pip install Pillow")
    print("2. Run this script again")
    print("3. Or create custom icons using a design tool")

if __name__ == '__main__':
    main()
