'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fft, ifft, nextPowerOfTwo, hannWindow, timeStretch, resampleLinear, pitchShift } = require('../index.js');
const { estimateFramePitch } = require('../../VoiceProfiler');

function sineWave(frequency, seconds, sampleRate, amplitude = 0.6) {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  return out;
}

test('fft rejects a non-power-of-2 length', () => {
  assert.throws(() => fft(new Float64Array(6), new Float64Array(6)));
});

test('fft + ifft round-trips a random signal', () => {
  const n = 64;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const original = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    re[i] = Math.sin(i) * 0.5; // deterministic "random-ish" signal
    original[i] = re[i];
  }
  fft(re, im);
  ifft(re, im);
  for (let i = 0; i < n; i += 1) {
    assert.ok(Math.abs(re[i] - original[i]) < 1e-9, `bin ${i}: ${re[i]} vs ${original[i]}`);
    assert.ok(Math.abs(im[i]) < 1e-9);
  }
});

test('fft concentrates a pure sine tone at the corresponding bin', () => {
  const n = 64;
  const cyclesOverWindow = 5; // bin index the energy should land on
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i += 1) re[i] = Math.sin((2 * Math.PI * cyclesOverWindow * i) / n);
  fft(re, im);

  const magnitudes = re.map((v, i) => Math.hypot(v, im[i]));
  let peakBin = 0;
  for (let i = 1; i < n / 2; i += 1) if (magnitudes[i] > magnitudes[peakBin]) peakBin = i;
  assert.equal(peakBin, cyclesOverWindow);
});

test('nextPowerOfTwo rounds up correctly', () => {
  assert.equal(nextPowerOfTwo(1), 1);
  assert.equal(nextPowerOfTwo(5), 8);
  assert.equal(nextPowerOfTwo(1024), 1024);
  assert.equal(nextPowerOfTwo(1025), 2048);
});

test('hannWindow tapers to (near) zero at the edges and peaks near 1 at the center', () => {
  const w = hannWindow(256);
  assert.ok(w[0] < 0.01);
  assert.ok(w[w.length - 1] < 0.01);
  assert.ok(w[128] > 0.99);
});

test('timeStretch by 2x roughly doubles the output length', () => {
  const input = sineWave(220, 1.0, 8000);
  const output = timeStretch(input, 8000, 2, { frameSize: 512, hopSize: 128 });
  const ratio = output.length / input.length;
  assert.ok(Math.abs(ratio - 2) < 0.1, `expected ~2x length, got ratio ${ratio}`);
});

test('timeStretch by 0.5x roughly halves the output length', () => {
  const input = sineWave(220, 1.0, 8000);
  const output = timeStretch(input, 8000, 0.5, { frameSize: 512, hopSize: 128 });
  const ratio = output.length / input.length;
  assert.ok(Math.abs(ratio - 0.5) < 0.1, `expected ~0.5x length, got ratio ${ratio}`);
});

test('timeStretch preserves pitch: a stretched sine still measures at (about) the original frequency', () => {
  const sampleRate = 8000;
  const input = sineWave(220, 1.0, sampleRate);
  const stretched = timeStretch(input, sampleRate, 2, { frameSize: 512, hopSize: 128 });

  // Measure pitch on a steady-state segment away from the fade-in/out edges.
  const segment = stretched.subarray(Math.floor(stretched.length * 0.4), Math.floor(stretched.length * 0.4) + 2048);
  const measured = estimateFramePitch(segment, sampleRate, { minHz: 100, maxHz: 400 });
  assert.ok(measured !== null);
  assert.ok(Math.abs(measured - 220) / 220 < 0.08, `expected ~220Hz after stretch, measured ${measured}`);
});

test('resampleLinear changes length while interpolating between samples', () => {
  const input = new Float32Array([0, 1, 0, -1]);
  const out = resampleLinear(input, 8);
  assert.equal(out.length, 8);
  assert.equal(out[0], 0);
  assert.ok(Math.abs(out[out.length - 1] - -1) < 1e-6);
});

test('pitchShift up an octave (+12 semitones) roughly doubles measured frequency and keeps duration', () => {
  const sampleRate = 8000;
  const input = sineWave(220, 1.0, sampleRate);
  const shifted = pitchShift(input, sampleRate, 12, { frameSize: 512, hopSize: 128 });

  assert.equal(shifted.length, input.length); // duration preserved

  const segment = shifted.subarray(Math.floor(shifted.length * 0.4), Math.floor(shifted.length * 0.4) + 2048);
  const measured = estimateFramePitch(segment, sampleRate, { minHz: 300, maxHz: 700 });
  assert.ok(measured !== null);
  assert.ok(Math.abs(measured - 440) / 440 < 0.1, `expected ~440Hz (one octave up), measured ${measured}`);
});

test('pitchShift down an octave (-12 semitones) roughly halves measured frequency and keeps duration', () => {
  const sampleRate = 8000;
  const input = sineWave(440, 1.0, sampleRate);
  const shifted = pitchShift(input, sampleRate, -12, { frameSize: 512, hopSize: 128 });

  assert.equal(shifted.length, input.length);

  const segment = shifted.subarray(Math.floor(shifted.length * 0.4), Math.floor(shifted.length * 0.4) + 2048);
  const measured = estimateFramePitch(segment, sampleRate, { minHz: 100, maxHz: 300 });
  assert.ok(measured !== null);
  assert.ok(Math.abs(measured - 220) / 220 < 0.1, `expected ~220Hz (one octave down), measured ${measured}`);
});
