'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mixBuffers,
  peak,
  rms,
  normalize,
  applyLimiter,
  applyGainDb,
  stereoPeak,
  normalizeStereo,
  applyLimiterStereo,
  combFilter,
  allpassFilter,
  applyReverb,
  applyReverbStereo,
} = require('../index.js');

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

test('stereoPeak reports the louder of the two channels', () => {
  const left = new Float32Array([0.2, -0.3]);
  const right = new Float32Array([0.8, -0.1]);
  assert.ok(Math.abs(stereoPeak(left, right) - 0.8) < 1e-6);
});

test('normalizeStereo applies one shared gain so a quiet channel is not pushed louder than a loud one', () => {
  const left = new Float32Array([0.1, -0.1]); // quiet
  const right = new Float32Array([0.5, -0.5]); // loud, will drive the shared gain
  const { left: normLeft, right: normRight } = normalizeStereo(left, right, 0.98);
  assert.ok(Math.abs(peak(normRight) - 0.98) < 1e-6); // the louder channel hits the target
  assert.ok(peak(normLeft) < 0.98); // the quiet channel stays proportionally quiet
  const gainApplied = normRight[0] / right[0];
  assert.ok(Math.abs(normLeft[0] / left[0] - gainApplied) < 1e-6); // same gain on both channels
});

test('normalizeStereo on silence returns silence for both channels', () => {
  const silence = new Float32Array([0, 0]);
  const { left, right } = normalizeStereo(silence, silence);
  assert.deepEqual([...left], [0, 0]);
  assert.deepEqual([...right], [0, 0]);
});

test('applyLimiterStereo limits each channel independently using the same threshold', () => {
  const left = new Float32Array([1.5]);
  const right = new Float32Array([0.3]);
  const { left: limLeft, right: limRight } = applyLimiterStereo(left, right, 0.9);
  assert.ok(limLeft[0] < 1.5 && limLeft[0] > 0.9); // soft-clipped down
  assert.ok(Math.abs(limRight[0] - 0.3) < 1e-6); // below threshold, untouched
});

test('combFilter creates periodic decaying echoes of an impulse', () => {
  const impulse = new Float32Array(13);
  impulse[0] = 1;
  const out = combFilter(impulse, 4, 0.5);
  assert.equal(out[0], 1);
  assert.ok(Math.abs(out[4] - 0.5) < 1e-6);
  assert.ok(Math.abs(out[8] - 0.25) < 1e-6);
  assert.equal(out[1], 0);
  assert.equal(out[2], 0);
});

test('allpassFilter is (approximately) energy-preserving on a longer signal', () => {
  const n = 2000;
  const input = new Float32Array(n);
  for (let i = 0; i < n; i += 1) input[i] = Math.sin((2 * Math.PI * 7 * i) / n) * 0.6;
  const output = allpassFilter(input, 37, 0.5);
  const rmsOf = (buf) => Math.sqrt([...buf].reduce((s, v) => s + v * v, 0) / buf.length);
  const ratio = rmsOf(output) / rmsOf(input);
  assert.ok(Math.abs(ratio - 1) < 0.15, `expected near-unity energy (allpass filters don't change magnitude response), got ratio ${ratio}`);
});

test('applyReverb leaves a decaying tail after the dry signal has already ended', () => {
  const sampleRate = 8000;
  const dry = new Float32Array(sampleRate); // 1 second buffer
  for (let i = 0; i < 2000; i += 1) dry[i] = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 0.7; // sound only in the first 0.25s
  const wet = applyReverb(dry, sampleRate, { wet: 0.5, roomSize: 0.7 });
  assert.equal(wet.length, dry.length);
  const tailPeak = Math.max(...[...wet.subarray(4000, 5000)].map(Math.abs));
  assert.ok(tailPeak > 0.001, `expected a reverb tail after the dry signal ends, got peak ${tailPeak}`);
});

test('applyReverb with wet=0 returns the dry signal unchanged', () => {
  const sampleRate = 8000;
  const dry = new Float32Array(500);
  for (let i = 0; i < dry.length; i += 1) dry[i] = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 0.5;
  const out = applyReverb(dry, sampleRate, { wet: 0 });
  for (let i = 0; i < dry.length; i += 1) assert.ok(Math.abs(out[i] - dry[i]) < 1e-6);
});

test('applyReverbStereo decorrelates left/right tails even from identical mono input', () => {
  const sampleRate = 8000;
  const mono = new Float32Array(4000);
  for (let i = 0; i < 500; i += 1) mono[i] = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 0.6;
  const { left, right } = applyReverbStereo(mono, mono, sampleRate, { wet: 0.5, roomSize: 0.6 });
  let differs = false;
  for (let i = 1000; i < 2000; i += 1) {
    if (Math.abs(left[i] - right[i]) > 1e-4) {
      differs = true;
      break;
    }
  }
  assert.ok(differs, 'expected the stereo-offset reverb tails to differ between channels');
});
