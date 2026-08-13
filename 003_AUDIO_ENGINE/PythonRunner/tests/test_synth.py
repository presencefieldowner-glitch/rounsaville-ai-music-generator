import math
import os
import sys
import tempfile
import unittest
import wave

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from synth import (  # noqa: E402
    ADSR,
    SAMPLE_RATE,
    Note,
    mix,
    midi_to_freq,
    normalized,
    note_to_freq,
    note_to_midi,
    render_chord,
    render_note,
    render_rest,
    render_sequence,
    sawtooth,
    sine,
    square,
    triangle,
    write_wav,
)


def measured_frequency(samples, sample_rate=SAMPLE_RATE):
    """Estimate frequency by counting zero crossings over the signal."""
    crossings = sum(
        1
        for i in range(1, len(samples))
        if (samples[i - 1] < 0) != (samples[i] < 0)
    )
    duration = len(samples) / sample_rate
    return crossings / (2 * duration)


class PitchTest(unittest.TestCase):
    def test_reference_pitch(self):
        self.assertAlmostEqual(note_to_freq("A4"), 440.0, places=6)

    def test_middle_c(self):
        self.assertEqual(note_to_midi("C4"), 60)
        self.assertAlmostEqual(note_to_freq("C4"), 261.6255653, places=5)

    def test_octave_doubles_frequency(self):
        self.assertAlmostEqual(note_to_freq("A5"), 2 * note_to_freq("A4"), places=6)
        self.assertAlmostEqual(note_to_freq("A3"), note_to_freq("A4") / 2, places=6)

    def test_accidentals_are_enharmonic(self):
        self.assertEqual(note_to_midi("A#4"), note_to_midi("Bb4"))
        self.assertAlmostEqual(note_to_freq("A#4"), 466.1637615, places=5)

    def test_semitone_ratio(self):
        ratio = note_to_freq("C#4") / note_to_freq("C4")
        self.assertAlmostEqual(ratio, 2 ** (1 / 12), places=9)

    def test_midi_roundtrip(self):
        for name, midi in [("C-1", 0), ("C4", 60), ("A4", 69), ("G9", 127)]:
            self.assertEqual(note_to_midi(name), midi)
        self.assertAlmostEqual(midi_to_freq(69), 440.0, places=6)

    def test_rejects_garbage(self):
        for bad in ["", "H4", "C", "Cx4"]:
            with self.assertRaises(ValueError):
                note_to_midi(bad)


class OscillatorTest(unittest.TestCase):
    def test_all_waveforms_stay_in_range(self):
        for osc in (sine, square, sawtooth, triangle):
            for step in range(500):
                value = osc(step / 97.0)
                self.assertGreaterEqual(value, -1.0, msg=osc.__name__)
                self.assertLessEqual(value, 1.0, msg=osc.__name__)

    def test_waveforms_are_periodic(self):
        for osc in (sine, square, sawtooth, triangle):
            for phase in (0.1, 0.37, 0.62, 0.94):
                self.assertAlmostEqual(osc(phase), osc(phase + 3.0), places=9)

    def test_triangle_shape(self):
        self.assertAlmostEqual(triangle(0.0), -1.0, places=9)
        self.assertAlmostEqual(triangle(0.25), 0.0, places=9)
        self.assertAlmostEqual(triangle(0.5), 1.0, places=9)
        self.assertAlmostEqual(triangle(0.75), 0.0, places=9)


class RenderTest(unittest.TestCase):
    def test_sample_count_matches_duration(self):
        samples = render_note(440.0, 0.5)
        self.assertEqual(len(samples), int(0.5 * SAMPLE_RATE))

    def test_rendered_pitch_is_accurate(self):
        for pitch in ("A4", "C4", "E5"):
            samples = render_note(note_to_freq(pitch), 1.0, "sine")
            self.assertAlmostEqual(
                measured_frequency(samples), note_to_freq(pitch), delta=1.0
            )

    def test_amplitude_is_respected(self):
        samples = render_note(440.0, 0.2, "sine", amplitude=0.5)
        self.assertLessEqual(max(abs(s) for s in samples), 0.5 + 1e-9)
        self.assertGreater(max(abs(s) for s in samples), 0.49)

    def test_rest_is_silent(self):
        self.assertEqual(set(render_rest(0.1)), {0.0})

    def test_sequence_length_is_sum_of_notes(self):
        notes = [Note("C4", 0.2), Note(None, 0.1), Note("G4", 0.3)]
        samples = render_sequence(notes)
        expected = sum(int(n.duration * SAMPLE_RATE) for n in notes)
        self.assertEqual(len(samples), expected)

    def test_chord_does_not_clip(self):
        samples = render_chord(["C4", "E4", "G4"], 0.3)
        self.assertLessEqual(max(abs(s) for s in samples), 1.0)


