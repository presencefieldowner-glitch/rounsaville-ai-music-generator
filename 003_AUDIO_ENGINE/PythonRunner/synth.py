"""Audio synthesis for the 003_AUDIO_ENGINE layer.

Renders real 16-bit PCM WAV audio using only the Python standard library, so it
runs anywhere the repo does without a numpy/scipy toolchain.
"""

from __future__ import annotations

import math
import struct
import wave
from dataclasses import dataclass
from typing import Callable, Iterable, Optional, Sequence

SAMPLE_RATE = 44_100

_A4_MIDI = 69
_A4_HZ = 440.0
_SEMITONES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


# --- oscillators -----------------------------------------------------------
# Each takes a phase in cycles (not radians) and returns a sample in [-1, 1].

def sine(phase: float) -> float:
    return math.sin(2.0 * math.pi * phase)


def square(phase: float) -> float:
    return 1.0 if (phase % 1.0) < 0.5 else -1.0


def sawtooth(phase: float) -> float:
    return 2.0 * (phase % 1.0) - 1.0


def triangle(phase: float) -> float:
    p = phase % 1.0
    return 4.0 * p - 1.0 if p < 0.5 else 3.0 - 4.0 * p


WAVEFORMS: dict[str, Callable[[float], float]] = {
    "sine": sine,
    "square": square,
    "sawtooth": sawtooth,
    "triangle": triangle,
}


# --- pitch -----------------------------------------------------------------

def note_to_midi(note: str) -> int:
    """Parse scientific pitch notation ("A4", "C#5", "Eb3") to a MIDI number."""
    text = note.strip()
    if not text:
        raise ValueError("empty note name")

    letter = text[0].upper()
    if letter not in _SEMITONES:
        raise ValueError(f"invalid note letter: {note!r}")

    semitone = _SEMITONES[letter]
    i = 1
    while i < len(text) and text[i] in "#b♯♭":
        semitone += 1 if text[i] in "#♯" else -1
        i += 1

    octave_text = text[i:]
    if not octave_text.lstrip("-").isdigit():
        raise ValueError(f"invalid octave in note: {note!r}")

    return (int(octave_text) + 1) * 12 + semitone


def midi_to_freq(midi: float) -> float:
    """Twelve-tone equal temperament, A4 = 440 Hz."""
    return _A4_HZ * 2.0 ** ((midi - _A4_MIDI) / 12.0)


def note_to_freq(note: str) -> float:
    return midi_to_freq(note_to_midi(note))


# --- envelope --------------------------------------------------------------

@dataclass(frozen=True)
class ADSR:
    """Attack/decay/release in seconds; sustain is a level in [0, 1]."""

    attack: float = 0.01
    decay: float = 0.05
    sustain: float = 0.7
    release: float = 0.08

    def envelope(self, total_samples: int, sample_rate: int = SAMPLE_RATE) -> list[float]:
        if total_samples <= 0:
            return []

        attack = int(self.attack * sample_rate)
        decay = int(self.decay * sample_rate)
        release = int(self.release * sample_rate)

        # A note shorter than its own envelope keeps the segment proportions.
        shaped = attack + decay + release
        if shaped > total_samples:
            scale = total_samples / shaped
            attack = int(attack * scale)
            decay = int(decay * scale)
            release = int(release * scale)

        sustain_samples = total_samples - attack - decay - release

        out: list[float] = []
        for i in range(attack):
            out.append((i + 1) / attack)
        for i in range(decay):
            out.append(1.0 + (self.sustain - 1.0) * ((i + 1) / decay))
        out.extend([self.sustain] * sustain_samples)
        for i in range(release):
            out.append(self.sustain * (1.0 - (i + 1) / release))

        # Integer truncation above can leave the envelope a sample or two short.
        out.extend([0.0] * (total_samples - len(out)))
        return out[:total_samples]


# --- rendering -------------------------------------------------------------

@dataclass(frozen=True)
class Note:
    """A pitch held for a duration; ``pitch=None`` is a rest."""

    pitch: Optional[str]
    duration: float
    amplitude: float = 0.8


def _oscillator(waveform: str | Callable[[float], float]) -> Callable[[float], float]:
    if callable(waveform):
        return waveform
    try:
        return WAVEFORMS[waveform]
    except KeyError:
        raise ValueError(
            f"unknown waveform {waveform!r}; expected one of {sorted(WAVEFORMS)}"
        ) from None


def render_note(
    frequency: float,
    duration: float,
    waveform: str | Callable[[float], float] = "sine",
    adsr: Optional[ADSR] = None,
    amplitude: float = 0.8,
    sample_rate: int = SAMPLE_RATE,
) -> list[float]:
    total = int(duration * sample_rate)
    osc = _oscillator(waveform)
    env = adsr.envelope(total, sample_rate) if adsr else [1.0] * total
    return [
        amplitude * env[i] * osc(frequency * i / sample_rate) for i in range(total)
    ]


def render_rest(duration: float, sample_rate: int = SAMPLE_RATE) -> list[float]:
    return [0.0] * int(duration * sample_rate)


def render_sequence(
    notes: Iterable[Note],
    waveform: str | Callable[[float], float] = "sine",
    adsr: Optional[ADSR] = None,
    sample_rate: int = SAMPLE_RATE,
) -> list[float]:
    out: list[float] = []
    for note in notes:
        if note.pitch is None:
            out.extend(render_rest(note.duration, sample_rate))
        else:
            out.extend(
                render_note(
                    note_to_freq(note.pitch),
                    note.duration,
                    waveform,
                    adsr,
                    note.amplitude,
                    sample_rate,
                )
            )
    return out


def render_chord(
    pitches: Sequence[str],
    duration: float,
    waveform: str | Callable[[float], float] = "sine",
    adsr: Optional[ADSR] = None,
    amplitude: float = 0.8,
    sample_rate: int = SAMPLE_RATE,
) -> list[float]:
    voices = [
        render_note(note_to_freq(p), duration, waveform, adsr, amplitude, sample_rate)
        for p in pitches
    ]
    return mix(voices)


# --- mixing / output -------------------------------------------------------

def normalized(samples: Sequence[float], peak: float = 0.95) -> list[float]:
    """Scale down to ``peak`` if the signal would clip; never scale up."""
    loudest = max((abs(s) for s in samples), default=0.0)
    if loudest == 0.0 or loudest <= peak:
        return list(samples)
    gain = peak / loudest
    return [s * gain for s in samples]


def mix(tracks: Iterable[Sequence[float]], normalize: bool = True) -> list[float]:
    """Sum tracks of any lengths, padding to the longest."""
    tracks = [t for t in tracks]
    if not tracks:
        return []

    out = [0.0] * max(len(t) for t in tracks)
    for track in tracks:
        for i, value in enumerate(track):
            out[i] += value
    return normalized(out) if normalize else out


def write_wav(
    path: str,
    samples: Sequence[float],
    sample_rate: int = SAMPLE_RATE,
    channels: int = 1,
) -> str:
    """Write float samples in [-1, 1] as a 16-bit PCM WAV file."""
    frames = bytearray()
    for sample in samples:
        clamped = max(-1.0, min(1.0, sample))
        frames += struct.pack("<h", int(round(clamped * 32767)))

    with wave.open(str(path), "wb") as out:
        out.setnchannels(channels)
        out.setsampwidth(2)
        out.setframerate(sample_rate)
        out.writeframes(bytes(frames))

    return path
