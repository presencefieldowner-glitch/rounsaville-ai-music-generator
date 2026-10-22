'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderComposition, interleaveStereo, panGains, encodeWav, decodeWav, floatTo16BitPCM } = require('../index.js');

function makeComposition(pan) {
  return {
    tempo: 120,
    timeSignature: [4, 4],
    bars: 1,
    tracks: [
      {
        waveform: 'sine',
        gain: 0.5,
        pan,
        notes: [
          { pitch: 60, start: 0, duration: 1, velocity: 100 },
          { pitch: 64, start: 1, duration: 1, velocity: 100 },
        ],
      },
    ],
  };
}

test('renderComposition produces non-silent left/right buffers of the right length order', () => {
  const { left, right, sampleRate } = renderComposition(makeComposition(0), { sampleRate: 8000 });
  assert.equal(sampleRate, 8000);
  assert.equal(left.length, right.length);
  assert.ok(left.length > 8000 * 2); // at least 2s of the 3s (2 beats + tail) at 120bpm
  assert.ok([...left].some((v) => Math.abs(v) > 0.01));
  assert.ok([...right].some((v) => Math.abs(v) > 0.01));
});

test('panGains: -1 is full left, 0 is equal-power center, +1 is full right', () => {
  const hardLeft = panGains(-1);
  assert.ok(Math.abs(hardLeft.left - 1) < 1e-9);
  assert.ok(Math.abs(hardLeft.right - 0) < 1e-9);

  const center = panGains(0);
  assert.ok(Math.abs(center.left - center.right) < 1e-9);
  assert.ok(Math.abs(center.left - Math.SQRT1_2) < 1e-9); // ~0.707, equal-power center

  const hardRight = panGains(1);
  assert.ok(Math.abs(hardRight.left - 0) < 1e-9);
  assert.ok(Math.abs(hardRight.right - 1) < 1e-9);
});

test('panGains clamps out-of-range pan values', () => {
  assert.deepEqual(panGains(-5), panGains(-1));
  assert.deepEqual(panGains(5), panGains(1));
});

test('renderComposition routes a hard-left-panned track almost entirely to the left channel', () => {
  const { left, right } = renderComposition(makeComposition(-1), { sampleRate: 8000 });
  const peak = (buf) => Math.max(...[...buf].map(Math.abs));
  assert.ok(peak(left) > 0.1);
  assert.ok(peak(right) < 1e-6);
});

test('interleaveStereo produces LRLR... ordering at twice the length', () => {
  const left = new Float32Array([0.1, 0.2, 0.3]);
  const right = new Float32Array([-0.1, -0.2, -0.3]);
  const interleaved = interleaveStereo(left, right);
  assert.equal(interleaved.length, 6);
  const expected = [0.1, -0.1, 0.2, -0.2, 0.3, -0.3];
  interleaved.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-6));
});

test('floatTo16BitPCM maps [-1, 1] to the full Int16 range', () => {
  const pcm = floatTo16BitPCM(new Float32Array([1, -1, 0]));
  assert.equal(pcm[0], 0x7fff);
  assert.equal(pcm[1], -0x8000);
  assert.equal(pcm[2], 0);
});

test('encodeWav writes a valid RIFF/WAVE header', () => {
  const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 0]), 44100, 1);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.toString('ascii', 12, 16), 'fmt ');
  assert.equal(wav.readUInt32LE(24), 44100);
  assert.equal(wav.readUInt16LE(34), 16); // bits per sample
  assert.equal(wav.length, 44 + 4 * 2);
});

test('decodeWav round-trips encodeWav within 16-bit quantization error', () => {
  const original = new Float32Array(200);
  for (let i = 0; i < original.length; i += 1) original[i] = Math.sin((2 * Math.PI * 5 * i) / original.length) * 0.7;

  const wav = encodeWav(original, 22050, 1);
  const decoded = decodeWav(wav);

  assert.equal(decoded.sampleRate, 22050);
  assert.equal(decoded.numChannels, 1);
  assert.equal(decoded.samples.length, original.length);
  for (let i = 0; i < original.length; i += 1) {
    assert.ok(Math.abs(decoded.samples[i] - original[i]) < 0.001);
  }
});

test('decodeWav rejects a non-RIFF buffer', () => {
  assert.throws(() => decodeWav(Buffer.from('not a wav file')));
});

test('decodeWav downmixes stereo to mono', () => {
  const stereo = Buffer.alloc(44 + 4 * 4); // 4 stereo frames, 16-bit
  stereo.write('RIFF', 0, 'ascii');
  stereo.writeUInt32LE(36 + 4 * 4, 4);
  stereo.write('WAVE', 8, 'ascii');
  stereo.write('fmt ', 12, 'ascii');
  stereo.writeUInt32LE(16, 16);
  stereo.writeUInt16LE(1, 20);
  stereo.writeUInt16LE(2, 22); // stereo
  stereo.writeUInt32LE(22050, 24);
  stereo.writeUInt32LE(22050 * 4, 28);
  stereo.writeUInt16LE(4, 32);
  stereo.writeUInt16LE(16, 34);
  stereo.write('data', 36, 'ascii');
  stereo.writeUInt32LE(4 * 4, 40);
  // one frame: left = max, right = 0 -> mono average should be ~0.5
  stereo.writeInt16LE(32767, 44);
  stereo.writeInt16LE(0, 46);

  const decoded = decodeWav(stereo);
  assert.equal(decoded.numChannels, 2);
  assert.equal(decoded.samples.length, 4);
  assert.ok(Math.abs(decoded.samples[0] - 0.5) < 0.01);
});
