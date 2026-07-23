'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderComposition, encodeWav, floatTo16BitPCM } = require('../index.js');

function makeComposition() {
  return {
    tempo: 120,
    timeSignature: [4, 4],
    bars: 1,
    tracks: [
      {
        waveform: 'sine',
        gain: 0.5,
        notes: [
          { pitch: 60, start: 0, duration: 1, velocity: 100 },
          { pitch: 64, start: 1, duration: 1, velocity: 100 },
        ],
      },
    ],
  };
}

test('renderComposition produces a non-silent buffer of the right length order', () => {
  const { buffer, sampleRate } = renderComposition(makeComposition(), { sampleRate: 8000 });
  assert.equal(sampleRate, 8000);
  assert.ok(buffer.length > 8000 * 2); // at least 2s of the 3s (2 beats + tail) at 120bpm
  const hasSignal = [...buffer].some((v) => Math.abs(v) > 0.01);
  assert.ok(hasSignal);
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
