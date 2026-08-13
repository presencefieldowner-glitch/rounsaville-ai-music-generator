'use strict';

/**
 * AudioRenderer — file encoding for the audio engine layer.
 *
 * Turns Float32Array sample buffers into RIFF/WAVE files and back. This is the
 * stage that makes a signal leave the process: a written WAV is what a player
 * hands to a sound card, so this module is the boundary between "numbers in
 * memory" and audible output.
 *
 * Supports 16-bit integer PCM (the standard delivery format, and what
 * PythonRunner/synth.py writes) and 32-bit IEEE float (lossless, for passing
 * audio between stages without accumulating quantization error).
 */

const fs = require('node:fs');

const FORMAT_PCM = 1;
const FORMAT_IEEE_FLOAT = 3;
const HEADER_BYTES = 44;

function bytesPerSampleFor(bitDepth) {
  if (bitDepth === 16) return 2;
  if (bitDepth === 32) return 4;
  throw new Error(`unsupported bit depth ${bitDepth}; expected 16 or 32`);
}

/** Encode samples in [-1, 1] as a complete WAV file in a Buffer. */
function encodeWav(samples, options = {}) {
  const { sampleRate = 44100, channels = 1, bitDepth = 16 } = options;

  if (!Number.isInteger(channels) || channels < 1) {
    throw new Error(`invalid channel count: ${channels}`);
  }

  const bytesPerSample = bytesPerSampleFor(bitDepth);
  const format = bitDepth === 32 ? FORMAT_IEEE_FLOAT : FORMAT_PCM;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(HEADER_BYTES + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');

  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // fmt chunk size for a non-extensible header
  buffer.writeUInt16LE(format, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28); // byte rate
  buffer.writeUInt16LE(channels * bytesPerSample, 32); // block align
  buffer.writeUInt16LE(bitDepth, 34);

  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    const offset = HEADER_BYTES + i * bytesPerSample;
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    if (bitDepth === 16) {
      buffer.writeInt16LE(Math.round(clamped * 32767), offset);
    } else {
      buffer.writeFloatLE(clamped, offset);
    }
  }

  return buffer;
}

/**
 * Parse a WAV file back into samples.
 *
 * Walks the chunk list rather than assuming a 44-byte header, because real
 * files often carry LIST/fact chunks before the data and a fixed offset would
 * silently read metadata as audio.
 */
function decodeWav(buffer) {
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('not a RIFF file');
  }
  if (buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a WAVE file');
  }

  let format = null;
  let channels = null;
  let sampleRate = null;
  let bitDepth = null;
  let data = null;

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (id === 'fmt ') {
      format = buffer.readUInt16LE(body);
      channels = buffer.readUInt16LE(body + 2);
      sampleRate = buffer.readUInt32LE(body + 4);
      bitDepth = buffer.readUInt16LE(body + 14);
    } else if (id === 'data') {
      data = buffer.subarray(body, Math.min(body + size, buffer.length));
    }

    // Chunks are word-aligned: an odd size is followed by a pad byte.
    offset = body + size + (size % 2);
  }

  if (format === null) throw new Error('missing fmt chunk');
  if (data === null) throw new Error('missing data chunk');

  const bytesPerSample = bytesPerSampleFor(bitDepth);
  const count = Math.floor(data.length / bytesPerSample);
  const samples = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    samples[i] =
      bitDepth === 16
        ? data.readInt16LE(i * bytesPerSample) / 32767
        : data.readFloatLE(i * bytesPerSample);
  }

  return { sampleRate, channels, bitDepth, format, samples };
}

function writeWav(path, samples, options = {}) {
  fs.writeFileSync(path, encodeWav(samples, options));
  return path;
}

function readWav(path) {
  return decodeWav(fs.readFileSync(path));
}

/** Playing time of a buffer, accounting for interleaved channels. */
function durationSeconds(samples, sampleRate = 44100, channels = 1) {
  return samples.length / (sampleRate * channels);
}

module.exports = {
  FORMAT_PCM,
  FORMAT_IEEE_FLOAT,
  HEADER_BYTES,
  encodeWav,
  decodeWav,
  writeWav,
  readWav,
  durationSeconds,
};
