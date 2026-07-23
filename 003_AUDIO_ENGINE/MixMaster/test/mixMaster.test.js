'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mixBuffers, peak, rms, normalize, applyLimiter, applyGainDb } = require('../index.js');

test('mixBuffers sums aligned buffers with per-buffer gain', () => {
  const a = new Float32Array([0.1, 0.2, 0.3]);
  const b = new Float32Array([0.1, 0.1, 0.1]);
  const mixed = mixBuffers([a, b], [1, 0.5]);
  assert.ok(Math.abs(mixed[0] - 0.15) < 1e-6);
  assert.ok(Math.abs(mixed[1] - 0.25) < 1e-6);
});

test('peak and rms report expected magnitudes', () => {
  const buf = new Float32Array([0.5, -0.9, 0.2]);
  assert.ok(Math.abs(peak(buf) - 0.9) < 1e-6);
  assert.ok(rms(buf) > 0 && rms(buf) < 0.9);
});

test('normalize brings the peak to the target', () => {
  const buf = new Float32Array([0.2, -0.4, 0.1]);
  const normalized = normalize(buf, 0.98);
  assert.ok(Math.abs(peak(normalized) - 0.98) < 1e-6);
});

test('normalize on silence returns silence without dividing by zero', () => {
  const buf = new Float32Array([0, 0, 0]);
  const normalized = normalize(buf);
  assert.deepEqual([...normalized], [0, 0, 0]);
});

test('applyLimiter leaves quiet signal untouched but caps loud peaks', () => {
  const buf = new Float32Array([0.5, 1.5, -1.5]);
  const limited = applyLimiter(buf, 0.9);
  assert.equal(limited[0], 0.5);
  assert.ok(peak(limited) < 1.0);
});

test('applyGainDb roughly halves amplitude at -6dB', () => {
  const buf = new Float32Array([1, -1]);
  const out = applyGainDb(buf, -6);
  assert.ok(Math.abs(out[0] - 0.5012) < 0.01);
});
