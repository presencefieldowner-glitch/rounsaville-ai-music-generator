'use strict';

// Real (if basic) voice analysis: autocorrelation pitch detection and a
// naive DFT-based spectral centroid ("brightness"). This calibrates a
// synthesized vocal line to the speaker's actual pitch range — it is NOT
// neural voice cloning / timbre transfer. No ML model, no network calls.

function downsample(samples, sampleRate, targetRate) {
  if (targetRate >= sampleRate) return { samples, sampleRate };
  const ratio = sampleRate / targetRate;
  const outLength = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j += 1) {
      sum += samples[j];
      count += 1;
    }
    out[i] = count > 0 ? sum / count : 0;
  }
  return { samples: out, sampleRate: targetRate };
}

function frameSignal(samples, frameSize, hopSize) {
  const frames = [];
  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    frames.push(samples.subarray(start, start + frameSize));
  }
  return frames;
}

function rms(frame) {
  let sum = 0;
  for (const s of frame) sum += s * s;
  return Math.sqrt(sum / frame.length);
}

// Time-domain autocorrelation pitch estimator. Returns Hz, or null if the
// frame is unvoiced/too quiet to get a confident estimate.
function estimateFramePitch(frame, sampleRate, { minHz = 70, maxHz = 400 } = {}) {
  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.min(frame.length - 1, Math.floor(sampleRate / minHz));
  if (maxLag <= minLag) return null;

  let bestLag = -1;
  let bestCorrelation = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let i = 0; i < frame.length - lag; i += 1) {
      sum += frame[i] * frame[i + lag];
    }
    if (sum > bestCorrelation) {
      bestCorrelation = sum;
      bestLag = lag;
    }
  }

  if (bestLag <= 0) return null;
  const energy = rms(frame);
  if (energy < 1e-4) return null; // essentially silent
  return sampleRate / bestLag;
}

// Naive O(n^2) DFT magnitude spectrum, only ever run on small frames
// (a few hundred samples) so this stays cheap. "Brightness" is the
// energy-weighted mean frequency (spectral centroid).
function spectralCentroid(frame, sampleRate) {
  const n = frame.length;
  let weightedSum = 0;
  let magnitudeSum = 0;
  const bins = n / 2;
  for (let k = 1; k < bins; k += 1) {
    let re = 0;
    let im = 0;
    for (let t = 0; t < n; t += 1) {
      const angle = (-2 * Math.PI * k * t) / n;
      re += frame[t] * Math.cos(angle);
      im += frame[t] * Math.sin(angle);
    }
    const magnitude = Math.sqrt(re * re + im * im);
    const freq = (k * sampleRate) / n;
    weightedSum += freq * magnitude;
    magnitudeSum += magnitude;
  }
  return magnitudeSum > 0 ? weightedSum / magnitudeSum : 0;
}

function analyzeVoiceSample(samples, sampleRate, options = {}) {
  const { samples: ds, sampleRate: dsRate } = downsample(samples, sampleRate, 16000);
  const frameSize = Math.round(dsRate * 0.04); // 40ms frames
  const hopSize = Math.round(frameSize / 2);
  const frames = frameSignal(ds, frameSize, hopSize);

  const pitches = [];
  const centroidFrameSize = 512;
  let centroidSum = 0;
  let centroidCount = 0;

  frames.forEach((frame, idx) => {
    const pitch = estimateFramePitch(frame, dsRate, options);
    if (pitch) pitches.push(pitch);
    if (idx % 4 === 0 && frame.length >= centroidFrameSize) {
      centroidSum += spectralCentroid(frame.subarray(0, centroidFrameSize), dsRate);
      centroidCount += 1;
    }
  });

  if (pitches.length === 0) {
    return { voicedFrameRatio: 0, averagePitchHz: null, minPitchHz: null, maxPitchHz: null, brightness: 0 };
  }

  pitches.sort((a, b) => a - b);
  const averagePitchHz = pitches.reduce((sum, p) => sum + p, 0) / pitches.length;

  return {
    voicedFrameRatio: pitches.length / frames.length,
    averagePitchHz,
    minPitchHz: pitches[Math.floor(pitches.length * 0.1)], // trim outliers
    maxPitchHz: pitches[Math.ceil(pitches.length * 0.9) - 1],
    brightness: centroidCount > 0 ? centroidSum / centroidCount : 0,
  };
}

function buildVoiceProfile(analyses) {
  const voiced = analyses.filter((a) => a.averagePitchHz != null);
  if (voiced.length === 0) {
    throw new Error('no voiced audio detected across the recorded samples');
  }
  const avg = (key) => voiced.reduce((sum, a) => sum + a[key], 0) / voiced.length;
  return {
    averagePitchHz: avg('averagePitchHz'),
    minPitchHz: Math.min(...voiced.map((a) => a.minPitchHz)),
    maxPitchHz: Math.max(...voiced.map((a) => a.maxPitchHz)),
    brightness: avg('brightness'),
    sampleCount: voiced.length,
  };
}

module.exports = {
  downsample,
  frameSignal,
  rms,
  estimateFramePitch,
  spectralCentroid,
  analyzeVoiceSample,
  buildVoiceProfile,
};