class EnvelopeTest(unittest.TestCase):
    def test_envelope_length(self):
        env = ADSR().envelope(1000)
        self.assertEqual(len(env), 1000)

    def test_envelope_peaks_then_returns_to_silence(self):
        adsr = ADSR(attack=0.1, decay=0.1, sustain=0.5, release=0.1)
        env = adsr.envelope(SAMPLE_RATE)
        peak_index = int(0.1 * SAMPLE_RATE) - 1
        self.assertAlmostEqual(env[peak_index], 1.0, places=3)
        self.assertAlmostEqual(env[-1], 0.0, places=6)
        self.assertAlmostEqual(env[SAMPLE_RATE // 2], 0.5, places=6)

    def test_envelope_never_exceeds_unity(self):
        env = ADSR().envelope(5000)
        self.assertLessEqual(max(env), 1.0)
        self.assertGreaterEqual(min(env), 0.0)

    def test_short_note_still_fits_envelope(self):
        adsr = ADSR(attack=0.5, decay=0.5, sustain=0.5, release=0.5)
        env = adsr.envelope(100)
        self.assertEqual(len(env), 100)
        self.assertLessEqual(max(env), 1.0)

    def test_zero_length(self):
        self.assertEqual(ADSR().envelope(0), [])


class MixTest(unittest.TestCase):
    def test_mix_pads_to_longest_track(self):
        self.assertEqual(len(mix([[0.1] * 10, [0.1] * 25])), 25)

    def test_mix_sums_signals(self):
        self.assertAlmostEqual(mix([[0.2], [0.3]], normalize=False)[0], 0.5, places=9)

    def test_mix_normalizes_away_clipping(self):
        mixed = mix([[0.9] * 10, [0.9] * 10])
        self.assertLessEqual(max(abs(s) for s in mixed), 0.95 + 1e-9)

    def test_normalize_does_not_amplify_quiet_signals(self):
        quiet = [0.1, -0.1, 0.05]
        self.assertEqual(normalized(quiet), quiet)

    def test_mix_of_nothing(self):
        self.assertEqual(mix([]), [])
        self.assertEqual(normalized([]), [])


class WavFileTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "test.wav")

    def test_wav_header_and_frame_count(self):
        samples = render_note(440.0, 0.25, "sine", ADSR())
        write_wav(self.path, samples)

        with wave.open(self.path, "rb") as handle:
            self.assertEqual(handle.getnchannels(), 1)
            self.assertEqual(handle.getsampwidth(), 2)
            self.assertEqual(handle.getframerate(), SAMPLE_RATE)
            self.assertEqual(handle.getnframes(), len(samples))

    def test_audio_survives_the_roundtrip(self):
        """Read the file back and confirm the tone is still 440 Hz."""
        write_wav(self.path, render_note(440.0, 1.0, "sine"))

        with wave.open(self.path, "rb") as handle:
            raw = handle.readframes(handle.getnframes())

        decoded = [
            int.from_bytes(raw[i : i + 2], "little", signed=True) / 32767.0
            for i in range(0, len(raw), 2)
        ]
        self.assertAlmostEqual(measured_frequency(decoded), 440.0, delta=1.0)

    def test_out_of_range_samples_are_clamped_not_wrapped(self):
        write_wav(self.path, [5.0, -5.0])

        with wave.open(self.path, "rb") as handle:
            raw = handle.readframes(2)

        first = int.from_bytes(raw[0:2], "little", signed=True)
        second = int.from_bytes(raw[2:4], "little", signed=True)
        self.assertEqual(first, 32767)
        self.assertEqual(second, -32767)


if __name__ == "__main__":
    unittest.main()
