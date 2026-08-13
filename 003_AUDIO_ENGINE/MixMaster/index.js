'use strict';

/**
 * MixMaster — combining and levelling for the audio engine layer.
 *
 * Operates on plain Float32Array buffers, so it works with anything that
 * produces samples (SynthEngine, decoded files, generated tests) and knows
 * nothing about how they were made or where they are going.
 */

/** Loudest absolute sample; 0 for an empty or silent buffer. */
function peakLevel(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const magnitude = Math.abs(samples[i]);
    if (magnitude > peak) peak = magnitude;
  }
  return peak;
}

/** Root mean square — average power, a better loudness proxy than peak. */
function rms(samples) {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** Scale down to `peak` if the signal would clip; never scale up. */
function normalize(samples, peak = 0.95) {
  const loudest = peakLevel(samples);
  const out = Float32Array.from(samples);
  if (loudest === 0 || loudest <= peak) return out;

  const gain = peak / loudest;
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  return out;
}

function applyGain(samples, gain) {
  const out = Float32Array.from(samples);
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  return out;
}

/** Decibels to a linear gain multiplier: 0 dB = 1.0, -6 dB ≈ 0.5. */
const gainFromDecibels = (db) => Math.pow(10, db / 20);

/** Hard-limit every sample into [-1, 1] without touching what already fits. */
function clip(samples) {
  const out = Float32Array.from(samples);
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.max(-1, Math.min(1, out[i]));
  }
  return out;
}

/**
 * Sum tracks of any lengths, padding to the longest.
 * Normalizes by default, since summing signals overshoots [-1, 1] quickly.
 */
function mix(tracks, options = {}) {
  const { normalize: shouldNormalize = true, peak = 0.95 } = options;

  if (tracks.length === 0) return new Float32Array(0);

  const length = tracks.reduce((max, track) => Math.max(max, track.length), 0);
  const out = new Float32Array(length);
  for (const track of tracks) {
    for (let i = 0; i < track.length; i++) out[i] += track[i];
  }

  return shouldNormalize ? normalize(out, peak) : out;
}

/**
 * Constant-power pan. `position` runs -1 (hard left) to 1 (hard right);
 * centre gives each side 1/sqrt(2), keeping perceived loudness steady across
 * the field rather than dipping in the middle as a linear pan would.
 */
function pan(samples, position = 0) {
  const clamped = Math.max(-1, Math.min(1, position));
  const angle = ((clamped + 1) * Math.PI) / 4;
  return {
    left: applyGain(samples, Math.cos(angle)),
    right: applyGain(samples, Math.sin(angle)),
  };
}

/** Interleave two channels into the L,R,L,R layout WAV expects. */
function interleave(left, right) {
  const frames = Math.max(left.length, right.length);
  const out = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    out[i * 2] = i < left.length ? left[i] : 0;
    out[i * 2 + 1] = i < right.length ? right[i] : 0;
  }
  return out;
}

/** Split an interleaved stereo buffer back into two channels. */
function deinterleave(stereo) {
  const frames = Math.floor(stereo.length / 2);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    left[i] = stereo[i * 2];
    right[i] = stereo[i * 2 + 1];
  }
  return { left, right };
}

/**
 * Lay a track into a longer timeline at `offsetSeconds`, extending the
 * timeline if it runs past the end. This is what turns a bag of rendered
 * notes into an arrangement.
 */
function placeAt(base, track, offsetSeconds, sampleRate = 44100) {
  const offset = Math.floor(offsetSeconds * sampleRate);
  const out = new Float32Array(Math.max(base.length, offset + track.length));
  out.set(base, 0);
  for (let i = 0; i < track.length; i++) out[offset + i] += track[i];
  return out;
}

module.exports = {
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
};
