'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  FORMAT_PCM,
  FORMAT_IEEE_FLOAT,
  HEADER_BYTES,
  encodeWav,
  decodeWav,
  writeWav,
  readWav,
  durationSeconds,
} = require('./index');

const buffer = (...values) => Float32Array.from(values);

function tempPath(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'audiorenderer-')), name);
}

test('the header identifies a RIFF/WAVE file', () => {
  const wav = encodeWav(buffer(0, 0));
  assert.strictEqual(wav.toString('ascii', 0, 4), 'RIFF');
  assert.strictEqual(wav.toString('ascii', 8, 12), 'WAVE');
  assert.strictEqual(wav.toString('ascii', 12, 16), 'fmt ');
  assert.strictEqual(wav.toString('ascii', 36, 40), 'data');
});

test('the declared RIFF size matches the actual file length', () => {
  const wav = encodeWav(buffer(0, 0, 0, 0));
  assert.strictEqual(wav.readUInt32LE(4), wav.length - 8);
});

test('the data chunk size matches the sample payload', () => {
  const wav = encodeWav(buffer(0, 0, 0));
  assert.strictEqual(wav.readUInt32LE(40), 3 * 2);
  assert.strictEqual(wav.length, HEADER_BYTES + 6);
});

test('byte rate and block align follow from the format', () => {
  const wav = encodeWav(buffer(0), { sampleRate: 48000, channels: 2, bitDepth: 16 });
  assert.strictEqual(wav.readUInt32LE(28), 48000 * 2 * 2);
  assert.strictEqual(wav.readUInt16LE(32), 2 * 2);
  assert.strictEqual(wav.readUInt32LE(24), 48000);
  assert.strictEqual(wav.readUInt16LE(22), 2);
});

test('16-bit writes integer PCM, 32-bit writes IEEE float', () => {
  assert.strictEqual(encodeWav(buffer(0), { bitDepth: 16 }).readUInt16LE(20), FORMAT_PCM);
  assert.strictEqual(encodeWav(buffer(0), { bitDepth: 32 }).readUInt16LE(20), FORMAT_IEEE_FLOAT);
});

test('an unsupported bit depth is rejected', () => {
  assert.throws(() => encodeWav(buffer(0), { bitDepth: 24 }));
});

test('an invalid channel count is rejected', () => {
  assert.throws(() => encodeWav(buffer(0), { channels: 0 }));
});

test('samples survive a 16-bit round trip within quantization error', () => {
  const original = buffer(0, 0.5, -0.5, 0.25, -0.25);
  const decoded = decodeWav(encodeWav(original));

  assert.strictEqual(decoded.sampleRate, 44100);
  assert.strictEqual(decoded.channels, 1);
  assert.strictEqual(decoded.bitDepth, 16);
  assert.strictEqual(decoded.samples.length, original.length);
  for (let i = 0; i < original.length; i++) {
    assert.ok(Math.abs(decoded.samples[i] - original[i]) < 1e-4, `sample ${i}`);
  }
});

test('32-bit float round-trips without quantization loss', () => {
  const original = buffer(0.1234567, -0.7654321);
  const decoded = decodeWav(encodeWav(original, { bitDepth: 32 }));
  for (let i = 0; i < original.length; i++) {
    assert.strictEqual(decoded.samples[i], original[i]);
  }
});

test('out-of-range samples clamp rather than wrapping polarity', () => {
  const decoded = decodeWav(encodeWav(buffer(5, -5)));
  assert.ok(decoded.samples[0] > 0.99);
  assert.ok(decoded.samples[1] < -0.99);
});

test('decoding skips unknown chunks instead of reading them as audio', () => {
  const wav = encodeWav(buffer(0.5, -0.5));
  const header = wav.subarray(0, 36);
  const dataChunk = wav.subarray(36);

  // A LIST chunk with a 3-byte body, which forces a word-alignment pad byte.
  const list = Buffer.alloc(8 + 3 + 1);
  list.write('LIST', 0, 'ascii');
  list.writeUInt32LE(3, 4);

  const withMetadata = Buffer.concat([header, list, dataChunk]);
  withMetadata.writeUInt32LE(withMetadata.length - 8, 4);

  const decoded = decodeWav(withMetadata);
  assert.strictEqual(decoded.samples.length, 2);
  assert.ok(Math.abs(decoded.samples[0] - 0.5) < 1e-4);
  assert.ok(Math.abs(decoded.samples[1] - -0.5) < 1e-4);
});

test('non-RIFF input is rejected', () => {
  assert.throws(() => decodeWav(Buffer.from('not audio at all!!')));
});

test('a RIFF file that is not WAVE is rejected', () => {
  const fake = Buffer.alloc(12);
  fake.write('RIFF', 0, 'ascii');
  fake.write('AVI ', 8, 'ascii');
  assert.throws(() => decodeWav(fake));
});

test('a file missing its data chunk is rejected', () => {
  assert.throws(() => decodeWav(encodeWav(buffer(0)).subarray(0, 36)));
});

test('writeWav and readWav round-trip through the filesystem', () => {
  const target = tempPath('tone.wav');
  writeWav(target, buffer(0.25, -0.25), { sampleRate: 22050 });

  assert.ok(fs.existsSync(target));
  const decoded = readWav(target);
  assert.strictEqual(decoded.sampleRate, 22050);
  assert.ok(Math.abs(decoded.samples[0] - 0.25) < 1e-4);
});

test('the file on disk is byte-identical to the encoded buffer', () => {
  const target = tempPath('exact.wav');
  const samples = buffer(0.1, 0.2, 0.3);
  writeWav(target, samples);
  assert.ok(fs.readFileSync(target).equals(encodeWav(samples)));
});

test('durationSeconds accounts for interleaved channels', () => {
  assert.ok(Math.abs(durationSeconds(new Float32Array(44100), 44100, 1) - 1) < 1e-9);
  assert.ok(Math.abs(durationSeconds(new Float32Array(88200), 44100, 2) - 1) < 1e-9);
});
