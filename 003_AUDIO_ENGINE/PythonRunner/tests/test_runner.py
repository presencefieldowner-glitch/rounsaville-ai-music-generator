import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from audio_metrics import (  # noqa: E402
    analyze_wav,
    clipping_ratio,
    peak,
    read_wav_samples,
    rms,
    write_test_wav,
)


def sine_wave(frequency, duration, sample_rate, amplitude=0.5):
    n = int(duration * sample_rate)
    return [amplitude * math.sin(2 * math.pi * frequency * i / sample_rate) for i in range(n)]


class AudioMetricsTest(unittest.TestCase):
    def test_peak_and_rms_on_known_sine(self):
        samples = sine_wave(440, 1.0, 8000, amplitude=0.5)
        self.assertAlmostEqual(peak(samples), 0.5, places=2)
        # RMS of a sine wave is amplitude / sqrt(2)
        self.assertAlmostEqual(rms(samples), 0.5 / math.sqrt(2), places=2)

    def test_clipping_ratio_detects_flat_topped_signal(self):
        samples = [1.0] * 10 + [0.0] * 90
        self.assertAlmostEqual(clipping_ratio(samples, threshold=0.999), 0.1)

    def test_metrics_on_silence_are_zero(self):
        self.assertEqual(peak([]), 0.0)
        self.assertEqual(rms([]), 0.0)
        self.assertEqual(clipping_ratio([]), 0.0)

    def test_round_trip_through_a_real_wav_file(self):
        original = sine_wave(220, 0.25, 44100, amplitude=0.8)
        wav_buffer = write_test_wav(original, sample_rate=44100, n_channels=1)
        decoded, n_channels = read_wav_samples(wav_buffer)

        self.assertEqual(n_channels, 1)
        self.assertEqual(len(decoded), len(original))
        # 16-bit quantization introduces small error; stay within tolerance.
        for a, b in zip(original[:100], decoded[:100]):
            self.assertAlmostEqual(a, b, places=3)

    def test_analyze_wav_reports_a_metrics_dict(self):
        wav_buffer = write_test_wav(sine_wave(440, 0.1, 22050, amplitude=0.9), sample_rate=22050)
        metrics = analyze_wav(wav_buffer)
        self.assertEqual(metrics["channels"], 1)
        self.assertGreater(metrics["sample_count"], 0)
        self.assertAlmostEqual(metrics["peak"], 0.9, places=2)


if __name__ == "__main__":
    unittest.main()
