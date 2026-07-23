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

module.exports = { mixBuffers, peak, rms, normalize, applyLimiter, applyGainDb };
