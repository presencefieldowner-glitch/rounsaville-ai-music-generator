'use strict';

const { midiToFrequency, createRng, hashStringToSeed } = require('../../001_FOUNDATION/Utilities');

// A small real (if simple) synthesis engine. No external DSP deps: the
// basic waveforms are pure phase functions; 'pad' and 'pluck' are genuinely
// different techniques (a detuned oscillator stack and Karplus-Strong
// physical modeling, respectively), not just different phase functions.
// This is algorithmic/DSP synthesis, not neural audio generation.

const WAVEFORMS = {
  sine: (phase) => Math.sin(2 * Math.PI * phase),
  square: (phase) => (phase < 0.5 ? 1 : -1),
  saw: (phase) => 2 * (phase - Math.floor(phase + 0.5)),
  triangle: (phase) => 4 * Math.abs(phase - Math.floor(phase + 0.75) + 0.25) - 1,
};

// Per-timbre attack/decay/sustain/release shaping for the simple
// oscillator waveforms. 'pad' and 'pluck' shape their own amplitude
// (a slow filtered envelope and a physically-modeled decay respectively)
// so they aren't listed here.
const ENVELOPE_PRESETS = {
  sine: { attack: 0.01, decay: 0.05, sustain: 0.8, release: 0.08 },
  square: { attack: 0.005, decay: 0.03, sustain: 0.7, release: 0.05 },
  saw: { attack: 0.005, decay: 0.04, sustain: 0.75, release: 0.06 },
  triangle: { attack: 0.01, decay: 0.05, sustain: 0.8, release: 0.08 },
};

function applyADSR(samples, sampleRate, { attack = 0.01, decay = 0.05, sustain = 0.8, release = 0.08 } = {}) {
  const n = samples.length;
  const attackSamples = Math.min(n, Math.round(attack * sampleRate));
  const decaySamples = Math.min(n - attackSamples, Math.round(decay * sampleRate));
  const releaseSamples = Math.min(n - attackSamples - decaySamples, Math.round(release * sampleRate));
  const sustainSamples = Math.max(0, n - attackSamples - decaySamples - releaseSamples);

  let i = 0;
  for (let a = 0; a < attackSamples; a += 1, i += 1) samples[i] *= a / attackSamples;
  for (let d = 0; d < decaySamples; d += 1, i += 1) samples[i] *= 1 - (1 - sustain) * (d / decaySamples);
  for (let s = 0; s < sustainSamples; s += 1, i += 1) samples[i] *= sustain;
  for (let r = 0; r < releaseSamples; r += 1, i += 1) samples[i] *= sustain * (1 - r / releaseSamples);

  return samples;
}

// One-pole low-pass filter (real-time-safe IIR, no external DSP library).
function applyLowPassFilter(samples, sampleRate, cutoffHz) {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  const alpha = dt / (rc + dt);
  const out = new Float32Array(samples.length);
  out[0] = samples[0] * alpha;
  for (let i = 1; i < samples.length; i += 1) {
    out[i] = out[i - 1] + alpha * (samples[i] - out[i - 1]);
  }
  return out;
}

// Three saw oscillators, slightly detuned (+/- 7 cents) and summed, for a
// thicker "pad" sound than a single oscillator can produce. Low-passed for
// warmth and given a slow attack/release envelope.
function synthesizePad(note, sampleRate) {
  const baseFrequency = midiToFrequency(note.pitch);
  const length = Math.max(1, Math.round(note.duration * sampleRate));
  const amplitude = ((note.velocity ?? 100) / 127) / 3;
  const detunesCents = [-7, 0, 7];
  const samples = new Float32Array(length);

  for (const cents of detunesCents) {
    const frequency = baseFrequency * 2 ** (cents / 1200);
    const phaseIncrement = frequency / sampleRate;
    let phase = 0;
    for (let i = 0; i < length; i += 1) {
      samples[i] += WAVEFORMS.saw(phase) * amplitude;
      phase += phaseIncrement;
      if (phase >= 1) phase -= 1;
    }
  }

  const shaped = applyADSR(samples, sampleRate, { attack: 0.15, decay: 0.1, sustain: 0.85, release: 0.3 });
  return applyLowPassFilter(shaped, sampleRate, 4000);
}

// Karplus-Strong plucked-string physical modeling: a short noise burst
// circulates through a delay line of length (sampleRate / frequency),
// averaged and damped on each pass, which naturally produces the
// exponentially-decaying, string-like timbre — a genuinely different
// synthesis technique from the phase-oscillator waveforms above, not a
// pre-baked sample. The seed noise is generated from a seeded PRNG (keyed
// on the note itself) rather than Math.random so rendering stays
// deterministic given the same composition.
function synthesizePluck(note, sampleRate) {
  const frequency = midiToFrequency(note.pitch);
  const length = Math.max(1, Math.round(note.duration * sampleRate));
  const amplitude = (note.velocity ?? 100) / 127;
  const delayLength = Math.max(2, Math.round(sampleRate / frequency));

  const rng = createRng(hashStringToSeed(`pluck:${note.pitch}:${note.start}:${note.duration}`));
  const ring = new Float32Array(delayLength);
  for (let i = 0; i < delayLength; i += 1) ring[i] = (rng() * 2 - 1) * amplitude;

  const samples = new Float32Array(length);
  let previous = ring[delayLength - 1];
  const damping = 0.996;
  for (let i = 0; i < length; i += 1) {
    const idx = i % delayLength;
    const current = ring[idx];
    const averaged = 0.5 * (current + previous);
    const damped = averaged * damping;
    ring[idx] = damped;
    samples[i] = current;
    previous = damped;
  }

  return samples;
}

function synthesizeNote(note, sampleRate, waveform = 'sine') {
  if (waveform === 'pluck') return synthesizePluck(note, sampleRate);
  if (waveform === 'pad') return synthesizePad(note, sampleRate);

  const gen = WAVEFORMS[waveform] ?? WAVEFORMS.sine;
  const frequency = midiToFrequency(note.pitch);
  const length = Math.max(1, Math.round(note.duration * sampleRate));
  const amplitude = (note.velocity ?? 100) / 127;
  const samples = new Float32Array(length);

  let phase = 0;
  const phaseIncrement = frequency / sampleRate;
  for (let i = 0; i < length; i += 1) {
    samples[i] = gen(phase) * amplitude;
    phase += phaseIncrement;
    if (phase >= 1) phase -= 1;
  }

  return applyADSR(samples, sampleRate, ENVELOPE_PRESETS[waveform] ?? ENVELOPE_PRESETS.sine);
}

module.exports = {
  WAVEFORMS,
  ENVELOPE_PRESETS,
  applyADSR,
  applyLowPassFilter,
  synthesizePad,
  synthesizePluck,
  synthesizeNote,
};
