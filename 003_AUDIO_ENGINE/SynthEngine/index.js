'use strict';

const { midiToFrequency } = require('../../001_FOUNDATION/Utilities');

// Real (if simple) subtractive-style oscillator bank. No external DSP deps:
// each waveform is a pure function of phase in [0, 1).

const WAVEFORMS = {
  sine: (phase) => Math.sin(2 * Math.PI * phase),
  square: (phase) => (phase < 0.5 ? 1 : -1),
  saw: (phase) => 2 * (phase - Math.floor(phase + 0.5)),
  triangle: (phase) => 4 * Math.abs(phase - Math.floor(phase + 0.75) + 0.25) - 1,
};

function applyEnvelope(samples, sampleRate, { attack = 0.01, release = 0.05 } = {}) {
  const attackSamples = Math.min(samples.length, Math.round(attack * sampleRate));
  const releaseSamples = Math.min(samples.length, Math.round(release * sampleRate));

  for (let i = 0; i < attackSamples; i += 1) {
    samples[i] *= i / attackSamples;
  }
  for (let i = 0; i < releaseSamples; i += 1) {
    const idx = samples.length - 1 - i;
    samples[idx] *= i / releaseSamples;
  }
  return samples;
}

function synthesizeNote(note, sampleRate, waveform = 'sine') {
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

  return applyEnvelope(samples, sampleRate);
}

module.exports = { WAVEFORMS, synthesizeNote, applyEnvelope };
