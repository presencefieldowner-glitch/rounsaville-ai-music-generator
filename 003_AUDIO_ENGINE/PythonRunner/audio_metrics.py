"""Lightweight WAV/PCM audio analysis used to sanity-check rendered mixes.

Uses only the Python standard library (wave + struct) so this runs in any
CI sandbox without extra installs.
"""
import struct
import wave
from io import BytesIO


def read_wav_samples(source):
    """Read a 16-bit PCM WAV (path or file-like object) into floats in [-1, 1]."""
    wav_file = wave.open(source, "rb")
    try:
        n_channels = wav_file.getnchannels()
        sample_width = wav_file.getsampwidth()
        n_frames = wav_file.getnframes()
        raw = wav_file.readframes(n_frames)
    finally:
        wav_file.close()

    if sample_width != 2:
        raise ValueError(f"only 16-bit PCM WAV is supported, got {sample_width * 8}-bit")

    count = len(raw) // 2
    ints = struct.unpack(f"<{count}h", raw)
    samples = [s / 32768.0 for s in ints]
    return samples, n_channels


def peak(samples):
    if not samples:
        return 0.0
    return max(abs(s) for s in samples)


def rms(samples):
    if not samples:
        return 0.0
    return (sum(s * s for s in samples) / len(samples)) ** 0.5


def clipping_ratio(samples, threshold=0.999):
    if not samples:
        return 0.0
    clipped = sum(1 for s in samples if abs(s) >= threshold)
    return clipped / len(samples)


def analyze_wav(source):
    samples, n_channels = read_wav_samples(source)
    return {
        "channels": n_channels,
        "sample_count": len(samples),
        "peak": peak(samples),
        "rms": rms(samples),
        "clipping_ratio": clipping_ratio(samples),
    }


def write_test_wav(samples, sample_rate=44100, n_channels=1):
    """Helper for tests: encode float samples in [-1, 1] to an in-memory WAV."""
    buf = BytesIO()
    wav_file = wave.open(buf, "wb")
    try:
        wav_file.setnchannels(n_channels)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        ints = [max(-32768, min(32767, int(s * 32767))) for s in samples]
        wav_file.writeframes(struct.pack(f"<{len(ints)}h", *ints))
    finally:
        wav_file.close()
    buf.seek(0)
    return buf
