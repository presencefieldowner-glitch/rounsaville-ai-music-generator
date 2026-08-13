# PythonRunner — audio synthesis and rendering

The Python audio DSP half of `003_AUDIO_ENGINE`. Unlike the JS/TS stubs in the
sibling folders, this module is real: it synthesizes waveforms, applies
envelopes, mixes voices, and writes valid 16-bit PCM WAV files.

**No third-party dependencies.** Everything uses the standard library (`math`,
`wave`, `struct`), so it runs wherever the repo runs — no numpy/scipy toolchain
and no build step.

## What's here

| File | Purpose |
| --- | --- |
| `synth.py` | Oscillators, pitch/MIDI conversion, ADSR envelopes, mixing, WAV output |
| `render.py` | CLI that renders tones, chords, and note sequences to a WAV file |
| `tests/test_synth.py` | 29 tests covering pitch accuracy, envelope shape, mixing, and file format |
| `tests/test_runner.py` | Pre-existing smoke test |

## Library

```python
from synth import ADSR, Note, note_to_freq, render_note, render_sequence, write_wav

# A two-second A440 with a plucked envelope.
samples = render_note(note_to_freq("A4"), 2.0, "triangle", ADSR(attack=0.005, decay=0.3, sustain=0.2))
write_wav("a440.wav", samples)

# A melody.
melody = [Note("C4", 0.4), Note("E4", 0.4), Note(None, 0.2), Note("G4", 0.8)]
write_wav("melody.wav", render_sequence(melody, "sine", ADSR()))
```

Waveforms: `sine`, `square`, `sawtooth`, `triangle` — or pass any
`Callable[[float], float]` that takes a phase in cycles and returns a sample in
`[-1, 1]`.

Pitch uses scientific notation (`C4`, `A#5`, `Eb3`) in twelve-tone equal
temperament with A4 = 440 Hz. `mix()` sums voices and scales the result down if
it would clip; it never amplifies a quiet signal.

## CLI

```bash
python render.py tone --pitch A4 --duration 2 --out a440.wav
python render.py chord --pitches C4 E4 G4 --waveform triangle --out cmajor.wav
python render.py sequence --notes C4:0.3 D4:0.3 E4:0.3 r:0.15 C5:0.6 --out scale.wav
```

Add `--play` to hand the rendered file to the system audio player. It looks for
`paplay`, `aplay`, `afplay`, then `ffplay`, and plays through whatever output
device the OS currently has selected — built-in speaker, headphones, or a
paired Bluetooth speaker. If none of those players is installed (as in a
headless CI container), it says so and leaves the WAV on disk; the file is the
deliverable and playback is a convenience.

## Tests

```bash
python3 -m unittest discover tests
```

These assert measurable signal properties rather than smoke-testing imports:
rendered tones are frequency-checked by counting zero crossings (A440 must
measure 440 Hz ± 1 Hz, both in memory and after a WAV write/read round trip),
envelopes must peak at exactly 1.0 and return to silence, chords must not clip,
and out-of-range samples must clamp rather than wrap around to the opposite
polarity.

`build-all.sh` discovers this suite automatically via its
`PYTHON AUDIO DSP TEST SUITE` stage — no registration step needed.
