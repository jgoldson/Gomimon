#!/usr/bin/env python3
"""
Generate sound effects for GomiMon
"""
import wave
import struct
import math

def generate_gulp_sound():
    """Generate a 'gulp' sound effect"""
    sample_rate = 44100
    duration = 0.3  # seconds

    samples = []

    # Create a descending tone (like a gulp)
    for i in range(int(sample_rate * duration)):
        t = i / sample_rate

        # Start at 400Hz, descend to 200Hz
        freq = 400 - (200 * (t / duration))

        # Create the tone with envelope
        volume = 32767 * 0.3
        envelope = math.exp(-5 * t)  # Decay envelope

        value = int(volume * envelope * math.sin(2 * math.pi * freq * t))
        samples.append(value)

    # Write to WAV file
    with wave.open('sounds/gulp.wav', 'w') as wav_file:
        wav_file.setnchannels(1)  # Mono
        wav_file.setsampwidth(2)  # 16-bit
        wav_file.setframerate(sample_rate)

        for sample in samples:
            wav_file.writeframes(struct.pack('<h', sample))

    print("✓ Created sounds/gulp.wav")

def generate_evolution_sound():
    """Generate an evolution 'level up' sound"""
    sample_rate = 44100
    duration = 0.5

    samples = []

    # Create an ascending arpeggio
    notes = [261.63, 329.63, 392.00, 523.25]  # C, E, G, C (one octave up)
    note_duration = duration / len(notes)

    for note_freq in notes:
        for i in range(int(sample_rate * note_duration)):
            t = i / sample_rate
            volume = 32767 * 0.2

            # Envelope for each note
            attack = min(1.0, t * 20)
            decay = math.exp(-8 * (t - note_duration * 0.1))
            envelope = attack * decay

            value = int(volume * envelope * math.sin(2 * math.pi * note_freq * t))
            samples.append(value)

    with wave.open('sounds/evolve.wav', 'w') as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)

        for sample in samples:
            wav_file.writeframes(struct.pack('<h', sample))

    print("✓ Created sounds/evolve.wav")

def main():
    try:
        generate_gulp_sound()
        generate_evolution_sound()
        print("\n✓ Sound effects generated successfully!")
    except Exception as e:
        print(f"Error generating sounds: {e}")
        print("Sound effects are optional - the extension will work without them.")

if __name__ == '__main__':
    main()
