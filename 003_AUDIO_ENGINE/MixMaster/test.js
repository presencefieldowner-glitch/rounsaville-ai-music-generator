'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  peakLevel,
  rms,
  normalize,
  applyGain,
  gainFromDecibels,
  clip,
  mix,
  pan,
  interleave,
  deinterleave,
  placeAt,
} = require('./index');

const buffer = (...values) => Float32Array.from(values);

test('peakLevel finds the loudest magnitude regardless of sign', () => {
  assert.ok(Math.abs(peakLevel(buffer(0.2, -0.9, 0.5)) - 0.9) < 1e-6);
  assert.strictEqual(peakLevel(new Float32Array(0)), 0);
});

test('rms of a constant signal is that constant', () => {
  assert.ok(Math.abs(rms(buffer(0.5, 0.5, 0.5)) - 0.5) < 1e-6);
  assert.strictEqual(rms(new Float32Array(0)), 0);
});

test('rms is lower than peak for a signal that varies', () => {
  const signal = buffer(1, 0, 1, 0);
  assert.ok(rms(signal) < peakLevel(signal));
});

test('normalize scales a clipping signal down to the ceiling', () => {
  const out = normalize(buffer(2, -2), 0.95);
  assert.ok(Math.abs(peakLevel(out) - 0.95) < 1e-6);
});

test('normalize leaves a quiet signal alone', () => {
  const quiet = buffer(0.1, -0.1, 0.05);
  assert.deepStrictEqual(Array.from(normalize(quiet)), Array.from(quiet));
});

test('normalize preserves relative balance between samples', () => {
  const out = normalize(buffer(2, 1), 1);
  assert.ok(Math.abs(out[0] / out[1] - 2) < 1e-6);
});

test('normalize handles digital silence without dividing by zero', () => {
  const out = normalize(buffer(0, 0, 0));
  assert.ok(out.every((s) => s === 0));
});

test('normalize does not mutate its input', () => {
  const input = buffer(2, -2);
  normalize(input);
  assert.strictEqual(input[0], 2);
});

test('applyGain scales every sample', () => {
  const out = applyGain(buffer(0.2, -0.4), 2);
  assert.ok(Math.abs(out[0] - 0.4) < 1e-6);
  assert.ok(Math.abs(out[1] - -0.8) < 1e-6);
});

test('gainFromDecibels matches the standard reference points', () => {
  assert.ok(Math.abs(gainFromDecibels(0) - 1) < 1e-12);
  assert.ok(Math.abs(gainFromDecibels(-6) - 0.501187) < 1e-5);
  assert.ok(Math.abs(gainFromDecibels(20) - 10) < 1e-9);
});

test('clip bounds without touching what already fits', () => {
  assert.deepStrictEqual(Array.from(clip(buffer(2, -2, 0.5))), [1, -1, 0.5]);
});

test('mix sums signals', () => {
  assert.ok(Math.abs(mix([buffer(0.2), buffer(0.3)], { normalize: false })[0] - 0.5) < 1e-6);
});

test('mix pads to the longest track', () => {
  assert.strictEqual(mix([new Float32Array(10), new Float32Array(25)]).length, 25);
});

test('mix normalizes away the clipping that summing causes', () => {
  const mixed = mix([buffer(0.9, 0.9), buffer(0.9, 0.9)]);
  assert.ok(peakLevel(mixed) <= 0.95 + 1e-6);
});

test('mixing nothing yields an empty buffer, not a crash', () => {
  assert.strictEqual(mix([]).length, 0);
});

test('a centred pan is equal and constant-power on both sides', () => {
  const { left, right } = pan(buffer(1), 0);
  assert.ok(Math.abs(left[0] - right[0]) < 1e-6);
  assert.ok(Math.abs(left[0] - Math.SQRT1_2) < 1e-6);
});

test('hard pans silence the opposite channel', () => {
  const hardLeft = pan(buffer(1), -1);
  assert.ok(Math.abs(hardLeft.left[0] - 1) < 1e-6);
  assert.ok(Math.abs(hardLeft.right[0]) < 1e-6);

  const hardRight = pan(buffer(1), 1);
  assert.ok(Math.abs(hardRight.right[0] - 1) < 1e-6);
  assert.ok(Math.abs(hardRight.left[0]) < 1e-6);
});

test('pan holds total power steady across the field', () => {
  for (const position of [-1, -0.5, 0, 0.5, 1]) {
    const { left, right } = pan(buffer(1), position);
    const power = left[0] * left[0] + right[0] * right[0];
    assert.ok(Math.abs(power - 1) < 1e-6, `power was ${power} at ${position}`);
  }
});

test('pan clamps positions beyond the field', () => {
  assert.deepStrictEqual(Array.from(pan(buffer(1), -5).left), Array.from(pan(buffer(1), -1).left));
});

test('interleave and deinterleave round-trip', () => {
  const left = buffer(0.1, 0.2, 0.3);
  const right = buffer(-0.1, -0.2, -0.3);
  const stereo = interleave(left, right);

  assert.strictEqual(stereo.length, 6);
  assert.ok(Math.abs(stereo[0] - 0.1) < 1e-6);
  assert.ok(Math.abs(stereo[1] - -0.1) < 1e-6);

  const split = deinterleave(stereo);
  assert.deepStrictEqual(Array.from(split.left), Array.from(left));
  assert.deepStrictEqual(Array.from(split.right), Array.from(right));
});

test('interleave pads the shorter channel with silence', () => {
  const stereo = interleave(buffer(1, 1), buffer(1));
  assert.strictEqual(stereo.length, 4);
  assert.strictEqual(stereo[3], 0);
});

test('placeAt offsets a track into a timeline', () => {
  const out = placeAt(new Float32Array(4), buffer(1, 1), 2, 1);
  assert.deepStrictEqual(Array.from(out), [0, 0, 1, 1]);
});

test('placeAt extends the timeline when a track runs past the end', () => {
  const out = placeAt(new Float32Array(2), buffer(1, 1), 3, 1);
  assert.strictEqual(out.length, 5);
  assert.deepStrictEqual(Array.from(out), [0, 0, 0, 1, 1]);
});

test('placeAt sums into occupied space rather than overwriting', () => {
  const out = placeAt(buffer(0.5, 0.5), buffer(0.5, 0.5), 0, 1);
  assert.ok(Math.abs(out[0] - 1) < 1e-6);
});
