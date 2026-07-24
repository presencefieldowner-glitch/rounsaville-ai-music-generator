'use strict';

const { dbToLinear } = require('../../001_FOUNDATION/Utilities');

// Basic mixdown/mastering chain operating on Float32Array PCM buffers.

function mixBuffers(buffers, gains = []) {
  if (buffers.length === 0) return new Float32Array(0);
  const length = Math.max(...buffers.map((b) => b.length));
  const out = new Float32Array(length);
  buffers.forEach((buf, idx) => {
    const gain = gains[idx] ?? 1;
    for (let i = 0; i < buf.length; i += 1) {
      out[i] += buf[i] * gain;
    }
  });
  return out;
}

function peak(buffer) {
  let max = 0;
  for (const s of buffer) {
    const abs = Math.abs(s);
    if (abs > max) max = abs;
  }
  return max;
}

function rms(buffer) {
  if (buffer.length === 0) return 0;
  let sum = 0;
  for (const s of buffer) sum += s * s;
  return Math.sqrt(sum / buffer.length);
}

function normalize(buffer, targetPeak = 0.98) {
  const currentPeak = peak(buffer);
  if (currentPeak === 0) return buffer.slice();
  const gain = targetPeak / currentPeak;
  const out = new Float32Array(buffer.length);
  for (let i = 0; i < buffer.length; i += 1) out[i] = buffer[i] * gain;
  return out;
}

// Soft-knee limiter: a tanh-based soft clip above the threshold, leaving
// everything below it untouched so quiet passages aren't colored.
function applyLimiter(buffer, threshold = 0.9) {
  const out = new Float32Array(buffer.length);
  for (let i = 0; i < buffer.length; i += 1) {
    const s = buffer[i];
    const abs = Math.abs(s);
    if (abs <= threshold) {
      out[i] = s;
    } else {
      const sign = Math.sign(s);
      const over = abs - threshold;
      const compressed = threshold + (1 - threshold) * Math.tanh(over / (1 - threshold));
      out[i] = sign * compressed;
    }
  }
  return out;
}

function applyGainDb(buffer, db) {
  const gain = dbToLinear(db);
  const out = new Float32Array(buffer.length);
  for (let i = 0; i < buffer.length; i += 1) out[i] = buffer[i] * gain;
  return out;
}

// Stereo-aware variants used by the render pipeline. normalizeStereo
// applies a single shared gain (derived from whichever channel peaks
// higher) to both channels, rather than normalizing each independently —
// independent normalization would push a quieter channel up
// disproportionately and skew the stereo image. applyLimiter's tanh
// soft-clip curve is already a fixed, channel-independent function of the
// sample value, so applying it separately per channel doesn't have that
// problem.
function stereoPeak(left, right) {
  return Math.max(peak(left), peak(right));
}

function normalizeStereo(left, right, targetPeak = 0.98) {
  const currentPeak = stereoPeak(left, right);
  if (currentPeak === 0) return { left: left.slice(), right: right.slice() };
  const gain = targetPeak / currentPeak;
  const scale = (buf) => {
    const out = new Float32Array(buf.length);
    for (let i = 0; i < buf.length; i += 1) out[i] = buf[i] * gain;
    return out;
  };
  return { left: scale(left), right: scale(right) };
}

function applyLimiterStereo(left, right, threshold = 0.9) {
  return { left: applyLimiter(left, threshold), right: applyLimiter(right, threshold) };
}

// Schroeder reverb: a real, classic (1962) algorithmic reverb topology —
// four parallel comb filters (which build up the diffuse decay) feeding
// two series allpass filters (which smear the decay's transients without
// coloring the tone). No convolution/impulse-response sample is involved;
// it's entirely delay-line feedback, computed per sample.

// y[n] = x[n] + g * y[n - D]
function combFilter(input, delaySamples, feedback) {
  const out = new Float32Array(input.length);
  const buffer = new Float32Array(delaySamples);
  let idx = 0;
  for (let i = 0; i < input.length; i += 1) {
    const delayed = buffer[idx];
    out[i] = input[i] + delayed * feedback;
    buffer[idx] = out[i];
    idx = (idx + 1) % delaySamples;
  }
  return out;
}

// y[n] = -g*x[n] + x[n-D] + g*y[n-D], implemented with a single delay
// buffer holding (x[n-D] + g*y[n-D]) so it doubles as both feedback and
// feed-forward taps.
function allpassFilter(input, delaySamples, gain) {
  const out = new Float32Array(input.length);
  const buffer = new Float32Array(delaySamples);
  let idx = 0;
  for (let i = 0; i < input.length; i += 1) {
    const bufOut = buffer[idx];
    const y = -gain * input[i] + bufOut;
    buffer[idx] = input[i] + gain * y;
    out[i] = y;
    idx = (idx + 1) % delaySamples;
  }
  return out;
}

const REVERB_COMB_DELAYS_MS = [29.7, 37.1, 41.1, 43.7];
const REVERB_ALLPASS_DELAYS_MS = [5, 1.7];

// roomSize in [0, 1] controls comb feedback (and so decay length); wet is
// the dry/wet mix. `delayOffsetMs` lets the two stereo channels use
// slightly different delay times so the reverb decorrelates left/right
// instead of sounding mono — the same trick real stereo reverbs use.
function applyReverb(buffer, sampleRate, { wet = 0.25, roomSize = 0.5, delayOffsetMs = 0 } = {}) {
  const feedback = Math.max(0, Math.min(1, 0.28 + roomSize * 0.65));

  let combSum = new Float32Array(buffer.length);
  for (const ms of REVERB_COMB_DELAYS_MS) {
    const delaySamples = Math.max(1, Math.round(((ms + delayOffsetMs) / 1000) * sampleRate));
    const combOut = combFilter(buffer, delaySamples, feedback);
    for (let i = 0; i < buffer.length; i += 1) combSum[i] += combOut[i] / REVERB_COMB_DELAYS_MS.length;
  }

  for (const ms of REVERB_ALLPASS_DELAYS_MS) {
    const delaySamples = Math.max(1, Math.round(((ms + delayOffsetMs) / 1000) * sampleRate));
    combSum = allpassFilter(combSum, delaySamples, 0.5);
  }

  const out = new Float32Array(buffer.length);
  for (let i = 0; i < buffer.length; i += 1) out[i] = buffer[i] * (1 - wet) + combSum[i] * wet;
  return out;
}

function applyReverbStereo(left, right, sampleRate, options = {}) {
  return {
    left: applyReverb(left, sampleRate, { ...options, delayOffsetMs: 0 }),
    right: applyReverb(right, sampleRate, { ...options, delayOffsetMs: 0.7 }),
  };
}

module.exports = {
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
};
