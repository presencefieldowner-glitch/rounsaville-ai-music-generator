"""Command-line front end for the synth engine.

Renders a tone, a chord, or a note sequence to a WAV file, and can hand that
file to the system audio player so it comes out of whatever output device is
currently selected (built-in speaker, headphones, a paired Bluetooth speaker).

Examples:
    python render.py tone --pitch A4 --duration 2 --out a440.wav
    python render.py chord --pitches C4 E4 G4 --out cmajor.wav --play
    python render.py sequence --notes C4:0.4 E4:0.4 G4:0.4 C5:0.8 --waveform triangle
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys

from synth import (
    ADSR,
    SAMPLE_RATE,
    Note,
    render_chord,
    render_note,
    render_sequence,
    note_to_freq,
    write_wav,
)

# Ordered by preference; the first one present on PATH wins.
PLAYERS = [
    ("paplay", []),
    ("aplay", ["-q"]),
    ("afplay", []),
    ("ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet"]),
]


def parse_note(token: str) -> Note:
    """Parse ``PITCH:DURATION`` — e.g. ``C4:0.5``, or ``r:0.25`` for a rest."""
    pitch, _, duration = token.partition(":")
    if not duration:
        raise argparse.ArgumentTypeError(
            f"expected PITCH:DURATION (e.g. C4:0.5), got {token!r}"
        )
    try:
        seconds = float(duration)
    except ValueError:
        raise argparse.ArgumentTypeError(f"bad duration in {token!r}") from None

    if pitch.lower() in ("r", "rest", ""):
        return Note(None, seconds)
    return Note(pitch, seconds)


def play(path: str) -> bool:
    """Play ``path`` on the system's current audio output. False if impossible."""
    for command, flags in PLAYERS:
        binary = shutil.which(command)
        if binary:
            subprocess.run([binary, *flags, path], check=False)
            return True
    return False


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default="out.wav", help="output WAV path")
    parser.add_argument(
        "--waveform",
        default="sine",
        choices=["sine", "square", "sawtooth", "triangle"],
    )
    parser.add_argument("--amplitude", type=float, default=0.8)
    parser.add_argument("--sample-rate", type=int, default=SAMPLE_RATE)
    parser.add_argument(
        "--play", action="store_true", help="play the file after rendering"
    )

    sub = parser.add_subparsers(dest="command", required=True)

    tone = sub.add_parser("tone", help="render a single pitch")
    tone.add_argument("--pitch", default="A4", help='note name, e.g. "A4"')
    tone.add_argument("--duration", type=float, default=1.0)

    chord = sub.add_parser("chord", help="render simultaneous pitches")
    chord.add_argument("--pitches", nargs="+", default=["C4", "E4", "G4"])
    chord.add_argument("--duration", type=float, default=2.0)

    sequence = sub.add_parser("sequence", help="render notes one after another")
    sequence.add_argument("--notes", nargs="+", type=parse_note, required=True)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    adsr = ADSR()

    if args.command == "tone":
        samples = render_note(
            note_to_freq(args.pitch),
            args.duration,
            args.waveform,
            adsr,
            args.amplitude,
            args.sample_rate,
        )
    elif args.command == "chord":
        samples = render_chord(
            args.pitches,
            args.duration,
            args.waveform,
            adsr,
            args.amplitude,
            args.sample_rate,
        )
    else:
        samples = render_sequence(args.notes, args.waveform, adsr, args.sample_rate)

    write_wav(args.out, samples, args.sample_rate)
    seconds = len(samples) / args.sample_rate
    print(f"wrote {args.out} ({seconds:.2f}s, {len(samples)} samples @ {args.sample_rate} Hz)")

    if args.play and not play(args.out):
        print(
            "no audio player found (looked for: "
            + ", ".join(name for name, _ in PLAYERS)
            + ") — the WAV file is still on disk",
            file=sys.stderr,
        )
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
