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
  biquadCoefficients,
  applyBiquad,
  applyEq,
  applyEqStereo,
} = require('../index.js');

// A single-frequency DFT magnitude (Goertzel-equivalent), computed
// independently of MixMaster's own code, purely to verify the EQ's actual
// frequency response from the outside rather than trusting its internals.
function magnitudeAtFrequency(buffer, sampleRate, freq) {
  let re = 0;
  let im = 0;
  for (let n = 0; n < buffer.length; n += 1) {
    const angle = (2 * Math.PI * freq * n) / sampleRate;
    re += buffer[n] * Math.cos(angle);
    im -= buffer[n] * Math.sin(angle);
  }
  return Math.hypot(re, im) / buffer.length;
}

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

test('biquadCoefficients rejects a frequency at or beyond Nyquist', () => {
  assert.throws(() => biquadCoefficients('peaking', 24000, 44100, 6));
  assert.throws(() => biquadCoefficients('peaking', 0, 44100, 6));
});

test('applyBiquad with 0dB peaking gain leaves the signal essentially unchanged', () => {
  const sampleRate = 44100;
  const n = 4096;
  const input = new Float32Array(n);
  for (let i = 0; i < n; i += 1) input[i] = Math.sin((2 * Math.PI * 1000 * i) / sampleRate) * 0.5;
  const coeffs = biquadCoefficients('peaking', 1000, sampleRate, 0);
  const out = applyBiquad(input, coeffs);
  const mag = magnitudeAtFrequency(out.subarray(500), sampleRate, 1000);
  const magIn = magnitudeAtFrequency(input.subarray(500), sampleRate, 1000);
  assert.ok(Math.abs(mag - magIn) / magIn < 0.01, `0dB peaking filter should be transparent, ratio ${mag / magIn}`);
});

test('applyEq low-shelf boost raises low-frequency magnitude and roughly leaves high frequencies alone', () => {
  const sampleRate = 44100;
  const n = 8192;
  const input = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    input[i] = 0.3 * Math.sin((2 * Math.PI * 80 * i) / sampleRate) + 0.3 * Math.sin((2 * Math.PI * 8000 * i) / sampleRate);
  }
  const boosted = applyEq(input, sampleRate, { bassDb: 12 });

  const settle = 1000; // skip the filter's initial transient
  const lowBefore = magnitudeAtFrequency(input.subarray(settle), sampleRate, 80);
  const lowAfter = magnitudeAtFrequency(boosted.subarray(settle), sampleRate, 80);
  const highBefore = magnitudeAtFrequency(input.subarray(settle), sampleRate, 8000);
  const highAfter = magnitudeAtFrequency(boosted.subarray(settle), sampleRate, 8000);

  assert.ok(lowAfter / lowBefore > 2, `expected a real low-frequency boost, got ratio ${lowAfter / lowBefore}`);
  assert.ok(Math.abs(highAfter / highBefore - 1) < 0.2, `high frequency should be roughly untouched by a low-shelf, got ratio ${highAfter / highBefore}`);
});

test('applyEq high-shelf cut lowers high-frequency magnitude and roughly leaves low frequencies alone', () => {
  const sampleRate = 44100;
  const n = 8192;
  const input = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    input[i] = 0.3 * Math.sin((2 * Math.PI * 80 * i) / sampleRate) + 0.3 * Math.sin((2 * Math.PI * 8000 * i) / sampleRate);
  }
  const cut = applyEq(input, sampleRate, { trebleDb: -12 });

  const settle = 1000;
  const lowBefore = magnitudeAtFrequency(input.subarray(settle), sampleRate, 80);
  const lowAfter = magnitudeAtFrequency(cut.subarray(settle), sampleRate, 80);
  const highBefore = magnitudeAtFrequency(input.subarray(settle), sampleRate, 8000);
  const highAfter = magnitudeAtFrequency(cut.subarray(settle), sampleRate, 8000);

  assert.ok(highAfter / highBefore < 0.5, `expected a real high-frequency cut, got ratio ${highAfter / highBefore}`);
  assert.ok(Math.abs(lowAfter / lowBefore - 1) < 0.2, `low frequency should be roughly untouched by a high-shelf, got ratio ${lowAfter / lowBefore}`);
});

test('applyEq mid peaking boost raises magnitude at the mid frequency more than at bass/treble', () => {
  const sampleRate = 44100;
  const n = 8192;
  const input = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    input[i] =
      0.2 * Math.sin((2 * Math.PI * 80 * i) / sampleRate) +
      0.2 * Math.sin((2 * Math.PI * 1000 * i) / sampleRate) +
      0.2 * Math.sin((2 * Math.PI * 8000 * i) / sampleRate);
  }
  const boosted = applyEq(input, sampleRate, { midDb: 12 });
  const settle = 1000;
  const midBefore = magnitudeAtFrequency(input.subarray(settle), sampleRate, 1000);
  const midAfter = magnitudeAtFrequency(boosted.subarray(settle), sampleRate, 1000);
  const lowRatio =
    magnitudeAtFrequency(boosted.subarray(settle), sampleRate, 80) / magnitudeAtFrequency(input.subarray(settle), sampleRate, 80);
  const highRatio =
    magnitudeAtFrequency(boosted.subarray(settle), sampleRate, 8000) /
    magnitudeAtFrequency(input.subarray(settle), sampleRate, 8000);

  assert.ok(midAfter / midBefore > 2, `expected a real mid-frequency boost, got ratio ${midAfter / midBefore}`);
  assert.ok(midAfter / midBefore > lowRatio * 1.5, 'mid boost should affect mids more than bass');
  assert.ok(midAfter / midBefore > highRatio * 1.5, 'mid boost should affect mids more than treble');
});

test('applyEq with all gains at 0 (the default) returns the exact same buffer, not a filtered copy', () => {
  const buf = new Float32Array([0.1, -0.2, 0.3, -0.4]);
  const out = applyEq(buf, 44100);
  assert.equal(out, buf); // same reference: every band was skipped, not run through a 0dB filter
});

test('applyEqStereo applies the same EQ curve to both channels independently', () => {
  const sampleRate = 44100;
  const n = 4096;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    left[i] = 0.3 * Math.sin((2 * Math.PI * 80 * i) / sampleRate);
    right[i] = 0.3 * Math.sin((2 * Math.PI * 80 * i) / sampleRate) * 0.5; // quieter right channel
  }
  const { left: outLeft, right: outRight } = applyEqStereo(left, right, sampleRate, { bassDb: 12 });
  const settle = 500;
  const leftGain =
    magnitudeAtFrequency(outLeft.subarray(settle), sampleRate, 80) / magnitudeAtFrequency(left.subarray(settle), sampleRate, 80);
  const rightGain =
    magnitudeAtFrequency(outRight.subarray(settle), sampleRate, 80) / magnitudeAtFrequency(right.subarray(settle), sampleRate, 80);
  assert.ok(Math.abs(leftGain - rightGain) / leftGain < 0.05, 'both channels should receive the same relative boost');
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
